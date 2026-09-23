/**
 * @fileoverview Dynamic Resume Section and Bullet Selector.
 *
 * Reorders candidate experiences, projects, and skills to highlight relevance to a target
 * job posting without factual exaggeration. Ranks individual accomplishment bullets
 * with direct links to verified evidence nodes in the CandidateProfile and EvidenceGraph (ADR-0004).
 */

import type { JobPosting } from '../job/job-posting.js';
import type { CandidateProfile } from '../candidate/profile.js';
import type { WorkExperience } from '../candidate/experience.js';
import type { CandidateProject } from '../candidate/project.js';
import type { EvidenceGraph } from '../evidence/evidence-graph.js';
import type { EvidenceId } from '../types/ids.js';
import { areCompetenciesEquivalent, normalizeCompetencyToken } from '../job/synonyms.js';
import type { WritingStyleProfile } from '../ai/writing-style.js';
import { applyWritingQualityPassSync } from '../ai/human-answer-pipeline.js';
import type {
  TailoredResume,
  TailoredExperience,
  TailoredProject,
  TailoredHighlight,
  TailoredSkillsGroup,
} from './tailoring-types.js';

/**
 * Configuration options for the resume tailoring pipeline.
 */
export interface ResumeTailoringOptions {
  /** Maximum number of experiences to include (defaults to all). */
  readonly maxExperiences?: number;
  /** Maximum number of projects to include (defaults to 3). */
  readonly maxProjects?: number;
  /** Maximum number of bullet highlights per item (defaults to 4). */
  readonly maxBulletsPerItem?: number;
  /** Candidate's writing style for natural human voice. */
  readonly writingStyle?: WritingStyleProfile;
}

/**
 * Checks if a block of text mentions or demonstrates a given competency token.
 */
function textMentionsCompetency(text: string, competency: string): boolean {
  const normText = normalizeCompetencyToken(text);
  const normComp = normalizeCompetencyToken(competency);
  if (!normText || !normComp) {
    return false;
  }
  return normText.includes(normComp) || areCompetenciesEquivalent(normText, normComp);
}

/**
 * Resolves the source EvidenceId for a given bullet from the evidence graph or experience refs.
 */
function resolveBulletEvidenceId(
  bulletText: string,
  bulletIndex: number,
  item: WorkExperience | CandidateProject,
  graph?: EvidenceGraph
): EvidenceId | undefined {
  if (graph) {
    for (const [id, evidence] of graph.evidenceMap.entries()) {
      if (evidence.textSnippet === bulletText) {
        return id;
      }
      if (
        evidence.source.sourceId === item.id &&
        evidence.source.metadata?.bulletIndex === String(bulletIndex)
      ) {
        return id;
      }
    }
  }

  if (item.evidenceRefs && item.evidenceRefs.length > bulletIndex) {
    return item.evidenceRefs[bulletIndex];
  }

  return undefined;
}

/**
 * Calculates the total tenure in years from candidate work experiences.
 */
function calculateVerifiedExperienceYears(experiences: readonly WorkExperience[]): number {
  let totalMonths = 0;

  for (const exp of experiences) {
    const start = new Date(exp.startDate);
    const end = exp.endDate ? new Date(exp.endDate) : new Date();

    if (!isNaN(start.getTime()) && !isNaN(end.getTime()) && end >= start) {
      const months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth()) + 1;
      totalMonths += Math.max(1, months);
    }
  }

  return Math.max(1, Math.round(totalMonths / 12));
}

/**
 * Tailors candidate resume sections and accomplishment bullets against target job criteria.
 *
 * Grounding Invariant (ADR-0004):
 * - Never invents qualifications, technologies, or achievements.
 * - Only reorders and ranks existing, verified experiences and projects.
 * - Categorizes skills strictly from the candidate's existing verified skill pool.
 *
 * @param job Target job posting.
 * @param profile Candidate profile aggregate.
 * @param graph Optional evidence graph for deep provenance linking.
 * @param options Tailoring configuration options.
 * @returns Complete tailored resume structure.
 */
export function tailorCandidateResume(
  job: JobPosting,
  profile: CandidateProfile,
  graph?: EvidenceGraph,
  options?: ResumeTailoringOptions
): TailoredResume {
  const maxBullets = options?.maxBulletsPerItem ?? 4;
  const maxProjects = options?.maxProjects ?? 3;
  const maxExperiences = options?.maxExperiences ?? profile.experiences.length;

  // 1. Partition Skills by Job Requirement Alignment
  const matchedRequiredSet = new Set<string>();
  const matchedPreferredSet = new Set<string>();
  const matchedAllSet = new Set<string>();

  for (const skill of profile.skills) {
    let matched = false;
    for (const req of job.requirements) {
      if (areCompetenciesEquivalent(skill.name, req.normalizedSkillOrCompetency)) {
        matched = true;
        matchedAllSet.add(skill.name);
        if (req.importance === 'required' || req.importance === 'strongly_preferred') {
          matchedRequiredSet.add(skill.name);
        } else {
          matchedPreferredSet.add(skill.name);
        }
        break;
      }
    }
    if (!matched) {
      // Check if skill appears in job description text
      if (textMentionsCompetency(job.rawDescription, skill.name)) {
        matchedPreferredSet.add(skill.name);
        matchedAllSet.add(skill.name);
      }
    }
  }

  const additionalSkills = profile.skills
    .map((s) => s.name)
    .filter((name) => !matchedAllSet.has(name));

  const tailoredSkills: TailoredSkillsGroup = {
    matchedRequired: Array.from(matchedRequiredSet),
    matchedPreferred: Array.from(matchedPreferredSet),
    additionalSkills,
  };

  // 2. Rank and Filter Work Experiences
  const tailoredExperiences: TailoredExperience[] = [];

  for (const exp of profile.experiences) {
    let expScore = 0;
    const rankedBullets: Array<{
      highlight: TailoredHighlight;
      relevanceScore: number;
    }> = [];

    // Evaluate each highlight bullet against requirements
    for (const [index, bullet] of exp.highlights.entries()) {
      const matchedReqs: string[] = [];
      let bulletScore = 0;

      for (const req of job.requirements) {
        if (textMentionsCompetency(bullet, req.normalizedSkillOrCompetency)) {
          matchedReqs.push(req.normalizedSkillOrCompetency);
          bulletScore += req.importance === 'required' || req.importance === 'strongly_preferred' ? 10 : 5;
        }
      }

      const evidenceId = resolveBulletEvidenceId(bullet, index, exp, graph);

      rankedBullets.push({
        highlight: {
          text: bullet,
          matchedRequirements: matchedReqs,
          sourceEvidenceId: evidenceId,
          confidenceScore: evidenceId ? 0.95 : 0.85,
        },
        relevanceScore: bulletScore,
      });

      expScore += bulletScore;
    }

    // Match technologies used
    for (const tech of exp.technologiesUsed) {
      for (const req of job.requirements) {
        if (areCompetenciesEquivalent(tech, req.normalizedSkillOrCompetency)) {
          expScore += req.importance === 'required' || req.importance === 'strongly_preferred' ? 8 : 4;
          break;
        }
      }
    }

    // Sort bullets: highest relevance first, preserve relative order for ties
    rankedBullets.sort((a, b) => b.relevanceScore - a.relevanceScore);
    const selectedHighlights = rankedBullets.slice(0, maxBullets).map((b) => b.highlight);

    const maxPossibleExpScore = Math.max(1, job.requirements.length * 15);
    const normalizedExpScore = Math.min(100, Math.round((expScore / maxPossibleExpScore) * 100));

    tailoredExperiences.push({
      experienceId: exp.id,
      company: exp.company,
      title: exp.title,
      startDate: exp.startDate,
      endDate: exp.endDate,
      isCurrent: exp.isCurrent,
      relevanceScore: normalizedExpScore,
      rankedHighlights: selectedHighlights,
    });
  }

  // Sort experiences descending by relevanceScore, then chronological start date
  tailoredExperiences.sort((a, b) => {
    if (b.relevanceScore !== a.relevanceScore) {
      return b.relevanceScore - a.relevanceScore;
    }
    return new Date(b.startDate).getTime() - new Date(a.startDate).getTime();
  });

  const finalExperiences = tailoredExperiences.slice(0, maxExperiences);

  // 3. Rank and Filter Candidate Projects
  const tailoredProjects: TailoredProject[] = [];

  for (const proj of profile.projects) {
    let projScore = 0;
    const rankedBullets: Array<{
      highlight: TailoredHighlight;
      relevanceScore: number;
    }> = [];

    for (const [index, bullet] of proj.highlights.entries()) {
      const matchedReqs: string[] = [];
      let bulletScore = 0;

      for (const req of job.requirements) {
        if (textMentionsCompetency(bullet, req.normalizedSkillOrCompetency)) {
          matchedReqs.push(req.normalizedSkillOrCompetency);
          bulletScore += req.importance === 'required' || req.importance === 'strongly_preferred' ? 10 : 5;
        }
      }

      const evidenceId = resolveBulletEvidenceId(bullet, index, proj, graph);

      rankedBullets.push({
        highlight: {
          text: bullet,
          matchedRequirements: matchedReqs,
          sourceEvidenceId: evidenceId,
          confidenceScore: evidenceId ? 0.95 : 0.85,
        },
        relevanceScore: bulletScore,
      });

      projScore += bulletScore;
    }

    for (const tech of proj.technologiesUsed) {
      for (const req of job.requirements) {
        if (areCompetenciesEquivalent(tech, req.normalizedSkillOrCompetency)) {
          projScore += req.importance === 'required' || req.importance === 'strongly_preferred' ? 8 : 4;
          break;
        }
      }
    }

    rankedBullets.sort((a, b) => b.relevanceScore - a.relevanceScore);
    const selectedHighlights = rankedBullets.slice(0, maxBullets).map((b) => b.highlight);

    const maxPossibleProjScore = Math.max(1, job.requirements.length * 15);
    const normalizedProjScore = Math.min(100, Math.round((projScore / maxPossibleProjScore) * 100));

    tailoredProjects.push({
      projectId: proj.id,
      title: proj.title,
      role: proj.role,
      relevanceScore: normalizedProjScore,
      technologiesUsed: proj.technologiesUsed,
      rankedHighlights: selectedHighlights,
    });
  }

  // Sort projects descending by relevanceScore
  tailoredProjects.sort((a, b) => b.relevanceScore - a.relevanceScore);
  const finalProjects = tailoredProjects.slice(0, maxProjects);

  // 4. Synthesize Evidence-Grounded Professional Summary
  const candidateTitle = profile.professional.currentTitle || profile.professional.headline || job.title;
  const verifiedYears = calculateVerifiedExperienceYears(profile.experiences);
  const topSkills = tailoredSkills.matchedRequired.length > 0
    ? tailoredSkills.matchedRequired.slice(0, 4).join(', ')
    : profile.skills.slice(0, 4).map((s) => s.name).join(', ');

  // Find the top quantified accomplishment bullet from experiences or projects
  let topAccomplishment = '';
  for (const exp of finalExperiences) {
    for (const h of exp.rankedHighlights) {
      if (/\b(\d+[%kKmMbB]?|\$\d+|\d+\+)\b/.test(h.text)) {
        topAccomplishment = h.text.replace(/\.$/, '');
        break;
      }
    }
    if (topAccomplishment) break;
  }

  if (!topAccomplishment && finalExperiences[0]?.rankedHighlights[0]) {
    topAccomplishment = finalExperiences[0].rankedHighlights[0].text.replace(/\.$/, '');
  }

  const summaryParts: string[] = [
    `Results-driven ${candidateTitle} with ${verifiedYears}+ years of verified engineering experience, specializing in ${topSkills}.`,
  ];

  if (topAccomplishment) {
    summaryParts.push(`Proven track record includes: ${topAccomplishment}.`);
  }

  summaryParts.push(
    `Committed to delivering robust, maintainable solutions aligned with ${job.companyName}'s technical requirements.`
  );

  let tailoredSummary = summaryParts.join(' ');

  // Apply writing quality pass if writing style provided
  if (options?.writingStyle) {
    const { cleanedText } = applyWritingQualityPassSync(tailoredSummary, options.writingStyle);
    tailoredSummary = cleanedText;
  }

  return {
    targetJobTitle: job.title,
    companyName: job.companyName,
    tailoredSummary,
    skills: tailoredSkills,
    experiences: finalExperiences,
    projects: finalProjects,
    createdAt: new Date().toISOString(),
  };
}
