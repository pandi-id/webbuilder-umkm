// Block-level layout + theme override. Optional metadata attached to a block
// alongside its `props`. All fields optional — the renderer / canvas wrapper
// treats undefined as "use defaults".
//
// SHARED contract — same shape must be honoured by:
//   - apps/web/app/sites/[id]/editor/page.tsx (preview)
//   - apps/renderer/components/Blocks.tsx     (live render)
//   - apps/api/internal/exports/render.go     (static export)

import { hexToHslComponents, readableForeground } from "./color";

export type BlockLayout = {
  // Padding (rem). 0 disables (no inline style). Top/right/bottom/left.
  pt?: number;
  pr?: number;
  pb?: number;
  pl?: number;
  // Margin top/bottom (rem). Most flow layouts only need vertical margins.
  mt?: number;
  mb?: number;
  // Max width container — keeps long-line readability. "full" = stretch.
  maxWidth?: "full" | "narrow" | "prose" | "wide";
  // Horizontal alignment of the block content.
  align?: "left" | "center" | "right";
  // Optional background colour override on the block wrapper. Hex string;
  // undefined = transparent (block sees site bg).
  bg?: string;
  // Hide the block entirely on a given breakpoint (mobile-first / progressive).
  hidden?: { mobile?: boolean; tablet?: boolean; desktop?: boolean };
  // Per-breakpoint overrides — any subset of the fields above. The renderer
  // emits @media rules so undefined values fall back to the base layout.
  // Convention: "tablet" overrides apply ≥768px, "desktop" ≥1024px. "mobile"
  // is the default (base) — no media query needed.
  responsive?: {
    tablet?: ResponsiveLayoutPatch;
    desktop?: ResponsiveLayoutPatch;
  };
};

// Subset of BlockLayout that's overridable per breakpoint. Excludes
// `responsive` itself + `hidden` (handled separately).
export type ResponsiveLayoutPatch = {
  pt?: number;
  pr?: number;
  pb?: number;
  pl?: number;
  mt?: number;
  mb?: number;
  maxWidth?: "full" | "narrow" | "prose" | "wide";
  align?: "left" | "center" | "right";
  bg?: string;
};

export type Breakpoint = "mobile" | "tablet" | "desktop";

// Per-block theme override. Only the colours commonly tweaked per-section
// (primary accent + bg/fg). Renderer maps these to `--color-primary` /
// `--color-bg` / `--color-fg` on the wrapper so EVERY child block element
// using those vars (most of the new Pro blocks + renderer Blocks.tsx) picks
// the local override automatically.
export type ThemeOverride = {
  primary?: string;
  secondary?: string;
  bg?: string;
  fg?: string;
};

export type LayoutMeta = {
  layout?: BlockLayout;
  themeOverride?: ThemeOverride;
};

// Tailwind-like max-width presets that match the renderer's design system.
const MAX_WIDTH_PX: Record<NonNullable<BlockLayout["maxWidth"]>, string> = {
  full: "100%",
  wide: "1280px",
  narrow: "640px",
  prose: "720px",
};

/**
 * Compute CSS for a block wrapper from its layout + theme override. Returns
 * an object suitable for `style={...}`. Empty layout → empty style (so the
 * block keeps its original behaviour).
 */
export function buildLayoutStyle(meta?: LayoutMeta): React.CSSProperties {
  const out: Record<string, string> = {};
  const L = meta?.layout;
  if (L) {
    if (L.pt != null) out.paddingTop = `${L.pt}rem`;
    if (L.pr != null) out.paddingRight = `${L.pr}rem`;
    if (L.pb != null) out.paddingBottom = `${L.pb}rem`;
    if (L.pl != null) out.paddingLeft = `${L.pl}rem`;
    if (L.mt != null) out.marginTop = `${L.mt}rem`;
    if (L.mb != null) out.marginBottom = `${L.mb}rem`;
    if (L.bg) out.backgroundColor = L.bg;
    if (L.align) out.textAlign = L.align;
  }
  const O = meta?.themeOverride;
  if (O) {
    // 1) Renderer-style raw vars — used by Pro blocks + any inline-style block
    //    that reads `var(--color-primary)` directly.
    if (O.primary) out["--color-primary"] = O.primary;
    if (O.secondary) out["--color-secondary"] = O.secondary;
    if (O.bg) out["--color-bg"] = O.bg;
    if (O.fg) out["--color-fg"] = O.fg;

    // 2) shadcn-style HSL tokens — necessary so STANDARD blocks (the ones
    //    using tailwind `bg-primary` / `text-foreground` etc.) also pick up
    //    the per-block override. Without this branch only Pro blocks would
    //    re-colour and the user reports "preview tidak berubah".
    if (O.primary) {
      const h = hexToHslComponents(O.primary);
      if (h) out["--primary"] = h;
      out["--primary-foreground"] = readableForeground(O.primary);
      out["--ring"] = h ?? out["--ring"];
    }
    if (O.secondary) {
      const h = hexToHslComponents(O.secondary);
      if (h) out["--secondary"] = h;
      out["--secondary-foreground"] = readableForeground(O.secondary);
    }
    if (O.bg) {
      const h = hexToHslComponents(O.bg);
      if (h) {
        out["--background"] = h;
        out["--card"] = h;
        out["--popover"] = h;
      }
      // 3) Paint the wrapper background directly. CSS vars alone aren't
      //    enough — most block markup doesn't use `bg-background`, so without
      //    a concrete background-color the user's "Latar" override stays
      //    invisible. layout.bg can still override (handled above) and wins
      //    when both are set because it's applied later in source order.
      if (!out.backgroundColor) out.backgroundColor = O.bg;
    }
    if (O.fg) {
      const h = hexToHslComponents(O.fg);
      if (h) {
        out["--foreground"] = h;
        out["--card-foreground"] = h;
        out["--popover-foreground"] = h;
        out["--muted-foreground"] = h;
      }
      // Cascade `color` so paragraphs/headings without explicit text class
      // pick up the override. Tailwind's `text-muted-foreground` etc. still
      // win via specificity if the block uses them.
      out.color = O.fg;
    }
  }
  return out as React.CSSProperties;
}

/**
 * If `maxWidth` is anything other than "full", we need a centred inner
 * container so the constraint actually narrows the block. Returns style for
 * the inner div; if maxWidth is "full" or undefined, returns null (caller
 * skips the wrapper entirely).
 */
export function buildMaxWidthStyle(meta?: LayoutMeta): React.CSSProperties | null {
  const mw = meta?.layout?.maxWidth;
  if (!mw || mw === "full") return null;
  return {
    maxWidth: MAX_WIDTH_PX[mw],
    marginLeft: "auto",
    marginRight: "auto",
    width: "100%",
  };
}

export function hasLayoutMeta(meta?: LayoutMeta): boolean {
  return Boolean(
    (meta?.layout && Object.keys(meta.layout).length > 0) ||
      (meta?.themeOverride && Object.keys(meta.themeOverride).length > 0),
  );
}

/**
 * Merge a base BlockLayout with a per-breakpoint patch. Patch fields win.
 * Used by the editor canvas when previewing a non-desktop device — we
 * synthesise the effective layout for that breakpoint inline so the canvas
 * matches what the renderer will paint.
 */
export function mergeLayoutPatch(
  base: BlockLayout | undefined,
  patch: ResponsiveLayoutPatch | undefined,
): BlockLayout {
  const out: BlockLayout = { ...(base ?? {}) };
  if (!patch) return out;
  if (patch.pt != null) out.pt = patch.pt;
  if (patch.pr != null) out.pr = patch.pr;
  if (patch.pb != null) out.pb = patch.pb;
  if (patch.pl != null) out.pl = patch.pl;
  if (patch.mt != null) out.mt = patch.mt;
  if (patch.mb != null) out.mb = patch.mb;
  if (patch.maxWidth) out.maxWidth = patch.maxWidth;
  if (patch.align) out.align = patch.align;
  if (patch.bg) out.bg = patch.bg;
  return out;
}

/**
 * Resolve the layout that applies for a given breakpoint. Used by the editor
 * canvas preview to render mobile/tablet view inline.
 */
export function layoutForBreakpoint(
  layout: BlockLayout | undefined,
  bp: Breakpoint,
): BlockLayout {
  if (!layout) return {};
  if (bp === "mobile") {
    // mobile is the base — no patch by convention (mobile-first).
    const { responsive: _ignore, hidden: _h, ...base } = layout;
    return base;
  }
  if (bp === "tablet") {
    return mergeLayoutPatch(stripResponsive(layout), layout.responsive?.tablet);
  }
  return mergeLayoutPatch(stripResponsive(layout), layout.responsive?.desktop);
}

function stripResponsive(layout: BlockLayout): BlockLayout {
  const { responsive: _ignore, hidden: _h, ...rest } = layout;
  return rest;
}

/**
 * Build per-block CSS for a single block, scoped via a unique class. Returns
 * a CSS string (empty if no responsive overrides). The renderer + Go export
 * emit this inside a single `<style>` tag at page top so the static HTML is
 * self-contained.
 *
 * Format:
 *   .wb-blk-<n>            { ...mobile + base... }
 *   @media (min-width: 768px)  { .wb-blk-<n> { ...tablet patch... } }
 *   @media (min-width: 1024px) { .wb-blk-<n> { ...desktop patch... } }
 *
 * The mobile/base CSS is emitted INLINE on the element (already wired in
 * buildLayoutStyle), so this function only emits @media overrides + hidden
 * visibility rules.
 */
export function blockResponsiveCSS(klass: string, layout: BlockLayout | undefined): string {
  if (!layout) return "";
  const parts: string[] = [];
  const t = layout.responsive?.tablet;
  if (t && hasAnyPatch(t)) {
    parts.push(
      `@media (min-width:768px){.${klass}{${patchToCSS(t)}}${patchToInnerCSS(klass, t)}}`,
    );
  }
  const d = layout.responsive?.desktop;
  if (d && hasAnyPatch(d)) {
    parts.push(
      `@media (min-width:1024px){.${klass}{${patchToCSS(d)}}${patchToInnerCSS(klass, d)}}`,
    );
  }
  if (layout.hidden) {
    if (layout.hidden.mobile) {
      parts.push(`@media (max-width:767px){.${klass}{display:none!important}}`);
    }
    if (layout.hidden.tablet) {
      parts.push(`@media (min-width:768px) and (max-width:1023px){.${klass}{display:none!important}}`);
    }
    if (layout.hidden.desktop) {
      parts.push(`@media (min-width:1024px){.${klass}{display:none!important}}`);
    }
  }
  return parts.join("");
}

function hasAnyPatch(p: ResponsiveLayoutPatch): boolean {
  return (
    p.pt != null ||
    p.pr != null ||
    p.pb != null ||
    p.pl != null ||
    p.mt != null ||
    p.mb != null ||
    p.maxWidth != null ||
    p.align != null ||
    p.bg != null
  );
}

function patchToCSS(p: ResponsiveLayoutPatch): string {
  const out: string[] = [];
  if (p.pt != null) out.push(`padding-top:${p.pt}rem`);
  if (p.pr != null) out.push(`padding-right:${p.pr}rem`);
  if (p.pb != null) out.push(`padding-bottom:${p.pb}rem`);
  if (p.pl != null) out.push(`padding-left:${p.pl}rem`);
  if (p.mt != null) out.push(`margin-top:${p.mt}rem`);
  if (p.mb != null) out.push(`margin-bottom:${p.mb}rem`);
  if (p.align) out.push(`text-align:${p.align}`);
  if (p.bg) out.push(`background-color:${p.bg}`);
  return out.join(";");
}

// max-width applies to an inner centred container, not the wrapper itself.
// We expose the inner div as `.wb-blk-<n> > .wb-blk-inner`.
function patchToInnerCSS(klass: string, p: ResponsiveLayoutPatch): string {
  if (!p.maxWidth) return "";
  const map: Record<NonNullable<ResponsiveLayoutPatch["maxWidth"]>, string> = {
    full: "100%",
    wide: "1280px",
    narrow: "640px",
    prose: "720px",
  };
  const w = map[p.maxWidth];
  return `.${klass} .wb-blk-inner{max-width:${w}}`;
}
