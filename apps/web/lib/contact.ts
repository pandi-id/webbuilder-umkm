// Validation for the contact fields that end up in an EPP contact:create —
// the profile form and the add-client form both feed the same registry call,
// so the rules live here instead of being retyped per form.

// ASCII printable range — mirrors auth.IsASCIIPrintable in the backend. EPP
// uses PostalInfoInternational (RFC 5733 §2.6), which accepts ASCII only.
// Checking here lets the user fix it before submitting.
export function isASCIIPrintable(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code < 0x20 || code > 0x7e) return false;
  }
  return true;
}

export function countDigits(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 48 && c <= 57) n++;
  }
  return n;
}

// Postal codes are free-form across registries; 4–10 digits with separators
// covers Indonesia and leaves room without accepting junk.
export function postalCodeError(v: string): string | undefined {
  if (!v) return undefined;
  const d = countDigits(v);
  if (!/^[0-9\s\-]+$/.test(v) || d < 4 || d > 10) return "Kode pos harus 4-10 digit angka";
  return undefined;
}

// NIK is required for .id registration (Kemenkominfo); exactly 16 digits.
export function nikError(v: string): string | undefined {
  if (!v) return undefined;
  if (v.length !== 16 || !/^\d{16}$/.test(v)) return "NIK harus 16 digit angka";
  return undefined;
}

export function asciiError(v: string, label: string): string | undefined {
  if (!v) return undefined;
  if (!isASCIIPrintable(v)) return `${label} hanya boleh karakter ASCII (tanpa aksen atau emoji)`;
  return undefined;
}
