package epp

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/teknispandi/epp-pandi-client/v2/frames"
	"github.com/webbuilder/api-registry/internal/provider"
)

// RegisterDomain — EPP domain:create. Prerequisite: registrant contact
// sudah ada di registry (via CreateContact terpisah). Kalau caller belum
// bikin contact, kita bikin on-demand pakai data dari req.Contact +
// deterministic handle dari req.ExternalUserID.
//
// Contact role: registrant = admin = tech = billing (reseller pattern
// single-contact yang PANDI accept).
func (p *EPPDirectProvider) RegisterDomain(ctx context.Context, req provider.RegisterRequest) (*provider.RegisterResponse, error) {
	if req.Domain == "" || req.Years < 1 || req.ExternalUserID == "" {
		return nil, fmt.Errorf("%w: domain/years/external_user_id wajib", provider.ErrValidation)
	}

	// Derive contact handle dari external user ID — reusable antar-domain
	// utk user yang sama (contact:create idempotent kalau ID sudah ada).
	registrantHandle, err := deriveHandleFromExternalID(req.ExternalUserID)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", provider.ErrValidation, err)
	}

	// Ensure contact exists — best-effort create; kalau EPP return 2302
	// (exists), skip (idempotent).
	if err := p.ensureContact(ctx, registrantHandle, req.Contact); err != nil {
		return nil, err
	}

	p.c.connMu.Lock()
	defer p.c.connMu.Unlock()
	defer p.c.endCommand()
	if err := p.c.ensureConnected(ctx); err != nil {
		return nil, mapEPPErr(err)
	}

	frame, err := buildDomainCreate(req, registrantHandle)
	if err != nil {
		return nil, err
	}

	p.c.DumpRequest("domain:create", frame, "domain", req.Domain, "years", req.Years)
	raw, err := p.c.client.CreateDomain(ctx, frame)
	p.c.DumpResponse("domain:create", raw, err, "domain", req.Domain)
	if err != nil {
		return nil, mapEPPErr(err)
	}
	resp, err := parseResponse(raw, "domain:create", &frames.DomainCreateDataType{}, nil)
	if err != nil {
		return nil, mapEPPErr(err)
	}
	data := resp.ResultData.(*frames.DomainCreateDataType).CreateData

	return &provider.RegisterResponse{
		JobID:  jobIDForRegister(data.Name, data.CreateDate.Format("20060102150405")),
		Status: "active", // EPP register sync — langsung aktif di registry
	}, nil
}

// buildDomainCreate — the domain:create frame. authInfo is mandatory in
// epp-pandi-client v2 (domain-1.0.xsd createType); v1 omitted it. It guards
// transfers, so it is random per domain and never derived from the name.
func buildDomainCreate(req provider.RegisterRequest, registrantHandle string) (*frames.DomainCreateType, error) {
	authInfo, err := newDomainAuthInfo()
	if err != nil {
		return nil, fmt.Errorf("epp: generate authInfo: %w", err)
	}
	frame := &frames.DomainCreateType{}
	frame.SetDomain(strings.ToLower(req.Domain))
	frame.SetPeriod(frames.Period{Value: req.Years, Unit: frames.PeriodUnitYear})
	frame.SetRegistrant(registrantHandle)
	frame.SetAuthInfo(authInfo)
	for _, role := range []frames.ContactType{frames.ContactTypeAdmin, frames.ContactTypeTech, frames.ContactTypeBilling} {
		frame.AddContact(frames.Contact{Name: registrantHandle, Type: role})
	}
	for _, ns := range req.Nameservers {
		frame.AddHostObj(ns)
	}
	return frame, nil
}

// RenewDomain — EPP domain:renew. Butuh curExpDate untuk safety check
// (cegah accidental double-renew). Fetch dulu via domain:info.
func (p *EPPDirectProvider) RenewDomain(ctx context.Context, name string, req provider.RenewRequest) (*provider.RegisterResponse, error) {
	if name == "" || req.Years < 1 {
		return nil, fmt.Errorf("%w: domain/years wajib", provider.ErrValidation)
	}

	// Info dulu untuk fetch curExpDate.
	info, err := p.InfoDomain(ctx, name)
	if err != nil {
		return nil, err
	}
	if info.ExpiresAt.IsZero() {
		return nil, fmt.Errorf("%w: domain tidak punya exDate — tidak bisa renew", provider.ErrValidation)
	}

	p.c.connMu.Lock()
	defer p.c.connMu.Unlock()
	defer p.c.endCommand()
	if err := p.c.ensureConnected(ctx); err != nil {
		return nil, mapEPPErr(err)
	}

	frame := &frames.DomainRenewType{}
	frame.SetDomain(strings.ToLower(name))
	frame.SetExpDate(info.ExpiresAt)
	frame.SetPeriod(frames.Period{Value: req.Years, Unit: frames.PeriodUnitYear})

	p.c.DumpRequest("domain:renew", frame, "domain", name, "years", req.Years)
	raw, err := p.c.client.RenewDomain(ctx, frame)
	p.c.DumpResponse("domain:renew", raw, err, "domain", name)
	if err != nil {
		return nil, mapEPPErr(err)
	}
	resp, err := parseResponse(raw, "domain:renew", &frames.DomainRenewDataType{}, nil)
	if err != nil {
		return nil, mapEPPErr(err)
	}
	data := resp.ResultData.(*frames.DomainRenewDataType).RenewData

	return &provider.RegisterResponse{
		JobID:  jobIDForRenew(data.Name, data.ExpireDate.Format("20060102150405")),
		Status: "active",
	}, nil
}

// GetRegisterStatus — EPP sync operation, tidak ada async job.
// Return status current via domain:info based on JobID → domain extraction.
func (p *EPPDirectProvider) GetRegisterStatus(ctx context.Context, jobID string) (*provider.RegisterStatus, error) {
	domain := extractDomainFromJobID(jobID)
	if domain == "" {
		return nil, fmt.Errorf("%w: jobID format tidak valid (harus 'epp_<domain>_<ts>')", provider.ErrValidation)
	}
	info, err := p.InfoDomain(ctx, domain)
	if err != nil {
		return nil, err
	}
	return &provider.RegisterStatus{
		JobID:     jobID,
		Domain:    info.Domain,
		Status:    "active",
		ExpiresAt: info.ExpiresAt.Format(time.RFC3339),
	}, nil
}

// RetryRegister — EPP sync, no async retry. Consumer harus re-call
// RegisterDomain dengan idempotency key baru (PANDI EPP idempotent by
// object identity — kalau domain sudah exist, return 2302 conflict).
func (p *EPPDirectProvider) RetryRegister(ctx context.Context, jobID string) (*provider.RegisterStatus, error) {
	return nil, fmt.Errorf("%w: EPP sync — retry via re-call POST /domains/register", provider.ErrCapabilityMissing)
}

// CancelRegister — EPP sync, tidak ada pending job untuk di-cancel.
func (p *EPPDirectProvider) CancelRegister(ctx context.Context, jobID string) error {
	return fmt.Errorf("%w: EPP sync — no pending job to cancel", provider.ErrCapabilityMissing)
}
