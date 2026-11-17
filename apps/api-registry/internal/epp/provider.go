// Package epp — implementasi Provider interface via native EPP client
// (teknispandi/epp-pandi-client) langsung ke PANDI registry.
//
// Struktur file:
//
//   client.go   — connection management (TCP+TLS+login, keepalive)
//   errors.go   — EPP result code → sentinel error mapping
//   helpers.go  — utility (tldOf, contact handle format, job ID format)
//   provider.go — Provider struct + constructor + Name + Capabilities +
//                 lifecycle methods (Connect/Close/Ping)
//   domain.go   — CheckDomain / BulkCheckDomains / InfoDomain / ListDomains
//   register.go — RegisterDomain / RenewDomain / GetRegisterStatus /
//                 RetryRegister / CancelRegister
//   host.go     — GetNameservers / UpdateNameservers (dengan add/rem diff)
//   contact.go  — ensureContact / GetContact / UpdateContactByID /
//                 UpdateDomainContact
//   whois.go    — Whois via TCP:43 (real WHOIS, bukan cuma InfoDomain)
//
// Documents + invoice + NIK + pricing + zone catalog SEMUA di web builder
// (arsitektur SaaS boundary) — bukan di api-registry.
package epp

import (
	"context"

	"github.com/webbuilder/api-registry/internal/provider"
)

// EPPDirectProvider — implement provider.Provider via native EPP.
// Session di-share (single-conn per instance) — serialize commands via
// underlying Client.connMu.
type EPPDirectProvider struct {
	c *Client
}

// NewProvider — construct + wrap Client. Belum connect — call Connect(ctx)
// explicitly di main() supaya fail-fast saat startup.
func NewProvider(cfg Config) (*EPPDirectProvider, error) {
	client, err := New(cfg)
	if err != nil {
		return nil, err
	}
	return &EPPDirectProvider{c: client}, nil
}

// Connect — startup: bikin session ke EPP registry.
func (p *EPPDirectProvider) Connect(ctx context.Context) error {
	return p.c.Connect(ctx)
}

// Close — logout + close TCP session. Log file tetap open.
func (p *EPPDirectProvider) Close() error {
	return p.c.Close()
}

// Shutdown — full cleanup termasuk close log file. Dipanggil di process exit.
func (p *EPPDirectProvider) Shutdown() error {
	return p.c.Shutdown()
}

// Ping — readiness probe. Hello frame lightweight, no state change.
func (p *EPPDirectProvider) Ping(ctx context.Context) error {
	return p.c.Ping(ctx)
}

func (p *EPPDirectProvider) Name() string { return "epp_direct" }

func (p *EPPDirectProvider) Capabilities() provider.Capabilities {
	return provider.Capabilities{
		HasBulkCheck: true, // EPP domain:check native batch
		HasContact:   true, // EPP contact:*
	}
}

// Compile-time guard — kalau interface Provider berubah, build fail di sini.
var _ provider.Provider = (*EPPDirectProvider)(nil)
