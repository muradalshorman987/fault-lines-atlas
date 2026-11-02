# Contributing to Fault Lines Atlas

[اقرأ هذا الدليل بالعربية](CONTRIBUTING.ar.md)

Thank you for helping. Most contributions to the atlas are not code: a corrected date, a better source, a missing event, a clearer Arabic sentence. All of them are welcome, and you can make many of them from your browser.

Ways to help:

- **Fix data**: something is wrong, out of date or badly worded. See [Fix data](#fix-data).
- **Add a record**: an event, a recent development or a conflict that is missing. See [Add a record](#add-a-record).
- **Report a problem**: open an issue with the matching template (data correction, new record, bug).
- **Improve the code**: start with [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

Please read the [code of conduct](CODE_OF_CONDUCT.md) first. Security problems go through [SECURITY.md](SECURITY.md), not public issues.

## Run the project

You need Node 22 or newer.

```bash
git clone https://github.com/muradalshorman987/fault-lines-atlas.git
cd fault-lines-atlas
npm ci
npm run dev        # opens on http://localhost:5173
```

| Command | What it does |
|---|---|
| `npm run dev` | Development server that reloads as you edit |
| `npm test` | Unit tests (Vitest) |
| `npm run check-data` | Checks every curated data file: shapes, links between records, unique ids, layout |
| `npm run format-data` | Rewrites the curated JSON in its one standard layout (the content never changes) |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript |
| `npm run build` | Type-checks and builds the site into `dist/` |
| `npm run test:e2e` | Browser smoke tests (Playwright; uses your installed Edge locally) |

## Fix data

The atlas content is plain JSON in [`public/data/curated/`](public/data/curated). Each file holds one subject:

| File | What it holds |
|---|---|
| `conflicts/<region>.json` | Conflict files, one file per region (`middle-east`, `europe`, `asia`, `africa`, `americas`) |
| `timeline.json` | Events since 1900 and their categories |
| `chokepoints.json` | Straits and maritime chokepoints |
| `relations.json` | Blocs, alliances and rivalries between states |
| `country_intel.json` | Notes per country (blocs, disputes) |
| `ethnic_groups.json` | Approximate areas of ethnic groups |
| `religions.json` | Religious composition per country |
| `resources.json` | Resources and notable sites |
| `sources.json` | The datasets and references that records cite |
| `corrections.json` | Every change this project made to the original atlas's content |

Two folders are not edited by hand: `public/data/geo/` holds Natural Earth shapes, and `public/data/generated/` is written by the weekly data pipeline ([docs/DATA.md](docs/DATA.md)).

**On your computer:**

1. Edit the file.
2. Run `npm run format-data`, which puts the file back in the standard layout.
3. Run `npm run check-data` and fix anything it reports.
4. Open a pull request (the template asks for your sources).

**In the browser only:** open the file on GitHub, press the pencil, make the change and choose "Propose changes". The checks then run on your pull request. If the only complaint is the layout, say so in the pull request and a maintainer will run `format-data` for you.

**Reading check-data:** each problem is one line, `file › where in the file › what is wrong (got the value it found)`:

```text
conflicts/africa.json › conflicts[3].countries[1] › unknown country code (got "SUD")
```

Here the fourth conflict in `africa.json` lists `SUD`; Sudan's code is `SDN`. Country codes are three-letter ISO codes, the same ones the map uses.

## Sourcing rules

The atlas is read by students, journalists and curious readers in two languages. These rules keep it trustworthy.

1. **Every claim needs a source and a date.** Put the source where the record has a place for it: `sourceRefs` on a conflict (ids from `sources.json`) or the `source` of a `recent` item. Where there is no such field, give the link in your pull request. Dates use `YYYY`, `YYYY-MM` or `YYYY-MM-DD`.
2. **Disputed things are described as disputed.** Say who claims what and attribute it: "accused of supporting the RSF, which it denies", not "supports the RSF". Contested figures are given as ranges with their sources, such as "about 3,200 to 5,000".
3. **Mark what this edition has not verified.** A development that comes from a single report, or that we could not check independently, gets `"unverified": true` on its record. The atlas shows a badge for it, and the Sources page counts these records. Remove the flag only when you can cite the confirmation.
4. **Neutral wording.** Describe; don't judge. Avoid loaded words ("terrorist", "heroic", "brutal regime") unless you are quoting someone and say who. Prefer the names communities use for themselves.
5. **Both languages say the same thing.** Every text has `ar` and `en` (or `…Ar` and `…En`) versions. Write natural Arabic, not a word-for-word translation of the English. If you can only write one language, say so in the pull request and someone will help with the other.
6. **Changing the original atlas's content?** Add an entry to `corrections.json` (`id`, and `where` and `what` in both languages). The CC BY 4.0 licence asks us to show what we changed, and the Sources page lists these entries.

## Add a record

Copy a record of the same kind from the same file and change it. A few rules:

- **Ids** are lowercase words joined by hyphens (`russian-revolution`) and are unique within their kind. Never rename an existing id, because share links such as `#conflict-sudan` use it.
- **Countries** are three-letter ISO codes (`SAU`, `IRN`). Kosovo may be written `XKX`; the atlas maps it to `KOS`.
- **Links** between records (`conflictIds`, `countries`, `sourceRefs`) must point to records that exist. `check-data` tells you when one doesn't.

A timeline event (`timeline.json` → `events`). This is the existing `ethiopia-pretoria` event, shortened:

```json
{
  "id": "ethiopia-pretoria",
  "date": "2022-11-02",
  "precision": "day",
  "cat": ["state-formation"],
  "countries": ["ETH"],
  "ar": "اتفاقية بريتوريا",
  "en": "The Pretoria Agreement",
  "sumAr": "أوقفت الاتفاقية حرب تيغراي ونصّت على نزع سلاح جبهة تحرير شعب تيغراي.",
  "sumEn": "The agreement halted the Tigray war and provided for the TPLF's disarmament.",
  "conflictIds": ["ethiopia"],
  "unverified": true
}
```

`cat` uses the category ids listed at the top of `timeline.json`.

A recent development in a conflict goes at the top of that conflict's `recent` list (newest first) in `conflicts/<region>.json`. If it changes the situation, update the conflict's `status` and its `statusAsOf` date too:

```json
{
  "date": "2026-10-27",
  "ar": "…الخبر بالعربية…",
  "en": "…the development in English…",
  "source": "Amnesty International"
}
```

A new conflict needs at least `id`, `name` (`ar`/`en`), `countries` and a `severity` from this list: `war`, `armed-conflict`, `state-collapse`, `high-tension`, `repression`, `frozen`, `post-conflict`, `political`. Copy a conflict from the same region file to see all the other fields.

The unit tests check rules, not exact numbers, so adding a record does not mean editing a test.

## Pull request checks

Every pull request runs two jobs on GitHub Actions:

- **check**: TypeScript (`npm run typecheck`), ESLint (`npm run lint`), the unit tests (`npm test`), the data check (`npm run check-data`) and the production build (`npm run build`).
- **e2e**: browser smoke tests (Playwright) against the built site. When they fail, the run keeps the HTML report and a trace of each failing test as a downloadable artifact named `playwright-report`.

A data-only change usually needs just `npm run format-data` and `npm run check-data` before you push. For code changes, run all of the above.

## Code changes

- Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) first: features don't import each other, and they talk through the store and the event bus.
- TypeScript is strict. Don't use `any`, and don't leave a `catch` empty without a comment saying why.
- For a change in behaviour, write the test first and watch it fail, then make it pass.
- Every UI string exists in Arabic and English. Check the page in both directions (RTL and LTR), in both themes, and at phone width (390 px).

## Commit style

- One change per commit.
- The first line says what changed, in plain words, under about 72 characters: `Sudan: add the October 2026 sanctions`, `Fix the Arabic name of the Spratly Islands`.
- If the reason isn't obvious, add a blank line and explain why.
- Data commits say which record changed. Code commits say what a reader of the site will notice.

## Licence

By contributing you agree that your code is released under the [MIT licence](LICENSE) and your data changes under [CC BY 4.0](public/data/README.md), like the rest of the project.
