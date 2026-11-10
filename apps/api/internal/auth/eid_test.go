package auth

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"
)

const eidTestCallback = "http://api.test/api/v1/auth/eid/callback"

func TestEIDPhone(t *testing.T) {
	cases := []struct{ cc, num, want string }{
		{"62", "81234567890", "+6281234567890"},
		{"62", "081234567890", "+6281234567890"},
		{"+62", "81234567890", "+6281234567890"},
		{"62", "6281234567890", "+6281234567890"},
		{"62", "+6281234567890", "+6281234567890"},
		{"", "081234567890", "081234567890"},
		{"62", "", ""},
	}
	for _, c := range cases {
		if got := eidPhone(c.cc, c.num); got != c.want {
			t.Errorf("eidPhone(%q,%q) = %q, want %q", c.cc, c.num, got, c.want)
		}
	}
}

func TestNormalizeEIDProfile(t *testing.T) {
	var raw eidProfileResp
	body := `{"email":"  Budi@Example.ID ","profile":{"fullname":"Budi Santoso","phonenumber":"81234567890",
		"countryphonecode":"62","address":"Jl. Merdeka 1","avatar":"x","tier":"2"}}`
	if err := json.Unmarshal([]byte(body), &raw); err != nil {
		t.Fatal(err)
	}
	p := normalizeEIDProfile(&raw)
	want := EIDProfile{Email: "budi@example.id", FullName: "Budi Santoso", Phone: "+6281234567890", Address: "Jl. Merdeka 1", Tier: 2}
	if p != want {
		t.Fatalf("got %+v, want %+v", p, want)
	}

	// Non-ASCII fails the EPP contact rules → dropped; a numeric tier still parses.
	raw = eidProfileResp{}
	_ = json.Unmarshal([]byte(`{"email":"a@b.id","profile":{"fullname":"Zoë","address":"Jl. Café","tier":1}}`), &raw)
	p = normalizeEIDProfile(&raw)
	if p.FullName != "" || p.Address != "" || p.Tier != 1 {
		t.Fatalf("got %+v", p)
	}
}

// fakeEID mimics the three e.id endpoints our server calls (official Postman
// collection). profile is what get-profile returns as `data`.
func fakeEID(t *testing.T, tokenStatus int, tokenMsg string, profile map[string]any) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1.1/oauth/get-token":
			var req map[string]string
			b, _ := io.ReadAll(r.Body)
			_ = json.Unmarshal(b, &req)
			if req["client_secret"] != "sec" || req["redirect_uri"] != eidTestCallback {
				w.WriteHeader(401)
				_, _ = w.Write([]byte(`{"status":false,"message":"OAUTH.INVALID_CLIENT_CREDENTIALS","data":null}`))
				return
			}
			if tokenStatus != 200 {
				w.WriteHeader(tokenStatus)
				_, _ = w.Write([]byte(`{"status":false,"message":"` + tokenMsg + `","data":null}`))
				return
			}
			_, _ = w.Write([]byte(`{"status":true,"message":"success","data":{"token_type":"Bearer","token":"tok-1","expired_date":"2030-01-01T00:00:00Z"}}`))
		case "/api/v1.1/oauth/get-profile":
			// Without email:profile e.id leaves the email out.
			if r.Header.Get("Authorization") != "Bearer tok-1" || r.URL.Query().Get("scope") != "email:profile" {
				w.WriteHeader(401)
				_, _ = w.Write([]byte(`{"status":false,"message":"UNAUTHORIZATION","data":null}`))
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"status": true, "message": "success", "data": profile})
		default:
			w.WriteHeader(404)
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

func eidProfileData(email string, tier int) map[string]any {
	return map[string]any{
		"email": email,
		"profile": map[string]any{
			"fullname": "Siti Rahma", "phonenumber": "81234567890", "countryphonecode": "62",
			"address": "Jl. Melati No. 12", "avatar": "", "tier": tier,
		},
	}
}

func eidApp(h *EIDHandler) *fiber.App {
	app := fiber.New()
	app.Get("/authorize", h.Authorize)
	app.Get("/callback", h.Callback)
	return app
}

func eidGet(t *testing.T, app *fiber.App, path, cookie string) *http.Response {
	t.Helper()
	req := httptest.NewRequest("GET", path, nil)
	if cookie != "" {
		req.Header.Set("Cookie", eidStateCookie+"="+cookie)
	}
	resp, err := app.Test(req, int((5 * time.Second).Milliseconds()))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { resp.Body.Close() })
	return resp
}

func eidErrCode(resp *http.Response) string {
	loc, _ := url.Parse(resp.Header.Get("Location"))
	return loc.Query().Get("error")
}

func TestEIDHandler_Flow(t *testing.T) {
	newApp := func(base string) *fiber.App {
		return eidApp(NewEIDHandler(nil, nil, "cid", "sec", base, eidTestCallback, "http://web.test"))
	}

	t.Run("authorize redirects to e.id verify with cookie", func(t *testing.T) {
		resp := eidGet(t, newApp("https://eid.test"), "/authorize?next=/sites/abc", "")
		loc, _ := url.Parse(resp.Header.Get("Location"))
		if resp.StatusCode != 302 || loc.Host != "eid.test" || loc.Path != "/api/v1.1/oauth/verify" {
			t.Fatalf("unexpected redirect %d %s", resp.StatusCode, loc)
		}
		if loc.Query().Get("client_id") != "cid" || loc.Query().Get("callback_url") != eidTestCallback {
			t.Fatalf("bad query %s", loc.RawQuery)
		}
		c := resp.Header.Get("Set-Cookie")
		if !strings.Contains(c, eidStateCookie) || !strings.Contains(c, "HttpOnly") ||
			(!strings.Contains(c, ".%2Fsites%2Fabc") && !strings.Contains(c, "./sites/abc")) {
			t.Fatalf("state cookie missing next or HttpOnly: %s", c)
		}
	})

	t.Run("off-site next is dropped", func(t *testing.T) {
		resp := eidGet(t, newApp("https://eid.test"), "/authorize?next=//evil.example/x", "")
		if c := resp.Header.Get("Set-Cookie"); strings.Contains(c, "evil") {
			t.Fatalf("open redirect kept in cookie: %s", c)
		}
	})

	t.Run("not configured", func(t *testing.T) {
		app := eidApp(NewEIDHandler(nil, nil, "", "", "https://eid.test", "x", "http://web.test"))
		if got := eidErrCode(eidGet(t, app, "/authorize", "")); got != "eid_not_configured" {
			t.Fatalf("got %q", got)
		}
	})

	// A bare link carrying someone else's code must not log this browser in.
	t.Run("callback without cookie", func(t *testing.T) {
		if got := eidErrCode(eidGet(t, newApp("https://eid.test"), "/callback?code=x", "")); got != "eid_state_mismatch" {
			t.Fatalf("got %q", got)
		}
	})

	t.Run("state echoed by e.id must match", func(t *testing.T) {
		if got := eidErrCode(eidGet(t, newApp("https://eid.test"), "/callback?code=x&state=other", "abc./dashboard")); got != "eid_state_mismatch" {
			t.Fatalf("got %q", got)
		}
	})

	t.Run("callback without code = cancelled, keeps next", func(t *testing.T) {
		resp := eidGet(t, newApp("https://eid.test"), "/callback", "abc./sites/1")
		loc, _ := url.Parse(resp.Header.Get("Location"))
		if loc.Query().Get("error") != "eid_cancelled" || loc.Query().Get("next") != "/sites/1" {
			t.Fatalf("got %s", loc)
		}
	})

	t.Run("expired code", func(t *testing.T) {
		srv := fakeEID(t, 400, "OAUTH.INVALID_OR_EXPIRED_CODE", nil)
		if got := eidErrCode(eidGet(t, newApp(srv.URL), "/callback?code=x", "abc./dashboard")); got != "eid_code_expired" {
			t.Fatalf("got %q", got)
		}
	})

	t.Run("bad client credentials", func(t *testing.T) {
		srv := fakeEID(t, 200, "", nil)
		app := eidApp(NewEIDHandler(nil, nil, "cid", "wrong", srv.URL, eidTestCallback, "http://web.test"))
		if got := eidErrCode(eidGet(t, app, "/callback?code=x", "abc./dashboard")); got != "eid_exchange_failed" {
			t.Fatalf("got %q", got)
		}
	})

	t.Run("profile without email", func(t *testing.T) {
		srv := fakeEID(t, 200, "", map[string]any{"email": "", "profile": map[string]any{"fullname": "X", "tier": 1}})
		if got := eidErrCode(eidGet(t, newApp(srv.URL), "/callback?code=x", "abc./dashboard")); got != "eid_no_email" {
			t.Fatalf("got %q", got)
		}
	})
}

func TestProvidersHandler(t *testing.T) {
	app := fiber.New()
	app.Get("/p", ProvidersHandler(nil, NewEIDHandler(nil, nil, "cid", "sec", "https://eid.test", "x", "y")))
	resp, err := app.Test(httptest.NewRequest("GET", "/p", nil))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var env struct {
		Data map[string]bool `json:"data"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&env)
	if env.Data["google"] || !env.Data["eid"] {
		t.Fatalf("providers = %v, want google off, eid on", env.Data)
	}
}
