package epp

import (
	"regexp"
	"strings"
	"testing"

	eppclient "github.com/teknispandi/epp-pandi-client/v2/epp"
	"github.com/webbuilder/api-registry/internal/provider"
)

// v2 validates every frame before sending and rejects domain:create without
// authInfo. v1 silently omitted it, so a regression here means every domain
// registration fails before reaching the registry.
func TestBuildDomainCreate_PassesV2ValidationAndCarriesAuthInfo(t *testing.T) {
	req := provider.RegisterRequest{
		Domain:      "TokoSaya.ID",
		Years:       2,
		Nameservers: []string{"ns1.example.id", "ns2.example.id"},
	}
	frame, err := buildDomainCreate(req, "WB1A2B3C")
	if err != nil {
		t.Fatalf("buildDomainCreate: %v", err)
	}
	if err := frame.Validate(); err != nil {
		t.Fatalf("v2 Validate rejected the frame: %v", err)
	}

	raw, err := eppclient.Encode(frame, eppclient.ClientXMLAttributes())
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	xml := string(raw)
	for _, want := range []string{
		"<domain:name>tokosaya.id</domain:name>",
		`<domain:period unit="y">2</domain:period>`,
		"<domain:registrant>WB1A2B3C</domain:registrant>",
		`<domain:contact type="admin">WB1A2B3C</domain:contact>`,
		`<domain:contact type="tech">WB1A2B3C</domain:contact>`,
		`<domain:contact type="billing">WB1A2B3C</domain:contact>`,
		"<domain:hostObj>ns1.example.id</domain:hostObj>",
	} {
		if !strings.Contains(xml, want) {
			t.Errorf("domain:create XML missing %s\n%s", want, xml)
		}
	}
	if !regexp.MustCompile(`<domain:authInfo>\s*<domain:pw>[^<]{16}</domain:pw>`).MatchString(xml) {
		t.Errorf("domain:create XML has no 16-char authInfo:\n%s", xml)
	}
}

// Without nameservers the <domain:ns> element must be left out entirely —
// an empty one is schema-invalid and v2 Validate would reject it.
func TestBuildDomainCreate_NoNameservers(t *testing.T) {
	frame, err := buildDomainCreate(provider.RegisterRequest{Domain: "a.id", Years: 1}, "WBX")
	if err != nil {
		t.Fatal(err)
	}
	if err := frame.Validate(); err != nil {
		t.Fatalf("Validate: %v", err)
	}
	raw, _ := eppclient.Encode(frame, eppclient.ClientXMLAttributes())
	if strings.Contains(string(raw), "domain:ns") {
		t.Errorf("empty <domain:ns> emitted:\n%s", raw)
	}
}

// authInfo guards domain transfers: it must be unpredictable, not derived
// from the domain, and meet the usual complexity policy.
func TestNewDomainAuthInfo(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 200; i++ {
		pw, err := newDomainAuthInfo()
		if err != nil {
			t.Fatal(err)
		}
		if len(pw) != authInfoLen {
			t.Fatalf("len = %d, want %d", len(pw), authInfoLen)
		}
		for name, set := range map[string]string{
			"lower": authInfoLower, "upper": authInfoUpper, "digit": authInfoDigits, "symbol": authInfoSymbols,
		} {
			if !strings.ContainsAny(pw, set) {
				t.Fatalf("%q has no %s character", pw, name)
			}
		}
		if strings.ContainsAny(pw, `<>&"'`) {
			t.Fatalf("%q contains an XML-special character", pw)
		}
		if seen[pw] {
			t.Fatalf("duplicate authInfo %q", pw)
		}
		seen[pw] = true
	}
}
