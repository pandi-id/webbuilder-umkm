package openapi

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

type spec struct {
	OpenAPI string                          `json:"openapi"`
	Info    map[string]any                  `json:"info"`
	Servers []map[string]any                `json:"servers"`
	Paths   map[string]map[string]operation `json:"paths"`
	Comp    struct {
		SecuritySchemes map[string]any `json:"securitySchemes"`
		Schemas         map[string]any `json:"schemas"`
		Responses       map[string]any `json:"responses"`
	} `json:"components"`
}

type operation struct {
	Tags        []string         `json:"tags"`
	Summary     string           `json:"summary"`
	OperationID string           `json:"operationId"`
	Security    []map[string]any `json:"security"`
	Responses   map[string]any   `json:"responses"`
	Parameters  []struct {
		Name     string `json:"name"`
		In       string `json:"in"`
		Required bool   `json:"required"`
	} `json:"parameters"`
}

func load(t *testing.T) spec {
	t.Helper()
	var s spec
	if err := json.Unmarshal(Spec, &s); err != nil {
		t.Fatalf("spec.json is not valid JSON: %v", err)
	}
	return s
}

func TestSpec_Valid(t *testing.T) {
	s := load(t)
	if s.OpenAPI != "3.1.0" {
		t.Errorf("openapi = %q, want 3.1.0", s.OpenAPI)
	}
	if len(s.Paths) == 0 {
		t.Fatal("no paths")
	}
	if _, ok := s.Comp.SecuritySchemes["bearerAuth"]; !ok {
		t.Error("missing bearerAuth security scheme")
	}
	for _, name := range []string{"Envelope", "Error", "Paginated"} {
		if _, ok := s.Comp.Schemas[name]; !ok {
			t.Errorf("missing shared schema %q", name)
		}
	}
}

// Every operation must be identifiable and answer with something.
func TestSpec_OperationsWellFormed(t *testing.T) {
	s := load(t)
	seen := map[string]string{}
	for path, methods := range s.Paths {
		for method, op := range methods {
			where := method + " " + path
			if op.Summary == "" {
				t.Errorf("%s: empty summary", where)
			}
			if len(op.Tags) == 0 {
				t.Errorf("%s: no tag", where)
			}
			if len(op.Responses) == 0 {
				t.Errorf("%s: no responses", where)
			}
			if prev, dup := seen[op.OperationID]; dup {
				t.Errorf("duplicate operationId %q: %s and %s", op.OperationID, prev, where)
			}
			seen[op.OperationID] = where
			// Path templates must be declared as parameters, or tooling breaks.
			for _, name := range regexp.MustCompile(`\{(\w+)\}`).FindAllStringSubmatch(path, -1) {
				found := false
				for _, p := range op.Parameters {
					if p.In == "path" && p.Name == name[1] {
						found = true
					}
				}
				if !found {
					t.Errorf("%s: path param %q not declared", where, name[1])
				}
			}
		}
	}
}

// Auth is the thing most easily got wrong, so assert it both ways.
func TestSpec_SecurityMatchesTier(t *testing.T) {
	s := load(t)
	for path, methods := range s.Paths {
		authFree := strings.HasPrefix(path, "/public") ||
			strings.HasPrefix(path, "/api/v1/auth/") ||
			strings.HasPrefix(path, "/api/v1/invitations/") ||
			strings.HasPrefix(path, "/webhooks") ||
			strings.HasPrefix(path, "/internal") ||
			!strings.HasPrefix(path, "/api/v1")
		for method, op := range methods {
			has := len(op.Security) > 0
			if authFree && has {
				t.Errorf("%s %s: requires auth but sits on an unauthenticated tier", method, path)
			}
			if !authFree && !has {
				t.Errorf("%s %s: is behind JWT but declares no security", method, path)
			}
		}
	}
}

// ---- Drift guard ----

var routeRe = regexp.MustCompile(`\b(app|v1|authed|pubBase)\.(Get|Post|Patch|Put|Delete)\(\s*"([^"]*)"`)

var groupPrefix = map[string]string{
	"app": "", "v1": "/api/v1", "authed": "/api/v1", "pubBase": "/public",
}

// routesFromSource reads the router sources rather than booting the app: many
// handlers are nil-guarded, so a Deps{} router would silently register fewer
// routes and the guard would pass while the spec was incomplete.
func routesFromSource(t *testing.T) map[string]bool {
	t.Helper()
	out := map[string]bool{}
	for _, name := range []string{"global.go", "user.go"} {
		raw, err := os.ReadFile(filepath.Join("..", "router", name))
		if err != nil {
			t.Fatalf("read router/%s: %v", name, err)
		}
		for _, m := range routeRe.FindAllStringSubmatch(string(raw), -1) {
			path := groupPrefix[m[1]] + m[3]
			path = regexp.MustCompile(`//+`).ReplaceAllString(path, "/")
			if path != "/" {
				path = strings.TrimSuffix(path, "/")
			}
			// :param -> {param}, matching OpenAPI templating.
			path = regexp.MustCompile(`:(\w+)`).ReplaceAllString(path, "{$1}")
			out[strings.ToUpper(m[2])+" "+path] = true
		}
	}
	if len(out) < 100 {
		t.Fatalf("only %d routes parsed — the extractor is probably stale", len(out))
	}
	return out
}

func specOperations(s spec) map[string]bool {
	out := map[string]bool{}
	for path, methods := range s.Paths {
		for method := range methods {
			out[strings.ToUpper(method)+" "+path] = true
		}
	}
	return out
}

// A route added to the router without a spec entry fails here. This is what
// keeps a hand-written spec honest.
func TestSpec_CoversEveryRoute(t *testing.T) {
	routes := routesFromSource(t)
	documented := specOperations(load(t))

	var undocumented []string
	for r := range routes {
		if !documented[r] {
			undocumented = append(undocumented, r)
		}
	}
	sort.Strings(undocumented)
	for _, r := range undocumented {
		t.Errorf("route not in spec.json: %s", r)
	}
}

// And the reverse: a spec entry for a route that no longer exists is a lie.
func TestSpec_HasNoPhantomRoutes(t *testing.T) {
	routes := routesFromSource(t)
	var phantom []string
	for op := range specOperations(load(t)) {
		if !routes[op] {
			phantom = append(phantom, op)
		}
	}
	sort.Strings(phantom)
	for _, op := range phantom {
		t.Errorf("spec documents a route that no longer exists: %s", op)
	}
}

// Admin is out of scope by design — catch it being added by accident.
func TestSpec_ExcludesAdmin(t *testing.T) {
	for path := range load(t).Paths {
		if strings.HasPrefix(path, "/api/v1/admin") {
			t.Errorf("admin route in spec: %s (admin is deliberately undocumented)", path)
		}
	}
}

func TestSpec_CoreEndpointsDetailed(t *testing.T) {
	s := load(t)
	// These carry real request/response schemas, not just the envelope.
	for _, want := range []string{
		"/api/v1/auth/login", "/api/v1/auth/register", "/api/v1/auth/me",
		"/api/v1/sites", "/api/v1/products/{id}",
		"/public/site-by-host", "/public/sites/{id}/products",
		"/public/sites/{id}/orders", "/api/v1/domains/purchase",
	} {
		if _, ok := s.Paths[want]; !ok {
			t.Errorf("core endpoint missing from spec: %s", want)
		}
	}
	// Money-moving endpoints must advertise the idempotency header.
	for _, p := range []string{"/api/v1/domains/purchase", "/api/v1/domains/{name}/renew"} {
		op, ok := s.Paths[p]["post"]
		if !ok {
			t.Errorf("%s: no POST operation", p)
			continue
		}
		found := false
		for _, param := range op.Parameters {
			if param.In == "header" && param.Name == "Idempotency-Key" && param.Required {
				found = true
			}
		}
		if !found {
			t.Errorf("%s: Idempotency-Key must be documented as a required header", p)
		}
	}
}
