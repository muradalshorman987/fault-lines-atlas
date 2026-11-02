# Open data in the atlas

The atlas has two kinds of data:

- **Curated** (`public/data/curated/`): written by people. Conflicts, ethnic groups, religions, relations, resources, chokepoints, the timeline. CC BY 4.0. You change these files by hand (see CONTRIBUTING).
- **Generated** (`public/data/generated/`): numbers from open sources, refreshed by a weekly job. You never edit these files by hand.

The two never mix in one file. The app joins them when it loads (`src/data/join.ts`). The pipeline updates numbers only; it never changes curated text.

## Sources

| Source | File | What it feeds | Licence | Key |
|---|---|---|---|---|
| [World Bank Indicators API v2](https://datahelpdesk.worldbank.org/knowledgebase/articles/889392) | `worldbank.json` | Population, GDP and GDP per person (current US$): dossiers, compare, map tooltip, overview lens | CC BY 4.0 | none |
| [UCDP downloads](https://ucdp.uu.se/downloads/): GED (yearly) and Candidate events (monthly) | `ucdp.json` | Deaths per year for the conflicts listed under [UCDP mapping](#ucdp-mapping) | CC BY 4.0 | none |
| [UNHCR Refugee Statistics API](https://api.unhcr.org/docs/refugee-statistics.html) | `unhcr.json` | Refugees from and in each state, internally displaced people | CC BY 4.0 | none |
| [USGS Mineral Commodity Summaries data release](https://doi.org/10.5066/P1WKQ63T) | `usgs.json` | Mine production and reserves for the minerals in `resources.json` | Public domain (CC0) | none |
| [EIA API v2 `/international`](https://www.eia.gov/opendata/) | `eia.json` | Crude oil and dry natural gas production | Public domain | free key |
| [Wikidata SPARQL](https://query.wikidata.org/) | none | A drift report only: bloc memberships compared with `relations.blocs`, written into the pull request text | CC0 | none |
| [Natural Earth](https://www.naturalearthdata.com/) | `geo/` | Map shapes; also the fallback population and GDP | Public domain | none |

Sources we do not use, because their licences forbid republishing in a public repository: ACLED (including HDX HAPI conflict events), Pew religion data, EPR/GeoEPR, Correlates of War, REST Countries.

### What each source gives

- **World Bank:** `SP.POP.TOTL`, `NY.GDP.MKTP.CD` and `NY.GDP.PCAP.CD`, the latest year that has a value for each country (`mrnev=1`). Regional aggregates (WLD, ARB…) are dropped. Taiwan is not in World Bank data, so it keeps Natural Earth's figures.
- **UCDP:**
  - `deaths`: GED, the final yearly release. The value is the sum of each event's `best` estimate over the conflict's UCDP ids, per year. It has a yearly `series`.
  - `deathsPreliminary`: Candidate events, this year so far. These are preliminary and UCDP revises them, so they are kept out of the yearly series.
- **UNHCR:** `refugeesFrom` (by country of origin), `refugeesIn` (by country of asylum) and `idps` (internally displaced, by country), for the latest year the API has. Zero counts are left out.
  - `refugeesFrom` and `refugeesIn` are **refugees and others in need of international protection**: the API's `refugees` (under UNHCR's mandate) plus `oip`. Without `oip`, Venezuela would show 0.4 million people abroad instead of 6.5 million.
  - Asylum seekers are not included.
  - **Palestine refugees registered with UNRWA (about 5.9 million) are not included.** They fall under UNRWA's mandate, not UNHCR's, and UNRWA publishes no open, machine-readable feed we could use. Palestine's figure (about 48,000) counts only Palestinians under UNHCR's mandate. The note travels in the file's `citation` and shows on the Sources view.
- **USGS:** `prod:<type>` and `reserves:<type>` for lithium, cobalt, coltan (tantalum), rare earths, phosphate, gold, copper, potash, bromine and nickel. Mine production only, not refinery output. It covers only the resource types already in `resources.json` (spec D12).
- **EIA:** `prod:oil` (thousand barrels per day) and `prod:gas` (billion cubic metres). Coal is not an atlas resource type, so it is not fetched. The `/international` route offers no reserves facet, so only production is fetched.

### Status today (November 2026)

| Source | State |
|---|---|
| World Bank | working |
| UCDP | working: GED 26.1, plus Candidate events to September 2026 |
| UNHCR | working: 2025 figures |
| USGS | **unavailable**. ScienceBase, which hosts the data release, answers scripts with a Cloudflare challenge (HTTP 403). The fetcher is in place and records this as `unavailable`. To refresh it by hand, see [Refresh the data](#refresh-the-data). |
| EIA | skipped until the `EIA_API_KEY` secret is set |

## How the app uses the files

1. `src/data/load.ts` loads the core files first, then each file listed in `GENERATED` (`src/data/files.ts`).
2. Generated files are optional. A file that is missing, unreachable, not JSON or the wrong shape is skipped, and the atlas still loads.
3. `build()` turns the files into `db.figures`:
   - `country(iso3)`: the latest figure for each indicator
   - `conflictDeaths(id)`: the deaths series for one conflict
   - `sources`: name, licence, link and fetch date of each file
   
   Each figure carries its source id and year, so the UI can show a source-and-year chip.
4. **Population and GDP (spec D10).** A World Bank value replaces Natural Earth's `pop`, `popYear`, `gdp`, `gdpYear` and `gdpPerCap` on the country. It also sets `popSource`/`gdpSource`, so the map, tooltip, compare view and dossiers all use it. Natural Earth is used only when there is no generated value.
5. The Sources view lists every generated source with its licence, link and fetch date.

## File shape

```json
{
  "source": "worldbank",
  "name": "World Bank",
  "licence": "CC BY 4.0",
  "url": "https://data.worldbank.org/",
  "fetchedAt": "2026-11-02T13:55:22.698Z",
  "keys": "iso3",
  "citation": "…",
  "indicators": { "population": { "label": { "ar": "السكان", "en": "Population" }, "unit": "people" } },
  "records": { "SAU": { "population": { "value": 36973555, "year": 2025 } } }
}
```

- `keys` is `iso3` (Natural Earth codes; Kosovo is `KOS`) or `conflict` (atlas conflict ids).
- A record value can carry a `series` of `{ year, value }`, with the years rising.
- `fetchedAt` is when these values were fetched. If a run finds the same values, the file is left untouched.
- `_status.json` records the last run of each source:
  - `state` is `ok`, `unchanged`, `skipped`, `error` or `unavailable`
  - `checkedAt` is when the source was last checked
  - `fetchedAt` is when the file in place was fetched
  
  It also holds a summary of the Wikidata drift.

`npm run check-data` validates every generated file: its shape, that its name matches `source`, that its keys are atlas countries or conflicts, that its indicators are declared, and that `prod:`/`reserves:` types exist in `resources.json`.

## Refresh the data

```sh
npm run data:update                          # all sources, plus the Wikidata drift
npm run data:update -- --only worldbank,ucdp # some sources (ids: worldbank, ucdp, unhcr, usgs, eia, wikidata)
npm run data:update -- --report report.md    # also write the pull request text
```

- **One source failing never breaks the run.** The previous file stays and the error goes to `_status.json` when a source:
  - throws
  - produces output that fails the same checks as `check-data`
  - comes back with more than 20% fewer records than the last good file, as happens when the newest year is only partly published
  
  The other sources still update.
- **EIA:** set `EIA_API_KEY` (free from [eia.gov/opendata](https://www.eia.gov/opendata/register.php)). Without it, EIA is skipped. The key is never written to a file or a log.
- **USGS by hand:** download `MCS2026_ALLchapters_Reconcile.csv` from the [data release](https://doi.org/10.5066/P1WKQ63T) in a browser, then run `USGS_MCS_CSV=path/to/file.csv npm run data:update -- --only usgs`.
  - When USGS publishes a new edition, set `USGS_ITEM` in `scripts/data/fetchers/usgs.ts` to the new ScienceBase item id, and update the DOI and citation there.
- **TLS behind a corporate proxy:** run with `NODE_OPTIONS=--use-system-ca`. Never turn TLS checks off.

## The weekly workflow

`.github/workflows/data-update.yml` runs every Monday at 05:23 UTC, and also on demand from the Actions tab.

1. **`fetch` job** (read-only token): runs `data:update`, then `check-data`, typecheck and the unit tests.
2. **`pull-request` job**: runs only if values changed, or if a source started failing. It opens or updates one pull request from the branch `data/weekly-update`. The pull request text is the report, which gives:
   - per source, how many values were added, changed or removed
   - the biggest changes
   - failures
   - the Wikidata bloc drift
3. **Nothing is merged or pushed to `main` by the bot.** The owner reviews and merges.

One-time setup for the owner:

- Settings › Actions › General › turn on **"Allow GitHub Actions to create and approve pull requests"**.
- Optional secret `EIA_API_KEY`.
- Optional secret `DATA_PR_TOKEN`: a fine-grained token with Contents and Pull requests write access to this repository. Pull requests opened with the default token do not start `ci.yml`. The workflow already runs the same checks, but with this token the normal CI runs too.

## UCDP mapping

Curated conflicts carry an optional `ucdp` field: a list of UCDP conflict ids (`conflict_new_id` in GED).

**How the deaths series is built:**

- The series sums GED deaths over those ids, year by year.
- It starts at the atlas conflict's `started` year (or 1989, when GED begins), from the first year with any deaths.
- Years with no recorded deaths count as zero.
- It ends at the last year GED covers.
- A conflict without `ucdp` shows no deaths figures.

**What the seed maps (November 2026):** UCDP's state-based conflicts, where one side is a government, that clearly are the atlas conflict. One-sided violence against civilians and fighting between non-state groups are not included yet. This can matter a lot. In Sudan in 2025, UCDP recorded about five times more deaths in one-sided violence than in the army–RSF conflict (id 309) that the atlas series shows. You may add non-state or one-sided ids; the series sums whatever ids are listed.

| Atlas conflict | UCDP ids (GED name, years with events) |
|---|---|
| `israel-palestine` | 234 Israel: Palestine (1989–2025) |
| `iran-us-israel` | 16905 Iran - Israel, United States of America (2026, candidate events only so far) |
| `syria-transition` | 299 Syria: Government (2011–2025); 13809 Syria: Government/Rojava Kurdistan (2015–2025) |
| `lebanon-israel` | 426 Israel: Southern Lebanon (1989–2025) |
| `yemen` | 230 Yemen (North Yemen): Government (2008–2025); 16099 United Kingdom, United States of America - Yemen (2023–2025); 16470 Israel - Yemen (2024–2025) |
| `iraq-kurdistan` | 271 Iraq: Kurdistan (1989–1996) |
| `turkey-kurdish` | 354 Turkey: Kurdistan (1989–2025) |
| `russia-ukraine` | 13243 Russia - Ukraine (2014–2025); 13306 Ukraine: Novorossiya (2014–2022); 13246 Ukraine: Donetsk (2014); 13247 Ukraine: Lugansk (2014) |
| `armenia-azerbaijan` | 388 Azerbaijan: Artsakh (Nagorno-Karabakh) (1991–2023) |
| `kosovo-serbia` | 412 Serbia (Yugoslavia): Kosovo (1996–1999) |
| `bosnia` | 389 Bosnia-Herzegovina: Serb (1992–1995); 398 Bosnia-Herzegovina: Croat (1992–1994); 397 Bosnia-Herzegovina: Bihaca Krajina (1992–1995) |
| `transnistria` | 394 Moldova: Dniestr (1992) |
| `georgia-breakaway` | 392 Georgia: Abkhazia (1992–2011); 393 Georgia: South Ossetia (1992–2008) |
| `basque-catalonia` | 342 Spain: Basque (1989–2009) |
| `northern-ireland` | 315 United Kingdom: Northern Ireland (1989–2019) |
| `kashmir` | 364 India: Kashmir (1989–2025); 218 India - Pakistan (1989–2025) |
| `afghanistan-pakistan` | 11639 Afghanistan - Pakistan (2005–2025) |
| `myanmar` | 222 Government; 223 Arakan; 231 Kachin; 221 Karen; 253 Karenni; 439 Kokang; 264 Shan; 224 Mon; 422 Wa; 11475 Nagaland (all "Myanmar (Burma): …") |
| `xinjiang` | 11349 China: East Turkestan (1990–2017) |
| `balochistan` | 325 Pakistan: Balochistan (2004–2025) |
| `sri-lanka-tamil` | 352 Sri Lanka (Ceylon): Eelam (1989–2009) |
| `sudan` | 309 Sudan: Government (from 2023, the atlas start year) |
| `ethiopia` | 267 Ethiopia: Government; 16069 Ethiopia: Government/Amhara; 413 Ethiopia: Oromiya (from 2020) |
| `sahel` | 11347 Mali: Government; 14113 Mali: Islamic State; 16038 Mali: Government/Azawad; 360 Burkina Faso: Government; 13840 Burkina Faso: Islamic State; 430 Niger: Government; 13639 Niger: Islamic State; 15256 Benin: Government; 358 Togo: Government (from 2012) |
| `drc-east` | 283 DR Congo (Zaire): Government; 14692 DR Congo (Zaire): Islamic State; 10771 DR Congo (Zaire) - Rwanda |
| `somalia` | 337 Somalia: Government; 14197 Somalia: Islamic State |
| `south-sudan` | 11345 South Sudan: Government (from 2013) |
| `western-sahara` | 331 Morocco: Sahrawi Arab Democratic Republic (Western Sahara) |
| `nigeria` | 297 Nigeria: Government; 13641 Nigeria: Islamic State (from 2009) |
| `rwanda-burundi-great-lakes` | 374 Rwanda: Government; 287 Burundi: Government |
| `venezuela` | 277 Venezuela: Government (no GED deaths since the 2019 start; candidate events only) |
| `haiti` | 381 Haiti: Government |
| `colombia` | 289 Colombia: Government |

**Not mapped:**

- No UCDP state-based conflict: `gulf-security`, `taiwan-strait`, `south-china-sea`, `tibet`, `korean-peninsula`, `essequibo`.
- `mexico-cartels`: UCDP codes cartel violence as dozens of non-state conflicts. Picking which ones to sum needs an editorial decision.

**Find or check an id:**

1. Download the GED CSV from [ucdp.uu.se/downloads](https://ucdp.uu.se/downloads/).
2. Filter by `country` and read `conflict_new_id` and `conflict_name`. You can also search the [UCDP Conflict Encyclopedia](https://ucdp.uu.se/).
3. Add the id to the conflict's `ucdp` list, run `npm run format-data` and `npm run check-data`, and open a pull request.

**Citation:** UCDP asks users to cite:

- Sundberg, Ralph and Erik Melander (2013), "Introducing the UCDP Georeferenced Event Dataset", *Journal of Peace Research* 50(4)
- for the candidate events, Hegre, Håvard, Mihai Croicu, Kristine Eck and Stina Högbladh (2020), "Introducing the UCDP Candidate Events Dataset", *Research & Politics* 7(3)

The citation travels in `ucdp.json` and shows on the Sources view.

## Wikidata bloc drift

Every run compares Wikidata's "member of" (P463) statements, with their start and end dates, to `relations.blocs`:

- Countries are matched by Natural Earth's Wikidata id, or by ISO code (P298).
- The bloc items are listed in `BLOC_QIDS` in `scripts/data/fetchers/wikidata.ts`. A test fails if a curated bloc has no item there.

The drift goes into the pull request text only. Some of it is Wikidata's own gaps, such as a member recorded on a different item. Treat it as a prompt to check, not as a correction.

## Add a source

1. Check that the licence allows publishing derived data in a public repository. If it doesn't, stop.
2. Write `scripts/data/fetchers/<id>.ts`. It exports a pure parser, which the tests call with a small fixture, and a `Fetcher` with this behaviour:
   - It returns a file in the shape above.
   - It returns `{ skip: 'reason' }` when it is not configured.
   - It throws on failure: `SourceUnavailable` when the site blocks scripts, and an ordinary error otherwise.
   - It uses `ctx.http` only. That client sends the User-Agent, retries, and redacts API keys from errors.
3. Add it to `FETCHERS` in `scripts/data/update.ts`, and its file to `GENERATED` in `src/data/files.ts`, in the same order. When two files carry the same figure, the earlier one wins.
4. If it feeds a new kind of figure, extend `CountryFigureId` in `src/data/figures.ts` and the join in `src/data/join.ts`.
5. Add a test `tests/data-<id>.test.ts`, with no network, and a row to the tables in this file. Then run `npm run data:update -- --only <id>`, `npm run check-data` and `npm test`.
