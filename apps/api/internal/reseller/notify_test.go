package reseller

import (
	"context"
	"strings"
	"testing"

	"github.com/webbuilder/api/internal/auth"
	"github.com/webbuilder/api/internal/mail"
)

// captureSender records what would have been sent.
type captureSender struct {
	sent []mail.Message
	err  error
}

func (c *captureSender) Send(_ context.Context, m mail.Message) error {
	c.sent = append(c.sent, m)
	return c.err
}
func (c *captureSender) Driver() string { return "capture" }

// An existing user gets told they are now managed by someone — the add-client
// flow attaches them silently otherwise.
func TestSendClientLinkedEmail(t *testing.T) {
	sender := &captureSender{}
	h := &Handler{mailer: sender, appBaseURL: "https://app.test"}

	h.sendClientLinkedEmail(
		&auth.User{Name: "Budi", ResellerDisplayName: "Toko Reseller"},
		"klien@example.com", "Ani",
	)

	if len(sender.sent) != 1 {
		t.Fatalf("sent %d messages, want 1", len(sender.sent))
	}
	m := sender.sent[0]
	if m.To != "klien@example.com" {
		t.Errorf("To = %q", m.To)
	}
	// The business name identifies who to contact if this is unexpected.
	if !strings.Contains(m.Subject, "Toko Reseller") {
		t.Errorf("Subject = %q, want it to name the manager", m.Subject)
	}
	if !strings.Contains(m.Body, "Ani") {
		t.Errorf("Body does not greet the recipient: %q", m.Body)
	}
	if !strings.Contains(m.Body, "https://app.test") {
		t.Error("Body must point at the app so they can log in and check")
	}
	// It must not read like an invitation: there is nothing to accept.
	if strings.Contains(m.Body, "/invite/") {
		t.Error("Body contains an invite link; the assignment is already made")
	}
	if !strings.Contains(m.Body, "password Anda tidak berubah") {
		t.Error("Body should reassure that the existing password still works")
	}
}

// Falls back to the personal name when no business name is set.
func TestSendClientLinkedEmail_FallsBackToPersonalName(t *testing.T) {
	sender := &captureSender{}
	h := &Handler{mailer: sender, appBaseURL: "https://app.test"}

	h.sendClientLinkedEmail(&auth.User{Name: "Budi"}, "klien@example.com", "Ani")

	if len(sender.sent) != 1 {
		t.Fatalf("sent %d messages, want 1", len(sender.sent))
	}
	if !strings.Contains(sender.sent[0].Subject, "Budi") {
		t.Errorf("Subject = %q, want the personal name", sender.sent[0].Subject)
	}
}

// No mailer configured must be a no-op, never a panic — the caller runs it in
// a goroutine where a panic would take the process down.
func TestSendClientLinkedEmail_NilMailerIsSafe(t *testing.T) {
	h := &Handler{appBaseURL: "https://app.test"}
	h.sendClientLinkedEmail(&auth.User{Name: "Budi"}, "klien@example.com", "Ani")
}
