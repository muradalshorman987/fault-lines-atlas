# Fault Lines Atlas: "alive" addendum and completing M4–M7

Date: 2026-11-02 · Extends `2026-10-31-react-open-source-design.md` (its decisions D1–D12 still hold)

## Why

The owner asked to complete the project and to "use some features from the new interactive map design". That design is the "command centre" model R, https://claude.ai/artifact/M5dZoMjbeuDexMEddRAyqD. The owner wants it to use charts and to make the atlas "alive and interactive", while keeping the two projects separate. So we borrow **patterns only**:
- no shared code or packages
- not R's teal and amber palette

The atlas keeps its chart-room look and its tokens (D3).

## Patterns adopted from model R, and their atlas form

| Model R pattern | In the atlas |
|---|---|
| A living backdrop that drifts slowly, with faint pulses; frozen under reduced motion | **Living loader.** A small precomputed world outline (`public/world-lite.json`, built by a script from Natural Earth) drifts slowly. Conflict anchors pulse, and alliance "constellations" link bloc members. The animation is CSS only and freezes under `prefers-reduced-motion`. |
| "Loading is the map": stages wake the backdrop, with no progress bar; hand-off to the live map at the same extent | **Loader stages:** borders → relations → conflicts with names → counters (the real stats count up once loaded). It then fades into the canvas map. If loading stalls, a "continue" link appears after a timeout. |
| Clear destinations: one card per question | **"Start here" panel** on the first visit (localStorage `atlas-v3-welcome-seen`), reopenable from Help and the palette. Four question cards: *Where is there war now?*, *Who stands with whom?*, *A century of change*, *Compare two states*. The guided tours are listed under them. |
| Command dashboard: read line, KPI tiles (amber only for attention), distribution bars (click filters), region × stage matrix (intensity = count, click filters), list grouped with "needs attention" first, rankings with rank badges and a one-line verdict vs the average, insights that follow the map view | **"World pulse" view** (`#view-pulse`, نبض العالم). See §Pulse. |
| Result types: select · filter · navigate, each with its own cue | The same three verbs, with an icon and tooltip wording on every interactive chart mark and row. Filters show as removable chips in an active-filter row. |
| Every state in the URL | The hash token stays for share links. Pulse filters are added as query parameters: `?region=africa&sev=war,armed-conflict&inview=1`. |
| Area brief: KPI strip, "what stands out", benchmark, nearby, print, copy link | **Country brief tab** in country dossiers: KPI strip, "what stands out" lines, rank badges (#n of N in region and world), a one-line benchmark against the region and world averages, nearby countries, print (browser print stylesheet) and copy link. Picking a region in Pulse shows the same strip aggregated over the region. |
| Count-up numbers, draw-in lines, pop-in markers | Count-up on KPI tiles and brief figures. Bars and matrix cells transition in. Map pulses already exist. Everything respects reduced motion. |

**Not adopted:**
- sign-in or one-time codes, roles or locks
- R's palette
- satellite imagery
- drawing areas
- the finance and social panels, which are Masar-specific

## Pulse (`#view-pulse`)

Everything is computed from the loaded model. The "displaced" figures come from the M5 data once present; until then their tiles hide.

1. **Read line:** one sentence. For example: "40 conflict files: 9 active wars and 14 armed conflicts; Africa has the most (12); 23 records carry developments this edition has not verified." The text follows the active filters and states its scope ("all files" or "what the map shows").
2. **KPI tiles**, with count-up; each tile is a button:
   - active wars
   - armed conflicts
   - states with an external military role in a conflict
   - chokepoints in crisis or elevated
   - unverified developments
   - events in the current decade
   - displaced people (M5)

   Tone: the accent colour by default. `--warn`/`--critical` are used only for attention tiles, and always with an icon and a label.
3. **Distribution bars:** conflicts by severity, by region and by dimension. Click a segment to filter; the segment becomes a chip.
4. **Matrix:** region (5) × severity (8). Each cell shows a count with sequential intensity; a click filters to that region and severity.
5. **Needs attention:** grouped and shown first, each item with a "why" sentence built from data rules:
   - a war or armed conflict with unverified developments
   - a chokepoint whose status is crisis or elevated
   - a conflict involving ≥ 3 external powers
   - a conflict linked to a crisis chokepoint
6. **Hotspot rankings:** tabs for conflict involvement (as party or external power), religious diversity and displaced (M5). Rows show a rank badge, a coverage bar and a one-line verdict ("above the world average by 65%").
7. **Linking:** hovering any bar, cell or row emits `highlight` (the map emphasises those countries); a click selects. "Figures follow the map" (`?inview=1`) restricts everything to countries the map currently shows, using the engine's new `viewport` event.
8. **Accessibility:** each chart has a "table" toggle. The `dataviz` skill rules apply: fixed categorical slots, validated palette, text in ink tokens.

## Completing the original milestones (unchanged scope)

- **M4, open-source package:**
  - CONTRIBUTING (EN + AR), code of conduct, SECURITY, issue and PR templates, `docs/ARCHITECTURE.md`
  - code splitting: views, tours, welcome and ask are lazy
  - turn the data-pinned tests into invariants
  - the deferred minors in the M1–M3 ledgers
- **M5, open-data pipeline:** as in spec §6, plus the figures contract below and D10.
- **M6, Ask Claude with the visitor's own key:** as in spec §7.
- **M7, detailed map** (MapLibre + OpenFreeMap): as in spec D7, plus the `viewport` event in the canvas engine.

## Shared contracts (the lead lands these before the workers start)

- `VIEWS` gains `pulse`, and the icon `pulse` is added.
- `filters.region: string | null`, the conflict-file region id: `middle-east`, `europe`, `asia`, `africa`, `americas`.
- `filters.inView: boolean`.
- `projection: 'globe' | 'flat' | 'detailed'`.
- Event `viewport: { iso3: string[] }`, emitted by the canvas engine when the view settles.
- `db.figures` (`src/data/figures.ts`) is `{ country(iso3), conflictDeaths(id), sources }`. The figure type is `{ value, year, source, unit? }`. It is empty until M5 fills it.
- `src/ui/motion.ts`: `useCountUp(target, ms)`, which returns the target at once under reduced motion.
- `src/data/rank.ts`: `rankBy(items, value) → Map<id, {rank, of, percentile}>` and `vsAverage(v, values) → signed % difference`.
- Query-string sync for `region`, `sev` and `inview`, in `src/app/hash.ts`.

## Done means

- Every feature works in AR and EN, dark and light, at 1280 px and 390 px.
- No console errors.
- Unit tests and Playwright smoke tests cover the new views.
- `check-data` is green, including the generated files.
- The whole branch is reviewed, with a security review of BYOK, CSP and the workflow tokens.
- Published to Vercel from `main` (the owner asked earlier to push and publish when finished).
