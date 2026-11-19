# api-registry

Internal service untuk **domain lifecycle + EPP execution**. Konsumen tunggal:
web builder API (via internal HTTP + HMAC signature).

## Scope

- **✅ In scope**: domain check / register / renew / retry / cancel / status,
  nameserver update, contact update, WHOIS proxy, domain info, audit trail
  (jobs), observability (metrics, request logs, health/ready probes).
- **❌ NOT in scope**: payment, invoice, wallet, promo, zone catalog, user
  management, PPN — semua ini di **web builder**.

Pure "domain execution engine". Business logic (siapa boleh register apa,
harga berapa, dari mana dana) full di web builder.

## Provider architecture

Interface [`provider.Provider`](internal/provider/types.go) — abstract layer
di atas registrar operations. Dua implementasi:

| Mode | Status | Cara kerja |
|---|---|---|
| `pandi_wrapper` | ✅ Fase 1a | HTTP proxy ke registrar-api PANDI (reference implementation — scaffolding untuk arsitektur decoupling) |
| `epp_direct` | ✅ Fase 1b | Native EPP client (TCP+TLS) langsung ke registry PANDI OT&E / production via [`pandi-id/epp-pandi-client`](https://github.com/pandi-id/epp-pandi-client). **Zero dependency ke registrar-api PANDI — inilah mode yang customer registrar install.** |

Swap via env `PROVIDER_MODE=pandi_wrapper` atau `epp_direct`. Consumer
(web builder API) tidak berubah — kontrak API-registry tetap sama.

**EPP direct capabilities**: check (single + bulk), register, renew,
info, WHOIS (TCP:43 + EPP fallback), nameserver update (add/rem diff),
contact read/update, contact create-on-register (idempotent). Wallet +
promo + document upload TIDAK di provider ini (delegate ke web builder
side — sesuai arsitektur SaaS platform). List-domains + transfer +
DNSSEC belum di Provider interface.

**Decorator `Instrumented`** wrap tiap provider auto-record metrics per
operation (success/fail/duration) — no manual instrumentation di handler.

## Quick start (dev)

```bash
cd apps/api-registry
cp .env.example .env
# Edit .env: isi PANDI_API_URL + credentials (PANDI_API_KEY atau email/pass)
go run ./cmd/server
```

Verify:

```bash
curl http://localhost:5000/healthz
# → { "data": { "ok": true, "provider": "pandi_wrapper", "caps": {...} } }

curl http://localhost:5000/version
# → { "data": { "version": "dev", "commit": "unknown", "build_time": "...", ... } }

curl http://localhost:5000/metrics
# Prometheus text exposition — scrape-able via Prom/Grafana
```

## Deploy (production)

Build binary dengan version metadata:

```bash
go build -ldflags "\
  -X main.version=$(git describe --tags --always) \
  -X main.commit=$(git rev-parse HEAD) \
  -X main.buildTime=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  -o api-registry ./cmd/server
```

Atau pakai Docker:

```bash
docker build -t webbuilder/api-registry:latest .
```

Sudah wired di [`infra/docker-compose.yml`](../../infra/docker-compose.yml)
sebagai service `api-registry`. Env var pakai `EPP_*` untuk direct mode +
`API_REGISTRY_*` untuk konfigurasi service (lihat
[`infra/.env.example`](../../infra/.env.example)).

## Endpoints

### Infra (no auth, no rate limit)
- `GET /healthz` — liveness (proc up + provider constructed)
- `GET /readyz` — readiness (ping upstream, 503 kalau unreachable)
- `GET /version` — version + commit + build time
- `GET /metrics` — Prometheus text exposition
- `GET /openapi.json` — machine-readable API contract (OpenAPI 3.1)

### Webhook relay (no HMAC dari kita — upstream signature verify)
- `POST /webhooks/registrar` — terima dari registrar-api upstream, verify
  signature-nya, forward ke web builder dengan HMAC api-registry sendiri.
  Kalau `WEBBUILDER_WEBHOOK_URL` kosong, audit-only mode.

### `/v1/*` (HMAC auth required)

**Domain lifecycle** — tracked di jobs store (audit + idempotency):
- `GET  /v1/domains` — list domain per user (query: external_user_id, page, per_page)
- `POST /v1/domains/check` — availability + pricing per zone (single SLD)
- `POST /v1/domains/bulk-check` — batch check multi-domain (max 50)
- `POST /v1/domains/register` — register domain (async, return `job_id`)
- `POST /v1/domains/:name/renew` — renew (async)
- `GET  /v1/domains/register/:job_id/status` — poll upstream status
- `POST /v1/domains/register/:job_id/retry` — retry failed job
- `POST /v1/domains/register/:job_id/cancel` — cancel pending
- `GET  /v1/domains/:name/info` — registry state (EPP domain:info di mode `epp_direct`)

**Nameserver**:
- `GET  /v1/domains/:name/nameservers`
- `POST /v1/domains/:name/nameservers` — body `{ nameservers: [...] }` (min 2, max 13)

**Contact**:
- `GET   /v1/contacts/:id`
- `PATCH /v1/contacts/:id` — direct contact update (any domain sharing this contact)
- `PATCH /v1/domains/:name/contact` — domain-scoped contact update

**WHOIS**:
- `GET /v1/whois?domain=<name>`

**Documents** — TIDAK di api-registry. Upload + verifikasi KTP/NPWP dilakukan
di web builder (storage S3/MinIO, metadata di web builder DB, verification
via admin panel workflow). api-registry murni EPP-to-registry.

**Jobs audit (read-only)**:
- `GET /v1/jobs?kind=&status=&domain=&external_user_id=&limit=&offset=` — list
- `GET /v1/jobs/:id` — detail (request/response body, upstream_job_id, error, duration)

## Authentication (HMAC)

All `/v1/*` endpoints require HMAC signature. Header:

```
X-Timestamp: <unix seconds>
X-Signature: sha256=<hex(hmac_sha256(secret, TS + "." + METHOD + PATH + "." + BODY))>
```

Timestamp fresh window: ±5 menit. Cegah replay + tampered body.

Kalau `INTERNAL_HMAC_SECRET` kosong (dev), middleware skip — jangan pakai di prod.

**Consumer**: pakai [`client.Client`](client/client.go) SDK — signing di-handle
otomatis:

```go
c, _ := client.New(client.Config{
    BaseURL: os.Getenv("API_REGISTRY_URL"),
    Secret:  os.Getenv("API_REGISTRY_HMAC_SECRET"),
})
res, err := c.CheckDomain(ctx, client.CheckRequest{Domain: "myshop"})
```

## Middleware pipeline

Request masuk → melewati stack ini (dalam urutan):

1. **Recover** — panic → 500 JSON error
2. **RequestID** — set `X-Request-ID` (correlation tracing)
3. **AccessLog** — log method/path/status/duration + record metric
4. **Concurrency** — semaphore `MAX_CONCURRENT` (default 20). Kalau full,
   wait `REQUEST_TIMEOUT`, else 429. Skip untuk healthz/readyz/metrics/jobs.
5. **HMAC** (only `/v1/*`) — verify signature + timestamp freshness

## Provider decorator chain

Provider concrete di-wrap 2 decorator sebelum di-inject ke handler:

```
Base (PandiWrapper / EPP direct / ...)
  ↓
Resilience (retry + circuit breaker per operation) — opsional via env
  ↓
Instrumented (metrics counter + duration)
  ↓
Handler
```

- **Resilience** — transient error (network/5xx/429) retry dengan
  exponential backoff + jitter, circuit breaker open setelah N consecutive
  fail. Deterministic error (validation/not_found/conflict) fail-fast.
  Multipart upload SKIP retry (bandwidth waste). Disable via
  `RESILIENCE_ENABLED=false` untuk debug.
- **Instrumented** — auto-record `api_registry_provider_calls_total` +
  duration per operation × result label.

## Observability

**Metrics dikoleksi otomatis**:
- `api_registry_requests_total{method, path, status}` — HTTP counter
- `api_registry_request_duration_ms_sum{path}` — duration sum (avg = sum / count)
- `api_registry_provider_calls_total{provider, operation, result}` — upstream call breakdown per result (success / not_found / validation / conflict / rate_limit / upstream_error / capability_missing)
- `api_registry_provider_call_duration_ms_sum{provider, operation}` — upstream latency sum
- `api_registry_circuit_open_total{provider, operation}` — request rejected karena circuit open (fast-fail)
- `api_registry_retry_exhausted_total{provider, operation}` — provider call gagal setelah retry exhausted
- `api_registry_webhooks_total{result}` — webhook receive by result (invalid_signature / verified_no_forward / forwarded / forward_error / forward_reject)

**Log**: JSON structured (stdout), level via `LOG_LEVEL=debug|info|warn|error`.
`request_id` di setiap access log — bisa correlate cross-service kalau
consumer forward header `X-Request-ID`.

## Graceful shutdown

Signal SIGTERM/SIGINT trigger drain — Fiber ShutdownWithContext(30s) tunggu
inflight request selesai. Log `shutdown selesai` sebelum exit clean.

Cocok untuk K8s / Docker Compose orchestrator (SIGTERM sebelum SIGKILL).

## Environment variables

Lihat [.env.example](.env.example). Yang wajib per mode:

**`pandi_wrapper`**:
- `PANDI_API_URL`
- `PANDI_API_KEY` **atau** (`PANDI_EMAIL` + `PANDI_PASSWORD`)

**`epp_direct`**:
- `EPP_HOST` (mis. `epp1.pandi.id`)
- `EPP_PORT` (default 700)
- `EPP_USER` + `EPP_PASSWORD` (dari PANDI onboarding)
- `EPP_CERT_FILE` + `EPP_KEY_FILE` (client TLS)
- `EPP_CA_FILE` (opsional, registry CA)
- `EPP_INSECURE_SKIP_VERIFY=true` untuk dev/OT&E (jangan pakai di prod)
- `EPP_KEEPALIVE_INTERVAL=5m` (hello frame untuk cegah session drop)

**Common**:
- `INTERNAL_HMAC_SECRET` (min 32 char di prod — generate `openssl rand -hex 32`)
- `MAX_CONCURRENT` (default 20)
- `REQUEST_TIMEOUT` (default 30s)

**Webhook relay** (opsional):
- `WEBHOOK_UPSTREAM_SECRET` — HMAC secret dari registrar-api (verify inbound)
- `WEBBUILDER_WEBHOOK_URL` — target forward (kosong = audit-only, no forward)
- `WEBBUILDER_WEBHOOK_SECRET` — shared secret dengan web builder untuk sign
- `WEBHOOK_FORWARD_TIMEOUT` (default 10s)

## Directory structure

```
apps/api-registry/
├── cmd/server/main.go              # binary entry (wiring, listen, shutdown)
├── client/                         # Go SDK untuk consumer (web builder API)
│   ├── client.go                   # HTTP transport + HMAC signing
│   ├── types.go                    # DTO mirror internal/provider
│   └── methods.go                  # typed method per endpoint
├── internal/
│   ├── config/                     # env loader
│   ├── httpx/                      # response envelope helpers
│   ├── security/                   # HMAC middleware
│   ├── middleware/                 # request ID, access log, rate limit
│   ├── metrics/                    # Prometheus-style counter registry
│   ├── provider/
│   │   ├── types.go                # Provider interface + DTO
│   │   ├── errors.go               # sentinel errors
│   │   ├── instrumented.go         # metrics decorator
│   │   ├── pandi_client.go         # HTTP transport ke registrar-api
│   │   └── pandi_impl.go           # PandiWrapperProvider
│   ├── jobs/                       # audit + idempotency (in-memory MVP)
│   ├── domains/handler.go          # HTTP handler: domain lifecycle
│   ├── hosts/handler.go            # HTTP handler: nameserver
│   ├── contacts/handler.go         # HTTP handler: contact
│   ├── whois/handler.go            # HTTP handler: WHOIS
│   └── epp/                        # EPPDirectProvider (pandi-id/epp-pandi-client)
├── go.mod / go.sum
├── Dockerfile                      # multi-stage build (Alpine, 5000)
├── docker-compose.snippet.yml      # ready-to-paste service definition
├── .env.example
└── README.md
```

## Testing

```bash
go test -race ./...
```

Coverage (55+ tests, all `-race` safe):
- `internal/jobs` — memory store CRUD, idempotency, eviction, terminal states (8)
- `internal/security` — HMAC happy path, tampered body, expired ts, missing headers, skip healthz, empty secret (6)
- `internal/metrics` — counter dedup, label ordering stable, Prometheus format, escape (4)
- `internal/provider` — PANDI wrapper integration terhadap httptest mock upstream (6)
- `internal/webhooks` — verify HMAC, tampered body, forward + independent signature check (7)
- `internal/domains` — handler via fake provider: check, register w/ job tracking, provider error propagate, list, cancel, capability_missing (9)
- `internal/hosts` — nameserver get/update, validation min 2 / max 13 (4)
- `internal/contacts` — get by ID, update, invalid ID, missing name/email (5)
- `internal/whois` — missing query, success, not found mapping (3)
- `client` — signing correctness, error envelope, no-secret (3)

## Roadmap

- [x] Fase 1a: scaffolding + PandiWrapperProvider (MVP wrapper)
- [x] Fase 1a: middleware (RequestID, AccessLog, Concurrency)
- [x] Fase 1a: observability (metrics, healthz/readyz/version, graceful shutdown)
- [x] Fase 1a: jobs audit + idempotency
- [x] Fase 1a: client SDK
- [x] Fase 1a: unit test coverage core packages
- [x] Fase 1a: integration test dengan httptest mock upstream
- [x] Fase 1a: webhook relay (registrar-api → api-registry → web builder)
- [x] Fase 1a: bulk check + list domains + OpenAPI spec
- [x] Fase 1a: handler-level test coverage semua module
- [x] **Arsitektur boundary cleanup**: hapus document/invoice/pricing/zone/NIK dari api-registry (semua di web builder side per arsitektur SaaS)
- [x] Fase 1a: docker compose integration di infra/
- [x] Fase 1a: resilience decorator (retry + circuit breaker)
- [x] Fase 1a: Kubernetes manifests + runbook + provider integration guide
- [x] **Fase 1b**: EPP direct client integration via [`pandi-id/epp-pandi-client`](https://github.com/pandi-id/epp-pandi-client)
  - [x] Client wrapper + connection pool + auto-reconnect
  - [x] `EPPDirectProvider` — check/register/renew/info/whois flows
  - [x] EPP result code → sentinel error mapping
  - [x] Config env + wire main.go untuk `PROVIDER_MODE=epp_direct`
  - [x] `UpdateNameservers` (add/rem diff) + `UpdateDomainContact` frame builders
  - [x] Contact create/read/update via deterministic NIC handle
  - [x] WHOIS TCP:43 client + parser + EPP `domain:info` fallback
  - [x] Unit test: error mapping + response parsing + capability shape + validation guards
  - [ ] Follow-up: integration test terhadap PANDI OT&E sandbox real (butuh credentials)
- [x] **Fase 1c**: web builder full-switch ke api-registry — [apps/api/internal/registrar/apiregistry_adapter.go](../api/internal/registrar/apiregistry_adapter.go)
  - [x] Config: `API_REGISTRY_URL` + `API_REGISTRY_HMAC_SECRET` + `API_REGISTRY_TIMEOUT`
  - [x] Semua EPP-native call route ke api-registry: `CheckDomain`, `Whois`, `GetNameservers`, `UpdateNameservers`, `RegisterDomainDirect`, `RenewDomainDirect`
- [x] **Fase 3**: legacy registrar-api PANDI proxy dihapus di web builder — full self-sufficient (payment/invoice/wallet/document lokal di web builder + EPP lewat api-registry)
- [ ] Fase 2a: async job runner (Asynq/Redis) — swap `MemoryStore`
- [ ] Fase 2b: multi-registry support (Verisign untuk .com, dsb.)

## Documentation

- [`docs/add-provider.md`](docs/add-provider.md) — guide tambah provider baru
  (Verisign, Namecheap, custom EPP) tanpa touch handler/consumer
- [`docs/runbook.md`](docs/runbook.md) — troubleshooting + alert playbook
  untuk on-call
- [`deploy/kubernetes/README.md`](deploy/kubernetes/README.md) — K8s
  deployment guide + operational procedures

## Related

- Web builder API (consumer): [`../api`](../api)
- Plan document: [`../../plan-saas-registrar-platform.md`](../../plan-saas-registrar-platform.md)
- Phase 1 tasks: [`../../plan-phase-1-webbuilder-selfsufficient.md`](../../plan-phase-1-webbuilder-selfsufficient.md)
