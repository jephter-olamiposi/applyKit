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

/**
 * Evaluates Gate 1: Geography.
 * Checks for explicit country, state, or regional residence restrictions.
 */
function checkGeographyGate(job: JobPosting, profile: CandidateProfile): GateCheckResult {
  const candidateCountry = profile.identity.location?.country?.trim().toLowerCase() || '';
  const candidateCity = profile.identity.location?.city?.trim().toLowerCase() || '';
  const text = `${job.location} ${job.rawDescription}`;
  const sentences = extractSentences(text);

  // Common geographic gating regexes
  const strictLocationRegexes = [
    /\b(?:must\s+be\s+based\s+in|must\s+reside\s+in|open\s+only\s+to\s+residents\s+of|please\s+apply\s+only\s+if\s+you\s+are\s+located\s+in|hire\s+in\s+the\s+following\s+countries|restricted\s+to\s+residents\s+of)\b\s*[:\-]?\s*([^.!?\n]+)/i,
    /\b(?:us\s+or\s+canada\s+only|us\s+only|uk\s+only|eu\s+only|north\s+america\s+only)\b/i,
  ];

  for (const sentence of sentences) {
    for (const regex of strictLocationRegexes) {
      if (regex.test(sentence)) {
        const sentenceLower = sentence.toLowerCase();

        // Check if candidate's country is explicitly included
        if (candidateCountry && sentenceLower.includes(candidateCountry)) {
          return {
            gate: 'geography',
            status: 'passed',
            verbatimQuote: sentence,
            reason: `Candidate country (${profile.identity.location?.country}) is explicitly permitted.`,
          };
        }

        // Any explicit residency requirement excludes countries not named in the
        // sentence; do not treat an unrecognized country as globally eligible.
        if (regex === strictLocationRegexes[0]) {
          return {
            gate: 'geography',
            status: 'blocked',
            verbatimQuote: sentence,
            reason: `Role requires residency in a listed location, and the candidate is based in ${profile.identity.location?.country || 'an unlisted country'}.`,
          };
        }

        // If posting specifies US-only and candidate is not in US
        const isUsOnly = /\b(us\s+only|united\s+states\s+only|u\.s\.\s+only)\b/i.test(sentence);
        if (isUsOnly && candidateCountry !== 'united states' && candidateCountry !== 'usa' && candidateCountry !== 'us') {
          return {
            gate: 'geography',
            status: 'blocked',
            verbatimQuote: sentence,
            reason: 'Role requires residency in the United States.',
          };
        }

        // If posting specifies UK-only and candidate is not in UK
        const isUkOnly = /\b(uk\s+only|united\s+kingdom\s+only)\b/i.test(sentence);
        if (isUkOnly && candidateCountry !== 'united kingdom' && candidateCountry !== 'uk' && candidateCountry !== 'great britain') {
          return {
            gate: 'geography',
            status: 'blocked',
            verbatimQuote: sentence,
            reason: 'Role requires residency in the United Kingdom.',
          };
        }

        // If posting specifies EU-only
        const isEuOnly = /\b(eu\s+only|european\s+union\s+only)\b/i.test(sentence);
        if (isEuOnly) {
          return {
            gate: 'geography',
            status: 'conditional',
            verbatimQuote: sentence,
            reason: 'Role specifies EU residency; candidate must confirm European entity eligibility.',
          };
        }
      }
    }
  }

  // Check for eligibility trap: "Work from anywhere N days/weeks a year"
  for (const sentence of sentences) {
    if (/work\s+from\s+anywhere\s+\d+\s+(?:days|weeks|months)/i.test(sentence)) {
      return {
        gate: 'geography',
        status: 'conditional',
        verbatimQuote: sentence,
        reason: 'Perk trap detected: "Work from anywhere N days" typically applies only to existing office-country employees.',
      };
    }
  }

  return {
    gate: 'geography',
    status: 'passed',
    reason: 'No fatal geographic residency blockers identified in posting.',
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
  const locationText = `${job.location} ${job.rawDescription}`;

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
