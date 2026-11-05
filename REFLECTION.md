# Reflection

## What assumptions did you make?

Honestly, the big one was timezones. The portal gives timestamps like `23/06/2026 23:30` with no zone at all, so I just went with IST (+05:30) since it's a Jaipur utility — seemed safe. Then the readings: `kwh`/`kvah` are cumulative registers, not per-interval usage, so I diff consecutive readings to get actual consumption — that's where `kwhDelta` and `powerFactor` come from. And I noticed early on that the data never really changes — every meter's latest reading is 30/06/2026 — so I treated the whole thing as a static snapshot and gave metadata and readings a 6-hour cache without worrying much.

## Which part was the most difficult, and how did you get unstuck?

Definitely the export endpoint. I had a session, the cookie was fine, and `/portal/export` still gave me a 401. I poked around with a small probe script and realised it's not that the session needs unlocking — each request itself has to be signed. Copying the browser's request as cURL showed me the `x-signature` and `x-timestamp` headers. What actually cracked it was the DevTools Initiator tab: it took me to the exact function in the portal's own JS that builds the signature — the message is just method, path, query and timestamp joined by newlines. Guessing that format would've taken forever; reading their code took minutes. I then wrote a test that runs the browser's own WebCrypto signing next to mine to prove they produce identical signatures.

## If you had another day, what would you improve?

I'd do the anomaly thing first — like, J100000 shows as Decommissioned and J100031 as Faulty, but both are still sending perfectly normal readings. Flagging status-vs-telemetry mismatches would be genuinely useful for ops. After that, checking transformer loading against kVA capacity to find overloaded DTs, and saving readings to SQLite so a restart doesn't refetch all 400 meters one by one.

## What mistake did you make while solving this?

I went down the `__data.json` page-data route first, before I found the export. Lucky escape really — v2 meters label things differently ("MeterId" instead of "Meter ID"), so if I'd mapped fields by label I'd have silently dropped data for every v2 meter. I also assumed the export was unsigned and only found out about the HMAC signing when it 401'd on me, and I assumed login was a normal Better Auth JSON endpoint when it's actually a SvelteKit form POST to `/login` — that's why my client checks for the session cookie instead of trusting an HTTP 200.

## If you were reviewing your own submission, what would you criticise?

I'd say the hand-written `openapi.json` — there's a test keeping it in sync with the actual routes, but it's not generated from code, so it can drift. Readings live only in memory, so every restart means refetching all 400 meters from the portal. No auth on my own API either — fine for something local and read-only, but not deployable as-is. The 230V ±6% voltage band is just my assumption, not a verified standard. And honestly, no frontend — I chose to spend the time on figuring out the portal and cleaning the data instead.

## AI assistance
I used free open source models for faster code generation and docs.
