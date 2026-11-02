# أطلس خطوط الصدع — Fault Lines Atlas

An open-source, bilingual (Arabic / English) interactive atlas that links geography to ethnicity, religion, conflicts, resources and alliances.
أطلس تفاعلي مفتوح المصدر يربط الجغرافيا بالعرق والدين والنزاعات والموارد والتحالفات، بالعربية والإنجليزية.

**Live:** https://fault-lines-atlas.vercel.app

## What's inside / ما في الأطلس

- **Map:** a globe, a flat map and a detailed street-level map, with nine lenses: overview, conflicts, religion, ethnic groups, disputed areas, powers, resources, chokepoints and timeline.
- **World pulse (نبض العالم):** a one-line summary of the world, KPI tiles, conflicts by severity and region, a region × severity matrix, a "needs attention" list with the reason for each item, and rankings. Everything links to the map, and figures can follow what the map shows.
- **Dossiers:** a reading panel for every country, conflict, ethnic group, religion, chokepoint, disputed area, event, bloc and resource site. Every country opens on a **Brief**: key figures with ranks, what stands out, a comparison with its region and the world, and nearby states, ready to print.
- **Views:** the relations network, a timeline from 1900 to today, compare two states, and sources and method.
- **Guided tours and "Start here":** questions to begin with.
- **Ask Claude:** questions about the atlas, answered from its data, using your own Anthropic API key. The key stays in your browser.
- **Open data:** population and GDP (World Bank), conflict deaths per year (UCDP) and displacement (UNHCR), refreshed weekly by a pull request. See [docs/DATA.md](docs/DATA.md).

Contributing: [CONTRIBUTING.md](CONTRIBUTING.md) · [بالعربية](CONTRIBUTING.ar.md) · [Architecture](docs/ARCHITECTURE.md) · [Security](SECURITY.md) · [Code of conduct](CODE_OF_CONDUCT.md)

## Run it locally / التشغيل على الجهاز

Requires Node 22 or newer.

```bash
npm ci
npm run dev        # http://localhost:5173
```

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Type-check and build to `dist/` |
| `npm test` | Unit tests (Vitest) |
| `npm run test:e2e` | Browser smoke tests (Playwright; uses your installed Edge locally) |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript |
| `npm run check-data` | Validates every curated data file: shapes, links between records, unique ids, layout |
| `npm run format-data` | Rewrites curated JSON in the one canonical layout |
| `npm run data:update` | Fetches the open-data sources into `public/data/generated/` (an optional `EIA_API_KEY` enables energy figures) |
| `npm run build:world-lite` | Rebuilds the small world outline the loading screen draws |

## How it is built / البنية

React 19 + TypeScript + Vite. The map is a canvas engine on d3-geo (globe and flat projections); state lives in one Zustand store and the URL hash holds a share link such as `#country-SAU`, `#conflict-sudan` or `#compare-USA-CHN`.

```
src/app        state, share links, preferences, event bus
src/data       data types and the linked model built from the JSON files
src/features   map (+ detailed map), shell, dossier, views, pulse, timeline, tours, welcome, ask
src/ui         shared helpers, icons, charts, colour palette
public/data    geo/ (Natural Earth), curated/ (the atlas content), generated/ (open-data figures)
scripts        data checks, formatting, and the open-data fetchers
docs           design and plans
```

## Fixing or adding data / تصحيح البيانات

The atlas content is plain JSON in `public/data/curated/`. Edit the file, then run `npm run format-data` and `npm run check-data`; CI runs the same check on every pull request. Every claim needs a source and a date, disputed things are described as disputed, and developments that this edition has not verified carry `"unverified": true`.

## Deploying / النشر

Vercel builds the `main` branch automatically (settings in `vercel.json`: Vite, `npm run build`, output `dist`). Other branches get preview links.

## Licence / الترخيص

- Code: MIT — see [LICENSE](LICENSE).
- Data: see [public/data/README.md](public/data/README.md). The curated content is a CC BY 4.0 compilation adapted from «الأطلس الجيوسياسي والعرقي الديني العالمي»; corrections made by this project are listed on the Sources page. Country shapes are from Natural Earth (public domain).
