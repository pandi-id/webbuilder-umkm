// Package epp — EPP direct client wrapper untuk PANDI registry via
// pandi-id/epp-pandi-client. Fungsi utama:
//
//   1. Connection management — connect + login + auto-reconnect kalau session
//      hilang. Session pool untuk reuse conn antar-request (EPP login mahal).
//   2. Frame builder helpers — mapping dari provider DTO ke frames.XxxType.
//   3. Response parsing — unmarshal + convert ke provider types + map EPP
//      error code ke sentinel error.
//
// Consumer utama: EPPDirectProvider di sibling file. Package tetap standalone
// supaya bisa dipakai standalone test tanpa import provider.
package epp

import (
	"context"
	"crypto/tls"
	"encoding/xml"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/teknispandi/epp-pandi-client/v2/epp"
	"github.com/teknispandi/epp-pandi-client/v2/frames"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

// Config — dependency injection untuk EPPDirect connection.
type Config struct {
	Host     string        // "epp1.pandi.id"
	Port     int           // 700 (OT&E: 3121 kadang)
	Username string
	Password string
	// TLS auth options — pilih salah satu:
	CertFile string // path client cert (PEM)
	KeyFile  string // path client private key (PEM)
	CAFile   string // path CA cert untuk verify server (opsional)

	InsecureSkipVerify bool          // dev/OT&E dengan self-signed
	Timeout            time.Duration // per-command timeout (default 30s)
	KeepAliveInterval  time.Duration // hello frame interval (default 5min)
	MaxRetries         int           // per-command retry (default 2)

	// PerCommandSession — connect+login+logout per-command (no reuse).
	// Bermanfaat untuk registry yang session-cap ketat + debug XML log.
	PerCommandSession bool
	// LogFile — path ke file dump verbose EPP log (include XML frames).
	// Kosong = tidak log ke file.
	LogFile string
	// DebugXML — kalau true, print request frame (marshaled XML) + response
	// raw ke slog setiap EPP command. WARNING: XML bisa mengandung
	// credential + PII; HANYA aktifkan di dev/staging untuk debugging.
	DebugXML bool
}

// Client — session-aware EPP wrapper. Thread-safe: single underlying conn
// + mutex around commands (EPP protocol serial — 1 command per session).
//
// Untuk high-concurrency, gunakan SessionPool (dibungkus di connection
// package terpisah). MVP: single session cukup untuk <10 req/sec.
type Client struct {
	cfg      Config
	logger   *zap.Logger // shared di across sessions (dipakai library util WithLogger)
	logFile  *os.File    // ref file untuk graceful close
	// opsLogger — structured JSON logger per-operation (op/bytes/code/ok/
	// error/xml snippet). Beda dari logger yang nulis raw EPP XML stream.
	// Dipakai parseResponse — tiap command EPP otomatis logged tanpa perlu
	// boilerplate per call-site. Debug trace error upstream (misal
	// "Transaction rolled back") tanpa aktifkan DebugXML.
	opsLogger *slog.Logger
	opsFile   *os.File
	client    *epp.Client
	connMu    sync.Mutex // serialize commands (EPP not concurrent)
	loggedIn  bool
}

// Package-level fallback supaya helper parseResponse (yang nggak terima
// *Client) tetap bisa log. Di-set oleh New() sekali — multi-instance
// hanya terpakai yang terakhir, acceptable karena biasanya satu client
// per proses.
var defaultOpsLogger *slog.Logger

// New — construct client. Belum connect — call Connect() explicitly saat
// startup atau lazy on-first-use.
func New(cfg Config) (*Client, error) {
	if cfg.Host == "" || cfg.Username == "" || cfg.Password == "" {
		return nil, fmt.Errorf("epp: Host + Username + Password wajib")
	}
	if cfg.Port == 0 {
		cfg.Port = 700
	}
	if cfg.Timeout == 0 {
		cfg.Timeout = 30 * time.Second
	}
	if cfg.KeepAliveInterval == 0 {
		cfg.KeepAliveInterval = 5 * time.Minute
	}
	if cfg.MaxRetries == 0 {
		cfg.MaxRetries = 2
	}
	c := &Client{cfg: cfg}
	// Setup file logger — library will log XML request/response + connection
	// events di Debug level. File di-open append supaya multi-restart tidak
	// truncate history. Level Debug bikin XML dump keluar (lihat conn.go
	// line 295/322 di upstream library).
	if cfg.LogFile != "" {
		if err := os.MkdirAll(filepath.Dir(cfg.LogFile), 0o755); err != nil {
			return nil, fmt.Errorf("epp: mkdir log dir: %w", err)
		}
		// 0o600 — file berisi EPP XML frames dengan contact PII (email,
		// phone, NIK dari WHOIS/register). Restrict ke owner-only.
		f, err := os.OpenFile(cfg.LogFile, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
		if err != nil {
			return nil, fmt.Errorf("epp: open log file: %w", err)
		}
		encCfg := zap.NewDevelopmentEncoderConfig()
		encCfg.EncodeTime = zapcore.ISO8601TimeEncoder
		core := zapcore.NewCore(
			zapcore.NewConsoleEncoder(encCfg),
			zapcore.AddSync(f),
			zapcore.DebugLevel,
		)
		c.logger = zap.New(core)
		c.logFile = f

		// Dedicated structured ops log — 1 baris JSON per EPP operation
		// (op/bytes/code/ok/xml snippet). Co-located dengan cfg.LogFile
		// supaya ops/debug file sejajar. Nama file: <base>-ops.jsonl.
		// Dipakai parseResponse auto-emit — nggak butuh enable DebugXML.
		opsPath := strings.TrimSuffix(cfg.LogFile, filepath.Ext(cfg.LogFile)) + "-ops.jsonl"
		opsFile, err := os.OpenFile(opsPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
		if err != nil {
			return nil, fmt.Errorf("epp: open ops log: %w", err)
		}
		c.opsFile = opsFile
		c.opsLogger = slog.New(slog.NewJSONHandler(opsFile, &slog.HandlerOptions{
			Level: slog.LevelDebug,
		}))
		defaultOpsLogger = c.opsLogger
	}
	return c, nil
}

// Connect — establish TCP+TLS + EPP login. Idempotent: kalau sudah connected
// dan logged in, no-op.
func (c *Client) Connect(ctx context.Context) error {
	c.connMu.Lock()
	defer c.connMu.Unlock()
	if c.loggedIn && c.client != nil && c.client.IsConnected() {
		return nil
	}
	return c.connectLocked(ctx)
}

// connectLocked — assumes lock held.
func (c *Client) connectLocked(ctx context.Context) error {
	// Build TLS config berdasarkan opsi credentials.
	// TLS 1.2 minimum — PANDI EPP sandbox biasanya belum support 1.3.
	// Naikkan ke 1.3 kalau operator konfirmasi registry mendukung.
	tlsCfg := &tls.Config{
		MinVersion:         tls.VersionTLS12,
		InsecureSkipVerify: c.cfg.InsecureSkipVerify, // #nosec G402 — opt-in per config
	}
	if c.cfg.CertFile != "" && c.cfg.KeyFile != "" {
		cert, err := tls.LoadX509KeyPair(c.cfg.CertFile, c.cfg.KeyFile)
		if err != nil {
			return fmt.Errorf("epp: load client cert: %w", err)
		}
		tlsCfg.Certificates = []tls.Certificate{cert}
	}

	opts := []epp.ClientOption{
		epp.WithTLSConfig(tlsCfg),
		epp.WithTransactionID("api-registry"),
		epp.WithRetry(c.cfg.MaxRetries, 500*time.Millisecond),
	}
	if c.cfg.InsecureSkipVerify {
		opts = append(opts, epp.WithInsecureSkipVerify(true))
	}
	// Pipe verbose EPP log ke file kalau LogFile set. Library logs pretty-XML
	// request + response di Debug level.
	if c.logger != nil {
		opts = append(opts, epp.WithLogger(c.logger))
	}

	client, err := epp.NewClient(opts...)
	if err != nil {
		return fmt.Errorf("epp: new client: %w", err)
	}

	addr := net.JoinHostPort(c.cfg.Host, fmt.Sprint(c.cfg.Port))
	if _, err := client.Connect(addr); err != nil {
		return fmt.Errorf("epp: connect %s: %w", addr, err)
	}
	if _, err := client.Login(ctx, c.cfg.Username, c.cfg.Password); err != nil {
		_ = client.Close()
		return fmt.Errorf("epp: login: %w", err)
	}
	c.client = client
	c.loggedIn = true
	return nil
}

// ensureConnected — connect+login kalau session belum ada. Dipanggil sebelum
// setiap command supaya self-heal saat conn drop.
func (c *Client) ensureConnected(ctx context.Context) error {
	if c.client != nil && c.client.IsConnected() && c.loggedIn {
		return nil
	}
	if c.client != nil {
		_ = c.client.Close()
	}
	c.loggedIn = false
	return c.connectLocked(ctx)
}

// endCommand — dipanggil setelah setiap command (via defer). Kalau
// PerCommandSession mode aktif, logout + close TCP supaya session berikutnya
// full fresh (connect + login ulang). Aman dipanggil dengan connMu held.
func (c *Client) endCommand() {
	if !c.cfg.PerCommandSession || c.client == nil {
		return
	}
	if c.loggedIn {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		_, _ = c.client.Logout(ctx)
		cancel()
	}
	_ = c.client.Close()
	c.client = nil
	c.loggedIn = false
}

// Close — logout + close TCP session saja. Log file tetap open — pakai
// Shutdown() untuk cleanup penuh (dipanggil sekali di process exit).
// Idempotent.
func (c *Client) Close() error {
	c.connMu.Lock()
	defer c.connMu.Unlock()
	if c.client == nil {
		return nil
	}
	if c.loggedIn {
		// Best-effort logout — timeout kalau conn stuck.
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		_, _ = c.client.Logout(ctx)
		cancel()
	}
	err := c.client.Close()
	c.client = nil
	c.loggedIn = false
	return err
}

// Shutdown — full cleanup: close session + flush + close log file. Dipanggil
// sekali di process exit.
func (c *Client) Shutdown() error {
	err := c.Close()
	c.connMu.Lock()
	defer c.connMu.Unlock()
	if c.logger != nil {
		_ = c.logger.Sync()
	}
	if c.logFile != nil {
		_ = c.logFile.Close()
		c.logFile = nil
	}
	if c.opsFile != nil {
		_ = c.opsFile.Close()
		c.opsFile = nil
	}
	return err
}

// Ping — kirim EPP hello frame untuk cek liveness. Dipakai /readyz probe.
func (c *Client) Ping(ctx context.Context) error {
	c.connMu.Lock()
	defer c.connMu.Unlock()
	if err := c.ensureConnected(ctx); err != nil {
		return err
	}
	_, err := c.client.Hello(ctx)
	return err
}

// DebugEnabled reports whether verbose XML dumping is on. Caller methods
// (host.go, domain.go, contact.go) wrap EPP calls with DumpRequest/
// DumpResponse when this is true.
func (c *Client) DebugEnabled() bool { return c.cfg.DebugXML }

// DumpRequest marshals the request frame to XML and emits it via slog.Info.
// No-op kalau DebugXML off. Op is a short tag (mis. "domain:update") untuk
// korelasi antar entries.
//
// WARNING: output bisa include credentials + PII (contact details, authInfo).
// JANGAN enable di prod — toggle lewat EPP_DEBUG_XML env sementara.
func (c *Client) DumpRequest(op string, frame any, extra ...any) {
	if !c.cfg.DebugXML {
		return
	}
	raw, err := xml.MarshalIndent(frame, "", "  ")
	attrs := []any{"op", op}
	attrs = append(attrs, extra...)
	if err != nil {
		attrs = append(attrs, "marshal_error", err)
		slog.Warn("EPP XML request dump (marshal failed)", attrs...)
		return
	}
	attrs = append(attrs, "xml", string(raw))
	slog.Info("EPP XML request", attrs...)
}

// DumpResponse logs the raw response bytes + any upstream error. No-op
// kalau DebugXML off.
func (c *Client) DumpResponse(op string, raw []byte, err error, extra ...any) {
	if !c.cfg.DebugXML {
		return
	}
	attrs := []any{"op", op, "bytes", len(raw)}
	attrs = append(attrs, extra...)
	if err != nil {
		attrs = append(attrs, "error", err.Error())
	}
	if len(raw) > 0 {
		attrs = append(attrs, "xml", string(raw))
	}
	slog.Info("EPP XML response", attrs...)
}

// parseResponse — helper: parse raw XML ke Response envelope + return error
// kalau EPP result code >= 2000. `resultData`/`extension` bisa nil kalau
// caller tidak butuh typed data.
//
// Side effect: tiap panggilan auto-emit structured log entry ke
// defaultOpsLogger (kalau sudah di-init via New() dengan LogFile != "").
// Field: op/bytes/code/ok/msg/xml-snippet/error. Jadi debugging error
// upstream (misal "Transaction rolled back") langsung ter-trace tanpa
// perlu aktifkan DebugXML — selalu masuk ke logs/epp-ops.jsonl.
func parseResponse(raw []byte, op string, resultData, extension any) (*frames.Response, error) {
	resp := &frames.Response{
		ResultData: resultData,
		Extension:  extension,
	}
	if err := xml.Unmarshal(raw, resp); err != nil {
		logEPPResponse(op, raw, 0, "", false, err)
		return nil, fmt.Errorf("epp: unmarshal response (%s): %w", op, err)
	}
	if len(resp.Result) == 0 {
		logEPPResponse(op, raw, 0, "", false, errors.New("missing <result>"))
		return resp, fmt.Errorf("epp: response missing <result> (%s)", op)
	}
	r := resp.Result[0]
	ok := r.Code < 2000
	var retErr error
	if !ok {
		retErr = &EPPResponseError{Code: r.Code, Message: r.Message, Op: op}
	}
	logEPPResponse(op, raw, r.Code, r.Message, ok, retErr)
	return resp, retErr
}

// logEPPResponse — write structured log entry per EPP operation. No-op kalau
// defaultOpsLogger belum di-init (unit test tanpa LogFile).
//
// Field:
//   - op: "contact:create" / "domain:info" / dst
//   - bytes: ukuran raw XML response
//   - code: EPP result code (1000-2500) — 0 kalau unmarshal gagal duluan
//   - msg: human-readable message dari <msg> di response
//   - ok: true kalau code < 2000
//   - xml: snippet raw XML (cap 2KB supaya log file tidak membengkak)
//   - error: unmarshal/parse error atau EPPResponseError
//
// Level: Error kalau !ok atau err != nil, Info kalau sukses.
func logEPPResponse(op string, raw []byte, code int, msg string, ok bool, err error) {
	if defaultOpsLogger == nil {
		return
	}
	snippet := string(raw)
	if len(snippet) > 2048 {
		snippet = snippet[:2048] + "…(truncated)"
	}
	attrs := []slog.Attr{
		slog.String("op", op),
		slog.Int("bytes", len(raw)),
		slog.Int("code", code),
		slog.String("msg", msg),
		slog.Bool("ok", ok),
		slog.String("xml", snippet),
	}
	if err != nil {
		attrs = append(attrs, slog.String("error", err.Error()))
	}
	level := slog.LevelInfo
	if !ok || err != nil {
		level = slog.LevelError
	}
	defaultOpsLogger.LogAttrs(context.Background(), level, "EPP response", attrs...)
}
