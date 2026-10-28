package orders

import "testing"

func TestEffectiveWhatsApp(t *testing.T) {
	cases := []struct {
		site, profile, wantNum, wantSrc string
	}{
		{"0812-3456-7890", "+62899900929", "6281234567890", "site"},
		{"", "+62899900929", "62899900929", "profile"},
		{"", "0899 900 929", "62899900929", "profile"},
		{"bukan-nomor", "+62899900929", "62899900929", "profile"},
		{"", "", "", ""},
		{"", "12", "", ""},
	}
	for _, c := range cases {
		num, src := EffectiveWhatsApp(c.site, c.profile)
		if num != c.wantNum || src != c.wantSrc {
			t.Errorf("EffectiveWhatsApp(%q, %q) = %q, %q; want %q, %q", c.site, c.profile, num, src, c.wantNum, c.wantSrc)
		}
	}
}
