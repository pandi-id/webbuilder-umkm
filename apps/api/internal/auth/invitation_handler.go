package auth

import (
	"errors"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/webbuilder/api/internal/httpx"
)

// GetInvitation — GET /api/v1/invitations/:token (anonymous).
// Return meta invitation supaya frontend bisa show welcome screen dengan
// nama inviter + email target sebelum user set password.
//
// Kalau token invalid/expired/accepted → 404 (opak, no info leak).
func (h *Handler) GetInvitation(c *fiber.Ctx) error {
	token := strings.TrimSpace(c.Params("token"))
	if token == "" {
		return httpx.BadRequest(c, "token required")
	}
	inv, err := h.repo.FindInvitationByToken(c.Context(), token)
	if errors.Is(err, ErrNotFound) {
		return httpx.NotFound(c, "undangan tidak valid atau kadaluarsa")
	}
	if err != nil {
		return httpx.Internal(c, "lookup failed")
	}
	// Lookup inviter untuk tampilkan konteks di halaman accept.
	inviter, err := h.repo.GetByID(c.Context(), inv.InvitedBy)
	if err != nil {
		return httpx.Internal(c, "inviter lookup failed")
	}
	businessName := inviter.ResellerDisplayName
	if businessName == "" {
		businessName = inviter.Name
	}

	// An invite aimed at an existing account renders a plain "accept" screen
	// instead of a signup form: that person already has a login and a name,
	// and we must not ask them to set a password again.
	existingUser, needsPassword := false, true
	invitedName := ""
	if inv.TargetUserID != nil {
		if target, err := h.repo.GetByID(c.Context(), *inv.TargetUserID); err == nil {
			hasLogin, err := h.repo.HasLogin(c.Context(), target.ID)
			if err != nil {
				return httpx.Internal(c, "invitee lookup failed")
			}
			existingUser = hasLogin
			needsPassword = !hasLogin
			invitedName = target.Name
		}
	}

	return httpx.OK(c, fiber.Map{
		"email":          inv.Email,
		"invited_role":   inv.InvitedRole,
		"inviter_name":   businessName,
		"expires_at":     inv.ExpiresAt.UTC(),
		"existing_user":  existingUser,
		"needs_password": needsPassword,
		"invited_name":   invitedName,
	})
}

// AcceptInvitation — POST /api/v1/invitations/:token/accept (anonymous).
// Body: { name, password }.
//
// Return JWT (issueTokens) supaya user langsung login setelah accept.
type acceptInvitationReq struct {
	Name     string `json:"name"`
	Password string `json:"password"`
}

func (h *Handler) AcceptInvitation(c *fiber.Ctx) error {
	token := strings.TrimSpace(c.Params("token"))
	if token == "" {
		return httpx.BadRequest(c, "token required")
	}
	var req acceptInvitationReq
	if err := c.BodyParser(&req); err != nil {
		return httpx.BadRequest(c, "invalid json")
	}
	req.Name = strings.TrimSpace(req.Name)

	// Password is optional: an existing account being promoted keeps its own.
	// Whether one is actually needed is settled inside the transaction, so a
	// blank password here is not an error on its own.
	var hash *string
	if req.Password != "" {
		if len(req.Password) < 8 {
			return httpx.BadRequest(c, "password minimal 8 karakter")
		}
		h, err := HashPassword(req.Password)
		if err != nil {
			return httpx.Internal(c, "hash error")
		}
		hash = &h
	}

	userID, _, err := h.repo.AcceptInvitationTx(c.Context(), token, hash, req.Name)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return httpx.NotFound(c, "undangan tidak valid atau kadaluarsa")
		}
		if errors.Is(err, ErrEmailTaken) {
			return httpx.Conflict(c, "email sudah terdaftar")
		}
		if errors.Is(err, ErrPasswordRequired) {
			return httpx.BadRequest(c, "password minimal 8 karakter")
		}
		if errors.Is(err, ErrNameRequired) {
			return httpx.BadRequest(c, "nama wajib diisi")
		}
		return httpx.BadRequest(c, err.Error())
	}

	// Lookup user + issue tokens supaya auto-login.
	u, err := h.repo.GetByID(c.Context(), userID)
	if err != nil {
		return httpx.Internal(c, "user lookup failed")
	}
	return h.issueTokens(c, u, fiber.StatusOK)
}
