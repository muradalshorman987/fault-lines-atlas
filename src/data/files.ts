// Data files the atlas loads, relative to public/data/. Kept apart from load.ts so Node scripts can import it.

export const FILES = {
  countries: 'geo/countries.json',
  index: 'geo/country_index.json',
  boundaries: 'geo/boundary_lines.json',
  disputed: 'geo/disputed_areas.json',
  choke: 'curated/chokepoints.json',
  intel: 'curated/country_intel.json',
  ethnic: 'curated/ethnic_groups.json',
  relations: 'curated/relations.json',
  religions: 'curated/religions.json',
  resources: 'curated/resources.json',
  sources: 'curated/sources.json',
  timeline: 'curated/timeline.json',
  cAfrica: 'curated/conflicts/africa.json',
  cAmericas: 'curated/conflicts/americas.json',
  cAsia: 'curated/conflicts/asia.json',
  cEurope: 'curated/conflicts/europe.json',
  cMideast: 'curated/conflicts/middle-east.json',
  corrections: 'curated/corrections.json',
} as const;

export type FileKey = keyof typeof FILES;

/** Open-data files from the weekly pipeline (scripts/data). Optional: they load after the core files, and a missing one is skipped.
 *  When two files carry the same figure, the earlier one here wins. */
export const GENERATED = {
  worldbank: 'generated/worldbank.json',
  ucdp: 'generated/ucdp.json',
  unhcr: 'generated/unhcr.json',
  usgs: 'generated/usgs.json',
  eia: 'generated/eia.json',
} as const;

/** Written by every pipeline run. The loader fetches only the GENERATED files it lists with a `fetchedAt` (a file in place),
 *  so a source that has never produced one (blocked, or no API key) costs no request and no 404. */
export const GENERATED_STATUS = 'generated/_status.json';
export const CONFLICT_FILES = ['cMideast', 'cEurope', 'cAsia', 'cAfrica', 'cAmericas'] as const;
