/**
 * @fileoverview Deterministic Requirement Matching Engine.
 *
 * Evaluates candidate alignment against job requirements across multiple verification tiers:
 * exact skill matches, synonymous technical competencies, evidence-backed claims, and
 * experience seniority calculations. Enforces zero-hallucination grounding by weighting
 * substantiated evidence over unbacked profile assertions.
 */

import type { RequirementId, EvidenceId, ClaimId } from '../types/ids.js';
import type { Requirement } from './requirement.js';
import type { CandidateProfile } from '../candidate/profile.js';
import type { EvidenceGraph } from '../evidence/evidence-graph.js';
import { normalizeSkillName } from '../candidate/skill.js';
import {
  areCompetenciesEquivalent,
  normalizeCompetencyToken,
  isKnownCompetency,
  findCompetencyPhrases,
  getImplyingCompetencies,
  impliableCompetencies,
  getCompetencySynonyms,
} from './synonyms.js';
import type { WorkExperience } from '../candidate/experience.js';

/**
 * Verification tier representing the grounding depth of a requirement match.
 */
export type MatchTier =
  | 'exact_evidence'
  | 'exact_skill'
  | 'synonym_evidence'
  | 'synonym_skill'
  | 'claim_match'
  | 'unmatched';

/**
 * Individual requirement evaluation outcome.
 */
export interface RequirementMatch {
  readonly requirementId: RequirementId;
  readonly isMatched: boolean;
  /**
   * Grounded confidence score:
   * 1.0 = Direct skill match with verified evidence snippet
   * 0.85 = Synonymous competency with verified evidence snippet
   * 0.75 = Supported by candidate claim
   * 0.65 = Skill claimed in profile without linked document evidence
   * 0.0 = Unmatched
   */
  readonly confidenceScore: number;
  readonly matchedEvidenceIds: readonly EvidenceId[];
  readonly matchedClaimIds: readonly ClaimId[];
  readonly matchedCompetency?: string;
  readonly matchTier: MatchTier;
  readonly candidateYears?: number;
  readonly yearsShortfall?: number;
  readonly rationale: string;
  /**
   * Named technologies or domains in the requirement that the resume does not show, for
   * requirements that list several ("Kubernetes and AWS") and are only partly met.
   */
  readonly missingParts?: readonly string[];
}

/**
 * Comprehensive match matrix summarizing candidate alignment against a job posting.
 */
export interface JobMatchMatrix {
  readonly totalRequirements: number;
  readonly requiredCount: number;
  readonly requiredMetCount: number;
  readonly preferredCount: number;
  readonly preferredMetCount: number;
  /** Composite score normalized to 0 - 100. */
  readonly overallMatchScore: number;
  readonly matches: readonly RequirementMatch[];
  readonly missingRequiredRequirements: readonly Requirement[];
  readonly hardGapsCount: number;
  readonly softGapsCount: number;
  readonly experienceShortfallsCount: number;
}

/** Converts "YYYY-MM" or "YYYY-MM-DD" into a month index, or undefined when unparseable. */
function toMonthIndex(date: string | undefined): number | undefined {
  if (!date) return undefined;
  const match = date.match(/^(\d{4})-(\d{2})/);
  if (!match) return undefined;
  return Number(match[1]) * 12 + (Number(match[2]) - 1);
}

/**
 * Sums the calendar time covered by the given roles, counting overlapping roles once.
 *
 * Years of experience are derived from the dates the candidate wrote rather than from a
 * self-reported number, so a requirement like "5+ years" is judged on evidence.
 */
export function computeExperienceYears(experiences: readonly WorkExperience[], now: Date = new Date()): number {
  const nowIndex = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const intervals: Array<[number, number]> = [];
  for (const exp of experiences) {
    const start = toMonthIndex(exp.startDate);
    if (start === undefined) continue;
    const end = exp.isCurrent ? nowIndex : toMonthIndex(exp.endDate) ?? start;
    if (end >= start) intervals.push([start, end + 1]);
  }
  intervals.sort((a, b) => a[0] - b[0]);
  let months = 0;
  let cursorStart = -1;
  let cursorEnd = -1;
  for (const [start, end] of intervals) {
    if (start > cursorEnd) {
      if (cursorEnd > cursorStart) months += cursorEnd - cursorStart;
      cursorStart = start;
      cursorEnd = end;
    } else {
      cursorEnd = Math.max(cursorEnd, end);
    }
  }
  if (cursorEnd > cursorStart) months += cursorEnd - cursorStart;
  return Math.round((months / 12) * 10) / 10;
}

/**
 * How a term should read in a sentence: the candidate's own spelling when they list it
 * as a skill ("PostgreSQL"), otherwise the employer's spelling from the posting, otherwise
 * the lookup key.
 */
function displayTerm(term: string, profile: CandidateProfile, rawText?: string): string {
  const skill = profile.skills.find((item) => areCompetenciesEquivalent(item.name, term));
  if (skill) return skill.name;
  if (rawText) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '[\\s-]+');
    const found = rawText.match(new RegExp(`\\b${escaped}\\b`, 'i'))?.[0];
    if (found) return found;
  }
  return term.toUpperCase() === term ? term : term.replace(/\b(sql|aws|gcp|api|ci|cd)\b/g, (m) => m.toUpperCase());
}

/**
 * Explains an unmet requirement. Names the specific technologies when the posting gives
 * any; otherwise says plainly that the resume does not show it, instead of echoing a
 * fragment of the requirement sentence back at the candidate.
 */
function gapRationale(rawText: string, phrases: readonly string[], profile: CandidateProfile): string {
  const named = phrases.filter((phrase) => phrase.length >= 2).map((phrase) => displayTerm(phrase, profile, rawText));
  if (named.length > 0) return `Not shown in your resume: ${[...new Set(named)].join(', ')}.`;
  return "Your resume doesn't show this yet. If you have done it, add a line that says so.";
}

/** Whole-word, case-insensitive test of a normalized phrase against normalized text. */
function mentions(text: string, phrase: string): boolean {
  if (!phrase) return false;
  return ` ${normalizeCompetencyToken(text)} `.includes(` ${phrase} `);
}

/** All the text a role contributes as evidence: title, stack, and accomplishment bullets. */
function roleText(exp: WorkExperience): string {
  return [exp.title, exp.company, exp.description, ...exp.highlights, ...exp.technologiesUsed].join(' \n ');
}

/**
 * Roles whose own text mentions any of the phrases (or their synonyms). Used both to find
 * evidence for a requirement and to count years spent using a specific skill.
 */
function rolesMentioning(experiences: readonly WorkExperience[], phrases: readonly string[]): WorkExperience[] {
  const expanded = new Set<string>();
  for (const phrase of phrases) for (const synonym of getCompetencySynonyms(phrase)) expanded.add(synonym);
  return experiences.filter((exp) => [...expanded].some((phrase) => mentions(roleText(exp), phrase)));
}

/** Evidence nodes whose snippet mentions any of the phrases or their synonyms. */
function evidenceMentioning(graph: EvidenceGraph | undefined, phrases: readonly string[]): EvidenceId[] {
  if (!graph) return [];
  const expanded = new Set<string>();
  for (const phrase of phrases) for (const synonym of getCompetencySynonyms(phrase)) expanded.add(synonym);
  const ids: EvidenceId[] = [];
  for (const evidence of graph.evidenceMap.values()) {
    if ([...expanded].some((phrase) => mentions(evidence.textSnippet, phrase))) ids.push(evidence.id);
  }
  return ids;
}

/**
 * Evaluates candidate alignment against job requirements using multi-tier deterministic matching.
 *
 * Scoring Rationale:
 * - Mandatory requirements ('required', 'strongly_preferred') carry 75% weight in the composite score.
 * - Nice-to-have or preferred qualifications carry 25% weight.
 * - Verified evidence nodes yield maximum confidence; unbacked claims or years shortfalls incur deductions.
 *
 * @param requirements Extracted job requirements to test.
 * @param profile Candidate profile aggregate containing skills and experiences.
 * @param graph Optional EvidenceGraph for claim and document snippet verification.
 * @returns Comprehensive job match matrix.
 */
export function evaluateJobRequirements(
  requirements: readonly Requirement[],
  profile: CandidateProfile,
  graph?: EvidenceGraph
): JobMatchMatrix {
  if (requirements.length === 0) {
    return {
      totalRequirements: 0,
      requiredCount: 0,
      requiredMetCount: 0,
      preferredCount: 0,
      preferredMetCount: 0,
      overallMatchScore: 100,
      matches: [],
      missingRequiredRequirements: [],
      hardGapsCount: 0,
      softGapsCount: 0,
      experienceShortfallsCount: 0,
    };
  }

  const matches: RequirementMatch[] = [];
  const missingRequired: Requirement[] = [];

  let requiredCount = 0;
  let requiredMetCount = 0;
  let preferredCount = 0;
  let preferredMetCount = 0;
  let hardGapsCount = 0;
  let softGapsCount = 0;
  let experienceShortfallsCount = 0;

  for (const req of requirements) {
    const isReq = req.importance === 'required' || req.importance === 'strongly_preferred';
    if (isReq) {
      requiredCount++;
    } else {
      preferredCount++;
    }

    const normTarget = normalizeSkillName(req.normalizedSkillOrCompetency);

    const skills = profile.skills || [];

    // Tier 1 & 2: Skill matching (Exact and Synonyms)
    let matchedSkill = skills.find((s) => {
      const rawKey = normalizeSkillName(s.name);
      const normKey = normalizeSkillName(s.normalizedName);
      return rawKey === normTarget || normKey === normTarget;
    });

    let isSynonym = false;
    if (!matchedSkill) {
      matchedSkill = skills.find((s) =>
        areCompetenciesEquivalent(s.name, req.normalizedSkillOrCompetency) ||
        areCompetenciesEquivalent(s.normalizedName, req.normalizedSkillOrCompetency)
      );
      if (matchedSkill) {
        isSynonym = true;
      }
    }

    // Tier 2.5: Skill containment within requirement text (e.g. "Node.js" inside "Proven experience in Node.js development")
    if (!matchedSkill) {
      const reqRawToken = normalizeCompetencyToken(req.rawText);
      const reqNormToken = normalizeCompetencyToken(req.normalizedSkillOrCompetency);
      matchedSkill = skills.find((s) => {
        const sToken = normalizeCompetencyToken(s.name);
        if (sToken.length < 2 || (sToken.length < 3 && !isKnownCompetency(sToken))) return false;
        const escaped = sToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(`(^|\\s)${escaped}(\\s|$)`, 'i');
        return pattern.test(reqRawToken) || pattern.test(reqNormToken);
      });
      if (matchedSkill) {
        isSynonym = false;
      }
    }

    // Tier 3: Graph claims matching
    const matchedClaims = graph
      ? graph.claims.filter((c) => {
          if (c.supportedByEvidenceIds.length === 0) return false;
          const normToken = normalizeCompetencyToken(req.normalizedSkillOrCompetency);
          const hasTag = c.tags.some((t) => areCompetenciesEquivalent(t, normToken));
          const hasInStatement = normalizeCompetencyToken(c.statement).includes(normToken);
          return hasTag || hasInStatement;
        })
      : [];

    const experiences = profile.experiences || [];
    const requirementPhrases = findCompetencyPhrases(`${req.normalizedSkillOrCompetency} ${req.rawText}`);
    // One-way implications ("PostgreSQL work proves SQL"). Each hit records the
    // requirement term and the candidate's own term that proves it.
    const impliedHits = [
      ...new Set([...requirementPhrases, ...impliableCompetencies().filter((term) => mentions(req.rawText, term))]),
    ].flatMap((phrase) =>
      getImplyingCompetencies(phrase)
        .filter((term) => rolesMentioning(experiences, [term]).length > 0)
        .slice(0, 1)
        .map((via) => ({ phrase, via }))
    );
    const satisfiedByImplication = new Set(impliedHits.map((hit) => hit.phrase));

    // Tier 4: the requirement's terms appear in the candidate's own role descriptions and
    // bullets. "Experience building payment systems" is met by "built a double-entry ledger".
    let experienceEvidenceIds: EvidenceId[] = [];
    let experienceMatchPhrase: string | undefined;
    if (!matchedSkill && matchedClaims.length === 0 && req.category !== 'experience_level' && requirementPhrases.length > 0) {
      const roles = rolesMentioning(experiences, requirementPhrases);
      const projectHit = (profile.projects || []).some((project) =>
        requirementPhrases.some((phrase) =>
          [...getCompetencySynonyms(phrase)].some((synonym) =>
            mentions([project.title, project.description, ...project.highlights, ...project.technologiesUsed].join(' '), synonym)
          )
        )
      );
      if (roles.length > 0 || projectHit) {
        experienceEvidenceIds = evidenceMentioning(graph, requirementPhrases);
        experienceMatchPhrase = requirementPhrases[0];
      }
    }
    if (!matchedSkill && matchedClaims.length === 0 && !experienceMatchPhrase && req.category !== 'experience_level' && impliedHits.length > 0) {
      experienceEvidenceIds = evidenceMentioning(graph, impliedHits.map((hit) => hit.via));
      experienceMatchPhrase = impliedHits[0]!.phrase;
    }

    // Terms the posting names that nothing in the candidate's history covers.
    const missingParts = requirementPhrases
      .filter(
        (phrase) =>
          phrase.length >= 2 &&
          !satisfiedByImplication.has(phrase) &&
          !skills.some((skill) => areCompetenciesEquivalent(skill.name, phrase)) &&
          rolesMentioning(experiences, [phrase]).length === 0
      )
      .map((phrase) => {
        // Show the employer's own spelling ("Kubernetes"), not the lowercase lookup key.
        const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '[\\s-]+');
        return req.rawText.match(new RegExp(`\\b${escaped}\\b`, 'i'))?.[0] ?? phrase;
      });
    const partial = missingParts.length > 0 ? ` Not shown in your resume: ${missingParts.join(', ')}.` : '';

    // Evaluate years of experience shortfall if requirement demands a minimum
    let candidateYears: number | undefined;
    let yearsShortfall: number | undefined;

    if (matchedSkill && matchedSkill.yearsOfExperience !== undefined) {
      candidateYears = matchedSkill.yearsOfExperience;
    }
    if (req.yearsRequired !== undefined && req.yearsRequired > 0 && candidateYears === undefined) {
      // A specific technology ("5+ years of Go") counts the roles that used it; a general
      // demand ("5+ years of backend experience") counts the whole dated work history.
      const specificSkill = matchedSkill?.name;
      const scoped = specificSkill ? rolesMentioning(experiences, [normalizeCompetencyToken(specificSkill)]) : experiences;
      candidateYears = computeExperienceYears(scoped);
    }

    if (req.yearsRequired !== undefined && req.yearsRequired > 0) {
      const actualYears = candidateYears ?? 0;
      if (actualYears < req.yearsRequired) {
        yearsShortfall = req.yearsRequired - actualYears;
        experienceShortfallsCount++;
      }
    }

    const meetsYearsOnHistory =
      !matchedSkill &&
      req.category === 'experience_level' &&
      req.yearsRequired !== undefined &&
      candidateYears !== undefined &&
      candidateYears >= req.yearsRequired;

    // Determine match classification and confidence
    if (meetsYearsOnHistory) {
      if (isReq) requiredMetCount++;
      else preferredMetCount++;
      matches.push({
        requirementId: req.id,
        isMatched: true,
        confidenceScore: 0.9,
        matchedEvidenceIds: [],
        matchedClaimIds: [],
        matchedCompetency: `${candidateYears} years of dated experience`,
        matchTier: 'claim_match',
        candidateYears,
        rationale: `Your dated roles add up to about ${candidateYears} years. They ask for ${req.yearsRequired}+.`,
      });
    } else if (matchedSkill) {
      if (isReq) requiredMetCount++;
      else preferredMetCount++;

      const hasEvidence = matchedSkill.evidenceRefs.length > 0;
      let matchTier: MatchTier;
      let baseConfidence: number;

      if (!isSynonym) {
        matchTier = hasEvidence ? 'exact_evidence' : 'exact_skill';
        baseConfidence = hasEvidence ? 1.0 : 0.65;
      } else {
        matchTier = hasEvidence ? 'synonym_evidence' : 'synonym_skill';
        baseConfidence = hasEvidence ? 0.85 : 0.60;
      }

      // Seniority penalty: missing years reduces confidence score proportionally
      if (yearsShortfall && yearsShortfall > 0) {
        baseConfidence = Math.max(0.4, Number((baseConfidence - 0.15).toFixed(2)));
      }

      matches.push({
        requirementId: req.id,
        isMatched: true,
        ...(missingParts.length > 0 ? { missingParts } : {}),
        confidenceScore: missingParts.length > 0 ? Math.min(baseConfidence, 0.6) : baseConfidence,
        matchedEvidenceIds: matchedSkill.evidenceRefs,
        matchedClaimIds: matchedClaims.map((c) => c.id),
        matchedCompetency: matchedSkill.name,
        matchTier,
        candidateYears,
        yearsShortfall,
        rationale:
          (isSynonym
            ? `Matched through ${matchedSkill.name}${hasEvidence ? ', backed by your resume' : ', listed in skills only'}.`
            : `${matchedSkill.name}${hasEvidence ? ' appears in your work history.' : ' is in your skills list only.'}`) + partial,
      });
    } else if (matchedClaims.length > 0) {
      if (isReq) requiredMetCount++;
      else preferredMetCount++;

      const evidenceIds = matchedClaims.flatMap((c) => c.supportedByEvidenceIds);
      matches.push({
        requirementId: req.id,
        isMatched: true,
        confidenceScore: 0.75,
        matchedEvidenceIds: evidenceIds,
        matchedClaimIds: matchedClaims.map((c) => c.id),
        matchedCompetency: req.normalizedSkillOrCompetency,
        matchTier: 'claim_match',
        candidateYears,
        yearsShortfall,
        rationale: `Backed by ${matchedClaims.length} line${matchedClaims.length === 1 ? '' : 's'} in your resume.`,
      });
    } else if (experienceMatchPhrase) {
      if (isReq) requiredMetCount++;
      else preferredMetCount++;
      matches.push({
        requirementId: req.id,
        isMatched: true,
        confidenceScore: experienceEvidenceIds.length > 0 ? 0.8 : 0.7,
        matchedEvidenceIds: experienceEvidenceIds,
        matchedClaimIds: [],
        matchedCompetency: experienceMatchPhrase,
        // Found in the candidate's own role text, so it is work-history evidence even when no
        // single evidence node was linked.
        matchTier: 'synonym_evidence',
        candidateYears,
        yearsShortfall,
        ...(missingParts.length > 0 ? { missingParts } : {}),
        rationale: (() => {
          const hit = impliedHits.find((item) => item.phrase === experienceMatchPhrase);
          if (hit) return `Your ${displayTerm(hit.via, profile)} work covers ${displayTerm(hit.phrase, profile, req.rawText)}.${partial}`;
          return `Your work history shows ${displayTerm(experienceMatchPhrase!, profile, req.rawText)} work.${partial}`;
        })(),
      });
    } else {
      if (isReq) {
        missingRequired.push(req);
        hardGapsCount++;
      } else {
        softGapsCount++;
      }

      matches.push({
        requirementId: req.id,
        isMatched: false,
        confidenceScore: 0.0,
        matchedEvidenceIds: [],
        matchedClaimIds: [],
        matchTier: 'unmatched',
        ...(candidateYears !== undefined && req.yearsRequired ? { candidateYears, yearsShortfall } : {}),
        rationale:
          req.yearsRequired && candidateYears !== undefined
            ? `Your dated roles add up to about ${candidateYears} years. They ask for ${req.yearsRequired}+.`
            : gapRationale(req.rawText, requirementPhrases, profile),
      });
    }
  }

  // Weighting: 75% required qualifications, 25% preferred qualifications
  const requiredWeight = 0.75;
  const preferredWeight = 0.25;

  const reqRatio = requiredCount > 0 ? requiredMetCount / requiredCount : 1.0;
  const prefRatio = preferredCount > 0 ? preferredMetCount / preferredCount : 1.0;

  const overallMatchScore = Math.round(
    (reqRatio * requiredWeight + prefRatio * preferredWeight) * 100
  );

  return {
    totalRequirements: requirements.length,
    requiredCount,
    requiredMetCount,
    preferredCount,
    preferredMetCount,
    overallMatchScore,
    matches,
    missingRequiredRequirements: missingRequired,
    hardGapsCount,
    softGapsCount,
    experienceShortfallsCount,
  };
}
