"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Plus, Search, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ImagePicker } from "@/components/ImagePicker";
import { ColorPopover } from "@/components/ColorPopover";
import { RichEditor } from "@/components/RichEditor";
import { schemaFor, type FieldDef, type ItemField, type SelectOption } from "@/lib/blocks";
import { cn } from "@/lib/utils";
import type { BlockLayout, ThemeOverride } from "@/lib/blockLayout";

export type BlockData = {
  type: string;
  props?: Record<string, unknown>;
  // Optional wrapper-level metadata — applied by the canvas / renderer wrapper
  // around each block. Kept separate from `props` so block schemas don't need
  // to know about layout/colour overrides.
  layout?: BlockLayout;
  themeOverride?: ThemeOverride;
  // Children — populated only for container-style blocks (Container, Columns).
  // Renderer recursively walks this; non-container blocks ignore the field.
  // Schema marks containers via the optional `container: true` flag.
  children?: BlockData[];
};

const DEFAULT_GROUP = "Konten";

export function PropEditor({
  block,
  onChange,
}: {
  block: BlockData;
  onChange: (next: BlockData) => void;
}) {
  const schema = schemaFor(block.type);
  const [q, setQ] = useState("");
  const props = block.props ?? {};
  function update(name: string, value: unknown) {
    onChange({ ...block, props: { ...props, [name]: value } });
  }

  // Group fields by `group` (defaults to "Konten") so long forms can collapse.
  // Order preserved from schema declaration; group ordering follows first
  // appearance.
  const grouped = useMemo(() => {
    const out: Array<{ name: string; fields: FieldDef[] }> = [];
    const idx = new Map<string, number>();
    for (const f of schema?.fields ?? []) {
      const g = f.group ?? DEFAULT_GROUP;
      let i = idx.get(g);
      if (i == null) {
        i = out.length;
        idx.set(g, i);
        out.push({ name: g, fields: [] });
      }
      out[i].fields.push(f);
    }
    return out;
  }, [schema]);

  // Filter fields by search query — matches label OR field name. If a group
  // has zero matches after filtering, it's hidden entirely to reduce noise.
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return grouped;
    return grouped
      .map((g) => ({
        ...g,
        fields: g.fields.filter(
          (f) =>
            f.label.toLowerCase().includes(needle) ||
            f.name.toLowerCase().includes(needle),
        ),
      }))
      .filter((g) => g.fields.length > 0);
  }, [grouped, q]);

  // Early return must come after hooks — legacy block types (no schema) can
  // be selected and then swapped for a known type without remounting.
  if (!schema) {
    return (
      <p className="text-xs text-muted-foreground">
        Blok ini tidak didukung lagi dan tidak bisa diedit. Hapus blok ini dari halaman.
      </p>
    );
  }

  const singleGroup = filtered.length === 1;
  // Only show search when there are enough fields to justify it (>4).
  const showSearch = schema.fields.length > 4;

  return (
    <div className="space-y-3">
      {showSearch && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Cari field…"
            className="h-8 pl-8 pr-7 text-xs"
          />
          {q && (
            <button
              type="button"
              onClick={() => setQ("")}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              title="Clear"
            >
              <X className="size-3" />
            </button>
          )}
        </div>
      )}
      {filtered.length === 0 ? (
        <p className="rounded border border-dashed py-6 text-center text-[11px] text-muted-foreground">
          Tidak ada field cocok dengan &quot;{q}&quot;.
        </p>
      ) : (
        filtered.map((g, gi) => (
          <FieldGroup
            key={g.name}
            name={g.name}
            // Filtering usually collapses to a small set — open everything so
            // the user immediately sees matches. Unfiltered keeps default behaviour.
            defaultOpen={q.trim() !== "" || singleGroup || gi === 0}
            showHeader={!singleGroup}
          >
            {g.fields
              .filter((f) => !f.showIf || f.showIf(props))
              .map((f) => (
                <Field
                  key={f.name}
                  field={f}
                  value={props[f.name]}
                  onChange={(v) => update(f.name, v)}
                />
              ))}
          </FieldGroup>
        ))
      )}
    </div>
  );
}

function FieldGroup({
  name,
  defaultOpen,
  showHeader,
  children,
}: {
  name: string;
  defaultOpen: boolean;
  showHeader: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (!showHeader) return <div className="space-y-4">{children}</div>;
  return (
    <div className="rounded-md border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
      >
        <span>{name}</span>
        <ChevronDown className={cn("size-3.5 transition-transform", open ? "rotate-180" : "")} />
      </button>
      {open && <div className="space-y-4 border-t px-3 py-3">{children}</div>}
    </div>
  );
}

function Field({
  field,
  value,
  onChange,
}: {
  field: FieldDef;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const labelEl = (
    <Label className="flex items-center gap-1.5 text-xs">
      {field.label}
      {field.required && <span className="text-destructive">*</span>}
    </Label>
  );

  if (field.type === "string") {
    return (
      <div className="space-y-1.5">
        {labelEl}
        <Input
          value={typeof value === "string" ? value : ""}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 text-sm"
        />
        {field.help && <Help text={field.help} />}
        {field.required && !value && <ErrorText text="Wajib diisi" />}
      </div>
    );
  }
  if (field.type === "textarea") {
    return (
      <div className="space-y-1.5">
        {labelEl}
        <Textarea
          value={typeof value === "string" ? value : ""}
          rows={3}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="min-h-[60px] text-sm"
        />
        {field.help && <Help text={field.help} />}
      </div>
    );
  }
  if (field.type === "number") {
    return (
      <div className="space-y-1.5">
        {labelEl}
        <Input
          type="number"
          value={typeof value === "number" ? value : Number(value) || ""}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-8 text-sm"
        />
        {field.help && <Help text={field.help} />}
      </div>
    );
  }
  if (field.type === "image") {
    return (
      <div className="space-y-1.5">
        {labelEl}
        <ImagePicker value={typeof value === "string" ? value : ""} onChange={onChange} />
        {field.help && <Help text={field.help} />}
      </div>
    );
  }

  if (field.type === "url") {
    const v = typeof value === "string" ? value : "";
    const invalid = v !== "" && !isValidUrl(v);
    return (
      <div className="space-y-1.5">
        {labelEl}
        <Input
          type="url"
          value={v}
          placeholder={field.placeholder ?? "https://… atau /halaman"}
          onChange={(e) => onChange(e.target.value)}
          className={cn("h-8 text-sm", invalid && "border-destructive focus-visible:ring-destructive")}
        />
        {invalid && <ErrorText text="URL tidak valid (gunakan https://… atau path internal /halaman)" />}
        {field.help && !invalid && <Help text={field.help} />}
      </div>
    );
  }

  if (field.type === "color") {
    const v = typeof value === "string" ? value : "";
    return (
      <div className="space-y-1.5">
        {labelEl}
        <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-2 py-1.5">
          <ColorPopover value={v} onChange={onChange} onClear={() => onChange("")} />
          <span className="flex-1 font-mono text-xs uppercase text-muted-foreground">
            {v || "—"}
          </span>
        </div>
        {field.help && <Help text={field.help} />}
      </div>
    );
  }

  if (field.type === "select") {
    const v = typeof value === "string" ? value : "";
    return (
      <div className="space-y-1.5">
        {labelEl}
        <select
          value={v}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">Pilih…</option>
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {field.help && <Help text={field.help} />}
      </div>
    );
  }

  if (field.type === "icon") {
    const v = typeof value === "string" ? value : "";
    return (
      <div className="space-y-1.5">
        {labelEl}
        <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-2 py-1.5">
          <span className="grid size-7 place-items-center rounded border bg-background text-base">
            {v || "?"}
          </span>
          <Input
            value={v}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Tempel emoji (mis. 🚀)"
            className="h-7 flex-1 border-0 bg-transparent text-sm shadow-none focus-visible:ring-0"
          />
        </div>
        {field.help && <Help text={field.help} />}
      </div>
    );
  }

  if (field.type === "richtext") {
    // Markdown round-trip via TipTap. Stored as a plain markdown string so
    // the Go static-export pipeline (gomarkdown) and the renderer (marked)
    // both consume it without extra deserialisation.
    return (
      <div className="space-y-1.5">
        {labelEl}
        <RichEditor
          value={typeof value === "string" ? value : ""}
          onChange={(md) => onChange(md)}
          placeholder={field.placeholder ?? "Tulis konten…"}
        />
        {field.help && <Help text={field.help} />}
      </div>
    );
  }

  // strings — array of plain strings (vs items which has named fields).
  // Dipakai untuk tag list, participants, dsb. Satu input per entry +
  // tombol tambah/hapus.
  if (field.type === "strings") {
    const list = Array.isArray(value) ? (value as unknown[]).map((v) => String(v ?? "")) : [];
    function updateStr(i: number, next: string) {
      const copy = [...list];
      copy[i] = next;
      onChange(copy);
    }
    function removeStr(i: number) {
      onChange(list.filter((_, idx) => idx !== i));
    }
    function addStr() {
      onChange([...list, ""]);
    }
    function moveStr(i: number, dir: -1 | 1) {
      const j = i + dir;
      if (j < 0 || j >= list.length) return;
      const copy = [...list];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      onChange(copy);
    }
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          {labelEl}
          <Button type="button" variant="ghost" size="sm" onClick={addStr} className="h-7 gap-1 px-2">
            <Plus className="size-3" />
            Tambah
          </Button>
        </div>
        <div className="space-y-1.5">
          {list.map((s, i) => (
            <div key={i} className="flex items-center gap-1">
              <Input
                value={s}
                onChange={(e) => updateStr(i, e.target.value)}
                placeholder={field.placeholder ?? ""}
                className="h-8"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 shrink-0"
                onClick={() => moveStr(i, -1)}
                title="Naik"
              >
                <ChevronUp className="size-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 shrink-0"
                onClick={() => moveStr(i, 1)}
                title="Turun"
              >
                <ChevronDown className="size-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 shrink-0 text-destructive hover:text-destructive"
                onClick={() => removeStr(i)}
                title="Hapus"
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
          {list.length === 0 && (
            <p className="text-xs text-muted-foreground">Belum ada entry. Klik Tambah.</p>
          )}
        </div>
        {field.help && <Help text={field.help} />}
      </div>
    );
  }

  // items
  if (field.type !== "items") return null;
  const items = Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
  const itemFields = field.itemFields;
  function updateItem(i: number, patch: Record<string, unknown>) {
    const next = [...items];
    next[i] = { ...next[i], ...patch };
    onChange(next);
  }
  function removeItem(i: number) {
    onChange(items.filter((_, idx) => idx !== i));
  }
  function addItem() {
    const empty: Record<string, unknown> = {};
    itemFields.forEach((f) => (empty[f.name] = ""));
    onChange([...items, empty]);
  }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        {labelEl}
        <Button type="button" variant="ghost" size="sm" onClick={addItem} className="h-7 gap-1 px-2">
          <Plus className="size-3" />
          Tambah
        </Button>
      </div>
      <div className="space-y-2">
        {items.map((it, i) => (
          <div
            key={i}
            className="space-y-2 rounded-md border border-input bg-muted/30 p-2.5"
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-medium uppercase text-muted-foreground">
                #{i + 1}
              </span>
              <div className="flex gap-0.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  onClick={() => move(i, -1)}
                  title="Naik"
                >
                  <ChevronUp className="size-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  onClick={() => move(i, 1)}
                  title="Turun"
                >
                  <ChevronDown className="size-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-6 text-destructive hover:text-destructive"
                  onClick={() => removeItem(i)}
                  title="Hapus"
                >
                  <X className="size-3.5" />
                </Button>
              </div>
            </div>
            <div className="space-y-1.5">
              {itemFields.map((sf) => (
                <ItemFieldInput
                  key={sf.name}
                  sf={sf}
                  value={it[sf.name]}
                  onChange={(v) => updateItem(i, { [sf.name]: v })}
                />
              ))}
            </div>
          </div>
        ))}
        {items.length === 0 && (
          <p className="rounded border border-dashed py-3 text-center text-xs text-muted-foreground">
            Belum ada item.
          </p>
        )}
      </div>
    </div>
  );
}

function ItemFieldInput({
  sf,
  value,
  onChange,
}: {
  sf: ItemField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const label = (
    <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
      {sf.label}
    </Label>
  );
  if (sf.type === "textarea") {
    return (
      <div className="space-y-1">
        {label}
        <Textarea
          value={typeof value === "string" ? value : ""}
          rows={2}
          onChange={(e) => onChange(e.target.value)}
          className="min-h-[50px] text-xs"
        />
      </div>
    );
  }
  if (sf.type === "image") {
    return (
      <div className="space-y-1">
        {label}
        <ImagePicker
          size="sm"
          value={typeof value === "string" ? value : ""}
          onChange={onChange}
        />
      </div>
    );
  }
  if (sf.type === "url") {
    const v = typeof value === "string" ? value : "";
    const invalid = v !== "" && !isValidUrl(v);
    return (
      <div className="space-y-1">
        {label}
        <Input
          type="url"
          value={v}
          onChange={(e) => onChange(e.target.value)}
          className={cn("h-7 text-xs", invalid && "border-destructive focus-visible:ring-destructive")}
        />
        {invalid && <ErrorText text="URL invalid" />}
      </div>
    );
  }
  if (sf.type === "color") {
    const v = typeof value === "string" ? value : "";
    return (
      <div className="space-y-1">
        {label}
        <div className="flex items-center gap-1.5">
          <ColorPopover
            size="sm"
            value={v}
            onChange={onChange}
            onClear={() => onChange("")}
          />
          <span className="flex-1 font-mono text-[10px] uppercase text-muted-foreground">
            {v || "—"}
          </span>
        </div>
      </div>
    );
  }
  if (sf.type === "select") {
    return (
      <div className="space-y-1">
        {label}
        <select
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">Pilih…</option>
          {(sf as { options: SelectOption[] }).options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      {label}
      <Input
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 text-xs"
      />
    </div>
  );
}

function Help({ text }: { text: string }) {
  return <p className="text-[11px] leading-snug text-muted-foreground">{text}</p>;
}

function ErrorText({ text }: { text: string }) {
  return <p className="text-[11px] leading-snug text-destructive">{text}</p>;
}

// Accept https://, http://, mailto:, tel:, and internal paths starting with "/" or "#".
function isValidUrl(s: string): boolean {
  if (s.startsWith("/") || s.startsWith("#") || s.startsWith("mailto:") || s.startsWith("tel:")) {
    return true;
  }
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
