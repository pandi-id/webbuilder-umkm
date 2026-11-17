package epp

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/teknispandi/epp-pandi-client/v2/frames"
	"github.com/webbuilder/api-registry/internal/provider"
)

// deriveHandleFromExternalID — deterministic mapping external user UUID
// → NIC handle EPP. PANDI limit ID 16 char alphanumeric.
//
// Format: "WB" + first-14-hex-of-uuid-md5. Deterministic supaya idempotent
// contact:create — kalau caller register domain baru untuk user yang sama,
// pakai handle sama → PANDI return 2302 kalau sudah exists (kita ignore).
func deriveHandleFromExternalID(externalUserID string) (string, error) {
	trimmed := strings.TrimSpace(externalUserID)
	if trimmed == "" {
		return "", errors.New("external_user_id kosong")
	}
	// Ambil 14 char alphanumeric pertama, skip dash UUID.
	clean := strings.Map(func(r rune) rune {
		if (r >= '0' && r <= '9') || (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') {
			return r
		}
		return -1
	}, strings.ToLower(trimmed))
	if len(clean) < 8 {
		return "", fmt.Errorf("external_user_id terlalu pendek untuk derive handle: %q", externalUserID)
	}
	if len(clean) > 14 {
		clean = clean[:14]
	}
	return "WB" + clean, nil
}

// ensureContact — create contact kalau belum ada. Idempotent: kalau EPP
// return 2302 (object exists), swallow error (contact sudah ada — safe).
//
// Contact digenerate dengan minimal viable fields. Update lebih detail
// via UpdateDomainContact atau UpdateContactByID pasca register.
//
// NIK / civil ID BUKAN concern api-registry per arsitektur — itu PII user
// yang di-owned web builder (verify via document flow di sana). EPP
// contact object hanya menerima nama/email/tel/address standard.
func (p *EPPDirectProvider) ensureContact(ctx context.Context, handle string, c provider.Contact) error {
	p.c.connMu.Lock()
	defer p.c.connMu.Unlock()
	defer p.c.endCommand()
	if err := p.c.ensureConnected(ctx); err != nil {
		return mapEPPErr(err)
	}

	frame := &frames.ContactCreateType{}
	frame.SetContactID(handle)
	frame.SetEmail(c.Email)
	frame.SetAuthInfo(defaultAuthInfo(handle))
	frame.AddVoice(frames.E164Type{Value: normalizePhoneE164(c.Phone)})

	countryCode := c.CountryCode
	if countryCode == "" {
		countryCode = "ID"
	}
	// Sanitize ke ASCII dulu — EPP PostalInfo type="int" (RFC 5733 §2.6)
	// wajib ASCII. Em-dash/en-dash/aksen/smart quotes → ASCII equivalent.
	// Defense-in-depth: web-builder sudah validate tapi api-registry juga
	// safeguard supaya karakter non-ASCII tidak sampai PANDI (yang bakal
	// return "Transaction rolled back" dari Spring/Hibernate validator).
	sanitizedName, nameChanged := sanitizeASCII(c.Name)
	sanitizedAddr, addrChanged := sanitizeASCII(c.Address)
	sanitizedCity, cityChanged := sanitizeASCII(c.City)
	sanitizedState, stateChanged := sanitizeASCII(c.State)
	if nameChanged || addrChanged || cityChanged || stateChanged {
		slog.Warn("contact:create — field non-ASCII di-sanitize",
			"handle", handle,
			"name_changed", nameChanged,
			"address_changed", addrChanged,
			"city_changed", cityChanged,
			"state_changed", stateChanged,
		)
	}
	postal := frames.PostalInfo{
		Name: sanitizedName,
		Type: frames.PostalInfoInternational,
		Address: frames.Address{
			Street:        streetLines(sanitizedAddr),
			City:          sanitizedCity,
			StateProvince: sanitizedState,
			PostalCode:    c.PostalCode,
			CountryCode:   countryCode,
		},
	}
	frame.AddPostalInfo(postal)

	p.c.DumpRequest("contact:create", frame)
	raw, err := p.c.client.CreateContact(ctx, frame)
	p.c.DumpResponse("contact:create", raw, err)
	if err != nil {
		return mapEPPErr(err)
	}
	if _, err := parseResponse(raw, "contact:create", nil, nil); err != nil {
		mapped := mapEPPErr(err)
		// Swallow ErrConflict — contact sudah ada (safe untuk re-register flow).
		if errors.Is(mapped, provider.ErrConflict) {
			return nil
		}
		return mapped
	}
	return nil
}

// GetContact — EPP contact:info. Return typed contact data.
//
// `id` di sini adalah web builder internal contact_id (uint64), yang kita
// map ke NIC handle via contactHandleFromID (deterministic). Caller yang
// pakai EPP direct mode HARUS store contact_id yang di-generate/derive di
// web builder side (bukan yang di-generate registrar).
func (p *EPPDirectProvider) GetContact(ctx context.Context, id uint64) (*provider.Contact, error) {
	if id == 0 {
		return nil, fmt.Errorf("%w: contact_id kosong", provider.ErrValidation)
	}
	return p.getContactByHandle(ctx, contactHandleFromID(id))
}

// getContactByHandle — helper internal: query contact:info dengan handle string.
func (p *EPPDirectProvider) getContactByHandle(ctx context.Context, handle string) (*provider.Contact, error) {
	p.c.connMu.Lock()
	defer p.c.connMu.Unlock()
	defer p.c.endCommand()
	if err := p.c.ensureConnected(ctx); err != nil {
		return nil, mapEPPErr(err)
	}

	frame := &frames.ContactInfoType{}
	frame.SetContact(handle)

	p.c.DumpRequest("contact:info", frame, "handle", handle)
	raw, err := p.c.client.InfoContact(ctx, frame)
	p.c.DumpResponse("contact:info", raw, err, "handle", handle)
	if err != nil {
		return nil, mapEPPErr(err)
	}
	resp, err := parseResponse(raw, "contact:info", &frames.ContactInfoDataType{}, nil)
	if err != nil {
		return nil, mapEPPErr(err)
	}
	data := resp.ResultData.(*frames.ContactInfoDataType).InfoData

	// Ambil postal international (fallback ke local kalau tidak ada).
	var postal *frames.PostalInfo
	for i := range data.PostalInfo {
		if data.PostalInfo[i].Type == frames.PostalInfoInternational {
			postal = &data.PostalInfo[i]
			break
		}
	}
	if postal == nil && len(data.PostalInfo) > 0 {
		postal = &data.PostalInfo[0]
	}

	out := &provider.Contact{
		Email: data.Email,
	}
	if data.Voice != nil {
		out.Phone = data.Voice.Value
	}
	if postal != nil {
		out.Name = postal.Name
		var addrLines []string
		for _, s := range postal.Address.Street {
			if s != "" && s != "(no address)" {
				addrLines = append(addrLines, s)
			}
		}
		if len(addrLines) > 0 {
			out.Address = strings.Join(addrLines, "\n")
		}
		out.City = postal.Address.City
		out.State = postal.Address.StateProvince
		out.PostalCode = postal.Address.PostalCode
		out.CountryCode = postal.Address.CountryCode
	}
	return out, nil
}

// UpdateContactByID — EPP contact:update. Semua field replace via <chg>.
// Status add/rem TIDAK di-touch (registry preserve).
func (p *EPPDirectProvider) UpdateContactByID(ctx context.Context, id uint64, req provider.UpdateContactRequest) (*provider.UpdateContactResponse, error) {
	if id == 0 {
		return nil, fmt.Errorf("%w: contact_id kosong", provider.ErrValidation)
	}
	handle := contactHandleFromID(id)
	return p.updateContactByHandle(ctx, handle, "", req)
}

// UpdateDomainContact — resolve registrant handle dari domain:info dulu,
// lalu contact:update pada handle-nya.
func (p *EPPDirectProvider) UpdateDomainContact(ctx context.Context, name string, req provider.UpdateContactRequest) (*provider.UpdateContactResponse, error) {
	info, err := p.InfoDomain(ctx, name)
	if err != nil {
		return nil, err
	}
	if info.Registrant == "" {
		return nil, fmt.Errorf("%w: domain tidak punya registrant handle", provider.ErrNotFound)
	}
	return p.updateContactByHandle(ctx, info.Registrant, strings.ToLower(name), req)
}

// updateContactByHandle — shared implementation. `domain` opsional (untuk
// response context). Return `Message` mirror pola PANDI wrapper ("DB + EPP
// registry" success message).
func (p *EPPDirectProvider) updateContactByHandle(ctx context.Context, handle, domain string, req provider.UpdateContactRequest) (*provider.UpdateContactResponse, error) {
	if req.Name == "" || req.Email == "" {
		return nil, fmt.Errorf("%w: name + email wajib", provider.ErrValidation)
	}

	p.c.connMu.Lock()
	defer p.c.connMu.Unlock()
	defer p.c.endCommand()
	if err := p.c.ensureConnected(ctx); err != nil {
		return nil, mapEPPErr(err)
	}

	frame := &frames.ContactUpdateType{}
	frame.SetContactID(handle)
	frame.ChangeEmail(req.Email)
	frame.ChangeVoice(frames.E164Type{Value: normalizePhoneE164(req.Phone)})

	countryCode := req.CountryCode
	if countryCode == "" {
		countryCode = "ID"
	}
	// Sanitize ASCII — mirror ensureContact (defense-in-depth untuk EPP
	// PostalInfo type="int" yang wajib ASCII).
	sanitizedName, nameChanged := sanitizeASCII(req.Name)
	sanitizedAddr, addrChanged := sanitizeASCII(req.Address)
	sanitizedCity, cityChanged := sanitizeASCII(req.City)
	sanitizedState, stateChanged := sanitizeASCII(req.State)
	if nameChanged || addrChanged || cityChanged || stateChanged {
		slog.Warn("contact:update — field non-ASCII di-sanitize",
			"handle", handle,
			"domain", domain,
			"name_changed", nameChanged,
			"address_changed", addrChanged,
			"city_changed", cityChanged,
			"state_changed", stateChanged,
		)
	}
	frame.ChangePostalInfo(frames.PostalInfo{
		Name: sanitizedName,
		Type: frames.PostalInfoInternational,
		Address: frames.Address{
			Street:        streetLines(sanitizedAddr),
			City:          sanitizedCity,
			StateProvince: sanitizedState,
			PostalCode:    req.PostalCode,
			CountryCode:   countryCode,
		},
	})

	p.c.DumpRequest("contact:update", frame, "handle", handle, "domain", domain)
	raw, err := p.c.client.UpdateContact(ctx, frame)
	p.c.DumpResponse("contact:update", raw, err, "handle", handle, "domain", domain)
	if err != nil {
		return nil, mapEPPErr(err)
	}
	if _, err := parseResponse(raw, "contact:update", nil, nil); err != nil {
		return nil, mapEPPErr(err)
	}

	return &provider.UpdateContactResponse{
		Domain:    domain,
		ContactID: idFromContactHandle(handle),
		NicHandle: handle,
		Name:      req.Name,
		Email:     req.Email,
		Phone:     req.Phone,
		Message:   "contact updated (EPP registry — synchronous)",
	}, nil
}

// --- Contact-specific helpers ---

// streetLines — split user address multi-line ke slice yang RFC-compliant
// (max 3 lines). EPP city+countryCode wajib; street formally opsional tapi
// PANDI biasanya reject empty — kita fallback `(no address)`.
func streetLines(address string) []string {
	lines := []string{}
	if a := strings.TrimSpace(address); a != "" {
		parts := strings.Split(a, "\n")
		for _, part := range parts {
			part = strings.TrimSpace(part)
			if part != "" {
				lines = append(lines, part)
			}
			if len(lines) >= 3 {
				break
			}
		}
	}
	if len(lines) == 0 {
		lines = []string{"(no address)"}
	}
	return lines
}

// normalizePhoneE164 — format per RFC 5733 §2.5: "+CC.NUMBER" (dotted).
// PANDI EPP validate strict — kalau tidak titiknya, registry return 2004.
//
// Contoh:
//   "081234567890"    → "+62.81234567890"
//   "6281234567890"   → "+62.81234567890"
//   "+6281234567890"  → "+62.81234567890"
//   "+62.81234567890" → "+62.81234567890" (unchanged)
//   "+1 555 1234"     → "+1.5551234" (country code 1)
//
// Registry Indonesia-only → default country code 62 kalau input national.
func normalizePhoneE164(phone string) string {
	// Strip whitespace, dash, paren, dan karakter non-digit selain "+".
	p := strings.TrimSpace(phone)
	if p == "" {
		return ""
	}
	// Kalau sudah dotted (contains "."), assume operator provide E164 valid.
	// Cukup normalize whitespace/dash saja.
	cleaned := stripPhoneChars(p)
	if strings.Contains(cleaned, ".") {
		return cleaned
	}
	// Extract digits saja + track apakah ada "+" prefix.
	hasPlus := strings.HasPrefix(cleaned, "+")
	digits := onlyDigits(cleaned)
	if digits == "" {
		return ""
	}
	// Kalau ada prefix "+", digit awal adalah country code. Deteksi CC:
	// Indonesia = "62", 2 digit. Country code lain kita coba 1-3 digit
	// pertama — untuk MVP hardcode "62" karena registry ID-only.
	if hasPlus {
		if strings.HasPrefix(digits, "62") {
			return "+62." + digits[2:]
		}
		// Non-62 country: assume 1-3 digit CC. Simple heuristic: 1 digit
		// (US=1) kalau starts with "1", else 2-3 digit — biarkan operator
		// input dengan format eksplisit dot.
		if strings.HasPrefix(digits, "1") {
			return "+1." + digits[1:]
		}
		// Fallback: assume 2-digit CC (majority of world) — bukan ideal
		// tapi cukup untuk edge case.
		if len(digits) > 2 {
			return "+" + digits[:2] + "." + digits[2:]
		}
		return "+" + digits
	}
	// Tidak ada "+": treat sebagai national ID number. "0812..." → "+62.812..."
	// "6281..." → "+62.81...".
	if strings.HasPrefix(digits, "0") {
		return "+62." + digits[1:]
	}
	if strings.HasPrefix(digits, "62") {
		return "+62." + digits[2:]
	}
	return "+62." + digits
}

// stripPhoneChars — buang whitespace, dash, paren, tapi keep +, ., digit.
func stripPhoneChars(s string) string {
	out := make([]byte, 0, len(s))
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c == '+' && i == 0:
			out = append(out, c)
		case c == '.', c >= '0' && c <= '9':
			out = append(out, c)
		}
	}
	return string(out)
}

// onlyDigits — extract 0-9 saja.
func onlyDigits(s string) string {
	out := make([]byte, 0, len(s))
	for i := 0; i < len(s); i++ {
		if s[i] >= '0' && s[i] <= '9' {
			out = append(out, s[i])
		}
	}
	return string(out)
}

// defaultAuthInfo — random-ish password untuk contact:create authInfo.
// PANDI biasanya tidak enforce, tapi field required per RFC.
// Kalau butuh security, generate crypto/rand di production. MVP: derived
// dari handle supaya deterministic per contact (idempotent re-create).
func defaultAuthInfo(handle string) string {
	return handle + "-authinfo"
}

// sanitizeASCII — konversi string ke ASCII-safe untuk EPP PostalInfo
// type="int" (RFC 5733 §2.6). Return (sanitized, changed).
//
// Transformasi (deterministic, no external library):
//   - Smart quotes "" '' → straight " '
//   - Em-dash — (U+2014) / en-dash – (U+2013) → "-"
//   - Non-breaking space (U+00A0) → regular space
//   - Ellipsis … (U+2026) → "..."
//   - Latin accent (é ñ ü ç dsb.) → NFD decompose + strip combining marks
//     fallback: huruf dasar (é → e)
//   - Karakter non-ASCII lain yang tak dikenal → drop (silent)
//
// Trade-off: lossy transliteration lebih baik daripada reject karena
// invoice sudah paid. Log warn di call-site supaya ops tahu field apa
// yang berubah — bisa minta user perbaiki profil untuk kiriman berikutnya.
func sanitizeASCII(s string) (string, bool) {
	if s == "" {
		return "", false
	}
	// Fast path: kalau sudah pure ASCII, return as-is.
	allASCII := true
	for _, r := range s {
		if r > 0x7E || r < 0x20 {
			allASCII = false
			break
		}
	}
	if allASCII {
		return s, false
	}

	var b strings.Builder
	b.Grow(len(s))
	for _, r := range s {
		switch {
		case r >= 0x20 && r <= 0x7E:
			b.WriteRune(r)
		case r == '–' || r == '—': // en/em dash → -
			b.WriteByte('-')
		case r == '‘' || r == '’' || r == '‚' || r == '′': // smart single quotes → '
			b.WriteByte('\'')
		case r == '“' || r == '”' || r == '„' || r == '″': // smart double quotes → "
			b.WriteByte('"')
		case r == ' ': // nbsp → space
			b.WriteByte(' ')
		case r == '…': // ellipsis → ...
			b.WriteString("...")
		case r == '«' || r == '»': // guillemets → "
			b.WriteByte('"')
		case r == '•' || r == '·': // bullet → *
			b.WriteByte('*')
		default:
			if ascii, ok := asciiFoldMap[r]; ok {
				b.WriteString(ascii)
			}
			// Unknown non-ASCII → drop silently.
		}
	}
	out := strings.TrimSpace(b.String())
	return out, out != s
}

// asciiFoldMap — Latin-1/Latin Extended-A folding ke ASCII dasar.
// Cukup untuk nama/alamat Indonesia yang kadang punya aksen Belanda/Portugis
// peninggalan kolonial (é, ü, ç, ñ) atau kebijakan transliterasi daerah.
var asciiFoldMap = map[rune]string{
	// Vowels
	'À': "A", 'Á': "A", 'Â': "A", 'Ã': "A", 'Ä': "A", 'Å': "A", 'Ā': "A", 'Ă': "A", 'Ą': "A",
	'à': "a", 'á': "a", 'â': "a", 'ã': "a", 'ä': "a", 'å': "a", 'ā': "a", 'ă': "a", 'ą': "a",
	'È': "E", 'É': "E", 'Ê': "E", 'Ë': "E", 'Ē': "E", 'Ĕ': "E", 'Ė': "E", 'Ę': "E", 'Ě': "E",
	'è': "e", 'é': "e", 'ê': "e", 'ë': "e", 'ē': "e", 'ĕ': "e", 'ė': "e", 'ę': "e", 'ě': "e",
	'Ì': "I", 'Í': "I", 'Î': "I", 'Ï': "I", 'Ī': "I", 'Ĭ': "I", 'Į': "I", 'İ': "I",
	'ì': "i", 'í': "i", 'î': "i", 'ï': "i", 'ī': "i", 'ĭ': "i", 'į': "i", 'ı': "i",
	'Ò': "O", 'Ó': "O", 'Ô': "O", 'Õ': "O", 'Ö': "O", 'Ø': "O", 'Ō': "O", 'Ŏ': "O", 'Ő': "O",
	'ò': "o", 'ó': "o", 'ô': "o", 'õ': "o", 'ö': "o", 'ø': "o", 'ō': "o", 'ŏ': "o", 'ő': "o",
	'Ù': "U", 'Ú': "U", 'Û': "U", 'Ü': "U", 'Ū': "U", 'Ŭ': "U", 'Ů': "U", 'Ű': "U", 'Ų': "U",
	'ù': "u", 'ú': "u", 'û': "u", 'ü': "u", 'ū': "u", 'ŭ': "u", 'ů': "u", 'ű': "u", 'ų': "u",
	'Ý': "Y", 'Ÿ': "Y", 'ý': "y", 'ÿ': "y",
	// Consonants
	'Ç': "C", 'Ć': "C", 'Č': "C", 'ç': "c", 'ć': "c", 'č': "c",
	'Ď': "D", 'Đ': "D", 'ď': "d", 'đ': "d",
	'Ğ': "G", 'ğ': "g",
	'Ĥ': "H", 'ĥ': "h",
	'Ĵ': "J", 'ĵ': "j",
	'Ķ': "K", 'ķ': "k",
	'Ĺ': "L", 'Ļ': "L", 'Ľ': "L", 'Ł': "L", 'ĺ': "l", 'ļ': "l", 'ľ': "l", 'ł': "l",
	'Ń': "N", 'Ņ': "N", 'Ň': "N", 'Ñ': "N", 'ń': "n", 'ņ': "n", 'ň': "n", 'ñ': "n",
	'Ŕ': "R", 'Ř': "R", 'ŕ': "r", 'ř': "r",
	'Ś': "S", 'Š': "S", 'Ş': "S", 'ś': "s", 'š': "s", 'ş': "s", 'ß': "ss",
	'Ţ': "T", 'Ť': "T", 'ţ': "t", 'ť': "t",
	'Ź': "Z", 'Ż': "Z", 'Ž': "Z", 'ź': "z", 'ż': "z", 'ž': "z",
	// Ligatures
	'Æ': "AE", 'æ': "ae", 'Œ': "OE", 'œ': "oe",
}
