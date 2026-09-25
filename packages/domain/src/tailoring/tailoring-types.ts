/**
 * @fileoverview Domain types and contracts for evidence-grounded resume and cover letter tailoring.
 *
 * Implements strict type schemas ensuring that all tailored candidate documents cite
 * verifiable evidence from the EvidenceGraph and CandidateProfile (ADR-0004).
 */

import type { EvidenceId, ClaimId } from '../types/ids.js';

/**
 * Individual tailored bullet point with requirement relevance and evidence backing.
 */
export interface TailoredHighlight {
  /** Unembellished accomplishment text formatted for maximum impact. */
  readonly text: string;
  /** Competencies or job requirements directly addressed by this bullet. */
  readonly matchedRequirements: readonly string[];
  /** Verifiable evidence unit backing this statement (Zero Hallucination invariant). */
  readonly sourceEvidenceId?: EvidenceId;
  /** Grounding confidence rating between 0.0 and 1.0. */
  readonly confidenceScore: number;
}

/**
 * Work experience section reordered and curated for target job relevance.
 */
export interface TailoredExperience {
  readonly experienceId: string;
  readonly company: string;
  readonly title: string;
  readonly startDate: string;
  readonly endDate?: string;
  readonly isCurrent: boolean;
  /** Normalized relevance score from 0 to 100 relative to job criteria. */
  readonly relevanceScore: number;
  /** Bullets ranked by alignment with target role requirements. */
  readonly rankedHighlights: readonly TailoredHighlight[];
}

/**
 * Candidate project section reordered and curated for target job relevance.
 */
export interface TailoredProject {
  readonly projectId: string;
  readonly title: string;
  readonly role?: string;
  /** Normalized relevance score from 0 to 100 relative to job criteria. */
  readonly relevanceScore: number;
  readonly technologiesUsed: readonly string[];
  /** Project bullets ranked by alignment with target role requirements. */
  readonly rankedHighlights: readonly TailoredHighlight[];
}

/**
 * Categorized candidate skills partitioned by target job requirement alignment.
 */
export interface TailoredSkillsGroup {
  /** Skills directly satisfying non-negotiable or strongly preferred requirements. */
  readonly matchedRequired: readonly string[];
  /** Skills matching preferred or nice-to-have qualifications. */
  readonly matchedPreferred: readonly string[];
  /** Additional verified candidate skills demonstrating breadth. */
  readonly additionalSkills: readonly string[];
}

/**
 * Complete evidence-grounded tailored resume model.
 */
export interface TailoredResume {
  readonly targetJobTitle: string;
  readonly companyName: string;
  /** High-impact executive summary emphasizing matched competencies and verified track record. */
  readonly tailoredSummary: string;
  /** Partitioned skill competencies matching role specifications. */
  readonly skills: TailoredSkillsGroup;
  /** Work history ordered by requirement relevance. */
  readonly experiences: readonly TailoredExperience[];
  /** Projects ordered by requirement relevance. */
  readonly projects: readonly TailoredProject[];
  /** Selected design template for rendering. */
  readonly templateId?: ResumeTemplateId;
  /** Quality audit report evaluating compliance with the 14-Point Resume Golden Standard. */
  readonly qualityAudit?: ResumeQualityAuditReport;
  /** ISO 8601 generation timestamp. */
  readonly createdAt: string;
}

/**
 * Concrete evidence citation backing an assertion in a cover letter or resume.
 */
export interface AccomplishmentCitation {
  /** Assertion or achievement sentence within the document. */
  readonly claimText: string;
  /** Backing evidence unit identifier from EvidenceGraph. */
  readonly evidenceId?: EvidenceId;
  /** Verified claim identifier if derived from a structured claim. */
  readonly claimId?: ClaimId;
  /** Factual snippet extracted from candidate source documents proving this claim. */
  readonly sourceSnippet: string;
}

/**
 * Sectional paragraph of an evidence-grounded cover letter.
 */
export interface CoverLetterParagraph {
  readonly type: 'opening' | 'body' | 'closing';
  /** Thematic focus of this paragraph (e.g., 'System Scale', 'Cloud Infrastructure'). */
  readonly theme: string;
  readonly paragraphText: string;
  /** Concrete evidence citations proving every accomplishment mentioned in this paragraph. */
  readonly citedAccomplishments: readonly AccomplishmentCitation[];
}

/**
 * Complete evidence-grounded tailored cover letter.
 */
export interface TailoredCoverLetter {
  readonly targetJobTitle: string;
  readonly companyName: string;
  readonly candidateName: string;
  readonly openingParagraph: string;
  readonly bodyParagraphs: readonly CoverLetterParagraph[];
  readonly closingParagraph: string;
  /** Complete assembled text ready for plain text or markdown export. */
  readonly fullText: string;
  /** Consolidated array of all verified citations across all paragraphs. */
  readonly allCitations: readonly AccomplishmentCitation[];
  /** ISO 8601 generation timestamp. */
  readonly createdAt: string;
}

/**
 * A statement in a tailored document that has been successfully verified against the EvidenceGraph.
 */
export interface VerifiedStatement {
  readonly statement: string;
  readonly evidenceId?: EvidenceId;
  readonly claimId?: ClaimId;
  readonly sourceSnippet: string;
  readonly confidenceScore: number;
}

/**
 * A statement or assertion flagged for lacking verifiable evidence in the candidate's profile.
 */
export interface UnbackedStatement {
  readonly statement: string;
  readonly reason: string;
  readonly severity: 'warning' | 'critical';
}

/**
 * Audit result validating the factual grounding of a tailored resume or cover letter.
 */
export interface FactCheckReport {
  readonly documentType: 'resume' | 'cover_letter';
  /** Overall grounding score between 0 and 100. */
  readonly groundingScore: number;
  /** Certified true when 100% of statements cite verified evidence and zero unbacked statements exist. */
  readonly isPristine: boolean;
  readonly totalStatementsChecked: number;
  readonly verifiedStatements: readonly VerifiedStatement[];
  readonly unbackedStatements: readonly UnbackedStatement[];
  readonly recommendations: readonly string[];
  readonly auditedAt: string;
}

/**
 * Pre-designed professional resume template identifiers.
 */
export type ResumeTemplateId = 'modern' | 'classic' | 'minimalist' | 'compact';

/**
 * Unique identifiers for the 14 rules of the Resume Golden Standard.
 */
export type ResumeAuditCheckId =
  | 'template_selected'
  | 'one_page_fit'
  | 'job_keywords'
  | 'company_name'
  | 'first_item_aligned'
  | 'title_demonstrates_value'
  | 'online_links'
  | 'no_pronoun_i'
  | 'no_buzzwords'
  | 'action_words'
  | 'impact_measured'
  | 'skills_and_impressive_years'
  | 'impressive_sections'
  | 'no_typos_grammar';

/**
 * Individual checklist evaluation item in the 14-Point Resume Golden Standard.
 */
export interface ResumeAuditCheckItem {
  readonly id: ResumeAuditCheckId;
  readonly name: string;
  readonly status: 'passed' | 'warning' | 'failed';
  /** Normalized score between 0 and 100. */
  readonly score: number;
  readonly description: string;
  readonly recommendations: readonly string[];
  readonly autoFixable: boolean;
}

/**
 * Comprehensive 14-Point Resume Quality Audit Report.
 */
export interface ResumeQualityAuditReport {
  /** Overall score computed as weighted average of all 14 criteria (0-100). */
  readonly overallScore: number;
  /** True when all 14 criteria achieve passed or warning status with 0 failures. */
  readonly isReady: boolean;
  readonly passedCount: number;
  readonly totalCount: number;
  readonly checks: Record<ResumeAuditCheckId, ResumeAuditCheckItem>;
  readonly auditedAt: string;
}

/**
 * Options for generating tailored resume PDFs.
 */
export interface ResumePdfOptions {
  readonly templateId?: ResumeTemplateId;
  readonly onePageFit?: boolean;
}
