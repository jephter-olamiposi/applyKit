/**
 * @fileoverview Highlight Suggestion Engine for Application Tailoring.
 *
 * Ranks a candidate's projects, work experiences, and evidence items by their
 * specific relevance to an open job opportunity's requirements. Generates targeted
 * recommendations indicating which past accomplishments to feature in resumes,
 * cover letters, or application questionnaires.
 */

import type { Requirement } from './requirement.js';
import type { CandidateProfile } from '../candidate/profile.js';
import type { EvidenceGraph } from '../evidence/evidence-graph.js';
import { areCompetenciesEquivalent, normalizeCompetencyToken } from './synonyms.js';

/**
 * Type of candidate asset recommended for highlighting.
 */
export type HighlightSourceType = 'project' | 'work_experience' | 'evidence_item';

/**
 * Targeted suggestion for an asset to emphasize in the application.
 */
export interface HighlightSuggestion {
  readonly id: string;
  readonly sourceType: HighlightSourceType;
  readonly title: string;
  readonly subtitle?: string;
  /** Normalized relevance score from 0 to 100. */
  readonly relevanceScore: number;
  readonly matchedRequirementsCount: number;
  readonly keyCompetenciesMatched: readonly string[];
  /** Verifiable accomplishment bullets specifically addressing role requirements. */
  readonly recommendedFocusBullets: readonly string[];
  readonly rationale: string;
}

/**
 * Evaluates candidate experiences and projects against job requirements to produce ranked highlight suggestions.
 *
 * Grounding Invariant: Only recommends genuine accomplishments and technologies present in the verified profile.
 * Never invents bullet points or embellishes outcomes.
 *
 * @param requirements Extracted job requirements.
 * @param profile Candidate profile aggregate.
 * @param graph Optional evidence graph for deep snippet corroboration.
 * @param limit Maximum number of ranked recommendations to return (defaults to 5).
 * @returns Ranked array of highlight suggestions.
 */
export function generateHighlightSuggestions(
  requirements: readonly Requirement[],
  profile: CandidateProfile,
  graph?: EvidenceGraph,
  limit = 5
): readonly HighlightSuggestion[] {
  if (requirements.length === 0) {
    return [];
  }

  const suggestions: HighlightSuggestion[] = [];

  // Helper to check if a text contains any competency mention
  const checkTextMentions = (text: string, competency: string): boolean => {
    const normText = normalizeCompetencyToken(text);
    const normComp = normalizeCompetencyToken(competency);
    if (!normText || !normComp) return false;
    return normText.includes(normComp) || areCompetenciesEquivalent(normText, normComp);
  };

  // 1. Evaluate Candidate Projects
  for (const project of profile.projects) {
    let score = 0;
    const matchedCompetencies = new Set<string>();
    const matchedBullets: string[] = [];

    for (const req of requirements) {
      const isReq = req.importance === 'required' || req.importance === 'strongly_preferred';
      const weight = isReq ? 10 : 5;
      let matched = false;

      // Match against technologies used
      for (const tech of project.technologiesUsed) {
        if (areCompetenciesEquivalent(tech, req.normalizedSkillOrCompetency)) {
          matchedCompetencies.add(req.normalizedSkillOrCompetency);
          matched = true;
          break;
        }
      }

      // Match against project highlights
      for (const highlight of project.highlights) {
        if (checkTextMentions(highlight, req.normalizedSkillOrCompetency)) {
          matchedCompetencies.add(req.normalizedSkillOrCompetency);
          matched = true;
          if (!matchedBullets.includes(highlight)) {
            matchedBullets.push(highlight);
          }
        }
      }

      if (matched) {
        score += weight;
      }
    }

    if (matchedCompetencies.size > 0) {
      // Normalize score relative to requirements count
      const maxPossible = Math.max(1, requirements.length * 10);
      const normalizedScore = Math.min(100, Math.round((score / maxPossible) * 100));

      const matchedList = Array.from(matchedCompetencies);
      suggestions.push({
        id: `project-${project.id}`,
        sourceType: 'project',
        title: project.title,
        subtitle: project.role ? `Role: ${project.role}` : 'Technical Project',
        relevanceScore: Math.max(normalizedScore, 20), // Baseline floor for relevant project
        matchedRequirementsCount: matchedCompetencies.size,
        keyCompetenciesMatched: matchedList,
        recommendedFocusBullets: matchedBullets.slice(0, 3),
        rationale: `Demonstrates hands-on proficiency in ${matchedList.slice(0, 3).join(', ')}${
          matchedList.length > 3 ? ` and ${matchedList.length - 3} more` : ''
        }.`,
      });
    }
  }

  // 2. Evaluate Work Experiences
  for (const exp of profile.experiences) {
    let score = 0;
    const matchedCompetencies = new Set<string>();
    const matchedBullets: string[] = [];

    for (const req of requirements) {
      const isReq = req.importance === 'required' || req.importance === 'strongly_preferred';
      const weight = isReq ? 12 : 6;
      let matched = false;

      // Match technologies
      for (const tech of exp.technologiesUsed) {
        if (areCompetenciesEquivalent(tech, req.normalizedSkillOrCompetency)) {
          matchedCompetencies.add(req.normalizedSkillOrCompetency);
          matched = true;
          break;
        }
      }

      // Match accomplishment highlights
      for (const highlight of exp.highlights) {
        if (checkTextMentions(highlight, req.normalizedSkillOrCompetency)) {
          matchedCompetencies.add(req.normalizedSkillOrCompetency);
          matched = true;
          if (!matchedBullets.includes(highlight)) {
            matchedBullets.push(highlight);
          }
        }
      }

      if (matched) {
        score += weight;
      }
    }

    if (matchedCompetencies.size > 0) {
      const maxPossible = Math.max(1, requirements.length * 12);
      const normalizedScore = Math.min(100, Math.round((score / maxPossible) * 100));

      const matchedList = Array.from(matchedCompetencies);
      suggestions.push({
        id: `experience-${exp.id}`,
        sourceType: 'work_experience',
        title: `${exp.title} at ${exp.company}`,
        subtitle: `${exp.startDate} – ${exp.isCurrent ? 'Present' : exp.endDate || 'N/A'}`,
        relevanceScore: Math.max(normalizedScore, 25),
        matchedRequirementsCount: matchedCompetencies.size,
        keyCompetenciesMatched: matchedList,
        recommendedFocusBullets: matchedBullets.slice(0, 3),
        rationale: `Provides production track record satisfying ${matchedList.length} role requirements (${matchedList.slice(0, 3).join(', ')}).`,
      });
    }
  }

  // Sort descending by relevanceScore, then by matchedRequirementsCount
  suggestions.sort((a, b) => {
    if (b.relevanceScore !== a.relevanceScore) {
      return b.relevanceScore - a.relevanceScore;
    }
    return b.matchedRequirementsCount - a.matchedRequirementsCount;
  });

  return suggestions.slice(0, limit);
}
