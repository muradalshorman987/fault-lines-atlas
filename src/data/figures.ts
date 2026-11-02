// Figures from the open-data pipeline (M5): latest values per country and yearly series per conflict.
// Until the pipeline's files are loaded this is empty, so consumers can rely on the shape from day one.

export interface Figure { value: number; year: number; source: string; unit?: string }
export type CountryFigureId = 'population' | 'gdp' | 'gdpPerCapita' | 'refugeesFrom' | 'refugeesIn' | 'idps';
export interface FigureSource { id: string; name: string; licence: string; url: string; fetchedAt: string }

export interface Figures {
  country(iso3: string): Partial<Record<CountryFigureId, Figure>>;
  conflictDeaths(id: string): { year: number; value: number }[];
  sources: FigureSource[];
}

export function emptyFigures(): Figures {
  return { country: () => ({}), conflictDeaths: () => [], sources: [] };
}
