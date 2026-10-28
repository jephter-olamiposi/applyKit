/**
 * @fileoverview 5-Gate Job Eligibility Verifier based on SKILL.md Phase 2 (Verify).
 *
 * Implements the non-negotiable principle: "Verification Precedes Effort."
 * Over 50% of jobs advertised as "Remote" fail on geography, work authorization, or tax entity.
 * This verifier tests a job posting against candidate profile facts using a 5-gate waterfall
 * (cheapest & most fatal first) and requires verbatim quote extraction for all blocking verdicts.
 */

import type { JobPosting } from './job-posting.js';
import type { CandidateProfile } from '../candidate/profile.js';
import { canonicalCountry, describePlaces, findPlaces, isEmptyPlaceSet, placesInclude, type PlaceSet } from './geo-regions.js';

/**
 * High-level verdict determining whether the candidate can legally and practically hold the role.
 */
export type EligibilityVerdict = 'OPEN' | 'CONDITIONAL' | 'BLOCKED';

/**
 * The 5 sequential qualification gates defined in SKILL.md.
 */
export type EligibilityGate =
  | 'geography'
  | 'work_authorization'
  | 'entity'
  | 'timezone'
  | 'requirements';

/**
 * Evaluation outcome for an individual eligibility gate.
 */
export interface GateCheckResult {
  readonly gate: EligibilityGate;
  readonly status: 'passed' | 'conditional' | 'blocked';
  /** Verbatim sentence from employer's page/form proving this verdict (Mandatory for blocked). */
  readonly verbatimQuote?: string;
  readonly reason: string;
}

/**
 * Comprehensive eligibility audit report for a job posting.
 */
export interface JobEligibilityReport {
  readonly jobId: string;
  readonly verdict: EligibilityVerdict;
  /** The first fatal gate that triggered a BLOCKED verdict, if any. */
  readonly fatalGate?: EligibilityGate;
  /** Verbatim evidence sentence explaining why the role was blocked. */
  readonly verbatimEvidence?: string;
  readonly checks: readonly GateCheckResult[];
  readonly auditedAt: string;
}

/**
 * Splits text into sentences while preserving sentence boundaries.
 */
function extractSentences(text?: string): string[] {
  if (!text) return [];
  return text
    .split(/(?<!\b(?:U\.S|e\.g|i\.e|vs|etc|Dr|Mr|Ms|Inc|Ltd))\.\s+(?=[A-Z0-9])|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 5);
}

/** Relocation or visa help that turns a country mismatch into "check first". */
const RELOCATION_OFFER = /\b(?:help\s+(?:you\s+)?relocat\w*|relocation\s+(?:support|assistance|package)|we\s+(?:can|will|do)\s+sponsor|sponsor\s+visas?|visa\s+sponsorship\s+(?:is\s+)?(?:available|offered|provided))\b/i;
const RELOCATION_DENIAL = /\b(?:(?:unable|not\s+able)\s+to\s+(?:offer\s+)?(?:sponsor|relocat)|(?:cannot|can't|do\s+not|don't|will\s+not|won't)\s+(?:offer\s+)?(?:sponsor|relocat)|no\s+(?:visa\s+)?sponsorship|without\s+(?:visa\s+)?sponsorship|not\s+(?:offer|provide)\w*\s+(?:visa\s+)?sponsorship)\b/i;

/** Description phrases that bind a job to the places named right after them. */
const STRICT_PLACE_RULE = /\b(?:must\s+(?:be\s+)?(?:based|located|living|reside|live)\s+in|open\s+only\s+to\s+(?:residents|candidates)\s+(?:of|in)|restricted\s+to\s+(?:residents|candidates)\s+(?:of|in)|(?:only\s+)?(?:hire|hiring)\s+(?:only\s+)?in\s+the\s+following|remote\s+(?:only\s+)?(?:within|in)|(?:distributed\s+)?working\s+within|apply\s+only\s+if\s+you\s+are\s+(?:located|based)\s+in)\b([^.!?\n]*)/i;
const ONLY_RULE = /\b([A-Za-z. ]{2,40}?)\s+only\b/;
const ANYWHERE_RULE = /\b(?:work\s+from\s+anywhere(?!\s+\d)|anywhere\s+in\s+the\s+world|hir(?:e|ing)\s+(?:globally|worldwide|anywhere)|remote[-\s,(]+(?:global|worldwide|anywhere))\b/i;
const LOOSE_PLACE_RULE = /\b(?:based|located)\s+in\b([^.!?\n]*)/i;

/**
 * Evaluates Gate 1: Geography.
 *
 * Reads the places a posting is open to from its location field ("Remote (UK)",
 * "Remote within Canada or United States", "San Francisco, CA") and from sentences that
 * state a location rule, then checks the candidate's country against them. A place the
 * resolver does not know is ignored, so unfamiliar wording never blocks anyone.
 */
function checkGeographyGate(job: JobPosting, profile: CandidateProfile): GateCheckResult {
  const candidateCountryRaw = profile.identity.location?.country?.trim() || '';
  const candidateCountry = canonicalCountry(candidateCountryRaw);
  const sentences = extractSentences(job.rawDescription);
  const relocationSentence = sentences.find((sentence) => RELOCATION_OFFER.test(sentence) && !RELOCATION_DENIAL.test(sentence));

  // "Work from anywhere 4 weeks a year" is a perk for office-country staff, not a remote policy.
  const perkTrap = sentences.find((sentence) => /work\s+from\s+anywhere\s+\d+\s+(?:days|weeks|months)/i.test(sentence));

  const restrictions: { quote: string; places: PlaceSet; strict: boolean }[] = [];
  const locationPlaces = findPlaces(job.location || '');
  if (!isEmptyPlaceSet(locationPlaces)) restrictions.push({ quote: job.location, places: locationPlaces, strict: true });

  for (const sentence of sentences) {
    if (sentence === perkTrap) continue;
    if (ANYWHERE_RULE.test(sentence)) {
      restrictions.push({ quote: sentence, places: { countries: new Set(), regions: new Set(['global']) }, strict: false });
      continue;
    }
    const strict = sentence.match(STRICT_PLACE_RULE);
    const only = sentence.match(ONLY_RULE);
    const loose = sentence.match(LOOSE_PLACE_RULE);
    const strictPlaces = strict ? findPlaces(strict[1] ?? '') : null;
    const onlyPlaces = only ? findPlaces(only[1] ?? '') : null;
    if (strictPlaces && !isEmptyPlaceSet(strictPlaces)) restrictions.push({ quote: sentence, places: strictPlaces, strict: true });
    else if (onlyPlaces && !isEmptyPlaceSet(onlyPlaces)) restrictions.push({ quote: sentence, places: onlyPlaces, strict: true });
    else if (loose) {
      const loosePlaces = findPlaces(loose[1] ?? '');
      if (!isEmptyPlaceSet(loosePlaces)) restrictions.push({ quote: sentence, places: loosePlaces, strict: false });
    }
  }

  // An explicit "anywhere" in the posting overrides an office address in the location field.
  const global = restrictions.find((item) => item.places.regions.has('global'));
  if (global && !perkTrap) {
    return { gate: 'geography', status: 'passed', verbatimQuote: global.quote, reason: 'The posting is open to candidates anywhere.' };
  }

  if (restrictions.length === 0) {
    if (perkTrap) {
      return {
        gate: 'geography',
        status: 'conditional',
        verbatimQuote: perkTrap,
        reason: '"Work from anywhere" here is a few weeks a year for existing staff, not a remote role.',
      };
    }
    return { gate: 'geography', status: 'passed', reason: 'The posting does not limit where you can live.' };
  }

  if (!candidateCountry) {
    return {
      gate: 'geography',
      status: 'conditional',
      verbatimQuote: restrictions[0]!.quote,
      reason: `The role is limited to ${describePlaces(restrictions[0]!.places)}. Add your country in Profile so ApplyKit can check.`,
    };
  }

  const included = restrictions.find((item) => placesInclude(item.places, candidateCountry));
  const binding = restrictions.find((item) => item.strict && !placesInclude(item.places, candidateCountry));
  if (included && !binding) {
    return {
      gate: 'geography',
      status: perkTrap ? 'conditional' : 'passed',
      verbatimQuote: included.quote,
      reason: `The role is open to people in ${candidateCountry}.`,
    };
  }

  const blocker = binding ?? restrictions[0]!;
  const where = describePlaces(blocker.places);
  if (relocationSentence) {
    return {
      gate: 'geography',
      status: 'conditional',
      verbatimQuote: relocationSentence,
      reason: `The role is in ${where}, not ${candidateCountry}, but the posting offers relocation or visa help.`,
    };
  }
  if (!binding) {
    return {
      gate: 'geography',
      status: 'conditional',
      verbatimQuote: blocker.quote,
      reason: `The posting mentions ${where}. Check whether people in ${candidateCountry} can apply.`,
    };
  }
  return {
    gate: 'geography',
    status: 'blocked',
    verbatimQuote: blocker.quote,
    reason: `The role is only open to people in ${where}, and you are in ${candidateCountry}.`,
  };
}

/**
 * Evaluates Gate 2: Work Authorization.
 * Checks for sponsorship restrictions and security clearance requirements.
 */
function checkWorkAuthorizationGate(job: JobPosting, profile: CandidateProfile): GateCheckResult {
  const requiresSponsorship = profile.identity.workAuthorization.requiresSponsorship;
  const sentences = extractSentences(job.rawDescription);

  for (const sentence of sentences) {
    // Check no-sponsorship declarations
    if (
      /\b(?:unable\s+to\s+sponsor|cannot\s+sponsor|no\s+sponsorship|will\s+not\s+sponsor|not\s+able\s+to\s+provide\s+visa\s+sponsorship|without\s+the\s+need\s+for\s+sponsorship)\b/i.test(
        sentence
      )
    ) {
      if (requiresSponsorship) {
        return {
          gate: 'work_authorization',
          status: 'blocked',
          verbatimQuote: sentence,
          reason: 'Candidate requires visa sponsorship, but employer explicitly disclaims sponsorship availability.',
        };
      }
    }

    // Work authorization does not prove citizenship or an active security clearance.
    if (/\b(?:security\s+clearance\s+required|active\s+secret\s+clearance|ts\/sci)\b/i.test(sentence)) {
      return {
        gate: 'work_authorization',
        status: 'conditional',
        verbatimQuote: sentence,
        reason: 'Role requires a security clearance that is not represented in the candidate profile.',
      };
    }

    if (/\bmust\s+be\s+a\s+u\.?s\.?\s+citizen\b/i.test(sentence)) {
      const visaStatus = profile.identity.workAuthorization.visaStatus?.toLowerCase() ?? '';
      if (!/\b(?:u\.?s\.?\s+citizen|american\s+citizen)\b/i.test(visaStatus)) {
        return {
          gate: 'work_authorization',
          status: 'conditional',
          verbatimQuote: sentence,
          reason: 'Role requires U.S. citizenship, which cannot be inferred from work authorization alone.',
        };
      }
    }
  }

  return {
    gate: 'work_authorization',
    status: 'passed',
    reason: 'Work authorization and sponsorship criteria satisfied or not explicitly blocked.',
  };
}

/**
 * Evaluates Gate 3: Corporate Tax / Employment Entity.
 */
function checkEntityGate(job: JobPosting, _profile: CandidateProfile): GateCheckResult {
  const sentences = extractSentences(job.rawDescription);

  for (const sentence of sentences) {
    if (
      /\b(?:we\s+hire\s+through\s+our\s+entities\s+in|employment\s+only\s+available\s+in|b2b\s+contract\s+only|contractor\s+only)\b/i.test(
        sentence
      )
    ) {
      return {
        gate: 'entity',
        status: 'conditional',
        verbatimQuote: sentence,
        reason: 'Employer specifies specific corporate entity or B2B contractor employment rails.',
      };
    }
  }

  return {
    gate: 'entity',
    status: 'passed',
    reason: 'No entity-specific corporate restrictions detected.',
  };
}

/**
 * Evaluates Gate 4: Timezone overlap.
 */
function checkTimezoneGate(job: JobPosting, profile: CandidateProfile): GateCheckResult {
  const sentences = extractSentences(job.rawDescription);

  for (const sentence of sentences) {
    if (
      /\b(?:must\s+overlap\s+with|core\s+hours\s+are|working\s+hours\s+are|timezone\s+overlap|overlap\s+of\s+at\s+least\s+\d+\s+hours)\b/i.test(
        sentence
      )
    ) {
      return {
        gate: 'timezone',
        status: 'conditional',
        verbatimQuote: sentence,
        reason: 'Employer requires core hour working overlap; verify candidate working hours alignment.',
      };
    }
  }

  return {
    gate: 'timezone',
    status: 'passed',
    reason: 'Timezone flexibility indicated or no rigid core hour restriction stated.',
  };
}

/**
 * Evaluates Gate 5: Hard Minimum Requirements.
 * Checks whether candidate tenure meets non-negotiable minimum years of experience.
 */
function checkRequirementsGate(job: JobPosting, profile: CandidateProfile): GateCheckResult {
  const sentences = extractSentences(job.rawDescription);

  // Compute candidate's total verified experience in years
  let totalMonths = 0;
  for (const exp of profile.experiences) {
    const start = new Date(exp.startDate);
    const end = exp.endDate ? new Date(exp.endDate) : new Date();
    if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
      const months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
      if (months > 0) totalMonths += months;
    }
  }
  const candidateYears = Math.max(1, Math.round((totalMonths / 12) * 10) / 10);

  const hardRequirementRegex = /\b(?:minimum\s+(?:of\s+)?(\d+)\+?\s+years|at\s+least\s+(\d+)\+?\s+years|(\d+)\+\s+years\s+of\s+(?:commercial|professional|engineering|software)\s+experience)\b/i;

  for (const sentence of sentences) {
    const match = sentence.match(hardRequirementRegex);
    if (match) {
      const requiredYears = parseInt(match[1] || match[2] || match[3] || '0', 10);
      if (requiredYears > 0 && candidateYears < requiredYears) {
        // Only block if requirement is substantially higher (e.g. requires 10 years, candidate has 3)
        if (requiredYears - candidateYears >= 2) {
          return {
            gate: 'requirements',
            status: 'blocked',
            verbatimQuote: sentence,
            reason: `Role requires minimum ${requiredYears} years of experience; candidate has ${candidateYears} verified years.`,
          };
        }
      }
    }
  }

  return {
    gate: 'requirements',
    status: 'passed',
    reason: `Candidate verified tenure (${candidateYears} yrs) satisfies experience requirements.`,
  };
}

/**
 * Audits a job posting against the 5-Gate Eligibility Waterfall defined in SKILL.md.
 *
 * @param job The target job posting.
 * @param profile Verified candidate profile facts.
 * @returns Comprehensive JobEligibilityReport with auditable verbatim quotes.
 */
export function verifyJobEligibility(job: JobPosting, profile: CandidateProfile): JobEligibilityReport {
  const checks: GateCheckResult[] = [
    checkGeographyGate(job, profile),
    checkWorkAuthorizationGate(job, profile),
    checkEntityGate(job, profile),
    checkTimezoneGate(job, profile),
    checkRequirementsGate(job, profile),
  ];

  // The first blocked gate determines overall fatal verdict
  const blockedCheck = checks.find((c) => c.status === 'blocked');
  if (blockedCheck) {
    return {
      jobId: job.id,
      verdict: 'BLOCKED',
      fatalGate: blockedCheck.gate,
      verbatimEvidence: blockedCheck.verbatimQuote,
      checks,
      auditedAt: new Date().toISOString(),
    };
  }

  // If any gate is conditional, the overall verdict requires candidate approval
  const conditionalCheck = checks.find((c) => c.status === 'conditional');
  if (conditionalCheck) {
    return {
      jobId: job.id,
      verdict: 'CONDITIONAL',
      verbatimEvidence: conditionalCheck.verbatimQuote,
      checks,
      auditedAt: new Date().toISOString(),
    };
  }

  return {
    jobId: job.id,
    verdict: 'OPEN',
    checks,
    auditedAt: new Date().toISOString(),
  };
}
