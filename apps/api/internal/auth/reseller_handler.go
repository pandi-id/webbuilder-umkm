package auth

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"

	"github.com/webbuilder/api/internal/httpx"
	"github.com/webbuilder/api/internal/mail"
)

// resellerApplyReq — body untuk POST /auth/reseller/apply.
// Anonymous endpoint — siapapun bisa apply, admin review + approve.
type resellerApplyReq struct {
	Email               string `json:"email"`
	Password            string `json:"password"`
	Name                string `json:"name"`                  // nama PIC contact
	ResellerDisplayName string `json:"reseller_display_name"` // nama bisnis
	PhoneNumber         string `json:"phone_number"`
	Address             string `json:"address"`
	City                string `json:"city"`
	State               string `json:"state"`
	PostalCode          string `json:"postal_code"`
	Nik                 string `json:"nik,omitempty"` // opsional
}

func (r *resellerApplyReq) validate() error {
	r.Email = strings.ToLower(strings.TrimSpace(r.Email))
	r.Name = strings.TrimSpace(r.Name)
	r.ResellerDisplayName = strings.TrimSpace(r.ResellerDisplayName)
	r.PhoneNumber = strings.TrimSpace(r.PhoneNumber)
	r.Address = strings.TrimSpace(r.Address)
	r.City = strings.TrimSpace(r.City)
	r.State = strings.TrimSpace(r.State)
	r.PostalCode = strings.TrimSpace(r.PostalCode)
	if !ValidEmail(r.Email) {
		return errors.New("format email tidak valid")
	}
	if len(r.Password) < 8 {
		return errors.New("password minimal 8 karakter")
	}
	if r.Name == "" {
		return errors.New("nama PIC wajib diisi")
	}
	if !IsASCIIPrintable(r.Name) {
		return errors.New("nama hanya boleh huruf/angka standar (tanpa aksen atau emoji)")
	}
	if r.ResellerDisplayName == "" {
		return errors.New("nama bisnis wajib diisi")
	}
	// Contact/postal wajib untuk EPP contact + WHOIS (nanti dipakai saat
	// register domain first-time). Cegah reseller yang belum lengkap
	// profil trigger flow beli domain lalu gagal di tengah.
	if r.PhoneNumber == "" {
		return errors.New("nomor HP wajib diisi")
	}
	if !ValidPhone(r.PhoneNumber) {
		return errors.New("nomor HP minimal 7 digit (contoh: +62 812 3456 7890)")
	}
	if r.Address == "" {
		return errors.New("alamat wajib diisi")
	}
	if !IsASCIIPrintable(r.Address) {
		return errors.New("alamat hanya boleh karakter ASCII (tanpa aksen atau emoji)")
	}
	if r.City == "" {
		return errors.New("kota wajib diisi")
	}
	if !IsASCIIPrintable(r.City) {
		return errors.New("nama kota hanya boleh karakter ASCII")
	}
	if r.State != "" && !IsASCIIPrintable(r.State) {
		return errors.New("nama provinsi hanya boleh karakter ASCII")
	}
	if r.PostalCode == "" {
		return errors.New("kode pos wajib diisi")
	}
	if !ValidPostalCode(r.PostalCode) {
		return errors.New("kode pos harus 4-10 digit angka")
	}
	return nil
}

// ResellerApply — POST /api/v1/auth/reseller/apply (anonymous).
//
// Bikin user baru dengan role='reseller' + reseller_status='pending_approval'.
// User TIDAK bisa login sampai admin approve (login handler cek status).
// Sengaja tidak issue JWT di response — supaya semantic jelas "menunggu approval".
//
// Rate limit: dilakukan di router layer (RateLimitIP loginPerWindow).
func (h *Handler) ResellerApply(c *fiber.Ctx) error {
	var req resellerApplyReq
	if err := c.BodyParser(&req); err != nil {
		return httpx.BadRequest(c, "invalid json")
	}
	if err := req.validate(); err != nil {
		return httpx.BadRequest(c, err.Error())
	}

	hash, err := HashPassword(req.Password)
	if err != nil {
		return httpx.Internal(c, "hash error")
	}

	u, err := h.repo.CreateResellerApplication(c.Context(), ResellerApplication{
		Email:               req.Email,
		PasswordHash:        hash,
		Name:                req.Name,
		ResellerDisplayName: req.ResellerDisplayName,
		PhoneNumber:         req.PhoneNumber,
		Address:             req.Address,
		City:                req.City,
		State:               req.State,
		PostalCode:          req.PostalCode,
		Nik:                 req.Nik,
	})
	if errors.Is(err, ErrEmailTaken) {
		return httpx.Conflict(c, "email sudah terdaftar")
	}
	if err != nil {
		return httpx.Internal(c, "create failed")
	}

	// Fire-and-forget notif ke admin platform + acknowledgment email ke applicant.
	go h.notifyResellerApplication(u)

	return httpx.Created(c, fiber.Map{
		"message":         "Aplikasi diterima. Admin akan review + email notifikasi begitu disetujui.",
		"reseller_id":     u.ID.String(),
		"reseller_status": u.ResellerStatus,
	})
}

// notifyResellerApplication — kirim email ke applicant (acknowledge) + admin
// notif (kalau ADMIN_EMAIL config). Fail-silent — mail server issue tidak
// boleh block signup.
func (h *Handler) notifyResellerApplication(u *User) {
	if h.mailer == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	// Ack ke applicant
	ackBody := "Halo " + u.Name + ",\n\n" +
		"Terima kasih sudah daftar sebagai reseller Web Builder.\n" +
		"Nama bisnis: " + u.ResellerDisplayName + "\n\n" +
		"Aplikasi Anda sedang di-review admin. Kami akan email begitu approve.\n" +
		"SLA review: 1-2 hari kerja.\n\n" +
		"Best regards,\nTim Web Builder"
	if err := h.mailer.Send(ctx, mail.Message{
		To:      u.Email,
		Subject: "Aplikasi Reseller Web Builder Diterima",
		Body:    ackBody,
	}); err != nil {
		slog.Warn("reseller apply: ack email failed", "email", u.Email, "err", err)
	}
}

// AllowLoginForRole — helper untuk block login kalau reseller status != active.
// Return non-nil error message (fiber-friendly) kalau tidak boleh login.
// Pisahkan dari Login handler supaya gampang test.
// LoginLockedError — the credentials were fine but the account may not hold a
// session (suspended by an admin, or a reseller not yet approved). Typed so
// every entry point maps it to the same 403 code instead of a 500.
type LoginLockedError struct {
	Code string // "account_suspended" | "role_locked"
	Msg  string
}

func (e *LoginLockedError) Error() string { return e.Msg }

// AllowLoginForRole is the single gate for minting a session. It runs inside
// MintTokensFor (register, password login, invitation accept, Google) and in
// Refresh — a check placed only in the password login left the other doors open.
func AllowLoginForRole(u *User) error {
	if u == nil {
		return nil // handler lain akan handle nil case
	}
	if u.SuspendedAt != nil {
		return &LoginLockedError{Code: "account_suspended",
			Msg: "Akun Anda dinonaktifkan oleh admin. Hubungi admin platform kalau menurut Anda ini keliru."}
	}
	if u.Role == RoleReseller {
		switch u.ResellerStatus {
		case ResellerStatusActive:
			return nil
		case ResellerStatusPending:
			return roleLocked("Akun reseller Anda masih menunggu approval admin. Kami akan email begitu approved.")
		case ResellerStatusSuspended:
			return roleLocked("Akun reseller Anda di-suspend. Contact admin platform untuk info lebih lanjut.")
		default:
			return roleLocked("Status akun reseller tidak valid. Contact admin.")
		}
	}
	return nil
}

func roleLocked(msg string) error { return &LoginLockedError{Code: "role_locked", Msg: msg} }
