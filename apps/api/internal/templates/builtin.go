package templates

// BuiltinTemplate is the in-memory shape used to seed the templates table.
// 5 categories × 3 variants = 15 entries.
type BuiltinTemplate struct {
	Slug        string
	Category    string
	Variant     string
	Name        string
	Description string
	PreviewURL  string
	Theme       map[string]any
	Pages       []map[string]any
}

// Public lists for the dashboard to render the picker.
type CategoryInfo struct {
	Key         string `json:"key"`
	Label       string `json:"label"`
	Description string `json:"description"`
	Emoji       string `json:"emoji"`
}

type VariantInfo struct {
	Key         string `json:"key"`
	Name        string `json:"name"`
	Description string `json:"description"`
}

var Categories = []CategoryInfo{
	{Key: "school", Label: "Sekolah", Description: "PAUD, SD, SMP, SMA, atau kampus.", Emoji: "🎓"},
	{Key: "umkm", Label: "UMKM / Jualan", Description: "Toko online sederhana untuk UMKM.", Emoji: "🛍️"},
	{Key: "portfolio", Label: "Portofolio", Description: "Profil personal, project, dan kontak.", Emoji: "💼"},
	{Key: "blog", Label: "Blog", Description: "Blog personal atau magazine.", Emoji: "📝"},
}

var Variants = []VariantInfo{
	{Key: "modern", Name: "Modern", Description: "Berani, kontras tinggi, tipografi besar."},
	{Key: "clean", Name: "Clean", Description: "Minimalis, banyak whitespace, fokus konten."},
	{Key: "professional", Name: "Professional", Description: "Formal, terpercaya, tipografi serif klasik."},
}

// variantFontRadius returns the typography + radius profile for a variant.
func variantFontRadius(v string) (heading, body, radius string) {
	switch v {
	case "modern":
		return "Plus Jakarta Sans", "Inter", "1rem"
	case "clean":
		return "Inter", "Inter", "0.375rem"
	case "professional":
		return "Playfair Display", "Inter", "0.25rem"
	}
	return "Inter", "Inter", "0.5rem"
}

// palette returns colors for (category, variant).
//
// Design rules:
//   - `secondary` MUST be analogous to `primary` (same hue family, ±30° max).
//     Complementary pairs (purple+green, teal+amber) always read "amateur"
//     when rendered as conic-gradient borders / rotating beams.
//   - Modern variants stay saturated but never mix warm+cool.
//   - Professional variants use deeper, less-saturated tones for restraint.
func palette(cat, v string) map[string]string {
	type p struct{ primary, secondary, bg, fg string }
	table := map[string]map[string]p{
		"school": {
			"modern":       {"#2563eb", "#3b82f6", "#ffffff", "#0f172a"}, // blue analogous
			"clean":        {"#475569", "#64748b", "#ffffff", "#1e293b"}, // slate analogous
			"professional": {"#1e3a8a", "#1e40af", "#fafaf9", "#1c1917"}, // deep blue analogous
		},
		"umkm": {
			"modern":       {"#ea580c", "#c2410c", "#fffbf5", "#1f2937"}, // burnt orange analogous
			"clean":        {"#059669", "#047857", "#ffffff", "#064e3b"}, // deep green analogous
			"professional": {"#92400e", "#78350f", "#fafaf9", "#1c1917"}, // artisan amber analogous
		},
		"portfolio": {
			"modern":       {"#6366f1", "#4f46e5", "#0f172a", "#f8fafc"}, // indigo analogous (was purple+pink)
			"clean":        {"#0f172a", "#475569", "#ffffff", "#0f172a"}, // grayscale
			"professional": {"#1e3a8a", "#1e40af", "#ffffff", "#0f172a"}, // deep blue analogous
		},
		"blog": {
			"modern":       {"#b91c1c", "#991b1b", "#ffffff", "#111827"}, // deep editorial red analogous
			"clean":        {"#111827", "#374151", "#ffffff", "#111827"}, // grayscale
			"professional": {"#1e3a8a", "#1e40af", "#fffbf5", "#1c1917"}, // deep blue analogous (was blue+amber)
		},
	}
	if catMap, ok := table[cat]; ok {
		if px, ok := catMap[v]; ok {
			return map[string]string{
				"primary":   px.primary,
				"secondary": px.secondary,
				"bg":        px.bg,
				"fg":        px.fg,
			}
		}
	}
	return map[string]string{"primary": "#2563eb", "secondary": "#0ea5e9", "bg": "#ffffff", "fg": "#0f172a"}
}

func buildTheme(cat, v string) map[string]any {
	heading, body, radius := variantFontRadius(v)
	return map[string]any{
		"colors": palette(cat, v),
		"font":   map[string]any{"heading": heading, "body": body},
		"radius": radius,
	}
}

// variantCopy supplies small textual tweaks so the same page tree
// reads slightly differently across variants. Keeps things DRY without
// duplicating entire page trees.
type variantCopy struct {
	CTA  string // primary CTA label
	Tone string // short adjective for hero subtitle
}

func copyFor(v string) variantCopy {
	switch v {
	case "modern":
		return variantCopy{CTA: "Mulai Sekarang", Tone: "modern, dinamis, dan siap berkembang"}
	case "clean":
		return variantCopy{CTA: "Pelajari Lebih Lanjut", Tone: "rapi, mudah dipahami, dan fokus"}
	case "professional":
		return variantCopy{CTA: "Hubungi Kami", Tone: "tepercaya, profesional, dan berpengalaman"}
	}
	return variantCopy{CTA: "Mulai", Tone: ""}
}

// BuiltinTemplates returns the category × variant matrix (4 × 3 = 12).
func BuiltinTemplates() []BuiltinTemplate {
	out := make([]BuiltinTemplate, 0, len(Categories)*len(Variants))
	for _, c := range Categories {
		for _, v := range Variants {
			out = append(out, BuiltinTemplate{
				Slug:        c.Key + "-" + v.Key,
				Category:    c.Key,
				Variant:     v.Key,
				Name:        c.Label + " — " + v.Name,
				Description: v.Description,
				Theme:       buildTheme(c.Key, v.Key),
				Pages:       buildPages(c.Key, v.Key),
			})
		}
	}
	return out
}

// buildPages dispatches to per-category page builders. Pages share the same
// structure across variants of one category — only copy tone changes via copyFor.
// Variant is threaded so the HOME page can pick variant-specific Pro blocks.
func buildPages(cat, variant string) []map[string]any {
	cv := copyFor(variant)
	switch cat {
	case "school":
		return schoolPages(cv, variant)
	case "umkm":
		return umkmPages(cv, variant)
	case "portfolio":
		return portfolioPages(cv, variant)
	case "blog":
		return blogPages(cv, variant)
	}
	return nil
}

// --- helper for page tree shorthand ---

func block(typ string, props map[string]any) map[string]any {
	return map[string]any{"type": typ, "props": props}
}

// containerBlock returns a Container primitive with the given children — used
// to build sectioned layouts in professional templates.
func containerBlock(gap string, children []map[string]any) map[string]any {
	return map[string]any{
		"type":     "Container",
		"props":    map[string]any{"gap": gap},
		"children": children,
	}
}

// columnsBlock returns a Columns primitive (N-column grid) with children
// distributed round-robin across columns by the renderer.
func columnsBlock(colCount int, gap string, children []map[string]any) map[string]any {
	return map[string]any{
		"type":     "Columns",
		"props":    map[string]any{"columns": colCount, "gap": gap},
		"children": children,
	}
}

// =============================================================================
// PRO block composition helpers — used by the "professional home" of every
// template so the starter site feels like a real product landing page, not a
// tutorial demo. Each helper picks the Pro block that best matches a variant
// so the modern/clean/professional distinction is visible on first render.
// =============================================================================

type heroCopy struct {
	Eyebrow, Title, Subtitle string
	Highlight, TitleAfter    string // used by HighlightHero
	CTA, CTAHref             string
	CTA2, CTA2Href           string
}

// proHero picks a Pro hero block for the variant:
//
//	modern       → AuroraHero (animated gradient blobs)
//	clean        → HighlightHero (marker-highlight key word)
//	professional → LampHero (top light cone, formal)
func proHero(variant string, c heroCopy) map[string]any {
	switch variant {
	case "clean":
		return block("HighlightHero", map[string]any{
			"title":      c.Title,
			"highlight":  c.Highlight,
			"titleAfter": c.TitleAfter,
			"subtitle":   c.Subtitle,
			"ctaLabel":   c.CTA,
			"ctaHref":    c.CTAHref,
		})
	case "professional":
		return block("LampHero", map[string]any{
			"title":    c.Title + " " + c.Highlight + " " + c.TitleAfter,
			"subtitle": c.Subtitle,
			"ctaLabel": c.CTA,
			"ctaHref":  c.CTAHref,
		})
	}
	// modern default
	return block("AuroraHero", map[string]any{
		"eyebrow":  c.Eyebrow,
		"title":    c.Title + " " + c.Highlight + " " + c.TitleAfter,
		"subtitle": c.Subtitle,
		"ctaLabel": c.CTA,
		"ctaHref":  c.CTAHref,
	})
}

// proFeatureGrid picks a Pro feature block per variant. All three use
// on-hover interactions only — no always-running conic-gradient borders
// (which turned 6 cards × rotating primary/secondary into visual chaos
// when combined with hero + CTA animations elsewhere on the page).
//
//	modern       → HoverGlowGrid (radial glow follows hover)
//	clean        → TiltCardGrid  (subtle 3D tilt on hover)
//	professional → HoverGlowGrid (calmer radial glow)
func proFeatureGrid(variant, title string, items []map[string]any) map[string]any {
	typ := "HoverGlowGrid"
	if variant == "clean" {
		typ = "TiltCardGrid"
	}
	return block(typ, map[string]any{"title": title, "items": items})
}

// proFinalCTA — the "convert now" strip at the bottom of the page.
// Always CTABanner (classic + static). Previously modern used
// MovingBorderCTA (rotating conic button), which — combined with
// the hero + BorderBeamCard — made the page feel like a carnival.
// Keeping ONE animated element (the hero) is enough wow.
func proFinalCTA(variant, title, subtitle, ctaLabel, ctaHref string) map[string]any {
	_ = variant // kept in signature for future variant-specific copy
	return block("CTABanner", map[string]any{
		"title":    title,
		"subtitle": subtitle,
		"ctaLabel": ctaLabel,
		"ctaHref":  ctaHref,
	})
}

// trustBar — logo marquee wrapped in a comment so users understand what to
// replace. Empty (no brand names) skips the block entirely.
func trustBar(headline string, brands []string) map[string]any {
	top := make([]map[string]any, 0, len(brands))
	bot := make([]map[string]any, 0, len(brands))
	half := (len(brands) + 1) / 2
	for i, b := range brands {
		item := map[string]any{"name": b}
		if i < half {
			top = append(top, item)
		} else {
			bot = append(bot, item)
		}
	}
	// Fallback: if all in top, mirror to bottom so both rows animate.
	if len(bot) == 0 {
		bot = top
	}
	return block("InfiniteMarqueeLogos", map[string]any{
		"title":       headline,
		"itemsTop":    top,
		"itemsBottom": bot,
	})
}

// statsRow — AnimatedCounterStats convenience.
func statsRow(title string, stats []map[string]any) map[string]any {
	return block("AnimatedCounterStats", map[string]any{
		"title": title,
		"items": stats,
	})
}

// proTestimonials — CardStackShowcase (3 quotes max — more become visual noise).
func proTestimonials(title string, items []map[string]any) map[string]any {
	if len(items) > 3 {
		items = items[:3]
	}
	return block("CardStackShowcase", map[string]any{"title": title, "items": items})
}

// =============================================================================
// SUB-PAGE helpers — sub pages (profil, program, kontak, dst.) should feel
// consistent with home but lighter. Different hero than home so the "landing"
// tetap istimewa.
// =============================================================================

// subHero — DotPatternSection with title + subtitle. Konsisten across
// sub-pages, tidak steal thunder dari home hero.
func subHero(title, subtitle string) map[string]any {
	return block("DotPatternSection", map[string]any{
		"title":    title,
		"subtitle": subtitle,
	})
}

// processSteps — 3-step process block for how-it-works flows.
func processSteps(title string, steps []map[string]any) map[string]any {
	return block("ProcessSteps", map[string]any{
		"title": title,
		"items": steps,
	})
}

// pageFAQ — FAQ block with question/answer pairs.
func pageFAQ(title string, items []map[string]any) map[string]any {
	return block("FAQ", map[string]any{
		"title": title,
		"items": items,
	})
}

// contactBlock — ContactForm with sensible defaults for Indonesian sites.
func contactBlock(title, subtitle string) map[string]any {
	return block("ContactForm", map[string]any{
		"title":    title,
		"subtitle": subtitle,
		"ctaLabel": "Kirim Pesan",
	})
}

// socialBlock — social links row.
func socialBlock(items []map[string]any) map[string]any {
	return block("SocialLinks", map[string]any{
		"title": "Terhubung dengan kami",
		"items": items,
	})
}

// mapBlock — Map placeholder for kontak pages.
func mapBlock(title string) map[string]any {
	return block("Map", map[string]any{"title": title})
}

// teamBlock — TeamGrid convenience.
func teamBlock(title string, members []map[string]any) map[string]any {
	return block("TeamGrid", map[string]any{"title": title, "items": members})
}

// timelineBlock — vertical timeline for history sections.
func timelineBlock(title string, items []map[string]any) map[string]any {
	return block("Timeline", map[string]any{"title": title, "items": items})
}

// featureSideBlock — side-by-side feature (image + text) alternating.
func featureSideBlock(items []map[string]any) map[string]any {
	return block("FeatureSide", map[string]any{"items": items})
}

// simpleCTA — small CTA banner used at bottom of sub-pages.
func simpleCTA(title, subtitle, ctaLabel, ctaHref string) map[string]any {
	return block("CTABanner", map[string]any{
		"title":    title,
		"subtitle": subtitle,
		"ctaLabel": ctaLabel,
		"ctaHref":  ctaHref,
	})
}

func page(slug, title string, isHome bool, seo map[string]any, blocks []map[string]any) map[string]any {
	if seo == nil {
		seo = map[string]any{}
	}
	return map[string]any{
		"slug":    slug,
		"title":   title,
		"is_home": isHome,
		"seo":     seo,
		"tree":    map[string]any{"blocks": blocks},
	}
}

// ---------------- Sekolah ----------------

func schoolPages(cv variantCopy, variant string) []map[string]any {
	links := []map[string]any{
		{"label": "Beranda", "href": "/"},
		{"label": "Profil", "href": "/profil"},
		{"label": "Program", "href": "/program"},
		{"label": "Galeri", "href": "/galeri"},
		{"label": "Kontak", "href": "/kontak"},
	}
	nav := block("Navbar", map[string]any{"brand": "Sekolah ABC", "links": links})
	footer := block("Footer", map[string]any{"copyright": "© Sekolah ABC — Mendidik Generasi Berkarakter"})

	home := page("home", "Beranda", true,
		map[string]any{
			"title":       "Sekolah ABC — Mendidik Generasi Unggul & Berkarakter",
			"description": "Sekolah dengan kurikulum modern, guru berpengalaman, dan fasilitas lengkap. PPDB 2025/2026 sudah dibuka.",
		},
		[]map[string]any{
			nav,
			proHero(variant, heroCopy{
				Eyebrow:    "PPDB 2025/2026 · Kuota terbatas",
				Title:      "Mendidik generasi",
				Highlight:  "unggul & berkarakter",
				TitleAfter: "sejak dini.",
				Subtitle:   "Kurikulum Merdeka, guru bersertifikat, dan fasilitas modern — semua yang dibutuhkan anak Anda untuk tumbuh percaya diri dan siap menghadapi dunia.",
				CTA:        "Daftar PPDB Sekarang",
				CTAHref:    "#daftar",
			}),
			trustBar("Dipercaya oleh lebih dari 3.000 keluarga sejak 2005", []string{
				"Kemendikbudristek", "Kanwil DKI", "Google Educator", "Cambridge Assessment",
				"ITB", "UI", "UGM", "NUS", "Monash",
			}),
			statsRow("Angka yang berbicara", []map[string]any{
				{"value": "20", "label": "Tahun pengalaman"},
				{"value": "3.200", "label": "Alumni sukses"},
				{"value": "85%", "label": "Diterima PTN/luar negeri"},
				{"value": "4.9/5", "label": "Rating orang tua"},
			}),
			proFeatureGrid(variant, "Mengapa keluarga memilih kami", []map[string]any{
				{"title": "Kurikulum Merdeka +", "desc": "Berbasis projek, literasi digital, dan pengembangan karakter — dilengkapi bahasa Inggris & coding sejak SD."},
				{"title": "Guru bersertifikat", "desc": "100% tenaga pendidik bersertifikat dengan rata-rata pengalaman mengajar 10 tahun. Rasio guru:siswa 1:15."},
				{"title": "Fasilitas modern", "desc": "Lab komputer, lab sains, perpustakaan, lapangan indoor & outdoor, semua ruang kelas ber-AC."},
				{"title": "Lokasi strategis", "desc": "5 menit dari stasiun, area parkir luas, jalur antar-jemput menuju 12 titik area sekitar."},
				{"title": "15+ ekstrakurikuler", "desc": "Robotika, paskibra, futsal, paduan suara, seni tari, karya ilmiah remaja, dan banyak lagi."},
				{"title": "Alumni berprestasi", "desc": "85% diterima di PTN top (UI, ITB, UGM) atau universitas luar negeri (NUS, Monash, RMIT)."},
			}),
			block("BentoGrid", map[string]any{
				"title": "Tiga jalur belajar — pilih yang cocok untuk anak Anda",
				"items": []map[string]any{
					{"title": "Kelas Reguler", "desc": "Kurikulum Nasional + bahasa Inggris & coding intensif.", "size": "large"},
					{"title": "Kelas Bilingual", "desc": "Dwibahasa Indonesia/Inggris — persiapan sekolah internasional.", "size": "wide"},
					{"title": "Kelas Akselerasi", "desc": "Percepatan untuk siswa berbakat istimewa (CIBI)."},
					{"title": "Home Visit", "desc": "Kunjungan guru ke rumah setiap semester."},
					{"title": "Konseling", "desc": "Psikolog anak siap 5 hari/minggu."},
				},
			}),
			proTestimonials("Cerita dari keluarga kami", []map[string]any{
				{"quote": "Anak saya berkembang pesat sejak masuk Sekolah ABC. Gurunya sabar, komunikasi dengan orang tua sangat baik, dan kurikulumnya membentuk karakter — bukan cuma nilai akademis.", "name": "Ibu Sari Wijaya", "role": "Orang tua siswa kelas 5"},
				{"quote": "Sekolah yang membentuk saya lebih dari akademis. Skill diskusi, kepemimpinan, dan public speaking yang saya dapat di sini sangat berguna waktu kuliah di UI.", "name": "Andi Prasetyo", "role": "Alumni 2022 — Ilmu Komputer UI"},
				{"quote": "Fasilitas top, guru care, dan yang paling penting: anak saya SUKA sekolah. Nggak pernah ngeluh berangkat, malah minta ekstra ekstrakurikuler.", "name": "Bapak Doni Hartono", "role": "Orang tua siswa kelas 8"},
			}),
			block("BorderBeamCard", map[string]any{
				"title":    "Program PPDB Early Bird",
				"subtitle": "Gelombang 1 · sampai 31 Januari",
				"price":    "Rp 1.500.000",
				"period":   "biaya pendaftaran (diskon 40%)",
				"ctaLabel": "Daftar sekarang",
				"ctaHref":  "#daftar",
				"bullets": []map[string]any{
					{"text": "Diskon uang pangkal 20% (nilai s.d. Rp 8 juta)"},
					{"text": "Prioritas placement di kelas favorit"},
					{"text": "Free tes minat bakat & konsultasi psikolog"},
					{"text": "Kaos & starter kit sekolah gratis"},
					{"text": "Refund 100% jika batal sebelum 15 Feb"},
				},
			}),
			block("FAQ", map[string]any{
				"title": "Pertanyaan yang sering ditanyakan",
				"items": []map[string]any{
					{"question": "Berapa biaya sekolah per bulan?", "answer": "SPP mulai dari Rp 1,2 juta/bulan tergantung jenjang. Termasuk buku, seragam, dan snack pagi."},
					{"question": "Apakah ada beasiswa?", "answer": "Ya — beasiswa akademik (25–100%), beasiswa non-akademik (olahraga/seni), dan beasiswa dhuafa. Silakan hubungi bagian PPDB."},
					{"question": "Bagaimana proses PPDB-nya?", "answer": "1) Isi formulir online, 2) Bayar biaya pendaftaran, 3) Tes minat bakat + wawancara orang tua, 4) Pengumuman dalam 7 hari kerja."},
					{"question": "Ada jalur antar-jemput?", "answer": "Ada — 12 titik area sekitar sekolah. Biaya terpisah, ada opsi carter (private) atau shuttle (shared)."},
				},
			}),
			proFinalCTA(variant,
				"Siap mengantar putra-putri Anda ke sekolah masa depan?",
				"Kuota terbatas 60 siswa per angkatan. Daftar sekarang — early bird berakhir 31 Januari.",
				"Daftar PPDB · Gratis konsultasi",
				"#daftar",
			),
			footer,
		},
	)

	profil := page("profil", "Profil", false,
		map[string]any{"title": "Profil Sekolah ABC", "description": "Visi, misi, sejarah, dan tim di balik Sekolah ABC."},
		[]map[string]any{
			nav,
			subHero("Profil Sekolah ABC",
				"Berdiri sejak 1995, melayani generasi muda dengan dedikasi penuh. Sudah 30 tahun mempersiapkan alumni yang berkarakter."),
			statsRow("Perjalanan singkat kami", []map[string]any{
				{"value": "30", "label": "Tahun mengajar"},
				{"value": "3.200", "label": "Alumni sukses"},
				{"value": "800", "label": "Siswa aktif"},
				{"value": "57", "label": "Tenaga pendidik"},
			}),
			block("Section", map[string]any{
				"title": "Sejarah singkat",
				"body":  "Sekolah ABC didirikan pada tahun 1995 oleh sekelompok pendidik dengan visi mencetak generasi muda yang **berkarakter, kritis, dan siap menghadapi dunia**.\n\nBerawal dari satu gedung sederhana dengan 60 siswa, kini Sekolah ABC telah berkembang menjadi institusi pendidikan terpercaya dengan lebih dari 800 siswa aktif dari TK hingga SMP.",
			}),
			timelineBlock("30 tahun perjalanan", []map[string]any{
				{"date": "1995", "title": "Sekolah didirikan dengan 60 siswa & 8 guru"},
				{"date": "2005", "title": "Ekspansi jenjang SMP + fasilitas lab lengkap"},
				{"date": "2015", "title": "Akreditasi A untuk semua jenjang"},
				{"date": "2020", "title": "Program dwibahasa + partnership Cambridge Assessment"},
				{"date": "2025", "title": "Alumni ke-3.200 lulus — mayoritas ke PTN top"},
			}),
			proFeatureGrid(variant, "Visi & misi kami", []map[string]any{
				{"title": "Visi", "desc": "Menjadi sekolah unggulan yang menghasilkan generasi cerdas, berkarakter, dan siap menghadapi tantangan global."},
				{"title": "Misi akademik", "desc": "Menyelenggarakan pendidikan berkualitas dengan kurikulum berstandar internasional (Cambridge + Kurikulum Merdeka)."},
				{"title": "Misi karakter", "desc": "Menanamkan nilai-nilai moral, etika, dan kearifan budaya Indonesia dalam setiap aspek pembelajaran."},
				{"title": "Misi individu", "desc": "Mengembangkan potensi unik setiap siswa lewat konsultasi individual, tes minat bakat, dan program mentoring."},
			}),
			teamBlock("Tim kepemimpinan", []map[string]any{
				{"name": "Dr. Ahmad Wijaya, M.Pd.", "role": "Kepala Sekolah · sejak 2018", "image": ""},
				{"name": "Ibu Siti Nurhaliza, S.Pd.", "role": "Wakil Kepala Akademik", "image": ""},
				{"name": "Bapak Joko Susilo, M.Si.", "role": "Wakil Kepala Kesiswaan", "image": ""},
				{"name": "Ibu Rina Anggraeni, M.Psi.", "role": "Koordinator Psikologi", "image": ""},
			}),
			block("BentoGrid", map[string]any{
				"title": "Empat pilar nilai yang kami pegang",
				"items": []map[string]any{
					{"title": "Integritas", "desc": "Jujur dan bertanggung jawab dalam setiap tindakan — di kelas, di lapangan, di rumah.", "size": "large"},
					{"title": "Inovasi", "desc": "Selalu mencari cara yang lebih baik untuk belajar dan mengajar."},
					{"title": "Inklusi", "desc": "Pendidikan untuk semua tanpa memandang latar belakang.", "size": "wide"},
					{"title": "Kolaborasi", "desc": "Bekerja sama membangun komunitas belajar yang positif."},
				},
			}),
			simpleCTA("Tertarik gabung keluarga Sekolah ABC?", "PPDB 2025/2026 sudah dibuka — kuota terbatas.", "Daftar PPDB", "#daftar"),
			footer,
		},
	)

	program := page("program", "Program", false,
		map[string]any{"title": "Program Akademik — Sekolah ABC", "description": "Tingkat pendidikan, kurikulum, dan ekstrakurikuler."},
		[]map[string]any{
			nav,
			subHero("Program akademik unggulan",
				"Program pendidikan yang dirancang untuk mengembangkan potensi maksimal setiap siswa — dari TK hingga SMP."),
			proFeatureGrid(variant, "Tiga jenjang pendidikan", []map[string]any{
				{"title": "TK / PAUD (3–6 th)", "desc": "Fokus motorik, sosialisasi, dan pengenalan dasar membaca-berhitung melalui bermain. Rasio guru:siswa 1:8."},
				{"title": "SD (Kelas 1–6)", "desc": "Pondasi akademik kuat dengan pendekatan tematik + integratif Kurikulum Merdeka. Bahasa Inggris intensif dari kelas 1."},
				{"title": "SMP (Kelas 7–9)", "desc": "Pendalaman materi + coding, bahasa Inggris dwibahasa, dan program persiapan masuk SMA top."},
			}),
			block("Section", map[string]any{
				"title": "Kurikulum Merdeka + Cambridge",
				"body":  "Kami menggunakan **Kurikulum Merdeka** sebagai basis + **Cambridge Assessment** untuk pengukuran internasional. Setiap mata pelajaran ditujukan untuk mengembangkan 6 dimensi Pelajar Pancasila:\n\n- Beriman, bertakwa, berakhlak mulia\n- Berkebinekaan global\n- Bergotong-royong\n- Mandiri\n- Bernalar kritis\n- Kreatif",
			}),
			proFeatureGrid(variant, "Mata pelajaran unggulan", []map[string]any{
				{"title": "Bahasa Inggris", "desc": "5 jam/minggu dengan native speaker untuk kelas atas. Sertifikasi Cambridge YLE/KET di akhir jenjang."},
				{"title": "Coding & Robotika", "desc": "Pengenalan logika pemrograman dari kelas 4 SD. Scratch → Python → Arduino."},
				{"title": "Karakter & Kepemimpinan", "desc": "Program khusus untuk membangun soft skill: public speaking, teamwork, resilience."},
				{"title": "Seni & Olahraga", "desc": "Eksplorasi minat lewat 15+ pilihan ekskul — semuanya rutin tampil di event."},
				{"title": "Sains Aplikatif", "desc": "Eksperimen mingguan di lab, kunjungan ke pabrik/museum, project sains akhir semester."},
				{"title": "Well-being", "desc": "Sesi mindfulness mingguan + konsultasi psikolog setiap kali dibutuhkan."},
			}),
			block("BentoGrid", map[string]any{
				"title": "15+ ekstrakurikuler — cari passion kamu",
				"items": []map[string]any{
					{"title": "Robotika", "desc": "Juara nasional 2023 & 2024", "size": "large"},
					{"title": "Futsal & Basket", "desc": "Latihan rutin + kompetisi"},
					{"title": "Paduan Suara", "desc": "Tampil di kompetisi kota", "size": "wide"},
					{"title": "Pramuka", "desc": "Wajib kls 4–9"},
					{"title": "Seni Lukis", "desc": "Ekspresi kreatif"},
					{"title": "Olimpiade", "desc": "Mat/IPA/Bahasa"},
				},
			}),
			simpleCTA("Ingin lihat langsung kelas kami?", "Booking tour sekolah + trial class 1 hari untuk anak Anda — gratis.", "Booking tour", "#kunjungan"),
			footer,
		},
	)

	galeri := page("galeri", "Galeri", false,
		map[string]any{"title": "Galeri Kegiatan — Sekolah ABC", "description": "Momen dari kegiatan belajar, ekstrakurikuler, dan kebersamaan."},
		[]map[string]any{
			nav,
			subHero("Galeri kegiatan sekolah",
				"Momen-momen berharga dari kegiatan belajar, ekstrakurikuler, dan kebersamaan di Sekolah ABC."),
			block("Gallery", map[string]any{
				"title": "Kegiatan terbaru",
				"items": []map[string]any{
					{"image": "", "caption": "Hari Kemerdekaan · 17 Agustus 2024"},
					{"image": "", "caption": "Pentas Seni · Desember 2024"},
					{"image": "", "caption": "Field Trip Museum · November 2024"},
					{"image": "", "caption": "Olimpiade Matematika · Oktober 2024"},
					{"image": "", "caption": "Wisuda Kelas 6 · Juni 2024"},
					{"image": "", "caption": "Perpisahan · Juni 2024"},
					{"image": "", "caption": "Robotics Fair · Mei 2024"},
					{"image": "", "caption": "Pekan Buku · April 2024"},
				},
			}),
			proTestimonials("Cerita di balik foto", []map[string]any{
				{"quote": "Anak saya dulu pemalu banget. Setelah 2 tahun ikut pentas seni & pramuka, sekarang dia yang paling percaya diri di kelas. Perubahannya kelihatan banget.", "name": "Ibu Marina", "role": "Orang tua siswa kelas 6"},
				{"quote": "Field trip ke museum bikin saya sadar sejarah Indonesia keren banget. Sejak itu saya suka baca buku sejarah — dulu paling males.", "name": "Rafi Ahmad", "role": "Siswa kelas 8"},
				{"quote": "Robotika 2 tahun di ABC bikin saya lolos ke jurusan Teknik Robotika UI. Skill teamwork & problem-solving dari kompetisi itu sangat berharga.", "name": "Naya Cahaya", "role": "Alumni 2023"},
			}),
			simpleCTA("Ingin mengunjungi sekolah langsung?", "Kami terbuka untuk kunjungan calon orang tua siswa. Jadwal tour setiap Rabu & Sabtu.", "Booking kunjungan", "#kunjungan"),
			footer,
		},
	)

	kontak := page("kontak", "Kontak", false,
		map[string]any{"title": "Kontak Sekolah ABC", "description": "Alamat, telepon, email, dan jam operasional."},
		[]map[string]any{
			nav,
			subHero("Hubungi kami",
				"Kami siap menjawab pertanyaan tentang pendaftaran, kurikulum, atau hal lainnya. Rata-rata respon dalam 3 jam kerja."),
			block("IconList", map[string]any{
				"title": "Informasi lengkap",
				"items": []map[string]any{
					{"icon": "📍", "text": "Jl. Pendidikan No. 1, Kelurahan Maju, Kecamatan Sejahtera, Kota Bahagia 12345"},
					{"icon": "📞", "text": "(021) 1234-5678 · WhatsApp: 0812-3456-7890"},
					{"icon": "✉", "text": "info@sekolahabc.sch.id · ppdb@sekolahabc.sch.id"},
					{"icon": "🕒", "text": "Senin–Jumat 07.00–16.00 · Sabtu 08.00–12.00"},
					{"icon": "🚌", "text": "Dekat halte Trans · parkir luas · layanan antar-jemput ke 12 titik area sekitar"},
				},
			}),
			contactBlock("Kirim pesan langsung",
				"Isi form di bawah — tim admin kami akan membalas dalam 3 jam kerja."),
			mapBlock("Lokasi sekolah"),
			socialBlock([]map[string]any{
				{"platform": "Instagram"},
				{"platform": "Facebook"},
				{"platform": "YouTube"},
				{"platform": "TikTok"},
				{"platform": "WhatsApp"},
			}),
			pageFAQ("Pertanyaan yang sering ditanyakan", []map[string]any{
				{"question": "Apa syarat pendaftaran?"},
				{"question": "Berapa biaya SPP per bulan?"},
				{"question": "Apakah ada beasiswa?"},
				{"question": "Bagaimana sistem antar-jemput?"},
				{"question": "Apakah bisa observasi kelas dulu?"},
			}),
			footer,
		},
	)

	return []map[string]any{home, profil, program, galeri, kontak}
}

// ---------------- UMKM ----------------

// umkmWA is the placeholder WhatsApp number shipped in every UMKM template.
const umkmWA = "081234567890"

// umkmBiz holds one sample business. Each variant gets a different business
// and a different home arrangement so the three templates don't look cloned.
type umkmBiz struct {
	Brand, SEOTitle, SEODesc string
	Hero, Showcase, Trust    map[string]any
	Promo, Reviews, Market   map[string]any
	Store, Float             map[string]any
	ProdukHero, TentangHero  [2]string
	CaraHero, KontakHero     [2]string
	Story                    string
	Stats, Steps, FAQ        []map[string]any
	Payments                 []map[string]any
}

func umkmBizFor(variant string) umkmBiz {
	switch variant {
	case "clean":
		return umkmBatik()
	case "professional":
		return umkmRotan()
	}
	return umkmKopi()
}

// umkmKopi — modern: coffee shop + delivery in Bandung.
func umkmKopi() umkmBiz {
	return umkmBiz{
		Brand:    "Kopi Senja",
		SEOTitle: "Kopi Senja — Kopi Susu Gula Aren & Kopi Literan Bandung",
		SEODesc:  "Kopi susu gula aren diseduh segar setiap hari. Pesan lewat WhatsApp, diantar hangat ke seluruh Bandung.",
		Hero: map[string]any{
			"eyebrow":           "Buka setiap hari · 08.00–22.00",
			"title":             "Kopi susu gula aren, diseduh segar setiap hari",
			"subtitle":          "Biji kopi pilihan dari petani Garut, disangrai sendiri dan diantar hangat ke rumahmu. Pesan lewat WhatsApp, kami balas kurang dari 5 menit.",
			"ctaLabel":          "Pesan via WhatsApp",
			"waNumber":          umkmWA,
			"waMessage":         "Halo Kopi Senja, saya mau pesan kopi.",
			"ctaSecondaryLabel": "Lihat Menu",
			"ctaSecondaryHref":  "#menu",
			"image":             "",
			"chips":             []string{"100% Halal", "Gratis ongkir Bandung", "Bisa bayar di tempat"},
			"rating":            "4.9 dari 1.200+ pembeli",
		},
		Showcase: map[string]any{
			"title": "Menu Favorit", "subtitle": "Paling sering dipesan pelanggan minggu ini.",
			"waNumber": umkmWA, "buttonLabel": "Pesan", "columns": "4", "anchorId": "menu",
			"items": []map[string]any{
				{"name": "Kopi Susu Gula Aren", "image": "", "price": "Rp 22.000", "originalPrice": "Rp 28.000", "badge": "terlaris", "desc": "Espresso, susu segar, dan gula aren asli Garut. 250 ml."},
				{"name": "Es Kopi Pandan", "image": "", "price": "Rp 25.000", "originalPrice": "", "badge": "baru", "desc": "Kopi susu dengan sirup pandan wangi buatan sendiri."},
				{"name": "Paket Hemat Berdua", "image": "", "price": "Rp 45.000", "originalPrice": "Rp 56.000", "badge": "promo", "desc": "2 kopi susu + 2 roti bakar cokelat keju."},
				{"name": "Kopi Literan 1 Liter", "image": "", "price": "Rp 85.000", "originalPrice": "", "badge": "none", "desc": "Cukup untuk 6–8 gelas, tahan 3 hari di kulkas."},
			},
		},
		Trust: map[string]any{
			"title": "Kenapa ngopi di Kopi Senja?", "subtitle": "",
			"items": []map[string]any{
				{"icon": "halal", "title": "Bersertifikat Halal", "desc": "Nomor sertifikat BPJPH tercantum di setiap kemasan."},
				{"icon": "pirt", "title": "Izin P-IRT", "desc": "Diproduksi di dapur yang terdaftar dan diawasi Dinkes."},
				{"icon": "qris", "title": "Bayar pakai QRIS", "desc": "Semua e-wallet dan m-banking bisa."},
				{"icon": "delivery", "title": "Diantar hari ini", "desc": "Pesan sebelum 15.00, sampai di hari yang sama."},
			},
		},
		Promo: map[string]any{
			"discountLabel": "Diskon 20%", "headline": "Promo Gajian: semua kopi literan",
			"description": "Berlaku untuk pembelian langsung maupun lewat WhatsApp. Minimal belanja Rp 50.000.",
			"voucherCode": "GAJIAN20", "validUntil": "Berlaku sampai 31 Desember 2026",
			"ctaLabel": "Pakai Sekarang", "ctaHref": "", "waNumber": umkmWA,
		},
		Reviews: map[string]any{
			"title": "Kata pelanggan kami", "subtitle": "", "average": "4.9",
			"countText": "dari 1.248 ulasan di Google & GoFood",
			"items": []map[string]any{
				{"name": "Rina Marlina", "location": "Bandung · Kopi Susu Gula Aren", "rating": "5", "text": "Manisnya pas, kopinya tetap kerasa. Sudah langganan tiap pagi sebelum ngantor, adminnya juga ramah banget.", "photo": ""},
				{"name": "Dimas Prasetyo", "location": "Cimahi · Kopi Literan 1 Liter", "rating": "5", "text": "Beli literan buat stok seminggu, rasanya konsisten dan pengirimannya cepat. Botolnya rapi, nggak ada yang bocor.", "photo": ""},
				{"name": "Sari Wulandari", "location": "Lembang · Paket Hemat Berdua", "rating": "4", "text": "Roti bakarnya enak, kopinya mantap. Semoga nanti ada pilihan less sugar juga.", "photo": ""},
			},
		},
		Market: map[string]any{
			"title": "Juga tersedia di", "subtitle": "Pesan lewat aplikasi favoritmu — promo berbeda di tiap platform.",
			"items": []map[string]any{
				{"platform": "gofood", "url": "https://gofood.co.id/", "label": "Kopi Senja Braga"},
				{"platform": "grabfood", "url": "https://food.grab.com/id/", "label": "Kopi Senja Braga"},
				{"platform": "shopeefood", "url": "https://shopee.co.id/", "label": "Kopi Senja"},
				{"platform": "instagram", "url": "https://instagram.com/", "label": "@kopisenja.bdg"},
			},
		},
		Store: map[string]any{
			"title": "Mampir ke kedai kami", "subtitle": "Ngopi di tempat atau ambil pesanan langsung.",
			"address": "Jl. Braga No. 21, Sumur Bandung, Kota Bandung, Jawa Barat 40111",
			"mapSrc":  "", "showMap": "yes",
			"hours": []map[string]any{
				{"day": "Senin – Jumat", "hours": "08.00 – 22.00"},
				{"day": "Sabtu – Minggu", "hours": "07.00 – 23.00"},
				{"day": "Libur nasional", "hours": "10.00 – 20.00"},
			},
			"phone": "0812-3456-7890", "waNumber": umkmWA, "waMessage": "Halo Kopi Senja, saya mau tanya soal pesanan.",
			"email": "halo@kopisenja.id", "areas": []string{"Bandung Kota", "Cimahi", "Dago & Lembang", "Antapani"},
			"anchorId": "lokasi",
		},
		Float:       map[string]any{"waNumber": umkmWA, "waMessage": "Halo admin Kopi Senja, saya mau tanya menu.", "label": "Tanya menu", "position": "right", "color": "whatsapp"},
		ProdukHero:  [2]string{"Semua menu Kopi Senja", "Kopi, non-kopi, dan camilan — semua bisa dipesan lewat WhatsApp atau GoFood."},
		TentangHero: [2]string{"Cerita di balik secangkir Kopi Senja", "Berawal dari gerobak kecil di Braga tahun 2019, kini menyeduh 400+ gelas setiap hari."},
		CaraHero:    [2]string{"Pesan semudah chat teman", "Tanpa aplikasi, tanpa daftar akun. Cukup WhatsApp, kopi datang."},
		KontakHero:  [2]string{"Hubungi & kunjungi kami", "Admin aktif setiap hari 08.00–22.00, rata-rata membalas kurang dari 5 menit."},
		Story:       "Kopi Senja lahir dari **gerobak kopi di trotoar Braga** tahun 2019. Kami membeli biji langsung dari petani Garut dengan harga adil, lalu menyangrainya sendiri setiap minggu supaya rasanya selalu segar.\n\nSekarang kami punya kedai kecil, 9 barista, dan ribuan pelanggan setia — tapi resepnya tetap sama: **gula aren asli, susu segar, tanpa perisa buatan**.",
		Stats: []map[string]any{
			{"value": "400+", "label": "Gelas per hari"},
			{"value": "12", "label": "Petani mitra"},
			{"value": "4.9/5", "label": "Rating pelanggan"},
			{"value": "2019", "label": "Mulai menyeduh"},
		},
		Steps: []map[string]any{
			{"title": "Pilih menu", "desc": "Lihat Menu Favorit atau katalog lengkap, catat menu dan jumlahnya."},
			{"title": "Chat WhatsApp", "desc": "Kirim pesanan + alamat. Admin konfirmasi total dan ongkir."},
			{"title": "Bayar & tunggu", "desc": "Bayar QRIS, transfer, atau tunai di tempat. Kopi diantar hangat."},
		},
		Payments: []map[string]any{
			{"icon": "qris", "title": "QRIS", "desc": "GoPay, OVO, DANA, ShopeePay, m-banking."},
			{"icon": "transfer", "title": "Transfer bank", "desc": "BCA, Mandiri, BRI, BNI."},
			{"icon": "cod", "title": "Bayar di tempat", "desc": "Tunai saat kopi sampai (area Bandung)."},
			{"icon": "delivery", "title": "Kurir sendiri", "desc": "Ongkir mulai Rp 5.000, gratis di atas Rp 75.000."},
		},
		FAQ: []map[string]any{
			{"question": "Berapa lama kopi literan tahan?", "answer": "Simpan di kulkas, tahan 3 hari. Kocok dulu sebelum dituang."},
			{"question": "Bisa pesan untuk acara kantor?", "answer": "Bisa, minimal 20 cup. Chat admin H-1 supaya kami siapkan."},
			{"question": "Ada pilihan tanpa gula?", "answer": "Ada. Tulis \"less sugar\" atau \"tanpa gula\" saat memesan."},
		},
	}
}

// umkmBatik — clean: modern batik fashion label from Solo.
func umkmBatik() umkmBiz {
	return umkmBiz{
		Brand:    "Sekar Batik",
		SEOTitle: "Sekar Batik — Kemeja & Dress Batik Cap Asli Solo",
		SEODesc:  "Batik cap dan tulis asli Laweyan, Solo, dengan potongan modern. Pesan lewat WhatsApp atau marketplace favoritmu.",
		Hero: map[string]any{
			"eyebrow":           "Koleksi baru · Sekar Parang 2026",
			"title":             "Batik asli Solo, potongan modern untuk dipakai setiap hari",
			"subtitle":          "Dicap dan diwarnai tangan oleh pengrajin Laweyan, dijahit rapi dengan bahan katun primisima yang adem. Ukuran S sampai XXL.",
			"ctaLabel":          "Tanya Ukuran via WhatsApp",
			"waNumber":          umkmWA,
			"waMessage":         "Halo Sekar Batik, saya mau tanya ukuran dan stok.",
			"ctaSecondaryLabel": "Lihat Koleksi",
			"ctaSecondaryHref":  "#koleksi",
			"image":             "",
			"chips":             []string{"Batik cap & tulis asli", "Gratis tukar ukuran", "Kirim ke seluruh Indonesia"},
			"rating":            "4.8 dari 3.400+ ulasan marketplace",
		},
		Showcase: map[string]any{
			"title": "Koleksi Pilihan", "subtitle": "Motif klasik, potongan masa kini.",
			"waNumber": umkmWA, "buttonLabel": "Pesan", "columns": "4", "anchorId": "koleksi",
			"items": []map[string]any{
				{"name": "Kemeja Batik Parang Slim Fit", "image": "", "price": "Rp 289.000", "originalPrice": "Rp 349.000", "badge": "terlaris", "desc": "Katun primisima, lengan pendek, kancing batok kelapa."},
				{"name": "Dress Batik Kawung Midi", "image": "", "price": "Rp 325.000", "originalPrice": "", "badge": "baru", "desc": "Potongan A-line dengan saku samping dan tali pinggang."},
				{"name": "Outer Batik Tulis Lasem", "image": "", "price": "Rp 459.000", "originalPrice": "", "badge": "none", "desc": "Batik tulis tangan, satu motif hanya dibuat 12 potong."},
				{"name": "Sarung Batik Cap Sogan", "image": "", "price": "Rp 175.000", "originalPrice": "Rp 210.000", "badge": "promo", "desc": "Warna sogan klasik, cocok untuk kondangan dan Jumatan."},
			},
		},
		Trust: map[string]any{
			"title": "Belanja batik tanpa ragu", "subtitle": "",
			"items": []map[string]any{
				{"icon": "handmade", "title": "Dibuat tangan", "desc": "Setiap kain dicap dan diwarnai oleh 24 pengrajin Laweyan."},
				{"icon": "guarantee", "title": "Gratis tukar ukuran", "desc": "Kurang pas? Tukar dalam 7 hari, ongkir kami tanggung."},
				{"icon": "delivery", "title": "Kirim ke seluruh Indonesia", "desc": "JNE, J&T, SiCepat — resi dikirim lewat WhatsApp."},
				{"icon": "cod", "title": "Bisa COD", "desc": "Bayar di tempat untuk pengiriman Pulau Jawa."},
			},
		},
		Promo: map[string]any{
			"discountLabel": "Hemat 15%", "headline": "Seragam batik kantor & keluarga",
			"description": "Pesan minimal 10 potong motif yang sama, gratis bordir nama. Pengerjaan 10–14 hari kerja.",
			"voucherCode": "SERAGAM15", "validUntil": "Berlaku untuk pesanan sampai 30 Juni 2026",
			"ctaLabel": "Konsultasi Seragam", "ctaHref": "", "waNumber": umkmWA,
		},
		Reviews: map[string]any{
			"title": "Dipakai dan disukai", "subtitle": "Ulasan asli dari pembeli di Shopee, Tokopedia, dan WhatsApp.",
			"average": "4.8", "countText": "dari 3.400+ ulasan marketplace",
			"items": []map[string]any{
				{"name": "Anisa Rahmawati", "location": "Jakarta · Dress Batik Kawung Midi", "rating": "5", "text": "Bahannya adem dan jatuhnya bagus. Sudah dicuci berkali-kali warnanya tidak luntur. Pasti beli motif lain.", "photo": ""},
				{"name": "Bagus Hartono", "location": "Surabaya · Kemeja Parang Slim Fit", "rating": "5", "text": "Ukurannya pas sesuai tabel, jahitannya rapi sampai bagian dalam. Dipakai ke kantor banyak yang tanya beli di mana.", "photo": ""},
				{"name": "Lestari Putri", "location": "Makassar · Seragam keluarga", "rating": "4", "text": "Pesan 14 potong untuk acara keluarga, selesai tepat waktu. Adminnya sabar menjawab pertanyaan soal ukuran.", "photo": ""},
			},
		},
		Market: map[string]any{
			"title": "Belanja di marketplace favoritmu", "subtitle": "Harga sama, pilih yang paling nyaman buatmu.",
			"items": []map[string]any{
				{"platform": "shopee", "url": "https://shopee.co.id/", "label": "Sekar Batik Official"},
				{"platform": "tokopedia", "url": "https://www.tokopedia.com/", "label": "Sekar Batik Solo"},
				{"platform": "tiktokshop", "url": "https://www.tiktok.com/", "label": "@sekarbatik.id"},
				{"platform": "lazada", "url": "https://www.lazada.co.id/", "label": "Sekar Batik"},
				{"platform": "instagram", "url": "https://instagram.com/", "label": "@sekarbatik.id"},
			},
		},
		Store: map[string]any{
			"title": "Showroom & workshop", "subtitle": "Coba langsung ukurannya dan lihat proses membatik.",
			"address": "Jl. Sidoluhur No. 8, Laweyan, Kota Surakarta, Jawa Tengah 57148",
			"mapSrc":  "", "showMap": "yes",
			"hours": []map[string]any{
				{"day": "Senin – Sabtu", "hours": "09.00 – 17.00"},
				{"day": "Minggu", "hours": "10.00 – 15.00"},
			},
			"phone": "0812-3456-7890", "waNumber": umkmWA, "waMessage": "Halo Sekar Batik, saya mau berkunjung ke showroom.",
			"email": "halo@sekarbatik.id", "areas": []string{"Seluruh Indonesia", "Same-day Solo Raya"},
			"anchorId": "lokasi",
		},
		Float:       map[string]any{"waNumber": umkmWA, "waMessage": "Halo Sekar Batik, saya mau tanya ukuran.", "label": "Tanya ukuran", "position": "right", "color": "whatsapp"},
		ProdukHero:  [2]string{"Koleksi Sekar Batik", "Kemeja, dress, outer, dan sarung — stok diperbarui setiap hari."},
		TentangHero: [2]string{"Merawat batik Laweyan", "Usaha keluarga tiga generasi yang kini membawa batik ke lemari anak muda."},
		CaraHero:    [2]string{"Cara pesan & panduan ukuran", "Pesan lewat WhatsApp atau marketplace — keduanya sama-sama bergaransi tukar ukuran."},
		KontakHero:  [2]string{"Hubungi Sekar Batik", "Admin siap bantu pilih ukuran dan motif setiap hari 09.00–17.00."},
		Story:       "Sekar Batik berawal dari **rumah produksi nenek kami di Laweyan** sejak 1987. Tahun 2020 kami mulai menjahit batik cap dengan potongan modern supaya batik tidak hanya dipakai ke kondangan.\n\nSetiap kain masih **dicap, diwarnai, dan dijemur dengan tangan** oleh 24 pengrajin tetangga kami — kami membayar mereka per potong dengan harga di atas rata-rata.",
		Stats: []map[string]any{
			{"value": "24", "label": "Pengrajin mitra"},
			{"value": "38.000+", "label": "Potong terjual"},
			{"value": "4.8/5", "label": "Rating marketplace"},
			{"value": "1987", "label": "Mulai membatik"},
		},
		Steps: []map[string]any{
			{"title": "Pilih motif & ukuran", "desc": "Cek tabel ukuran di deskripsi produk, atau tanya admin."},
			{"title": "Chat WhatsApp", "desc": "Kirim nama produk, ukuran, dan alamat lengkap."},
			{"title": "Bayar & lacak", "desc": "Transfer, QRIS, atau COD. Nomor resi dikirim di hari yang sama."},
		},
		Payments: []map[string]any{
			{"icon": "transfer", "title": "Transfer bank", "desc": "BCA, Mandiri, BRI, BSI."},
			{"icon": "qris", "title": "QRIS", "desc": "Semua e-wallet dan m-banking."},
			{"icon": "cod", "title": "COD", "desc": "Bayar di tempat untuk Pulau Jawa."},
			{"icon": "guarantee", "title": "Tukar ukuran", "desc": "Gratis dalam 7 hari setelah diterima."},
		},
		FAQ: []map[string]any{
			{"question": "Apakah warnanya luntur?", "answer": "Tidak, kami memakai pewarna yang sudah dikunci. Cuci dengan tangan dan hindari pemutih."},
			{"question": "Bagaimana kalau ukurannya tidak pas?", "answer": "Tukar gratis dalam 7 hari, selama label masih terpasang dan belum dicuci."},
			{"question": "Bisa pesan seragam dengan motif sendiri?", "answer": "Bisa untuk minimal 50 potong. Chat admin untuk desain dan estimasi waktu."},
		},
	}
}

// umkmRotan — professional: rattan & woven craft workshop from Cirebon.
func umkmRotan() umkmBiz {
	return umkmBiz{
		Brand:    "Anyam Lestari",
		SEOTitle: "Anyam Lestari — Kerajinan Rotan & Anyaman Cirebon",
		SEODesc:  "Kursi, keranjang, dan dekorasi rotan buatan tangan pengrajin Cirebon. Melayani rumah tangga, hotel, dan kafe.",
		Hero: map[string]any{
			"eyebrow":           "Workshop rotan sejak 2004 · Cirebon",
			"title":             "Furnitur & dekorasi rotan, dianyam tangan untuk rumah dan usaha Anda",
			"subtitle":          "Rotan pilihan dari Kalimantan, dianyam oleh pengrajin Tegalwangi. Melayani pembelian satuan hingga proyek hotel, vila, dan kafe.",
			"ctaLabel":          "Minta Penawaran",
			"waNumber":          umkmWA,
			"waMessage":         "Halo Anyam Lestari, saya mau minta penawaran produk rotan.",
			"ctaSecondaryLabel": "Lihat Katalog",
			"ctaSecondaryHref":  "/produk",
			"image":             "",
			"chips":             []string{"Buatan tangan", "Garansi rangka 1 tahun", "Bisa custom ukuran"},
			"rating":            "4.9 dari 650+ pembeli & 40+ hotel",
		},
		Showcase: map[string]any{
			"title": "Produk unggulan", "subtitle": "Dibuat berdasarkan pesanan — waktu produksi 7–21 hari.",
			"waNumber": umkmWA, "buttonLabel": "Minta harga", "columns": "3", "anchorId": "unggulan",
			"items": []map[string]any{
				{"name": "Kursi Rotan Lounge Natural", "image": "", "price": "Rp 1.850.000", "originalPrice": "", "badge": "terlaris", "desc": "Rangka rotan manau, anyaman jalinan sumbu, termasuk bantal."},
				{"name": "Keranjang Anyam Set 3", "image": "", "price": "Rp 345.000", "originalPrice": "Rp 420.000", "badge": "promo", "desc": "Tiga ukuran bertumpuk untuk laundry, mainan, atau tanaman."},
				{"name": "Kap Lampu Gantung Bulat", "image": "", "price": "Rp 275.000", "originalPrice": "", "badge": "baru", "desc": "Diameter 45 cm, cahaya hangat bermotif untuk ruang makan."},
			},
		},
		Trust: map[string]any{
			"title": "Standar kerja kami", "subtitle": "Dipercaya rumah tangga, hotel, dan kafe sejak 2004.",
			"items": []map[string]any{
				{"icon": "handmade", "title": "100% buatan tangan", "desc": "Dianyam oleh 35 pengrajin Tegalwangi."},
				{"icon": "guarantee", "title": "Garansi rangka 1 tahun", "desc": "Rangka patah karena pemakaian normal kami perbaiki gratis."},
				{"icon": "sni", "title": "Finishing standar ekspor", "desc": "Anti jamur dan anti rayap, aman untuk dalam ruang."},
				{"icon": "delivery", "title": "Pengiriman kayu-krat", "desc": "Dikemas aman ke seluruh Indonesia."},
			},
		},
		Promo: map[string]any{
			"discountLabel": "Diskon proyek 15%", "headline": "Untuk hotel, vila, dan kafe",
			"description": "Pemesanan minimal 20 unit mendapat diskon 15%, gratis desain custom, dan kunjungan survei untuk area Jawa Barat.",
			"voucherCode": "PROYEK15", "validUntil": "Berlaku untuk PO yang masuk sampai 31 Desember 2026",
			"ctaLabel": "Jadwalkan Konsultasi", "ctaHref": "", "waNumber": umkmWA,
		},
		Reviews: map[string]any{
			"title": "Dipercaya pelanggan & mitra usaha", "subtitle": "",
			"average": "4.9", "countText": "dari 650+ pembeli dan 40+ proyek hotel & kafe",
			"items": []map[string]any{
				{"name": "Hendra Wijaya", "location": "Bali · 32 kursi untuk vila", "rating": "5", "text": "Pengerjaan sesuai jadwal, kualitas anyaman konsisten di semua unit. Tim mereka juga membantu memilih warna finishing.", "photo": ""},
				{"name": "Maya Kusuma", "location": "Bandung · Kap lampu gantung", "rating": "5", "text": "Jauh lebih bagus dari foto. Dikemas sangat aman, sampai tanpa lecet sedikit pun.", "photo": ""},
				{"name": "Rizky Ananda", "location": "Jakarta · Keranjang anyam set", "rating": "4", "text": "Rapi dan kokoh. Waktu produksi agak lama, tapi adminnya selalu memberi kabar progres.", "photo": ""},
			},
		},
		Market: map[string]any{
			"title": "Tersedia juga di", "subtitle": "Untuk pembelian satuan dengan perlindungan pembeli marketplace.",
			"items": []map[string]any{
				{"platform": "tokopedia", "url": "https://www.tokopedia.com/", "label": "Anyam Lestari Official"},
				{"platform": "shopee", "url": "https://shopee.co.id/", "label": "Anyam Lestari"},
				{"platform": "instagram", "url": "https://instagram.com/", "label": "@anyamlestari"},
				{"platform": "facebook", "url": "https://facebook.com/", "label": "Anyam Lestari Cirebon"},
			},
		},
		Store: map[string]any{
			"title": "Kunjungi workshop kami", "subtitle": "Lihat langsung proses produksi dan contoh finishing.",
			"address": "Jl. Raya Tegalwangi No. 117, Weru, Kabupaten Cirebon, Jawa Barat 45154",
			"mapSrc":  "", "showMap": "yes",
			"hours": []map[string]any{
				{"day": "Senin – Jumat", "hours": "08.00 – 16.00"},
				{"day": "Sabtu", "hours": "08.00 – 13.00"},
				{"day": "Minggu", "hours": "Dengan janji temu"},
			},
			"phone": "(0231) 321-456", "waNumber": umkmWA, "waMessage": "Halo Anyam Lestari, saya mau jadwalkan kunjungan workshop.",
			"email": "sales@anyamlestari.co.id", "areas": []string{"Seluruh Indonesia", "Survei gratis Jawa Barat", "Ekspor (FOB Tanjung Priok)"},
			"anchorId": "lokasi",
		},
		Float:       map[string]any{"waNumber": umkmWA, "waMessage": "Halo Anyam Lestari, saya mau konsultasi produk.", "label": "Konsultasi gratis", "position": "right", "color": "theme"},
		ProdukHero:  [2]string{"Katalog Anyam Lestari", "Furnitur, keranjang, dan dekorasi rotan. Semua ukuran bisa disesuaikan."},
		TentangHero: [2]string{"Dua dekade menganyam rotan", "Dari bengkel kecil di Tegalwangi menjadi mitra 40+ hotel dan kafe di Indonesia."},
		CaraHero:    [2]string{"Alur pemesanan", "Satuan maupun proyek — semuanya dimulai dari satu pesan WhatsApp."},
		KontakHero:  [2]string{"Hubungi tim Anyam Lestari", "Tim penjualan siap membantu Senin–Sabtu, 08.00–16.00."},
		Story:       "Anyam Lestari didirikan **Pak Darsono tahun 2004** dengan 3 pengrajin di halaman rumahnya. Kini kami bekerja dengan 35 pengrajin Tegalwangi dan memasok furnitur rotan untuk rumah, hotel, vila, dan kafe.\n\nKami hanya memakai **rotan legal bersertifikat** dari Kalimantan dan Sulawesi, serta finishing berbasis air yang aman untuk dalam ruang.",
		Stats: []map[string]any{
			{"value": "35", "label": "Pengrajin"},
			{"value": "40+", "label": "Hotel & kafe"},
			{"value": "20 tahun", "label": "Pengalaman"},
			{"value": "4.9/5", "label": "Rating pelanggan"},
		},
		Steps: []map[string]any{
			{"title": "Konsultasi", "desc": "Kirim foto ruangan, ukuran, dan jumlah unit lewat WhatsApp."},
			{"title": "Penawaran & DP", "desc": "Kami kirim penawaran resmi. Produksi dimulai setelah DP 50%."},
			{"title": "Produksi & kirim", "desc": "Foto progres dikirim berkala, pelunasan sebelum pengiriman."},
		},
		Payments: []map[string]any{
			{"icon": "transfer", "title": "Transfer bank", "desc": "Rekening atas nama CV Anyam Lestari."},
			{"icon": "qris", "title": "QRIS", "desc": "Untuk pembelian satuan di workshop."},
			{"icon": "guarantee", "title": "Faktur & PO", "desc": "Faktur pajak tersedia untuk pembelian perusahaan."},
			{"icon": "delivery", "title": "Kirim aman", "desc": "Kemasan kayu-krat dan asuransi pengiriman."},
		},
		FAQ: []map[string]any{
			{"question": "Berapa lama waktu produksi?", "answer": "Produk satuan 7–14 hari kerja, proyek di atas 20 unit 3–6 minggu tergantung desain."},
			{"question": "Apakah bisa custom ukuran dan warna?", "answer": "Bisa. Kirim ukuran dan referensi foto, kami buatkan gambar kerja sebelum produksi."},
			{"question": "Apakah rotan tahan untuk area luar ruang?", "answer": "Untuk teras tertutup aman. Area terbuka kami sarankan rotan sintetis — tanyakan admin."},
		},
	}
}

func umkmPages(cv variantCopy, variant string) []map[string]any {
	_ = cv // UMKM copy comes from the per-variant business below.
	biz := umkmBizFor(variant)
	links := []map[string]any{
		{"label": "Beranda", "href": "/"},
		{"label": "Produk", "href": "/produk"},
		{"label": "Tentang", "href": "/tentang"},
		{"label": "Cara Pesan", "href": "/cara-pesan"},
		{"label": "Kontak", "href": "/kontak"},
	}
	nav := block("Navbar", map[string]any{"brand": biz.Brand, "links": links})
	footer := block("Footer", map[string]any{"copyright": "© " + biz.Brand + " — Produk UMKM asli Indonesia"})
	float := block("UmkmWhatsAppFloat", biz.Float)
	hero := block("UmkmHero", biz.Hero)
	trust := block("UmkmTrustBadges", biz.Trust)
	promo := block("UmkmPromoBanner", biz.Promo)
	reviews := block("UmkmReviews", biz.Reviews)
	market := block("UmkmMarketplaceLinks", biz.Market)
	store := block("UmkmStoreInfo", biz.Store)
	catalog := func(title, subtitle string, limit int) map[string]any {
		return block("UmkmCatalogDynamic", map[string]any{
			"title": title, "subtitle": subtitle, "waNumber": umkmWA, "buttonLabel": biz.Showcase["buttonLabel"],
			"limit": limit, "category": "", "showOutOfStock": "no", "columns": biz.Showcase["columns"], "anchorId": "produk",
		})
	}

	// Home lists the shop's real products (Produk menu), seeded from the same
	// items by umkmSampleProducts, so editing a product updates the homepage.
	featured := block("UmkmCatalogDynamic", map[string]any{
		"title": biz.Showcase["title"], "subtitle": biz.Showcase["subtitle"], "waNumber": umkmWA,
		"buttonLabel": biz.Showcase["buttonLabel"], "limit": 8, "category": "", "showOutOfStock": "no",
		"columns": biz.Showcase["columns"], "anchorId": biz.Showcase["anchorId"],
	})

	// Home arrangement differs per variant: food leads with menu + promo,
	// fashion with the collection + marketplaces, craft with trust + projects.
	var homeBlocks []map[string]any
	switch variant {
	case "clean":
		homeBlocks = []map[string]any{nav, hero, featured, market, reviews, trust, promo, footer, float}
	case "professional":
		homeBlocks = []map[string]any{nav, hero, trust, featured, reviews, promo, store, market, footer, float}
	default:
		homeBlocks = []map[string]any{nav, hero, trust, featured, promo, reviews, market, store, footer, float}
	}
	home := page("home", "Beranda", true,
		map[string]any{"title": biz.SEOTitle, "description": biz.SEODesc}, homeBlocks)

	produk := page("produk", "Produk", false,
		map[string]any{"title": "Produk — " + biz.Brand, "description": biz.ProdukHero[1]},
		[]map[string]any{
			nav,
			subHero(biz.ProdukHero[0], biz.ProdukHero[1]),
			catalog("Semua produk", "Klik Pesan untuk langsung chat admin lewat WhatsApp.", 24),
			promo,
			market,
			footer,
			float,
		},
	)

	tentang := page("tentang", "Tentang Kami", false,
		map[string]any{"title": "Tentang " + biz.Brand, "description": biz.TentangHero[1]},
		[]map[string]any{
			nav,
			subHero(biz.TentangHero[0], biz.TentangHero[1]),
			block("RichText", map[string]any{"body": "## Cerita kami\n\n" + biz.Story}),
			statsRow(biz.Brand+" dalam angka", biz.Stats),
			trust,
			reviews,
			footer,
			float,
		},
	)

	caraPesan := page("cara-pesan", "Cara Pesan", false,
		map[string]any{"title": "Cara Pesan — " + biz.Brand, "description": biz.CaraHero[1]},
		[]map[string]any{
			nav,
			subHero(biz.CaraHero[0], biz.CaraHero[1]),
			processSteps("Langkah pemesanan", biz.Steps),
			block("UmkmTrustBadges", map[string]any{"title": "Pembayaran & pengiriman", "subtitle": "", "items": biz.Payments}),
			pageFAQ("Pertanyaan yang sering ditanyakan", biz.FAQ),
			promo,
			footer,
			float,
		},
	)

	kontak := page("kontak", "Kontak", false,
		map[string]any{"title": "Kontak — " + biz.Brand, "description": biz.KontakHero[1]},
		[]map[string]any{
			nav,
			subHero(biz.KontakHero[0], biz.KontakHero[1]),
			store,
			market,
			footer,
			float,
		},
	)

	return []map[string]any{home, produk, tentang, caraPesan, kontak}
}

// ---------------- Portofolio ----------------

func portfolioPages(cv variantCopy, variant string) []map[string]any {
	links := []map[string]any{
		{"label": "Beranda", "href": "/"},
		{"label": "Project", "href": "/project"},
		{"label": "Layanan", "href": "/layanan"},
		{"label": "Tentang", "href": "/tentang"},
		{"label": "Kontak", "href": "/kontak"},
	}
	nav := block("Navbar", map[string]any{"brand": "Nama Saya", "links": links})
	footer := block("Footer", map[string]any{"copyright": "© Nama Saya — Web Developer & Designer"})

	home := page("home", "Beranda", true,
		map[string]any{
			"title":       "Nama Saya — Portfolio Web Developer",
			"description": "Web developer berpengalaman 5+ tahun. Spesialis aplikasi web modern dengan React, Next.js, dan Go.",
		},
		[]map[string]any{
			nav,
			proHero(variant, heroCopy{
				Eyebrow:    "Tersedia untuk project baru · Q3 2025",
				Title:      "Saya bantu bisnis Anda",
				Highlight:  "tumbuh lewat produk digital",
				TitleAfter: "yang benar-benar dipakai.",
				Subtitle:   "Web Developer & Designer dari Jakarta. 5+ tahun membangun aplikasi web yang cepat, indah, dan mudah dipakai — untuk startup hingga enterprise.",
				CTA:        "Lihat project saya",
				CTAHref:    "/project",
			}),
			trustBar("Klien saya termasuk:", []string{
				"TechCorp", "StartupID", "PayNusa", "EduTech", "HealthPlus",
				"Kompas", "Traveloka", "Gojek", "Bibit",
			}),
			statsRow("5 tahun · angka yang saya banggakan", []map[string]any{
				{"value": "37", "label": "Project shipped"},
				{"value": "24", "label": "Klien puas"},
				{"value": "12M+", "label": "Users menggunakan"},
				{"value": "100%", "label": "On-time delivery"},
			}),
			proFeatureGrid(variant, "Apa yang saya kerjakan", []map[string]any{
				{"title": "Frontend Development", "desc": "Aplikasi React/Next.js dengan UI modern, performa optimal (Lighthouse >95), dan accessible."},
				{"title": "Backend Development", "desc": "REST API dengan Go/Node.js, integrasi database Postgres/Redis, autentikasi JWT/OAuth, deployment Docker+K8s."},
				{"title": "UI/UX Design", "desc": "Desain interface yang clean, intuitif, dan memprioritaskan kebutuhan user. Figma → code seamless."},
				{"title": "Mobile-Responsive", "desc": "Setiap aplikasi dibangun mobile-first — tested di iOS Safari, Chrome Android, dan browser desktop."},
				{"title": "Performance Audit", "desc": "Audit performa aplikasi existing, optimasi bundle size, caching strategy, dan database queries."},
				{"title": "Security Review", "desc": "Review OWASP top-10 vulnerabilities, secure coding practices, dan hardening deployment."},
			}),
			block("BentoGrid", map[string]any{
				"title": "Project pilihan",
				"items": []map[string]any{
					{"title": "Web Builder SaaS", "desc": "Multi-tenant platform · 500+ active users · Next.js + Go", "size": "large"},
					{"title": "E-commerce UMKM", "desc": "50+ merchant · payment gateway · Rp 2M GMV/bulan", "size": "wide"},
					{"title": "Dashboard Analytics", "desc": "Realtime · <100ms latency · ClickHouse"},
					{"title": "LMS", "desc": "5.000+ siswa aktif"},
					{"title": "Klinik Digital", "desc": "Rekam medis + jadwal dokter"},
				},
			}),
			block("Section", map[string]any{
				"title": "Cara saya bekerja",
				"body":  "Saya percaya **komunikasi** adalah 80% keberhasilan project. Alurnya:\n\n1. **Discovery** — diskusi mendalam soal goal, user, dan constraint (waktu, budget, teknis).\n2. **Rapid prototype** — mockup Figma dalam 3–5 hari sebelum sebaris kode ditulis.\n3. **Sprint mingguan** — demo setiap Jumat, feedback loop cepat.\n4. **Ship + monitor** — deploy production, saya standby untuk 2 minggu bug-fix gratis.",
			}),
			proTestimonials("Kata klien saya", []map[string]any{
				{"quote": "Hasil kerjanya melebihi ekspektasi. Komunikasi smooth, deadline tepat, dan kode-nya rapi banget. Kami sudah lanjut ke project ke-3.", "name": "Andi Pratama", "role": "CEO, TechCorp"},
				{"quote": "Sangat profesional. Tidak hanya bisa coding, tapi juga ngerti bisnis dan sering kasih saran strategis yang menghemat kami puluhan juta.", "name": "Rina Setyawan", "role": "Founder, StartupID"},
				{"quote": "Kalau semua developer Indonesia kayak dia, kita nggak perlu hire dari luar. Detail-oriented, on-time, dan proaktif komunikasi kalau ada blocker.", "name": "Dedi Kurniawan", "role": "CTO, PayNusa"},
			}),
			block("BorderBeamCard", map[string]any{
				"title":    "Paket Fixed-Price MVP",
				"subtitle": "Cocok untuk validasi ide startup",
				"price":    "Rp 45 juta",
				"period":   "· timeline 4–6 minggu",
				"ctaLabel": "Diskusi lebih lanjut",
				"ctaHref":  "/kontak",
				"bullets": []map[string]any{
					{"text": "Discovery workshop + user research (1 minggu)"},
					{"text": "Design system + high-fidelity Figma"},
					{"text": "Full-stack MVP (Next.js + Go + Postgres)"},
					{"text": "Deploy production + custom domain + SSL"},
					{"text": "2 minggu warranty bug-fix pasca launch"},
				},
			}),
			proFinalCTA(variant,
				"Punya ide product yang mau di-eksekusi?",
				"Slot Q3 2025 tinggal 2 project. Diskusi 30 menit gratis untuk explore fit.",
				"Book jadwal diskusi",
				"/kontak",
			),
			footer,
		},
	)

	project := page("project", "Project", false,
		map[string]any{"title": "Project Saya — Portfolio", "description": "Kumpulan project terbaik dari 5 tahun karir sebagai developer."},
		[]map[string]any{
			nav,
			subHero("Project pilihan",
				"Kumpulan project terbaik dari 5 tahun karir sebagai developer. Klik untuk detail studi kasus, tech stack, dan outcome."),
			statsRow("Angka yang saya kerjakan", []map[string]any{
				{"value": "37", "label": "Project shipped"},
				{"value": "12M+", "label": "Users total"},
				{"value": "24", "label": "Klien puas"},
				{"value": "8", "label": "Industri berbeda"},
			}),
			block("BentoGrid", map[string]any{
				"title": "Web Applications — client work",
				"items": []map[string]any{
					{"title": "E-commerce UMKM", "desc": "50+ merchant · Rp 2M GMV/bulan · Next.js + Stripe", "size": "large"},
					{"title": "Dashboard Analytics", "desc": "Realtime · <100ms · React + Go + ClickHouse", "size": "wide"},
					{"title": "LMS Platform", "desc": "5.000+ siswa · Next.js + Node"},
					{"title": "Sistem Klinik", "desc": "Rekam medis · Vue + Laravel"},
					{"title": "Fintech MVP", "desc": "OJK sandbox · Go + Postgres"},
				},
			}),
			proFeatureGrid(variant, "Open source & side projects", []map[string]any{
				{"title": "go-utils", "desc": "Library Go untuk helper umum. 250+ stars di GitHub, dipakai oleh 30+ project."},
				{"title": "Personal Blog Generator", "desc": "Static site generator untuk blog teknis (Markdown → HTML statis, kompilasi <500ms)."},
				{"title": "Tailwind Component Kit", "desc": "Collection 40+ komponen UI siap pakai. 1.000+ downloads NPM."},
				{"title": "Realtime chat starter", "desc": "Full-stack template WebSocket chat dengan presence + typing indicator."},
				{"title": "Landing page templates", "desc": "10+ template SaaS landing gratis — pakai stack Next.js + Tailwind."},
				{"title": "Testing helpers", "desc": "Playwright helpers untuk visual regression testing + auth flow."},
			}),
			proTestimonials("Apa kata klien lama", []map[string]any{
				{"quote": "Detail-oriented, on-time, komunikatif. Saya sudah hire dev freelance banyak, tapi ini yang paling profesional. Direkomendasikan.", "name": "Andi Pratama", "role": "CEO TechCorp · client sejak 2022"},
				{"quote": "Yang paling saya suka: dia tidak asal terima brief. Selalu kasih pushback kalau ada solusi lebih murah/simple. Save budget kami puluhan juta.", "name": "Rina Setyawan", "role": "Founder StartupID"},
				{"quote": "Kualitas kode-nya rapi banget — 2 tahun kemudian tim internal kami masih bisa maintain tanpa kesulitan. Rare untuk freelance dev.", "name": "Dedi Kurniawan", "role": "CTO PayNusa"},
			}),
			simpleCTA("Tertarik berkolaborasi?",
				"Slot Q3 2025 tinggal 2 project. Book call discovery 30-menit gratis.",
				"Book jadwal diskusi",
				"/kontak"),
			footer,
		},
	)

	layanan := page("layanan", "Layanan", false,
		map[string]any{"title": "Layanan — Nama Saya", "description": "Web development, aplikasi custom, e-commerce, dan konsultasi."},
		[]map[string]any{
			nav,
			subHero("Layanan yang saya tawarkan",
				"Solusi web development untuk berbagai kebutuhan bisnis. Fixed-price untuk scope yang jelas, hourly retainer untuk yang ongoing."),
			proFeatureGrid(variant, "6 paket layanan utama", []map[string]any{
				{"title": "Website Bisnis", "desc": "Landing page + halaman produk + SEO basic. Mulai Rp 5jt · lead time 2 minggu."},
				{"title": "Web Aplikasi Custom", "desc": "Full-stack aplikasi web fungsional dengan database & autentikasi. Mulai Rp 15jt · 1–3 bulan."},
				{"title": "E-commerce", "desc": "Toko online lengkap dengan payment gateway + inventory. Mulai Rp 25jt · 6 minggu."},
				{"title": "Maintenance & fix", "desc": "Update fitur, bug fix, optimasi performa. Per jam Rp 500rb atau retainer bulanan."},
				{"title": "UI/UX Redesign", "desc": "Perbaikan tampilan aplikasi existing. Wireframe → high-fidelity Figma → code."},
				{"title": "Konsultasi & mentoring", "desc": "Sesi 1-on-1 untuk arsitektur, code review, atau career advice. Rp 1jt/jam."},
			}),
			block("BorderBeamCard", map[string]any{
				"title":    "Paket MVP Fixed-Price",
				"subtitle": "Cocok untuk validasi ide startup",
				"price":    "Rp 45 juta",
				"period":   "· timeline 4–6 minggu · fixed price no surprise",
				"ctaLabel": "Book discovery call",
				"ctaHref":  "/kontak",
				"bullets": []map[string]any{
					{"text": "Discovery workshop + user research (1 minggu)"},
					{"text": "Design system + high-fidelity Figma (1 minggu)"},
					{"text": "Full-stack MVP (Next.js + Go + Postgres, 3 minggu)"},
					{"text": "Deploy production + custom domain + SSL"},
					{"text": "2 minggu warranty bug-fix pasca launch"},
					{"text": "1 bulan support 5 hari/minggu (email + WA)"},
				},
			}),
			processSteps("Cara saya bekerja", []map[string]any{
				{"title": "Discovery", "desc": "Call 30 menit gratis untuk explore fit."},
				{"title": "Sprint mingguan", "desc": "Demo tiap Jumat, feedback loop cepat."},
				{"title": "Ship + warranty", "desc": "Deploy production + 2 minggu bug-fix."},
			}),
			proFeatureGrid(variant, "Stack yang sering saya pakai", []map[string]any{
				{"title": "Frontend", "desc": "React, Next.js, Tailwind, TypeScript, shadcn/ui, Framer Motion."},
				{"title": "Backend", "desc": "Go (Fiber/Gin), Node.js (Express/Fastify), Python (FastAPI)."},
				{"title": "Database", "desc": "PostgreSQL, MySQL, MongoDB, Redis, ClickHouse, SQLite."},
				{"title": "DevOps", "desc": "Docker, Kubernetes, GitHub Actions, AWS, Vercel, Cloudflare."},
			}),
			pageFAQ("Pertanyaan yang sering ditanyakan", []map[string]any{
				{"question": "Bisa kerja on-site atau harus remote?"},
				{"question": "Apakah ada garansi setelah launch?"},
				{"question": "Bagaimana pembayaran?"},
				{"question": "Kalau scope berubah di tengah project?"},
				{"question": "Bisa join tim internal jangka panjang?"},
			}),
			simpleCTA("Punya project yang mau dieksekusi?",
				"Book discovery call 30 menit — gratis, tanpa komitmen.",
				"Book sekarang",
				"/kontak"),
			footer,
		},
	)

	tentang := page("tentang", "Tentang", false,
		map[string]any{"title": "Tentang Saya", "description": "Cerita, pengalaman, dan hal di luar coding."},
		[]map[string]any{
			nav,
			subHero("Tentang saya",
				"Developer, designer, dan eternal learner. Berbasis di Jakarta, kerja dengan klien dari Indonesia sampai Australia."),
			block("Section", map[string]any{
				"title": "Cerita singkat",
				"body":  "Saya mulai ngoding tahun **2018** saat masih kuliah jurusan Teknik Informatika. Dimulai dari hobi bikin website iseng, sekarang sudah 5+ tahun jadi full-time developer di berbagai project remote.\n\nSaya percaya **teknologi terbaik adalah yang membuat hidup orang lebih mudah, bukan lebih rumit**. Karenanya saya selalu fokus pada kesederhanaan dan user experience — bukan showoff tech stack.",
			}),
			timelineBlock("Perjalanan karir", []map[string]any{
				{"date": "2018", "title": "Mulai ngoding sambil kuliah Teknik Informatika"},
				{"date": "2020", "title": "Freelance web dev — websites & tools UMKM"},
				{"date": "2022", "title": "Full-Stack Developer @ Local Startup (E-commerce)"},
				{"date": "2023", "title": "Senior Full-Stack @ Remote (B2B SaaS US company)"},
				{"date": "2025", "title": "Independent consultant — 24 klien puas & berkembang"},
			}),
			proFeatureGrid(variant, "Prinsip kerja", []map[string]any{
				{"title": "Ship > perfect", "desc": "Perfect adalah musuh done. Saya prefer ship v1 lalu iterasi berdasarkan feedback real user."},
				{"title": "Over-communicate", "desc": "Silence itu red flag. Kalau ada blocker, saya kasih tahu HARI ITU juga — bukan Jumat sore."},
				{"title": "Bisnis dulu, tech kedua", "desc": "Saya mikir ROI project sebelum pilih tech stack. Bukan sebaliknya."},
				{"title": "Terus belajar", "desc": "1 jam/hari untuk baca / eksperimen tech baru. Kalau sudah 3 bulan nggak belajar, saya panic."},
			}),
			block("BentoGrid", map[string]any{
				"title": "Selain coding",
				"items": []map[string]any{
					{"title": "Fotografi", "desc": "Street photography weekend — Instagram @namasaya.photo · 40+ kota", "size": "large"},
					{"title": "Gaming", "desc": "RPG & indie games", "size": "wide"},
					{"title": "Membaca", "desc": "Sci-fi, bisnis, psychology"},
					{"title": "Berbagi", "desc": "Mentor komunitas dev lokal"},
					{"title": "Lari", "desc": "5K/week · half-marathon 2024"},
				},
			}),
			simpleCTA("Ingin ngobrol tech / karir?",
				"Saya sesekali buka slot mentoring gratis untuk junior dev. Follow LinkedIn saya untuk update slot.",
				"Follow LinkedIn",
				"https://linkedin.com/in/namasaya"),
			footer,
		},
	)

	kontak := page("kontak", "Kontak", false,
		map[string]any{"title": "Kontak — Nama Saya", "description": "Book jadwal call, kirim email, atau follow di social."},
		[]map[string]any{
			nav,
			subHero("Mari berkolaborasi 🤝",
				"Saya selalu terbuka untuk diskusi project, kerja sama, atau sekadar ngobrol soal teknologi. Rata-rata respon <24 jam."),
			block("IconList", map[string]any{
				"title": "Cara menghubungi",
				"items": []map[string]any{
					{"icon": "✉", "text": "hello@namasaya.com — respon dalam 24 jam"},
					{"icon": "💼", "text": "linkedin.com/in/namasaya — profile + endorsement + article"},
					{"icon": "🐙", "text": "github.com/namasaya — 30+ open source contributions"},
					{"icon": "🐦", "text": "@namasaya di X — thoughts & tech updates"},
					{"icon": "📱", "text": "0812-3456-7890 (WA — urgent only please)"},
					{"icon": "📍", "text": "Jakarta, Indonesia · remote & onsite (Jabodetabek)"},
				},
			}),
			contactBlock("Mulai project? Isi form ini",
				"Berikan brief singkat + timeline + budget range. Saya reply dengan proposal + jadwal discovery call dalam 24 jam."),
			socialBlock([]map[string]any{
				{"platform": "LinkedIn"},
				{"platform": "GitHub"},
				{"platform": "Twitter"},
				{"platform": "Instagram"},
				{"platform": "YouTube"},
			}),
			pageFAQ("FAQ collab", []map[string]any{
				{"question": "Bisa kerja sebagai part-time?"},
				{"question": "Rate/jam berapa?"},
				{"question": "Ada NDA/kontrak yang formal?"},
				{"question": "Bisa remote lintas timezone?"},
				{"question": "Bagaimana dengan IP ownership project?"},
			}),
			footer,
		},
	)

	return []map[string]any{home, project, layanan, tentang, kontak}
}

// ---------------- Blog ----------------

func blogPages(cv variantCopy, variant string) []map[string]any {
	links := []map[string]any{
		{"label": "Beranda", "href": "/"},
		{"label": "Artikel", "href": "/artikel"},
		{"label": "Kategori", "href": "/kategori"},
		{"label": "Tentang", "href": "/tentang"},
		{"label": "Kontak", "href": "/kontak"},
	}
	nav := block("Navbar", map[string]any{"brand": "Blog Saya", "links": links})
	footer := block("Footer", map[string]any{"copyright": "© Blog Saya — Berbagi Cerita & Wawasan"})

	home := page("home", "Beranda", true,
		map[string]any{
			"title":       "Blog Saya — Tulisan Tentang Teknologi & Kehidupan",
			"description": "Catatan harian seputar teknologi, produktivitas, dan refleksi pribadi. Diperbarui setiap minggu.",
		},
		[]map[string]any{
			nav,
			proHero(variant, heroCopy{
				Eyebrow:    "Newsletter mingguan · 12.400+ pembaca",
				Title:      "Tulisan panjang tentang",
				Highlight:  "teknologi, produktivitas & hidup",
				TitleAfter: "yang sengaja pelan.",
				Subtitle:   "Setiap Jumat saya kirim 1 essay 800-kata via email. Tidak clickbait, tidak listicle 3-menit — cerita, framework, atau refleksi yang saya sendiri butuhkan minggu itu.",
				CTA:        "Subscribe gratis",
				CTAHref:    "#newsletter",
			}),
			block("Newsletter", map[string]any{
				"title":       "Bergabung dengan 12.400+ pembaca setia",
				"subtitle":    "1 essay mingguan · dikirim Jumat pagi · unsubscribe kapan saja",
				"placeholder": "nama@email.com",
				"ctaLabel":    "Subscribe",
			}),
			block("BlogListDynamic", map[string]any{
				"title": "Artikel terbaru",
				"limit": 6,
			}),
			statsRow("3 tahun · nilai yang saya buat", []map[string]any{
				{"value": "180+", "label": "Essay published"},
				{"value": "12.400", "label": "Subscribers"},
				{"value": "42%", "label": "Open rate email"},
				{"value": "8/10", "label": "Rekomendasi baca"},
			}),
			proFeatureGrid(variant, "Topik yang sering saya bahas", []map[string]any{
				{"title": "Teknologi", "desc": "Tutorial coding, review tools, dan tren web development yang benar-benar berguna — bukan hype."},
				{"title": "Produktivitas", "desc": "Workflow, habit, dan tools yang saya pakai untuk deep work. Sudah tested, bukan sekedar teori."},
				{"title": "Buku & belajar", "desc": "Review buku non-fiksi (bisnis, sains, filosofi) dengan takeaway yang bisa langsung dieksekusi."},
				{"title": "Refleksi", "desc": "Pelajaran dari perjalanan karir, keputusan bisnis, dan keputusan hidup yang tidak selalu benar."},
				{"title": "Karir tech", "desc": "Cara negosiasi salary, memilih company, cari mentor, dan naik jenjang tanpa politik kantor."},
				{"title": "Mental model", "desc": "Framework berpikir dari Munger, Kahneman, dan Taleb — diterapkan ke keputusan sehari-hari."},
			}),
			proTestimonials("Kata pembaca setia", []map[string]any{
				{"quote": "Tulisannya bermanfaat dan mudah dicerna — jarang saya ketemu blog Indonesia yang sekelas Farnam Street. Wajib follow untuk yang lagi belajar coding atau career development.", "name": "Rani Pratiwi", "role": "Software Engineer, Traveloka"},
				{"quote": "Konten teknologinya selalu update dan disertai contoh nyata. Yang paling saya suka: dia berani bilang 'saya salah' kalau essay lama sudah tidak relevan.", "name": "Doni Kurniawan", "role": "Product Manager, Bibit"},
				{"quote": "Newsletter Jumat pagi adalah highlight minggu saya. Selalu ada 1 kalimat yang saya screenshot atau kirim ke tim. Recommended banget.", "name": "Sari Wijaya", "role": "Founder, DesignStudio"},
			}),
			block("Section", map[string]any{
				"title": "Kenapa newsletter, bukan cuma blog?",
				"body":  "Blog itu passive — kamu harus datang. Newsletter itu active — sampai ke inbox kamu, konsisten setiap minggu.\n\nDan jujur: **email inbox** adalah salah satu media paling personal yang masih tersisa di internet 2025. Saya nggak mau nulis untuk algoritma feed, saya mau nulis untuk **kamu** — 1 orang membaca 1 email di pagi Jumat sambil minum kopi.",
			}),
			proFinalCTA(variant,
				"Baca lebih fokus. Konsumsi lebih sedikit. Pikir lebih dalam.",
				"Gabung dengan 12.400+ pembaca yang menerima 1 essay panjang setiap Jumat pagi. Gratis. Kapan saja bisa unsubscribe.",
				"Subscribe newsletter",
				"#newsletter",
			),
			footer,
		},
	)

	artikel := page("artikel", "Artikel", false,
		map[string]any{"title": "Semua Artikel — Blog Saya"},
		[]map[string]any{
			nav,
			subHero(
				"Semua tulisan · 180+ essay",
				"Arsip lengkap sejak 2023. Rata-rata 800–1.500 kata per essay — untuk dibaca pelan, sambil kopi.",
			),
			statsRow("Yang bakal kamu temukan", []map[string]any{
				{"value": "180+", "label": "Essay panjang"},
				{"value": "12rb", "label": "Subscribers"},
				{"value": "8 min", "label": "Rata-rata baca"},
				{"value": "6", "label": "Kategori topik"},
			}),
			block("Newsletter", map[string]any{
				"title":       "Nggak sempat baca semuanya? Terima 1 essay/minggu via email",
				"subtitle":    "Setiap Jumat pagi · 1 essay pilihan · unsubscribe kapan saja",
				"placeholder": "nama@email.com",
				"ctaLabel":    "Subscribe gratis",
			}),
			block("BlogListDynamic", map[string]any{
				"title": "Semua essay (terbaru dulu)",
				"limit": 50,
			}),
			proFeatureGrid(variant, "Kenapa nulis essay panjang di era listicle?", []map[string]any{
				{"title": "Deep, bukan skim", "desc": "Listicle 3-menit bikin kamu merasa produktif, tapi nggak nempel. Essay 800-kata memaksa mikir — dan yang mikir yang berubah."},
				{"title": "Tulisan = proses berpikir", "desc": "Saya nulis untuk mengklarifikasi pikiran saya sendiri. Kamu kebetulan ikut baca hasil pemikirannya."},
				{"title": "Konsistensi 3 tahun", "desc": "Rutin publish sejak 2023 tiap Jumat. Ini bukan side project — ini kebiasaan berpikir yang saya jaga."},
				{"title": "Anti-clickbait", "desc": "Judul deskriptif, bukan 'You won't believe...'. Kamu berhak tahu isi essay sebelum klik."},
				{"title": "Cross-link antar essay", "desc": "Setiap essay merefer ke essay lain yang relevan. Kamu bisa menyelam ke rabbit hole yang bermakna."},
				{"title": "Reply-friendly", "desc": "Kalau kamu subscribe newsletter, kamu bisa reply email saya langsung. Saya baca semua, meski nggak selalu bisa reply."},
			}),
			simpleCTA(
				"Baru pertama kesini? Mulai dari 5 essay favorit saya",
				"Saya sudah kurasi 5 tulisan yang paling representatif — cocok untuk pembaca baru yang mau ngerti 'suara' saya.",
				"Lihat kategori",
				"/kategori",
			),
			footer,
		},
	)

	kategori := page("kategori", "Kategori", false,
		map[string]any{"title": "Kategori Artikel — Blog Saya"},
		[]map[string]any{
			nav,
			subHero(
				"6 topik, 1 sudut pandang",
				"Semua essay saya berputar di sekitar 6 topik ini. Pilih yang paling relevan sama fase hidup kamu sekarang.",
			),
			block("BentoGrid", map[string]any{
				"title": "Peta topik blog",
				"items": []map[string]any{
					{"title": "Teknologi & Coding", "desc": "42 essay. Bukan tutorial 'how-to' — lebih ke 'kapan dipakai, kapan jangan'. Contoh: kenapa saya berhenti pakai TypeScript untuk side project.", "size": "lg"},
					{"title": "Produktivitas", "desc": "38 essay. Workflow yang tested, bukan hype. Contoh: cara saya baca 40 buku setahun tanpa jadi Goodreads slave.", "size": "md"},
					{"title": "Buku & Belajar", "desc": "32 essay. Review buku + framework belajar. Contoh: 5 buku non-fiksi wajib untuk software engineer 2026.", "size": "md"},
					{"title": "Karir Tech", "desc": "28 essay. Negosiasi salary, memilih company, cari mentor. Contoh: kapan resign — dan kapan bertahan.", "size": "lg"},
					{"title": "Refleksi Pribadi", "desc": "22 essay. Pelajaran dari kegagalan, keputusan salah, dan momen 'aha' yang lucu-nya baru datang setahun kemudian.", "size": "md"},
					{"title": "Mental Model", "desc": "18 essay. Framework berpikir dari Munger, Kahneman, Taleb — diterapkan ke keputusan nyata (bukan cuma diquote).", "size": "md"},
				},
			}),
			proFeatureGrid(variant, "Baru pertama kali? Mulai dari 5 essay favorit saya", []map[string]any{
				{"title": "Berhenti Baca Buku Bisnis", "desc": "Kenapa saya nggak lagi baca buku bisnis best-seller — dan apa yang saya baca sebagai gantinya. (Kategori: Buku & Belajar)"},
				{"title": "Anti-goal 2026", "desc": "Daftar hal yang saya PASTIKAN nggak akan saya kerjakan tahun ini — lebih penting dari daftar goal. (Kategori: Produktivitas)"},
				{"title": "Kapan Resign", "desc": "Framework 4-pertanyaan yang saya pakai sebelum keluar dari 3 pekerjaan terakhir. (Kategori: Karir Tech)"},
				{"title": "Silent Meeting", "desc": "Kenapa tim engineering saya wajib silent meeting 15 menit sebelum diskusi. Hasil: keputusan 3× lebih cepat. (Kategori: Produktivitas)"},
				{"title": "TypeScript Fatigue", "desc": "Kapan TypeScript worth-it, kapan cuma bikin ribet. Bahas dari sisi tim junior + solo dev. (Kategori: Teknologi)"},
				{"title": "Second Brain Setup", "desc": "Setup Obsidian + Readwise saya — 3 tahun konsisten. Bukan tutorial, tapi *kenapa* tiap keputusan setup dibuat. (Kategori: Buku & Belajar)"},
			}),
			block("BlogListDynamic", map[string]any{
				"title": "Essay terbaru dari semua kategori",
				"limit": 6,
			}),
			proTestimonials("Yang pembaca bilang", []map[string]any{
				{"quote": "Kategori 'Karir Tech' bikin saya berani negosiasi salary 30% naik saat pindah kerja tahun lalu. Framework 4-pertanyaannya beneran kepake.", "name": "Angga Putra", "role": "Backend Engineer, Gojek"},
				{"quote": "Saya subscribe 100+ newsletter. Cuma 3 yang saya baca kata-per-kata. Blog ini salah satunya. Perbandingannya: substack Farnam Street & Ness Labs.", "name": "Dita Ramadhani", "role": "Product Designer, Tokopedia"},
			}),
			simpleCTA(
				"Sudah tahu topik favorit? Baca essay-nya",
				"Klik kategori manapun di atas untuk melihat semua essay di topik tersebut, atau langsung ke arsip lengkap.",
				"Buka arsip lengkap",
				"/artikel",
			),
			footer,
		},
	)

	tentang := page("tentang", "Tentang", false,
		map[string]any{"title": "Tentang Penulis — Blog Saya"},
		[]map[string]any{
			nav,
			subHero(
				"Halo, saya penulis blog ini",
				"Software engineer, essayist, lifelong learner. Berbasis di Yogyakarta. Menulis pelan supaya bisa mikir pelan.",
			),
			block("Section", map[string]any{
				"title": "Kenapa saya nulis blog ini",
				"body":  "Saya mulai blog ini di 2020 sebagai jurnal privat — literally cuma untuk saya sendiri. Rasanya kepala saya terlalu berisik, dan menulis adalah satu-satunya cara saya bisa mengurut isinya.\n\nPertengahan 2023 saya bikin newsletter version — kirim 1 essay per minggu ke email siapa saja yang mau baca. Nggak nyangka 3 tahun kemudian ada 12.400 orang di list. Tapi angka itu bukan poin-nya. Poin-nya: saya menemukan orang-orang yang berpikir mirip, dan itu yang bikin nulis rasanya nggak sendirian.\n\nBlog ini bukan bisnis. Nggak ada affiliate, nggak jualan course. Kalau nanti ada — saya akan sangat eksplisit soal itu. Sampai kapan pun, prioritas utama saya: **essay yang saya sendiri bakal ingin baca lagi 5 tahun kemudian.**",
			}),
			timelineBlock("Journey menulis (yang penting)", []map[string]any{
				{"year": "2020", "title": "Blog privat pertama", "desc": "Ditulis di Notion. 43 essay di tahun pertama. Nggak ada yang baca kecuali saya + istri."},
				{"year": "2021", "title": "Publish pertama di publik", "desc": "Move ke Ghost. 12 essay diseleksi ulang dari draft privat. Reader pertama: 8 orang."},
				{"year": "2022", "title": "Fokus di essay panjang", "desc": "Berhenti nulis listicle & tutorial. Full commit ke essay 800+ kata. Traffic turun 50% — tapi retention naik."},
				{"year": "2023", "title": "Newsletter launch", "desc": "Kirim 1 essay/minggu via email. 300 subscriber di bulan pertama."},
				{"year": "2024", "title": "10.000 subscribers", "desc": "Milestone. Sisipin donation link opsional — 47 pembaca ikut donate sukarela. Blog jadi 'sustainable hobby'."},
				{"year": "2026", "title": "12.400 subscribers, 180 essay", "desc": "Konsisten Jumat pagi 3 tahun berturut-turut. Belum pernah miss 1 minggu pun."},
			}),
			proFeatureGrid(variant, "Kehidupan sehari-hari saya", []map[string]any{
				{"title": "Pekerjaan utama", "desc": "Senior Software Engineer di startup fintech remote. 4 hari kerja/minggu — 1 hari saya sengaja kosong untuk deep read + nulis."},
				{"title": "Lokasi", "desc": "Yogyakarta, Indonesia. Rumah kecil di pinggir sawah. Kopi bikin sendiri pakai V60."},
				{"title": "Rutinitas nulis", "desc": "Setiap pagi 5.30–7.00 nulis draft. Rabu edit. Kamis proofread. Jumat 5.00 pagi publish."},
				{"title": "Membaca", "desc": "40 buku setahun (target 2026). Rasio: 60% non-fiksi (bisnis, sains, filosofi), 40% fiksi (klasik & sastra Indonesia)."},
				{"title": "Podcast rutin", "desc": "Huberman Lab, Acquired, Farnam Street, dan Podcast Kuliner Bumi (untuk fun aja)."},
				{"title": "Off-screen", "desc": "Weekend hiking sekitar Merapi/Merbabu. Sabtu pagi coffeeshop. Minggu family day full — no laptop."},
			}),
			block("BentoGrid", map[string]any{
				"title": "Setup & tools yang saya pakai (jujur)",
				"items": []map[string]any{
					{"title": "Hardware", "desc": "MacBook Air M3 2024 · monitor Dell U2723QE · keyboard Keychron Q1 Pro · headphone Sony WH-1000XM5", "size": "lg"},
					{"title": "Menulis", "desc": "Draft: Obsidian · Editing: iA Writer · Publish: Ghost (self-hosted)", "size": "md"},
					{"title": "Second brain", "desc": "Obsidian + Readwise + Zotero · 3.400 highlights sync-ed", "size": "md"},
					{"title": "Productivity", "desc": "Task: Things 3 · Calendar: Fantastical · Kanban: Linear (kerja)", "size": "lg"},
				},
			}),
			statsRow("Yang bikin saya bangga (bukan angka pembaca)", []map[string]any{
				{"value": "180+", "label": "Essay konsisten"},
				{"value": "156", "label": "Minggu berturut-turut publish"},
				{"value": "47", "label": "Pembaca yang donate sukarela"},
				{"value": "1.200+", "label": "Email reply dari pembaca"},
			}),
			simpleCTA(
				"Mau ikut serta di journey ini?",
				"Subscribe newsletter — 1 essay Jumat pagi. Kalau nggak cocok, unsubscribe 1 klik dari email pertama.",
				"Subscribe gratis",
				"#newsletter",
			),
			footer,
		},
	)

	kontak := page("kontak", "Kontak", false,
		map[string]any{"title": "Kontak — Blog Saya"},
		[]map[string]any{
			nav,
			subHero(
				"Mari terhubung",
				"Saya baca semua email dari pembaca. Reply mungkin lambat (kadang 2 minggu untuk email panjang), tapi pasti dibaca.",
			),
			block("IconList", map[string]any{
				"title": "Cara menghubungi",
				"items": []map[string]any{
					{"icon": "✉", "title": "Email (prefer)", "desc": "halo@blogsaya.id · reply 1–7 hari · media terbaik untuk diskusi mendalam"},
					{"icon": "🐦", "title": "Twitter / X", "desc": "@blogsaya · reply 1–3 hari · cocok untuk sapa singkat & komentar essay"},
					{"icon": "💼", "title": "LinkedIn", "desc": "linkedin.com/in/blogsaya · reply 3–7 hari · undangan speaking/workshop"},
					{"icon": "📸", "title": "Instagram", "desc": "@blogsaya.id · rarely reply · behind-the-scene + foto kopi + kutipan buku"},
					{"icon": "🐙", "title": "GitHub", "desc": "github.com/blogsaya · issue di repo essay boleh — untuk saran topik open source"},
					{"icon": "📮", "title": "Reply email newsletter", "desc": "Kalau kamu subscriber — reply email Jumat langsung. Ini cara paling personal & tercepat."},
				},
			}),
			contactBlock(
				"Kirim pesan langsung",
				"Isi form ini — email masuk ke inbox pribadi saya. Sebutkan konteks (essay mana yang bikin kamu kontak, atau topik apa yang mau kamu diskusikan) supaya reply saya lebih tepat sasaran.",
			),
			socialBlock([]map[string]any{
				{"platform": "Email", "href": "mailto:halo@blogsaya.id"},
				{"platform": "Twitter", "href": "https://twitter.com/blogsaya"},
				{"platform": "LinkedIn", "href": "https://linkedin.com/in/blogsaya"},
				{"platform": "Instagram", "href": "https://instagram.com/blogsaya.id"},
				{"platform": "GitHub", "href": "https://github.com/blogsaya"},
				{"platform": "RSS", "href": "/rss.xml"},
			}),
			block("BorderBeamCard", map[string]any{
				"title":    "🎤 Speaking, workshop, atau podcast?",
				"subtitle": "Available untuk 4 event per tahun",
				"price":    "Custom",
				"period":   "sesuai lingkup & audience",
				"ctaLabel": "Email dengan detail acara",
				"ctaHref":  "mailto:halo@blogsaya.id?subject=Speaking%20Invitation",
				"bullets": []map[string]any{
					{"text": "Talk 30–60 menit di meetup/konferensi (offline Jakarta/Bandung/Jogja/Surabaya, online nasional)"},
					{"text": "Workshop 3–4 jam untuk perusahaan/komunitas (topic: writing, deep work, engineering culture)"},
					{"text": "Podcast interview (in-person di Jogja, atau remote via Riverside/Zencastr)"},
					{"text": "Fee: pro-bono untuk komunitas & universitas, invoice untuk perusahaan (mendukung sustainable writing)"},
				},
			}),
			pageFAQ("Yang sering ditanya", []map[string]any{
				{"q": "Berapa lama biasanya reply email?", "a": "Rata-rata 3–5 hari. Kadang lebih lama kalau email panjang & butuh mikir. Kalau 2 minggu belum reply, feel free follow-up — mungkin ke-lewat."},
				{"q": "Menerima guest post?", "a": "Sangat jarang. Setahun terakhir cuma 1 guest post. Kriteria ketat: topik sesuai + tulisan 800+ kata + original + kualitas sekelas essay saya sendiri. Pitch dulu sebelum nulis full."},
				{"q": "Bisa mentoring pribadi?", "a": "Saya sedang batasi mentoring privat (max 3 orang aktif). Kalau slot buka, saya announce di newsletter. Sementara: coba subscribe newsletter dulu — banyak topik career tech saya bahas di sana."},
				{"q": "Bisa reprint / translate essay?", "a": "Ya, dengan syarat: (1) attribution jelas ke blog original, (2) link balik ke essay asli, (3) tidak commercial tanpa izin tertulis. Untuk translate ke bahasa lain: email dulu ya."},
				{"q": "Kenapa blog nggak ada komentar?", "a": "Sengaja. Discussion terbaik happen via reply email newsletter — lebih personal, kurang noise. Kalau publik discussion, taruh di Twitter/LinkedIn dengan tag saya."},
			}),
			footer,
		},
	)

	return []map[string]any{home, artikel, kategori, tentang, kontak}
}
