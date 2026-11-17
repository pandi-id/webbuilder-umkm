package epp

import (
	"crypto/rand"
	"fmt"
	"math/big"
	"strings"
)

// Domain authInfo alphabet. Symbols exclude XML-special and quote characters
// so the value survives any template or log without escaping.
const (
	authInfoLower   = "abcdefghijkmnopqrstuvwxyz"
	authInfoUpper   = "ABCDEFGHJKLMNPQRSTUVWXYZ"
	authInfoDigits  = "23456789"
	authInfoSymbols = "@#%+=!"
	authInfoLen     = 16
)

// newDomainAuthInfo — random 16-char transfer password with at least one
// lower, upper, digit and symbol, which common registry policies demand.
func newDomainAuthInfo() (string, error) {
	pick := func(set string) (byte, error) {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(set))))
		if err != nil {
			return 0, err
		}
		return set[n.Int64()], nil
	}
	all := authInfoLower + authInfoUpper + authInfoDigits + authInfoSymbols
	out := make([]byte, 0, authInfoLen)
	for _, set := range []string{authInfoLower, authInfoUpper, authInfoDigits, authInfoSymbols} {
		b, err := pick(set)
		if err != nil {
			return "", err
		}
		out = append(out, b)
	}
	for len(out) < authInfoLen {
		b, err := pick(all)
		if err != nil {
			return "", err
		}
		out = append(out, b)
	}
	// Fisher–Yates so the guaranteed classes are not always up front.
	for i := len(out) - 1; i > 0; i-- {
		j, err := rand.Int(rand.Reader, big.NewInt(int64(i+1)))
		if err != nil {
			return "", err
		}
		out[i], out[j.Int64()] = out[j.Int64()], out[i]
	}
	return string(out), nil
}

// tldOf — extract TLD (label setelah dot pertama). "myshop.co.id" → "co.id".
func tldOf(domain string) string {
	i := strings.Index(domain, ".")
	if i < 0 {
		return ""
	}
	return domain[i+1:]
}

// setOf — build set for O(1) membership check saat diff-ing NS list.
// Normalize: lowercase + trim whitespace + strip trailing dot.
//
// Trailing dot critical: EPP registry (PANDI) stores host object sebagai
// `candra.ns.example.id` (tanpa dot). Kalau caller kirim DNS wire-format
// form (`candra.ns.example.id.`), string comparison miss → registry balik
// 2303 "object does not exist" padahal host-nya ada. Strip dulu sebelum
// hit domain:update frame.
func setOf(items []string) map[string]bool {
	m := make(map[string]bool, len(items))
	for _, s := range items {
		s = strings.ToLower(strings.TrimSpace(s))
		s = strings.TrimSuffix(s, ".")
		if s == "" {
			continue
		}
		m[s] = true
	}
	return m
}

// joinStatuses — comma-join EPP status list untuk WHOIS status field.
func joinStatuses(s []string) string {
	if len(s) == 0 {
		return "unknown"
	}
	return strings.Join(s, ",")
}

// contactHandleFromID — konversi web builder internal contact ID (uint64)
// ke NIC handle EPP. Format: "WB{16-char-hex}" fits typical PANDI 16-char
// max ID rule + selalu valid (alphanumeric).
//
// Deterministic + bidirectional (idFromContactHandle di bawah).
func contactHandleFromID(id uint64) string {
	return fmt.Sprintf("WB%014x", id)
}

// idFromContactHandle — reverse mapping. Return 0 kalau handle bukan
// format WB{hex} kita.
func idFromContactHandle(handle string) uint64 {
	if !strings.HasPrefix(handle, "WB") || len(handle) != 16 {
		return 0
	}
	var id uint64
	_, err := fmt.Sscanf(handle[2:], "%x", &id)
	if err != nil {
		return 0
	}
	return id
}

// jobIDForRegister — deterministic ID untuk register operation, embed
// domain + timestamp. Format: `epp_<domain-slugged>_<yyyymmddhhmmss>`.
func jobIDForRegister(domain, ts string) string {
	return "epp_" + strings.ReplaceAll(domain, ".", "_") + "_" + ts
}

// jobIDForRenew — variant renew job.
func jobIDForRenew(domain, ts string) string {
	return "epp_renew_" + strings.ReplaceAll(domain, ".", "_") + "_" + ts
}

// extractDomainFromJobID — parse `epp_<domain>_<ts>` atau
// `epp_renew_<domain>_<ts>` → return domain. Underscore di domain jadi dot.
func extractDomainFromJobID(jobID string) string {
	if !strings.HasPrefix(jobID, "epp_") {
		return ""
	}
	rest := strings.TrimPrefix(jobID, "epp_")
	rest = strings.TrimPrefix(rest, "renew_")
	// Last underscore + 14 digit = timestamp → strip.
	if idx := strings.LastIndex(rest, "_"); idx > 0 && len(rest)-idx-1 == 14 {
		rest = rest[:idx]
	}
	return strings.ReplaceAll(rest, "_", ".")
}
