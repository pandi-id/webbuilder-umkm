package epp

import (
	"context"
	"fmt"
	"strings"

	"github.com/teknispandi/epp-pandi-client/v2/frames"
	"github.com/webbuilder/api-registry/internal/provider"
)

// CheckDomain — EPP domain:check (single FQDN). SLD-only tidak di-support
// karena EPP tidak ada mekanisme zone expansion; caller layer web builder
// yang expand via zone catalog + call kita per zone kalau perlu.
func (p *EPPDirectProvider) CheckDomain(ctx context.Context, req provider.CheckRequest) (*provider.CheckResponse, error) {
	domain := strings.ToLower(strings.TrimSpace(req.Domain))
	if domain == "" {
		return nil, fmt.Errorf("%w: domain kosong", provider.ErrValidation)
	}
	if !strings.Contains(domain, ".") {
		return nil, fmt.Errorf("%w: domain harus full FQDN (mis. myshop.id) — SLD expand lakukan di layer web builder", provider.ErrValidation)
	}

	p.c.connMu.Lock()
	defer p.c.connMu.Unlock()
	defer p.c.endCommand()
	if err := p.c.ensureConnected(ctx); err != nil {
		return nil, mapEPPErr(err)
	}

	frame := &frames.DomainCheckType{}
	frame.SetMultiDomain([]string{domain})

	p.c.DumpRequest("domain:check", frame, "domain", domain)
	raw, err := p.c.client.CheckDomain(ctx, frame)
	p.c.DumpResponse("domain:check", raw, err, "domain", domain)
	if err != nil {
		return nil, mapEPPErr(err)
	}
	resp, err := parseResponse(raw, "domain:check", &frames.DomainChekDataType{}, nil)
	if err != nil {
		return nil, mapEPPErr(err)
	}
	data := resp.ResultData.(*frames.DomainChekDataType).CheckData

	out := &provider.CheckResponse{
		Query:        req.Domain,
		AllowedZones: []string{tldOf(domain)},
		Results:      make([]provider.CheckEntry, 0, len(data.CheckDomain)),
	}
	for _, cd := range data.CheckDomain {
		out.Results = append(out.Results, provider.CheckEntry{
			Domain:    strings.ToLower(cd.Name.Value),
			TLD:       tldOf(cd.Name.Value),
			Available: cd.Name.Available,
			Reason:    cd.Reason,
			// Price + Zone kosong — EPP tidak return harga.
			// Web builder enrich dari platform_prices lokal.
		})
	}
	return out, nil
}

// BulkCheckDomains — EPP native batch. PANDI cap 15 domain per check.
// 1 round-trip untuk semua nama — jauh lebih efisien dari loop CheckDomain.
func (p *EPPDirectProvider) BulkCheckDomains(ctx context.Context, req provider.BulkCheckRequest) (*provider.BulkCheckResponse, error) {
	if len(req.Domains) == 0 {
		return nil, fmt.Errorf("%w: domains kosong", provider.ErrValidation)
	}
	if len(req.Domains) > 15 {
		return nil, fmt.Errorf("%w: max 15 domain per EPP batch check", provider.ErrValidation)
	}

	normalized := make([]string, 0, len(req.Domains))
	for _, d := range req.Domains {
		d = strings.ToLower(strings.TrimSpace(d))
		if d == "" || !strings.Contains(d, ".") {
			return nil, fmt.Errorf("%w: domain '%s' bukan FQDN", provider.ErrValidation, d)
		}
		normalized = append(normalized, d)
	}

	p.c.connMu.Lock()
	defer p.c.connMu.Unlock()
	defer p.c.endCommand()
	if err := p.c.ensureConnected(ctx); err != nil {
		return nil, mapEPPErr(err)
	}

	frame := &frames.DomainCheckType{}
	frame.SetMultiDomain(normalized)

	p.c.DumpRequest("domain:check", frame, "domains", normalized)
	raw, err := p.c.client.CheckDomain(ctx, frame)
	p.c.DumpResponse("domain:check", raw, err, "domains", normalized)
	if err != nil {
		return nil, mapEPPErr(err)
	}
	resp, err := parseResponse(raw, "domain:check", &frames.DomainChekDataType{}, nil)
	if err != nil {
		return nil, mapEPPErr(err)
	}
	data := resp.ResultData.(*frames.DomainChekDataType).CheckData

	out := &provider.BulkCheckResponse{Results: make([]provider.CheckEntry, 0, len(data.CheckDomain))}
	for _, cd := range data.CheckDomain {
		out.Results = append(out.Results, provider.CheckEntry{
			Domain:    strings.ToLower(cd.Name.Value),
			TLD:       tldOf(cd.Name.Value),
			Available: cd.Name.Available,
			Reason:    cd.Reason,
		})
	}
	return out, nil
}

// InfoDomain — EPP domain:info. Return status list + nameservers + dates.
func (p *EPPDirectProvider) InfoDomain(ctx context.Context, name string) (*provider.DomainInfo, error) {
	p.c.connMu.Lock()
	defer p.c.connMu.Unlock()
	defer p.c.endCommand()
	if err := p.c.ensureConnected(ctx); err != nil {
		return nil, mapEPPErr(err)
	}

	frame := &frames.DomainInfoType{}
	frame.SetDomain(strings.ToLower(name))
	p.c.DumpRequest("domain:info", frame, "domain", name)
	raw, err := p.c.client.InfoDomain(ctx, frame)
	p.c.DumpResponse("domain:info", raw, err, "domain", name)
	if err != nil {
		return nil, mapEPPErr(err)
	}
	resp, err := parseResponse(raw, "domain:info", &frames.DomainInfoDataType{}, nil)
	if err != nil {
		return nil, mapEPPErr(err)
	}
	data := resp.ResultData.(*frames.DomainInfoDataType).InfoData

	statuses := make([]string, 0, len(data.Status))
	for _, s := range data.Status {
		statuses = append(statuses, string(s.DomainStatusType))
	}
	nameservers := []string{}
	if data.NameServer != nil {
		nameservers = append(nameservers, data.NameServer.HostObject...)
	}

	out := &provider.DomainInfo{
		Domain:      data.Name,
		Status:      statuses,
		Registrant:  data.Registrant,
		Nameservers: nameservers,
	}
	if data.CreateDate != nil {
		out.CreatedAt = *data.CreateDate
	}
	if data.UpdateDate != nil {
		out.UpdatedAt = *data.UpdateDate
	}
	if data.ExpireDate != nil {
		out.ExpiresAt = *data.ExpireDate
	}
	return out, nil
}

// ListDomains — EPP standard tidak expose bulk "list all my domains".
// Registry biasanya via extension (PANDI belum expose ini). Konsumer harus
// pakai cache lokal di web builder (domain_purchases table).
func (p *EPPDirectProvider) ListDomains(ctx context.Context, f provider.ListDomainsFilter) (*provider.DomainListResponse, error) {
	return nil, fmt.Errorf("%w: EPP standard tidak expose list-my-domains — pakai web builder domain_purchases cache", provider.ErrCapabilityMissing)
}
