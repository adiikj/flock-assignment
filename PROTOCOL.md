# How the Urja Meter Ops portal works

Everything here was discovered as a normal logged-in user: browser DevTools (Network, Initiator, Sources), the portal's own client-side JavaScript, and read-only requests. Nothing was attacked or modified. Items marked **(unverified)** are reasonable inferences we didn't confirm.

## 1. What it is

- A **SvelteKit** app (`X-Sveltekit-Page` header, `/_app/immutable/...` assets, `__data.json` routes) with **Better Auth** for sessions.
- **HTML pages** (`/meters`, `/meters/{id}`, `/transformers`) are a thin client. All data comes from a **JSON API under `/portal/...`**.
- **Visible pages:** Meters (list, search, detail) and Transformers (list, plus an "Export all meters" button). "Ops Desk" in the header is static text, not a link.
- **The data is a static snapshot.** The latest reading for every meter we checked is `30/06/2026 23:30`.

## 2. Authentication

| Step | Detail |
|---|---|
| Login | `POST /login` (a SvelteKit form action), `content-type: application/x-www-form-urlencoded`, body `email=…&password=…`, with `accept: application/json` and an `Origin` header |
| Response | HTTP 200 with a small JSON action result, plus `Set-Cookie: __Secure-better-auth.session_token=…; Max-Age=3600; Path=/; HttpOnly; Secure; SameSite=Lax` |
| Session | Cookie-based; **expires after 1 hour**. No refresh token. |
| Unauthenticated API call | `401` with a JSON body (seen on `/portal/dts`) |
| Unauthenticated page | The HTML for `/transformers` loads; its data call gets 401 and the app sends you to `/login`. Access control is enforced by the API, not the pages. |

Quirks:
- **(unverified)** SvelteKit returns failed form actions as HTTP 200 with `{"type":"failure"}`. The presence of the session cookie is therefore the reliable login-success signal; our client relies on that.
- **(unverified)** SvelteKit rejects cross-origin form posts, so non-browser clients must send `Origin`.

## 3. Endpoints

| Endpoint | Auth | Returns |
|---|---|---|
| `GET /portal/meters/search?q=&page=N` | cookie | `{data:[{meterId, serialNo, make, phaseType, installStatus, dtCode}]}`, 20 per page, pages start at 1 |
| `GET /portal/dts?page=N` | cookie | `{data:[{code, name, feederCode, capacityKva}], total, page, pageSize}`; 40 DTs over 2 pages |
| `GET /portal/meters/{id}/geo` | cookie | `{data:{latitude, longitude}}` (strings) |
| `GET /portal/meters/{id}/energy` | cookie | `{data:[{timestamp, kwh, kvah, voltR}]}` (all strings); ~7 days at 30-minute intervals; no query parameters |
| `GET /meters/{id}/__data.json?x-sveltekit-invalidated=001` | cookie | SvelteKit page data in **devalue** format (flattened array, values referenced by index and deduplicated); contains the nameplate and hierarchy |
| `GET /portal/keys` | cookie | `{data:{signingSecret}}` |
| `GET /portal/export?page=N` | cookie **and signature** | `{data:[…all meters…], total}`. Each row has the nameplate, `installType`, `build`, the full 7-level `hierarchy` (name + code) and `geo:{lat, lng}` (numbers). All 403 meters arrive in page 1. |

No endpoint sends caching headers (`ETag`, `Cache-Control`).

## 4. Export request signing

The export is the only signed endpoint. The browser code (function `C` in the Transformers page chunk) does:

```js
timestamp = String(Math.floor(Date.now() / 1000))          // Unix seconds
message   = [method, pathname, query, timestamp].join("\n")   // "GET\n/portal/export\npage=1\n1793783479"
signature = hex(HMAC-SHA256(key = utf8(signingSecret), utf8(message)))
// sent as headers:  x-timestamp: <timestamp>   x-signature: <signature>
```

The click handler fetches `/portal/keys`, signs `GET /portal/export page=1`, calls the export, and downloads **only `data`** as `meter-export.json`. The saved file is therefore a bare array, unlike the network response. The UI always requests `page=1`.

Observations:
- Without the headers, the export returns 401 even with a valid session. Calling `/portal/keys` first doesn't help, which rules out a stateful "unlock".
- **The secret was identical across separate sessions.** Signing happens in the browser with a secret that any logged-in user can fetch, so this mechanism proves a request came from client code that knows the scheme. It doesn't restrict who can export.
- **(unverified)** Whether the server rejects old timestamps (a freshness window) or allows replays. Our client corrects for clock skew either way.

## 5. Data model

**Hierarchy (7 levels):** Zone → Circle → Division → Subdivision → Substation → Feeder → Distribution Transformer (DT) → Meter.

Observed in the export:
- 3 zones, 6 circles, 10 divisions, 14 subdivisions, 18 substations, 28 feeders, 40 DTs, 403 meters.
- Meters J100000 to J100399 are assigned round-robin: meter *n* → DT-(*n* mod 40 + 1).
- Feeders F-001 to F-012 each serve two DTs (for example DT-001 and DT-029 on F-001). F-013 to F-028 serve one each.
- DT names are a locality plus a number ("Malviya Nagar DT 1"), cycling through 10 Jaipur localities. Capacities use standard ratings: 63, 100, 160, 250 and 400 kVA.

**Meter fields:**
- `meterId` (J1000xx), `serialNo`, `make` (HPL, L&T, Genus, Allied, Secure)
- `phaseType` (single / three), `installStatus` (Installed / Faulty / Decommissioned)
- `installType` (Whole Current / CT Operated), `build` (legacy / v2)
- `dtCode`, `hierarchy`, `geo`

**Readings:**
- `kwh` and `kvah` are **cumulative registers** read every 30 minutes; consumption is the difference between consecutive readings.
- `voltR` is the R-phase voltage.
- The UI shows only V(R). **(unverified)** whether three-phase meters return Y and B phases anywhere.

## 6. Quirks and surprises

1. **Numbers as strings.** `energy` and `geo` send every number as a string (`"kwh":"32128.97"`), while `export` and `dts` send real numbers. The UI also displays `48440` without decimals, which is formatting only.
2. **The same data under different names.** Location is `{latitude, longitude}` (strings) from `/geo` but `{lat, lng}` (numbers) in the export.
3. **Dates with no time zone.** Timestamps use `DD/MM/YYYY HH:mm`.
4. **`build` changes the meter page's labels.** Legacy meters show "Meter ID", "Serial No", "Installation Status". **v2 meters show "MeterId", "SerialNo", "InstallationStatus".** Any client mapping those labels from `__data.json` would silently drop fields for every v2 meter.
5. **The hierarchy is not a tree.** Each DT's path is consistent across its meters, but intermediate codes have several parents. D-01 appears under C-01, C-05 and C-03; F-001 under SS-01 and SS-11; SD-01 under D-01, D-05 and D-09. Either codes are only unique within their parent, or the data is inconsistent.
6. **Blank hierarchy fields.** About 20 export rows have an empty `code` or `name` at one level (for example J100011's circle code and J100162's feeder name). In every case we checked, other meters make the missing value unambiguous. Exact counts are at `/v1/data-quality`.
7. **Three meters break the pattern.** J100400 to J100402 have `GN` serials, are three-phase CT Operated meters, sit on DT-007 outside the round-robin, and call DT-007 **"Old Malviya Nagar Xfmr"**. Every other source, including the transformer list, says "Sanganer DT 7". They explain the odd total of 403.
8. **Serial prefixes don't predict make.** Prefixes look like make codes (SE, GE, AL, L&, HP), but they match the Make column no more often than chance. The GN/Genus meters are the only exception. See `/v1/stats` → `serialPrefixByMake`.
9. **Serials containing `&`** (`L&84997`) must be URL-encoded in search queries.
10. **Status contradicts telemetry.** J100000 (*Decommissioned*) and J100031 (*Faulty*) both report normal readings up to the latest timestamp.
11. **Meter coordinates don't cluster by transformer.** A DT's meters are spread across the whole city's bounding box, so DT locations can't be inferred from them.
12. **The export button lives on the Transformers page**, not the Meters page.
13. **Browser-extension noise.** Files such as `frames_handler.js`, `offer-trigger.tsx` and `jsx-runtime` in DevTools came from a browser extension (`chrome-extension://…`), not the portal. Use a clean profile when capturing traffic.

## 7. How we found it (method)

1. Clicked through every page with DevTools → Network ("Preserve log") to map the pages and their `/portal/...` calls.
2. Read the response bodies to learn the shapes, and compared byte counts with row counts to estimate page sizes and the size of the readings window.
3. Signed out and back in to capture the login form action and the session cookie.
4. Found the export by clicking it. Our first unsigned attempt from code got a 401, which led to `/portal/keys`. A probe script then ruled out a stateful session unlock. Copying the request as cURL revealed the `x-signature` and `x-timestamp` headers.
5. Used DevTools → **Initiator** to jump from the export request to the page's JavaScript, and read the signing function `C` directly.
6. Verified our reimplementation with a test that runs the browser's exact WebCrypto code next to ours, plus a check against a signature captured from the live portal.

## 8. Open questions
- Does the server enforce a freshness window on `x-timestamp`?
- What else, if anything, does `build` (legacy / v2) change?
- Can the readings window be widened? No query parameter we saw does it.
- Do three-phase meters expose Y and B phase voltages anywhere?