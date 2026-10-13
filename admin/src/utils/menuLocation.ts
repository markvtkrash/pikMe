// Region (state) and city filters for the admin Menu Management list. Pure helpers so the rules can be tested.

export interface LocationRow {
  city?: string | null;
  state?: string | null;
  // How many restaurants this row stands for (default 1). A grouped list, one row per city, sets it.
  count?: number | null;
}

export interface LocationOption {
  value: string;   // what is stored when it is picked
  label: string;   // what is shown
  count: number;   // restaurants with it
}

function key(text: string | null | undefined): string {
  return (text ?? '').trim().toLowerCase();
}

function weight(row: LocationRow): number {
  return typeof row.count === 'number' && row.count > 0 ? row.count : 1;
}

// Counts by value, ignoring case and spaces; the most common spelling is shown. Sorted by label.
function countBy(entries: { value: string | null | undefined; weight: number }[]): LocationOption[] {
  const groups = new Map<string, { spellings: Map<string, number>; count: number }>();
  for (const { value: raw, weight: w } of entries) {
    const k = key(raw);
    if (!k) continue;
    const spelling = (raw as string).trim();
    const g = groups.get(k) ?? { spellings: new Map(), count: 0 };
    g.count += w;
    g.spellings.set(spelling, (g.spellings.get(spelling) ?? 0) + w);
    groups.set(k, g);
  }
  return Array.from(groups.entries())
    .map(([k, g]) => {
      const label = Array.from(g.spellings.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
      return { value: k, label, count: g.count };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

// The regions (states) that exist in the list, with how many restaurants each has. Their value is the lower-case text.
export function buildStateOptions(rows: LocationRow[]): LocationOption[] {
  return countBy(rows.map((r) => ({ value: r.state, weight: weight(r) })));
}

// The cities that exist in the list, narrowed to the chosen region when there is one.
export function buildCityOptions(rows: LocationRow[], state: string): LocationOption[] {
  const wanted = key(state);
  return countBy(rows.filter((r) => !wanted || key(r.state) === wanted).map((r) => ({ value: r.city, weight: weight(r) })));
}

// Does a restaurant pass the region and city filters? With neither set everything passes. With one set, a restaurant with no
// city or state (a franchise, or an address that could not be read) does not.
export function matchesLocation(row: LocationRow, state: string, city: string): boolean {
  const wantedState = key(state);
  const wantedCity = key(city);
  if (wantedState && key(row.state) !== wantedState) return false;
  if (wantedCity && key(row.city) !== wantedCity) return false;
  return true;
}

// If the chosen city is not in the chosen region, the city filter is dropped (returned as '').
export function validCity(rows: LocationRow[], state: string, city: string): string {
  if (!key(city)) return '';
  return buildCityOptions(rows, state).some((o) => o.value === key(city)) ? city : '';
}

// The text on a filter button: "Region: All" or "Region: TX".
export function filterButtonLabel(name: string, value: string, options: LocationOption[]): string {
  const hit = options.find((o) => o.value === key(value));
  return `${name}: ${hit ? hit.label : 'All'}`;
}

// How many restaurants have no city or state, and so are hidden once a filter is on.
export function countWithoutLocation(rows: LocationRow[]): number {
  return rows.filter((r) => !key(r.city) && !key(r.state)).reduce((sum, r) => sum + weight(r), 0);
}
