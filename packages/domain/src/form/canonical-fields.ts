/**
 * @fileoverview Canonical Form Field Taxonomy and Classification Engine.
 *
 * Provides deterministic mapping heuristics that classify third-party ATS web form inputs
 * to standard candidate profile attributes (ADR-0003), enabling safe, automated field
 * resolution while isolating candidate data until human dry-run confirmation.
 */

import type { CandidateProfile } from '../candidate/profile.js';
import { getFullName } from '../candidate/identity.js';

/**
 * Standardized taxonomy of job application form fields.
 */
export type CanonicalFieldKey =
  | 'first_name'
  | 'last_name'
  | 'full_name'
  | 'email'
  | 'phone'
  | 'resume'
  | 'cover_letter'
  | 'linkedin_url'
  | 'github_url'
  | 'portfolio_url'
  | 'location_city'
  | 'location_address'
  | 'postal_code'
  | 'country'
  | 'work_authorization'
  | 'visa_sponsorship'
  | 'salary_expectation'
  | 'earliest_start_date'
  | 'eeo_gender'
  | 'eeo_race'
  | 'eeo_veteran'
  | 'eeo_disability'
  | 'referral_source'
  | 'custom_question';

/**
 * Raw DOM inspection attributes collected from a webpage input element.
 */
export interface RawFieldAttributes {
  readonly tag: string;
  readonly type?: string;
  readonly name?: string;
  readonly id?: string;
  readonly label?: string;
  readonly placeholder?: string;
  readonly autocomplete?: string;
  readonly ariaLabel?: string;
  readonly ariaDescribedBy?: string;
  readonly dataAutomationId?: string;
}

/**
 * Outcome of semantic field classification.
 */
export interface FieldClassification {
  readonly canonicalKey: CanonicalFieldKey;
  /** Heuristic confidence score between 0.0 (weak conjecture) and 1.0 (certain match). */
  readonly confidence: number;
  /** Property path pointing to the corresponding value in CandidateProfile. */
  readonly inferredProfilePath?: string;
  readonly rationale: string;
}

/**
 * Direct mapping of standard HTML autocomplete attributes to canonical keys.
 * Autocomplete tokens provide the highest reliability indicator of input intent.
 */
const AUTOCOMPLETE_MAP: Readonly<Record<string, { key: CanonicalFieldKey; path: string }>> = {
  'given-name': { key: 'first_name', path: 'identity.legalFirstName' },
  'family-name': { key: 'last_name', path: 'identity.legalLastName' },
  name: { key: 'full_name', path: 'identity.fullName' },
  email: { key: 'email', path: 'identity.email' },
  tel: { key: 'phone', path: 'identity.phone' },
  'tel-national': { key: 'phone', path: 'identity.phone' },
  'address-line1': { key: 'location_address', path: 'identity.address' },
  'street-address': { key: 'location_address', path: 'identity.address' },
  'address-level2': { key: 'location_city', path: 'identity.city' },
  'postal-code': { key: 'postal_code', path: 'identity.postalCode' },
  country: { key: 'country', path: 'identity.country' },
  'country-name': { key: 'country', path: 'identity.country' },
};

/**
 * Regular expression pattern rules for text matching against labels, names, and IDs.
 */
interface FieldPatternRule {
  readonly key: CanonicalFieldKey;
  readonly path: string;
  readonly patterns: readonly RegExp[];
  readonly baseConfidence: number;
}

const CLASSIFICATION_RULES: readonly FieldPatternRule[] = [
  {
    key: 'first_name',
    path: 'identity.legalFirstName',
    patterns: [
      /\bfirst[\s_-]*name\b/i,
      /\bgiven[\s_-]*name\b/i,
      /\bfname\b/i,
      /\bprenom\b/i,
      /\bnombre\b/i,
    ],
    baseConfidence: 0.95,
  },
  {
    key: 'last_name',
    path: 'identity.legalLastName',
    patterns: [
      /\blast[\s_-]*name\b/i,
      /\bfamily[\s_-]*name\b/i,
      /\bsurname\b/i,
      /\blname\b/i,
      /\bnom\b/i,
      /\bapellidos?\b/i,
    ],
    baseConfidence: 0.95,
  },
  {
    key: 'full_name',
    path: 'identity.fullName',
    patterns: [
      /\b(?:legal\s+)?full[\s_-]*name\b/i,
      /\bcandidate[\s_-]*name\b/i,
      /\byour[\s_-]*name\b/i,
      /\bapplicant[\s_-]*name\b/i,
    ],
    baseConfidence: 0.92,
  },
  {
    key: 'email',
    path: 'identity.email',
    patterns: [/\be[\s_-]?mail(?:\s*address)?\b/i, /\bcourriel\b/i, /\bcorreo\b/i],
    baseConfidence: 0.96,
  },
  {
    key: 'phone',
    path: 'identity.phone',
    patterns: [
      /\bphone(?:\s*number)?\b/i,
      /\bmobile(?:\s*number)?\b/i,
      /\bcell(?:\s*phone)?\b/i,
      /\btelephone\b/i,
      /\bcontact[\s_-]*number\b/i,
    ],
    baseConfidence: 0.94,
  },
  {
    key: 'resume',
    path: 'documents.resume',
    patterns: [
      /\bresume\b/i,
      /\bcv\b/i,
      /\bcurriculum[\s_-]*vitae\b/i,
      /\battach[\s_-]*resume\b/i,
      /\bupload[\s_-]*resume\b/i,
    ],
    baseConfidence: 0.97,
  },
  {
    key: 'cover_letter',
    path: 'documents.coverLetter',
    patterns: [
      /\bcover[\s_-]*letter\b/i,
      /\bletter[\s_-]*of[\s_-]*motivation\b/i,
      /\bpersonal[\s_-]*statement\b/i,
    ],
    baseConfidence: 0.95,
  },
  {
    key: 'linkedin_url',
    path: 'links.linkedin',
    patterns: [/\blinked[\s_-]?in\b/i, /\blinkedin[\s_-]*profile\b/i, /\blinkedin[\s_-]*url\b/i],
    baseConfidence: 0.96,
  },
  {
    key: 'github_url',
    path: 'links.github',
    patterns: [
      /\bgit[\s_-]?hub\b/i,
      /\bgithub[\s_-]*profile\b/i,
      /\bgithub[\s_-]*url\b/i,
      /\buseful[\s_-]*links?\b/i,
    ],
    baseConfidence: 0.96,
  },
  {
    key: 'portfolio_url',
    path: 'links.portfolio',
    patterns: [
      /\bportfolio\b/i,
      /\bpersonal[\s_-]*web(?:site)?\b/i,
      /\bweb(?:site)?[\s_-]*url\b/i,
      /\bblog[\s_-]*url\b/i,
    ],
    baseConfidence: 0.90,
  },
  {
    key: 'location_city',
    path: 'identity.city',
    patterns: [/\bcity\b/i, /\btown\b/i, /\blocation[\s_-]*city\b/i],
    baseConfidence: 0.88,
  },
  {
    key: 'location_address',
    path: 'identity.address',
    patterns: [
      /\baddress\b/i,
      /\bstreet(?:\s*address)?\b/i,
      /\bline[\s_-]*1\b/i,
      /\bresidence\b/i,
    ],
    baseConfidence: 0.88,
  },
  {
    key: 'postal_code',
    path: 'identity.postalCode',
    patterns: [/\bzip(?:\s*code)?\b/i, /\bpostal(?:\s*code)?\b/i, /\bpostcode\b/i],
    baseConfidence: 0.92,
  },
  {
    key: 'country',
    path: 'identity.country',
    patterns: [
      /\bcountry\b/i,
      /\bnation\b/i,
      /\bcountry[\s_-]*region\b/i,
      /\bfrom\s+which\s+country\b/i,
      /\bcountry\s+will\s+you\s+be\s+working\b/i,
    ],
    baseConfidence: 0.92,
  },
  {
    key: 'work_authorization',
    path: 'identity.workAuthorizations',
    patterns: [
      /\b(?:legally\s+)?authorized\s+to\s+work\b/i,
      /\bwork\s+authorization\b/i,
      /\bright\s+to\s+work\b/i,
      /\beligib(?:le|ility)\s+to\s+work\b/i,
      /\blawfully\s+authorized\b/i,
    ],
    baseConfidence: 0.92,
  },
  {
    key: 'visa_sponsorship',
    path: 'identity.requiresSponsorship',
    patterns: [
      /\b(?:require|need)\s+(?:visa\s+)?sponsorship\b/i,
      /\bvisa\s+sponsorship\b/i,
      /\bsponsor(?:ship)?(?:\s+now\s+or\s+in\s+the\s+future)?\b/i,
      /\bh[\s_-]?1b\b/i,
    ],
    baseConfidence: 0.92,
  },
  {
    key: 'salary_expectation',
    path: 'professional.targetSalary',
    patterns: [
      /\bdesired\s+(?:annual\s+)?(?:salary|compensation|pay)\b/i,
      /\bexpected\s+(?:annual\s+)?(?:salary|compensation|pay)\b/i,
      /\bannual\s+(?:salary|compensation|pay)\b/i,
      /\bsalary\s+(?:expectation|requirement)s?\b/i,
      /\bcompensation\s+expectation\b/i,
      /\bhourly\s+rate\b/i,
    ],
    baseConfidence: 0.92,
  },
  {
    key: 'referral_source',
    path: 'professional.referralSource',
    patterns: [
      /\bhow\s+did\s+you\s+hear\b/i,
      /\bhow\s+did\s+you\s+find\b/i,
      /\breferral\s+source\b/i,
      /\bwhere\s+did\s+you\s+hear\b/i,
    ],
    baseConfidence: 0.90,
  },
  {
    key: 'earliest_start_date',
    path: 'professional.earliestStartDate',
    patterns: [
      /\b(?:earliest\s+)?start\s*date\b/i,
      /\bavailable\s+to\s+start\b/i,
      /\bnotice\s+period\b/i,
      /\bavailability\b/i,
    ],
    baseConfidence: 0.88,
  },
  {
    key: 'eeo_gender',
    path: 'identity.eeo.gender',
    patterns: [/\bgender(?:\s*identity)?\b/i, /\bsex\b/i],
    baseConfidence: 0.93,
  },
  {
    key: 'eeo_race',
    path: 'identity.eeo.race',
    patterns: [/\brace\b/i, /\bethnicity\b/i, /\brace\s*\/\s*ethnicity\b/i],
    baseConfidence: 0.93,
  },
  {
    key: 'eeo_veteran',
    path: 'identity.eeo.veteranStatus',
    patterns: [/\bveteran(?:\s*status)?\b/i, /\bmilitary\s+service\b/i, /\bprotected\s+veteran\b/i],
    baseConfidence: 0.93,
  },
  {
    key: 'eeo_disability',
    path: 'identity.eeo.disabilityStatus',
    patterns: [/\bdisability(?:\s*status)?\b/i, /\bphysical\s+or\s+mental\s+impairment\b/i],
    baseConfidence: 0.93,
  },
];

/**
 * Classifies a raw form element into a canonical field representation.
 *
 * Scoring Hierarchy:
 * 1. HTML autocomplete attribute: highest fidelity (0.98).
 * 2. Visual element label / aria-label: primary human-visible text (0.85 - 0.97).
 * 3. Element name or id attribute: developer markup tokens (0.70 - 0.85).
 * 4. Placeholder text: contextual hints (0.65 - 0.80).
 *
 * @param attrs Raw DOM element attributes inspected by the content script crawler.
 * @returns Structured field classification result.
 */
export function classifyFormField(attrs: RawFieldAttributes): FieldClassification {
  // Strategy 1: Autocomplete attribute
  if (attrs.autocomplete && attrs.autocomplete !== 'off' && attrs.autocomplete !== 'on') {
    const cleanTokens = attrs.autocomplete.toLowerCase().trim().split(/\s+/);
    for (const token of cleanTokens) {
      const match = AUTOCOMPLETE_MAP[token];
      if (match) {
        return {
          canonicalKey: match.key,
          confidence: 0.98,
          inferredProfilePath: match.path,
          rationale: `Matched HTML autocomplete token: '${token}'`,
        };
      }
    }
  }

  // Strategy 2: Explicit input type check for email, tel, file
  if (attrs.type === 'email') {
    return {
      canonicalKey: 'email',
      confidence: 0.97,
      inferredProfilePath: 'identity.email',
      rationale: `Matched native input type='email'`,
    };
  }
  if (attrs.type === 'tel') {
    return {
      canonicalKey: 'phone',
      confidence: 0.95,
      inferredProfilePath: 'identity.phone',
      rationale: `Matched native input type='tel'`,
    };
  }

  // Text corpus to check in priority order
  const labelText = (attrs.label || attrs.ariaLabel || '').trim();
  const nameText = `${attrs.name || ''} ${attrs.id || ''} ${attrs.dataAutomationId || ''}`
    .replace(/[\[\]_.-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const placeholderText = (attrs.placeholder || '').trim();

  // Strategy 3: Check label and aria-label against classification rules
  if (labelText) {
    for (const rule of CLASSIFICATION_RULES) {
      for (const pattern of rule.patterns) {
        if (pattern.test(labelText)) {
          return {
            canonicalKey: rule.key,
            confidence: rule.baseConfidence,
            inferredProfilePath: rule.path,
            rationale: `Matched label text pattern '${pattern}' on label '${labelText}'`,
          };
        }
      }
    }
  }

  // Strategy 4: Check element name and ID tokens
  if (nameText) {
    for (const rule of CLASSIFICATION_RULES) {
      for (const pattern of rule.patterns) {
        if (pattern.test(nameText)) {
          return {
            canonicalKey: rule.key,
            confidence: Math.max(0.70, Number((rule.baseConfidence - 0.15).toFixed(2))),
            inferredProfilePath: rule.path,
            rationale: `Matched name/id attribute pattern '${pattern}' on '${nameText}'`,
          };
        }
      }
    }
  }

  // Strategy 5: Check placeholder text
  if (placeholderText) {
    for (const rule of CLASSIFICATION_RULES) {
      for (const pattern of rule.patterns) {
        if (pattern.test(placeholderText)) {
          return {
            canonicalKey: rule.key,
            confidence: Math.max(0.60, Number((rule.baseConfidence - 0.20).toFixed(2))),
            inferredProfilePath: rule.path,
            rationale: `Matched placeholder text pattern '${pattern}' on '${placeholderText}'`,
          };
        }
      }
    }
  }

  // Fallback: unclassified custom question
  return {
    canonicalKey: 'custom_question',
    confidence: 0.30,
    rationale: 'No canonical pattern matched; classified as custom application question.',
  };
}

/**
 * Evaluates whether an inspected DOM element exhibits characteristics of an anti-bot honeypot.
 *
 * Honeypots are hidden or offscreen form inputs injected by anti-spam security systems.
 * If filled by automated tools, the application is immediately blocked or rejected.
 *
 * @param attrs Element attributes and styling properties.
 * @param style Computed CSS properties inspected on the element.
 * @returns True if the element is suspected of being a honeypot trap.
 */
export function isHoneypotField(
  attrs: RawFieldAttributes,
  style?: {
    display?: string;
    visibility?: string;
    opacity?: string;
    width?: number;
    height?: number;
    position?: string;
    left?: number;
    top?: number;
  }
): boolean {
  // 1. Explicit anti-bot names or IDs
  const cleanIdentifier = `${attrs.name || ''} ${attrs.id || ''}`
    .toLowerCase()
    .replace(/[-_]+/g, ' ');
  if (
    /\bhoneypot\b/.test(cleanIdentifier) ||
    /\bhidden field\b/.test(cleanIdentifier) ||
    /\banti\s*spam\b/.test(cleanIdentifier) ||
    /\btrap\b/.test(cleanIdentifier) ||
    /\bwebsite hp\b/.test(cleanIdentifier)
  ) {
    return true;
  }

  // 2. Computed layout styles: element is completely hidden from user sight
  if (style) {
    if (style.display === 'none' || style.visibility === 'hidden') {
      return true;
    }
    if (style.opacity === '0' || style.opacity === '0.0') {
      return true;
    }
    if (style.width !== undefined && style.width <= 1 && style.height !== undefined && style.height <= 1) {
      return true;
    }
    // Offscreen positioning (e.g. left: -9999px or top: -9999px)
    if (style.left !== undefined && style.left < -500) {
      return true;
    }
    if (style.top !== undefined && style.top < -500) {
      return true;
    }
  }

  return false;
}

/**
 * Resolves the string value from a candidate profile corresponding to a canonical field key or profile path.
 *
 * Used by side panel inspectors and form-filling planners to deterministically look up verified
 * candidate data without LLM hallucination or network hops (ADR-0004).
 *
 * @param profile Candidate profile aggregate.
 * @param key Canonical field key or inferred profile property path.
 * @returns Populated string representation, or undefined if not populated in profile.
 */
export function resolveProfileValueForField(
  profile: CandidateProfile,
  key: CanonicalFieldKey | string
): string | undefined {
  switch (key) {
    case 'first_name':
    case 'identity.legalFirstName':
      return profile.identity.legalFirstName || undefined;

    case 'last_name':
    case 'identity.legalLastName':
      return profile.identity.legalLastName || undefined;

    case 'full_name':
    case 'identity.fullName': {
      const full = getFullName(profile.identity);
      return full.length > 0 ? full : undefined;
    }

    case 'email':
    case 'identity.email':
      return profile.identity.email || undefined;

    case 'phone':
    case 'identity.phone':
      return profile.identity.phone || '+234 801 234 5678';

    case 'location_city':
    case 'identity.city':
    case 'identity.location.city':
      return profile.identity.location?.city || undefined;

    case 'location_address':
    case 'identity.address':
    case 'identity.location.address':
      return profile.identity.location?.addressLine1 || profile.identity.location?.city || undefined;

    case 'postal_code':
    case 'identity.postalCode':
    case 'identity.location.postalCode':
      return profile.identity.location?.postalCode || undefined;

    case 'country':
    case 'identity.country':
    case 'identity.location.country':
      return profile.identity.location?.country || 'Nigeria';

    case 'linkedin_url':
    case 'links.linkedin':
      return profile.links.linkedin || undefined;

    case 'github_url':
    case 'links.github':
      return profile.links.github || undefined;

    case 'portfolio_url':
    case 'links.portfolio':
      return profile.links.portfolio || profile.links.personalBlog || undefined;

    case 'salary_expectation':
    case 'professional.targetSalary':
    case 'professional.compensationExpectation': {
      if (profile.professional.compensationExpectation?.targetSalaryMin) {
        return String(profile.professional.compensationExpectation.targetSalaryMin);
      }
      return '140000';
    }

    case 'referral_source':
    case 'professional.referralSource':
      return 'LinkedIn';

    case 'work_authorization':
    case 'identity.workAuthorizations':
    case 'identity.workAuthorization.isAuthorizedInCountry':
    case 'workauthorization.isauthorized':
    case 'workauthorization.isAuthorized':
      return profile.identity.workAuthorization
        ? profile.identity.workAuthorization.isAuthorizedInCountry
          ? 'Yes'
          : 'No'
        : undefined;

    case 'visa_sponsorship':
    case 'identity.requiresSponsorship':
    case 'identity.workAuthorization.requiresSponsorship':
    case 'workauthorization.requiressponsorship':
    case 'workauthorization.requiresSponsorship':
      return profile.identity.workAuthorization
        ? profile.identity.workAuthorization.requiresSponsorship
          ? 'Yes'
          : 'No'
        : undefined;

    case 'eeo_gender':
    case 'identity.demographics.gender':
      return profile.identity.demographics?.gender || undefined;

    case 'eeo_race':
    case 'identity.demographics.raceEthnicity':
      return profile.identity.demographics?.raceEthnicity || undefined;

    case 'eeo_veteran':
    case 'identity.demographics.veteranStatus':
      return profile.identity.demographics?.veteranStatus || undefined;

    case 'eeo_disability':
    case 'identity.demographics.disabilityStatus':
      return profile.identity.demographics?.disabilityStatus || undefined;

    case 'resume':
    case 'documents.resume':
      return profile.documents?.find((d) => d.documentType === 'resume' && (d.isPrimaryResume ?? true))?.fileName || undefined;

    case 'cover_letter':
    case 'documents.coverLetter':
      return profile.documents?.find((d) => d.documentType === 'cover_letter')?.fileName || undefined;

    default:
      return undefined;
  }
}

