// Color helpers — small because the only consumer is the editor canvas needing
// to feed shadcn-style HSL CSS variables from user-picked hex colours.

/**
 * Convert a hex colour (#rgb or #rrggbb) to "H S% L%" components in the
 * format shadcn-ui expects for CSS variables (e.g. `--primary: 262 83% 58%`).
 * Returns null on malformed input so the caller can fall back.
 */
export function hexToHslComponents(hex: string): string | null {
  if (typeof hex !== "string") return null;
  let s = hex.trim();
  if (s.startsWith("#")) s = s.slice(1);
  if (s.length === 3) s = s.split("").map((c) => c + c).join("");
  if (s.length !== 6 || !/^[0-9a-f]+$/i.test(s)) return null;

  const r = parseInt(s.slice(0, 2), 16) / 255;
  const g = parseInt(s.slice(2, 4), 16) / 255;
  const b = parseInt(s.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let sat = 0;
  if (max !== min) {
    const d = max - min;
    sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
        break;
      case g:
        h = ((b - r) / d + 2) * 60;
        break;
      case b:
        h = ((r - g) / d + 4) * 60;
        break;
    }
  }
  return `${Math.round(h)} ${Math.round(sat * 100)}% ${Math.round(l * 100)}%`;
}

/**
 * Pick a readable foreground (white or near-black) for a given hex background.
 * Uses simple WCAG-ish luminance threshold — good enough for primary buttons.
 */
// mixHex blends `weight` (0..1) of `top` over `base` in sRGB — the same idea as
// CSS color-mix(in srgb, top W%, base). Used to derive neutral tokens (muted,
// border) from the theme's fg/bg instead of using fg at full strength, which
// made every border and placeholder near-black in the editor canvas.
export function mixHex(top: string, base: string, weight: number): string | null {
  const t = parseHex(top);
  const b = parseHex(base);
  if (!t || !b) return null;
  const w = Math.min(1, Math.max(0, weight));
  const ch = (i: number) => Math.round(t[i] * w + b[i] * (1 - w));
  return "#" + [ch(0), ch(1), ch(2)].map((v) => v.toString(16).padStart(2, "0")).join("");
}

function parseHex(hex: string): [number, number, number] | null {
  if (typeof hex !== "string") return null;
  let s = hex.trim();
  if (s.startsWith("#")) s = s.slice(1);
  if (s.length === 3) s = s.split("").map((c) => c + c).join("");
  if (s.length !== 6 || !/^[0-9a-f]+$/i.test(s)) return null;
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}

export function readableForeground(hex: string): string {
  let s = hex.trim().replace("#", "");
  if (s.length === 3) s = s.split("").map((c) => c + c).join("");
  if (s.length !== 6) return "0 0% 100%";
  const r = parseInt(s.slice(0, 2), 16) / 255;
  const g = parseInt(s.slice(2, 4), 16) / 255;
  const b = parseInt(s.slice(4, 6), 16) / 255;
  // Rec. 709 luma — cheap, no gamma correction needed for a binary choice.
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luma > 0.55 ? "222 47% 11%" : "0 0% 100%";
}
