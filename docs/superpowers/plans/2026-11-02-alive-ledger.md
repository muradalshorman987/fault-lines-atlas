# Ledger: team run atlas-alive (plan: docs/superpowers/plans/2026-11-02-team-alive.md)

lead: shared contracts e76fe56. Welcome event 6e94fd5. lastOf (sticky event payloads) 1890882, requested by map-builder and pulse-builder.

## pulse-builder: complete
- 15 tests, including a mutation check.
- Browser: AR dark and EN light at 1280 px, AR and EN at 390 px; no overflow, no console errors.
- `?region=africa&sev=war` restores the filter chips and the region strip.
- "Follow the map" works with the real viewport event.

Rulings:
- Severity is never shown as touching colour segments, only as labelled rows. Why: `--sev-*` fails the categorical palette validator (post-conflict vs political ΔE 6.8 dark / 8.0 light). Cost: none for pulse.
- The dimension filter is local to Pulse (the store has no key for it). Cost: it isn't in the URL and the map ignores it.
- Charts don't crossfilter themselves; selected bars are marked instead. Cost: small.
- Under "follow the map", a conflict counts if any party is in view.
- "Unverified developments" counts conflict files only (23), matching the spec.
- A verdict above +100% reads "N× the average".

## brief-builder: complete
- 13 brief and 24 dossier tests.
- Browser: SAU in AR dark and EN light at 1280 and 390, with no errors. The print view shows only the brief, on light paper.
- With the figures stubbed: Latest figures shows its chips, the Yemen deaths chart draws 34 bars, and Compare shows its chips.

Rulings:
- A zero conflict count is not ranked.
- The "external power" line excludes conflicts where the country is already a party.
- `figures.gdp` is plain US$; it is divided by 1e6 unless the unit says million.
- Print forces light tokens.
- "Displaced" = refugeesFrom + idps.

Follow-up (lead, fix stage): `compare.tsx` imports `../dossier/brief/facts`, a feature-to-feature import. Move `facts.ts` to shared code (`src/data/facts.ts`).

## ask-builder: complete
- 37 tests.
- CSP browser check on a scratch build with the vercel.json headers: no violations. The inline-script hash matches.
- A fake key against the real API: CORS preflight OK and the 401 message renders, in AR 1280 and EN light 390. The key is not stored and not in the URL.
- MapLibre runs under the CSP: blob worker, OpenFreeMap style and tiles OK.
- Models (claude-api skill table): claude-sonnet-5-5 (default), claude-haiku-5-5, claude-opus-5-5. API version 2026-10-21 (from the skill).
- NOT verified: a real-key question end to end. The owner should run one before relying on it.

Rulings:
- Raw fetch + SSE, no SDK.
- Server-side fallback beta header on Sonnet/Opus. If the API rejects it, flip the `fallback` flag in models.ts.
- Append-only history, 10 questions per conversation.
- Effort medium, max_tokens 16000, 5 tool rounds.
- An unknown ref shows as plain text.
- `sh.ask` string registered in ask/strings.ts.

Coupling: `vercel.json` CSP holds the sha256 of index.html's inline pre-paint script. Changing that script requires updating the hash; tests/ask-csp.test.tsx guards it.

## os-builder: complete
- 96 tests across 5 files; tsc clean.
- Bundle, startup gz: 213.1 kB → 186.4 kB. Lazy chunks: network 13.7, compare 6.6, timeline 6.1, sources 3.6, tour 3.5, pulse 11.9, welcome 3.3, ask 14.9 kB.
- Browser: cold loads of #view-network, #tour-energy, #compare-USA-CHN and #view-pulse all work. Help → Start here opens the panel.

Rulings:
- LazyArea holds starttour/welcome events sent before its chunk mounts and re-sends them once (lastOf would replay old commands).
- No d3 manualChunks.
- curated.test.ts asserts rules, plus 3 checks on D4 corrections.
- The view fallback is an empty aria-busy div.
- Timeline split into Scrubber.tsx, TimelineView.tsx and shared.ts.

Follow-ups (lead):
- config.ts lens subtitle hard-codes "40 files across five regions".
- .gitignore lacks .env*.local.
- README should link CONTRIBUTING and ARCHITECTURE.
- The Ask chunk loads at startup (askReady is set on mount).
- Owner, on GitHub: enable private vulnerability reporting; create a `data` label.

## data-builder: complete
- 56 new tests.
- Generated: worldbank 215 countries, ucdp 33 conflicts (GED 26.1 plus candidate events to Sep 2026), unhcr 199 countries (2025).
- USGS blocked: ScienceBase returned a Cloudflare 403. EIA skipped: no key.
- Wikidata drift report: 7 blocs differ (report only).
- UCDP mapping: 33 of 40 conflicts. Unmapped: gulf-security, taiwan-strait, south-china-sea, tibet, korean-peninsula, essequibo, mexico-cartels.

Rulings:
- The seed maps only state-based UCDP conflicts. Sudan's one-sided violence is not included.
- Series start at the atlas `started` year; quiet years are 0.
- Candidate events are kept apart as `deathsPreliminary`.
- EIA: oil and gas production only.
- The workflow has a read-only fetch job and a PR job (no npm with the write token). A PR opens only on changed values or a new failure.
- Unchanged values leave files untouched.

Lead: added npm script `data:update`.

Owner setup:
- GitHub → Settings → Actions → "Allow GitHub Actions to create and approve pull requests".
- Optional secrets: EIA_API_KEY, DATA_PR_TOKEN.

Follow-ups:
- The overview lens still uses fixed POP_RANGE/GDP_RANGE (D10 asks for recomputed breaks). Map owner.
- ci.yml uses actions v4, data-update.yml uses v6/v7/v8. Fine, but could be aligned.

## living-builder: complete
- 12 boot tests and 14 welcome tests.
- world-lite.json is 32 KB.
- Browser: Edge, AR/EN, dark/light, 1440/1280/390. All 4 stages captured. Reduced motion shows a static loader. The stall link appears. The static first frame matches. Start here: Esc, focus trap and reopen all work; deep links skip it. No errors.

Rulings:
- "Continue" restarts the load ("{done} of {total} files arrived"). The model loads all-or-nothing.
- Share-link visits skip Start here and don't mark it seen.
- The hand-off is a fade with a 3% zoom, not a same-extent match (the globe vs the Equal Earth loader).
- The loader stops taking pointer events once the data is in, and is gone by 1.25 s.

Lead:
- Fixed `useCountUp`: t0 now comes from the first frame (regression test).
- Added npm script `build:world-lite`.

Note: the map's setup blocks the main thread at hand-off, so the count-up can jump to its final value.

## map-builder: complete
- 50 new tests.
- Styles: OpenFreeMap positron (light) and dark. The only host contacted is tiles.openfreemap.org: style, TileJSON, pbf tiles, fonts, sprites.
- Browser, dev and prod: tiles render and Arabic labels shape correctly. Click selects; hover shows the tipFor text. Detailed → globe → detailed hands the camera over. #country-IRQ flies on load. The fallback works when WebGL is off and when OpenFreeMap is blocked (toast shown, pref set to globe).
- Chunks: DetailedMap 10 KB and maplibre 298 KB gz, both lazy; nothing in index.

Rulings:
- No RTL text plugin: MapLibre 6.16 shapes Arabic natively (verified).
- The map-type control is a 3-option popover.
- Clicking on the detailed map selects with fly:false.
- Viewport boxes are per polygon.
- Detailed map: lens fills, selection/compare outlines and highlight; markers and arcs stay canvas-only (D7).
- Region chip on the conflicts card.

Notes:
- The CSP keeps `worker-src blob:` (the worker is same-origin, so blob isn't strictly needed). Harmless; could tighten.
- Shell palette label for G still says flat/globe.
- A "map" icon would replace "route".
Final: fixed (review 1, Important) Pulse double-counted conflict involvement — union like the Brief (USA 26) — pulse tests RED→GREEN 17/17. Fixed (review 9, minor, re-graded a11y) tile aria-label includes the attention pill.
Final: fixed (review 2, Important) Brief vs-average misled (microstates) — GDP per person vs total GDP ÷ total population (DEU −1% vs W. Europe, CHN −11% vs world), other KPIs vs median (no line at median 0), population no comparison, ranks labelled 'of N states and territories' — brief tests RED→GREEN, brief+dossier 40/40.
Final: fixed (review 3, Important) UNHCR refugees omitted 'oip' — refugeesFrom/In = refugees + oip (VEN 0.42M → 6.46M; world displaced 92.5M → 99.6M), labels say so, UNRWA exclusion stated in citation and DATA.md — parser test RED→GREEN. Fixed (review 6, minor) shrink guard keeps previous file on >20% record drop. Fixed: --only run kept the Wikidata drift summary in _status.json.

## Final review: deferred minors
- Review 5: GDP unit test duplicated (build.ts `/million/i` vs shown.ts `figureMd`). Use `figureMd` in both.
- Review 7:
  - `compare.tsx` imports `../dossier/brief.css`.
  - `emptyFigures` is unused.
  - `pulse/model.ts` duplicates `displacedOf`.
  - `deathsPreliminary` is fetched but never read.
- Review 8: the Ask streaming answer lacks `aria-busy`.
- Review 10: Pulse resets its local filters, tab and table toggles on a language or theme switch (the view body remounts).
- Review 11:
  - The Ask chunk loads at startup.
  - `POP_RANGE`/`GDP_RANGE` are fixed (D10 asks for recomputed breaks).
- Security L1/L2/L4/L5 fixed (80f991d). L3: CSP checked on the Vercel preview before the production switch.
