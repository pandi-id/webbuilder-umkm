package orders

import (
	"context"
	"encoding/json"
	"io"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v2"

	"github.com/webbuilder/api/internal/sites"
)

func publicApp(t *testing.T) *fiber.App {
	t.Helper()
	r := needsDB(t)
	h := NewHandler(r, sites.NewRepo(testPool))
	app := fiber.New()
	app.Post("/public/sites/:id/orders", h.CreatePublic)
	return app
}

func post(t *testing.T, app *fiber.App, path, body string) (int, map[string]any) {
	t.Helper()
	req := httptest.NewRequest("POST", path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := io.ReadAll(resp.Body)
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("decode %s: %v", raw, err)
	}
	return resp.StatusCode, out
}

func TestHandler_CreatePublic(t *testing.T) {
	app := publicApp(t)
	ctx := context.Background()
	site := makeSite(t, ctx, "published")
	p := makeProduct(t, ctx, site, "kopi-susu", 18000, intp(2))
	path := "/public/sites/" + site.String() + "/orders"
	cust := `"customer":{"name":"Budi","phone":"0812-3456-7890","address":"Jl. Merdeka 10"}`

	code, body := post(t, app, path, `{"items":[{"slug":"kopi-susu","qty":2}],`+cust+`,"note":"","_hp":""}`)
	if code != 201 {
		t.Fatalf("create: %d %v", code, body)
	}
	data := body["data"].(map[string]any)
	order := data["order"].(map[string]any)
	if order["order_no"] != "#0001" || order["total"].(float64) != 36000 ||
		order["customer_phone"] != "6281234567890" || data["whatsapp_number"] != "6281234567890" ||
		data["store_name"] != "Toko Uji" {
		t.Errorf("response = %v", data)
	}

	code, body = post(t, app, path, `{"items":[{"slug":"kopi-susu","qty":1}],`+cust+`}`)
	errObj, _ := body["error"].(map[string]any)
	if code != 409 || errObj["code"] != "out_of_stock" || errObj["message"] != "Stok Produk kopi-susu tidak cukup (tersisa 0)." {
		t.Errorf("out of stock: %d %v", code, body)
	}

	code, body = post(t, app, path, `{"items":[{"slug":"nope","qty":1}],`+cust+`}`)
	errObj, _ = body["error"].(map[string]any)
	if code != 400 || errObj["code"] != "product_unavailable" {
		t.Errorf("unavailable: %d %v", code, body)
	}

	code, body = post(t, app, path, `{"items":[{"slug":"kopi-susu","qty":1}],"customer":{"name":"Budi","phone":"12"}}`)
	errObj, _ = body["error"].(map[string]any)
	if code != 400 || errObj["code"] != "invalid_phone" {
		t.Errorf("invalid phone: %d %v", code, body)
	}

	// Honeypot: fake 201, nothing stored.
	before := countOrders(t, ctx, site)
	code, _ = post(t, app, path, `{"items":[{"slug":"kopi-susu","qty":1}],`+cust+`,"_hp":"x"}`)
	if code != 201 || countOrders(t, ctx, site) != before {
		t.Errorf("honeypot: code %d, orders %d -> %d", code, before, countOrders(t, ctx, site))
	}
	if s := stockOf(t, ctx, p); *s != 0 {
		t.Errorf("stock = %d", *s)
	}

	draft := makeSite(t, ctx, "draft")
	code, body = post(t, app, "/public/sites/"+draft.String()+"/orders", `{"items":[{"slug":"x","qty":1}],`+cust+`}`)
	errObj, _ = body["error"].(map[string]any)
	if code != 404 || errObj["code"] != "site_not_found" {
		t.Errorf("draft site: %d %v", code, body)
	}
}
