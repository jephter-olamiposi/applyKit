/**
 * @fileoverview Deterministic Job Salary & Compensation Benchmark Extractor.
 *
 * Extracts structured compensation data (minimum, maximum, currency, pay period,
 * and equity mentions) from raw job posting descriptions without external AI calls.
 */

/**
 * Pay frequency period for the compensation figure.
 */
export type PayPeriod = 'year' | 'month' | 'hour';

/**
 * Structured compensation insight parsed from job postings.
 */
export interface JobSalaryInsight {
  /** Currency symbol or code (e.g. '$', '£', '€', 'USD', 'GBP'). */
  readonly currency: string;
  /** Minimum annual or hourly compensation figure if provided. */
  readonly minAmount?: number;
  /** Maximum annual or hourly compensation figure if provided. */
  readonly maxAmount?: number;
  /** Compensation frequency. */
  readonly period: PayPeriod;
  /** Exact raw substring matched from the description. */
  readonly rawMatch: string;
  /** Flag indicating whether equity, stock options, or RSUs were identified. */
  readonly equityMentioned: boolean;
  /** Additional identified compensation perks (e.g. '401(k) match', 'bonus'). */
  readonly benefits: readonly string[];
  /** Human-readable formatted compensation range (e.g. '$140,000 – $180,000 / year'). */
  readonly formattedDisplay: string;
}

/**
 * Currency symbol mapping to standard ISO code.
 */
const CURRENCY_SYMBOLS: Record<string, string> = {
  $: 'USD',
  '£': 'GBP',
  '€': 'EUR',
  'CA$': 'CAD',
  'A$': 'AUD',
};

/**
 * Normalizes string number with commas or 'k' suffixes (e.g. '150k' -> 150000, '150,000' -> 150000).
 */
function parseSalaryNumber(raw: string): number | undefined {
  const cleaned = raw.trim().toLowerCase().replace(/,/g, '');
  if (cleaned.endsWith('k')) {
    const val = parseFloat(cleaned.slice(0, -1));
    return isNaN(val) ? undefined : Math.round(val * 1000);
  }
  const val = parseFloat(cleaned);
  return isNaN(val) ? undefined : Math.round(val);
}

/**
 * Common equity and bonus phrases to search for.
 */
const EQUITY_PATTERNS = [
  /\b(?:equity|stock options|rsu|rsus|shares|stock grants)\b/i,
];

const BENEFIT_PATTERNS: ReadonlyArray<{ name: string; regex: RegExp }> = [
  { name: '401(k) Matching', regex: /\b(?:401\(k\)(?:\s+match)?|pension scheme)\b/i },
  { name: 'Annual Performance Bonus', regex: /\b(?:annual bonus|performance bonus|target bonus)\b/i },
  { name: 'Health, Dental & Vision', regex: /\b(?:health insurance|medical,? dental,? and vision|health coverage)\b/i },
  { name: 'Unlimited PTO', regex: /\b(?:unlimited (?:pto|vacation|time off)|flexible pto)\b/i },
  { name: 'Learning & Development Stipend', regex: /\b(?:learning stipend|education stipend|conference budget)\b/i },
];

/**
 * Primary regex patterns matching salary ranges:
 * 1. $120,000 - $180,000 / year (or per year, annually)
 * 2. £80,000 - £110,000
 * 3. $60 - $85 / hour
 * 4. $130k - $160k
 */
const SALARY_RANGE_REGEX =
  /(?:(?:salary|compensation|pay|rate|package)[:\s]*)?([$£€]|(?:usd|gbp|eur|cad|aud)\s+)?(\d{1,3}(?:,\d{3})*k|\d{1,3}k|\d{1,3}(?:,\d{3})*|\d{1,3})(?:\s*(?:-|–|—|to)\s*)([$£€]|(?:usd|gbp|eur|cad|aud)\s+)?(\d{1,3}(?:,\d{3})*k|\d{1,3}k|\d{1,3}(?:,\d{3})*|\d{1,3})\s*(?:(\/|\bper\b|\ba\b)\s*(year|yr|annum|annually|month|mo|hour|hr))?/i;

const SINGLE_SALARY_REGEX =
  /(?:(?:salary|compensation|pay|rate)[:\s]+)([$£€]|(?:usd|gbp|eur|cad|aud)\s+)?(\d{1,3}(?:,\d{3})*k|\d{1,3}k|\d{1,3}(?:,\d{3})*|\d{1,3})\s*(?:(\/|\bper\b|\ba\b)\s*(year|yr|annum|annually|month|mo|hour|hr))?/i;

/**
 * Extracts structured compensation details from raw job posting text.
 *
 * @param description Raw job description or posting content.
 * @returns Parsed salary insight or null if no compensation data was detected.
 */
export function extractSalaryFromDescription(description: string): JobSalaryInsight | null {
  if (!description || typeof description !== 'string') {
    return null;
  }

  // Detect equity mention
  const equityMentioned = EQUITY_PATTERNS.some((pattern) => pattern.test(description));

  // Detect identified perks and benefits
  const benefits: string[] = [];
  for (const benefit of BENEFIT_PATTERNS) {
    if (benefit.regex.test(description)) {
      benefits.push(benefit.name);
    }
  }

  // Attempt range match
  const rangeMatch = description.match(SALARY_RANGE_REGEX);
  if (rangeMatch) {
    const rawCurrency = (rangeMatch[1] || rangeMatch[3] || '$').trim();
    const currency = CURRENCY_SYMBOLS[rawCurrency] || rawCurrency.toUpperCase() || 'USD';
    const num1 = parseSalaryNumber(rangeMatch[2] || '');
    const num2 = parseSalaryNumber(rangeMatch[4] || '');

    const rawPeriod = (rangeMatch[6] || '').toLowerCase();
    let period: PayPeriod = 'year';
    if (rawPeriod === 'hour' || rawPeriod === 'hr') {
      period = 'hour';
    } else if (rawPeriod === 'month' || rawPeriod === 'mo') {
      period = 'month';
    } else if (num1 && num1 < 250 && num2 && num2 < 250) {
      // Heuristic: numbers below 250 with no explicit period on compensation are almost certainly hourly rates
      period = 'hour';
    }

    if (num1 !== undefined && num2 !== undefined) {
      const minAmount = Math.min(num1, num2);
      const maxAmount = Math.max(num1, num2);

      const symbol = rawCurrency.length === 1 ? rawCurrency : `${currency} `;
      const periodLabel = period === 'hour' ? '/ hr' : period === 'month' ? '/ mo' : '/ yr';
      const formattedDisplay = `${symbol}${minAmount.toLocaleString()} – ${symbol}${maxAmount.toLocaleString()} ${periodLabel}`;

      return {
        currency,
        minAmount,
        maxAmount,
        period,
        rawMatch: rangeMatch[0].trim(),
        equityMentioned,
        benefits,
        formattedDisplay,
      };
    }
  }

  // Attempt single figure match (e.g. "Salary: $150,000 / year")
  const singleMatch = description.match(SINGLE_SALARY_REGEX);
  if (singleMatch) {
    const rawCurrency = (singleMatch[1] || '$').trim();
    const currency = CURRENCY_SYMBOLS[rawCurrency] || rawCurrency.toUpperCase() || 'USD';
    const amount = parseSalaryNumber(singleMatch[2] || '');

    const rawPeriod = (singleMatch[4] || '').toLowerCase();
    let period: PayPeriod = 'year';
    if (rawPeriod === 'hour' || rawPeriod === 'hr') {
      period = 'hour';
    } else if (rawPeriod === 'month' || rawPeriod === 'mo') {
      period = 'month';
    } else if (amount && amount < 250) {
      period = 'hour';
    }

    if (amount !== undefined) {
      const symbol = rawCurrency.length === 1 ? rawCurrency : `${currency} `;
      const periodLabel = period === 'hour' ? '/ hr' : period === 'month' ? '/ mo' : '/ yr';
      const formattedDisplay = `${symbol}${amount.toLocaleString()} ${periodLabel}`;

      return {
        currency,
        minAmount: amount,
        maxAmount: amount,
        period,
        rawMatch: singleMatch[0].trim(),
        equityMentioned,
        benefits,
        formattedDisplay,
      };
    }
  }

  // If equity or benefits were identified even without explicit salary numbers
  if (equityMentioned || benefits.length > 0) {
    return {
      currency: 'USD',
      period: 'year',
      rawMatch: 'Benefits / Equity mentioned in description',
      equityMentioned,
      benefits,
      formattedDisplay: equityMentioned ? 'Competitive Base + Equity' : 'Competitive Compensation',
    };
  }

  return null;
}
