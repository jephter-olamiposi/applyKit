import type { Requirement } from '../job/requirement.js';
import type { CandidateSkill } from '../candidate/skill.js';
import type { CandidateClaim } from '../evidence/candidate-claim.js';
import type { WorkExperience } from '../candidate/experience.js';
import type { CandidateProject } from '../candidate/project.js';
import type { SavedAnswer } from '../candidate/saved-answer.js';
import type { FieldType } from '../form/field-type.js';
import type { SelectOption } from '../form/application-field.js';

/**
 * Task classifications determining prompt context builders and payload scoping.
 */
export type AIContextType =
  | 'job_extraction'
  | 'requirement_matching'
  | 'field_answering'
  | 'resume_tailoring'
  | 'cover_letter';

/**
 * Scoped payload for extracting structured job requirements from an external webpage.
 *
 * Privacy Invariant: Contains ZERO candidate data. External career pages are analyzed without
 * transmitting candidate identity or history to the AI provider.
 */
export interface JobExtractionContext {
  readonly rawHtmlOrText: string;
  readonly pageUrl: string;
  readonly pageTitle?: string;
}

/**
 * Scoped payload for evaluating candidate alignment against job requirements.
 *
 * Privacy Invariant: Excludes candidate contact details (phone, email, street address),
 * compensation targets, and demographic self-disclosures.
 */
export interface RequirementMatchingContext {
  readonly jobTitle: string;
  readonly companyName: string;
  readonly requirements: readonly Requirement[];
  readonly candidateSkills: readonly CandidateSkill[];
  readonly candidateClaims: readonly CandidateClaim[];
  readonly relevantExperienceHighlights: readonly string[];
}

/**
 * Scoped payload for answering a specific form input or question.
 *
 * Privacy Invariant: Restricts data transmission strictly to the question text and candidate claims
 * relevant to that specific question. Excludes the rest of the candidate database.
 */
export interface FieldAnsweringContext {
  readonly fieldLabel: string;
  readonly fieldType: FieldType;
  readonly options?: readonly SelectOption[];
  readonly placeholder?: string;
  readonly maxLength?: number;
  readonly relevantAnswers: readonly SavedAnswer[];
  readonly relevantClaims: readonly CandidateClaim[];
}

/**
 * Scoped payload for tailoring resume bullet points or summary to a target job.
 *
 * Privacy Invariant: Excludes demographic self-disclosures, contact details, and unrelated saved answers.
 */
export interface ResumeTailoringContext {
  readonly targetJobTitle: string;
  readonly companyName: string;
  readonly requirements: readonly Requirement[];
  readonly experiences: readonly WorkExperience[];
  readonly projects: readonly CandidateProject[];
  readonly skills: readonly CandidateSkill[];
}

/**
 * Scoped payload for generating an evidence-grounded cover letter.
 *
 * Privacy Invariant: Restricts outbound data strictly to role requirements, verified skills,
 * and specific accomplishment bullets. Excludes unneeded contact details and demographic disclosures.
 */
export interface CoverLetterContext {
  readonly targetJobTitle: string;
  readonly companyName: string;
  readonly candidateName: string;
  readonly requirements: readonly Requirement[];
  readonly candidateSkills: readonly CandidateSkill[];
  readonly verifiedAccomplishments: readonly string[];
}

/**
 * Union of all strictly scoped AI context payloads.
 */
export type FocusedContext =
  | JobExtractionContext
  | RequirementMatchingContext
  | FieldAnsweringContext
  | ResumeTailoringContext
  | CoverLetterContext;

