// Shapes of the data files (the fields the model reads) and of the linked model build() returns.
// Raw records keep every other field: features read them directly (e.g. conflict.history, choke.flow).

import type { Feature, FeatureCollection, Geometry } from 'geojson';
import type { Bi, Lang } from '../i18n/format';
import type { Kind } from '../config';
import type { CONFLICT_FILES } from './files';
import type { Figures } from './figures';

export type { Kind };
type Extra = { [k: string]: unknown };

// ---- raw files

export interface CountryProps extends Extra {
  iso3: string; iso_a2_eh?: string; name_ar?: string; name_en?: string; name_long?: string;
  type?: string; sovereignt?: string; continent?: string; subregion?: string; region_wb?: string;
  pop_est?: number; pop_year?: number; gdp_md?: number; gdp_year?: number; income_grp?: string; economy?: string;
  label_x?: number; label_y?: number; wikidataid?: string;
}
export interface IndexRow extends Extra { iso3: string; name?: string; nameAr?: string; lon?: number; lat?: number }
export interface DisputedProps extends Extra {
  brk_name?: string; name_en?: string; name_ar?: string; admin?: string; sovereignt?: string;
  claimant?: string; note_brk?: string; subregion?: string; label_x?: number; label_y?: number;
}
export interface RawConflict extends Extra {
  id: string; name: Bi; countries: string[]; severity: string; started?: string;
  externalPowers?: { iso3: string; role?: Bi; [k: string]: unknown }[];
  sourceRefs?: string[]; unverified?: boolean;
}
export interface ConflictFile extends Extra { region: string; regionName: Bi; statusAsOf?: string; conflicts: RawConflict[] }
export interface Intel extends Extra { blocs?: string[]; disputes?: Bi[]; unverified?: boolean }
export interface CountryReligionRaw extends Extra { groups: Record<string, number>; source?: string; year?: number; note?: Bi }
export interface Tradition extends Extra { id: string; ar: string; en: string }
export interface EthnicProps extends Extra {
  groupId: string; nameAr: string; nameEn: string; family: string; langAr?: string; langEn?: string;
  regionAr?: string; regionEn?: string; countries?: string[]; noteAr?: string; noteEn?: string;
}
export interface ResourceType extends Extra { id: string; ar: string; en: string; color?: string }
export interface ResourceEntry extends Extra { iso3: string; type: string; conflictIds?: string[] }
export interface Site extends Extra { id: string; iso3: string; type: string; ar: string; en: string; coords?: [number, number] }
export interface EdgeType extends Extra { id: string }
export interface Bloc extends Extra { id: string; ar: string; en: string; members: string[]; note?: Bi }
export interface RawEdge extends Extra { a: string; b: string; type: string; kind: string }
export interface Chokepoint extends Extra {
  id: string; ar: string; en: string; borderStates?: string[]; conflictIds?: string[]; coords?: [number, number]; unverified?: boolean;
}
export interface TimelineCategory extends Extra { id: string }
export interface RawEvent extends Extra {
  id: string; date: string; ar: string; en: string; countries?: string[]; conflictIds?: string[]; unverified?: boolean;
}
export interface Dataset extends Extra { id: string; file?: string }
export interface Reference extends Extra { id: string }
export interface Correction { id: string; where: Bi; what: Bi }

export type RawData = {
  countries: FeatureCollection<Geometry, CountryProps>;
  index: IndexRow[];
  boundaries: FeatureCollection;
  disputed: FeatureCollection<Geometry, DisputedProps>;
  choke: { points: Chokepoint[]; note?: Bi };
  intel: { countries: Record<string, Intel>; note?: Bi };
  ethnic: FeatureCollection<Geometry, EthnicProps> & { metadata?: unknown };
  relations: {
    edgeTypes: EdgeType[]; edgeKinds: unknown; blocs: Bloc[]; edges: RawEdge[]; bilateral: Record<string, unknown>;
  };
  religions: { traditions: Tradition[]; countries: Record<string, CountryReligionRaw>; coverageNote?: Bi; methodNote?: Bi };
  resources: { types: ResourceType[]; entries: ResourceEntry[]; sites: Site[]; note?: Bi; coverageNote?: Bi };
  sources: { datasets: Dataset[]; references: Reference[]; [k: string]: unknown };
  timeline: { range: unknown; categories: TimelineCategory[]; events: RawEvent[]; boundaryLimitation?: Bi };
  corrections?: Correction[];
} & { [K in (typeof CONFLICT_FILES)[number]]: ConflictFile };

// ---- linked model

export interface CountryReligion extends CountryReligionRaw {
  sorted: [string, number][]; majority: string | null; majorityShare: number;
  families: [string, number][]; majorityFamily: string | null; diversity: number;
}
export interface Country {
  iso3: string; iso2?: string; nameAr?: string; nameEn?: string; nameLong?: string;
  type?: string; sovereign?: string; continent?: string; subregion?: string; regionWb?: string;
  pop?: number; popYear?: number; gdp?: number; gdpYear?: number; income?: string; economy?: string;
  /** Generated source id (db.figures.sources) when pop/gdp come from the open-data pipeline (D10); absent = Natural Earth. */
  popSource?: string; gdpSource?: string;
  lon?: number; lat?: number; wikidata?: string; areaKm2: number; feature: Feature<Geometry, CountryProps>;
  gdpPerCap: number | null; density: number | null;
  intel: Intel | null; religion: CountryReligion | null; resources: ResourceEntry[];
  sites: string[]; conflicts: string[]; external: string[]; blocs: string[]; edges: string[];
  events: string[]; groups: string[]; chokepoints: string[]; neighbors: string[]; disputed: string[];
}
export interface Disputed {
  id: string; nameAr: string; nameEn: string; admin?: string; sovereign?: string; claimant?: string; note?: string;
  subregion?: string; lon?: number; lat?: number; feature: Feature<Geometry, DisputedProps>;
}
export interface Conflict extends RawConflict {
  region: string; regionName: Bi; startYear: number | null; rank: number; events: string[]; chokepoints: string[];
}
export interface Group {
  id: string; nameAr: string; nameEn: string; family: string; langAr?: string; langEn?: string;
  regionAr?: string; regionEn?: string; countries: string[]; noteAr?: string; noteEn?: string;
  features: Feature<Geometry, EthnicProps>[]; lon: number; lat: number;
}
export interface Edge extends RawEdge { id: string }
export interface TimelineEvent extends RawEvent { year: number }
export interface SearchEntry { kind: Kind; id: string; ar: string; en: string; subAr: string; subEn: string; n: string }

export interface DB {
  raw: RawData;
  corrections: Correction[];
  /** Open-data figures (M5); empty until the pipeline's files are present. */
  figures: Figures;
  isUnverified(kind: Kind, id: string): boolean;
  features: Feature<Geometry, CountryProps>[];
  countries: Map<string, Country>;
  boundaries: Feature[];
  disputed: Disputed[];
  disputedById: Map<string, Disputed>;
  conflicts: Conflict[];
  conflictById: Map<string, Conflict>;
  conflictsAsOf?: string;
  intelNote?: Bi;
  religion: {
    traditions: Tradition[]; traditionById: Map<string, Tradition>; families: typeof import('../config').RELIGION_FAMILIES;
    familyOf: Record<string, string>; coverageNote?: Bi; methodNote?: Bi; countries: Record<string, CountryReligionRaw>;
  };
  ethnic: { features: Feature<Geometry, EthnicProps>[]; meta: unknown; groups: Map<string, Group>; families: string[] };
  resources: {
    types: ResourceType[]; typeById: Map<string, ResourceType>; classes: typeof import('../config').RESOURCE_CLASSES;
    classOf: Record<string, string>; entries: ResourceEntry[]; sites: Site[]; note?: Bi; coverageNote?: Bi;
  };
  siteById: Map<string, Site>;
  relations: {
    edgeTypes: EdgeType[]; edgeTypeById: Map<string, EdgeType>; edgeKinds: unknown;
    blocs: Bloc[]; blocById: Map<string, Bloc>; edges: Edge[]; bilateral: Record<string, unknown>;
  };
  bilateralFor(a: string, b: string): unknown;
  edgesBetween(a: string, b: string): Edge[];
  edgeById: Map<string, Edge>;
  chokepoints: Chokepoint[];
  chokeNote?: Bi;
  chokeById: Map<string, Chokepoint>;
  timeline: {
    range: unknown; categories: TimelineCategory[]; catById: Map<string, TimelineCategory>;
    boundaryLimitation?: Bi; events: TimelineEvent[];
  };
  eventById: Map<string, TimelineEvent>;
  sources: RawData['sources'];
  datasetById: Map<string, Dataset>;
  referenceById: Map<string, Reference>;
  get(kind: Kind, id: string): unknown;
  exists(kind: Kind, id: string): boolean;
  countriesOf(kind: Kind, id: string): string[];
  anchorOf(kind: Kind, id: string): [number, number] | null;
  nameOf(kind: Kind, id: string, lang: Lang): string;
  searchIndex: SearchEntry[];
  search(q: string, limit?: number): SearchEntry[];
  stats: Record<'countries' | 'conflicts' | 'groups' | 'religionCountries' | 'edges' | 'blocs' | 'events' | 'chokepoints' | 'sites' | 'disputed', number>;
}
