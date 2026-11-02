# Architecture

A short map of the code for contributors. The design decisions behind it are in [`docs/superpowers/specs/`](superpowers/specs); this page describes what is there now.

The atlas is a static single-page app: React 19, TypeScript (strict) and Vite, served by Vercel. There is no server, account system or database. The browser fetches JSON from `public/data/`, builds one linked model from it, and draws everything from that model.

## Folders

```text
index.html             Vite entry; a pre-paint script sets lang/dir/theme, and a static first frame of the loader
public/data/geo/       Natural Earth shapes (countries, boundaries, disputed areas), not edited by hand
public/data/curated/   the atlas content, edited by contributors (CONTRIBUTING.md)
public/data/generated/ open-data figures written by the weekly pipeline (docs/DATA.md)
src/main.tsx, App.tsx  mount <Boot><Layout/></Boot>
src/app/               state (store.ts), events (events.ts), share links (hash.ts), preferences (prefs.ts),
                       useT/useDb hooks (useT.ts), compat.ts for imperative code
src/data/              types.ts, files.ts (what to fetch), load.ts (fetch + progress), build.ts (the linked model),
                       join.ts + figures.ts (generated figures), rank.ts (ranks and averages)
src/i18n/              format.ts (numbers, dates, search text), strings.ts (string tables), core.ts (boot strings)
src/ui/                shared pieces with no feature knowledge: Icon, charts, ErrorBoundary, tooltip, palette, dom, motion
src/features/<name>/   one folder per area of the page (below)
src/styles/            base tokens and the per-area stylesheets imported by main.tsx
scripts/               check-data, format-data, the data pipeline (scripts/data), one-off migrations
tests/                 Vitest unit tests; tests/e2e holds the Playwright smoke tests
```

Features: `boot` (loading and hand-off), `layout` (the page skeleton), `map` (canvas engine, legend, controls, detailed map), `shell` (top bar, lens rail, palette, help, tours menu, phone menu, toasts, keyboard), `dossier` (the record panel), `views` (the view host plus network, timeline, compare and sources), `pulse` (World pulse view), `tours` (the guided-tour card), `ask` (Ask Claude), `welcome` (the "Start here" panel).

## State, events and share links

**One store.** [`src/app/store.ts`](../src/app/store.ts) is a Zustand store holding everything the page shows: language, theme, projection, lens, selection, open view, compare pair, year, filters and layers. Components read it with `useAtlas((s) => s.key)` and change it through `atlas.set(patch)`, `atlas.select(kind, id)`, `atlas.openView(id)` and the other helpers. `atlas.set` applies only the keys that really change, so a no-op never re-renders. Imperative code such as the map engine uses `onStateChange` from [`compat.ts`](../src/app/compat.ts), which hands it the changed keys and isolates its errors.

**A small event bus.** [`src/app/events.ts`](../src/app/events.ts) carries what is not state: `hover`, `flyto`, `highlight`, `toast`, `starttour`, `ready`, `viewport` and `welcome`. The `Events` interface types each payload. `emit` never throws into the sender, and `lastOf(evt)` returns an event's latest payload for code that subscribes late.

**Share links.** [`src/app/hash.ts`](../src/app/hash.ts) keeps the URL in step with the store. The hash holds one token, the same as in v2: `#country-SAU`, `#conflict-sudan`, `#lens-religion`, `#view-network`, `#compare-USA-CHN` or `#tour-energy`. Shared filters sit in the query string (`?region=africa&sev=war&inview=1`). `startHashSync(db)` applies the link once the data is in, then rewrites it on every relevant state change.

**Preferences.** [`prefs.ts`](../src/app/prefs.ts) saves language, theme and projection to local storage on a best-effort basis; the page works without storage.

## Data: from JSON to the model

1. [`files.ts`](../src/data/files.ts) lists the core files (`FILES`) and the optional generated ones (`GENERATED`).
2. [`load.ts`](../src/data/load.ts) fetches them and reports progress to the loader. A core file that fails stops the boot and offers a retry. A generated file that is missing or malformed is skipped.
3. [`build.ts`](../src/data/build.ts) clones the raw data and returns the `DB`. It normalises ISO codes (`XKX` → `KOS`), links every record to its countries, conflicts, events and chokepoints, and adds lookups (`get`, `exists`, `nameOf`, `search`, `countriesOf`, `isUnverified`) and `stats`. It is a pure function, so tests call it directly on the files read from disk ([`tests/helpers/readRaw.ts`](../tests/helpers/readRaw.ts)).
4. [`join.ts`](../src/data/join.ts) puts the generated figures behind `db.figures`. Natural Earth's population and GDP are used only when no generated value exists.

Components get the model from `useDb()`, and strings and formatters from `useT()`, both in [`useT.ts`](../src/app/useT.ts). Each feature registers its own UI strings in both languages with `registerStrings({ ar, en })`.

The data rules (`npm run check-data`) live in [`scripts/check-data.ts`](../scripts/check-data.ts) and [`scripts/schema.ts`](../scripts/schema.ts), so zod never ships to the browser.

## The map engine

[`src/features/map/engine/engine.ts`](../src/features/map/engine/engine.ts) is a Canvas 2D map on d3-geo, either an orthographic globe or a flat Equal Earth map. React does not render map features. [`MapStage`](../src/features/map/index.tsx) creates the engine with `createMap()` and destroys it when it unmounts or the detailed map takes over. The engine follows the store through `onStateChange`.

- [`scene.ts`](../src/features/map/engine/scene.ts) turns state plus the model into what to draw for the current lens (fills, hatches, arcs, markers, labels), and writes the hover line.
- [`geo.ts`](../src/features/map/engine/geo.ts) holds the geometry helpers: level of detail, bounds, label anchors.
- [`viewport.ts`](../src/features/map/engine/viewport.ts) works out which countries are in view. The engine emits them as the `viewport` event when the view settles.
- Two stacked canvases: the base redraws only when the view or scene changes, and the overlay redraws for hover and pulses. The animation loop runs only while something moves.
- The detailed map ([`map/detailed/`](../src/features/map/detailed)) uses MapLibre GL with OpenFreeMap tiles. It loads lazily when the projection is `detailed`, and falls back to the globe if it cannot start.

## How features stay independent

- **Features don't import each other.** They talk through the store and the event bus. The shell opens the "Start here" panel by emitting `welcome`, for example; it never imports `features/welcome`. The deliberate exceptions are `tours/tours.ts` (tour metadata the shell and welcome list) and the composition points below.
- **[`Layout.tsx`](../src/features/layout/Layout.tsx) composes the page.** It is the one place that imports the features. It renders each area inside an [`ErrorBoundary`](../src/ui/ErrorBoundary.tsx) whose fallback is the area's empty container (`#dossier`, `#viewpanel`, `#tour`, `#ask`), so one failing area cannot blank the page.
- **The view host composes the views.** [`views/index.tsx`](../src/features/views/index.tsx) owns the panel frame, focus and closing, and renders the open view's body.
- **Code splitting.** The view bodies (pulse, network, timeline, compare, sources), the tour card, Ask Claude, the "Start here" panel and the detailed map are separate chunks loaded with `React.lazy`. Their `Suspense` fallback is the same empty container, so CSS, focus code and share links find it before the code arrives. An event such as `starttour` from a `#tour-energy` link can fire before the tour chunk has loaded; Layout's `LazyArea` holds it and sends it again once the area has mounted. The timeline module is split for the same reason: the year scrubber (`timeline/Scrubber.tsx`) loads with the page, and the full view (`timeline/TimelineView.tsx`) on demand.
- **Shared UI goes in `src/ui/`**, and it has no knowledge of any feature.

## Testing

- **Unit tests** (Vitest + Testing Library, jsdom): `npm test`. Tests build the real model from the files on disk and render features inside `DbContext`. Map tests stub the canvas.
- **Data tests check rules, not counts.** [`tests/curated.test.ts`](../tests/curated.test.ts) asserts relations: stats equal the length of their source lists, ids are unique, every unverified flag points to a record and the model flags exactly those. Contributors can therefore add records without editing tests.
- **Behaviour changes are test-first:** write the test, watch it fail, then make it pass.
- **Browser smoke tests** (Playwright): `npm run test:e2e` builds the site, serves it with `vite preview` and runs [`tests/e2e/`](../tests/e2e). Locally they use the installed Edge, and in CI Playwright's Chromium.

## CI and deployment

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs on every push and pull request:

- **check**: typecheck, lint, unit tests, `check-data`, build
- **e2e**: the Playwright smoke tests. On failure it uploads the HTML report and the traces as the `playwright-report` artifact.

The weekly data workflow refreshes `public/data/generated/` and opens a pull request; it never pushes to `main` (see [docs/DATA.md](DATA.md)). Vercel builds `main` automatically with the settings in `vercel.json`, and other branches get preview links.
