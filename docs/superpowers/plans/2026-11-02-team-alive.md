# Team run "atlas-alive": work split

- **Spec:** `docs/superpowers/specs/2026-11-02-atlas-alive-design.md`, plus the original `2026-10-31-react-open-source-design.md`.
- **Base:** e76fe56 on `react-rewrite`. The shared contracts are already in.
- **Exec rules:** each worker edits only the files it owns and makes no git writes; the lead commits per worker. Workers write tests before code. Each worker runs `npx vitest run`, `npx tsc --noEmit` and `npx eslint .`, and reports any errors in files it doesn't own rather than fixing them. Only the lead runs Playwright.

| Worker | Owns (edit only these) | Delivers |
|---|---|---|
| **pulse-builder** | `src/features/pulse/**`, `tests/pulse.test.tsx`, `tests/e2e/pulse.spec.ts` | The World pulse view: read line, count-up KPI tiles, distribution bars, region × severity matrix, needs-attention list with "why" sentences, hotspot rankings with rank badges and a verdict against the average, a table toggle on every chart, map highlight on hover, select/filter/navigate on click, and figures that follow the map |
| **brief-builder** | `src/features/dossier/**`, `src/features/views/compare.tsx`, `tests/dossier*.test.tsx`, `tests/brief.test.tsx` | Country Brief tab: KPI strip, "what stands out", rank badges, benchmark line, nearby countries, print and copy link. Also the "Latest figures" block and the conflict deaths chart, both driven by `db.figures`, and source/year chips on Compare |
| **living-builder** | `src/features/boot/**`, `src/features/welcome/**`, `index.html` (static loader block only), `scripts/build-world-lite.ts`, `public/world-lite.json`, `tests/boot*.test.tsx`, `tests/welcome.test.tsx` | Living staged loader with hand-off to the map, and the "Start here" panel with 4 question cards and the tours |
| **data-builder** | `scripts/data/**`, `scripts/check-data.ts`, `scripts/schema.ts`, `public/data/generated/**`, `public/data/curated/**` (`ucdp` ids only), `src/data/**` except `rank.ts`/`figures.ts`, `src/features/views/sources.tsx`, `.github/workflows/data-update.yml`, `docs/DATA.md`, `tests/data-*.test.ts`, `tests/check-data.test.ts`, `tests/build.test.ts` | M5 pipeline: fetchers, generated files, filling `db.figures`, D10 replacing Natural Earth population and GDP, the weekly workflow that opens a PR, and the Sources view listing generated sources |
| **ask-builder** | `src/features/ask/**`, `vercel.json`, `tests/ask*.test.tsx` | M6 Ask Claude with the visitor's own key: key dialog, streaming, tool loop, safe answer rendering, CSP and security headers |
| **map-builder** | `src/features/map/**`, `tests/map*.test.ts*`, `tests/legend.test.tsx` | Viewport event, conflicts lens respects `filters.region`, M7 detailed map (MapLibre + OpenFreeMap, lazy), the projection control's third option, engine teardown when setup throws, and a `createMap` test |
| **os-builder** | Community files (`CONTRIBUTING*.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `.github/ISSUE_TEMPLATE/**`, `.github/pull_request_template.md`), `.github/workflows/ci.yml`, `docs/ARCHITECTURE.md`, `src/features/layout/Layout.tsx`, `src/features/views/index.tsx`, `src/features/views/timeline/**`, `src/features/shell/**`, `src/ui/Icon.tsx`, `vite.config.ts`, `tests/curated.test.ts`, `tests/shell.test.tsx`, `tests/timeline.test.tsx`, `tests/views.test.tsx`, `tests/layout.test.tsx` | M4: community files, code splitting (lazy views/welcome/ask/tours with Suspense), data-pinned tests turned into invariants, and the deferred minors (timeline re-render, crumb focus, CI e2e artifacts, Icon style prop) |

The lead keeps `src/app/**`, `src/config.ts`, `src/ui/**` except `Icon.tsx`, `README.md`, `package.json` (workers say which dependencies they need) and `docs/superpowers/**`.

- **Verify:** verifier, code-reviewer (opus) and security-reviewer (BYOK, CSP, workflow tokens), then the lead's Playwright and browser pass in AR/EN, dark/light, at 1280 px and 390 px.
- **Fix loop:** at most 3 rounds.
- **Publish:** fast-forward `main` and push; Vercel deploys it.
