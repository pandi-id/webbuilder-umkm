package sites

import "strings"

// NormalizePhone turns an Indonesian phone number into the digits-only
// international form wa.me expects ("0812-3456-7890" -> "6281234567890").
// Lives here (not in orders) so both the site WhatsApp setting and the order
// checkout share one rule without an import cycle.
func NormalizePhone(s string) (string, bool) {
	var b strings.Builder
	for _, r := range strings.TrimSpace(s) {
		switch {
		case r >= '0' && r <= '9':
			b.WriteRune(r)
		case r == ' ' || r == '-' || r == '+' || r == '.' || r == '(' || r == ')':
			// Common separators people type; dropped.
		default:
			return "", false
		}
	}
	d := b.String()
	if strings.HasPrefix(d, "0") {
		d = "62" + d[1:]
	}
	if len(d) < 9 || len(d) > 15 {
		return "", false
	}
	return d, true
}
