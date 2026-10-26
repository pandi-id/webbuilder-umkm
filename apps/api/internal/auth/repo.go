package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type User struct {
	ID              uuid.UUID
	Email           string
	PasswordHash    string // may be empty when the user only has an OAuth login
	Name            string
	Role            string // RoleAdmin | RoleReseller | RoleAgent | RoleClient
	CreatedAt       time.Time
	EmailVerifiedAt *time.Time
	OAuthGoogleSub  *string // NULL for password-only users

	// Contact / postal fields — populated later via profile edit. Consumed
	// by the domain registry integration (WHOIS + EPP contact object). All
	// default to "" so existing users don't need to backfill.
	PhoneNumber string
	Address     string
	City        string
	State       string
	PostalCode  string
	// NIK (Nomor Induk Kependudukan). Wajib untuk registrasi domain .id
	// (Kemenkominfo regulation). Kosong = user belum bisa beli .id domain.
	Nik string

	// Reseller/agent — plan-reseller-roles.md section 4.1.
	// Semua nullable/default "" — existing user aman, TIDAK butuh backfill.
	//
	// ParentResellerID   = FK ke reseller induk (WAJIB kalau Role='agent',
	//                      nil untuk role lain).
	// ResellerDisplayName = nama bisnis reseller ("PT XYZ") — muncul di
	//                      email invite ke client. Kosong = pakai Name.
	// ResellerStatus     = '' (default), 'pending_approval', 'active',
	//                      'suspended'. Hanya diisi untuk Role='reseller'.
	// ResellerTier       = pricing tier future ('basic'/'gold'/'platinum').
	ParentResellerID    *uuid.UUID
	ResellerDisplayName string
	ResellerStatus      string
	ResellerTier        string

	// RegistrarContactID — cache dari registrar's contact.id, di-populate
	// setelah first successful sync (contactsync). Nil = belum sync sekalipun
	// / user belum punya kontak di registrar side (mis. belum pernah beli
	// domain). Sekali set, dipakai direct PATCH /reseller/contacts/:id (1
	// call untuk semua domain user, tidak butuh domain aktif).
	RegistrarContactID *int64
}

// scanUserCols is the projection every SELECT below uses. Kept in sync with
// the SELECT statements so a schema-column reorder only needs one edit.
const scanUserCols = `id, email, COALESCE(password_hash, ''), name, role, created_at, email_verified_at, oauth_google_sub, phone_number, address, city, state, postal_code, nik, parent_reseller_id, reseller_display_name, reseller_status, reseller_tier, registrar_contact_id`

func scanUser(u *User) []any {
	return []any{
		&u.ID, &u.Email, &u.PasswordHash, &u.Name, &u.Role, &u.CreatedAt, &u.EmailVerifiedAt, &u.OAuthGoogleSub,
		&u.PhoneNumber, &u.Address, &u.City, &u.State, &u.PostalCode, &u.Nik,
		&u.ParentResellerID, &u.ResellerDisplayName, &u.ResellerStatus, &u.ResellerTier,
		&u.RegistrarContactID,
	}
}

type Repo struct{ pool *pgxpool.Pool }

func NewRepo(p *pgxpool.Pool) *Repo { return &Repo{pool: p} }

var ErrNotFound = errors.New("not found")
var ErrEmailTaken = errors.New("email already registered")

func (r *Repo) CreateUser(ctx context.Context, email, hash, name string) (*User, error) {
	var u User
	err := r.pool.QueryRow(ctx,
		`INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3)
		 RETURNING `+scanUserCols,
		email, hash, name,
	).Scan(scanUser(&u)...)
	if err != nil {
		// 23505 = unique_violation
		if pgErrCode(err) == "23505" {
			return nil, ErrEmailTaken
		}
		return nil, err
	}
	return &u, nil
}

func (r *Repo) GetByEmail(ctx context.Context, email string) (*User, error) {
	var u User
	err := r.pool.QueryRow(ctx,
		`SELECT `+scanUserCols+` FROM users WHERE email = $1`,
		email,
	).Scan(scanUser(&u)...)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return &u, err
}

// SetRole updates a user's role (used by EnsureAdmin bootstrap).
func (r *Repo) SetRole(ctx context.Context, userID uuid.UUID, role string) error {
	_, err := r.pool.Exec(ctx, `UPDATE users SET role = $1, updated_at = now() WHERE id = $2`, role, userID)
	return err
}

// EnsureAdmin upserts a user with role='admin'. If the email exists, the
// password stays unchanged (re-run-safe); if not, the user is created.
func (r *Repo) EnsureAdmin(ctx context.Context, email, passwordHash, name string) (*User, error) {
	if u, err := r.GetByEmail(ctx, email); err == nil {
		if u.Role != "admin" {
			if err := r.SetRole(ctx, u.ID, "admin"); err != nil {
				return nil, err
			}
			u.Role = "admin"
		}
		return u, nil
	} else if !errors.Is(err, ErrNotFound) {
		return nil, err
	}
	var u User
	err := r.pool.QueryRow(ctx, `
		INSERT INTO users (email, password_hash, name, role)
		VALUES ($1, $2, $3, 'admin')
		RETURNING `+scanUserCols,
		email, passwordHash, name).Scan(scanUser(&u)...)
	return &u, err
}

func (r *Repo) GetByID(ctx context.Context, id uuid.UUID) (*User, error) {
	var u User
	err := r.pool.QueryRow(ctx,
		`SELECT `+scanUserCols+` FROM users WHERE id = $1`,
		id,
	).Scan(scanUser(&u)...)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return &u, err
}

// ProfileUpdate captures the editable profile fields. Nil pointers = "don't
// touch this column", empty string = "clear this column". Lets the frontend
// send only the fields that actually changed without accidentally wiping
// unrelated data.
type ProfileUpdate struct {
	Name        *string
	PhoneNumber *string
	Address     *string
	City        *string
	State       *string
	PostalCode  *string
	Nik         *string
}

// UpdateProfile applies a partial update. Uses COALESCE so `NULL` params
// preserve existing values without needing dynamic SQL.
func (r *Repo) UpdateProfile(ctx context.Context, userID uuid.UUID, p ProfileUpdate) (*User, error) {
	var u User
	err := r.pool.QueryRow(ctx, `
		UPDATE users
		   SET name              = COALESCE($2, name),
		       phone_number      = COALESCE($3, phone_number),
		       address           = COALESCE($4, address),
		       city              = COALESCE($5, city),
		       state             = COALESCE($6, state),
		       postal_code       = COALESCE($7, postal_code),
		       nik               = COALESCE($8, nik),
		       updated_at        = now()
		 WHERE id = $1
		RETURNING `+scanUserCols,
		userID, p.Name, p.PhoneNumber, p.Address, p.City, p.State, p.PostalCode, p.Nik,
	).Scan(scanUser(&u)...)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return &u, err
}

// AdminUpdateEmail — ganti email user via admin override. Clear
// email_verified_at karena email baru belum terbukti milik user — user harus
// klik link verify dari email baru.
//
// Return ErrEmailTaken kalau email collision dengan user lain.
// Return ErrNotFound kalau userID tidak ada.
//
// Flow di handler:
//  1. Validate email syntax (ValidEmail)
//  2. Call method ini
//  3. Opsional: trigger send verification email ke address baru
func (r *Repo) AdminUpdateEmail(ctx context.Context, userID uuid.UUID, newEmail string) (*User, error) {
	var u User
	err := r.pool.QueryRow(ctx, `
		UPDATE users
		   SET email              = $2,
		       email_verified_at  = NULL,
		       updated_at         = now()
		 WHERE id = $1
		RETURNING `+scanUserCols,
		userID, newEmail,
	).Scan(scanUser(&u)...)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		if pgErrCode(err) == "23505" {
			return nil, ErrEmailTaken
		}
		return nil, err
	}
	return &u, nil
}

// SetRegistrarContactID cache-back id contact registrar setelah first
// successful sync via contactsync. Update idempoten — no-op kalau nilai
// sama. Pass 0 tidak diperbolehkan (guard di caller).
func (r *Repo) SetRegistrarContactID(ctx context.Context, userID uuid.UUID, contactID int64) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE users SET registrar_contact_id = $2, updated_at = now() WHERE id = $1`,
		userID, contactID,
	)
	return err
}

// UpsertGoogleUser links a Google account to an existing user (by email) or
// creates a fresh Google-only user.
//
// Behavior:
//  1. Row with same oauth_google_sub exists → return it (returning Google login).
//  2. Row with same email exists → set oauth_google_sub on it (auto-link).
//     Name is updated only if the existing name was empty (don't overwrite
//     a user-set display name with the Google profile name).
//  3. Nothing matches → INSERT with password_hash = NULL.
//
// email_verified_at is set to now() for Google users because Google already
// verified the address (`email_verified: true` from the ID token).
func (r *Repo) UpsertGoogleUser(ctx context.Context, sub, email, name string) (*User, error) {
	// 1. Existing Google user.
	{
		var u User
		err := r.pool.QueryRow(ctx,
			`SELECT `+scanUserCols+` FROM users WHERE oauth_google_sub = $1`, sub,
		).Scan(scanUser(&u)...)
		if err == nil {
			return &u, nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return nil, err
		}
	}

	// 2. Password-user with same email → link.
	{
		var u User
		err := r.pool.QueryRow(ctx, `
			UPDATE users
			   SET oauth_google_sub = $1,
			       name = CASE WHEN name = '' THEN $2 ELSE name END,
			       email_verified_at = COALESCE(email_verified_at, now()),
			       updated_at = now()
			 WHERE email = $3
			RETURNING `+scanUserCols,
			sub, name, email,
		).Scan(scanUser(&u)...)
		if err == nil {
			return &u, nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return nil, err
		}
	}

	// 3. Fresh Google-only signup.
	var u User
	err := r.pool.QueryRow(ctx, `
		INSERT INTO users (email, password_hash, name, oauth_google_sub, email_verified_at)
		VALUES ($1, NULL, $2, $3, now())
		RETURNING `+scanUserCols,
		email, name, sub,
	).Scan(scanUser(&u)...)
	if err != nil {
		// Rare race: another request created the same email between our two
		// checks. Retry linking — a second UPDATE will succeed.
		if pgErrCode(err) == "23505" {
			return r.UpsertGoogleUser(ctx, sub, email, name)
		}
		return nil, err
	}
	return &u, nil
}

// Refresh token = random 32B, stored as sha256 hash.
func GenerateRefreshToken() (raw, hash string, err error) {
	b := make([]byte, 32)
	if _, err = rand.Read(b); err != nil {
		return "", "", err
	}
	raw = hex.EncodeToString(b)
	h := sha256.Sum256([]byte(raw))
	hash = hex.EncodeToString(h[:])
	return
}

func HashRefreshToken(raw string) string {
	h := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(h[:])
}

func (r *Repo) StoreRefreshToken(ctx context.Context, userID uuid.UUID, hash string, ttl time.Duration) error {
	_, err := r.pool.Exec(ctx,
		`INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
		userID, hash, time.Now().Add(ttl),
	)
	return err
}

func (r *Repo) RotateRefreshToken(ctx context.Context, oldHash, newHash string, ttl time.Duration) (uuid.UUID, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return uuid.Nil, err
	}
	defer tx.Rollback(ctx)

	var userID uuid.UUID
	var revoked *time.Time
	var expires time.Time
	err = tx.QueryRow(ctx,
		`SELECT user_id, revoked_at, expires_at FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE`,
		oldHash,
	).Scan(&userID, &revoked, &expires)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, ErrNotFound
	}
	if err != nil {
		return uuid.Nil, err
	}
	if revoked != nil || time.Now().After(expires) {
		return uuid.Nil, ErrNotFound
	}
	if _, err := tx.Exec(ctx,
		`UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1`, oldHash,
	); err != nil {
		return uuid.Nil, err
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
		userID, newHash, time.Now().Add(ttl),
	); err != nil {
		return uuid.Nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return uuid.Nil, err
	}
	return userID, nil
}

func (r *Repo) RevokeRefreshToken(ctx context.Context, hash string) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`,
		hash,
	)
	return err
}

// --- Password reset + email verification tokens ---
//
// Both tables share a shape: opaque hex token, sha256 hash stored, single-use
// (used_at), TTL via expires_at. Keeping methods symmetric also keeps the
// handler shape symmetric.

// GenerateOpaqueToken returns a fresh (raw, sha256-hex) pair. 32 bytes = enough
// entropy that brute-forcing a single valid token is infeasible.
func GenerateOpaqueToken() (raw, hash string, err error) {
	b := make([]byte, 32)
	if _, err = rand.Read(b); err != nil {
		return "", "", err
	}
	raw = hex.EncodeToString(b)
	h := sha256.Sum256([]byte(raw))
	hash = hex.EncodeToString(h[:])
	return
}

// HashOpaqueToken hashes a token presented by the client for table lookup.
// Defined separately so call sites read clearly.
func HashOpaqueToken(raw string) string {
	h := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(h[:])
}

// StorePasswordResetToken inserts a single-use token. Caller decides TTL.
func (r *Repo) StorePasswordResetToken(ctx context.Context, userID uuid.UUID, hash string, ttl time.Duration) error {
	_, err := r.pool.Exec(ctx,
		`INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
		userID, hash, time.Now().Add(ttl),
	)
	return err
}

// ConsumePasswordResetToken validates and atomically marks a reset token used,
// then updates the user's password hash — all in one transaction so a token
// cannot be replayed if multiple resets fire concurrently.
func (r *Repo) ConsumePasswordResetToken(ctx context.Context, hash, newPasswordHash string) (uuid.UUID, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return uuid.Nil, err
	}
	defer tx.Rollback(ctx)

	var userID uuid.UUID
	var used *time.Time
	var expires time.Time
	err = tx.QueryRow(ctx,
		`SELECT user_id, used_at, expires_at FROM password_reset_tokens WHERE token_hash = $1 FOR UPDATE`,
		hash,
	).Scan(&userID, &used, &expires)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, ErrNotFound
	}
	if err != nil {
		return uuid.Nil, err
	}
	if used != nil || time.Now().After(expires) {
		return uuid.Nil, ErrNotFound
	}
	if _, err := tx.Exec(ctx,
		`UPDATE password_reset_tokens SET used_at = now() WHERE token_hash = $1`, hash,
	); err != nil {
		return uuid.Nil, err
	}
	if _, err := tx.Exec(ctx,
		`UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2`,
		newPasswordHash, userID,
	); err != nil {
		return uuid.Nil, err
	}
	// Defence-in-depth: revoke every active refresh token for this user so a
	// stolen-cookie attacker can't keep a session past a password change.
	if _, err := tx.Exec(ctx,
		`UPDATE refresh_tokens SET revoked_at = now()
		 WHERE user_id = $1 AND revoked_at IS NULL`, userID,
	); err != nil {
		return uuid.Nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return uuid.Nil, err
	}
	return userID, nil
}

// StoreEmailVerificationToken inserts a single-use verification token.
func (r *Repo) StoreEmailVerificationToken(ctx context.Context, userID uuid.UUID, hash string, ttl time.Duration) error {
	_, err := r.pool.Exec(ctx,
		`INSERT INTO email_verification_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
		userID, hash, time.Now().Add(ttl),
	)
	return err
}

// ConsumeEmailVerificationToken marks the token used and flips email_verified_at.
func (r *Repo) ConsumeEmailVerificationToken(ctx context.Context, hash string) (uuid.UUID, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return uuid.Nil, err
	}
	defer tx.Rollback(ctx)

	var userID uuid.UUID
	var used *time.Time
	var expires time.Time
	err = tx.QueryRow(ctx,
		`SELECT user_id, used_at, expires_at FROM email_verification_tokens WHERE token_hash = $1 FOR UPDATE`,
		hash,
	).Scan(&userID, &used, &expires)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, ErrNotFound
	}
	if err != nil {
		return uuid.Nil, err
	}
	if used != nil || time.Now().After(expires) {
		return uuid.Nil, ErrNotFound
	}
	if _, err := tx.Exec(ctx,
		`UPDATE email_verification_tokens SET used_at = now() WHERE token_hash = $1`, hash,
	); err != nil {
		return uuid.Nil, err
	}
	if _, err := tx.Exec(ctx,
		`UPDATE users SET email_verified_at = now(), updated_at = now()
		 WHERE id = $1 AND email_verified_at IS NULL`, userID,
	); err != nil {
		return uuid.Nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return uuid.Nil, err
	}
	return userID, nil
}

// pgErrCode extracts the SQLSTATE from a pgx error without importing pgconn at call sites.
func pgErrCode(err error) string {
	type pgErr interface{ SQLState() string }
	if e, ok := err.(pgErr); ok {
		return e.SQLState()
	}
	return ""
}
