package orders

import (
	"encoding/json"
	"strings"
	"testing"
)

func parseReq(t *testing.T, body string) CreateRequest {
	t.Helper()
	var r CreateRequest
	if err := json.Unmarshal([]byte(body), &r); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	return r
}

func TestValidate_OK_MergesDuplicates(t *testing.T) {
	r := parseReq(t, `{"items":[{"slug":"kopi","qty":2},{"slug":" Teh ","qty":1},{"slug":"kopi","qty":3}],
		"customer":{"name":"  Budi ","phone":"0812-3456-7890","address":" Jl. Merdeka 10 "},"note":" pedas "}`)
	in, verr := r.Validate()
	if verr != nil {
		t.Fatalf("unexpected error: %v", verr)
	}
	if len(in.Lines) != 2 || in.Lines[0] != (Line{"kopi", 5}) || in.Lines[1] != (Line{"teh", 1}) {
		t.Errorf("lines = %+v", in.Lines)
	}
	if in.CustomerName != "Budi" || in.CustomerPhone != "6281234567890" ||
		in.CustomerAddress != "Jl. Merdeka 10" || in.Note != "pedas" {
		t.Errorf("normalised input = %+v", in)
	}
}

func TestValidate_Errors(t *testing.T) {
	okCustomer := `"customer":{"name":"Budi","phone":"081234567890"}`
	many := make([]string, 51)
	for i := range many {
		many[i] = `{"slug":"p` + strings.Repeat("x", i) + `","qty":1}`
	}
	cases := []struct {
		name, body, code string
	}{
		{"empty cart", `{"items":[],` + okCustomer + `}`, "empty_cart"},
		{"too many", `{"items":[` + strings.Join(many, ",") + `],` + okCustomer + `}`, "too_many_items"},
		{"blank slug", `{"items":[{"slug":" ","qty":1}],` + okCustomer + `}`, "invalid_item"},
		{"qty zero", `{"items":[{"slug":"a","qty":0}],` + okCustomer + `}`, "invalid_qty"},
		{"qty 100", `{"items":[{"slug":"a","qty":100}],` + okCustomer + `}`, "invalid_qty"},
		{"merged qty over", `{"items":[{"slug":"a","qty":60},{"slug":"a","qty":40}],` + okCustomer + `}`, "invalid_qty"},
		{"short name", `{"items":[{"slug":"a","qty":1}],"customer":{"name":"B","phone":"081234567890"}}`, "invalid_name"},
		{"long name", `{"items":[{"slug":"a","qty":1}],"customer":{"name":"` + strings.Repeat("a", 81) + `","phone":"081234567890"}}`, "invalid_name"},
		{"bad phone", `{"items":[{"slug":"a","qty":1}],"customer":{"name":"Budi","phone":"12ab"}}`, "invalid_phone"},
		{"long address", `{"items":[{"slug":"a","qty":1}],"customer":{"name":"Budi","phone":"081234567890","address":"` + strings.Repeat("a", 301) + `"}}`, "invalid_address"},
		{"long note", `{"items":[{"slug":"a","qty":1}],` + okCustomer + `,"note":"` + strings.Repeat("a", 501) + `"}`, "invalid_note"},
	}
	for _, c := range cases {
		r := parseReq(t, c.body)
		_, verr := r.Validate()
		if verr == nil {
			t.Errorf("%s: expected %s, got nil", c.name, c.code)
			continue
		}
		if verr.Code != c.code || verr.Message == "" {
			t.Errorf("%s: got %s (%q), want %s", c.name, verr.Code, verr.Message, c.code)
		}
	}
}

func TestValidate_NameCountsRunes(t *testing.T) {
	// 80 multi-byte runes must pass even though it's > 80 bytes.
	r := parseReq(t, `{"items":[{"slug":"a","qty":1}],"customer":{"name":"`+strings.Repeat("é", 80)+`","phone":"081234567890"}}`)
	if _, verr := r.Validate(); verr != nil {
		t.Errorf("unexpected: %v", verr)
	}
}

func TestCanTransition(t *testing.T) {
	all := []string{StatusNew, StatusProcessing, StatusDone, StatusCancelled}
	allowed := map[[2]string]bool{
		{StatusNew, StatusProcessing}:       true,
		{StatusNew, StatusCancelled}:        true,
		{StatusNew, StatusDone}:             true,
		{StatusProcessing, StatusDone}:      true,
		{StatusProcessing, StatusCancelled}: true,
	}
	for _, from := range all {
		for _, to := range all {
			if got, want := CanTransition(from, to), allowed[[2]string{from, to}]; got != want {
				t.Errorf("CanTransition(%s,%s) = %v, want %v", from, to, got, want)
			}
		}
	}
	if CanTransition("bogus", StatusDone) {
		t.Error("unknown from-status must not transition")
	}
}

func TestTransitionMessage(t *testing.T) {
	if m := TransitionMessage(StatusDone, StatusCancelled); !strings.Contains(m, "selesai") {
		t.Errorf("done message = %q", m)
	}
	if m := TransitionMessage(StatusCancelled, StatusDone); !strings.Contains(m, "dibatalkan") {
		t.Errorf("cancelled message = %q", m)
	}
	if m := TransitionMessage(StatusProcessing, StatusProcessing); !strings.Contains(m, "Diproses") {
		t.Errorf("same-status message = %q", m)
	}
}

func TestFormatOrderNo(t *testing.T) {
	for seq, want := range map[int]string{1: "#0001", 42: "#0042", 9999: "#9999", 12345: "#12345"} {
		if got := FormatOrderNo(seq); got != want {
			t.Errorf("FormatOrderNo(%d) = %q, want %q", seq, got, want)
		}
	}
}

func TestOrderOrdersSQL_Whitelist(t *testing.T) {
	if orderOrdersSQL("total_desc") != "total DESC, created_at DESC" ||
		orderOrdersSQL("oldest") != "created_at ASC, seq ASC" {
		t.Error("known presets mapped wrong")
	}
	if got := orderOrdersSQL("total; DROP TABLE orders"); got != orderOrdersSQL("newest") {
		t.Errorf("unknown preset must fall back to newest, got %q", got)
	}
}

func TestSearchFilter(t *testing.T) {
	if f := searchFilter("", "%"); f.Search {
		t.Error("empty q must not search")
	}
	f := searchFilter("#42", "%#42%")
	if !f.Search || f.Seq != 42 || f.NamePattern != "" || f.PhoneLike != "" {
		t.Errorf("#42 filter = %+v", f)
	}
	f = searchFilter("42", "%42%")
	if f.Seq != 42 || f.NamePattern != "%42%" || f.PhoneLike != "%42%" {
		t.Errorf("42 filter = %+v", f)
	}
	f = searchFilter("0812", "%0812%")
	if f.PhoneLike != "%62812%" {
		t.Errorf("phone filter = %+v", f)
	}
	f = searchFilter("budi", "%budi%")
	if f.Seq != 0 || f.PhoneLike != "" || f.NamePattern != "%budi%" {
		t.Errorf("name filter = %+v", f)
	}
}
