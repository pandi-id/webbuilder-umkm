"use client";

import { useParams } from "next/navigation";
import { createContext, createElement, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  Bookmark,
  CalendarClock,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  History,
  Layers,
  Loader2,
  Map as MapIcon,
  Monitor,
  MoreHorizontal,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Redo2,
  Rocket,
  RotateCcw,
  Save,
  Search,
  Settings2,
  Smartphone,
  Sparkles,
  Tablet,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { marked } from "marked";
import { api } from "@/lib/api";
import { blockSchemas, blockSchemasByCategory, isContainer, schemaFor } from "@/lib/blocks";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { hexToHslComponents, readableForeground } from "@/lib/color";
import { buildCatalogFontsUrl } from "@/lib/fonts";
import { PropEditor, type BlockData } from "./PropEditor";
import { LayoutPanel } from "./LayoutPanel";
import { ThemeDrawer, type ThemeJson } from "./ThemeDrawer";
import { buildLayoutStyle, buildMaxWidthStyle, layoutForBreakpoint } from "@/lib/blockLayout";
import { useBlocksHistory } from "./useBlocksHistory";
import { SortableBlockList, makeKeys, reorderWithKeys } from "./SortableBlockList";
import { CanvasBlockToolbar } from "./CanvasOverlay";
import { EditableText } from "./EditableText";
import { PageSettingsDialog } from "./PageSettingsDialog";
import { PreviewShareDialog } from "./PreviewShareDialog";
import { MiniMap } from "./MiniMap";
import { ChildrenEditor } from "./ChildrenEditor";
import { UMKM_BLOCK_TYPES, renderUmkmBlock, type UmkmCtx } from "@/components/umkm/UmkmBlocks";
import { UMKM_SAMPLE_PRODUCTS, catalogCards, catalogLimit, type CatalogProduct, type UmkmCard } from "@/lib/umkm";
import {
  duplicateAtPath,
  getAt,
  insertAt,
  keyToPath,
  moveAtPath,
  movePath as movePathHelper,
  pathKey,
  removeMany,
  reorderSiblings,
  samePath,
  siblingsOf,
  updateAt,
  type Path,
} from "./paths";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";

type PageVersion = {
  id: string;
  page_id: string;
  version: number;
  title: string;
  tree: { blocks?: BlockData[] } | null;
  seo: unknown;
  created_at: string;
};

type Page = {
  id: string;
  site_id: string;
  slug: string;
  title: string;
  tree: { blocks?: BlockData[] } | null;
  is_home: boolean;
  // Live snapshot — what the public renderer is serving. `null` means never
  // published. Used to compute the unpublishedChanges indicator + Publish
  // button enabled state.
  published_tree?: { blocks?: BlockData[] } | null;
  published_at?: string | null;
  // scheduled_publish_at — kalau ada, background worker auto-publish saat
  // waktu tercapai. UI toolbar tampilkan badge kuning + hint countdown.
  scheduled_publish_at?: string | null;
};

type Site = {
  id: string;
  name: string;
  theme: ThemeJson | null;
  // layout — shared header/footer across all pages. Kalau `{}` (default seed
  // migration), user belum pernah edit — canvas mulai kosong dan save akan
  // populate untuk pertama kalinya.
  //
  // Flag header_enabled/footer_enabled: kalau false → renderer skip section
  // itu di semua halaman. Default true (undefined = enabled).
  layout?: {
    header?: BlockData[];
    footer?: BlockData[];
    header_enabled?: boolean;
    footer_enabled?: boolean;
  } | null;
};

// EditorTarget — apa yang lagi di-edit di canvas. Bisa page biasa, atau
// section shared layout (header/footer per site). Semua state blocks +
// dirty tracking pakai target ini sebagai konteks.
type EditorTarget =
  | { kind: "page"; pageId: string }
  | { kind: "layout"; section: "header" | "footer" };

function targetKey(t: EditorTarget | null): string {
  if (!t) return "";
  return t.kind === "page" ? `page:${t.pageId}` : `layout:${t.section}`;
}

function targetsEqual(a: EditorTarget | null, b: EditorTarget | null): boolean {
  return targetKey(a) === targetKey(b);
}

const DEFAULT_THEME: ThemeJson = {
  colors: { primary: "#2563eb", secondary: "#0ea5e9", bg: "#ffffff", fg: "#0f172a" },
  font: { heading: "Inter", body: "Inter" },
  radius: "0.75rem",
};

// Inserts a single <link> loading the whole font catalog so any font the user
// picks is available in the canvas without per-pick network juggling.
function ensureFontCatalogLoaded() {
  if (typeof document === "undefined") return;
  const id = "wb-editor-font-catalog";
  if (document.getElementById(id)) return;
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = buildCatalogFontsUrl();
  document.head.appendChild(link);
}

// Active products of the site being edited, so the catalog block previews the
// shop's real products. null = not loaded (or failed) → sample cards.
const SiteProductsContext = createContext<CatalogProduct[] | null>(null);

export default function EditorPage() {
  const params = useParams<{ id: string }>();
  const [siteProducts, setSiteProducts] = useState<CatalogProduct[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    api<{ items: CatalogProduct[] }>(`/api/v1/sites/${params.id}/products?status=active&page_size=100`)
      .then((r) => {
        if (!cancelled) setSiteProducts(r.items ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [params.id]);
  const [pages, setPages] = useState<Page[]>([]);
  // Target = apa yang sedang di-edit. Default: home page (di-set setelah
  // pages fetched). Header/Footer layout jadi target alternatif.
  const [target, setTarget] = useState<EditorTarget | null>(null);
  // Layout state — sinkron dengan sites.layout_json. Save akan PATCH balik
  // ke `/sites/:id`. Undo/redo dan autosave tetap jalan lewat `blocks` state
  // yang di-populate saat target = layout.
  const [layoutHeader, setLayoutHeader] = useState<BlockData[]>([]);
  const [layoutFooter, setLayoutFooter] = useState<BlockData[]>([]);
  // Enabled flags — default true (undefined = enabled). User bisa toggle
  // off supaya renderer skip section walaupun blocks-nya ada.
  const [headerEnabled, setHeaderEnabled] = useState(true);
  const [footerEnabled, setFooterEnabled] = useState(true);
  // Guard supaya user tidak masuk mode layout sebelum site fetch selesai —
  // kalau masuk terlalu awal, kita bisa save empty untuk section yang belum
  // di-load (menghapus data existing).
  const [siteLoaded, setSiteLoaded] = useState(false);

  // Block tree lives in a reducer with undo/redo history. selectedIdx +
  // clipboard are local UI state.
  const { blocks, setBlocks, replaceAll, undo, redo, canUndo, canRedo } =
    useBlocksHistory([]);
  const [blockKeys, setBlockKeys] = useState<string[]>([]);
  const [originalBlocks, setOriginalBlocks] = useState<BlockData[]>([]);
  // Selection is PATH-based so it can point at any block in the nested tree.
  // `selectedPath` is the anchor (last clicked; the block whose props show in
  // the right panel). `selectedPaths` is the full multi-select set, encoded
  // as "1.2.3" strings for Set<string> membership.
  const [selectedPath, setSelectedPath] = useState<Path | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  // Clipboard is an array of full BlockData clones.
  const [clipboard, setClipboard] = useState<BlockData[] | null>(null);

  // Derived: the anchor's flat top-level index (null when nothing selected or
  // selection is inside a container). Only used for sidebar highlighting.
  const selectedIdx = selectedPath && selectedPath.length === 1 ? selectedPath[0] : -1;
  const [saving, setSaving] = useState(false);
  const [device, setDevice] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  // Sidebar collapse — fullscreen canvas for users who need a wider preview.
  // Defaults open; persisted to localStorage so the choice survives reloads.
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  // Detect viewport < lg (1024px) via matchMedia. Di mobile UI 3-column tidak
  // muat; kita paksa single-column canvas + trigger dialog untuk palette +
  // prop editor. Update reactive kalau user rotate device.
  const [isMobile, setIsMobile] = useState(false);
  const [propSheetOpen, setPropSheetOpen] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 1023px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  // Mini-map shown by default; hidden via toolbar toggle (less noise for users
  // who don't want it). Persisted alongside sidebar state.
  const [miniMapVisible, setMiniMapVisible] = useState(true);
  const canvasScrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const l = window.localStorage.getItem("wb_editor_left_collapsed");
    const r = window.localStorage.getItem("wb_editor_right_collapsed");
    const m = window.localStorage.getItem("wb_editor_minimap_visible");
    if (l === "1") setLeftCollapsed(true);
    if (r === "1") setRightCollapsed(true);
    if (m === "0") setMiniMapVisible(false);
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("wb_editor_minimap_visible", miniMapVisible ? "1" : "0");
  }, [miniMapVisible]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("wb_editor_left_collapsed", leftCollapsed ? "1" : "0");
  }, [leftCollapsed]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("wb_editor_right_collapsed", rightCollapsed ? "1" : "0");
  }, [rightCollapsed]);

  // Compute the grid-template-columns based on what's collapsed. The expanded
  // size matches the original 240/1fr/320 layout. SPACES (not underscores) —
  // this string is passed to a real CSS property via inline style, so it must
  // be valid CSS. Underscores would only be correct as Tailwind class
  // shorthand, which gets transformed at build time.
  const gridCols = useMemo(() => {
    // Mobile: single column (canvas only). Palette + prop editor via dialog.
    if (isMobile) return "1fr";
    // 280px (vs 240 sebelumnya) — tambah ruang untuk nama block + action
    // buttons supaya tidak truncate "Section Te..." / salah klik hapus block.
    const L = leftCollapsed ? "0" : "280px";
    const R = rightCollapsed ? "0" : "320px";
    return `${L} 1fr ${R}`;
  }, [isMobile, leftCollapsed, rightCollapsed]);

  // Theme state — loaded from the site, applied as CSS vars on canvas.
  const [theme, setTheme] = useState<ThemeJson>(DEFAULT_THEME);
  const [originalTheme, setOriginalTheme] = useState<ThemeJson>(DEFAULT_THEME);
  const [themeOpen, setThemeOpen] = useState(false);
  const [savingTheme, setSavingTheme] = useState(false);

  useEffect(() => {
    ensureFontCatalogLoaded();
  }, []);

  useEffect(() => {
    api<Page[]>(`/api/v1/sites/${params.id}/pages`)
      .then((list) => {
        setPages(list);
        const home = list.find((p) => p.is_home) ?? list[0] ?? null;
        if (home) {
          setTarget({ kind: "page", pageId: home.id });
          const bs = home.tree?.blocks ?? [];
          replaceAll(bs);
          setBlockKeys(makeKeys(bs.length));
          setOriginalBlocks(bs);
          const initial: Path | null = bs.length ? [0] : null;
          setSelectedPath(initial);
          setSelectedPaths(initial ? new Set([pathKey(initial)]) : new Set());
        }
      })
      .catch((e) => toast.error((e as Error).message));

    // Site fetch parallel — feeds theme into the canvas + layout state untuk
    // shared header/footer editing mode.
    api<Site>(`/api/v1/sites/${params.id}`)
      .then((s) => {
        if (s.theme && Object.keys(s.theme).length > 0) {
          setTheme(s.theme);
          setOriginalTheme(s.theme);
        }
        setLayoutHeader(s.layout?.header ?? []);
        setLayoutFooter(s.layout?.footer ?? []);
        // Default true kalau flag tidak ada (backward compat: sites lama +
        // migrasi 0057 tidak menulis flag ini).
        setHeaderEnabled(s.layout?.header_enabled !== false);
        setFooterEnabled(s.layout?.footer_enabled !== false);
        setSiteLoaded(true);
      })
      .catch(() => {
        /* non-fatal — canvas falls back to defaults */
      });
  }, [params.id]);

  // Derived current page — null saat target = layout. Digunakan untuk semua
  // aksi yang page-scoped (save page, publish, page settings, preview, dsb).
  const current = useMemo(() => {
    if (!target || target.kind !== "page") return null;
    return pages.find((p) => p.id === target.pageId) ?? null;
  }, [pages, target]);

  // Convenience — apakah lagi di mode layout (header/footer bersama)?
  const isLayoutMode = target?.kind === "layout";

  // Hidden indices — blok Navbar / Footer di page tree
  // yang duplikat dengan shared layout aktif. Kita hide dari canvas + sidebar
  // supaya user tidak lihat 2 header/footer. Blok tetap di state (blocks
  // array) — user bisa munculkan lagi dengan toggle off shared layout.
  // Hanya berlaku di mode page — mode layout render blocks apa adanya.
  const hiddenIndices = useMemo(() => {
    if (isLayoutMode) return new Set<number>();
    return hiddenLayoutIndices(blocks, {
      headerActive: headerEnabled && layoutHeader.length > 0,
      footerActive: footerEnabled && layoutFooter.length > 0,
    });
  }, [
    blocks,
    isLayoutMode,
    headerEnabled,
    footerEnabled,
    layoutHeader.length,
    layoutFooter.length,
  ]);

  // selectTarget switch canvas ke target lain (page atau layout section).
  // Warn kalau ada dirty changes supaya tidak hilang tanpa sengaja.
  function selectTarget(next: EditorTarget) {
    if (targetsEqual(target, next)) return;
    // Blokir switch saat save in-flight — kalau autosave PATCH /pages/A masih
    // berjalan lalu user pindah ke Layout, response save bisa datang belakangan
    // dan overwrite state Layout yang baru di-load. Toast singkat + skip.
    if (saving) {
      toast.info("Tunggu save selesai sebelum pindah target");
      return;
    }
    if (blocksDirty && !confirm("Ada perubahan belum disimpan. Pindah target edit?")) return;
    let bs: BlockData[] = [];
    if (next.kind === "page") {
      const p = pages.find((x) => x.id === next.pageId);
      bs = p?.tree?.blocks ?? [];
    } else {
      bs = next.section === "header" ? layoutHeader : layoutFooter;
    }
    setTarget(next);
    replaceAll(bs);
    setBlockKeys(makeKeys(bs.length));
    setOriginalBlocks(bs);
    const initial: Path | null = bs.length ? [0] : null;
    setSelectedPath(initial);
    setSelectedPaths(initial ? new Set([pathKey(initial)]) : new Set());
  }

  // Backward-compat wrapper — banyak call site lama pakai selectPage(p).
  function selectPage(p: Page) {
    selectTarget({ kind: "page", pageId: p.id });
  }

  // toggleSectionEnabled langsung PATCH site — flag terpisah dari edit
  // blocks, jadi tidak perlu tunggu tombol Simpan. Set `saving=true` selama
  // request supaya autosave layout-mode tidak race (autosave check `!saving`
  // di useEffect autosave). Rollback + reset saving di finally.
  async function toggleSectionEnabled(section: "header" | "footer", next: boolean) {
    if (saving) return;
    const prevHeader = headerEnabled;
    const prevFooter = footerEnabled;
    const newHeader = section === "header" ? next : headerEnabled;
    const newFooter = section === "footer" ? next : footerEnabled;
    // Optimistic update UI + block autosave dari layout-mode edit yang lagi
    // dirty (autosave PATCH /sites/:id juga → potensi order-of-write).
    if (section === "header") setHeaderEnabled(next);
    else setFooterEnabled(next);
    setSaving(true);
    try {
      // Kalau target = layout mode DAN dirty, kirim blocks yang sedang
      // di-edit sebagai payload section itu — supaya toggle sekaligus commit
      // edit yang belum ke-save. Section lain pakai state layoutHeader/Footer
      // (last-saved).
      const currentHeader =
        target?.kind === "layout" && target.section === "header" ? blocks : layoutHeader;
      const currentFooter =
        target?.kind === "layout" && target.section === "footer" ? blocks : layoutFooter;
      await api(`/api/v1/sites/${params.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          layout: {
            header: currentHeader,
            footer: currentFooter,
            header_enabled: newHeader,
            footer_enabled: newFooter,
          },
        }),
      });
      // Sync state supaya originalBlocks/layoutHeader/Footer merefleksikan
      // apa yang baru saja di-persist — cegah blocksDirty stuck true.
      if (target?.kind === "layout" && target.section === "header") {
        setLayoutHeader(blocks);
        setOriginalBlocks(blocks);
      } else if (target?.kind === "layout" && target.section === "footer") {
        setLayoutFooter(blocks);
        setOriginalBlocks(blocks);
      }
      setSavedAt(Date.now());
      toast.success(
        next
          ? `${section === "header" ? "Header" : "Footer"} aktif di semua halaman`
          : `${section === "header" ? "Header" : "Footer"} disembunyikan dari semua halaman`,
      );
    } catch (e) {
      // Rollback.
      setHeaderEnabled(prevHeader);
      setFooterEnabled(prevFooter);
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  /**
   * Unified path-based selection handler.
   *   - shift-click: extend range within the SAME PARENT as the anchor.
   *     Cross-parent shift-click falls back to single-select — semantically
   *     ambiguous anyway (Figma does the same).
   *   - meta/ctrl-click: toggle the clicked path in the set.
   *   - plain click: single-select (clears the set to just this path).
   */
  function selectAt(path: Path, mods?: { shift?: boolean; meta?: boolean }) {
    const key = pathKey(path);
    if (mods?.shift && selectedPath && !samePath(selectedPath, path)) {
      // Only extend if both paths share the same parent (siblings).
      const sameParent =
        path.length === selectedPath.length &&
        path.slice(0, -1).every((n, i) => n === selectedPath[i]);
      if (sameParent) {
        const parent = path.slice(0, -1);
        const lo = Math.min(
          selectedPath[selectedPath.length - 1],
          path[path.length - 1],
        );
        const hi = Math.max(
          selectedPath[selectedPath.length - 1],
          path[path.length - 1],
        );
        const range = new Set<string>();
        for (let k = lo; k <= hi; k++) range.add(pathKey([...parent, k]));
        setSelectedPaths(range);
        setSelectedPath(path);
        return;
      }
    }
    if (mods?.meta) {
      setSelectedPaths((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
      setSelectedPath(path);
      return;
    }
    setSelectedPaths(new Set([key]));
    setSelectedPath(path);
  }
  // Convenience for top-level selection (still needed by SortableBlockList).
  function selectTopLevel(i: number, mods?: { shift?: boolean; meta?: boolean }) {
    selectAt([i], mods);
  }

  // Dirty checks — JSON.stringify is fine for the typical block-tree size and
  // gives a precise (false-negative-free) reading.
  const blocksDirty = useMemo(
    () => JSON.stringify(blocks) !== JSON.stringify(originalBlocks),
    [blocks, originalBlocks],
  );
  const themeDirty = useMemo(
    () => JSON.stringify(theme) !== JSON.stringify(originalTheme),
    [theme, originalTheme],
  );

  // CSS variables applied to the preview canvas wrapper. By overriding the
  // same shadcn HSL tokens the dashboard uses internally (primary, background,
  // foreground, secondary, radius), every `bg-primary` / `text-foreground`
  // class inside the canvas renders in the SITE'S colour — true WYSIWYG with
  // zero block-by-block rewrite. The renderer-style `--color-*` and
  // `--font-*` vars are also set so the same blocks that go to production
  // (which use `style={{background: "var(--color-primary)"}}`) match too.
  const canvasStyle = useMemo<React.CSSProperties>(() => {
    const c = theme.colors ?? {};
    const primary = c.primary ?? "#2563eb";
    const secondary = c.secondary ?? "#0ea5e9";
    const bg = c.bg ?? "#ffffff";
    const fg = c.fg ?? "#0f172a";
    const style: Record<string, string> = {
      // shadcn-style HSL tokens — override locally so tailwind classes pick
      // them up inside .wb-canvas only.
      "--background": hexToHslComponents(bg) ?? "0 0% 100%",
      "--foreground": hexToHslComponents(fg) ?? "222 47% 11%",
      "--card": hexToHslComponents(bg) ?? "0 0% 100%",
      "--card-foreground": hexToHslComponents(fg) ?? "222 47% 11%",
      "--primary": hexToHslComponents(primary) ?? "221 83% 53%",
      "--primary-foreground": readableForeground(primary),
      "--secondary": hexToHslComponents(secondary) ?? "199 89% 48%",
      "--secondary-foreground": readableForeground(secondary),
      "--muted": hexToHslComponents(fg) ?? "215 16% 47%",
      "--muted-foreground": hexToHslComponents(fg) ?? "215 16% 47%",
      "--border": hexToHslComponents(fg) ?? "214 32% 91%",
      "--input": hexToHslComponents(fg) ?? "214 32% 91%",
      "--ring": hexToHslComponents(primary) ?? "221 83% 53%",
      "--radius": theme.radius ?? "0.75rem",
      // Renderer-style raw colour vars (used by future inline-style blocks).
      "--color-primary": primary,
      "--color-secondary": secondary,
      "--color-bg": bg,
      "--color-fg": fg,
      // Font vars — read by .wb-canvas typography rules in globals.css.
      "--wb-font-heading": theme.font?.heading
        ? `"${theme.font.heading}", system-ui, sans-serif`
        : `"Inter", system-ui, sans-serif`,
      "--wb-font-body": theme.font?.body
        ? `"${theme.font.body}", system-ui, sans-serif`
        : `"Inter", system-ui, sans-serif`,
      // Apply background+foreground directly so even an empty canvas matches
      // the site (otherwise the dashboard's neutral grey shows through).
      backgroundColor: bg,
      color: fg,
    };
    return style as React.CSSProperties;
  }, [theme]);

  // -------- Block mutations --------
  // Every mutator must keep `blockKeys` aligned with `blocks` so the DnD
  // sortable context stays consistent across renders.

  function newKey() {
    return typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  }

  function addBlock(type: string, atIdx?: number) {
    const schema = schemaFor(type);
    if (!schema) return;
    const newBlock: BlockData = { type, props: structuredClone(schema.defaults) };
    insertNewBlock(newBlock, atIdx);
  }

  // Insert a pre-built BlockData (e.g. from a saved snippet). Deep-clones so
  // the saved snippet's reference isn't shared if the user inserts multiple
  // copies on the same page.
  function addBlockFromData(b: BlockData, atIdx?: number) {
    insertNewBlock(structuredClone(b), atIdx);
  }

  // Insert a top-level block. Nested inserts go through ChildrenEditor which
  // operates on the parent's children field directly; keeping this handler
  // top-level-only avoids two conflicting insertion paths.
  function insertNewBlock(block: BlockData, atIdx?: number) {
    const insertIdx = atIdx ?? blocks.length;
    const next = [...blocks.slice(0, insertIdx), block, ...blocks.slice(insertIdx)];
    const keys = [...blockKeys.slice(0, insertIdx), newKey(), ...blockKeys.slice(insertIdx)];
    setBlocks(next);
    setBlockKeys(keys);
    setSelectedPath([insertIdx]);
    setSelectedPaths(new Set([pathKey([insertIdx])]));
    setPaletteOpen(false);
  }

  // ============================================================
  // Path-based mutators — every mutation locates the target via a
  // Path (number[]). Top-level ops pass [i]; nested ops pass longer
  // paths. Block keys are only tracked for top-level (DnD sortable).
  // ============================================================

  function updateBlock(path: Path, next: BlockData) {
    setBlocks(updateAt(blocks, path, () => next));
  }

  function removeBlock(path: Path) {
    removeBlocks([path]);
  }

  // Bulk delete — removes each path in one state update so history records ONE
  // undo step. Deepest-first ordering handled by paths.removeMany.
  function removeBlocks(paths: Path[]) {
    if (paths.length === 0) return;
    const valid = paths.filter((p) => getAt(blocks, p) !== undefined);
    if (valid.length === 0) return;
    const next = removeMany(blocks, valid);
    setBlocks(next);
    // Prune top-level keys — only removes at depth 1 shift blockKeys.
    const removedTop = valid
      .filter((p) => p.length === 1)
      .map((p) => p[0])
      .sort((a, b) => b - a);
    if (removedTop.length) {
      const keys = [...blockKeys];
      for (const i of removedTop) keys.splice(i, 1);
      setBlockKeys(keys);
    }
    // Re-anchor selection near the removed anchor.
    if (selectedPath && paths.some((p) => samePath(p, selectedPath))) {
      const parent = selectedPath.slice(0, -1);
      const siblings =
        parent.length === 0 ? next : getAt(next, parent)?.children ?? [];
      if (siblings.length === 0) {
        if (parent.length > 0) {
          setSelectedPath(parent);
          setSelectedPaths(new Set([pathKey(parent)]));
        } else {
          setSelectedPath(null);
          setSelectedPaths(new Set());
        }
      } else {
        const lastIdx = selectedPath[selectedPath.length - 1];
        const anchor = Math.max(0, Math.min(lastIdx, siblings.length - 1));
        const np = [...parent, anchor];
        setSelectedPath(np);
        setSelectedPaths(new Set([pathKey(np)]));
      }
    }
  }

  function moveBlock(path: Path, dir: -1 | 1) {
    const { tree, newPath } = moveAtPath(blocks, path, dir);
    if (tree === blocks) return;
    setBlocks(tree);
    if (path.length === 1) {
      const j = path[0] + dir;
      const keys = [...blockKeys];
      [keys[path[0]], keys[j]] = [keys[j], keys[path[0]]];
      setBlockKeys(keys);
    }
    if (selectedPath && samePath(selectedPath, path)) {
      setSelectedPath(newPath);
      setSelectedPaths(new Set([pathKey(newPath)]));
    }
  }

  // moveTo — path-based cross-parent move used by canvas nested DnD.
  // Handles the same-parent forward-move index shift via paths.movePath.
  function moveTo(fromPath: Path, toParent: Path, at: number) {
    const { tree, newPath } = movePathHelper(blocks, fromPath, toParent, at);
    if (tree === blocks) return;
    setBlocks(tree);
    // If a TOP-LEVEL slot moved, block keys need to stay aligned. Reuse
    // reorderWithKeys when both from + to are top-level (same parent []).
    const fromTop = fromPath.length === 1;
    const toTop = toParent.length === 0;
    if (fromTop && toTop) {
      const insertIdx =
        toParent.length === 0 && at > fromPath[0] ? at - 1 : at;
      const { keys } = reorderWithKeys(blocks, blockKeys, fromPath[0], insertIdx);
      setBlockKeys(keys);
    } else if (fromTop && !toTop) {
      // Block left the top-level list — remove its key.
      const keys = [...blockKeys];
      keys.splice(fromPath[0], 1);
      setBlockKeys(keys);
    } else if (!fromTop && toTop) {
      // Block promoted from nested to top-level — mint a fresh key at `at`.
      const keys = [...blockKeys];
      keys.splice(at, 0, newKey());
      setBlockKeys(keys);
    }
    setSelectedPath(newPath);
    setSelectedPaths(new Set([pathKey(newPath)]));
  }

  function reorderBlocks(from: number, to: number) {
    if (from === to) return;
    const { keys } = reorderWithKeys(blocks, blockKeys, from, to);
    setBlocks(reorderSiblings(blocks, [], from, to));
    setBlockKeys(keys);
    if (selectedPath && selectedPath.length === 1) {
      const i = selectedPath[0];
      let newI = i;
      if (i === from) newI = to;
      else if (from < i && to >= i) newI = i - 1;
      else if (from > i && to <= i) newI = i + 1;
      if (newI !== i) {
        setSelectedPath([newI]);
        setSelectedPaths(new Set([pathKey([newI])]));
      }
    }
  }

  function duplicateBlock(path: Path) {
    duplicateBlocks([path]);
  }

  function duplicateBlocks(paths: Path[]) {
    if (paths.length === 0) return;
    // Deepest-first + rightmost-first so subsequent inserts don't shift
    // earlier target indices.
    const sorted = [...paths].sort((a, b) => {
      if (a.length !== b.length) return b.length - a.length;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return b[i] - a[i];
      return 0;
    });
    let tree = blocks;
    let anchor: Path | null = null;
    const insertedTop: number[] = [];
    for (const p of sorted) {
      const r = duplicateAtPath(tree, p);
      tree = r.tree;
      anchor = r.newPath;
      if (p.length === 1) insertedTop.push(r.newPath[0]);
    }
    setBlocks(tree);
    if (insertedTop.length) {
      const keys = [...blockKeys];
      const asc = [...insertedTop].sort((a, b) => a - b);
      for (let n = 0; n < asc.length; n++) keys.splice(asc[n] + n, 0, newKey());
      setBlockKeys(keys);
    }
    if (anchor) {
      setSelectedPath(anchor);
      setSelectedPaths(
        new Set(
          sorted.map((p) => pathKey([...p.slice(0, -1), p[p.length - 1] + 1])),
        ),
      );
    }
  }

  function copyBlock(path: Path) {
    copyBlocks([path]);
  }

  function copyBlocks(paths: Path[]) {
    if (paths.length === 0) return;
    const out = paths
      .map((p) => getAt(blocks, p))
      .filter((b): b is BlockData => Boolean(b))
      .map((b) => structuredClone(b));
    if (out.length === 0) return;
    setClipboard(out);
    if (out.length === 1) {
      toast.success(`Disalin: ${schemaFor(out[0].type)?.label ?? out[0].type}`);
    } else {
      toast.success(`Disalin: ${out.length} block`);
    }
  }

  function pasteBlock() {
    if (!clipboard || clipboard.length === 0) return;
    const anchor = selectedPath;
    const parent: Path = anchor ? anchor.slice(0, -1) : [];
    const at = anchor ? anchor[anchor.length - 1] + 1 : blocks.length;
    let tree = blocks;
    for (let n = 0; n < clipboard.length; n++) {
      tree = insertAt(tree, parent, at + n, structuredClone(clipboard[n]));
    }
    setBlocks(tree);
    if (parent.length === 0) {
      const keys = [...blockKeys];
      const newKeys = clipboard.map(() => newKey());
      keys.splice(at, 0, ...newKeys);
      setBlockKeys(keys);
    }
    const newSel = new Set<string>();
    for (let n = 0; n < clipboard.length; n++) newSel.add(pathKey([...parent, at + n]));
    setSelectedPaths(newSel);
    setSelectedPath([...parent, at]);
  }

  async function saveSnippet(path: Path) {
    const b = getAt(blocks, path);
    if (!b) return;
    const schema = schemaFor(b.type);
    const name = window.prompt("Beri nama snippet:", schema?.label ?? b.type);
    if (!name || !name.trim()) return;
    try {
      await api(`/api/v1/snippets`, {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          block_type: b.type,
          block: structuredClone(b),
        }),
      });
      toast.success(`Snippet "${name.trim()}" tersimpan`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  // savedAt — wall clock for "Tersimpan otomatis 12 dtk lalu" display.
  const [savedAt, setSavedAt] = useState<number | null>(null);
  // Marks whether the upcoming save was triggered by autosave (silent) vs
  // an explicit user action (toast).
  const autosaveRef = useRef(false);

  async function save(opts?: { silent?: boolean }) {
    if (!target) return;
    setSaving(true);
    try {
      if (target.kind === "page") {
        const updated = await api<Page>(`/api/v1/pages/${target.pageId}`, {
          method: "PATCH",
          body: JSON.stringify({ tree: { blocks } }),
        });
        setPages((ps) => ps.map((p) => (p.id === updated.id ? updated : p)));
        setOriginalBlocks(blocks);
        setSavedAt(Date.now());
        if (!opts?.silent) toast.success("Halaman tersimpan");
      } else {
        // Layout mode — PATCH site dengan payload penuh header+footer supaya
        // section yang tidak lagi di-edit tidak ke-reset. Enabled flags ikut
        // dikirim eksplisit supaya user bisa toggle off tanpa hapus blocks.
        const nextHeader = target.section === "header" ? blocks : layoutHeader;
        const nextFooter = target.section === "footer" ? blocks : layoutFooter;
        // Auto-sync flag: kalau section yang di-save sekarang berubah dari
        // kosong → punya blok (user baru pertama kali isi header/footer),
        // paksa enabled=true supaya konten yang baru di-add otomatis
        // ter-render. Extraction migrasi sebelumnya bisa set enabled=false
        // karena section kosong; tanpa auto-sync ini, user harus manual klik
        // toggle → membingungkan.
        let nextHeaderEnabled = headerEnabled;
        let nextFooterEnabled = footerEnabled;
        if (target.section === "header" && layoutHeader.length === 0 && blocks.length > 0) {
          nextHeaderEnabled = true;
        }
        if (target.section === "footer" && layoutFooter.length === 0 && blocks.length > 0) {
          nextFooterEnabled = true;
        }
        await api(`/api/v1/sites/${params.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            layout: {
              header: nextHeader,
              footer: nextFooter,
              header_enabled: nextHeaderEnabled,
              footer_enabled: nextFooterEnabled,
            },
          }),
        });
        // Sync local state dengan hasil auto-sync supaya UI toggle langsung
        // reflect state baru.
        if (nextHeaderEnabled !== headerEnabled) setHeaderEnabled(nextHeaderEnabled);
        if (nextFooterEnabled !== footerEnabled) setFooterEnabled(nextFooterEnabled);
        if (target.section === "header") setLayoutHeader(blocks);
        else setLayoutFooter(blocks);
        setOriginalBlocks(blocks);
        setSavedAt(Date.now());
        if (!opts?.silent) {
          toast.success(
            target.section === "header"
              ? "Header tersimpan — berlaku di semua halaman"
              : "Footer tersimpan — berlaku di semua halaman",
          );
        }
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  // -------- Publish (draft → live) --------
  const [publishing, setPublishing] = useState(false);

  async function publish() {
    // Publish hanya untuk page — layout auto-live saat save (tidak ada
    // konsep draft vs published untuk layout bersama).
    if (!current) return;
    // Always save draft first so the live copy reflects the latest edits.
    if (blocksDirty) {
      try {
        await save({ silent: true });
      } catch {
        return; // save() already toasted the error
      }
    }
    setPublishing(true);
    try {
      const updated = await api<Page>(`/api/v1/pages/${current.id}/publish`, {
        method: "POST",
      });
      setPages((ps) => ps.map((p) => (p.id === updated.id ? updated : p)));
      toast.success("Halaman live ✓");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPublishing(false);
    }
  }

  // True when the draft has unpublished edits (or page has never been published).
  // Untuk layout mode selalu false — layout tidak punya draft/published split,
  // save langsung live.
  const hasUnpublishedChanges = useMemo(() => {
    if (!current) return false;
    if (!current.published_at) return blocks.length > 0; // never published
    const liveBlocks = current.published_tree?.blocks ?? [];
    // Compare against the LAST SAVED draft (originalBlocks), not the current
    // unsaved one — autosave will commit the dirty draft shortly. Without this
    // the indicator flickers while the user types.
    return JSON.stringify(originalBlocks) !== JSON.stringify(liveBlocks);
  }, [current, blocks, originalBlocks]);

  // -------- Preview link --------
  // Open share dialog — dialog handles token generation + copy/share + expiry.
  // Save-first kalau draft dirty supaya reviewer lihat state terakhir editor.
  function openPreview() {
    if (!current) return;
    setPreviewOpen(true);
  }

  // Dipanggil PreviewShareDialog sebelum POST /preview-token supaya token
  // yang di-generate merefleksikan draft terbaru (blocks yang belum di-save
  // tidak muncul di preview kalau kita skip save).
  async function savePreviewIfDirty() {
    if (blocksDirty) {
      await save({ silent: true });
    }
  }

  async function saveTheme() {
    setSavingTheme(true);
    try {
      await api(`/api/v1/sites/${params.id}`, {
        method: "PATCH",
        body: JSON.stringify({ theme }),
      });
      setOriginalTheme(theme);
      toast.success("Tema tersimpan");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSavingTheme(false);
    }
  }

  // -------- Autosave --------
  // Debounce 3s. Fires when blocks change AND there are dirty changes AND we
  // aren't already saving. Manual save (⌘S / Simpan button) clears the
  // pending timer so we don't double-fire. Target switch also clears it.
  useEffect(() => {
    if (!target || !blocksDirty || saving) return;
    const handle = window.setTimeout(() => {
      autosaveRef.current = true;
      save({ silent: true }).finally(() => {
        autosaveRef.current = false;
      });
    }, 3000);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks, target, blocksDirty, saving]);

  // Keyboard shortcuts — global. We ignore shortcuts while the user is typing
  // in an input/textarea/contentEditable so inline edit isn't hijacked.
  useEffect(() => {
    function isEditingTarget(t: EventTarget | null): boolean {
      const el = t as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        el.isContentEditable === true
      );
    }

    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      const editing = isEditingTarget(e.target);

      // ⌘S — save (always, even while editing — user expectation)
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        save();
        return;
      }

      // ⌘Z / ⌘⇧Z — undo / redo
      if (mod && e.key.toLowerCase() === "z") {
        // Don't fight the browser's built-in undo when typing.
        if (editing) return;
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        if (editing) return;
        e.preventDefault();
        redo();
        return;
      }

      // Materialise the current selection as an array of Paths — used by
      // all bulk-aware shortcuts below.
      const currentPaths: Path[] = [...selectedPaths].map(keyToPath);

      // ⌘D — duplicate (bulk when multi-selected)
      if (mod && e.key.toLowerCase() === "d") {
        if (editing) return;
        e.preventDefault();
        if (currentPaths.length > 1) duplicateBlocks(currentPaths);
        else if (selectedPath) duplicateBlock(selectedPath);
        return;
      }

      // ⌘C / ⌘V — copy/paste (bulk-aware)
      if (mod && e.key.toLowerCase() === "c") {
        if (editing) return;
        if (currentPaths.length > 0) {
          e.preventDefault();
          copyBlocks(currentPaths);
        } else if (selectedPath) {
          e.preventDefault();
          copyBlock(selectedPath);
        }
        return;
      }
      if (mod && e.key.toLowerCase() === "v") {
        if (editing) return;
        if (clipboard) {
          e.preventDefault();
          pasteBlock();
        }
        return;
      }

      // ⌘A — select all TOP-LEVEL blocks (nested Cmd+A is niche + confusing).
      if (mod && e.key.toLowerCase() === "a") {
        if (editing) return;
        if (blocks.length === 0) return;
        e.preventDefault();
        setSelectedPaths(new Set(blocks.map((_, i) => pathKey([i]))));
        return;
      }

      // Delete / Backspace — bulk delete when multi-selected
      if ((e.key === "Delete" || e.key === "Backspace") && !editing) {
        if (currentPaths.length > 1) {
          e.preventDefault();
          if (confirm(`Hapus ${currentPaths.length} block?`)) {
            removeBlocks(currentPaths);
          }
          return;
        }
        if (selectedPath) {
          e.preventDefault();
          const target = getAt(blocks, selectedPath);
          const schema = schemaFor(target?.type ?? "");
          if (confirm(`Hapus block "${schema?.label ?? target?.type}"?`)) {
            removeBlock(selectedPath);
          }
        }
        return;
      }

      // / — open palette
      if (e.key === "/" && !editing) {
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }

      // ↑ / ↓ — navigate block list (when not editing)
      // Esc — navigate up one path level (Webflow-style parent traversal).
      // At top-level, clears selection instead so hitting Esc twice = deselect.
      if (e.key === "Escape" && !editing) {
        if (selectedPath && selectedPath.length > 1) {
          e.preventDefault();
          const parent = selectedPath.slice(0, -1);
          setSelectedPath(parent);
          setSelectedPaths(new Set([pathKey(parent)]));
          return;
        }
        if (selectedPath && selectedPath.length === 1) {
          e.preventDefault();
          setSelectedPath(null);
          setSelectedPaths(new Set());
          return;
        }
      }

      if (!editing && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        if (blocks.length === 0) return;
        e.preventDefault();
        const dir = e.key === "ArrowUp" ? -1 : 1;
        // Move within the anchor's parent — supports nested navigation.
        const anchor = selectedPath ?? [0];
        const parent = anchor.slice(0, -1);
        const sibs = siblingsOf(blocks, anchor);
        const cur = anchor[anchor.length - 1] ?? 0;
        const nextIdx = Math.max(0, Math.min(sibs.length - 1, cur + dir));
        const np = [...parent, nextIdx];
        setSelectedPath(np);
        setSelectedPaths(new Set([pathKey(np)]));
        return;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks, current, selectedPath, selectedPaths, clipboard, canUndo, canRedo]);

  const previewWidth = device === "mobile" ? 375 : device === "tablet" ? 768 : "100%";

  // renderPropEditorBody — dipakai dua tempat: aside kanan (desktop) dan
  // bottom sheet Dialog (mobile). Ekstrak sebagai closure supaya bisa akses
  // state (selectedPath, blocks, updateBlock, dst.) tanpa prop drilling.
  function renderPropEditorBody() {
    const anchor = selectedPath;
    const target = anchor ? getAt(blocks, anchor) : undefined;
    if (!anchor || !target) {
      return (
        <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-2 text-center">
          <div className="grid size-12 place-items-center rounded-xl bg-muted">
            <Sparkles className="size-5 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium">Pilih block</p>
          <p className="text-xs text-muted-foreground">
            Klik block di sidebar atau di preview untuk mengedit propertinya.
          </p>
        </div>
      );
    }
    const crumbs: Array<{ path: Path; label: string; emoji: string }> = [];
    for (let d = 1; d <= anchor.length; d++) {
      const sub = anchor.slice(0, d);
      const b = getAt(blocks, sub);
      if (!b) break;
      const s = schemaFor(b.type);
      crumbs.push({
        path: sub,
        label: s?.label ?? b.type,
        emoji: s?.emoji ?? "🧩",
      });
    }
    return (
      <>
        {crumbs.length > 1 && (
          <nav
            aria-label="Breadcrumb"
            className="mb-2 flex flex-wrap items-center gap-0.5 text-[10px] text-muted-foreground"
          >
            {crumbs.map((c, i) => {
              const isLast = i === crumbs.length - 1;
              return (
                <span key={i} className="inline-flex items-center">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedPath(c.path);
                      setSelectedPaths(new Set([pathKey(c.path)]));
                    }}
                    disabled={isLast}
                    className={cn(
                      "inline-flex items-center gap-0.5 rounded px-1 py-0.5",
                      isLast
                        ? "font-medium text-foreground"
                        : "hover:bg-muted hover:text-foreground",
                    )}
                    title={`Pindah ke ${c.label}`}
                  >
                    <span className="text-[11px]">{c.emoji}</span>
                    <span className="truncate">{c.label}</span>
                  </button>
                  {!isLast && <span className="mx-0.5 opacity-40">›</span>}
                </span>
              );
            })}
          </nav>
        )}
        <div className="mb-3 flex items-start gap-2">
          <span className="text-xl">{schemaFor(target.type)?.emoji ?? "🧩"}</span>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold">
              {schemaFor(target.type)?.label ?? target.type}
            </h3>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {schemaFor(target.type)?.description ?? "Edit properti di bawah"}
            </p>
          </div>
          {anchor.length > 1 && (
            <button
              type="button"
              onClick={() => {
                const parent = anchor.slice(0, -1);
                setSelectedPath(parent);
                setSelectedPaths(new Set([pathKey(parent)]));
              }}
              className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              title="Pilih block induk (Esc)"
            >
              ↖
            </button>
          )}
        </div>
        <Separator className="mb-4" />
        <PropEditor block={target} onChange={(next) => updateBlock(anchor, next)} />
        {isContainer(target.type) && (
          <>
            <Separator className="my-4" />
            <ChildrenEditor block={target} onChange={(next) => updateBlock(anchor, next)} />
          </>
        )}
        <Separator className="my-4" />
        <LayoutPanel
          block={target}
          onChange={(next) => updateBlock(anchor, next)}
          device={device}
          onDeviceChange={setDevice}
        />
      </>
    );
  }

  return (
    <SiteProductsContext.Provider value={siteProducts}>
    <div
      className={cn(
        "flex h-[calc(100vh-140px)] flex-col gap-3",
        // Mobile: pad bottom supaya FAB tidak nutupin canvas content
        isMobile && "pb-16",
      )}
    >
      {/* ---------- Toolbar (full width — spans over aside area so nothing gets cut) ---------- */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-3 py-2 shadow-sm">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="hidden size-7 lg:inline-flex"
            onClick={() => setLeftCollapsed((v) => !v)}
            title={leftCollapsed ? "Tampilkan sidebar kiri" : "Sembunyikan sidebar kiri"}
          >
            {leftCollapsed ? (
              <PanelLeftOpen className="size-3.5" />
            ) : (
              <PanelLeftClose className="size-3.5" />
            )}
          </Button>
          <div className="inline-flex items-center gap-0.5 rounded-md bg-muted p-0.5 shadow-inner">
            <DeviceBtn
              active={device === "desktop"}
              onClick={() => setDevice("desktop")}
              icon={Monitor}
              label="Desktop"
            />
            <DeviceBtn
              active={device === "tablet"}
              onClick={() => setDevice("tablet")}
              icon={Tablet}
              label="Tablet"
            />
            <DeviceBtn
              active={device === "mobile"}
              onClick={() => setDevice("mobile")}
              icon={Smartphone}
              label="Mobile"
            />
          </div>
          <span className="hidden items-center gap-1 text-[11px] text-muted-foreground md:inline-flex">
            <Eye className="size-3" />
            {device === "desktop" ? "Auto" : device === "tablet" ? "768px" : "375px"}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className={cn("size-7", miniMapVisible && "bg-muted text-foreground")}
            onClick={() => setMiniMapVisible((v) => !v)}
            title={miniMapVisible ? "Sembunyikan mini-map" : "Tampilkan mini-map"}
          >
            <MapIcon className="size-3.5" />
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <div className="inline-flex items-center gap-0.5 rounded-md border bg-background p-0.5 shadow-sm">
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={undo}
              disabled={!canUndo}
              title="Undo (⌘Z)"
            >
              <Undo2 className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={redo}
              disabled={!canRedo}
              title="Redo (⌘⇧Z)"
            >
              <Redo2 className="size-3.5" />
            </Button>
          </div>
          {/* Non-essential buttons — hide di mobile, ada di overflow menu.
              md: threshold cocok karena mobile portrait sudah punya
              breathing room mulai dari tablet. */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setThemeOpen(true)}
            className="relative hidden gap-1.5 md:inline-flex"
          >
            <Palette className="size-3.5" />
            <span className="hidden sm:inline">Tema</span>
            {themeDirty && (
              <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-amber-500 ring-2 ring-card" />
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={openPreview}
            disabled={!current}
            className="hidden gap-1.5 md:inline-flex"
            title="Bagikan link pratinjau draft — berlaku 1 jam"
          >
            <Eye className="size-3.5" />
            <span className="hidden sm:inline">Pratinjau</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSettingsOpen(true)}
            disabled={!current}
            className="hidden gap-1.5 md:inline-flex"
            title="Pengaturan halaman: judul, SEO, status"
          >
            <Settings2 className="size-3.5" />
            <span className="hidden sm:inline">Pengaturan</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setHistoryOpen(true)}
            disabled={!current}
            className="hidden gap-1.5 md:inline-flex"
          >
            <History className="size-3.5" />
            <span className="hidden sm:inline">Riwayat</span>
          </Button>

          {/* Mobile-only overflow menu — akses Tema/Pratinjau/Pengaturan/
              Riwayat via dropdown supaya toolbar tetap ringkas. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="size-8 md:hidden"
                title="Menu lain"
                disabled={!current}
              >
                <MoreHorizontal className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setThemeOpen(true)}>
                <Palette className="size-3.5" />
                Tema
                {themeDirty && (
                  <span className="ml-auto size-1.5 rounded-full bg-amber-500" />
                )}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={openPreview} disabled={!current}>
                <Eye className="size-3.5" />
                Pratinjau
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setSettingsOpen(true)}
                disabled={!current}
              >
                <Settings2 className="size-3.5" />
                Pengaturan halaman
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setHistoryOpen(true)}
                disabled={!current}
              >
                <History className="size-3.5" />
                Riwayat
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="outline"
            onClick={() => save()}
            disabled={saving || !target || !blocksDirty}
            size="sm"
            className="relative gap-1.5"
          >
            <Save className="size-3.5" />
            {saving
              ? "Menyimpan…"
              : isLayoutMode
                ? "Simpan Layout"
                : "Simpan Draft"}
            {blocksDirty && !saving && (
              <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-amber-400 ring-2 ring-card" />
            )}
          </Button>
          {current?.scheduled_publish_at && (
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-900 transition-colors hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
              title={`Terjadwal untuk publikasi: ${new Date(current.scheduled_publish_at).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })}. Klik untuk kelola jadwal.`}
            >
              <CalendarClock className="size-3.5" />
              <span className="hidden sm:inline">
                {formatScheduleShort(current.scheduled_publish_at)}
              </span>
            </button>
          )}
          <Button
            onClick={publish}
            disabled={publishing || !current || (!hasUnpublishedChanges && !blocksDirty)}
            size="sm"
            className="relative gap-1.5 shadow-sm"
            title="Salin draft ke versi live yang ditampilkan ke pengunjung"
          >
            <Rocket className="size-3.5" />
            {publishing ? "Menerbitkan…" : "Terbitkan"}
            {hasUnpublishedChanges && !publishing && (
              <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-emerald-400 ring-2 ring-primary" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="hidden size-7 lg:inline-flex"
            onClick={() => setRightCollapsed((v) => !v)}
            title={rightCollapsed ? "Tampilkan panel kanan" : "Sembunyikan panel kanan"}
          >
            {rightCollapsed ? (
              <PanelRightOpen className="size-3.5" />
            ) : (
              <PanelRightClose className="size-3.5" />
            )}
          </Button>
        </div>
      </div>

      {/* ---------- Grid: 3-column workspace (aside kiri | canvas | aside kanan) ---------- */}
      <div
        className="grid min-h-0 flex-1 gap-3 transition-[grid-template-columns] duration-200 ease-out"
        style={{ gridTemplateColumns: gridCols }}
      >
      {/* ---------- Sidebar kiri: Pages + Block tree ---------- */}
      <aside
        className={cn(
          "flex flex-col overflow-hidden rounded-xl border bg-card shadow-sm transition-all",
          leftCollapsed && "pointer-events-none border-transparent bg-transparent opacity-0",
          // Mobile: sembunyikan aside kiri, canvas ambil full width. Trigger
          // via palette dialog (FAB bawah).
          isMobile && "hidden",
        )}
      >
        {/* Layout bersama — header/footer per situs, berlaku di semua halaman */}
        <div className="border-b p-3">
          <div className="mb-2 flex items-center gap-1.5">
            <Layers className="size-3.5 text-muted-foreground" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Layout Bersama
            </span>
          </div>
          <ul className="space-y-0.5">
            {(["header", "footer"] as const).map((section) => {
              const active =
                target?.kind === "layout" && target.section === section;
              const label = section === "header" ? "Header" : "Footer";
              return (
                <li key={section}>
                  <button
                    onClick={() => selectTarget({ kind: "layout", section })}
                    disabled={!siteLoaded}
                    className={cn(
                      "group flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition-all",
                      active
                        ? "bg-primary/10 font-medium text-primary"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      !siteLoaded && "cursor-not-allowed opacity-50",
                    )}
                  >
                    <span className="truncate">{label}</span>
                    <span
                      className={cn(
                        "ml-2 rounded-full px-1.5 py-0 text-[9px] font-medium uppercase",
                        active
                          ? "bg-primary/20 text-primary"
                          : "bg-muted text-muted-foreground",
                      )}
                      title="Berlaku untuk seluruh halaman"
                    >
                      semua
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Pages list — cap tinggi + scroll kalau banyak halaman (10+).
            Alasan: dulu list unbounded → page kedua ke bawah dorong seksi
            Block tree keluar viewport, user harus scroll banyak buat pindah
            halaman. Cap 220px (~6 halaman visible) + scroll internal. */}
        <div className="border-b p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Layers className="size-3.5 text-muted-foreground" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Halaman
              </span>
            </div>
            {pages.length > 0 && (
              <span className="text-[10px] font-semibold text-muted-foreground">
                {pages.length}
              </span>
            )}
          </div>
          <ul className="max-h-[220px] space-y-0.5 overflow-y-auto pr-0.5">
            {pages.map((p) => (
              <li key={p.id}>
                <button
                  onClick={() => selectPage(p)}
                  className={cn(
                    "group flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm transition-all",
                    target?.kind === "page" && target.pageId === p.id
                      ? "bg-primary/10 font-medium text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <span className="truncate">{p.title || p.slug}</span>
                  {p.is_home && (
                    <span
                      className={cn(
                        "ml-2 rounded-full px-1.5 py-0 text-[9px] font-medium uppercase",
                        target?.kind === "page" && target.pageId === p.id
                          ? "bg-primary/20 text-primary"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      home
                    </span>
                  )}
                </button>
              </li>
            ))}
            {pages.length === 0 && (
              <li className="px-2 py-3 text-xs text-muted-foreground">Memuat…</li>
            )}
          </ul>
        </div>

        {/* Block tree */}
        <div className="flex-1 overflow-y-auto p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Sparkles className="size-3.5 text-muted-foreground" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Block ({blocks.length})
              </span>
            </div>
            <Button
              size="sm"
              variant="default"
              onClick={() => setPaletteOpen(true)}
              className="h-7 gap-1 px-2 shadow-sm"
            >
              <Plus className="size-3" />
              Tambah
            </Button>
          </div>

          {blocks.length === 0 ? (
            <button
              onClick={() => setPaletteOpen(true)}
              className="flex w-full flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-input py-8 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
            >
              <Plus className="size-4" />
              Tambah block pertama
            </button>
          ) : (
            <SortableBlockList
              blocks={blocks}
              keys={blockKeys}
              selectedIdx={selectedIdx}
              // Convert path-set → int-set for the flat sidebar. Only paths
              // of length 1 (top-level) render as highlighted in the sidebar.
              selectedIndices={
                new Set(
                  [...selectedPaths]
                    .map(keyToPath)
                    .filter((p) => p.length === 1)
                    .map((p) => p[0]),
                )
              }
              onSelect={(i, mods) => selectAt([i], mods)}
              onReorder={reorderBlocks}
              onMove={(i, dir) => moveBlock([i], dir)}
              onDuplicate={(i) => duplicateBlock([i])}
              onDelete={(i) => removeBlock([i])}
              hiddenIndices={hiddenIndices}
            />
          )}
        </div>
      </aside>

      {/* ---------- Center: Preview ---------- */}
      <section className="flex flex-col overflow-hidden rounded-xl border bg-card shadow-sm">
        {/* Canvas — browser-like frame. Outer wrapper paints dashboard chrome
            (browser top bar uses dashboard tokens); INNER .wb-canvas applies
            the site theme so blocks inside render in the user's palette/fonts.
            Position relative so the mini-map can pin to its edge. */}
        <div ref={canvasScrollRef} className="relative flex-1 overflow-auto bg-muted/30 p-4">
          {miniMapVisible && (
            <MiniMap
              blocks={blocks}
              keys={blockKeys}
              selectedIdx={selectedIdx}
              // Mini-map still flat — only reflects top-level highlights.
              selectedIndices={
                new Set(
                  [...selectedPaths]
                    .map(keyToPath)
                    .filter((p) => p.length === 1)
                    .map((p) => p[0]),
                )
              }
              onJump={(i) => {
                setSelectedPath([i]);
                setSelectedPaths(new Set([pathKey([i])]));
              }}
              scrollContainerRef={canvasScrollRef}
            />
          )}
          <div
            className="mx-auto overflow-hidden rounded-xl border border-foreground/10 shadow-lg transition-all duration-300 ease-out"
            style={{ width: previewWidth, maxWidth: "100%" }}
          >
            {/* Fake browser chrome (dashboard-tokened, not themed) */}
            <div className="flex items-center gap-1.5 border-b bg-muted/40 px-3 py-2">
              <span className="size-2.5 rounded-full bg-red-400" />
              <span className="size-2.5 rounded-full bg-amber-400" />
              <span className="size-2.5 rounded-full bg-emerald-400" />
              <div className="mx-3 flex-1 truncate rounded-md bg-background px-2.5 py-0.5 text-[10px] text-muted-foreground">
                {isLayoutMode
                  ? target?.kind === "layout" && target.section === "header"
                    ? "layout: header · semua halaman"
                    : "layout: footer · semua halaman"
                  : current
                    ? `${current.slug === "home" ? "" : "/" + current.slug}`
                    : "/"}
              </div>
            </div>
            {/* Layout mode notice + toggle aktif — muncul tepat di atas canvas
                supaya jelas bahwa edit di sini berlaku untuk semua halaman.
                Toggle langsung PATCH site (fire-and-forget) — flag tidak masuk
                dirty-tracking blocks. */}
            {isLayoutMode && target?.kind === "layout" && (
              <LayoutModeNotice
                section={target.section}
                enabled={
                  target.section === "header" ? headerEnabled : footerEnabled
                }
                onToggle={(next) => toggleSectionEnabled(target.section, next)}
              />
            )}
            {/* Shared header preview (page mode) — render read-only supaya user
                lihat tampilan halaman lengkap dengan shared layout. Klik → jump
                ke mode Header. Kalau flag nonaktif / blocks kosong, di-skip. */}
            {!isLayoutMode && layoutHeader.length > 0 && headerEnabled && (
              <LayoutReadonlyStrip
                section="header"
                blocks={layoutHeader}
                device={device}
                canvasStyle={canvasStyle}
                onEdit={() => selectTarget({ kind: "layout", section: "header" })}
              />
            )}
            <div
              className="wb-canvas"
              style={canvasStyle}
              // Editor-mode: cegah navigasi keluar saat klik <a> (Navbar link,
              // Hero CTA, Footer link, dsb.) — user hampir selalu bermaksud
              // pilih block, bukan pindah halaman. Capture phase supaya jalan
              // sebelum browser trigger default anchor action, tapi tidak
              // stopPropagation → onClick block wrapper tetap fire untuk select.
              // Form submit juga dicegah supaya block Form tidak POST.
              onClickCapture={(e) => {
                const el = e.target as HTMLElement;
                if (el.closest("a")) e.preventDefault();
              }}
              onSubmitCapture={(e) => e.preventDefault()}
            >
              <Preview
                blocks={blocks}
                keys={blockKeys}
                selectedPath={selectedPath}
                onSelect={selectAt}
                onAdd={() => setPaletteOpen(true)}
                onUpdate={updateBlock}
                onMove={moveBlock}
                onDuplicate={duplicateBlock}
                onSaveSnippet={saveSnippet}
                onDelete={removeBlock}
                onMoveTo={moveTo}
                device={device}
                hiddenIndices={hiddenIndices}
              />
            </div>
            {/* Shared footer preview — mirror header di atas. */}
            {!isLayoutMode && layoutFooter.length > 0 && footerEnabled && (
              <LayoutReadonlyStrip
                section="footer"
                blocks={layoutFooter}
                device={device}
                canvasStyle={canvasStyle}
                onEdit={() => selectTarget({ kind: "layout", section: "footer" })}
              />
            )}
          </div>
        </div>

        {/* Status bar: dirty state + keyboard hints */}
        <div className="flex items-center justify-between gap-3 border-t bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5">
              {saving ? (
                <>
                  <Loader2 className="size-3 animate-spin" />
                  Menyimpan…
                </>
              ) : blocksDirty ? (
                <>
                  <span className="size-1.5 animate-pulse rounded-full bg-amber-500" />
                  Belum disimpan · autosave 3 dtk
                </>
              ) : (
                <>
                  <span className="size-1.5 rounded-full bg-emerald-500" />
                  <SavedAgo at={savedAt} />
                </>
              )}
            </span>
            <Separator orientation="vertical" className="h-3" />
            <span className="hidden sm:inline">
              {blocks.length} block · halaman {pages.length}
              {selectedPaths.size > 1 && (
                <>
                  {" · "}
                  <span className="font-medium text-primary">
                    {selectedPaths.size} dipilih
                  </span>
                </>
              )}
            </span>
            <Separator orientation="vertical" className="hidden h-3 sm:block" />
            <span className="hidden items-center gap-1.5 sm:inline-flex">
              {current?.published_at ? (
                hasUnpublishedChanges ? (
                  <>
                    <span className="size-1.5 rounded-full bg-amber-500" />
                    Live · ada draft baru
                  </>
                ) : (
                  <>
                    <span className="size-1.5 rounded-full bg-emerald-500" />
                    Live
                  </>
                )
              ) : (
                <>
                  <span className="size-1.5 rounded-full bg-muted-foreground/50" />
                  Belum dipublikasikan
                </>
              )}
            </span>
          </div>
          <div className="hidden items-center gap-2 md:flex">
            <Kbd>⌘Z</Kbd>
            <span>Undo</span>
            <Separator orientation="vertical" className="h-3" />
            <Kbd>Esc</Kbd>
            <span>Induk</span>
            <Separator orientation="vertical" className="h-3" />
            <Kbd>⌘D</Kbd>
            <span>Duplikat</span>
            <Separator orientation="vertical" className="h-3" />
            <Kbd>/</Kbd>
            <span>Tambah</span>
            <Separator orientation="vertical" className="h-3" />
            <Kbd>⌘S</Kbd>
            <span>Simpan</span>
          </div>
        </div>
      </section>

      {/* ---------- Sidebar kanan: Property editor (desktop) ---------- */}
      <aside
        className={cn(
          "overflow-y-auto rounded-xl border bg-card p-4 shadow-sm transition-all",
          rightCollapsed && "pointer-events-none border-transparent bg-transparent p-0 opacity-0",
          // Mobile: sembunyikan aside kanan, buka via bottom sheet saat user
          // tap tombol "Edit" di FAB (visible saat ada block terpilih).
          isMobile && "hidden",
        )}
      >
        {renderPropEditorBody()}
      </aside>
      </div>

      {/* ---------- Mobile: FAB actions + bottom sheet prop editor ---------- */}
      {isMobile && (
        <>
          <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center gap-2 px-4">
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="pointer-events-auto inline-flex h-11 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground shadow-lg transition-transform active:scale-95"
              title="Tambah blok"
            >
              <Plus className="size-4" />
              Tambah
            </button>
            {selectedPath && (
              <button
                type="button"
                onClick={() => setPropSheetOpen(true)}
                className="pointer-events-auto inline-flex h-11 items-center gap-1.5 rounded-full border bg-card px-4 text-sm font-medium shadow-lg transition-transform active:scale-95"
                title="Edit block terpilih"
              >
                <Settings2 className="size-4" />
                Edit
              </button>
            )}
          </div>

          <Dialog open={propSheetOpen} onOpenChange={setPropSheetOpen}>
            <DialogContent
              className={cn(
                // Override default center-modal → bottom sheet slide-up
                "!left-0 !right-0 !top-auto !bottom-0 !max-w-full !translate-x-0 !translate-y-0",
                "max-h-[85vh] gap-0 rounded-b-none rounded-t-2xl p-0",
              )}
            >
              <DialogHeader className="border-b bg-muted/40 px-4 py-3">
                <DialogTitle className="text-sm">Edit Blok</DialogTitle>
              </DialogHeader>
              <div className="max-h-[calc(85vh-52px)] overflow-y-auto p-4">
                {renderPropEditorBody()}
              </div>
            </DialogContent>
          </Dialog>
        </>
      )}

      <ThemeDrawer
        open={themeOpen}
        onClose={() => setThemeOpen(false)}
        theme={theme}
        onChange={setTheme}
        onSave={saveTheme}
        saving={savingTheme}
        dirty={themeDirty}
      />

      <BlockPaletteDialog
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onPick={addBlock}
        onPickSnippet={(block) => addBlockFromData(block)}
      />

      <HistoryDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        pageId={current?.id ?? null}
        onRestored={(p) => {
          setPages((ps) => ps.map((x) => (x.id === p.id ? p : x)));
          const bs = p.tree?.blocks ?? [];
          setBlocks(bs);
          const initial: Path | null = bs.length ? [0] : null;
          setSelectedPath(initial);
          setSelectedPaths(initial ? new Set([pathKey(initial)]) : new Set());
          setHistoryOpen(false);
          toast.success("Versi berhasil dipulihkan");
        }}
      />

      <PageSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        page={current}
        onUpdated={(next) => {
          setPages((ps) =>
            ps.map((p) =>
              p.id === next.id
                ? {
                    ...p,
                    slug: next.slug,
                    title: next.title,
                    is_home: next.is_home ?? p.is_home,
                    published_at: next.published_at ?? null,
                    // seo is a free-form record; cast keeps the strict Page type
                    // happy without inventing nullable fields.
                    ...(next as unknown as Partial<Page>),
                  }
                : p,
            ),
          );
        }}
      />

      <PreviewShareDialog
        pageId={current?.id ?? null}
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        onBeforeGenerate={savePreviewIfDirty}
      />
    </div>
    </SiteProductsContext.Provider>
  );
}

// Block types yang di-manage oleh shared layout — kalau muncul di page tree
// saat shared section aktif, harus di-hide supaya tidak double render.
// Konsisten dengan `headerBlockTypes` di layout_extract.go (Go side).
const LAYOUT_HEADER_TYPES = new Set(["Navbar"]);
const LAYOUT_FOOTER_TYPES = new Set(["Footer"]);

// hiddenLayoutIndices — kumpulkan indeks blok top-level yang harus di-hide
// dari canvas + sidebar karena duplikat dengan shared layout aktif. Return
// Set kosong kalau tidak ada shared layout / semua flag off.
function hiddenLayoutIndices(
  blocks: BlockData[],
  opts: { headerActive: boolean; footerActive: boolean },
): Set<number> {
  const hidden = new Set<number>();
  if (!opts.headerActive && !opts.footerActive) return hidden;
  blocks.forEach((b, i) => {
    if (opts.headerActive && LAYOUT_HEADER_TYPES.has(b.type)) hidden.add(i);
    else if (opts.footerActive && LAYOUT_FOOTER_TYPES.has(b.type)) hidden.add(i);
  });
  return hidden;
}

// ---------- Layout mode notice (header/footer toggle) ----------

// LayoutModeNotice = strip di atas canvas saat mode = layout. Tampilkan
// info konteks + toggle aktif/nonaktif shared layout per section.
function LayoutModeNotice({
  section,
  enabled,
  onToggle,
}: {
  section: "header" | "footer";
  enabled: boolean;
  onToggle: (next: boolean) => void;
}) {
  const label = section === "header" ? "Header" : "Footer";
  return (
    <div className="flex flex-wrap items-center gap-3 border-b bg-amber-50/60 px-3 py-2 text-[11px] dark:bg-amber-950/20">
      <span className="inline-flex items-center gap-1.5 font-semibold text-amber-900 dark:text-amber-200">
        <Layers className="size-3" />
        Layout Bersama · {label}
      </span>
      <span className="text-amber-800/80 dark:text-amber-200/70">
        Perubahan di sini berlaku ke <b>semua halaman</b>.
      </span>
      <label className="ml-auto inline-flex cursor-pointer items-center gap-2 rounded-md border border-amber-300 bg-white px-2 py-1 shadow-sm hover:bg-amber-50 dark:border-amber-800 dark:bg-slate-900 dark:hover:bg-slate-800">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onToggle(e.target.checked)}
          className="size-3.5 accent-primary"
        />
        <span className="font-medium text-slate-700 dark:text-slate-200">
          {enabled ? `${label} aktif` : `${label} nonaktif`}
        </span>
      </label>
    </div>
  );
}

// LayoutReadonlyStrip = render actual shared header/footer blocks read-only
// di canvas mode page, supaya user lihat tampilan halaman lengkap. Konten
// pakai pointer-events:none supaya klik pass-through ke overlay wrapper yang
// jump ke layout mode. Badge "Layout Bersama · Edit →" muncul di corner
// on-hover sebagai affordance.
function LayoutReadonlyStrip({
  section,
  blocks,
  device,
  canvasStyle,
  onEdit,
}: {
  section: "header" | "footer";
  blocks: BlockData[];
  device: "desktop" | "tablet" | "mobile";
  canvasStyle: React.CSSProperties;
  onEdit: () => void;
}) {
  const label = section === "header" ? "Header" : "Footer";
  const isHeader = section === "header";
  return (
    <div
      className={cn(
        "relative wb-canvas group cursor-pointer",
        // Border tipis di batas dengan page canvas biar seksi terlihat.
        isHeader ? "border-b border-dashed border-primary/30" : "border-t border-dashed border-primary/30",
      )}
      style={canvasStyle}
      onClick={onEdit}
      title={`${label} bersama — berlaku di semua halaman. Klik untuk edit.`}
    >
      {/*
        Konten render read-only. Tiga guard supaya user tidak "keluar" editor:
        1. pointer-events:none → mouse click pass-through ke onEdit
        2. `inert` attribute → browser skip Tab focus + block synthetic click
           via keyboard (Enter di link → no navigate)
        3. `aria-hidden` → screen reader skip (duplikat dari mode Layout)
        Opacity slight supaya visually berbeda dari page editable content.
      */}
      <div
        className="pointer-events-none opacity-90"
        // React 19 treats `inert=""` as false — must pass the boolean.
        inert
        aria-hidden="true"
      >
        {blocks.map((b, i) => (
          <BlockView
            key={`layout-${section}-${i}`}
            block={b}
            editable={false}
            device={device}
          />
        ))}
      </div>
      {/* Badge sudut kanan — visible on hover supaya tidak menutupi konten
          saat idle. Positioning absolute supaya tidak geser layout blocks. */}
      <div className="pointer-events-none absolute right-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-md bg-primary/90 px-2 py-1 text-[10px] font-semibold text-primary-foreground opacity-0 shadow-md transition-opacity group-hover:opacity-100">
        <Layers className="size-3" />
        {label} Bersama · Edit →
      </div>
    </div>
  );
}

// ---------- Block palette (categorized + searchable) ----------

type Snippet = {
  id: string;
  name: string;
  block_type: string;
  block: BlockData;
  created_at: string;
};

function BlockPaletteDialog({
  open,
  onOpenChange,
  onPick,
  onPickSnippet,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onPick: (type: string) => void;
  onPickSnippet: (block: BlockData) => void;
}) {
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"all" | "pro" | "standard" | "snippets">("all");
  const [snippets, setSnippets] = useState<Snippet[] | null>(null);
  const [snippetsLoading, setSnippetsLoading] = useState(false);
  useEffect(() => {
    if (!open) {
      setQ("");
      setTab("all");
    }
  }, [open]);
  // Lazy-load snippets only when tab is opened — avoids fetching for users
  // who never use this feature.
  useEffect(() => {
    if (!open || tab !== "snippets" || snippets !== null) return;
    setSnippetsLoading(true);
    api<Snippet[]>("/api/v1/snippets")
      .then(setSnippets)
      .catch((e) => toast.error((e as Error).message))
      .finally(() => setSnippetsLoading(false));
  }, [open, tab, snippets]);

  // Filtered snippets based on search query.
  const filteredSnippets = useMemo(() => {
    if (!snippets) return [];
    const needle = q.trim().toLowerCase();
    if (!needle) return snippets;
    return snippets.filter(
      (s) =>
        s.name.toLowerCase().includes(needle) ||
        s.block_type.toLowerCase().includes(needle),
    );
  }, [snippets, q]);

  async function deleteSnippet(id: string) {
    if (!confirm("Hapus snippet ini?")) return;
    try {
      await api(`/api/v1/snippets/${id}`, { method: "DELETE" });
      setSnippets((s) => s?.filter((x) => x.id !== id) ?? null);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const grouped = useMemo(() => blockSchemasByCategory(), []);
  const proCount = useMemo(
    () => grouped.find((g) => g.key === "pro")?.blocks.length ?? 0,
    [grouped],
  );
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let g = grouped;
    if (tab === "pro") g = g.filter((x) => x.key === "pro");
    if (tab === "standard") g = g.filter((x) => x.key !== "pro");
    if (!needle) return g;
    return g
      .map((cat) => ({
        ...cat,
        blocks: cat.blocks.filter(
          (b) =>
            b.label.toLowerCase().includes(needle) ||
            b.type.toLowerCase().includes(needle) ||
            (b.description ?? "").toLowerCase().includes(needle),
        ),
      }))
      .filter((cat) => cat.blocks.length > 0);
  }, [grouped, q, tab]);

  const totalShown = filtered.reduce((sum, g) => sum + g.blocks.length, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl gap-0 p-0">
        <DialogHeader className="border-b px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10">
              <Sparkles className="size-4 text-primary" />
            </div>
            <div>
              <DialogTitle>Tambah Block</DialogTitle>
              <DialogDescription className="mt-0.5">
                Pilih dari {blockSchemas.length} block ready-to-use. Cari nama atau ketegori.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="border-b px-6 py-3">
          {/* Tab filter — All / Pro / Standard */}
          <div className="mb-3 inline-flex items-center gap-0.5 rounded-md bg-muted p-0.5 shadow-inner">
            <PaletteTab
              active={tab === "all"}
              onClick={() => setTab("all")}
              label={`Semua · ${blockSchemas.length}`}
            />
            <PaletteTab
              active={tab === "pro"}
              onClick={() => setTab("pro")}
              label={
                <span className="inline-flex items-center gap-1">
                  <span
                    className="inline-block bg-gradient-to-r from-violet-500 via-pink-500 to-amber-500 bg-clip-text font-semibold text-transparent"
                  >
                    Pro ✨
                  </span>
                  <span className="text-muted-foreground">· {proCount}</span>
                </span>
              }
            />
            <PaletteTab
              active={tab === "standard"}
              onClick={() => setTab("standard")}
              label={`Standar · ${blockSchemas.length - proCount}`}
            />
            <PaletteTab
              active={tab === "snippets"}
              onClick={() => setTab("snippets")}
              label={
                <span className="inline-flex items-center gap-1">
                  <Bookmark className="size-3" />
                  Snippets
                  {snippets && (
                    <span className="text-muted-foreground">· {snippets.length}</span>
                  )}
                </span>
              }
            />
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Cari block (mis. hero, pricing, faq)…"
              className="h-9 pl-9"
            />
            {q && (
              <button
                onClick={() => setQ("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                title="Clear"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
        </div>

        <div className="max-h-[60vh] space-y-6 overflow-y-auto p-6">
          {tab === "snippets" ? (
            // ----- Snippets tab -----
            snippetsLoading ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                Memuat snippets…
              </p>
            ) : filteredSnippets.length === 0 ? (
              <div className="py-12 text-center">
                <Bookmark className="mx-auto size-8 text-muted-foreground/40" />
                <p className="mt-3 text-sm text-muted-foreground">
                  {snippets && snippets.length === 0
                    ? "Belum ada snippet. Klik 🔖 di toolbar block untuk simpan."
                    : `Tidak ada snippet cocok "${q}".`}
                </p>
              </div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {filteredSnippets.map((s) => {
                  const schema = schemaFor(s.block_type);
                  return (
                    <div
                      key={s.id}
                      className="group/sn relative flex items-start gap-3 rounded-lg border bg-card p-3 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
                    >
                      <button
                        onClick={() => onPickSnippet(s.block)}
                        className="flex flex-1 items-start gap-3 text-left"
                      >
                        <span className="grid size-9 shrink-0 place-items-center rounded-md bg-muted text-lg group-hover/sn:bg-primary/10">
                          {schema?.emoji ?? "🧩"}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{s.name}</div>
                          <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
                            {schema?.label ?? s.block_type} ·{" "}
                            {new Date(s.created_at).toLocaleDateString("id-ID")}
                          </p>
                        </div>
                      </button>
                      <button
                        onClick={() => deleteSnippet(s.id)}
                        className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover/sn:opacity-100"
                        title="Hapus snippet"
                      >
                        <Trash2 className="size-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )
          ) : filtered.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Tidak ada block yang cocok dengan &quot;{q}&quot;.
            </p>
          ) : (
            filtered.map((cat) => {
              const isPro = cat.key === "pro";
              return (
              <div key={cat.key}>
                <div className="mb-3 flex items-center gap-2">
                  <span
                    className={cn(
                      "text-[10px] font-semibold uppercase tracking-widest",
                      isPro
                        ? "bg-gradient-to-r from-violet-500 via-pink-500 to-amber-500 bg-clip-text text-transparent"
                        : "text-muted-foreground",
                    )}
                  >
                    {cat.label}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    · {cat.blocks.length}
                  </span>
                  <div className={cn("ml-auto h-px flex-1", isPro ? "bg-gradient-to-r from-violet-500/40 via-pink-500/40 to-amber-500/40" : "bg-border")} />
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {cat.blocks.map((b) => (
                    <button
                      key={b.type}
                      onClick={() => onPick(b.type)}
                      className={cn(
                        "group/card flex items-start gap-3 rounded-lg border p-3 text-left transition-all hover:-translate-y-0.5 hover:shadow-md",
                        isPro
                          ? "border-violet-500/20 bg-gradient-to-br from-violet-500/[0.04] via-card to-amber-500/[0.03] hover:border-violet-500/50"
                          : "bg-card hover:border-primary/40",
                      )}
                    >
                      <span
                        className={cn(
                          "grid size-9 shrink-0 place-items-center rounded-md text-lg transition-colors",
                          isPro
                            ? "bg-gradient-to-br from-violet-500/20 via-pink-500/15 to-amber-500/20"
                            : "bg-muted group-hover/card:bg-primary/10",
                        )}
                      >
                        {b.emoji ?? "🧩"}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{b.label}</div>
                        {b.description ? (
                          <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
                            {b.description}
                          </p>
                        ) : null}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
              );
            })
          )}
        </div>

        {q && tab !== "snippets" && totalShown > 0 && (
          <div className="border-t bg-muted/30 px-6 py-2 text-center text-[11px] text-muted-foreground">
            {totalShown} block ditemukan untuk &quot;{q}&quot;
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------- History dialog ----------

function HistoryDialog({
  open,
  onOpenChange,
  pageId,
  onRestored,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  pageId: string | null;
  onRestored: (p: Page) => void;
}) {
  const [versions, setVersions] = useState<PageVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !pageId) return;
    setLoading(true);
    api<PageVersion[]>(`/api/v1/pages/${pageId}/versions?limit=50`)
      .then(setVersions)
      .catch((e) => toast.error((e as Error).message))
      .finally(() => setLoading(false));
  }, [open, pageId]);

  async function restore(v: PageVersion) {
    if (!pageId) return;
    if (
      !confirm(
        `Pulihkan ke versi v${v.version} (${new Date(v.created_at).toLocaleString("id-ID")})?\nVersi saat ini akan tetap tersimpan sebagai snapshot.`,
      )
    )
      return;
    setRestoring(v.id);
    try {
      const p = await api<Page>(`/api/v1/pages/${pageId}/restore/${v.id}`, {
        method: "POST",
      });
      onRestored(p);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRestoring(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Riwayat Halaman</DialogTitle>
          <DialogDescription>
            Setiap kali Anda menyimpan, snapshot otomatis dibuat. Pilih versi untuk dipulihkan.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto">
          {loading && (
            <p className="py-8 text-center text-sm text-muted-foreground">Memuat riwayat…</p>
          )}
          {!loading && versions.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Belum ada riwayat. Snapshot dibuat saat Anda menyimpan perubahan konten.
            </p>
          )}
          <ul className="divide-y">
            {versions.map((v) => {
              const blockCount = v.tree?.blocks?.length ?? 0;
              return (
                <li key={v.id} className="flex items-center justify-between py-3">
                  <div>
                    <div className="text-sm font-medium">
                      v{v.version}
                      {v.title && <span className="ml-2 text-muted-foreground">{v.title}</span>}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {new Date(v.created_at).toLocaleString("id-ID")} · {blockCount} block
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => restore(v)}
                    disabled={restoring === v.id}
                    className="gap-1.5"
                  >
                    <RotateCcw className="size-3.5" />
                    {restoring === v.id ? "Memulihkan…" : "Pulihkan"}
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Tiny helpers ----------

/**
 * Drop target rendered inside an empty container/column. Announced to
 * dnd-kit under id "drop:<parentKey>" — the Preview's onDragEnd matches
 * this shape to know it means "insert as last child of that parent".
 * Empty top-level parent uses id "drop:" (empty parentKey).
 */
function DroppableEmpty({
  parentPath,
  label,
  compact,
}: {
  parentPath: Path;
  label: string;
  compact?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `drop:${pathKey(parentPath)}`,
    data: { parentPath },
  });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex items-center justify-center gap-1.5 rounded-md border border-dashed text-[11px] transition-colors",
        compact ? "py-4" : "py-8",
        isOver
          ? "border-primary bg-primary/10 text-primary"
          : "border-muted-foreground/30 text-muted-foreground",
      )}
    >
      <Plus className="size-3" />
      {label}
    </div>
  );
}

function EmptyContainerHint({ label, compact }: { label: string; compact?: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center justify-center gap-1.5 rounded-md border border-dashed border-muted-foreground/30 text-[11px] text-muted-foreground",
        compact ? "py-4" : "py-8",
      )}
    >
      <Plus className="size-3" />
      {label}
    </div>
  );
}

function PaletteTab({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded px-2.5 py-1 text-xs transition-all",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

// SavedAgo renders a live-updating "diperbarui Nm lalu" string. The clock
// ticks every 15s — granular enough for fresh saves (< 1m) but cheap enough
// that we don't risk render storms on a busy editor.
function SavedAgo({ at }: { at: number | null }) {
  const [, force] = useState(0);
  useEffect(() => {
    if (!at) return;
    const t = window.setInterval(() => force((n) => n + 1), 15_000);
    return () => window.clearInterval(t);
  }, [at]);
  if (!at) return <>Tersimpan</>;
  const secs = Math.floor((Date.now() - at) / 1000);
  if (secs < 5) return <>Baru saja tersimpan</>;
  if (secs < 60) return <>Tersimpan {secs} dtk lalu</>;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return <>Tersimpan {mins} mnt lalu</>;
  return <>Tersimpan {Math.floor(mins / 60)} jam lalu</>;
}

// marked configured once — drop raw HTML so a malicious markdown like
// `<script>` can't leak through (same hardening blog editor uses).
marked.setOptions({ gfm: true, breaks: false });
marked.use({ renderer: { html: () => "" } });

function renderMarkdownInline(md: string): string {
  if (!md) return "";
  return marked.parse(md, { async: false }) as string;
}

// formatScheduleShort — label pendek untuk badge toolbar. Kalau < 24 jam
// tampilkan "jam 14:30", kalau > 24 jam tampilkan "15 Ags 14:30". Tujuannya
// user cepat scan tanpa parse tanggal panjang.
function formatScheduleShort(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Terjadwal";
  const diffMs = d.getTime() - Date.now();
  const inLessThan24h = diffMs > 0 && diffMs < 24 * 60 * 60 * 1000;
  if (inLessThan24h) {
    return `Jam ${d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}`;
  }
  return d.toLocaleString("id-ID", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border bg-background px-1.5 py-px font-mono text-[10px] font-medium text-foreground/70 shadow-sm">
      {children}
    </kbd>
  );
}

function DeviceBtn({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={cn(
        "inline-flex h-7 items-center justify-center rounded px-2.5 text-xs transition-all",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="size-3.5" />
    </button>
  );
}

function Preview({
  blocks,
  keys,
  onSelect,
  selectedPath,
  onAdd,
  onUpdate,
  onMove,
  onDuplicate,
  onSaveSnippet,
  onDelete,
  onMoveTo,
  device,
  hiddenIndices,
}: {
  blocks: BlockData[];
  keys: string[];
  onSelect: (path: Path, mods?: { shift?: boolean; meta?: boolean }) => void;
  selectedPath: Path | null;
  onAdd: () => void;
  onUpdate: (path: Path, next: BlockData) => void;
  onMove: (path: Path, dir: -1 | 1) => void;
  onDuplicate: (path: Path) => void;
  onSaveSnippet: (path: Path) => void;
  onDelete: (path: Path) => void;
  // Path-based cross-parent move — called on drag-end.
  onMoveTo: (fromPath: Path, toParent: Path, at: number) => void;
  device: "desktop" | "tablet" | "mobile";
  // Top-level indices yang di-hide dari canvas + DND context. Blok tetap di
  // state (path indices tetap konsisten dengan array) — hanya tidak di-render.
  // Dipakai untuk hide Navbar/Footer di page tree saat shared layout aktif.
  hiddenIndices?: Set<number>;
}) {
  // Pointer sensor 8px activation — align dengan SortableBlockList sidebar.
  // Sebelumnya 4px terlalu sensitif: klik untuk select block sering ke-hijack
  // jadi drag start kalau cursor drift sedikit.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
  );

  // Track active drag untuk render DragOverlay ghost. Ghost = label +
  // ikon block type, ringan, tidak render full BlockView (bikin drag laggy
  // untuk block besar). Cukup untuk beri cue "block ini lagi di-drag".
  const [activeDragBlock, setActiveDragBlock] = useState<BlockData | null>(null);

  function handleDragStart(e: DragStartEvent) {
    const activePath = keyToPath(String(e.active.id));
    const b = getAt(blocks, activePath);
    setActiveDragBlock(b ?? null);
  }

  function handleDragEnd(e: DragEndEvent) {
    setActiveDragBlock(null);
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const fromPath = keyToPath(String(active.id));
    const overKey = String(over.id);
    // Destination — two shapes:
    //   "drop:<parentKey>" → empty container area, insert as first child
    //   "<pathKey>"        → sibling, insert at its position
    if (overKey.startsWith("drop:")) {
      const parentKey = overKey.slice(5);
      const toParent: Path = parentKey === "" ? [] : keyToPath(parentKey);
      // Insert at end of parent's children (empty containers → position 0).
      const parentChildren =
        toParent.length === 0
          ? blocks
          : getAt(blocks, toParent)?.children ?? [];
      onMoveTo(fromPath, toParent, parentChildren.length);
      return;
    }
    const overPath = keyToPath(overKey);
    const toParent = overPath.slice(0, -1);
    const toIdx = overPath[overPath.length - 1];
    onMoveTo(fromPath, toParent, toIdx);
  }

  function handleDragCancel() {
    setActiveDragBlock(null);
  }

  // Compute visible blocks (setelah filter hiddenIndices). Kalau setelah
  // filter kosong tapi raw blocks non-empty → tampilkan pesan "hanya berisi
  // header/footer bersama" instead of empty-state biar user tahu ada shared
  // layout yang menghandle konten.
  const hidden = hiddenIndices ?? new Set<number>();
  const visibleBlocks = blocks
    .map((b, i) => ({ block: b, index: i }))
    .filter((v) => !hidden.has(v.index));

  if (blocks.length === 0 || visibleBlocks.length === 0) {
    const allHidden = blocks.length > 0 && visibleBlocks.length === 0;
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 p-12 text-center">
        <div className="grid size-14 place-items-center rounded-2xl bg-muted">
          <Sparkles className="size-6 text-muted-foreground" />
        </div>
        <h3 className="text-base font-semibold">
          {allHidden ? "Halaman ini belum punya konten sendiri" : "Halaman masih kosong"}
        </h3>
        <p className="max-w-xs text-sm text-muted-foreground">
          {allHidden
            ? "Header & Footer sudah di-handle oleh Layout Bersama. Tambah block untuk isi konten halaman."
            : "Mulai membangun dengan menambah block pertama dari palette."}
        </p>
        <Button onClick={onAdd} className="mt-2 gap-2 shadow-sm">
          <Plus className="size-4" />
          Tambah Block
        </Button>
      </div>
    );
  }
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <SortableContext
        items={visibleBlocks.map((v) => pathKey([v.index]))}
        strategy={verticalListSortingStrategy}
      >
        <div className="animate-in fade-in duration-200">
          {visibleBlocks.map(({ block: b, index: i }) => (
            <RenderBlockWithChrome
              key={keys[i] ?? i}
              block={b}
              path={[i]}
              topLevelKey={keys[i] ?? String(i)}
              topLevelTotal={blocks.length}
              selectedPath={selectedPath}
              onSelect={onSelect}
              onUpdate={onUpdate}
              onMove={onMove}
              onDuplicate={onDuplicate}
              onSaveSnippet={onSaveSnippet}
              onDelete={onDelete}
              device={device}
            />
          ))}
        </div>
      </SortableContext>
      {/* Ghost badge yang follow cursor selama drag. Tidak render full block
          (avoid re-layout thrash + performance issue untuk block berat).
          Cukup pill kecil dengan label + emoji dari schema. */}
      <DragOverlay dropAnimation={null}>
        {activeDragBlock ? <DragGhostBadge block={activeDragBlock} /> : null}
      </DragOverlay>
    </DndContext>
  );
}

// DragGhostBadge — pill ringan yang jadi cursor follower selama drag block
// di canvas. Ambil emoji + label dari schema supaya user langsung tau block
// apa yang lagi di-pindah.
function DragGhostBadge({ block }: { block: BlockData }) {
  const schema = schemaFor(block.type);
  return (
    <div className="pointer-events-none inline-flex items-center gap-2 rounded-full border-2 border-primary bg-background/95 px-3 py-1.5 text-xs font-semibold shadow-xl backdrop-blur">
      <span className="grid size-5 place-items-center rounded-md bg-primary/10 text-sm">
        {schema?.emoji ?? "🧩"}
      </span>
      <span>{schema?.label ?? block.type}</span>
    </div>
  );
}

// Recursive wrapper that applies selection outline + block toolbar around any
// block at any depth. Container/Columns cases in BlockView call this
// component for their children so nested blocks get full click-to-select +
// toolbar treatment.
function RenderBlockWithChrome({
  block: b,
  path,
  topLevelKey,
  topLevelTotal,
  selectedPath,
  onSelect,
  onUpdate,
  onMove,
  onDuplicate,
  onSaveSnippet,
  onDelete,
  device,
}: {
  block: BlockData;
  path: Path;
  topLevelKey?: string;
  topLevelTotal?: number;
  selectedPath: Path | null;
  onSelect: (path: Path, mods?: { shift?: boolean; meta?: boolean }) => void;
  onUpdate: (path: Path, next: BlockData) => void;
  onMove: (path: Path, dir: -1 | 1) => void;
  onDuplicate: (path: Path) => void;
  onSaveSnippet: (path: Path) => void;
  onDelete: (path: Path) => void;
  device: "desktop" | "tablet" | "mobile";
}) {
  const isSelected = selectedPath ? samePath(selectedPath, path) : false;
  const effectiveLayout = layoutForBreakpoint(b.layout, device);

  // Sortable wiring — id = pathKey so cross-context drops can identify the
  // source. dnd-kit lets us apply the transform + transition to the outer
  // wrapper so the whole block previews the drop position while dragging.
  const sortable = useSortable({ id: pathKey(path), data: { path } });
  const sortableStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    opacity: sortable.isDragging ? 0.45 : 1,
    zIndex: sortable.isDragging ? 10 : "auto",
  };

  // Hidden on device — placeholder strip (only for top-level; nested blocks
  // just don't render). Still sortable so users can drag hidden items.
  if (b.layout?.hidden?.[device]) {
    if (path.length > 1) return null;
    return (
      <div
        ref={sortable.setNodeRef}
        data-block-key={topLevelKey}
        style={sortableStyle}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(path, { shift: e.shiftKey, meta: e.metaKey || e.ctrlKey });
        }}
        className={cn(
          "flex cursor-pointer items-center gap-2 border border-dashed border-muted-foreground/30 bg-muted/20 px-4 py-2 text-xs text-muted-foreground",
          isSelected && "border-primary/60 bg-primary/5",
        )}
      >
        <EyeOff className="size-3" />
        Block disembunyikan di {device} · klik untuk pilih
      </div>
    );
  }

  const wrapperStyle = buildLayoutStyle({
    layout: effectiveLayout,
    themeOverride: b.themeOverride,
  });
  const innerStyle = buildMaxWidthStyle({ layout: effectiveLayout });
  // Size for the total-siblings calc used by the toolbar's move-up/down
  // disabled state. For nested blocks, siblings are determined by the parent
  // via path length.
  const siblingsCount = topLevelTotal ?? 0;

  return (
    <div
      ref={sortable.setNodeRef}
      data-block-key={topLevelKey}
      style={sortableStyle}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(path, { shift: e.shiftKey, meta: e.metaKey || e.ctrlKey });
      }}
      className={cn(
        "group/blk relative cursor-pointer transition-all duration-150",
        isSelected
          ? "outline outline-2 outline-primary"
          : "hover:outline hover:outline-1 hover:outline-muted-foreground/40",
      )}
    >
      {/* Drag handle — only visible on hover/selection so it doesn't clutter
          the canvas. `stopPropagation` on click so grabbing the handle
          doesn't re-trigger select. */}
      <button
        type="button"
        {...sortable.attributes}
        {...sortable.listeners}
        onClick={(e) => e.stopPropagation()}
        title="Geser untuk memindahkan"
        className={cn(
          "pointer-events-auto absolute left-2 top-2 z-20 grid size-6 place-items-center rounded-md border bg-background/95 text-muted-foreground shadow-md backdrop-blur transition-opacity",
          "cursor-grab active:cursor-grabbing",
          isSelected
            ? "opacity-100"
            : "opacity-0 group-hover/blk:opacity-100",
        )}
      >
        <GripVertical className="size-3.5" />
      </button>
      <div style={wrapperStyle}>
        {innerStyle ? (
          <div style={innerStyle}>
            <BlockView
              block={b}
              onUpdate={(next) => onUpdate(path, next)}
              editable={isSelected}
              path={path}
              selectedPath={selectedPath}
              onSelectPath={onSelect}
              onUpdatePath={onUpdate}
              onMovePath={onMove}
              onDuplicatePath={onDuplicate}
              onSaveSnippetPath={onSaveSnippet}
              onDeletePath={onDelete}
              device={device}
            />
          </div>
        ) : (
          <BlockView
            block={b}
            onUpdate={(next) => onUpdate(path, next)}
            editable={isSelected}
            path={path}
            selectedPath={selectedPath}
            onSelectPath={onSelect}
            onUpdatePath={onUpdate}
            onMovePath={onMove}
            onDuplicatePath={onDuplicate}
            onSaveSnippetPath={onSaveSnippet}
            onDeletePath={onDelete}
            device={device}
          />
        )}
      </div>
      {isSelected && (
        <CanvasBlockToolbar
          block={b}
          index={path[path.length - 1]}
          total={siblingsCount || 999}
          onMove={(dir) => onMove(path, dir)}
          onDuplicate={() => onDuplicate(path)}
          onSaveSnippet={() => onSaveSnippet(path)}
          onDelete={() => onDelete(path)}
        />
      )}
    </div>
  );
}

// ---------- Inline block preview ----------

function BlockView({
  block,
  onUpdate,
  editable,
  // Path-aware props — only passed by RenderBlockWithChrome so children of
  // Container/Columns can also render with click-select + toolbar chrome. Not
  // required for terminal blocks (they never inspect these).
  path,
  selectedPath,
  onSelectPath,
  onUpdatePath,
  onMovePath,
  onDuplicatePath,
  onSaveSnippetPath,
  onDeletePath,
  device,
}: {
  block: BlockData;
  onUpdate?: (next: BlockData) => void;
  editable?: boolean;
  path?: Path;
  selectedPath?: Path | null;
  onSelectPath?: (path: Path, mods?: { shift?: boolean; meta?: boolean }) => void;
  onUpdatePath?: (path: Path, next: BlockData) => void;
  onMovePath?: (path: Path, dir: -1 | 1) => void;
  onDuplicatePath?: (path: Path) => void;
  onSaveSnippetPath?: (path: Path) => void;
  onDeletePath?: (path: Path) => void;
  device?: "desktop" | "tablet" | "mobile";
}) {
  const p = block.props ?? {};
  const siteProducts = useContext(SiteProductsContext);
  // setProp commits a single field back to the block tree. Only used by the
  // inline-edit branches — most block types still read-only in the canvas and
  // are edited via the side panel.
  function setProp(name: string, value: unknown) {
    if (!onUpdate) return;
    onUpdate({ ...block, props: { ...p, [name]: value } });
  }
  // setItemProp updates one field of one item inside an `items`-shaped array
  // prop. Used by blocks with item-shaped data (FeatureList, PricingTable,
  // testimonials, etc.) so the inline canvas edit can target a deep field.
  function setItemProp(arrName: string, idx: number, key: string, value: unknown) {
    if (!onUpdate) return;
    const arr = Array.isArray(p[arrName])
      ? (p[arrName] as Array<Record<string, unknown>>)
      : [];
    const next = [...arr];
    next[idx] = { ...next[idx], [key]: value };
    onUpdate({ ...block, props: { ...p, [arrName]: next } });
  }
  // Field — helper compact untuk render text prop dengan inline edit saat
  // `editable`, atau plain element saat read-only. Reduce boilerplate 5-baris
  // ternary jadi 1-liner. Semua HTML attr pass through via className.
  //
  // Kalau field kosong DAN not editable → return null (existing conditional
  // render behavior). Kalau editable → tetap render supaya EditableText
  // placeholder muncul (user bisa klik untuk isi).
  function Field({
    as,
    field,
    className,
    placeholder,
    multiline,
    hideWhenEmpty = false,
  }: {
    as: "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "p" | "div" | "span" | "blockquote";
    field: string;
    className?: string;
    placeholder?: string;
    multiline?: boolean;
    hideWhenEmpty?: boolean;
  }) {
    const value = String(p[field] ?? "");
    if (!editable) {
      if (hideWhenEmpty && !value) return null;
      return createElement(as, { className }, value);
    }
    return (
      <EditableText
        as={as}
        className={className}
        value={value}
        onChange={(v) => setProp(field, v)}
        placeholder={placeholder}
        multiline={multiline}
      />
    );
  }
  // ItemField — sama seperti Field tapi untuk items[] arrays. Update lewat
  // setItemProp supaya array integrity terjaga.
  function ItemField({
    as,
    arrName,
    idx,
    field,
    className,
    placeholder,
    multiline,
    value,
  }: {
    as: "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "p" | "div" | "span" | "blockquote";
    arrName: string;
    idx: number;
    field: string;
    className?: string;
    placeholder?: string;
    multiline?: boolean;
    value: string;
  }) {
    if (!editable) return createElement(as, { className }, value);
    return (
      <EditableText
        as={as}
        className={className}
        value={value}
        onChange={(v) => setItemProp(arrName, idx, field, v)}
        placeholder={placeholder}
        multiline={multiline}
      />
    );
  }
  // Umkm* blocks reuse the renderer's markup; only text nodes become editable.
  if (UMKM_BLOCK_TYPES.has(block.type)) {
    const setUmkmPath = (path: Array<string | number>, v: string) => {
      const [key, idx, field] = path;
      if (path.length === 1) return setProp(String(key), v);
      if (path.length === 3) return setItemProp(String(key), Number(idx), String(field), v);
      const arr = Array.isArray(p[key]) ? [...(p[key] as unknown[])] : [];
      arr[Number(idx)] = v;
      setProp(String(key), arr);
    };
    const umkmCtx: UmkmCtx = {
      live: false,
      editable: !!editable,
      text: ({ as, value, path, className, placeholder, multiline }) =>
        editable ? (
          <EditableText
            as={as}
            className={className}
            value={value}
            onChange={(v) => setUmkmPath(path, v)}
            placeholder={placeholder}
            multiline={multiline}
          />
        ) : value ? (
          createElement(as, { className }, value)
        ) : null,
    };
    let catalog: { cards: UmkmCard[]; note: string } | undefined;
    if (block.type === "UmkmCatalogDynamic") {
      const limit = catalogLimit(p);
      const cards = siteProducts ? catalogCards(siteProducts, p) : [];
      catalog =
        siteProducts === null
          ? { cards: UMKM_SAMPLE_PRODUCTS.slice(0, limit), note: "Contoh tampilan — produk dimuat dari menu Produk." }
          : cards.length === 0
            ? { cards, note: "Belum ada produk aktif yang cocok. Tambahkan produk di menu Produk — blok ini otomatis menampilkannya." }
            : { cards, note: `Produk dari menu Produk (${cards.length} ditampilkan, maks. ${limit}).` };
    }
    return renderUmkmBlock(block.type, p, umkmCtx, catalog);
  }
  switch (block.type) {
    case "Navbar":
      return (
        <header className="border-b">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
            <strong className="text-lg">{String(p.brand ?? "")}</strong>
            <nav className="flex gap-6 text-sm">
              {(p.links as Array<{ label: string; href: string }> | undefined)?.map((l, i) => (
                <span key={i}>{l.label}</span>
              ))}
            </nav>
          </div>
        </header>
      );
    case "Hero":
      return (
        <section className="mx-auto max-w-4xl px-6 py-20 text-center">
          {editable ? (
            <EditableText
              as="h1"
              className="text-5xl font-bold tracking-tight"
              value={String(p.title ?? "")}
              onChange={(v) => setProp("title", v)}
              placeholder="Judul hero…"
            />
          ) : (
            <h1 className="text-5xl font-bold tracking-tight">{String(p.title ?? "")}</h1>
          )}
          {editable ? (
            <EditableText
              as="p"
              className="mx-auto mt-4 max-w-2xl text-lg opacity-80"
              value={String(p.subtitle ?? "")}
              onChange={(v) => setProp("subtitle", v)}
              placeholder="Subjudul…"
              multiline
            />
          ) : (
            <p className="mx-auto mt-4 max-w-2xl text-lg opacity-80">{String(p.subtitle ?? "")}</p>
          )}
          {p.ctaLabel ? (
            <button
              className="mt-8 inline-block px-6 py-3 font-medium text-white"
              style={{ background: "var(--color-primary)", borderRadius: "var(--radius)" }}
            >
              {String(p.ctaLabel)}
            </button>
          ) : null}
        </section>
      );
    case "HeroSpotlight":
      return (
        <div className="relative overflow-hidden bg-gradient-to-b from-primary/5 via-background to-background px-6 py-20 text-center">
          <div className="pointer-events-none absolute left-1/2 top-0 size-[400px] -translate-x-1/2 rounded-full bg-primary/20 opacity-40 blur-3xl wb-spotlight-anim" />
          {p.eyebrow ? (
            <div className="relative mb-4 inline-flex items-center gap-1.5 rounded-full border bg-background px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              <span className="size-1.5 rounded-full bg-emerald-500" />
              {String(p.eyebrow)}
            </div>
          ) : null}
          {editable ? (
            <EditableText
              as="h1"
              className="relative text-4xl font-bold tracking-tight"
              value={String(p.title ?? "")}
              onChange={(v) => setProp("title", v)}
              placeholder="Judul…"
            />
          ) : (
            <h1 className="relative text-4xl font-bold tracking-tight">{String(p.title ?? "")}</h1>
          )}
          {editable ? (
            <EditableText
              as="p"
              className="relative mx-auto mt-3 max-w-xl text-sm text-muted-foreground"
              value={String(p.subtitle ?? "")}
              onChange={(v) => setProp("subtitle", v)}
              placeholder="Subjudul…"
              multiline
            />
          ) : (
            <p className="relative mx-auto mt-3 max-w-xl text-sm text-muted-foreground">
              {String(p.subtitle ?? "")}
            </p>
          )}
          <div className="relative mt-6 flex justify-center gap-2">
            {p.ctaLabel ? (
              <button className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-md">
                {String(p.ctaLabel)} →
              </button>
            ) : null}
            {p.ctaSecondaryLabel ? (
              <button className="rounded-lg border px-4 py-2 text-sm font-medium">
                {String(p.ctaSecondaryLabel)}
              </button>
            ) : null}
          </div>
        </div>
      );
    case "Heading":
      return editable ? (
        <EditableText
          as="h2"
          className="mx-auto max-w-5xl px-6 py-6 text-3xl font-bold"
          value={String(p.text ?? "")}
          onChange={(v) => setProp("text", v)}
          placeholder="Judul…"
        />
      ) : (
        <h2 className="mx-auto max-w-5xl px-6 py-6 text-3xl font-bold">{String(p.text ?? "")}</h2>
      );
    case "Text":
      return editable ? (
        <EditableText
          as="p"
          className="mx-auto max-w-3xl whitespace-pre-line px-6 py-2"
          value={String(p.body ?? "")}
          onChange={(v) => setProp("body", v)}
          placeholder="Paragraf…"
          multiline
        />
      ) : (
        <p className="mx-auto max-w-3xl whitespace-pre-line px-6 py-2">{String(p.body ?? "")}</p>
      );
    case "RichText": {
      // Markdown → HTML inline. We use the same `marked` lib + `wb-prose` class
      // as the blog renderer so the preview matches production styling.
      const html = renderMarkdownInline(String(p.body ?? ""));
      return (
        <div className="wb-prose px-6 py-4" dangerouslySetInnerHTML={{ __html: html }} />
      );
    }
    case "Section":
      return (
        <section className="mx-auto max-w-5xl px-6 py-10">
          {editable ? (
            <EditableText
              as="h3"
              className="text-2xl font-semibold"
              value={String(p.title ?? "")}
              onChange={(v) => setProp("title", v)}
              placeholder="Judul section…"
            />
          ) : p.title ? (
            <h3 className="text-2xl font-semibold">{String(p.title)}</h3>
          ) : null}
          {editable ? (
            <EditableText
              as="p"
              className="mt-3 whitespace-pre-line opacity-80"
              value={String(p.body ?? "")}
              onChange={(v) => setProp("body", v)}
              placeholder="Isi…"
              multiline
            />
          ) : (
            <p className="mt-3 whitespace-pre-line opacity-80">{String(p.body ?? "")}</p>
          )}
        </section>
      );
    case "FeatureList":
      return (
        <section className="mx-auto max-w-5xl px-6 py-10">
          {editable ? (
            <EditableText
              as="h3"
              className="mb-6 text-2xl font-semibold"
              value={String(p.title ?? "")}
              onChange={(v) => setProp("title", v)}
              placeholder="Judul…"
            />
          ) : p.title ? (
            <h3 className="mb-6 text-2xl font-semibold">{String(p.title)}</h3>
          ) : null}
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {(p.items as Array<Record<string, unknown>> | undefined)?.map((it, i) => (
              <div key={i} className="rounded-xl border p-5">
                {editable ? (
                  <>
                    <EditableText
                      as="div"
                      className="font-semibold"
                      value={String(it.title ?? "")}
                      onChange={(v) => setItemProp("items", i, "title", v)}
                      placeholder="Judul fitur…"
                    />
                    <EditableText
                      as="div"
                      className="mt-1 text-sm opacity-80"
                      value={String(it.desc ?? "")}
                      onChange={(v) => setItemProp("items", i, "desc", v)}
                      placeholder="Deskripsi…"
                      multiline
                    />
                  </>
                ) : (
                  <>
                    <div className="font-semibold">{String(it.title ?? "")}</div>
                    <div className="mt-1 text-sm opacity-80">{String(it.desc ?? "")}</div>
                  </>
                )}
              </div>
            ))}
          </div>
        </section>
      );
    case "BentoGrid":
      return (
        <div className="px-6 py-6">
          {p.title ? (
            <h3 className="mb-4 text-center text-xl font-bold">{String(p.title)}</h3>
          ) : null}
          <div className="grid auto-rows-[5rem] grid-cols-3 gap-2">
            {(p.items as Array<{ title: string; desc: string; size?: string }> | undefined)?.map(
              (it, i) => {
                const span =
                  it.size === "large"
                    ? "col-span-2 row-span-2"
                    : it.size === "wide"
                      ? "col-span-2"
                      : "";
                return (
                  <div
                    key={i}
                    className={`rounded-lg border bg-gradient-to-br from-foreground/[0.02] to-foreground/[0.06] p-3 ${span}`}
                  >
                    <div className="text-xs font-semibold">{it.title}</div>
                    <div className="mt-0.5 text-[10px] text-muted-foreground">{it.desc}</div>
                  </div>
                );
              },
            )}
          </div>
        </div>
      );
    case "StatsBar":
      return (
        <div className="px-6 py-6">
          <div className="grid grid-cols-2 gap-y-4 rounded-lg border p-4 sm:grid-cols-4">
            {(p.items as Array<{ value: string; label: string }> | undefined)?.map((it, i) => (
              <div key={i} className="text-center">
                <ItemField as="div" arrName="items" idx={i} field="value" className="text-2xl font-bold text-primary" value={it.value} placeholder="123" />
                <ItemField as="div" arrName="items" idx={i} field="label" className="text-[10px] uppercase tracking-wider text-muted-foreground" value={it.label} placeholder="Label…" />
              </div>
            ))}
          </div>
        </div>
      );
    case "LogoCloud":
      return (
        <div className="px-6 py-6">
          <Field as="p" field="title" className="mb-3 text-center text-[10px] uppercase tracking-widest text-muted-foreground" placeholder="Judul (opsional)…" hideWhenEmpty />
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 opacity-60">
            {(p.items as Array<{ name: string; image?: string }> | undefined)?.map((it, i) => (
              <ItemField key={i} as="span" arrName="items" idx={i} field="name" className="text-sm font-semibold" value={it.name} placeholder="Nama…" />
            ))}
          </div>
        </div>
      );
    case "CTABanner":
      return (
        <section className="px-6 py-12">
          <div
            className="relative mx-auto max-w-5xl overflow-hidden rounded-3xl px-8 py-16 text-center text-white"
            style={{
              background:
                "linear-gradient(135deg, var(--color-primary), var(--color-secondary))",
            }}
          >
            <div className="wb-grid-pattern pointer-events-none absolute inset-0 opacity-10" />
            <Field as="h2" field="title" className="relative text-3xl font-bold tracking-tight sm:text-4xl" placeholder="Judul CTA…" />
            <Field as="p" field="subtitle" className="relative mx-auto mt-3 max-w-2xl opacity-90" placeholder="Subjudul…" multiline hideWhenEmpty />
            {(editable || p.ctaLabel) ? (
              <button
                className="relative mt-8 inline-flex items-center gap-2 rounded-full bg-white px-7 py-3 font-medium shadow-xl"
                style={{ color: "var(--color-fg)" }}
              >
                <Field as="span" field="ctaLabel" placeholder="Tombol CTA…" /> →
              </button>
            ) : null}
          </div>
        </section>
      );
    case "PricingTable":
      return (
        <div className="px-6 py-6">
          {editable ? (
            <EditableText
              as="h3"
              className="text-center text-xl font-bold"
              value={String(p.title ?? "")}
              onChange={(v) => setProp("title", v)}
              placeholder="Judul pricing…"
            />
          ) : p.title ? (
            <h3 className="text-center text-xl font-bold">{String(p.title)}</h3>
          ) : null}
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {(p.items as Array<Record<string, unknown>> | undefined)?.map((it, i) => {
              const featured = it.featured === "yes" || it.featured === "true";
              return (
                <div
                  key={i}
                  className={cn(
                    "rounded-lg border p-3",
                    featured && "border-2 border-primary",
                  )}
                >
                  {editable ? (
                    <>
                      <EditableText
                        as="div"
                        className="text-xs font-semibold"
                        value={String(it.title ?? "")}
                        onChange={(v) => setItemProp("items", i, "title", v)}
                        placeholder="Nama paket"
                      />
                      <EditableText
                        as="div"
                        className="mt-1 text-lg font-bold"
                        value={String(it.price ?? "")}
                        onChange={(v) => setItemProp("items", i, "price", v)}
                        placeholder="Harga"
                      />
                    </>
                  ) : (
                    <>
                      <div className="text-xs font-semibold">{String(it.title ?? "")}</div>
                      <div className="mt-1 text-lg font-bold">{String(it.price ?? "")}</div>
                    </>
                  )}
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    {String(it.period ?? "")}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      );
    case "FAQ":
      return (
        <div className="px-6 py-6">
          {p.title ? (
            <h3 className="mb-3 text-center text-xl font-bold">{String(p.title)}</h3>
          ) : null}
          <div className="space-y-1 rounded-lg border p-2">
            {(p.items as Array<{ question: string }> | undefined)?.map((it, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-md px-2 py-2 text-xs hover:bg-muted/50"
              >
                <span>{it.question}</span>
                <ChevronDown className="size-3 text-muted-foreground" />
              </div>
            ))}
          </div>
        </div>
      );
    case "TestimonialMarquee":
      return (
        <div className="px-6 py-6">
          {p.title ? (
            <h3 className="mb-3 text-center text-xl font-bold">{String(p.title)}</h3>
          ) : null}
          <div className="wb-marquee-mask overflow-hidden">
            <div className="flex gap-2">
              {(p.items as Array<{ name: string; text: string }> | undefined)
                ?.slice(0, 5)
                .map((t, i) => (
                  <div
                    key={i}
                    className="w-48 shrink-0 rounded-lg border bg-muted/30 p-3 text-[10px]"
                  >
                    <p className="line-clamp-2 opacity-80">&ldquo;{t.text}&rdquo;</p>
                    <div className="mt-2 text-[9px] font-semibold">— {t.name}</div>
                  </div>
                ))}
            </div>
          </div>
        </div>
      );
    case "Testimonial":
      return (
        <section className="mx-auto max-w-3xl px-6 py-10">
          {(p.items as Array<{ name: string; text: string }> | undefined)?.map((t, i) => (
            <blockquote
              key={i}
              className="my-4 border-l-4 pl-5 italic"
              style={{ borderColor: "var(--color-primary)" }}
            >
              &ldquo;{t.text}&rdquo; —{" "}
              <span className="not-italic font-medium">{t.name}</span>
            </blockquote>
          ))}
        </section>
      );
    case "ProductGrid":
    case "ProjectGrid":
    case "BlogList":
      return (
        <div className="px-6 py-6">
          {p.title ? <h3 className="mb-3 text-lg font-semibold">{String(p.title)}</h3> : null}
          <div className="grid gap-3 sm:grid-cols-3">
            {(p.items as Array<Record<string, unknown>> | undefined)?.map((it, i) => (
              <div key={i} className="rounded-lg border p-3">
                <div className="font-medium">{String(it.title ?? it.name ?? "")}</div>
                <div className="text-sm text-muted-foreground">
                  {String(it.desc ?? it.excerpt ?? it.price ?? "")}
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    case "Footer":
      return (
        <footer className="mt-16 border-t">
          <div className="mx-auto max-w-5xl px-6 py-6 text-center text-sm opacity-70">
            {String(p.copyright ?? "")}
          </div>
        </footer>
      );
    case "ProductGridDynamic":
      return (
        <div className="px-6 py-6">
          {p.title ? (
            <h3 className="mb-3 text-lg font-semibold">{String(p.title)}</h3>
          ) : null}
          <div className="rounded-md border border-dashed border-primary/30 bg-primary/5 p-4 text-center text-sm text-primary">
            🛍 Akan menampilkan {String(p.limit ?? 12)} produk aktif dari tab{" "}
            <strong>Produk</strong>.
          </div>
        </div>
      );
    case "BlogListDynamic":
      return (
        <div className="px-6 py-6">
          {p.title ? (
            <h3 className="mb-3 text-lg font-semibold">{String(p.title)}</h3>
          ) : null}
          <div className="rounded-md border border-dashed border-primary/30 bg-primary/5 p-4 text-center text-sm text-primary">
            📝 Akan menampilkan {String(p.limit ?? 10)} artikel published terbaru dari tab{" "}
            <strong>Blog</strong>.
          </div>
        </div>
      );

    // -------- New blocks (compact preview) --------

    case "HeroSplit": {
      const reversed = String(p.reversed ?? "") === "yes";
      return (
        <div className="px-6 py-10">
          <div className={cn("grid items-center gap-6 sm:grid-cols-2", reversed && "sm:[&>div:first-child]:order-2")}>
            <div>
              {p.eyebrow ? (
                <div className="mb-2 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  {String(p.eyebrow)}
                </div>
              ) : null}
              <h1 className="text-2xl font-bold tracking-tight">{String(p.title ?? "")}</h1>
              <p className="mt-2 text-sm text-muted-foreground">{String(p.subtitle ?? "")}</p>
              <div className="mt-4 flex gap-2">
                {p.ctaLabel ? (
                  <span className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground">
                    {String(p.ctaLabel)}
                  </span>
                ) : null}
                {p.ctaSecondaryLabel ? (
                  <span className="rounded-md border px-3 py-1.5 text-xs font-medium">
                    {String(p.ctaSecondaryLabel)}
                  </span>
                ) : null}
              </div>
            </div>
            {p.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={String(p.image)} alt="" className="w-full rounded-lg border" />
            ) : (
              <div className="aspect-video w-full rounded-lg bg-gradient-to-br from-primary/15 to-primary/5" />
            )}
          </div>
        </div>
      );
    }

    case "Banner":
      return (
        <div className="flex items-center justify-center gap-3 bg-primary px-6 py-2 text-center text-xs text-primary-foreground">
          <span>{String(p.text ?? "")}</span>
          {p.ctaLabel ? (
            <span className="font-semibold underline underline-offset-2">{String(p.ctaLabel)}</span>
          ) : null}
        </div>
      );

    case "Divider":
      return (
        <div className="px-6 py-4">
          {p.label ? (
            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-foreground/15" />
              <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                {String(p.label)}
              </span>
              <div className="h-px flex-1 bg-foreground/15" />
            </div>
          ) : (
            <div className="h-px w-full bg-foreground/10" />
          )}
        </div>
      );

    case "Spacer":
      return (
        <div className="relative">
          <div
            style={{ height: Math.min(Number(p.size ?? 64), 160) + "px" }}
            className="border-y border-dashed border-foreground/15 bg-foreground/[0.02]"
          />
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[10px] text-muted-foreground">
            {String(p.size ?? 64)}px spacer
          </span>
        </div>
      );

    case "Container": {
      const children = block.children ?? [];
      const gap = String(p.gap ?? "1rem");
      const withChrome = path && onSelectPath && onUpdatePath;
      const items = children.map((_, ci) => pathKey([...(path ?? []), ci]));
      return (
        <div className="flex flex-col px-6 py-6" style={{ gap }}>
          {withChrome && children.length === 0 ? (
            // Empty container = a droppable "landing pad" so users can drag
            // a block INTO it from elsewhere.
            <DroppableEmpty parentPath={path!} label="Container kosong · lepas block di sini" />
          ) : withChrome ? (
            <SortableContext items={items} strategy={verticalListSortingStrategy}>
              {children.map((child, ci) => (
                <RenderBlockWithChrome
                  key={ci}
                  block={child}
                  path={[...path!, ci]}
                  topLevelTotal={children.length}
                  selectedPath={selectedPath ?? null}
                  onSelect={onSelectPath!}
                  onUpdate={onUpdatePath!}
                  onMove={onMovePath!}
                  onDuplicate={onDuplicatePath!}
                  onSaveSnippet={onSaveSnippetPath!}
                  onDelete={onDeletePath!}
                  device={device!}
                />
              ))}
            </SortableContext>
          ) : (
            children.map((child, ci) => <BlockView key={ci} block={child} />)
          )}
        </div>
      );
    }

    case "Columns": {
      const children = block.children ?? [];
      const colCount = Math.max(1, Math.min(4, Number(p.columns ?? 2)));
      const gap = String(p.gap ?? "1rem");
      // Round-robin cells for VISUAL layout. DnD still operates on the linear
      // array via a single SortableContext — the visual column arrangement
      // is decoration only.
      const cells: Array<Array<{ child: BlockData; ci: number }>> = Array.from(
        { length: colCount },
        () => [],
      );
      children.forEach((c, ci) => {
        cells[ci % colCount].push({ child: c, ci });
      });
      const withChrome = path && onSelectPath && onUpdatePath;
      const items = children.map((_, ci) => pathKey([...(path ?? []), ci]));

      const gridEl = (
        <div
          className="grid px-6 py-6 max-md:grid-cols-1"
          style={{
            gridTemplateColumns: `repeat(${colCount}, minmax(0, 1fr))`,
            gap,
          }}
        >
          {cells.map((col, colI) => (
            <div key={colI} className="flex flex-col gap-3">
              {col.length === 0 && withChrome ? (
                // Each empty column gets its own drop zone so users can drop
                // directly into the specific column they want. We still route
                // the drop through the top-level parent — the round-robin
                // splitter reassigns visually.
                <DroppableEmpty
                  parentPath={path!}
                  label={`Kolom ${colI + 1} · lepas di sini`}
                  compact
                />
              ) : col.length === 0 ? (
                <EmptyContainerHint label={`Kolom ${colI + 1} kosong`} compact />
              ) : (
                col.map(({ child, ci }) => {
                  if (!withChrome) return <BlockView key={ci} block={child} />;
                  return (
                    <RenderBlockWithChrome
                      key={ci}
                      block={child}
                      path={[...path!, ci]}
                      topLevelTotal={children.length}
                      selectedPath={selectedPath ?? null}
                      onSelect={onSelectPath!}
                      onUpdate={onUpdatePath!}
                      onMove={onMovePath!}
                      onDuplicate={onDuplicatePath!}
                      onSaveSnippet={onSaveSnippetPath!}
                      onDelete={onDeletePath!}
                      device={device!}
                    />
                  );
                })
              )}
            </div>
          ))}
        </div>
      );

      return withChrome ? (
        <SortableContext items={items} strategy={verticalListSortingStrategy}>
          {gridEl}
        </SortableContext>
      ) : (
        gridEl
      );
    }

    case "Quote":
      return (
        <div className="px-8 py-8">
          <div className="text-3xl leading-none text-primary opacity-40">❝</div>
          {editable ? (
            <EditableText
              as="blockquote"
              className="mt-2 text-base font-medium leading-snug"
              value={String(p.text ?? "")}
              onChange={(v) => setProp("text", v)}
              placeholder="Tulis quote di sini…"
              multiline
            />
          ) : (
            <blockquote className="mt-2 text-base font-medium leading-snug">
              {String(p.text ?? "")}
            </blockquote>
          )}
          <div className="mt-3 text-xs font-semibold">
            —{" "}
            {editable ? (
              <EditableText
                as="span"
                value={String(p.author ?? "")}
                onChange={(v) => setProp("author", v)}
                placeholder="Nama"
              />
            ) : (
              <>{String(p.author ?? "")}</>
            )}{" "}
            {(p.role || editable) && (
              <span className="font-normal text-muted-foreground">
                ({editable ? (
                  <EditableText
                    as="span"
                    value={String(p.role ?? "")}
                    onChange={(v) => setProp("role", v)}
                    placeholder="Jabatan"
                  />
                ) : (
                  String(p.role)
                )})
              </span>
            )}
          </div>
        </div>
      );

    case "Alert": {
      const variant = String(p.variant ?? "info");
      const cls: Record<string, string> = {
        info: "border-blue-500/30 bg-blue-500/10",
        success: "border-emerald-500/30 bg-emerald-500/10",
        warning: "border-amber-500/30 bg-amber-500/10",
        danger: "border-red-500/30 bg-red-500/10",
      };
      const ic: Record<string, string> = {
        info: "ℹ️",
        success: "✅",
        warning: "⚠️",
        danger: "❗",
      };
      return (
        <div className="px-6 py-4">
          <div className={cn("flex gap-3 rounded-lg border p-3 text-xs", cls[variant] ?? cls.info)}>
            <span className="text-lg leading-none">{ic[variant] ?? ic.info}</span>
            <div>
              <div className="font-semibold">{String(p.title ?? "")}</div>
              <div className="mt-0.5 opacity-80">{String(p.body ?? "")}</div>
            </div>
          </div>
        </div>
      );
    }

    case "FeatureSide":
      return (
        <div className="space-y-6 px-6 py-6">
          {(p.items as Array<{ title: string; desc: string; image?: string }> | undefined)
            ?.slice(0, 2)
            .map((it, i) => (
              <div
                key={i}
                className={cn(
                  "grid items-center gap-4 sm:grid-cols-2",
                  i % 2 === 1 && "sm:[&>div:first-child]:order-2",
                )}
              >
                <div>
                  <h4 className="text-base font-bold">{it.title}</h4>
                  <p className="mt-1 text-xs text-muted-foreground">{it.desc}</p>
                </div>
                {it.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={it.image} alt="" className="w-full rounded-md border" />
                ) : (
                  <div className="aspect-video w-full rounded-md bg-gradient-to-br from-primary/15 to-primary/5" />
                )}
              </div>
            ))}
        </div>
      );

    case "Timeline":
      return (
        <div className="px-6 py-6">
          {p.title ? <h3 className="mb-4 text-base font-bold">{String(p.title)}</h3> : null}
          <ol className="relative space-y-3 border-l-2 border-primary/30 pl-5">
            {(p.items as Array<{ date: string; title: string }> | undefined)?.slice(0, 4).map((it, i) => (
              <li key={i} className="relative">
                <span className="absolute -left-[27px] grid size-4 place-items-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground">
                  {i + 1}
                </span>
                <div className="text-[10px] font-semibold uppercase text-primary">{it.date}</div>
                <div className="text-xs font-medium">{it.title}</div>
              </li>
            ))}
          </ol>
        </div>
      );

    case "ProcessSteps":
      return (
        <div className="px-6 py-6">
          {p.title ? <h3 className="text-center text-base font-bold">{String(p.title)}</h3> : null}
          <div className="mt-4 grid grid-cols-3 gap-3">
            {(p.items as Array<{ title: string; desc: string }> | undefined)?.slice(0, 3).map((it, i) => (
              <div key={i} className="text-center">
                <div className="mx-auto grid size-8 place-items-center rounded-lg bg-primary text-xs font-bold text-primary-foreground">
                  {i + 1}
                </div>
                <div className="mt-1.5 text-xs font-semibold">{it.title}</div>
              </div>
            ))}
          </div>
        </div>
      );

    case "TeamGrid":
      return (
        <div className="px-6 py-6">
          {p.title ? <h3 className="text-center text-base font-bold">{String(p.title)}</h3> : null}
          <div className="mt-4 grid grid-cols-4 gap-3">
            {(p.items as Array<{ name: string; role: string; image?: string }> | undefined)?.slice(0, 4).map((it, i) => (
              <div key={i} className="text-center">
                {it.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={it.image} alt={it.name} className="mx-auto size-12 rounded-full border-2 border-background object-cover" />
                ) : (
                  <div className="mx-auto grid size-12 place-items-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                    {it.name?.charAt(0) ?? "?"}
                  </div>
                )}
                <div className="mt-1.5 text-[10px] font-semibold">{it.name}</div>
                <div className="text-[9px] text-primary">{it.role}</div>
              </div>
            ))}
          </div>
        </div>
      );

    case "IconList":
      return (
        <div className="px-6 py-6">
          {p.title ? <h3 className="mb-2 text-sm font-bold">{String(p.title)}</h3> : null}
          <ul className="space-y-1.5">
            {(p.items as Array<{ icon: string; text: string }> | undefined)?.slice(0, 5).map((it, i) => (
              <li key={i} className="flex items-start gap-2 text-xs">
                <span className="grid size-5 shrink-0 place-items-center rounded-full bg-primary text-[10px] text-primary-foreground">
                  {it.icon}
                </span>
                <span>{it.text}</span>
              </li>
            ))}
          </ul>
        </div>
      );

    case "StatsCard":
      return (
        <div className="px-6 py-6">
          <div className="rounded-2xl border bg-muted/30 p-8 text-center">
            <div className="text-5xl font-bold text-primary">{String(p.value ?? "")}</div>
            <div className="mt-2 text-xs uppercase tracking-widest opacity-70">{String(p.label ?? "")}</div>
          </div>
        </div>
      );

    case "VideoEmbed":
      return (
        <div className="px-6 py-6">
          {p.title ? <h3 className="mb-3 text-center text-base font-bold">{String(p.title)}</h3> : null}
          <div className="grid aspect-video w-full place-items-center rounded-lg border-2 border-dashed border-muted-foreground/30 bg-muted text-3xl">
            ▶️
          </div>
          <p className="mt-1.5 truncate text-center font-mono text-[10px] text-muted-foreground">
            {String(p.src ?? "")}
          </p>
        </div>
      );

    case "Map":
      return (
        <div className="px-6 py-6">
          {p.title ? <h3 className="mb-3 text-base font-bold">{String(p.title)}</h3> : null}
          <div className="grid aspect-[16/9] w-full place-items-center rounded-lg border-2 border-dashed border-muted-foreground/30 bg-muted text-3xl">
            🗺️
          </div>
        </div>
      );

    case "Gallery":
      return (
        <div className="px-6 py-6">
          {p.title ? <h3 className="mb-3 text-base font-bold">{String(p.title)}</h3> : null}
          <div className="grid grid-cols-4 gap-1.5">
            {(p.items as Array<{ image?: string; caption?: string }> | undefined)?.slice(0, 8).map((it, i) =>
              it.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i} src={it.image} alt="" className="aspect-square w-full rounded object-cover" />
              ) : (
                <div key={i} className="aspect-square w-full rounded bg-muted" />
              ),
            )}
          </div>
        </div>
      );

    case "SocialLinks":
      return (
        <div className="px-6 py-6 text-center">
          {p.title ? (
            <p className="mb-2 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
              {String(p.title)}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center justify-center gap-2">
            {(p.items as Array<{ platform: string }> | undefined)?.slice(0, 8).map((it, i) => (
              <div
                key={i}
                className="grid size-8 place-items-center rounded-full border bg-card text-[10px] font-bold uppercase text-primary"
              >
                {it.platform.charAt(0)}
              </div>
            ))}
          </div>
        </div>
      );

    case "Newsletter":
      return (
        <div className="px-6 py-6">
          <div className="rounded-2xl border bg-muted/30 p-6 text-center">
            <h3 className="text-base font-bold">{String(p.title ?? "")}</h3>
            {p.subtitle ? <p className="mt-1 text-xs text-muted-foreground">{String(p.subtitle)}</p> : null}
            <div className="mx-auto mt-4 flex max-w-xs gap-1.5">
              <div className="flex-1 rounded-md border bg-background px-2 py-1.5 text-left text-[10px] text-muted-foreground">
                {String(p.placeholder ?? "nama@email.com")}
              </div>
              <span className="rounded-md bg-primary px-2 py-1.5 text-[10px] font-medium text-primary-foreground">
                {String(p.ctaLabel ?? "Subscribe")}
              </span>
            </div>
          </div>
        </div>
      );

    case "ContactForm":
      return (
        <div className="px-6 py-6">
          <div className="text-center">
            <h3 className="text-base font-bold">{String(p.title ?? "")}</h3>
            {p.subtitle ? <p className="mt-1 text-xs text-muted-foreground">{String(p.subtitle)}</p> : null}
          </div>
          <div className="mx-auto mt-3 max-w-xs space-y-1.5 rounded-lg border bg-card p-3">
            <div className="grid grid-cols-2 gap-1.5">
              <div className="rounded-md border bg-muted/40 px-2 py-1 text-[10px] text-muted-foreground">Nama</div>
              <div className="rounded-md border bg-muted/40 px-2 py-1 text-[10px] text-muted-foreground">Email</div>
            </div>
            <div className="rounded-md border bg-muted/40 px-2 py-3 text-[10px] text-muted-foreground">Pesan…</div>
            <div className="rounded-md bg-primary py-1.5 text-center text-[10px] font-medium text-primary-foreground">
              {String(p.ctaLabel ?? "Kirim")}
            </div>
          </div>
        </div>
      );

    case "Tabs":
      return (
        <div className="px-6 py-6">
          <div className="flex gap-1 border-b text-xs">
            {(p.items as Array<{ label: string }> | undefined)?.slice(0, 4).map((it, i) => (
              <span
                key={i}
                className={cn(
                  "border-b-2 px-3 py-1.5 text-xs font-medium",
                  i === 0 ? "border-primary text-foreground" : "border-transparent text-muted-foreground",
                )}
              >
                {it.label}
              </span>
            ))}
          </div>
          <p className="mt-3 text-xs opacity-80">
            {(p.items as Array<{ body: string }> | undefined)?.[0]?.body ?? ""}
          </p>
        </div>
      );

    case "TestimonialCard": {
      const rating = Number(p.rating ?? 0);
      return (
        <div className="px-6 py-6">
          <div className="rounded-2xl border bg-muted/30 p-6">
            {rating > 0 && (
              <div className="mb-2 text-sm">
                {Array.from({ length: 5 }).map((_, i) => (
                  <span key={i} className={i < rating ? "text-amber-400" : "text-muted-foreground/30"}>
                    ★
                  </span>
                ))}
              </div>
            )}
            <blockquote className="text-sm font-medium leading-snug">
              &ldquo;{String(p.quote ?? "")}&rdquo;
            </blockquote>
            <div className="mt-3 flex items-center gap-2">
              {p.avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={String(p.avatar)} alt="" className="size-8 rounded-full object-cover" />
              ) : (
                <div className="grid size-8 place-items-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                  {String(p.name ?? "?").charAt(0)}
                </div>
              )}
              <div>
                <div className="text-xs font-semibold">{String(p.name ?? "")}</div>
                {p.role ? <div className="text-[10px] text-muted-foreground">{String(p.role)}</div> : null}
              </div>
            </div>
          </div>
        </div>
      );
    }

    // ============================================================
    // PRO blocks — markup matches renderer 1:1 so editor preview is
    // an honest WYSIWYG. Animations come from globals.css (.wb-pro-*).
    // ============================================================

    case "AuroraHero":
      return (
        <div className="wb-pro-aurora">
          <Field as="div" field="eyebrow" className="wb-pro-eyebrow" placeholder="Eyebrow…" hideWhenEmpty />
          <Field as="h1" field="title" placeholder="Judul hero…" />
          <Field as="p" field="subtitle" className="wb-pro-sub" placeholder="Subjudul…" multiline hideWhenEmpty />
          {(editable || p.ctaLabel) ? (
            <a href={String(p.ctaHref ?? "#")} className="wb-pro-cta">
              <Field as="span" field="ctaLabel" placeholder="Tombol CTA…" />
            </a>
          ) : null}
        </div>
      );

    case "SpotlightHero":
      return (
        <div className="wb-pro-spotlight">
          <Field as="h1" field="title" placeholder="Judul hero…" />
          <Field as="p" field="subtitle" className="wb-pro-sub" placeholder="Subjudul…" multiline hideWhenEmpty />
          {(editable || p.ctaLabel) ? (
            <a href={String(p.ctaHref ?? "#")} className="wb-pro-cta">
              <Field as="span" field="ctaLabel" placeholder="Tombol CTA…" />
            </a>
          ) : null}
        </div>
      );

    case "HighlightHero":
      return (
        <div className="wb-pro-highlight">
          <h1>
            <Field as="span" field="title" placeholder="Judul…" />{" "}
            <Field as="span" field="highlight" className="wb-pro-mark" placeholder="highlight" />{" "}
            <Field as="span" field="titleAfter" placeholder="lanjutan…" />
          </h1>
          <Field as="p" field="subtitle" className="wb-pro-sub" placeholder="Subjudul…" multiline hideWhenEmpty />
          {(editable || p.ctaLabel) ? (
            <a href={String(p.ctaHref ?? "#")} className="wb-pro-cta">
              <Field as="span" field="ctaLabel" placeholder="Tombol CTA…" />
            </a>
          ) : null}
        </div>
      );

    case "LampHero":
      return (
        <div className="wb-pro-lamp">
          <Field as="h1" field="title" placeholder="Judul hero…" />
          <Field as="p" field="subtitle" className="wb-pro-sub" placeholder="Subjudul…" multiline hideWhenEmpty />
          {(editable || p.ctaLabel) ? (
            <a href={String(p.ctaHref ?? "#")} className="wb-pro-cta">
              <Field as="span" field="ctaLabel" placeholder="Tombol CTA…" />
            </a>
          ) : null}
        </div>
      );

    case "TypewriterHero":
      return (
        <div className="wb-pro-typewriter">
          <h1>
            <Field as="span" field="prefix" placeholder="Prefix…" />{" "}
            <Field as="span" field="typed" className="wb-pro-typed" placeholder="typed text" />
          </h1>
          <Field as="p" field="subtitle" className="wb-pro-sub" placeholder="Subjudul…" multiline hideWhenEmpty />
          {(editable || p.ctaLabel) ? (
            <a href={String(p.ctaHref ?? "#")} className="wb-pro-cta">
              <Field as="span" field="ctaLabel" placeholder="Tombol CTA…" />
            </a>
          ) : null}
        </div>
      );

    case "GradientTextHero":
      return (
        <div className="wb-pro-gtext">
          <Field as="div" field="eyebrow" className="wb-pro-eyebrow" placeholder="Eyebrow…" hideWhenEmpty />
          <Field as="h1" field="title" placeholder="Judul hero…" />
          <Field as="p" field="subtitle" className="wb-pro-sub" placeholder="Subjudul…" multiline hideWhenEmpty />
          {(editable || p.ctaLabel) ? (
            <a href={String(p.ctaHref ?? "#")} className="wb-pro-cta">
              <Field as="span" field="ctaLabel" placeholder="Tombol CTA…" />
            </a>
          ) : null}
        </div>
      );

    case "BeamsSection":
      return (
        <div className="wb-pro-beams">
          <Field as="h2" field="title" placeholder="Judul section…" />
          <Field as="p" field="subtitle" className="wb-pro-sub" placeholder="Subjudul…" multiline hideWhenEmpty />
        </div>
      );

    case "MeteorsSection":
      return (
        <div className="wb-pro-meteors">
          <span className="wb-pro-meteor" />
          <span className="wb-pro-meteor" />
          <span className="wb-pro-meteor" />
          <span className="wb-pro-meteor" />
          <span className="wb-pro-meteor" />
          <Field as="h2" field="title" placeholder="Judul section…" />
          <Field as="p" field="subtitle" className="wb-pro-sub" placeholder="Subjudul…" multiline hideWhenEmpty />
        </div>
      );

    case "GradientMeshSection":
      return (
        <div className="wb-pro-mesh">
          <span className="wb-pro-mesh-blob" />
          <span className="wb-pro-mesh-blob" />
          <span className="wb-pro-mesh-blob" />
          <Field as="h2" field="title" placeholder="Judul section…" />
          <Field as="p" field="subtitle" className="wb-pro-sub" placeholder="Subjudul…" multiline hideWhenEmpty />
        </div>
      );

    case "WavyDivider":
      return (
        <div className="wb-pro-wave">
          <div className="wb-pro-wave-track">
            <svg viewBox="0 0 1200 60" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M0 30 Q 150 0 300 30 T 600 30 T 900 30 T 1200 30 V60 H0 Z"
                fill="currentColor"
                opacity="0.15"
              />
            </svg>
          </div>
          <Field as="div" field="label" className="wb-pro-wave-label" placeholder="Label divider…" hideWhenEmpty />
        </div>
      );

    case "DotPatternSection":
      return (
        <div className="wb-pro-dots">
          <Field as="h2" field="title" placeholder="Judul section…" />
          <Field as="p" field="subtitle" className="wb-pro-sub" placeholder="Subjudul…" multiline hideWhenEmpty />
        </div>
      );

    case "GlowCardGrid":
      return (
        <div className="wb-pro-glow-grid">
          <Field as="h2" field="title" placeholder="Judul grid…" hideWhenEmpty />
          <div className="wb-pro-grid">
            {(p.items as Array<{ title: string; desc: string }> | undefined)?.map((it, i) => (
              <div key={i} className="wb-pro-glow-card">
                <div className="wb-pro-glow-inner">
                  <ItemField as="h3" arrName="items" idx={i} field="title" value={it.title} placeholder="Judul item…" />
                  <ItemField as="p" arrName="items" idx={i} field="desc" value={it.desc} placeholder="Deskripsi…" multiline />
                </div>
              </div>
            ))}
          </div>
        </div>
      );

    case "TiltCardGrid":
      return (
        <div className="wb-pro-tilt-grid">
          <Field as="h2" field="title" placeholder="Judul grid…" hideWhenEmpty />
          <div className="wb-pro-grid">
            {(p.items as Array<{ title: string; desc: string }> | undefined)?.map((it, i) => (
              <div key={i} className="wb-pro-tilt-card">
                <ItemField as="h3" arrName="items" idx={i} field="title" value={it.title} placeholder="Judul item…" />
                <ItemField as="p" arrName="items" idx={i} field="desc" value={it.desc} placeholder="Deskripsi…" multiline />
              </div>
            ))}
          </div>
        </div>
      );

    case "BorderBeamCard":
      return (
        <div className="wb-pro-beam-card">
          <div className="wb-pro-beam-wrap">
            <div className="wb-pro-beam-inner">
              <Field as="div" field="subtitle" className="text-xs uppercase tracking-widest opacity-60" placeholder="Subtitle…" />
              <Field as="h3" field="title" className="mt-1 text-lg font-bold" placeholder="Judul paket…" />
              <div className="wb-pro-beam-price">
                <Field as="span" field="price" placeholder="Harga…" />
                <Field as="span" field="period" className="wb-pro-beam-period" placeholder="/bulan" />
              </div>
              <ul>
                {(p.bullets as Array<{ text: string }> | undefined)?.map((b, i) => (
                  <li key={i}>
                    <ItemField as="span" arrName="bullets" idx={i} field="text" value={b.text} placeholder="Fitur…" />
                  </li>
                ))}
              </ul>
              {(editable || p.ctaLabel) ? (
                <a href={String(p.ctaHref ?? "#")} className="wb-pro-cta">
                  <Field as="span" field="ctaLabel" placeholder="Tombol CTA…" />
                </a>
              ) : null}
            </div>
          </div>
        </div>
      );

    case "CardStackShowcase":
      return (
        <div className="wb-pro-stack">
          <Field as="h2" field="title" placeholder="Judul showcase…" hideWhenEmpty />
          <div className="wb-pro-stack-wrap">
            {(p.items as Array<{ quote: string; name: string; role: string }> | undefined)
              ?.slice(0, 3)
              .map((it, i) => (
                <div key={i} className="wb-pro-stack-card">
                  <blockquote>
                    &ldquo;<ItemField as="span" arrName="items" idx={i} field="quote" value={it.quote} placeholder="Kutipan…" multiline />&rdquo;
                  </blockquote>
                  <div className="wb-pro-stack-meta">
                    <ItemField as="div" arrName="items" idx={i} field="name" className="wb-pro-stack-name" value={it.name} placeholder="Nama…" />
                    <ItemField as="div" arrName="items" idx={i} field="role" className="wb-pro-stack-role" value={it.role} placeholder="Jabatan…" />
                  </div>
                </div>
              ))}
          </div>
        </div>
      );

    case "HoverGlowGrid":
      return (
        <div className="wb-pro-hover-grid">
          <Field as="h2" field="title" placeholder="Judul grid…" hideWhenEmpty />
          <div className="wb-pro-grid">
            {(p.items as Array<{ title: string; desc: string }> | undefined)?.map((it, i) => (
              <div key={i} className="wb-pro-hover-card">
                <ItemField as="h3" arrName="items" idx={i} field="title" value={it.title} placeholder="Judul item…" />
                <ItemField as="p" arrName="items" idx={i} field="desc" value={it.desc} placeholder="Deskripsi…" multiline />
              </div>
            ))}
          </div>
        </div>
      );

    case "AnimatedCounterStats":
      return (
        <div className="wb-pro-counters">
          <Field as="h2" field="title" placeholder="Judul counter…" hideWhenEmpty />
          <div className="wb-pro-grid">
            {(p.items as Array<{ value: string; label: string }> | undefined)?.map((it, i) => (
              <div key={i} className="wb-pro-counter-cell">
                <ItemField as="div" arrName="items" idx={i} field="value" className="wb-pro-counter-value" value={it.value} placeholder="123" />
                <ItemField as="div" arrName="items" idx={i} field="label" className="wb-pro-counter-label" value={it.label} placeholder="Label…" />
              </div>
            ))}
          </div>
        </div>
      );

    case "MovingBorderCTA":
      return (
        <div className="wb-pro-mb-cta">
          <Field as="h2" field="title" placeholder="Judul CTA…" />
          <Field as="p" field="subtitle" className="wb-pro-sub" placeholder="Subjudul…" multiline hideWhenEmpty />
          {(editable || p.ctaLabel) ? (
            <a href={String(p.ctaHref ?? "#")} className="wb-pro-mb-btn">
              <span className="wb-pro-mb-inner">
                <Field as="span" field="ctaLabel" placeholder="Tombol CTA…" />
              </span>
            </a>
          ) : null}
        </div>
      );

    case "InfiniteMarqueeLogos": {
      // Duplicate items so the marquee loop is seamless.
      const top = (p.itemsTop as Array<{ name: string }> | undefined) ?? [];
      const bottom = (p.itemsBottom as Array<{ name: string }> | undefined) ?? [];
      return (
        <div className="wb-pro-marquee">
          {p.title ? <h2>{String(p.title)}</h2> : null}
          <div className="wb-pro-marquee-row">
            {[...top, ...top].map((it, i) => (
              <span key={"t" + i}>{it.name}</span>
            ))}
          </div>
          <div className="wb-pro-marquee-row">
            {[...bottom, ...bottom].map((it, i) => (
              <span key={"b" + i}>{it.name}</span>
            ))}
          </div>
        </div>
      );
    }

    case "OrbitFeatures": {
      const items = (p.items as Array<{ icon: string; label: string }> | undefined) ?? [];
      // Position items around the ring using a per-item rotate.
      return (
        <div className="wb-pro-orbit">
          <h2>{String(p.title ?? "")}</h2>
          {p.subtitle ? <p className="wb-pro-sub">{String(p.subtitle)}</p> : null}
          <div className="wb-pro-orbit-stage">
            <div className="wb-pro-orbit-center">{String(p.brand ?? "B")}</div>
            <div className="wb-pro-orbit-ring">
              {items.map((it, i) => {
                const angle = (360 / Math.max(items.length, 1)) * i;
                return (
                  <div
                    key={i}
                    className="wb-pro-orbit-item"
                    style={{ transform: `rotate(${angle}deg) translateY(-160px) rotate(${-angle}deg)` }}
                  >
                    <span>{it.icon}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      );
    }

    default:
      // Legacy types (blocks dropped from the catalog) still load; user can delete them.
      return (
        <div className="mx-6 my-2 rounded-md border border-dashed bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Blok <strong>{block.type}</strong> tidak didukung lagi. Hapus blok ini dari halaman.
        </div>
      );
  }
}
