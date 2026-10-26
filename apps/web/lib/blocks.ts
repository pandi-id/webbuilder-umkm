// Block schemas drive the editor's add-block menu and per-block prop form.
// They must stay in sync with the block render code in:
//   - apps/web/app/sites/[id]/editor/page.tsx (preview)
//   - apps/renderer/components/Blocks.tsx     (live render)
//   - apps/api/internal/exports/render.go     (static export)
// Umkm* blocks share markup via components/umkm/UmkmBlocks.tsx (web + renderer)
// and render_umkm.go in the exporter.

// Field kinds the PropEditor can render. New kinds extend this union; the
// PropEditor's <Field> switch must stay exhaustive.
export type FieldType =
  | "string"
  | "textarea"
  | "number"
  | "image"
  | "items"
  | "url"
  | "color"
  | "select"
  | "icon"
  | "richtext"; // markdown — rendered via TipTap, persisted as MD string

export type ItemField =
  | { name: string; label: string; type: "string" | "textarea" | "image" | "url" | "color" }
  | { name: string; label: string; type: "select"; options: SelectOption[] };

export type SelectOption = { value: string; label: string };

// Common fields — `group` controls accordion grouping in the PropEditor
// (defaults to "Konten"). `showIf` hides the field unless its predicate is true.
type FieldBase = {
  name: string;
  label: string;
  group?: string;
  help?: string;
  required?: boolean;
  showIf?: (props: Record<string, unknown>) => boolean;
};

export type FieldDef =
  | (FieldBase & {
      type: "string" | "textarea" | "number" | "image" | "url" | "color" | "icon" | "richtext";
      placeholder?: string;
    })
  | (FieldBase & { type: "items"; itemFields: ItemField[] })
  | (FieldBase & { type: "strings"; placeholder?: string })
  | (FieldBase & { type: "select"; options: SelectOption[] });

export type BlockCategory =
  | "umkm"
  | "pro"
  | "layout"
  | "hero"
  | "konten"
  | "showcase"
  | "marketing"
  | "sosial"
  | "media"
  | "list"
  | "dynamic";

export const CATEGORY_LABELS: Record<BlockCategory, string> = {
  umkm: "UMKM Pro",
  pro: "Pro ✨",
  layout: "Layout",
  hero: "Hero",
  konten: "Konten",
  showcase: "Showcase",
  marketing: "Marketing",
  sosial: "Sosial Proof",
  media: "Media",
  list: "List",
  dynamic: "Dynamic (DB)",
};

export type BlockSchema = {
  type: string;
  label: string;
  category: BlockCategory;
  description?: string;
  emoji?: string;
  defaults: Record<string, unknown>;
  fields: FieldDef[];
  // `container: true` marks a block whose children should be rendered as
  // nested blocks (recursive). The editor surfaces a "Konten Dalam" section
  // for these blocks so users can add/reorder/delete inner content. The
  // renderer + Go export walk `children` recursively for these types.
  container?: boolean;
};

// Convenience — does this schema accept nested blocks?
export function isContainer(type: string): boolean {
  return Boolean(schemaFor(type)?.container);
}


// Shared option lists for the UMKM block family.
const UMKM_BADGE_OPTIONS: SelectOption[] = [
  { value: "none", label: "Tanpa badge" },
  { value: "terlaris", label: "Terlaris" },
  { value: "baru", label: "Baru" },
  { value: "promo", label: "Promo" },
  { value: "habis", label: "Habis" },
];
const UMKM_COLUMN_OPTIONS: SelectOption[] = [
  { value: "4", label: "4 kolom" },
  { value: "3", label: "3 kolom" },
];
const UMKM_RATING_OPTIONS: SelectOption[] = ["5", "4", "3", "2", "1"].map((v) => ({ value: v, label: `${v} bintang` }));
const UMKM_PLATFORM_OPTIONS: SelectOption[] = [
  { value: "shopee", label: "Shopee" },
  { value: "tokopedia", label: "Tokopedia" },
  { value: "tiktokshop", label: "TikTok Shop" },
  { value: "lazada", label: "Lazada" },
  { value: "gofood", label: "GoFood" },
  { value: "grabfood", label: "GrabFood" },
  { value: "shopeefood", label: "ShopeeFood" },
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "website", label: "Website lain" },
];
const UMKM_TRUST_ICON_OPTIONS: SelectOption[] = [
  { value: "halal", label: "Halal" },
  { value: "pirt", label: "P-IRT" },
  { value: "bpom", label: "BPOM" },
  { value: "sni", label: "SNI" },
  { value: "qris", label: "QRIS" },
  { value: "cod", label: "COD / bayar di tempat" },
  { value: "transfer", label: "Transfer bank" },
  { value: "delivery", label: "Pengiriman" },
  { value: "guarantee", label: "Garansi" },
  { value: "handmade", label: "Buatan tangan" },
];

export const blockSchemas: BlockSchema[] = [

  // ---------- UMKM Pro ----------
  // Markup + CSS shared via components/umkm (web + renderer); Go mirror in
  // apps/api/internal/exports/render_umkm.go.
  {
    type: "UmkmHero",
    label: "Hero Toko UMKM",
    category: "umkm",
    emoji: "🏪",
    description: "Hero split dengan tombol pesan WhatsApp, keunggulan, dan rating",
    defaults: {
      eyebrow: "Buka setiap hari · 08.00–22.00",
      title: "Kopi susu gula aren, diseduh segar setiap hari",
      subtitle:
        "Biji kopi pilihan dari petani Garut, disangrai sendiri dan diantar hangat ke rumahmu. Pesan lewat WhatsApp, kami balas kurang dari 5 menit.",
      ctaLabel: "Pesan via WhatsApp",
      waNumber: "081234567890",
      waMessage: "Halo Kopi Senja, saya mau pesan kopi.",
      ctaSecondaryLabel: "Lihat Menu",
      ctaSecondaryHref: "#menu",
      image: "",
      chips: ["100% Halal", "Gratis ongkir Bandung", "Bisa bayar di tempat"],
      rating: "4.9 dari 1.200+ pembeli",
    },
    fields: [
      { name: "eyebrow", label: "Info singkat (badge)", type: "string", placeholder: "Buka setiap hari 08.00–21.00" },
      { name: "title", label: "Judul", type: "string" },
      { name: "subtitle", label: "Deskripsi", type: "textarea" },
      { name: "image", label: "Foto utama", type: "image" },
      { name: "chips", label: "Keunggulan (maks. 3)", type: "strings", placeholder: "100% Halal" },
      { name: "rating", label: "Teks rating", type: "string", placeholder: "4.9 dari 1.200+ pembeli" },
      { name: "ctaLabel", label: "Label tombol WhatsApp", type: "string", group: "Tombol" },
      { name: "waNumber", label: "Nomor WhatsApp", type: "string", group: "Tombol", placeholder: "0812xxxxxxx", help: "Format 08xx atau 628xx — otomatis dirapikan." },
      { name: "waMessage", label: "Pesan awal WhatsApp", type: "textarea", group: "Tombol" },
      { name: "ctaSecondaryLabel", label: "Label tombol kedua", type: "string", group: "Tombol" },
      { name: "ctaSecondaryHref", label: "Link tombol kedua", type: "url", group: "Tombol" },
    ],
  },
  {
    type: "UmkmProductShowcase",
    label: "Etalase Produk",
    category: "umkm",
    emoji: "🛒",
    description: "Kartu produk unggulan dengan harga coret, badge, dan tombol pesan WA",
    defaults: {
      title: "Menu Favorit",
      subtitle: "Paling sering dipesan pelanggan minggu ini.",
      waNumber: "081234567890",
      buttonLabel: "Pesan",
      columns: "4",
      anchorId: "menu",
      items: [
        { name: "Kopi Susu Gula Aren", image: "", price: "Rp 22.000", originalPrice: "Rp 28.000", badge: "terlaris", desc: "Espresso, susu segar, dan gula aren asli Garut. 250 ml." },
        { name: "Es Kopi Pandan", image: "", price: "Rp 25.000", originalPrice: "", badge: "baru", desc: "Kopi susu dengan sirup pandan wangi buatan sendiri." },
        { name: "Paket Hemat Berdua", image: "", price: "Rp 45.000", originalPrice: "Rp 56.000", badge: "promo", desc: "2 kopi susu + 2 roti bakar cokelat keju." },
        { name: "Kopi Literan 1 Liter", image: "", price: "Rp 85.000", originalPrice: "", badge: "none", desc: "Cukup untuk 6–8 gelas, tahan 3 hari di kulkas." },
      ],
    },
    fields: [
      { name: "title", label: "Judul", type: "string" },
      { name: "subtitle", label: "Subjudul", type: "textarea" },
      {
        name: "items",
        label: "Produk",
        type: "items",
        itemFields: [
          { name: "name", label: "Nama produk", type: "string" },
          { name: "image", label: "Foto", type: "image" },
          { name: "price", label: "Harga", type: "string" },
          { name: "originalPrice", label: "Harga coret (opsional)", type: "string" },
          { name: "badge", label: "Badge", type: "select", options: UMKM_BADGE_OPTIONS },
          { name: "desc", label: "Deskripsi singkat", type: "textarea" },
        ],
      },
      { name: "waNumber", label: "Nomor WhatsApp pesanan", type: "string", group: "Pemesanan", placeholder: "0812xxxxxxx" },
      { name: "buttonLabel", label: "Label tombol", type: "string", group: "Pemesanan" },
      { name: "columns", label: "Kolom di desktop", type: "select", options: UMKM_COLUMN_OPTIONS, group: "Tampilan" },
      { name: "anchorId", label: "ID anchor (untuk link #menu)", type: "string", group: "Tampilan" },
    ],
  },
  {
    type: "UmkmCatalogDynamic",
    label: "Katalog Produk (DB)",
    category: "umkm",
    emoji: "🗂️",
    description: "Kartu produk otomatis dari tab Produk, tombol pesan via WhatsApp",
    defaults: {
      title: "Semua Produk",
      subtitle: "Stok diperbarui setiap hari.",
      waNumber: "081234567890",
      buttonLabel: "Pesan",
      limit: 8,
      category: "",
      showOutOfStock: "no",
      columns: "4",
      anchorId: "produk",
    },
    fields: [
      { name: "title", label: "Judul", type: "string" },
      { name: "subtitle", label: "Subjudul", type: "textarea" },
      { name: "limit", label: "Jumlah maks", type: "number" },
      { name: "category", label: "Filter kategori (opsional)", type: "string", help: "Sama persis dengan kategori di tab Produk. Kosongkan untuk semua." },
      {
        name: "showOutOfStock",
        label: "Produk stok habis",
        type: "select",
        options: [
          { value: "no", label: "Sembunyikan" },
          { value: "yes", label: "Tampilkan dengan label Habis" },
        ],
      },
      { name: "waNumber", label: "Nomor WhatsApp pesanan", type: "string", group: "Pemesanan", placeholder: "0812xxxxxxx" },
      { name: "buttonLabel", label: "Label tombol", type: "string", group: "Pemesanan" },
      { name: "columns", label: "Kolom di desktop", type: "select", options: UMKM_COLUMN_OPTIONS, group: "Tampilan" },
      { name: "anchorId", label: "ID anchor", type: "string", group: "Tampilan" },
    ],
  },
  {
    type: "UmkmPromoBanner",
    label: "Banner Promo & Voucher",
    category: "umkm",
    emoji: "🏷️",
    description: "Kartu promo dengan label diskon, kode voucher yang bisa disalin, dan CTA",
    defaults: {
      discountLabel: "Diskon 20%",
      headline: "Promo Gajian: semua kopi literan",
      description: "Berlaku untuk pembelian langsung maupun lewat WhatsApp. Minimal belanja Rp 50.000.",
      voucherCode: "GAJIAN20",
      validUntil: "Berlaku sampai 31 Desember 2026",
      ctaLabel: "Pakai Sekarang",
      ctaHref: "",
      waNumber: "081234567890",
    },
    fields: [
      { name: "discountLabel", label: "Label diskon", type: "string" },
      { name: "headline", label: "Judul promo", type: "string" },
      { name: "description", label: "Deskripsi / syarat", type: "textarea" },
      { name: "voucherCode", label: "Kode voucher (opsional)", type: "string" },
      { name: "validUntil", label: "Masa berlaku", type: "string" },
      { name: "ctaLabel", label: "Label tombol", type: "string", group: "Tombol" },
      { name: "waNumber", label: "Nomor WhatsApp", type: "string", group: "Tombol", help: "Kalau diisi, tombol membuka WhatsApp dengan kode voucher." },
      { name: "ctaHref", label: "Link tombol (kalau tanpa WhatsApp)", type: "url", group: "Tombol" },
    ],
  },
  {
    type: "UmkmStoreInfo",
    label: "Info Toko & Lokasi",
    category: "umkm",
    emoji: "📍",
    description: "Alamat, peta, jam buka, kontak, dan area pengiriman",
    defaults: {
      title: "Kunjungi Toko Kami",
      subtitle: "Ngopi di tempat atau ambil pesanan langsung.",
      address: "Jl. Braga No. 21, Sumur Bandung, Kota Bandung, Jawa Barat 40111",
      mapSrc: "",
      showMap: "yes",
      hours: [
        { day: "Senin – Jumat", hours: "08.00 – 22.00" },
        { day: "Sabtu – Minggu", hours: "07.00 – 23.00" },
        { day: "Libur nasional", hours: "10.00 – 20.00" },
      ],
      phone: "0812-3456-7890",
      waNumber: "081234567890",
      waMessage: "Halo, saya mau tanya soal pesanan.",
      email: "halo@kopisenja.id",
      areas: ["Bandung Kota", "Cimahi", "Dago & Lembang", "Antapani"],
      anchorId: "lokasi",
    },
    fields: [
      { name: "title", label: "Judul", type: "string" },
      { name: "subtitle", label: "Subjudul", type: "textarea" },
      { name: "address", label: "Alamat", type: "textarea" },
      {
        name: "hours",
        label: "Jam buka",
        type: "items",
        itemFields: [
          { name: "day", label: "Hari", type: "string" },
          { name: "hours", label: "Jam", type: "string" },
        ],
      },
      { name: "phone", label: "Telepon", type: "string" },
      { name: "waNumber", label: "Nomor WhatsApp", type: "string", placeholder: "0812xxxxxxx" },
      { name: "waMessage", label: "Pesan awal WhatsApp", type: "textarea" },
      { name: "email", label: "Email", type: "string" },
      { name: "areas", label: "Area pengiriman", type: "strings", placeholder: "Nama kota/kecamatan" },
      {
        name: "showMap",
        label: "Peta",
        type: "select",
        group: "Peta",
        options: [
          { value: "yes", label: "Tampilkan" },
          { value: "no", label: "Sembunyikan" },
        ],
      },
      { name: "mapSrc", label: "URL embed Google Maps (opsional)", type: "url", group: "Peta", help: "Kosongkan untuk membuat peta otomatis dari alamat. Hanya google.com/maps yang didukung." },
      { name: "anchorId", label: "ID anchor", type: "string", group: "Tampilan" },
    ],
  },
  {
    type: "UmkmMarketplaceLinks",
    label: "Link Marketplace",
    category: "umkm",
    emoji: "🛍️",
    description: "Tombol ke Shopee, Tokopedia, GoFood, GrabFood, dan lainnya",
    defaults: {
      title: "Juga tersedia di",
      subtitle: "Belanja lewat aplikasi favoritmu — promo berbeda di tiap platform.",
      items: [
        { platform: "shopee", url: "https://shopee.co.id/", label: "Kopi Senja Official" },
        { platform: "tokopedia", url: "https://www.tokopedia.com/", label: "Kopi Senja Store" },
        { platform: "gofood", url: "https://gofood.co.id/", label: "Kopi Senja Braga" },
        { platform: "grabfood", url: "https://food.grab.com/id/", label: "Kopi Senja Braga" },
        { platform: "instagram", url: "https://instagram.com/", label: "@kopisenja.bdg" },
      ],
    },
    fields: [
      { name: "title", label: "Judul", type: "string" },
      { name: "subtitle", label: "Subjudul", type: "textarea" },
      {
        name: "items",
        label: "Platform",
        type: "items",
        itemFields: [
          { name: "platform", label: "Platform", type: "select", options: UMKM_PLATFORM_OPTIONS },
          { name: "url", label: "Link toko", type: "url" },
          { name: "label", label: "Nama toko (opsional)", type: "string" },
        ],
      },
    ],
  },
  {
    type: "UmkmTrustBadges",
    label: "Badge Kepercayaan",
    category: "umkm",
    emoji: "🛡️",
    description: "Halal, P-IRT, BPOM, QRIS, COD, garansi — tampil dengan ikon",
    defaults: {
      title: "Kenapa belanja di Kopi Senja?",
      subtitle: "",
      items: [
        { icon: "halal", title: "Bersertifikat Halal", desc: "Nomor sertifikat BPJPH tercantum di setiap kemasan." },
        { icon: "pirt", title: "Izin P-IRT", desc: "Diproduksi di dapur yang terdaftar dan diawasi Dinkes." },
        { icon: "qris", title: "Bayar pakai QRIS", desc: "Semua e-wallet dan m-banking bisa." },
        { icon: "delivery", title: "Kirim hari ini", desc: "Pesan sebelum 15.00, dikirim hari itu juga." },
        { icon: "guarantee", title: "Garansi uang kembali", desc: "Produk rusak saat diterima? Kami ganti." },
      ],
    },
    fields: [
      { name: "title", label: "Judul", type: "string" },
      { name: "subtitle", label: "Subjudul", type: "textarea" },
      {
        name: "items",
        label: "Badge",
        type: "items",
        itemFields: [
          { name: "icon", label: "Ikon", type: "select", options: UMKM_TRUST_ICON_OPTIONS },
          { name: "title", label: "Judul", type: "string" },
          { name: "desc", label: "Keterangan", type: "textarea" },
        ],
      },
    ],
  },
  {
    type: "UmkmReviews",
    label: "Ulasan Pelanggan",
    category: "umkm",
    emoji: "⭐",
    description: "Ulasan dengan rating bintang, ringkasan nilai, dan foto pembeli",
    defaults: {
      title: "Kata pelanggan kami",
      subtitle: "",
      average: "4.9",
      countText: "dari 1.248 ulasan di Google & marketplace",
      items: [
        { name: "Rina Marlina", location: "Bandung · Kopi Susu Gula Aren", rating: "5", text: "Manisnya pas, kopinya tetap kerasa. Sudah langganan tiap pagi sebelum ngantor, adminnya juga ramah banget.", photo: "" },
        { name: "Dimas Prasetyo", location: "Cimahi · Kopi Literan 1 Liter", rating: "5", text: "Beli literan buat stok seminggu, rasanya konsisten dan pengirimannya cepat. Botolnya rapi, nggak ada yang bocor.", photo: "" },
        { name: "Sari Wulandari", location: "Lembang · Paket Hemat Berdua", rating: "4", text: "Roti bakarnya enak, kopinya mantap. Semoga nanti ada pilihan less sugar juga.", photo: "" },
      ],
    },
    fields: [
      { name: "title", label: "Judul", type: "string" },
      { name: "subtitle", label: "Subjudul", type: "textarea" },
      { name: "average", label: "Nilai rata-rata", type: "string", placeholder: "4.9" },
      { name: "countText", label: "Teks jumlah ulasan", type: "string" },
      {
        name: "items",
        label: "Ulasan",
        type: "items",
        itemFields: [
          { name: "name", label: "Nama", type: "string" },
          { name: "location", label: "Kota · produk dibeli", type: "string" },
          { name: "rating", label: "Rating", type: "select", options: UMKM_RATING_OPTIONS },
          { name: "text", label: "Isi ulasan", type: "textarea" },
          { name: "photo", label: "Foto (opsional)", type: "image" },
        ],
      },
    ],
  },
  {
    type: "UmkmWhatsAppFloat",
    label: "Tombol WhatsApp Melayang",
    category: "umkm",
    emoji: "💬",
    description: "Tombol chat WhatsApp yang selalu terlihat di pojok layar",
    defaults: {
      waNumber: "081234567890",
      waMessage: "Halo admin, saya mau tanya produk.",
      label: "Tanya admin",
      position: "right",
      color: "whatsapp",
    },
    fields: [
      { name: "waNumber", label: "Nomor WhatsApp", type: "string", placeholder: "0812xxxxxxx" },
      { name: "waMessage", label: "Pesan awal", type: "textarea" },
      { name: "label", label: "Teks gelembung (opsional)", type: "string" },
      {
        name: "position",
        label: "Posisi",
        type: "select",
        options: [
          { value: "right", label: "Kanan bawah" },
          { value: "left", label: "Kiri bawah" },
        ],
      },
      {
        name: "color",
        label: "Warna tombol",
        type: "select",
        options: [
          { value: "whatsapp", label: "Hijau WhatsApp" },
          { value: "theme", label: "Warna utama tema" },
        ],
      },
    ],
  },
  // ---------- Layout ----------
  {
    type: "Navbar",
    label: "Navbar",
    category: "layout",
    emoji: "🧭",
    description: "Header navigasi dengan brand + menu",
    defaults: { brand: "Brand", links: [{ label: "Beranda", href: "/" }] },
    fields: [
      { name: "brand", label: "Brand", type: "string" },
      {
        name: "links",
        label: "Menu",
        type: "items",
        itemFields: [
          { name: "label", label: "Label", type: "string" },
          { name: "href", label: "Tautan", type: "url" },
        ],
      },
    ],
  },
  {
    type: "Footer",
    label: "Footer",
    category: "layout",
    emoji: "🦶",
    description: "Footer copyright minimal",
    defaults: { copyright: "© 2025" },
    fields: [{ name: "copyright", label: "Copyright", type: "string" }],
  },
  {
    type: "Section",
    label: "Section Teks",
    category: "layout",
    emoji: "📐",
    description: "Section dengan judul + paragraf",
    defaults: { title: "Judul Section", body: "Deskripsi singkat." },
    fields: [
      { name: "title", label: "Judul", type: "string" },
      { name: "body", label: "Isi", type: "textarea" },
    ],
  },

  // ---------- Hero ----------
  {
    type: "Hero",
    label: "Hero Standar",
    category: "hero",
    emoji: "🎯",
    description: "Centered hero dengan CTA",
    defaults: { title: "Judul Hero", subtitle: "Subjudul singkat.", ctaLabel: "Mulai", ctaHref: "#" },
    fields: [
      { name: "title", label: "Judul", type: "string" },
      { name: "subtitle", label: "Subjudul", type: "textarea" },
      { name: "ctaLabel", label: "CTA Label", type: "string" },
      { name: "ctaHref", label: "CTA Link", type: "string" },
    ],
  },
  {
    type: "HeroSpotlight",
    label: "Hero Spotlight ✨",
    category: "hero",
    emoji: "🌟",
    description: "Hero dengan spotlight gradient animasi (Aceternity-style)",
    defaults: {
      eyebrow: "Pengumuman",
      title: "Bangun produk yang dicintai pengguna",
      subtitle: "Platform lengkap untuk meluncurkan ide Anda dengan cepat dan elegan.",
      ctaLabel: "Mulai Gratis",
      ctaHref: "#",
      ctaSecondaryLabel: "Lihat Demo",
      ctaSecondaryHref: "#",
    },
    fields: [
      { name: "eyebrow", label: "Eyebrow (label kecil di atas)", type: "string" },
      { name: "title", label: "Judul", type: "string" },
      { name: "subtitle", label: "Subjudul", type: "textarea" },
      { name: "ctaLabel", label: "CTA Utama Label", type: "string" },
      { name: "ctaHref", label: "CTA Utama Link", type: "string" },
      { name: "ctaSecondaryLabel", label: "CTA Sekunder Label", type: "string" },
      { name: "ctaSecondaryHref", label: "CTA Sekunder Link", type: "string" },
    ],
  },

  // ---------- Konten ----------
  {
    type: "Heading",
    label: "Heading",
    category: "konten",
    emoji: "📝",
    description: "Judul level 1-6",
    defaults: { text: "Judul", level: 2 },
    fields: [
      { name: "text", label: "Teks", type: "string" },
      { name: "level", label: "Level (1-6)", type: "number" },
    ],
  },
  {
    type: "Text",
    label: "Paragraf",
    category: "konten",
    emoji: "📄",
    description: "Paragraf teks panjang",
    defaults: { body: "Tulis isi paragraf di sini." },
    fields: [{ name: "body", label: "Isi", type: "textarea" }],
  },
  {
    type: "RichText",
    label: "Rich Text",
    category: "konten",
    emoji: "✍️",
    description: "Editor markdown — heading, list, link, bold/italic, code, blockquote",
    defaults: {
      body: "## Judul Bagian\n\nKonten **markdown** lengkap dengan _italic_, [link](https://example.com), dan list:\n\n- Poin pertama\n- Poin kedua\n- Poin ketiga\n",
    },
    fields: [
      {
        name: "body",
        label: "Konten",
        type: "richtext",
        help: "Mendukung markdown penuh: #, *, _, >, `, [link](url), ![image](url), tabel, kode.",
      },
    ],
  },

  // ---------- Showcase ----------
  {
    type: "FeatureList",
    label: "Feature List",
    category: "showcase",
    emoji: "✨",
    description: "Grid 3 kolom fitur/value prop",
    defaults: {
      title: "Mengapa Memilih Kami",
      items: [
        { title: "Fitur A", desc: "Penjelasan singkat." },
        { title: "Fitur B", desc: "Penjelasan singkat." },
        { title: "Fitur C", desc: "Penjelasan singkat." },
      ],
    },
    fields: [
      { name: "title", label: "Judul", type: "string" },
      {
        name: "items",
        label: "Item",
        type: "items",
        itemFields: [
          { name: "title", label: "Judul", type: "string" },
          { name: "desc", label: "Deskripsi", type: "textarea" },
        ],
      },
    ],
  },
  {
    type: "BentoGrid",
    label: "Bento Grid ✨",
    category: "showcase",
    emoji: "🍱",
    description: "Layout asimetris ala bento untuk fitur unggulan",
    defaults: {
      title: "Semua dalam Satu Platform",
      items: [
        { title: "Fast", desc: "Performa kilat dengan caching otomatis.", size: "large" },
        { title: "Secure", desc: "End-to-end encryption.", size: "small" },
        { title: "Scalable", desc: "Auto-scaling.", size: "small" },
        { title: "Developer Friendly", desc: "API yang clean dan SDK lengkap.", size: "wide" },
      ],
    },
    fields: [
      { name: "title", label: "Judul", type: "string" },
      {
        name: "items",
        label: "Cell",
        type: "items",
        itemFields: [
          { name: "title", label: "Judul", type: "string" },
          { name: "desc", label: "Deskripsi", type: "textarea" },
          { name: "size", label: "Ukuran (small/wide/large)", type: "string" },
        ],
      },
    ],
  },
  {
    type: "StatsBar",
    label: "Stats Bar ✨",
    category: "showcase",
    emoji: "📊",
    description: "Deretan angka besar dengan label",
    defaults: {
      items: [
        { value: "10k+", label: "Pengguna Aktif" },
        { value: "99.9%", label: "Uptime" },
        { value: "150+", label: "Negara" },
        { value: "4.9★", label: "Rating" },
      ],
    },
    fields: [
      {
        name: "items",
        label: "Statistik",
        type: "items",
        itemFields: [
          { name: "value", label: "Nilai (mis. 10k+)", type: "string" },
          { name: "label", label: "Label", type: "string" },
        ],
      },
    ],
  },
  {
    type: "LogoCloud",
    label: "Logo Cloud ✨",
    category: "showcase",
    emoji: "🏢",
    description: "Logo partner / klien dalam baris",
    defaults: {
      title: "Dipercaya oleh tim hebat",
      items: [
        { name: "Acme", image: "" },
        { name: "Globex", image: "" },
        { name: "Initech", image: "" },
        { name: "Umbrella", image: "" },
        { name: "Soylent", image: "" },
      ],
    },
    fields: [
      { name: "title", label: "Judul", type: "string" },
      {
        name: "items",
        label: "Logo",
        type: "items",
        itemFields: [
          { name: "name", label: "Nama", type: "string" },
          { name: "image", label: "Logo", type: "image" },
        ],
      },
    ],
  },

  // ---------- Marketing ----------
  {
    type: "CTABanner",
    label: "CTA Banner ✨",
    category: "marketing",
    emoji: "📣",
    description: "Banner ajakan dengan gradient + tombol besar",
    defaults: {
      title: "Siap memulai?",
      subtitle: "Daftar gratis dan rasakan sendiri perbedaannya dalam 2 menit.",
      ctaLabel: "Coba Gratis",
      ctaHref: "#",
    },
    fields: [
      { name: "title", label: "Judul", type: "string" },
      { name: "subtitle", label: "Subjudul", type: "textarea" },
      { name: "ctaLabel", label: "CTA Label", type: "string" },
      { name: "ctaHref", label: "CTA Link", type: "string" },
    ],
  },
  {
    type: "PricingTable",
    label: "Pricing Table ✨",
    category: "marketing",
    emoji: "💎",
    description: "3-tier pricing card",
    defaults: {
      title: "Harga Sederhana",
      subtitle: "Pilih paket yang sesuai kebutuhan.",
      items: [
        {
          title: "Starter",
          price: "Gratis",
          period: "selamanya",
          desc: "Untuk mencoba",
          features: "1 situs\n100 halaman\nSSL otomatis\nSupport email",
          ctaLabel: "Mulai",
          ctaHref: "#",
          featured: "",
        },
        {
          title: "Pro",
          price: "Rp 99.000",
          period: "per bulan",
          desc: "Paling populer",
          features: "Unlimited situs\nUnlimited halaman\nCustom domain\nPriority support\nAdvanced analytics",
          ctaLabel: "Coba Pro",
          ctaHref: "#",
          featured: "yes",
        },
        {
          title: "Business",
          price: "Rp 299.000",
          period: "per bulan",
          desc: "Untuk tim",
          features: "Semua di Pro\n10 anggota tim\nAPI access\nSLA 99.99%\nDedicated manager",
          ctaLabel: "Hubungi Sales",
          ctaHref: "#",
          featured: "",
        },
      ],
    },
    fields: [
      { name: "title", label: "Judul", type: "string" },
      { name: "subtitle", label: "Subjudul", type: "textarea" },
      {
        name: "items",
        label: "Paket",
        type: "items",
        itemFields: [
          { name: "title", label: "Nama Paket", type: "string" },
          { name: "price", label: "Harga", type: "string" },
          { name: "period", label: "Periode (per bulan)", type: "string" },
          { name: "desc", label: "Tagline", type: "string" },
          { name: "features", label: "Fitur (pisahkan dengan enter)", type: "textarea" },
          { name: "ctaLabel", label: "CTA Label", type: "string" },
          { name: "ctaHref", label: "CTA Link", type: "string" },
          { name: "featured", label: "Featured (yes/kosong)", type: "string" },
        ],
      },
    ],
  },
  {
    type: "FAQ",
    label: "FAQ Accordion ✨",
    category: "marketing",
    emoji: "❓",
    description: "Pertanyaan-jawaban yang bisa di-collapse",
    defaults: {
      title: "Pertanyaan Umum",
      items: [
        {
          question: "Apakah ada uji coba gratis?",
          answer: "Ya, semua fitur Pro bisa dicoba gratis 14 hari tanpa kartu kredit.",
        },
        {
          question: "Bagaimana cara membatalkan langganan?",
          answer: "Cukup buka Settings > Billing, klik Cancel. Berlaku sampai akhir periode tagihan.",
        },
        {
          question: "Apakah data saya aman?",
          answer: "Kami pakai enkripsi end-to-end, daily backup, dan compliance SOC 2 Type II.",
        },
      ],
    },
    fields: [
      { name: "title", label: "Judul", type: "string" },
      {
        name: "items",
        label: "Q & A",
        type: "items",
        itemFields: [
          { name: "question", label: "Pertanyaan", type: "string" },
          { name: "answer", label: "Jawaban", type: "textarea" },
        ],
      },
    ],
  },

  // ---------- Sosial Proof ----------
  {
    type: "Testimonial",
    label: "Testimoni Static",
    category: "sosial",
    emoji: "💬",
    description: "Quote dari pelanggan, layout tetap",
    defaults: {
      items: [{ name: "Nama", text: "Testimoni dari pelanggan." }],
    },
    fields: [
      {
        name: "items",
        label: "Testimoni",
        type: "items",
        itemFields: [
          { name: "name", label: "Nama", type: "string" },
          { name: "text", label: "Pesan", type: "textarea" },
        ],
      },
    ],
  },
  {
    type: "TestimonialMarquee",
    label: "Marquee Testimoni ✨",
    category: "sosial",
    emoji: "🎢",
    description: "Testimoni auto-scroll horizontal infinite",
    defaults: {
      title: "Apa kata mereka",
      items: [
        { name: "Sari, Founder", text: "Platform ini mengubah cara kami bekerja. Setup-nya kurang dari 5 menit." },
        { name: "Doni, Engineer", text: "Fitur dynamic content-nya luar biasa fleksibel." },
        { name: "Rina, Manager", text: "Tim non-teknis kami akhirnya bisa publish sendiri tanpa minta tolong dev." },
        { name: "Agus, CEO", text: "ROI terlihat dalam minggu pertama." },
        { name: "Maya, Designer", text: "Template-nya cantik dan customizable. Editor visual-nya intuitif." },
      ],
    },
    fields: [
      { name: "title", label: "Judul", type: "string" },
      {
        name: "items",
        label: "Testimoni",
        type: "items",
        itemFields: [
          { name: "name", label: "Nama / Role", type: "string" },
          { name: "text", label: "Pesan", type: "textarea" },
        ],
      },
    ],
  },

  // ---------- List ----------
  {
    type: "ProductGrid",
    label: "Grid Produk (statis)",
    category: "list",
    emoji: "🛍️",
    description: "Inline product cards (items)",
    defaults: {
      title: "Best Seller",
      items: [
        { name: "Produk A", price: "Rp 10.000", image: "" },
        { name: "Produk B", price: "Rp 20.000", image: "" },
      ],
    },
    fields: [
      { name: "title", label: "Judul", type: "string" },
      {
        name: "items",
        label: "Produk",
        type: "items",
        itemFields: [
          { name: "name", label: "Nama", type: "string" },
          { name: "price", label: "Harga", type: "string" },
          { name: "image", label: "Gambar", type: "image" },
        ],
      },
    ],
  },
  {
    type: "ProjectGrid",
    label: "Grid Project",
    category: "list",
    emoji: "💼",
    description: "Showcase project / portfolio",
    defaults: {
      title: "Project",
      items: [
        { name: "Project A", desc: "Deskripsi.", href: "#" },
        { name: "Project B", desc: "Deskripsi.", href: "#" },
      ],
    },
    fields: [
      { name: "title", label: "Judul", type: "string" },
      {
        name: "items",
        label: "Project",
        type: "items",
        itemFields: [
          { name: "name", label: "Nama", type: "string" },
          { name: "desc", label: "Deskripsi", type: "textarea" },
          { name: "href", label: "Tautan", type: "url" },
        ],
      },
    ],
  },
  {
    type: "BlogList",
    label: "List Blog (statis)",
    category: "list",
    emoji: "📰",
    description: "Inline blog post list",
    defaults: {
      items: [
        { title: "Artikel A", excerpt: "Ringkasan.", href: "#" },
        { title: "Artikel B", excerpt: "Ringkasan.", href: "#" },
      ],
    },
    fields: [
      {
        name: "items",
        label: "Artikel",
        type: "items",
        itemFields: [
          { name: "title", label: "Judul", type: "string" },
          { name: "excerpt", label: "Ringkasan", type: "textarea" },
          { name: "href", label: "Tautan", type: "url" },
        ],
      },
    ],
  },

  // ---------- Dynamic ----------
  {
    type: "ProductGridDynamic",
    label: "Grid Produk (DB)",
    category: "dynamic",
    emoji: "🔄",
    description: "Auto-load dari tab Produk",
    defaults: { title: "Produk Terbaru", limit: 12 },
    fields: [
      { name: "title", label: "Judul", type: "string" },
      { name: "limit", label: "Jumlah maks", type: "number" },
    ],
  },
  {
    type: "BlogListDynamic",
    label: "List Blog (DB)",
    category: "dynamic",
    emoji: "🔄",
    description: "Auto-load dari tab Blog",
    defaults: { title: "Artikel Terbaru", limit: 10 },
    fields: [
      { name: "title", label: "Judul", type: "string" },
      { name: "limit", label: "Jumlah maks", type: "number" },
    ],
  },

  // =================== NEW BLOCKS ===================

  // ---------- Hero ----------
  {
    type: "HeroSplit",
    label: "Hero Split ✨",
    category: "hero",
    emoji: "↔️",
    description: "Hero teks kiri + gambar kanan",
    defaults: {
      eyebrow: "Baru!",
      title: "Bangun website profesional dalam hitungan menit",
      subtitle:
        "Editor visual yang powerful dengan ratusan template siap pakai. Tidak perlu coding, hasilnya tetap profesional.",
      ctaLabel: "Mulai Gratis",
      ctaHref: "#",
      ctaSecondaryLabel: "Lihat Demo",
      ctaSecondaryHref: "#",
      image: "",
      reversed: "",
    },
    fields: [
      { name: "eyebrow", label: "Eyebrow", type: "string" },
      { name: "title", label: "Judul", type: "string" },
      { name: "subtitle", label: "Subjudul", type: "textarea" },
      { name: "ctaLabel", label: "CTA Utama", type: "string" },
      { name: "ctaHref", label: "CTA Utama Link", type: "string" },
      { name: "ctaSecondaryLabel", label: "CTA Sekunder", type: "string" },
      { name: "ctaSecondaryHref", label: "CTA Sekunder Link", type: "string" },
      { name: "image", label: "Gambar", type: "image" },
      { name: "reversed", label: "Gambar di kiri? (yes/kosong)", type: "string" },
    ],
  },

  // ---------- Layout ----------
  {
    type: "Banner",
    label: "Promo Banner ✨",
    category: "layout",
    emoji: "🎀",
    description: "Strip pengumuman/promo tipis di atas halaman",
    defaults: {
      text: "🎉 Diskon 30% untuk minggu ini saja!",
      ctaLabel: "Pakai sekarang →",
      ctaHref: "#",
    },
    fields: [
      { name: "text", label: "Teks", type: "string" },
      { name: "ctaLabel", label: "CTA Label", type: "string" },
      { name: "ctaHref", label: "CTA Link", type: "string" },
    ],
  },
  {
    type: "Divider",
    label: "Divider",
    category: "layout",
    emoji: "➖",
    description: "Garis pembatas horizontal dengan label opsional",
    defaults: { label: "" },
    fields: [
      { name: "label", label: "Label di tengah (opsional)", type: "string" },
    ],
  },
  {
    type: "Spacer",
    label: "Spacer",
    category: "layout",
    emoji: "⬜",
    description: "Spasi vertikal kosong",
    defaults: { size: 64 },
    fields: [{ name: "size", label: "Tinggi (px)", type: "number" }],
  },

  // ---------- Container Primitives ----------
  // These accept nested blocks via the BlockData.children field.
  {
    type: "Container",
    label: "Container",
    category: "layout",
    emoji: "📦",
    container: true,
    description: "Wrapper untuk grup block — atur padding/max-width via Layout panel",
    defaults: { gap: "1rem" },
    fields: [
      {
        name: "gap",
        label: "Jarak antar konten",
        type: "select",
        options: [
          { value: "0", label: "Tanpa jarak" },
          { value: "0.5rem", label: "Kecil (8px)" },
          { value: "1rem", label: "Sedang (16px)" },
          { value: "2rem", label: "Besar (32px)" },
          { value: "4rem", label: "Sangat besar (64px)" },
        ],
        help: "Spasi vertikal antar child block.",
      },
    ],
  },
  {
    type: "Columns",
    label: "Columns",
    category: "layout",
    emoji: "🟰",
    container: true,
    description: "Grid 2/3/4 kolom — tiap kolom bisa diisi block lain",
    defaults: { columns: 2, gap: "1rem" },
    fields: [
      {
        name: "columns",
        label: "Jumlah kolom",
        type: "select",
        options: [
          { value: "2", label: "2 kolom" },
          { value: "3", label: "3 kolom" },
          { value: "4", label: "4 kolom" },
        ],
        help: "Di mobile (≤768px) otomatis stack jadi 1 kolom.",
      },
      {
        name: "gap",
        label: "Jarak antar kolom",
        type: "select",
        options: [
          { value: "0.5rem", label: "Kecil (8px)" },
          { value: "1rem", label: "Sedang (16px)" },
          { value: "2rem", label: "Besar (32px)" },
          { value: "3rem", label: "Sangat besar (48px)" },
        ],
      },
    ],
  },

  // ---------- Konten ----------
  {
    type: "Quote",
    label: "Pull Quote ✨",
    category: "konten",
    emoji: "❝",
    description: "Quote besar dengan attribution",
    defaults: {
      text: "Tujuan terbaik bukan tentang menjadi sempurna, tapi tentang menjadi nyata dan terhubung dengan pelanggan kita.",
      author: "Sari Wijaya",
      role: "Founder, TokoBahagia",
    },
    fields: [
      { name: "text", label: "Quote", type: "textarea" },
      { name: "author", label: "Penulis", type: "string" },
      { name: "role", label: "Peran/Jabatan", type: "string" },
    ],
  },
  {
    type: "Alert",
    label: "Alert / Callout ✨",
    category: "konten",
    emoji: "💡",
    description: "Box info/warning/success/danger",
    defaults: {
      variant: "info",
      title: "Penting untuk diketahui",
      body: "Ini adalah informasi penting yang perlu diperhatikan pembaca.",
    },
    fields: [
      {
        name: "variant",
        label: "Tipe",
        type: "select",
        options: [
          { value: "info", label: "Info (biru)" },
          { value: "success", label: "Sukses (hijau)" },
          { value: "warning", label: "Peringatan (kuning)" },
          { value: "danger", label: "Bahaya (merah)" },
        ],
      },
      { name: "title", label: "Judul", type: "string" },
      { name: "body", label: "Isi", type: "textarea" },
    ],
  },

  // ---------- Showcase ----------
  {
    type: "FeatureSide",
    label: "Feature dengan Gambar ✨",
    category: "showcase",
    emoji: "🖼️",
    description: "Fitur + gambar berselang-seling kiri-kanan",
    defaults: {
      items: [
        {
          title: "Editor visual yang mudah",
          desc: "Drag-and-drop block siap pakai dengan preview real-time. Tidak perlu pengetahuan teknis sama sekali.",
          image: "",
        },
        {
          title: "Custom domain + SSL otomatis",
          desc: "Pakai domain Anda sendiri. SSL diurus otomatis lewat Caddy on-demand TLS.",
          image: "",
        },
        {
          title: "Export ke HTML/CSS/JS",
          desc: "Unduh hasil sebagai file statis. Hosting di mana saja: Netlify, Vercel, atau server sendiri.",
          image: "",
        },
      ],
    },
    fields: [
      {
        name: "items",
        label: "Fitur",
        type: "items",
        itemFields: [
          { name: "title", label: "Judul", type: "string" },
          { name: "desc", label: "Deskripsi", type: "textarea" },
          { name: "image", label: "Gambar", type: "image" },
        ],
      },
    ],
  },
  {
    type: "Timeline",
    label: "Timeline ✨",
    category: "showcase",
    emoji: "📅",
    description: "Garis waktu peristiwa vertikal",
    defaults: {
      title: "Perjalanan Kami",
      items: [
        {
          date: "2020",
          title: "Awal Mula",
          desc: "Ide pertama lahir di kantor kecil dengan 3 orang tim.",
        },
        {
          date: "2022",
          title: "1.000 Pelanggan",
          desc: "Milestone pertama tercapai. Tim berkembang ke 15 orang.",
        },
        {
          date: "2024",
          title: "Ekspansi Nasional",
          desc: "Buka kantor di 3 kota: Jakarta, Bandung, Surabaya.",
        },
        {
          date: "2025",
          title: "Go Global",
          desc: "Launch produk di pasar Asia Tenggara.",
        },
      ],
    },
    fields: [
      { name: "title", label: "Judul", type: "string" },
      {
        name: "items",
        label: "Event",
        type: "items",
        itemFields: [
          { name: "date", label: "Tanggal/Tahun", type: "string" },
          { name: "title", label: "Judul", type: "string" },
          { name: "desc", label: "Deskripsi", type: "textarea" },
        ],
      },
    ],
  },
  {
    type: "ProcessSteps",
    label: "Process Steps ✨",
    category: "showcase",
    emoji: "🪜",
    description: "Langkah-langkah proses bernomor",
    defaults: {
      title: "Cara Kerjanya",
      subtitle: "Mulai dalam 3 langkah sederhana.",
      items: [
        {
          title: "Daftar akun",
          desc: "Buat akun gratis dalam 30 detik dengan email Anda.",
        },
        {
          title: "Pilih template",
          desc: "Pilih dari 15 template profesional siap pakai.",
        },
        {
          title: "Publikasikan",
          desc: "Klik publish dan situs Anda langsung live.",
        },
      ],
    },
    fields: [
      { name: "title", label: "Judul", type: "string" },
      { name: "subtitle", label: "Subjudul", type: "textarea" },
      {
        name: "items",
        label: "Langkah",
        type: "items",
        itemFields: [
          { name: "title", label: "Judul", type: "string" },
          { name: "desc", label: "Deskripsi", type: "textarea" },
        ],
      },
    ],
  },
  {
    type: "TeamGrid",
    label: "Team Grid ✨",
    category: "showcase",
    emoji: "👥",
    description: "Grid anggota tim dengan foto + peran",
    defaults: {
      title: "Tim Kami",
      subtitle: "Orang-orang luar biasa di balik produk ini.",
      items: [
        { name: "Andi Pratama", role: "CEO & Founder", image: "" },
        { name: "Sari Wijaya", role: "CTO", image: "" },
        { name: "Budi Santoso", role: "Head of Design", image: "" },
        { name: "Rini Wijaya", role: "Head of Marketing", image: "" },
      ],
    },
    fields: [
      { name: "title", label: "Judul", type: "string" },
      { name: "subtitle", label: "Subjudul", type: "textarea" },
      {
        name: "items",
        label: "Anggota",
        type: "items",
        itemFields: [
          { name: "name", label: "Nama", type: "string" },
          { name: "role", label: "Peran", type: "string" },
          { name: "image", label: "Foto", type: "image" },
        ],
      },
    ],
  },
  {
    type: "IconList",
    label: "Icon List ✨",
    category: "showcase",
    emoji: "✅",
    description: "List teks dengan emoji/icon di depan",
    defaults: {
      title: "Yang Anda dapatkan",
      items: [
        { icon: "✓", text: "Gratis 14 hari, tanpa kartu kredit" },
        { icon: "✓", text: "Unlimited halaman & block" },
        { icon: "✓", text: "Custom domain + SSL otomatis" },
        { icon: "✓", text: "Support email 24/7" },
        { icon: "✓", text: "Export ke HTML/CSS/JS" },
      ],
    },
    fields: [
      { name: "title", label: "Judul", type: "string" },
      {
        name: "items",
        label: "Item",
        type: "items",
        itemFields: [
          { name: "icon", label: "Emoji/Icon", type: "string" },
          { name: "text", label: "Teks", type: "string" },
        ],
      },
    ],
  },
  {
    type: "StatsCard",
    label: "Stats Card ✨",
    category: "showcase",
    emoji: "🎯",
    description: "Satu angka prominent dengan deskripsi",
    defaults: {
      value: "98%",
      label: "Pelanggan puas",
      desc: "Berdasarkan survei akhir tahun 2024 ke lebih dari 1.000 pelanggan aktif. Rating ini stabil selama 3 tahun terakhir.",
    },
    fields: [
      { name: "value", label: "Angka prominent", type: "string" },
      { name: "label", label: "Label", type: "string" },
      { name: "desc", label: "Deskripsi", type: "textarea" },
    ],
  },

  // ---------- Media ----------
  {
    type: "VideoEmbed",
    label: "Video Embed ✨",
    category: "media",
    emoji: "🎬",
    description: "Embed video YouTube atau Vimeo",
    defaults: {
      title: "Lihat Demonya",
      src: "https://www.youtube.com/embed/dQw4w9WgXcQ",
    },
    fields: [
      { name: "title", label: "Judul", type: "string" },
      {
        name: "src",
        label: "URL Embed (youtube.com/embed/... atau player.vimeo.com/...)",
        type: "string",
      },
    ],
  },
  {
    type: "Map",
    label: "Map Embed ✨",
    category: "media",
    emoji: "🗺️",
    description: "Peta lokasi (Google Maps iframe URL)",
    defaults: {
      title: "Lokasi Kami",
      src: "https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3966.288!2d106.8228!3d-6.2088!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1",
    },
    fields: [
      { name: "title", label: "Judul", type: "string" },
      { name: "src", label: "URL Embed Maps", type: "string" },
    ],
  },
  {
    type: "Gallery",
    label: "Image Gallery ✨",
    category: "media",
    emoji: "🖼️",
    description: "Galeri gambar grid responsive",
    defaults: {
      title: "Galeri",
      items: [
        { image: "", caption: "Foto 1" },
        { image: "", caption: "Foto 2" },
        { image: "", caption: "Foto 3" },
        { image: "", caption: "Foto 4" },
        { image: "", caption: "Foto 5" },
        { image: "", caption: "Foto 6" },
      ],
    },
    fields: [
      { name: "title", label: "Judul", type: "string" },
      {
        name: "items",
        label: "Gambar",
        type: "items",
        itemFields: [
          { name: "image", label: "Gambar", type: "image" },
          { name: "caption", label: "Caption", type: "string" },
        ],
      },
    ],
  },
  {
    type: "SocialLinks",
    label: "Social Links ✨",
    category: "media",
    emoji: "🔗",
    description: "Row link sosial media dengan icon",
    defaults: {
      title: "Ikuti kami",
      items: [
        { platform: "Instagram", href: "https://instagram.com/example" },
        { platform: "Twitter", href: "https://twitter.com/example" },
        { platform: "Facebook", href: "https://facebook.com/example" },
        { platform: "LinkedIn", href: "https://linkedin.com/in/example" },
        { platform: "YouTube", href: "https://youtube.com/@example" },
      ],
    },
    fields: [
      { name: "title", label: "Judul", type: "string" },
      {
        name: "items",
        label: "Platform",
        type: "items",
        itemFields: [
          {
            name: "platform",
            label:
              "Platform (Instagram/Twitter/Facebook/LinkedIn/YouTube/TikTok/GitHub/Email/WhatsApp)",
            type: "string",
          },
          { name: "href", label: "URL", type: "string" },
        ],
      },
    ],
  },

  // ---------- Marketing ----------
  {
    type: "Newsletter",
    label: "Newsletter Signup ✨",
    category: "marketing",
    emoji: "📧",
    description: "Form sederhana email signup",
    defaults: {
      title: "Tetap update",
      subtitle:
        "Subscribe newsletter mingguan kami untuk tips, tutorial, dan update produk langsung ke inbox.",
      placeholder: "nama@email.com",
      ctaLabel: "Subscribe",
      action: "mailto:contact@example.com",
      note: "Tanpa spam. Unsubscribe kapan saja.",
    },
    fields: [
      { name: "title", label: "Judul", type: "string" },
      { name: "subtitle", label: "Subjudul", type: "textarea" },
      { name: "placeholder", label: "Placeholder input", type: "string" },
      { name: "ctaLabel", label: "Tombol Label", type: "string" },
      { name: "action", label: "Form action (URL/mailto)", type: "string" },
      { name: "note", label: "Catatan kecil di bawah", type: "string" },
    ],
  },
  {
    type: "ContactForm",
    label: "Contact Form ✨",
    category: "marketing",
    emoji: "📨",
    description: "Form kontak (nama, email, pesan)",
    defaults: {
      title: "Kontak Kami",
      subtitle: "Kami akan reply dalam 24 jam.",
      ctaLabel: "Kirim Pesan",
      action: "mailto:contact@example.com",
    },
    fields: [
      { name: "title", label: "Judul", type: "string" },
      { name: "subtitle", label: "Subjudul", type: "textarea" },
      { name: "ctaLabel", label: "Tombol Label", type: "string" },
      { name: "action", label: "Form action (URL/mailto)", type: "string" },
    ],
  },
  {
    type: "Form",
    label: "Form Terhubung (DB) ✨",
    category: "marketing",
    emoji: "📮",
    description:
      "Form yang tersimpan ke inbox — pilih form dari tab Form, submit masuk ke database + notifikasi email",
    defaults: {
      formId: "",
      title: "Hubungi Kami",
      subtitle: "Isi form di bawah — kami akan reply lewat email.",
      submitLabel: "Kirim",
      successMessage: "Terima kasih! Pesan Anda sudah kami terima.",
    },
    fields: [
      {
        name: "formId",
        label: "Form ID",
        type: "string",
        placeholder: "paste dari tab Form → tombol Copy ID",
        help: "Buat form di tab Form dulu, lalu salin ID-nya ke sini.",
        required: true,
      },
      { name: "title", label: "Judul", type: "string" },
      { name: "subtitle", label: "Subjudul", type: "textarea" },
      { name: "submitLabel", label: "Label tombol submit", type: "string" },
      {
        name: "successMessage",
        label: "Pesan setelah submit sukses",
        type: "textarea",
      },
    ],
  },
  {
    type: "Tabs",
    label: "Tabs (CSS-only) ✨",
    category: "marketing",
    emoji: "📑",
    description: "Konten dalam tab interaktif, max 4 tab",
    defaults: {
      items: [
        {
          label: "Fitur",
          body: "Editor visual lengkap dengan 40+ block siap pakai. Drag, drop, dan publish — semudah itu.",
        },
        {
          label: "Harga",
          body: "Mulai gratis selamanya. Upgrade ke Pro mulai Rp 99rb/bulan untuk fitur advanced.",
        },
        {
          label: "FAQ",
          body: "Pertanyaan yang sering ditanyakan tentang produk, billing, dan support.",
        },
      ],
    },
    fields: [
      {
        name: "items",
        label: "Tab",
        type: "items",
        itemFields: [
          { name: "label", label: "Label Tab", type: "string" },
          { name: "body", label: "Isi Tab", type: "textarea" },
        ],
      },
    ],
  },

  // ---------- Sosial ----------
  {
    type: "TestimonialCard",
    label: "Testimoni Big Card ✨",
    category: "sosial",
    emoji: "💎",
    description: "Single testimoni format hero card prominent",
    defaults: {
      quote:
        "Platform ini benar-benar mengubah cara saya membangun website untuk klien. Yang dulunya makan waktu seminggu, sekarang selesai dalam 1 jam. Tampilannya pun jauh lebih profesional.",
      name: "Sari Wijaya",
      role: "Founder, TokoBahagia",
      avatar: "",
      rating: 5,
    },
    fields: [
      { name: "quote", label: "Quote", type: "textarea" },
      { name: "name", label: "Nama", type: "string" },
      { name: "role", label: "Peran/Jabatan", type: "string" },
      { name: "avatar", label: "Foto", type: "image" },
      { name: "rating", label: "Rating (0-5)", type: "number" },
    ],
  },

  // ===========================================================================
  // PRO — motion-rich blocks (CSS-only animations, server-renderable).
  // Inspiration: aceternity.com/components. Built with pure CSS so they work in
  // RSC, Go static export, and have zero JS runtime cost.
  // ===========================================================================

  {
    type: "AuroraHero",
    label: "Aurora Hero ✨",
    category: "pro",
    emoji: "🌌",
    description: "Hero dengan animasi gradien aurora yang mengalir di latar",
    defaults: {
      eyebrow: "Baru saja diluncurkan",
      title: "Bangun pengalaman magis",
      subtitle: "Aurora gradient bergerak halus memberikan kesan premium tanpa biaya runtime JavaScript.",
      ctaLabel: "Mulai Sekarang",
      ctaHref: "#",
    },
    fields: [
      { name: "eyebrow", label: "Eyebrow", type: "string" },
      { name: "title", label: "Judul", type: "string" },
      { name: "subtitle", label: "Subjudul", type: "textarea" },
      { name: "ctaLabel", label: "Label CTA", type: "string" },
      { name: "ctaHref", label: "Tautan CTA", type: "url", showIf: (p) => Boolean(p.ctaLabel) },
    ],
  },
  {
    type: "SpotlightHero",
    label: "Spotlight Hero ✨",
    category: "pro",
    emoji: "🔦",
    description: "Hero gelap dengan sorotan radial dramatis di belakang teks",
    defaults: {
      title: "Konversi lebih tinggi dengan halaman yang fokus",
      subtitle: "Sorotan radial menarik mata pengunjung langsung ke pesan utama Anda.",
      ctaLabel: "Coba Gratis",
      ctaHref: "#",
    },
    fields: [
      { name: "title", label: "Judul", type: "string" },
      { name: "subtitle", label: "Subjudul", type: "textarea" },
      { name: "ctaLabel", label: "Label CTA", type: "string" },
      { name: "ctaHref", label: "Tautan CTA", type: "url", showIf: (p) => Boolean(p.ctaLabel) },
    ],
  },
  {
    type: "HighlightHero",
    label: "Highlight Hero ✨",
    category: "pro",
    emoji: "🖍",
    description: "Hero dengan satu kata di-highlight stabilo bergerak",
    defaults: {
      title: "Buat website yang",
      highlight: "luar biasa",
      titleAfter: "dalam hitungan menit.",
      subtitle: "Pakai blok pro untuk visual yang tampak custom-coded.",
      ctaLabel: "Mulai",
      ctaHref: "#",
    },
    fields: [
      { name: "title", label: "Judul (sebelum highlight)", type: "string" },
      { name: "highlight", label: "Kata yang di-highlight", type: "string" },
      { name: "titleAfter", label: "Judul (setelah highlight)", type: "string" },
      { name: "subtitle", label: "Subjudul", type: "textarea" },
      { name: "ctaLabel", label: "Label CTA", type: "string" },
      { name: "ctaHref", label: "Tautan CTA", type: "url", showIf: (p) => Boolean(p.ctaLabel) },
    ],
  },
  {
    type: "LampHero",
    label: "Lamp Hero ✨",
    category: "pro",
    emoji: "💡",
    description: "Cahaya kerucut turun dari atas, klasik Aceternity",
    defaults: {
      title: "Cahaya yang menarik perhatian",
      subtitle: "Cone gradient di atas memberikan focal point yang tegas.",
      ctaLabel: "Eksplor",
      ctaHref: "#",
    },
    fields: [
      { name: "title", label: "Judul", type: "string" },
      { name: "subtitle", label: "Subjudul", type: "textarea" },
      { name: "ctaLabel", label: "Label CTA", type: "string" },
      { name: "ctaHref", label: "Tautan CTA", type: "url", showIf: (p) => Boolean(p.ctaLabel) },
    ],
  },
  {
    type: "TypewriterHero",
    label: "Typewriter Hero ✨",
    category: "pro",
    emoji: "⌨️",
    description: "Heading dengan efek mesin ketik CSS murni",
    defaults: {
      prefix: "Saya bantu Anda",
      typed: "membangun website pro",
      subtitle: "Tanpa coding, tanpa repot — drag, atur, terbitkan.",
      ctaLabel: "Coba Demo",
      ctaHref: "#",
    },
    fields: [
      { name: "prefix", label: "Awalan judul", type: "string" },
      { name: "typed", label: "Teks diketik", type: "string" },
      { name: "subtitle", label: "Subjudul", type: "textarea" },
      { name: "ctaLabel", label: "Label CTA", type: "string" },
      { name: "ctaHref", label: "Tautan CTA", type: "url", showIf: (p) => Boolean(p.ctaLabel) },
    ],
  },
  {
    type: "GradientTextHero",
    label: "Gradient Text Hero ✨",
    category: "pro",
    emoji: "🌈",
    description: "Judul raksasa dengan gradient bergerak halus",
    defaults: {
      eyebrow: "v2.0 baru rilis",
      title: "Pengalaman digital yang berkesan",
      subtitle: "Gradient bergerak otomatis dengan animasi CSS.",
      ctaLabel: "Lihat Demo",
      ctaHref: "#",
    },
    fields: [
      { name: "eyebrow", label: "Eyebrow", type: "string" },
      { name: "title", label: "Judul", type: "string" },
      { name: "subtitle", label: "Subjudul", type: "textarea" },
      { name: "ctaLabel", label: "Label CTA", type: "string" },
      { name: "ctaHref", label: "Tautan CTA", type: "url", showIf: (p) => Boolean(p.ctaLabel) },
    ],
  },
  {
    type: "BeamsSection",
    label: "Beams Section ✨",
    category: "pro",
    emoji: "✨",
    description: "Section dengan beam diagonal animasi melintasi latar",
    defaults: {
      title: "Performa tingkat dewa",
      subtitle: "Beam animasi pure-CSS, ringan, dan support semua browser modern.",
    },
    fields: [
      { name: "title", label: "Judul", type: "string" },
      { name: "subtitle", label: "Subjudul", type: "textarea" },
    ],
  },
  {
    type: "MeteorsSection",
    label: "Meteors Section ✨",
    category: "pro",
    emoji: "☄️",
    description: "Hujan meteor diagonal sebagai latar belakang",
    defaults: {
      title: "Pengalaman yang tak terlupakan",
      subtitle: "Animasi meteor menciptakan suasana sci-fi yang memorable.",
    },
    fields: [
      { name: "title", label: "Judul", type: "string" },
      { name: "subtitle", label: "Subjudul", type: "textarea" },
    ],
  },
  {
    type: "GradientMeshSection",
    label: "Mesh Gradient Section ✨",
    category: "pro",
    emoji: "🎨",
    description: "Section dengan mesh gradient bergerak (multi blob)",
    defaults: {
      title: "Visual yang menjual",
      subtitle: "Tiga blob gradient saling tumpang tindih untuk efek mesh.",
    },
    fields: [
      { name: "title", label: "Judul", type: "string" },
      { name: "subtitle", label: "Subjudul", type: "textarea" },
    ],
  },
  {
    type: "WavyDivider",
    label: "Wavy Divider ✨",
    category: "pro",
    emoji: "🌊",
    description: "Pembatas SVG wave yang ber-animasi halus",
    defaults: { label: "" },
    fields: [{ name: "label", label: "Label tengah (opsional)", type: "string" }],
  },
  {
    type: "DotPatternSection",
    label: "Dot Pattern Section ✨",
    category: "pro",
    emoji: "⚪",
    description: "Pola titik dengan overlay gradient radial fading",
    defaults: {
      title: "Detail yang dirancang dengan cermat",
      subtitle: "Pola titik halus + gradient radial = section premium tanpa noise.",
    },
    fields: [
      { name: "title", label: "Judul", type: "string" },
      { name: "subtitle", label: "Subjudul", type: "textarea" },
    ],
  },
  {
    type: "GlowCardGrid",
    label: "Glow Card Grid ✨",
    category: "pro",
    emoji: "💫",
    description: "Grid card dengan border conic-gradient yang berputar",
    defaults: {
      title: "Fitur unggulan",
      items: [
        { title: "Edit visual", desc: "Drag, atur, dan terbitkan tanpa coding." },
        { title: "Multi-domain", desc: "Hubungkan domain sendiri dengan SSL otomatis." },
        { title: "Export ZIP", desc: "Unduh HTML/CSS statis kapan pun Anda butuh." },
      ],
    },
    fields: [
      { name: "title", label: "Judul", type: "string" },
      {
        name: "items",
        label: "Card",
        type: "items",
        itemFields: [
          { name: "title", label: "Judul", type: "string" },
          { name: "desc", label: "Deskripsi", type: "textarea" },
        ],
      },
    ],
  },
  {
    type: "TiltCardGrid",
    label: "3D Tilt Grid ✨",
    category: "pro",
    emoji: "🎴",
    description: "Card dengan perspektif 3D yang miring saat hover",
    defaults: {
      title: "Pengalaman premium",
      items: [
        { title: "Cepat", desc: "Dimuat <1 detik di mobile." },
        { title: "Aman", desc: "SSL otomatis, header keamanan terkonfigurasi." },
        { title: "SEO", desc: "Meta tags, sitemap, dan robots otomatis." },
      ],
    },
    fields: [
      { name: "title", label: "Judul", type: "string" },
      {
        name: "items",
        label: "Card",
        type: "items",
        itemFields: [
          { name: "title", label: "Judul", type: "string" },
          { name: "desc", label: "Deskripsi", type: "textarea" },
        ],
      },
    ],
  },
  {
    type: "BorderBeamCard",
    label: "Border Beam Card ✨",
    category: "pro",
    emoji: "💎",
    description: "Card highlight dengan beam cahaya berputar di sekeliling border",
    defaults: {
      title: "Paket Pro",
      subtitle: "Untuk bisnis serius yang butuh fitur lanjutan",
      price: "Rp 199.000",
      period: "/bulan",
      ctaLabel: "Mulai Pro",
      ctaHref: "#",
      bullets: [
        { text: "Domain tak terbatas" },
        { text: "Analytics lanjutan" },
        { text: "Prioritas support 24/7" },
      ],
    },
    fields: [
      { name: "title", label: "Judul", type: "string" },
      { name: "subtitle", label: "Subjudul", type: "string" },
      { name: "price", label: "Harga", type: "string" },
      { name: "period", label: "Periode", type: "string" },
      { name: "ctaLabel", label: "Label CTA", type: "string" },
      { name: "ctaHref", label: "Tautan CTA", type: "url", showIf: (p) => Boolean(p.ctaLabel) },
      {
        name: "bullets",
        label: "Bullet",
        type: "items",
        itemFields: [{ name: "text", label: "Teks", type: "string" }],
      },
    ],
  },
  {
    type: "CardStackShowcase",
    label: "Card Stack Showcase ✨",
    category: "pro",
    emoji: "🃏",
    description: "Tiga kartu bertumpuk dengan efek kedalaman 3D",
    defaults: {
      title: "Suara klien kami",
      items: [
        {
          quote: "Produk ini mengubah cara kami bekerja.",
          name: "Ari Pratama",
          role: "CEO, Studio Kreatif",
        },
        {
          quote: "Interface paling intuitif yang pernah saya pakai.",
          name: "Mira Sari",
          role: "Founder, Mira Studio",
        },
        {
          quote: "ROI tercepat dari semua tools yang kami coba.",
          name: "Doni Hartono",
          role: "CMO, Hartono Co.",
        },
      ],
    },
    fields: [
      { name: "title", label: "Judul", type: "string" },
      {
        name: "items",
        label: "Testimoni",
        type: "items",
        itemFields: [
          { name: "quote", label: "Quote", type: "textarea" },
          { name: "name", label: "Nama", type: "string" },
          { name: "role", label: "Peran", type: "string" },
        ],
      },
    ],
  },
  {
    type: "HoverGlowGrid",
    label: "Hover Glow Grid ✨",
    category: "pro",
    emoji: "✨",
    description: "Card grid dengan glow yang muncul mengikuti hover",
    defaults: {
      title: "Modul lengkap untuk bisnis Anda",
      items: [
        { title: "E-commerce", desc: "Etalase produk + keranjang." },
        { title: "Blog & SEO", desc: "Editor markdown + meta otomatis." },
        { title: "CRM", desc: "Kumpulkan lead dari form ke database." },
        { title: "Analytics", desc: "Real-time visitor + funnel." },
        { title: "Email", desc: "Kirim newsletter ke subscriber." },
        { title: "Booking", desc: "Reservasi online dengan kalender." },
      ],
    },
    fields: [
      { name: "title", label: "Judul", type: "string" },
      {
        name: "items",
        label: "Modul",
        type: "items",
        itemFields: [
          { name: "title", label: "Judul", type: "string" },
          { name: "desc", label: "Deskripsi", type: "textarea" },
        ],
      },
    ],
  },
  {
    type: "AnimatedCounterStats",
    label: "Animated Counter Stats ✨",
    category: "pro",
    emoji: "📊",
    description: "Big stats yang animasi count-up dari 0 saat dimuat",
    defaults: {
      title: "Dipercaya oleh ribuan pelanggan",
      items: [
        { value: "12000", label: "Situs aktif" },
        { value: "98", label: "Uptime (%)" },
        { value: "150", label: "Negara" },
        { value: "4.9", label: "Rating App Store" },
      ],
    },
    fields: [
      { name: "title", label: "Judul", type: "string" },
      {
        name: "items",
        label: "Statistik",
        type: "items",
        itemFields: [
          { name: "value", label: "Nilai", type: "string" },
          { name: "label", label: "Label", type: "string" },
        ],
      },
    ],
  },
  {
    type: "MovingBorderCTA",
    label: "Moving Border CTA ✨",
    category: "pro",
    emoji: "🔄",
    description: "Section CTA dengan tombol border-gradient berputar",
    defaults: {
      title: "Siap dimulai?",
      subtitle: "Gabung sekarang dan nikmati 14 hari trial gratis tanpa kartu kredit.",
      ctaLabel: "Mulai Trial Gratis",
      ctaHref: "#",
    },
    fields: [
      { name: "title", label: "Judul", type: "string" },
      { name: "subtitle", label: "Subjudul", type: "textarea" },
      { name: "ctaLabel", label: "Label CTA", type: "string" },
      { name: "ctaHref", label: "Tautan CTA", type: "url", showIf: (p) => Boolean(p.ctaLabel) },
    ],
  },
  {
    type: "InfiniteMarqueeLogos",
    label: "Marquee Logos ✨",
    category: "pro",
    emoji: "🏷",
    description: "Dua baris logo bergulir berlawanan arah",
    defaults: {
      title: "Dipakai oleh tim terbaik",
      itemsTop: [
        { name: "Acme" },
        { name: "Globex" },
        { name: "Initech" },
        { name: "Soylent" },
        { name: "Hooli" },
        { name: "Pied Piper" },
      ],
      itemsBottom: [
        { name: "Vandelay" },
        { name: "Stark" },
        { name: "Wayne Ent." },
        { name: "Wonka" },
        { name: "Cyberdyne" },
        { name: "Tyrell" },
      ],
    },
    fields: [
      { name: "title", label: "Judul", type: "string" },
      {
        name: "itemsTop",
        label: "Logo baris atas",
        type: "items",
        itemFields: [{ name: "name", label: "Nama brand", type: "string" }],
      },
      {
        name: "itemsBottom",
        label: "Logo baris bawah",
        type: "items",
        itemFields: [{ name: "name", label: "Nama brand", type: "string" }],
      },
    ],
  },
  {
    type: "OrbitFeatures",
    label: "Orbit Features ✨",
    category: "pro",
    emoji: "🛰",
    description: "Brand di tengah dengan ikon fitur mengorbit di sekitarnya",
    defaults: {
      brand: "WB",
      title: "Semua dalam satu ekosistem",
      subtitle: "Integrasi end-to-end untuk bisnis online Anda.",
      items: [
        { icon: "🛒", label: "E-com" },
        { icon: "✉️", label: "Email" },
        { icon: "📊", label: "Analytics" },
        { icon: "🔐", label: "Auth" },
        { icon: "💳", label: "Payment" },
        { icon: "📦", label: "Shipping" },
      ],
    },
    fields: [
      { name: "brand", label: "Inisial brand", type: "string" },
      { name: "title", label: "Judul", type: "string" },
      { name: "subtitle", label: "Subjudul", type: "textarea" },
      {
        name: "items",
        label: "Fitur orbit",
        type: "items",
        itemFields: [
          { name: "icon", label: "Ikon (emoji)", type: "string" },
          { name: "label", label: "Label", type: "string" },
        ],
      },
    ],
  },
];

export function schemaFor(type: string): BlockSchema | undefined {
  return blockSchemas.find((s) => s.type === type);
}

// Group block schemas by category, preserving the order of CATEGORY_LABELS.
export function blockSchemasByCategory(): Array<{
  key: BlockCategory;
  label: string;
  blocks: BlockSchema[];
}> {
  const order: BlockCategory[] = [
    "umkm",
    "pro",
    "hero",
    "layout",
    "konten",
    "showcase",
    "media",
    "marketing",
    "sosial",
    "list",
    "dynamic",
  ];
  return order.map((key) => ({
    key,
    label: CATEGORY_LABELS[key],
    blocks: blockSchemas.filter((b) => b.category === key),
  }));
}
