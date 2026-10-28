/**
 * @fileoverview Recognizes the countries and regions a job posting is open to.
 *
 * Job boards rarely say "US only". They say "Remote (UK)", "Remote within Canada or
 * United States", "San Francisco, CA", or "Remote (EMEA)". This module turns those
 * phrasings into a set of places and answers one question: does that set include the
 * candidate's country? It is deliberately small and literal. A place it does not know
 * is ignored rather than guessed, so an unknown location never blocks anyone.
 */

/** A region a posting can name instead of a country. */
export type GeoRegion = 'global' | 'emea' | 'europe' | 'eu' | 'africa' | 'americas' | 'north_america' | 'latam' | 'apac';

interface CountryEntry {
  readonly name: string;
  readonly aliases: readonly string[];
  readonly regions: readonly GeoRegion[];
}

const EU: GeoRegion[] = ['emea', 'europe', 'eu'];
const EUROPE: GeoRegion[] = ['emea', 'europe'];
const AFRICA: GeoRegion[] = ['emea', 'africa'];
const MIDDLE_EAST: GeoRegion[] = ['emea'];
const LATAM: GeoRegion[] = ['americas', 'latam'];
const APAC: GeoRegion[] = ['apac'];

/** Countries that commonly appear in job locations, with the regions they belong to. */
const COUNTRIES: readonly CountryEntry[] = [
  { name: 'United States', aliases: ['united states', 'united states of america', 'usa', 'u.s.a.', 'u.s.', 'us'], regions: ['americas', 'north_america'] },
  { name: 'Canada', aliases: ['canada'], regions: ['americas', 'north_america'] },
  { name: 'Mexico', aliases: ['mexico'], regions: ['americas', 'north_america', 'latam'] },
  { name: 'Brazil', aliases: ['brazil', 'brasil'], regions: LATAM },
  { name: 'Argentina', aliases: ['argentina'], regions: LATAM },
  { name: 'Colombia', aliases: ['colombia'], regions: LATAM },
  { name: 'Chile', aliases: ['chile'], regions: LATAM },
  { name: 'United Kingdom', aliases: ['united kingdom', 'uk', 'u.k.', 'great britain', 'britain', 'england', 'scotland', 'wales', 'northern ireland'], regions: EUROPE },
  { name: 'Ireland', aliases: ['ireland'], regions: EU },
  { name: 'Germany', aliases: ['germany', 'deutschland'], regions: EU },
  { name: 'France', aliases: ['france'], regions: EU },
  { name: 'Netherlands', aliases: ['netherlands', 'the netherlands', 'holland'], regions: EU },
  { name: 'Spain', aliases: ['spain'], regions: EU },
  { name: 'Portugal', aliases: ['portugal'], regions: EU },
  { name: 'Italy', aliases: ['italy'], regions: EU },
  { name: 'Poland', aliases: ['poland'], regions: EU },
  { name: 'Sweden', aliases: ['sweden'], regions: EU },
  { name: 'Denmark', aliases: ['denmark'], regions: EU },
  { name: 'Finland', aliases: ['finland'], regions: EU },
  { name: 'Belgium', aliases: ['belgium'], regions: EU },
  { name: 'Austria', aliases: ['austria'], regions: EU },
  { name: 'Czechia', aliases: ['czechia', 'czech republic'], regions: EU },
  { name: 'Romania', aliases: ['romania'], regions: EU },
  { name: 'Greece', aliases: ['greece'], regions: EU },
  { name: 'Estonia', aliases: ['estonia'], regions: EU },
  { name: 'Norway', aliases: ['norway'], regions: EUROPE },
  { name: 'Switzerland', aliases: ['switzerland'], regions: EUROPE },
  { name: 'Serbia', aliases: ['serbia'], regions: EUROPE },
  { name: 'Ukraine', aliases: ['ukraine'], regions: EUROPE },
  { name: 'Turkey', aliases: ['turkey', 'türkiye'], regions: EUROPE },
  { name: 'Israel', aliases: ['israel'], regions: MIDDLE_EAST },
  { name: 'United Arab Emirates', aliases: ['united arab emirates', 'uae', 'dubai'], regions: MIDDLE_EAST },
  { name: 'Saudi Arabia', aliases: ['saudi arabia'], regions: MIDDLE_EAST },
  { name: 'Nigeria', aliases: ['nigeria'], regions: AFRICA },
  { name: 'Ghana', aliases: ['ghana'], regions: AFRICA },
  { name: 'Kenya', aliases: ['kenya'], regions: AFRICA },
  { name: 'South Africa', aliases: ['south africa'], regions: AFRICA },
  { name: 'Egypt', aliases: ['egypt'], regions: AFRICA },
  { name: 'Morocco', aliases: ['morocco'], regions: AFRICA },
  { name: 'Rwanda', aliases: ['rwanda'], regions: AFRICA },
  { name: 'Uganda', aliases: ['uganda'], regions: AFRICA },
  { name: 'Senegal', aliases: ['senegal'], regions: AFRICA },
  { name: 'India', aliases: ['india'], regions: APAC },
  { name: 'Pakistan', aliases: ['pakistan'], regions: APAC },
  { name: 'Singapore', aliases: ['singapore'], regions: APAC },
  { name: 'Japan', aliases: ['japan'], regions: APAC },
  { name: 'South Korea', aliases: ['south korea', 'korea'], regions: APAC },
  { name: 'Australia', aliases: ['australia'], regions: APAC },
  { name: 'New Zealand', aliases: ['new zealand'], regions: APAC },
  { name: 'Philippines', aliases: ['philippines'], regions: APAC },
  { name: 'Indonesia', aliases: ['indonesia'], regions: APAC },
  { name: 'Vietnam', aliases: ['vietnam'], regions: APAC },
  { name: 'China', aliases: ['china'], regions: APAC },
];

const REGION_ALIASES: Record<GeoRegion, readonly string[]> = {
  global: ['global', 'worldwide', 'anywhere', 'anywhere in the world', 'work from anywhere', 'fully distributed'],
  emea: ['emea'],
  europe: ['europe', 'european'],
  eu: ['eu', 'european union'],
  africa: ['africa', 'african'],
  americas: ['americas'],
  north_america: ['north america', 'namer'],
  latam: ['latam', 'latin america', 'south america'],
  apac: ['apac', 'asia pacific', 'asia-pacific', 'asia'],
};

/** Big cities that appear alone in location fields ("London", "Berlin"). */
const CITY_TO_COUNTRY: Record<string, string> = {
  london: 'United Kingdom', cardiff: 'United Kingdom', manchester: 'United Kingdom', edinburgh: 'United Kingdom',
  dublin: 'Ireland', berlin: 'Germany', munich: 'Germany', paris: 'France', amsterdam: 'Netherlands',
  madrid: 'Spain', barcelona: 'Spain', lisbon: 'Portugal', warsaw: 'Poland', stockholm: 'Sweden',
  toronto: 'Canada', vancouver: 'Canada', montreal: 'Canada',
  'new york': 'United States', 'san francisco': 'United States', seattle: 'United States', austin: 'United States',
  boston: 'United States', chicago: 'United States', portland: 'United States', denver: 'United States',
  lagos: 'Nigeria', abuja: 'Nigeria', accra: 'Ghana', nairobi: 'Kenya', 'cape town': 'South Africa',
  bangalore: 'India', bengaluru: 'India', singapore: 'Singapore', sydney: 'Australia', tokyo: 'Japan',
};

const US_STATES = new Set(
  'AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.split(' ')
);
const CA_PROVINCES = new Set('AB BC MB NB NL NS NT NU ON PE QC SK YT'.split(' '));

/** What a piece of location text names. */
export interface PlaceSet {
  readonly countries: ReadonlySet<string>;
  readonly regions: ReadonlySet<GeoRegion>;
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordRegex = (alias: string) => new RegExp(`(^|[^a-z])${escape(alias)}(?=$|[^a-z])`, 'i');

/**
 * Lists the countries and regions named in `text`. Two-letter aliases ("US", "UK",
 * "EU") only count in upper case, so ordinary words ("us", "eu-") are not read as places.
 */
export function findPlaces(text: string): PlaceSet {
  const countries = new Set<string>();
  const regions = new Set<GeoRegion>();
  const lower = text.toLowerCase();

  for (const country of COUNTRIES) {
    for (const alias of country.aliases) {
      const short = alias.replace(/\./g, '').length <= 2;
      const hit = short ? new RegExp(`(^|[^A-Za-z])${escape(alias.toUpperCase())}(?=$|[^A-Za-z])`).test(text) : wordRegex(alias).test(lower);
      if (hit) {
        countries.add(country.name);
        break;
      }
    }
  }
  for (const [region, aliases] of Object.entries(REGION_ALIASES) as [GeoRegion, readonly string[]][]) {
    for (const alias of aliases) {
      const hit = alias.length <= 2 ? new RegExp(`(^|[^A-Za-z])${alias.toUpperCase()}(?=$|[^A-Za-z])`).test(text) : wordRegex(alias).test(lower);
      if (hit) {
        regions.add(region);
        break;
      }
    }
  }
  for (const [city, country] of Object.entries(CITY_TO_COUNTRY)) {
    if (wordRegex(city).test(lower)) countries.add(country);
  }
  // "Portland, OR" / "Toronto, ON": a trailing state or province code names the country.
  for (const match of text.matchAll(/,\s*([A-Z]{2})(?=$|[^A-Za-z])/g)) {
    const code = match[1]!;
    if (US_STATES.has(code)) countries.add('United States');
    else if (CA_PROVINCES.has(code)) countries.add('Canada');
  }
  return { countries, regions };
}

/** Canonical country name for what a candidate typed ("NG", "nigeria", "USA"). */
export function canonicalCountry(input: string | undefined): string | undefined {
  const value = (input ?? '').trim();
  if (!value) return undefined;
  const lower = value.toLowerCase();
  const entry = COUNTRIES.find((country) => country.name.toLowerCase() === lower || country.aliases.includes(lower));
  if (entry) return entry.name;
  if (lower === 'ng') return 'Nigeria';
  return value;
}

/** True when the place set names nothing at all. */
export function isEmptyPlaceSet(places: PlaceSet): boolean {
  return places.countries.size === 0 && places.regions.size === 0;
}

/** True when the candidate's country is inside what the posting names. */
export function placesInclude(places: PlaceSet, candidateCountry: string): boolean {
  if (places.regions.has('global')) return true;
  const country = canonicalCountry(candidateCountry);
  if (!country) return false;
  if (places.countries.has(country)) return true;
  const entry = COUNTRIES.find((item) => item.name === country);
  return Boolean(entry && entry.regions.some((region) => places.regions.has(region)));
}

/** Human list of what the posting names, for explanations ("United Kingdom", "Canada or United States"). */
export function describePlaces(places: PlaceSet): string {
  const names = [...places.countries, ...[...places.regions].map((region) => region.toUpperCase().replace('_', ' '))];
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
}
