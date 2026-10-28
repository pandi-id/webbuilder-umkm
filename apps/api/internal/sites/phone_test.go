package sites

import "testing"

func TestNormalizePhone(t *testing.T) {
	cases := []struct {
		in   string
		want string
		ok   bool
	}{
		{"0812-3456-7890", "6281234567890", true},
		{"+62 812 3456 7890", "6281234567890", true},
		{"6281234567890", "6281234567890", true},
		{" (0812) 3456.7890 ", "6281234567890", true},
		{"081234", "", false},              // too short
		{"0812345678901234567", "", false}, // too long
		{"0812-34a6-7890", "", false},      // letters
		{"", "", false},
		{"+1 415 555 0100", "14155550100", true}, // foreign numbers pass through
	}
	for _, c := range cases {
		got, ok := NormalizePhone(c.in)
		if got != c.want || ok != c.ok {
			t.Errorf("NormalizePhone(%q) = %q,%v; want %q,%v", c.in, got, ok, c.want, c.ok)
		}
	}
}
