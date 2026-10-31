"use client";

// ReviewForm — buyers rate a product from the storefront. POSTs to
// /public/sites/:id/products/:slug/reviews with NEXT_PUBLIC_API_BASE.
//
// Anti-spam mirrors the cart checkout: hidden `_hp` honeypot here, per-IP rate
// limit in the backend. Every submission lands as 'pending' — the shop owner
// approves it before it shows — so the success copy says so plainly instead of
// leaving the buyer waiting for a review that never appears.

import { useState, type FormEvent } from "react";

const API = process.env.NEXT_PUBLIC_API_BASE ?? "";

const MAX_BODY = 2000;

export function ReviewForm({ siteId, slug }: { siteId: string; slug: string }) {
  const [rating, setRating] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [body, setBody] = useState("");
  const [hp, setHp] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <div className="wb-rev-done" role="status">
        <strong>Terima kasih atas ulasan Anda!</strong>
        <p>
          Ulasan Anda sedang ditinjau oleh pemilik toko dan akan tampil di halaman ini setelah
          disetujui.
        </p>
      </div>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!API) {
      setErr("Konfigurasi API tidak tersedia.");
      return;
    }
    if (rating < 1) {
      setErr("Pilih bintang dulu, ya.");
      return;
    }
    if (!name.trim()) {
      setErr("Nama wajib diisi.");
      return;
    }
    setSending(true);
    setErr("");
    try {
      const res = await fetch(
        `${API}/public/sites/${encodeURIComponent(siteId)}/products/${encodeURIComponent(slug)}/reviews`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rating,
            author_name: name.trim(),
            phone: phone.trim(),
            body: body.trim(),
            _hp: hp,
          }),
        },
      );
      if (!res.ok) {
        const parsed = await res.json().catch(() => null);
        const fallback =
          res.status === 429
            ? "Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi."
            : `Ulasan gagal dikirim (kode ${res.status}). Coba lagi.`;
        setErr(String(parsed?.error?.message ?? fallback));
        return;
      }
      setDone(true);
    } catch {
      setErr("Gagal terhubung ke server. Periksa koneksi lalu coba lagi.");
    } finally {
      setSending(false);
    }
  }

  const shown = hovered || rating;

  return (
    <form className="wb-rev-form" onSubmit={submit}>
      <p className="wb-rev-form-title">Tulis ulasan Anda</p>

      <div className="wb-rev-field">
        <span className="wb-rev-label" id="wb-rev-rating-label">
          Beri bintang <span aria-hidden="true">*</span>
        </span>
        <div
          className="wb-rev-picker"
          role="radiogroup"
          aria-labelledby="wb-rev-rating-label"
          onMouseLeave={() => setHovered(0)}
        >
          {[1, 2, 3, 4, 5].map((i) => (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={rating === i}
              aria-label={`${i} bintang`}
              className={i <= shown ? "wb-rev-pick is-on" : "wb-rev-pick"}
              onMouseEnter={() => setHovered(i)}
              onFocus={() => setHovered(i)}
              onBlur={() => setHovered(0)}
              onClick={() => setRating(i)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3-5.8 3 1.1-6.5L2.6 9.4l6.5-.9z" />
              </svg>
            </button>
          ))}
        </div>
      </div>

      <div className="wb-rev-row">
        <div className="wb-rev-field">
          <label className="wb-rev-label" htmlFor="wb-rev-name">
            Nama <span aria-hidden="true">*</span>
          </label>
          <input
            id="wb-rev-name"
            className="wb-rev-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            required
            autoComplete="name"
            placeholder="Nama Anda"
          />
        </div>
        <div className="wb-rev-field">
          <label className="wb-rev-label" htmlFor="wb-rev-phone">
            Nomor WhatsApp <span className="wb-rev-hint">(opsional)</span>
          </label>
          <input
            id="wb-rev-phone"
            className="wb-rev-input"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            inputMode="tel"
            autoComplete="tel"
            placeholder="08xxxxxxxxxx"
          />
          <span className="wb-rev-hint">
            Diisi kalau Anda pernah belanja di sini — ulasan Anda akan diberi tanda pembeli
            terverifikasi. Nomor tidak ditampilkan.
          </span>
        </div>
      </div>

      <div className="wb-rev-field">
        <label className="wb-rev-label" htmlFor="wb-rev-body">
          Ulasan
        </label>
        <textarea
          id="wb-rev-body"
          className="wb-rev-input wb-rev-textarea"
          value={body}
          onChange={(e) => setBody(e.target.value.slice(0, MAX_BODY))}
          rows={4}
          placeholder="Ceritakan pengalaman Anda memakai produk ini…"
        />
        <span className="wb-rev-hint">
          {body.length}/{MAX_BODY} karakter
        </span>
      </div>

      {/* Honeypot — hidden from people, irresistible to dumb bots. */}
      <input
        type="text"
        name="_hp"
        value={hp}
        onChange={(e) => setHp(e.target.value)}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="wb-rev-hp"
      />

      {err ? (
        <p className="wb-rev-err" role="alert">
          {err}
        </p>
      ) : null}

      <button type="submit" className="wb-rev-submit" disabled={sending}>
        {sending ? "Mengirim…" : "Kirim Ulasan"}
      </button>
      <p className="wb-rev-hint">Ulasan tampil setelah disetujui pemilik toko.</p>
    </form>
  );
}
