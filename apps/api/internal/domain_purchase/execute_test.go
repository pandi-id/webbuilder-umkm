package domain_purchase

import (
	"encoding/json"
	"testing"
)

// Pure-function tests untuk metadata parsers — no DB, no external deps.
// Full ExecuteAfterPayment flow di-cover via consumer integration test
// (butuh registrar client + repo + auth users, out of scope unit).

func TestParseInvoiceMetadata_EmptyBytes(t *testing.T) {
	m := parseInvoiceMetadata(nil)
	if m == nil || len(m) != 0 {
		t.Errorf("nil input should yield empty map, got %v", m)
	}
	m = parseInvoiceMetadata([]byte{})
	if m == nil || len(m) != 0 {
		t.Errorf("empty bytes should yield empty map, got %v", m)
	}
}

func TestParseInvoiceMetadata_InvalidJSON(t *testing.T) {
	m := parseInvoiceMetadata([]byte(`{not valid`))
	if m == nil || len(m) != 0 {
		t.Errorf("invalid JSON should yield empty map, got %v", m)
	}
}

func TestParseInvoiceMetadata_ValidJSON(t *testing.T) {
	raw, _ := json.Marshal(map[string]any{
		"kind":   "register",
		"domain": "myshop.id",
		"years":  2,
		"job_id": "epp_myshop_id_20260803120000",
	})
	m := parseInvoiceMetadata(raw)
	if m["kind"] != "register" || m["domain"] != "myshop.id" {
		t.Errorf("parse mismatch: %v", m)
	}
	if intFromMeta(m, "years") != 2 {
		t.Errorf("years = %d, want 2", intFromMeta(m, "years"))
	}
}

func TestStringFromMeta(t *testing.T) {
	m := map[string]any{
		"str":     "hello",
		"padded":  "  trim me  ",
		"empty":   "",
		"missing": nil,
		"number":  42,
	}
	if stringFromMeta(m, "str") != "hello" {
		t.Errorf("plain str fail")
	}
	if stringFromMeta(m, "padded") != "trim me" {
		t.Errorf("trim fail: %q", stringFromMeta(m, "padded"))
	}
	if stringFromMeta(m, "empty") != "" {
		t.Errorf("empty fail")
	}
	if stringFromMeta(m, "does_not_exist") != "" {
		t.Errorf("missing key should return empty")
	}
	// Non-string value → empty.
	if stringFromMeta(m, "number") != "" {
		t.Errorf("non-string value should return empty")
	}
}

func TestIntFromMeta(t *testing.T) {
	cases := []struct {
		key  string
		val  any
		want int
	}{
		{"float64", float64(3), 3}, // JSON number decode
		{"float64_neg", float64(-5), -5},
		{"int", int(42), 42},
		{"int64", int64(100), 100},
		{"string_wrong", "not a number", 0}, // wrong type
		{"bool_wrong", true, 0},             // wrong type
	}
	for _, tc := range cases {
		m := map[string]any{tc.key: tc.val}
		if got := intFromMeta(m, tc.key); got != tc.want {
			t.Errorf("intFromMeta(%q=%v) = %d, want %d", tc.key, tc.val, got, tc.want)
		}
	}
	// Missing key → 0.
	if intFromMeta(map[string]any{}, "missing") != 0 {
		t.Errorf("missing key should return 0")
	}
}

func TestExecuteAfterPayment_NilInvoice(t *testing.T) {
	h := &Handler{}
	if err := h.ExecuteAfterPayment(nil, nil); err == nil {
		t.Error("expected error for nil invoice")
	}
}
