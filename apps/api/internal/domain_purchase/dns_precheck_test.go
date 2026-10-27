package domain_purchase

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gofiber/fiber/v2"
)

// A failed precheck must stop the handler. Before the fix, callers checked the
// (always nil) write error and went on with a nil Cloudflare client, which
// panicked and leaked "runtime error: invalid memory address" to the UI.
func TestDNSHandlers_CloudflareDisabled_NoPanic(t *testing.T) {
	h := &Handler{} // cloudflare repo not configured
	routes := map[string]fiber.Handler{
		"/user/info/:name":  h.CloudflareInfo,
		"/admin/info/:name": h.AdminCloudflareInfo,
		"/admin/dns/:name":  h.AdminListDNSRecords,
	}
	for path, handler := range routes {
		app := fiber.New()
		app.Get(path, handler)
		url := path[:len(path)-len(":name")] + "toko.my.id"

		resp, err := app.Test(httptest.NewRequest(http.MethodGet, url, nil), -1)
		if err != nil {
			t.Fatalf("%s: %v", url, err)
		}
		if resp.StatusCode != fiber.StatusServiceUnavailable {
			t.Errorf("%s: status = %d, want 503", url, resp.StatusCode)
		}
		body, _ := io.ReadAll(resp.Body)
		var env struct {
			Error struct{ Code string } `json:"error"`
		}
		if err := json.Unmarshal(body, &env); err != nil || env.Error.Code != "cloudflare_disabled" {
			t.Errorf("%s: body = %s, want error.code cloudflare_disabled", url, body)
		}
	}
}
