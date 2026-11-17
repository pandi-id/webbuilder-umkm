package auth

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const providerEID = "eid"

// ErrEIDEmailUnverified — e.id has not verified the email (tier 0), and
// trusting it would open an account someone else already uses.
var ErrEIDEmailUnverified = errors.New("e.id email is not verified")

// EIDProfile — e.id profile after normalizeEIDProfile. An empty field means
// e.id did not send it or it failed the contact rules.
type EIDProfile struct {
	Email    string
	FullName string
	Phone    string
	Address  string
	Tier     int
}

// UpsertEIDUser — login and sign-up in one. Order: linked e.id identity →
// user with the same email (linked) → new password-less user. Name/phone/
// address only fill empty columns, so contact data the user typed survives.
//
// Every tier may sign in (product decision), but tier 0 means e.id
// has not verified the email, so a tier-0 identity is not trusted with an
// account that has another way in:
//   - it never links to an existing user by email (that user would be taken
//     over by whoever registered their address at e.id), and
//   - an account it created stops accepting it once the account gets a
//     password or Google login — the real owner reclaiming the address via
//     password reset must lock the squatter out.
func (r *Repo) UpsertEIDUser(ctx context.Context, p EIDProfile) (*User, error) {
	u, err := r.upsertEIDUser(ctx, p)
	// Two concurrent first logins for one email: the loser hits a unique
	// violation, and the retry finds the winner's row.
	if pgErrCode(err) == "23505" {
		return r.upsertEIDUser(ctx, p)
	}
	return u, err
}

func (r *Repo) upsertEIDUser(ctx context.Context, p EIDProfile) (*User, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	verified := p.Tier >= 1
	var userID uuid.UUID
	err = tx.QueryRow(ctx,
		`SELECT user_id FROM user_identities WHERE provider = $1 AND subject = $2`,
		providerEID, p.Email,
	).Scan(&userID)
	switch {
	case err == nil:
		if !verified {
			var otherLogin bool
			if err := tx.QueryRow(ctx,
				`SELECT COALESCE(password_hash, '') <> '' OR oauth_google_sub IS NOT NULL
				   FROM users WHERE id = $1`, userID,
			).Scan(&otherLogin); err != nil {
				return nil, err
			}
			if otherLogin {
				return nil, ErrEIDEmailUnverified
			}
		}
	case errors.Is(err, pgx.ErrNoRows):
		err = tx.QueryRow(ctx, `SELECT id FROM users WHERE email = $1`, p.Email).Scan(&userID)
		switch {
		case err == nil && !verified:
			return nil, ErrEIDEmailUnverified
		case errors.Is(err, pgx.ErrNoRows):
			err = tx.QueryRow(ctx,
				`INSERT INTO users (email, password_hash, name) VALUES ($1, NULL, '') RETURNING id`,
				p.Email,
			).Scan(&userID)
		}
		if err != nil {
			return nil, err
		}
		if _, err = tx.Exec(ctx, `
			INSERT INTO user_identities (user_id, provider, subject, email, tier)
			VALUES ($1, $2, $3, $3, $4)`,
			userID, providerEID, p.Email, p.Tier,
		); err != nil {
			return nil, err
		}
	default:
		return nil, err
	}

	var u User
	// Tier >= 1 = e.id verified the email/phone; tier 0 may still sign in, its
	// email just isn't marked verified.
	err = tx.QueryRow(ctx, `
		UPDATE users SET
			name         = CASE WHEN name = ''         THEN $2 ELSE name END,
			phone_number = CASE WHEN phone_number = '' THEN $3 ELSE phone_number END,
			address      = CASE WHEN address = ''      THEN $4 ELSE address END,
			email_verified_at = CASE WHEN email_verified_at IS NULL AND $5 >= 1
			                         THEN now() ELSE email_verified_at END,
			updated_at   = now()
		WHERE id = $1
		RETURNING `+scanUserCols,
		userID, p.FullName, p.Phone, p.Address, p.Tier,
	).Scan(scanUser(&u)...)
	if err != nil {
		return nil, err
	}
	if _, err = tx.Exec(ctx, `
		UPDATE user_identities SET tier = $3, last_login_at = now(), updated_at = now()
		WHERE provider = $1 AND subject = $2`,
		providerEID, p.Email, p.Tier,
	); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &u, nil
}

// HasLoginExpr is a SQL boolean: can the user row aliased `alias` sign in by
// themselves — password, Google, or an SSO identity such as e.id? Every "is
// this still a placeholder account?" check must use it: a set-password invite
// sent to an account that already logs in hands it to whoever sent the invite.
func HasLoginExpr(alias string) string {
	return fmt.Sprintf(`(COALESCE(%[1]s.password_hash, '') <> ''
		OR %[1]s.oauth_google_sub IS NOT NULL
		OR EXISTS (SELECT 1 FROM user_identities ui WHERE ui.user_id = %[1]s.id))`, alias)
}

// HasLogin reports whether the user can already sign in by themselves.
func (r *Repo) HasLogin(ctx context.Context, userID uuid.UUID) (bool, error) {
	var ok bool
	err := r.pool.QueryRow(ctx,
		`SELECT `+HasLoginExpr("users")+` FROM users WHERE id = $1`, userID,
	).Scan(&ok)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, ErrNotFound
	}
	return ok, err
}
