import type { ThemeJson } from "./api";
import { hexToHslComponents, mixHex } from "./color";

// themeToCss — emit :root custom properties read by block renderers.
export function themeToCss(theme: ThemeJson | null): string {
  const c = theme?.colors ?? {};
  const f = theme?.font ?? {};
  const primary = c.primary ?? "#2563eb";
  const secondary = c.secondary ?? "#0ea5e9";
  const bg = c.bg ?? "#ffffff";
  const fg = c.fg ?? "#0f172a";
  return `
    :root {
      --color-primary: ${primary};
      --color-secondary: ${secondary};
      --color-bg: ${bg};
      --color-fg: ${fg};
      --radius: ${theme?.radius ?? "0.75rem"};
      --font-heading: "${f.heading ?? "Inter"}", system-ui, sans-serif;
      --font-body: "${f.body ?? "Inter"}", system-ui, sans-serif;
      ${neutralHslVars(bg, fg)}
    }
  `;
}

// HSL component vars behind the Tailwind neutral tokens (bg-card, bg-muted,
// text-foreground, border…). The renderer's tailwind.config used to define no
// colours at all, so those classes emitted no CSS in production while the
// editor canvas rendered them — form inputs and cards had no background live.
// Tints use the umkm.css ratios so UMKM and standard blocks agree.
export function neutralHslVars(bg: string, fg: string): string {
  const hsl = (hex: string | null, fallback: string) => hexToHslComponents(hex ?? "") ?? fallback;
  return [
    `--wb-bg-hsl: ${hsl(bg, "0 0% 100%")};`,
    `--wb-fg-hsl: ${hsl(fg, "222 47% 11%")};`,
    `--wb-muted-hsl: ${hsl(mixHex(fg, bg, 0.06), "210 40% 96%")};`,
    `--wb-muted-fg-hsl: ${hsl(mixHex(fg, bg, 0.64), "215 16% 47%")};`,
    `--wb-border-hsl: ${hsl(mixHex(fg, bg, 0.11), "214 32% 91%")};`,
  ].join("\n      ");
}

export function googleFontsUrl(theme: ThemeJson | null): string | null {
  const fams = new Set<string>();
  const h = theme?.font?.heading;
  const b = theme?.font?.body;
  if (h) fams.add(h);
  if (b) fams.add(b);
  if (fams.size === 0) return null;
  const families = [...fams]
    .map((f) => `family=${encodeURIComponent(f.replace(/ /g, "+"))}:wght@400;500;600;700`)
    .join("&");
  return `https://fonts.googleapis.com/css2?${families}&display=swap`;
}
