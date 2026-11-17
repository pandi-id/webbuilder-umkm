package epp

import (
	"context"
	"fmt"
	"strings"

	"github.com/teknispandi/epp-pandi-client/v2/frames"
	"github.com/webbuilder/api-registry/internal/provider"
)

// GetNameservers — derive dari domain:info (satu round-trip).
func (p *EPPDirectProvider) GetNameservers(ctx context.Context, name string) (*provider.NameserverInfo, error) {
	info, err := p.InfoDomain(ctx, name)
	if err != nil {
		return nil, err
	}
	return &provider.NameserverInfo{
		Domain:      strings.ToLower(name),
		Nameservers: info.Nameservers,
	}, nil
}

// UpdateNameservers — EPP domain:update dengan add/rem NS diff.
// EPP tidak accept "replace all" — kita hitung diff current vs desired,
// kirim add+rem block. Kalau tidak ada perubahan, no-op return current.
//
// Nameserver di-passing sebagai hostObj (name-only, bukan hostAttr
// dengan IP inline). Registrar biasanya sudah punya host record — kalau
// belum, PANDI reject dengan code 2303 → caller harus create host dulu
// atau pakai hostAttr flow.
func (p *EPPDirectProvider) UpdateNameservers(ctx context.Context, name string, ns []string) (*provider.NameserverInfo, error) {
	// Normalize + dedup dulu, baru validasi count — cegah user pass
	// ["NS1", "ns1"] lolos min-2 tapi collapse jadi 1 setelah dedup.
	nextSet := setOf(ns)
	deduped := make([]string, 0, len(nextSet))
	for n := range nextSet {
		deduped = append(deduped, n)
	}
	if len(deduped) < 2 {
		return nil, fmt.Errorf("%w: min 2 nameserver unik (redundancy)", provider.ErrValidation)
	}
	if len(deduped) > 13 {
		return nil, fmt.Errorf("%w: max 13 nameserver per RFC 5731", provider.ErrValidation)
	}

	// Fetch current state.
	current, err := p.GetNameservers(ctx, name)
	if err != nil {
		return nil, err
	}
	curSet := setOf(current.Nameservers)

	toAdd := make([]string, 0)
	toRem := make([]string, 0)
	for n := range nextSet {
		if !curSet[n] {
			toAdd = append(toAdd, n)
		}
	}
	for n := range curSet {
		if !nextSet[n] {
			toRem = append(toRem, n)
		}
	}
	// No-op — no diff, return current.
	if len(toAdd) == 0 && len(toRem) == 0 {
		return current, nil
	}

	p.c.connMu.Lock()
	defer p.c.connMu.Unlock()
	defer p.c.endCommand()
	if err := p.c.ensureConnected(ctx); err != nil {
		return nil, mapEPPErr(err)
	}

	frame := &frames.DomainUpdateType{}
	frame.SetDomain(strings.ToLower(name))
	if len(toAdd) > 0 {
		frame.AddData(frames.DomainAddRemove{
			NameServer: &frames.NameServer{HostObject: toAdd},
		})
	}
	if len(toRem) > 0 {
		frame.RemoveData(frames.DomainAddRemove{
			NameServer: &frames.NameServer{HostObject: toRem},
		})
	}

	p.c.DumpRequest("domain:update", frame, "domain", name, "add", toAdd, "remove", toRem)
	raw, err := p.c.client.UpdateDomain(ctx, frame)
	p.c.DumpResponse("domain:update", raw, err, "domain", name)
	if err != nil {
		return nil, mapEPPErr(err)
	}
	// domain:update return no resData — cuma result code. parseResponse
	// akan return error kalau code >= 2000.
	if _, err := parseResponse(raw, "domain:update", nil, nil); err != nil {
		return nil, mapEPPErr(err)
	}

	// Return desired state — pakai deduped supaya reflect apa yang beneran
	// dikirim ke EPP (client-input mungkin punya case-duplicate).
	return &provider.NameserverInfo{
		Domain:      strings.ToLower(name),
		Nameservers: deduped,
	}, nil
}
