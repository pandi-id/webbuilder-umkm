package notifier

import (
	"context"
	"log/slog"
	"time"

	"github.com/webbuilder/api/internal/mail"
)

// SiteMemberNotifier emails someone when a site owner grants them access.
// Separate from the invitation mails: there is nothing to accept here, the
// access is already live, so the message points at the site instead of a link
// to click.
type SiteMemberNotifier struct {
	mailer     mail.Sender
	appBaseURL string
}

func NewSiteMemberNotifier(m mail.Sender, appBaseURL string) *SiteMemberNotifier {
	return &SiteMemberNotifier{mailer: m, appBaseURL: appBaseURL}
}

var roleLabel = map[string]string{
	"editor": "Editor — dapat mengubah isi dan mempublikasikan situs",
	"viewer": "Viewer — hanya dapat melihat situs dan statistiknya",
}

func (n *SiteMemberNotifier) NotifySiteAccessGranted(ctx context.Context, to, toName, siteName, ownerName, role string) {
	if n == nil || n.mailer == nil {
		return
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	if toName == "" {
		toName = to
	}
	if ownerName == "" {
		ownerName = "Pemilik situs"
	}
	access := roleLabel[role]
	if access == "" {
		access = role
	}

	subject := "Anda diberi akses ke situs " + siteName
	body := "Halo " + toName + ",\n\n" +
		ownerName + " memberi Anda akses ke situs \"" + siteName + "\" di Web Builder.\n\n" +
		"Peran Anda: " + access + "\n\n" +
		"Situs ini akan muncul di daftar \"Situs yang saya kelola\" setelah Anda login di " +
		n.appBaseURL + "\n\n" +
		"Kalau Anda merasa tidak seharusnya menerima akses ini, balas email ini supaya kami tinjau.\n\n" +
		"Best regards,\nTim Web Builder"

	if err := n.mailer.Send(ctx, mail.Message{To: to, Subject: subject, Body: body}); err != nil {
		slog.Warn("site member notify failed", "to", to, "err", err)
	}
}
