# Urja Meter API

A read-only API over the **Urja Meter Ops** portal. It logs in, pulls data through the portal's signed bulk export, cleans and cross-checks it, and serves it as a versioned JSON API with an OpenAPI spec and Swagger UI — so you never have to touch the original portal.

- **How the portal works (reverse-engineered):** [PROTOCOL.md](PROTOCOL.md)
- **API spec:** [openapi.json](openapi.json), browsable at `http://localhost:3000/docs` when running
- **Reflection:** [REFLECTION.md](REFLECTION.md)

## Install, configure, run

Requires **Node.js 20.6+** (uses built-in `--env-file` and `fetch`).

```bash
npm install
cp .env.example .env     # add PORTAL_EMAIL and PORTAL_PASSWORD (from the assignment email)
npm run dev              # http://localhost:3000, docs at /docs
```

`/health` answers immediately; data routes return `503 not_ready` until the first background sync finishes (a few seconds), then readings are warmed in the background.

```bash
npm test                 # offline tests (fixtures only, no portal needed)
npm run typecheck
npx tsx --env-file=.env scripts/probe.ts   # live smoke test against the portal
```

## Sample request

```bash
curl "localhost:3000/v1/meters?status=faulty,decommissioned&feeder=F-001"   # faulty/decommissioned on a feeder
curl "localhost:3000/v1/meters?lat=26.9124&lng=75.7873&radiusKm=2"          # meters near a point, nearest first
curl "localhost:3000/v1/meters/J100031"                                     # one meter + transformer + issues
curl "localhost:3000/v1/meters/J100031/readings?from=2026-06-30T00:00:00%2B05:30"
```

Readings come back as half-hourly intervals with derived consumption (the portal only sends cumulative registers), e.g. `{ "timestamp": "2026-06-24T00:00:00+05:30", "kwh": 32129.36, "kwhDelta": 0.39, "powerFactor": 0.929, "flags": [] }` plus a summary (`totalKwh`, voltage min/max/avg, flagged count).

## Endpoints

| Method & path | What it returns |
|---|---|
| `GET /health` | Status, last sync time, meter count |
| `GET /v1/meters` | Filter by `q`, `status`, `make`, `phase`, `installType`, `build`, any hierarchy level (`zone`…`dt`), or `lat`/`lng`/`radiusKm`; paginated `limit`/`offset` |
| `GET /v1/meters/{meterId}` | One meter, its transformer, its data-quality issues |
| `GET /v1/meters/{meterId}/readings` | Intervals with `kwhDelta`, `kvahDelta`, `powerFactor`, `flags`, and a summary; `from`/`to` filter |
| `GET /v1/transformers` `/{code}` | Transformer list (filter `feeder`) / one DT with meters and status breakdown |
| `GET /v1/hierarchy` | Network tree zone → circle → division → subdivision → substation → feeder → DT; `depth` to trim |
| `GET /v1/data-quality` | Every repair/conflict found while cleaning; filter by `type` |
| `GET /v1/stats` | Fleet counts by status/make/phase/install type/build; serial-prefix vs make cross-tab |
| `GET /openapi.json`, `GET /docs` | The spec, and Swagger UI |

**Conventions.** Responses are `{ "data": … }` (plus `page` on lists); errors are `{ "error": { "code", "message" } }` with `400 invalid_query`, `404 not_found`, `502 portal_unavailable`, `503 not_ready`. Filters are case-insensitive and comma-separated; timestamps are ISO 8601 `+05:30`.

## How it's built

```
src/
├── portal/   everything that knows how the PORTAL works (login, HMAC signing, parsing)
├── sync/     portal data → clean dataset (normalize, paginate, concurrency pool)
├── store.ts  in-memory snapshot + data/snapshot.json on disk
└── api/      everything that knows how OUR API works (routers, validation, errors)
```

Dependencies point one way: `portal → sync → store → api → app`. If the portal changes, only `portal/` changes; if our API changes, only `api/` changes.

**Data flow:** log in (`POST /login`, a SvelteKit form action) → fetch signing secret (`/portal/keys`) → signed `/portal/export` returns all 403 meters with hierarchy + location in one request, `/portal/dts` the transformer list → normalize and cross-check → serve from memory. Readings (`/portal/meters/{id}/energy`) are fetched on demand, cached, and warmed in the background 4 at a time. Metadata re-syncs every 6 hours and on start-up; a stale snapshot on disk is served if the portal is down.

## Assumptions

- Portal timestamps (`DD/MM/YYYY HH:mm`) carry no zone → assumed IST (`+05:30`), Jaipur utility.
- `kwh`/`kvah` are cumulative registers every 30 minutes → consumption is the diff of consecutive readings; the portal serves a fixed ~7-day window and accepts no date range.
- The data is a static snapshot (latest reading 30/06/2026) → long 6-hour cache lifetimes are safe.
- `/portal/dts` is authoritative for DT names/feeders/capacity; meter-embedded names are checked against it.
- Codes may be unique only within their parent (D-01 sits under three circles) → hierarchy keyed by full path.
- "Voltage out of range" = outside 230 V ± 6% — an assumption, configurable in `readings.ts`.
- Status values are passed through as the portal names them.

## Design decisions & trade-offs

- **Signed bulk export over page-crawling** — 1 request instead of ~1,233, with hierarchy + location included; but we depend on reimplementing the portal's signing (fails loudly with 401 if it changes).
- **In-memory store + JSON snapshot on disk** — simplest thing at ~400 meters, restarts don't hit the portal; doesn't scale indefinitely (readings in memory break first, around 50k–100k meters; then SQLite/Postgres + PostGIS + a time-series store).
- **Repair blank fields only when unambiguous, log everything** — nothing invented; `/v1/data-quality` exposes every change. Ambiguous blanks stay null.
- **Canonical names in responses, others kept as `aliases`** — consistent for consumers; raw values visible in the data-quality log.
- **Readings on demand + cache + background warm-up** — no bulk endpoint exists; memory-only means a restart refetches.
- **Express + hand-written `openapi.json`** — simple, no schema library; drift guarded by a test that fails if spec and served routes differ.
- **Stale data over no data** — portal down at start-up still serves the last snapshot; `/health` shows `syncedAt`.
- **503 until first sync finishes** — `/health` stays instant; consumers get a predictable not-ready signal instead of empty data.

Robustness: 1-hour cookie sessions re-logged a minute early (and on any 401/403/login-redirect, shared across concurrent requests); retries with backoff + `Retry-After` on network/429/5xx; 15 s timeouts; signing timestamps use the portal's own clock when local skew > 30 s; one failing meter never stops the warm-up.

## What I intentionally skipped

- A web client — time went into protocol discovery and data quality instead.
- Auth on this API — local, read-only; in production it'd sit behind the org's gateway/SSO.
- The portal's search/`geo`/`__data.json` routes — the export covers all of them (still documented in PROTOCOL.md).
- V(Y)/V(B) voltages — the portal only exposes R-phase.
- Write operations, Docker, rate limiting on our own API.

## What I'd improve with more time

1. Anomaly endpoint — flag meters whose status contradicts telemetry (J100000 is Decommissioned, J100031 Faulty, both still reporting normal readings).
2. Transformer loading — summed demand vs kVA capacity per DT to surface overloads.
3. Persist readings (SQLite) so restarts don't refetch.
4. Nightly live contract test (the probe script) to catch portal changes early.
5. A small web client: meter map, hierarchy explorer, consumption charts.
6. Structured logs/metrics for sync duration, portal errors, cache hit rate.

## Reflection
See [REFLECTION.md](REFLECTION.md).
