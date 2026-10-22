/**
 * @fileoverview Option Matching Engine for Choice Form Fields.
 *
 * Resolves candidate profile values (booleans, country names, EEO self-disclosures)
 * to arbitrary third-party select options, radio button values, and custom dropdowns
 * without resorting to unpredictable LLM calls.
 */

import type { SelectOption } from './application-field.js';
import type { CanonicalFieldKey } from './canonical-fields.js';

/**
 * Strategy used to resolve the choice option.
 */
export type OptionMatchStrategy =
  | 'exact'
  | 'boolean'
  | 'synonym'
  | 'fuzzy'
  | 'fallback';

/**
 * Outcome of matching a candidate value against discrete field options.
 */
export interface OptionMatchResult {
  readonly matchedOption: SelectOption | null;
  readonly confidence: number;
  readonly strategy: OptionMatchStrategy;
  readonly rationale: string;
}

/**
 * Common country name and code equivalents.
 */
const COUNTRY_SYNONYMS: readonly (readonly string[])[] = [
  ['us', 'usa', 'united states', 'united states of america', 'american'],
  ['ca', 'can', 'canada', 'canadian'],
  ['uk', 'gb', 'gbr', 'united kingdom', 'great britain', 'british', 'english', 'scottish', 'welsh'],
  ['de', 'deu', 'germany', 'deutschland', 'german'],
  ['fr', 'fra', 'france', 'french'],
  ['au', 'aus', 'australia', 'australian'],
  ['in', 'ind', 'india', 'indian'],
  ['ng', 'nga', 'nigeria', 'nigerian'],
  ['br', 'bra', 'brazil', 'brazilian'],
];

/**
 * Normalizes text for option comparison by stripping punctuation and extraneous whitespace.
 */
function normalizeOptionText(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[-_]+/g, ' ')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Computes whether two tokens are a close typo match (Levenshtein distance <= 2).
 */
function isFuzzyTypoMatch(wordA: string, wordB: string): boolean {
  if (wordA === wordB) return true;
  if (Math.abs(wordA.length - wordB.length) > 2) return false;

  let prevRow = Array.from({ length: wordB.length + 1 }, (_, i) => i);
  for (let i = 0; i < wordA.length; i++) {
    const curRow = [i + 1];
    for (let j = 0; j < wordB.length; j++) {
      const cost = wordA[i] === wordB[j] ? 0 : 1;
      curRow.push(Math.min(curRow[j]! + 1, prevRow[j + 1]! + 1, prevRow[j]! + cost));
    }
    prevRow = curRow;
  }
  const dist = prevRow[wordB.length]!;
  return dist <= (Math.max(wordA.length, wordB.length) >= 7 ? 2 : 1);
}

/**
 * Resolves a candidate target value against a list of available select/radio options.
 *
 * Grounding Invariant: The resolver will never make wild guesses. If no option matches with
 * sufficient confidence, it returns null, signaling that the candidate must review this field.
 *
 * @param options Available choices detected in the form.
 * @param targetValue The candidate's recorded attribute value.
 * @param fieldKey Optional canonical field key providing domain context.
 * @returns Best matching option result with confidence score.
 */
export function matchFieldOption(
  options: readonly SelectOption[],
  targetValue: string | boolean | number,
  fieldKey?: CanonicalFieldKey
): OptionMatchResult {
  if (options.length === 0) {
    return {
      matchedOption: null,
      confidence: 0,
      strategy: 'fallback',
      rationale: 'Field provides zero select options.',
    };
  }

  // Filter out dummy/placeholder options like "Select an option", "Choose...", "---"
  const validOptions = options.filter((opt) => {
    const norm = normalizeOptionText(opt.label || opt.value);
    return (
      norm &&
      !norm.startsWith('select') &&
      !norm.startsWith('choose') &&
      !norm.startsWith('please select') &&
      norm !== '' &&
      norm !== '-'
    );
  });

  const candidates = validOptions.length > 0 ? validOptions : options;

  // Boolean intent resolution
  const isTargetBool = typeof targetValue === 'boolean';
  const targetStr = String(targetValue).trim().toLowerCase();
  const isBoolIntent =
    isTargetBool ||
    targetStr === 'true' ||
    targetStr === 'false' ||
    targetStr === 'yes' ||
    targetStr === 'no';

  if (isBoolIntent) {
    const wantPositive = isTargetBool
      ? targetValue
      : targetStr === 'true' || targetStr === 'yes' || targetStr === '1';

    const positivePattern = /^(yes|true|authorized|agree|acknowledge|confirm|i\s+am|i\s+do|require|1)\b/i;
    const negativePattern = /^(no|false|not\s+authorized|disagree|i\s+do\s+not|do\s+not\s+require|0)\b/i;
    const pattern = wantPositive ? positivePattern : negativePattern;

    for (const opt of candidates) {
      const textToTest = `${opt.label} ${opt.value}`.trim();
      if (pattern.test(textToTest)) {
        return {
          matchedOption: opt,
          confidence: 0.95,
          strategy: 'boolean',
          rationale: `Resolved boolean intent (${wantPositive ? 'Yes/True' : 'No/False'}) to option '${opt.label}'`,
        };
      }
    }
  }

  // Exact value or label match
  const normTarget = normalizeOptionText(String(targetValue));
  for (const opt of candidates) {
    const normVal = normalizeOptionText(opt.value);
    const normLbl = normalizeOptionText(opt.label);
    if (normTarget === normVal || normTarget === normLbl) {
      return {
        matchedOption: opt,
        confidence: 1.0,
        strategy: 'exact',
        rationale: `Exact match on option ${normTarget === normVal ? 'value' : 'label'} '${normTarget}'`,
      };
    }
  }

  // Country and region synonym matching
  if (fieldKey === 'country') {
    for (const group of COUNTRY_SYNONYMS) {
      if (group.includes(normTarget)) {
        for (const opt of candidates) {
          const normLbl = normalizeOptionText(opt.label);
          const normVal = normalizeOptionText(opt.value);
          if (group.includes(normLbl) || group.includes(normVal)) {
            return {
              matchedOption: opt,
              confidence: 0.92,
              strategy: 'synonym',
              rationale: `Matched country synonym '${normTarget}' to option '${opt.label}'`,
            };
          }
        }
      }
    }
  }

  // EEO self-disclosure normalization
  if (fieldKey === 'eeo_gender') {
    const isMale = normTarget === 'male' || normTarget === 'man';
    const isFemale = normTarget === 'female' || normTarget === 'woman';
    const isDecline = normTarget.includes('decline') || normTarget.includes('prefer not');

    for (const opt of candidates) {
      const text = normalizeOptionText(`${opt.label} ${opt.value}`);
      if (isMale && (/\bman\b/.test(text) || /\bmale\b/.test(text)) && !/\bfemale\b/.test(text)) {
        return {
          matchedOption: opt,
          confidence: 0.92,
          strategy: 'synonym',
          rationale: `Matched gender identity '${targetValue}' to option '${opt.label}'`,
        };
      }
      if (isFemale && (/\bwoman\b/.test(text) || /\bfemale\b/.test(text))) {
        return {
          matchedOption: opt,
          confidence: 0.92,
          strategy: 'synonym',
          rationale: `Matched gender identity '${targetValue}' to option '${opt.label}'`,
        };
      }
      if (isDecline && (text.includes('decline') || text.includes('prefer not') || text.includes('do not wish'))) {
        return {
          matchedOption: opt,
          confidence: 0.95,
          strategy: 'synonym',
          rationale: `Matched decline self-disclosure option '${opt.label}'`,
        };
      }
    }
  }

  // Compound token splitting, substring inclusion, and typo-tolerant matching
  if (normTarget.length >= 3) {
    const targetTokens = normTarget.split(/\s+/).filter(Boolean);

    for (const opt of candidates) {
      const normLbl = normalizeOptionText(opt.label);
      const normVal = normalizeOptionText(opt.value);
      const optTokens = [...normLbl.split(/\s+/), ...normVal.split(/\s+/)].filter(Boolean);

      // Substring alignment for compound labels (e.g. "Advanced" in "Advanced / Expert")
      if (normLbl.includes(normTarget) || normTarget.includes(normLbl)) {
        return {
          matchedOption: opt,
          confidence: 0.88,
          strategy: 'fuzzy',
          rationale: `Compound token alignment between '${normTarget}' and option label '${opt.label}'`,
        };
      }

      // Typo-tolerant distance matching for common ATS misspellings (e.g. "Begineer" for "Beginner")
      for (const tToken of targetTokens) {
        for (const oToken of optTokens) {
          if (tToken.length >= 4 && oToken.length >= 4 && isFuzzyTypoMatch(tToken, oToken)) {
            return {
              matchedOption: opt,
              confidence: 0.82,
              strategy: 'fuzzy',
              rationale: `Typo-tolerant alignment between candidate term '${tToken}' and option token '${oToken}'`,
            };
          }
        }
      }
    }
  }

  return {
    matchedOption: null,
    confidence: 0.0,
    strategy: 'fallback',
    rationale: `No option adequately matched candidate value '${targetValue}'`,
  };
}
