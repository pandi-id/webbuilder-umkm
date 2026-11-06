// Curated Google Fonts catalog used by the FontPicker UI and the theme tokens.
// The renderer + static export load whichever font name the user picks from this list.

export type FontCategory = "sans" | "serif" | "display" | "mono";

export type FontDef = {
  name: string; // exactly as listed in Google Fonts
  category: FontCategory;
};

export const fonts: FontDef[] = [
  // Sans-serif
  { name: "Inter", category: "sans" },
  { name: "Plus Jakarta Sans", category: "sans" },
  { name: "Poppins", category: "sans" },
  { name: "Manrope", category: "sans" },
  { name: "DM Sans", category: "sans" },
  { name: "Work Sans", category: "sans" },
  { name: "Rubik", category: "sans" },
  { name: "Lato", category: "sans" },
  { name: "Nunito", category: "sans" },
  { name: "Open Sans", category: "sans" },
  { name: "Montserrat", category: "sans" },
  { name: "Space Grotesk", category: "sans" },
  { name: "Outfit", category: "sans" },
  // Serif
  { name: "Playfair Display", category: "serif" },
  { name: "Merriweather", category: "serif" },
  { name: "Lora", category: "serif" },
  { name: "Source Serif 4", category: "serif" },
  { name: "Cormorant Garamond", category: "serif" },
  { name: "EB Garamond", category: "serif" },
  { name: "Crimson Pro", category: "serif" },
  // Display
  { name: "Bebas Neue", category: "display" },
  { name: "Archivo Black", category: "display" },
  { name: "Oswald", category: "display" },
  { name: "Anton", category: "display" },
  { name: "Abril Fatface", category: "display" },
  // Mono
  { name: "JetBrains Mono", category: "mono" },
  { name: "Fira Code", category: "mono" },
  { name: "IBM Plex Mono", category: "mono" },
];

export const categoryLabels: Record<FontCategory, string> = {
  sans: "Sans-serif",
  serif: "Serif",
  display: "Display",
  mono: "Monospace",
};

// One stylesheet URL that loads every font in the catalog.
// Used by the picker so previews render in their real font.
// 500 included: the renderer loads 400;500;600;700, so a `font-medium` CTA must
// not be synthesised in the editor while rendering true in production.
export function buildCatalogFontsUrl(weights: string[] = ["400", "500", "600", "700"]): string {
  const families = fonts.map(
    (f) => `family=${f.name.replace(/ /g, "+")}:wght@${weights.join(";")}`,
  );
  return `https://fonts.googleapis.com/css2?${families.join("&")}&display=swap`;
}

export function fontStyle(name: string): React.CSSProperties {
  return { fontFamily: `"${name}", system-ui, sans-serif` };
}
