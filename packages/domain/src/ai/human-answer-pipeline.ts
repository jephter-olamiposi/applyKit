import type { WritingStyleProfile } from './writing-style.js';
import type { CandidateProfile } from '../candidate/profile.js';
import type { JobPosting } from '../job/job-posting.js';
import type { EvidenceGraph } from '../evidence/evidence-graph.js';
import { validateWritingQuality, FORBIDDEN_PATTERNS, CORPORATE_FILLER_PATTERNS, AI_PHRASING_PATTERNS } from './writing-style.js';

export type AnswerType = 
  | 'company_motivation'
  | 'technical_question'
  | 'behavioral_question'
  | 'why_interested'
  | 'tell_about_yourself'
  | 'cover_letter'
  | 'recruiter_message'
  | 'additional_notes'
  | 'custom';

export interface HumanAnswerContext {
  readonly question: string;
  readonly answerType: AnswerType;
  readonly userProfile: CandidateProfile;
  readonly jobPosting?: JobPosting;
  readonly evidenceGraph?: EvidenceGraph;
  readonly writingStyle: WritingStyleProfile;
  readonly relevantExperience: readonly string[];
  readonly relevantProjects: readonly string[];
  readonly companyContext?: string;
  readonly lengthPreference?: 'short' | 'normal' | 'detailed';
}

export interface PipelineStep {
  readonly name: string;
  readonly execute: (ctx: PipelineContext) => Promise<PipelineContext>;
}

export interface PipelineContext {
  readonly originalQuestion: string;
  readonly answerType: AnswerType;
  readonly userProfile: CandidateProfile;
  readonly jobPosting?: JobPosting;
  readonly evidenceGraph?: EvidenceGraph;
  readonly writingStyle: WritingStyleProfile;
  readonly relevantExperience: readonly string[];
  readonly relevantProjects: readonly string[];
  readonly companyContext?: string;
  readonly lengthPreference: 'short' | 'normal' | 'detailed';
  draftedAnswer?: string;
  cleanedAnswer?: string;
  validatedAnswer?: string;
  qualityResult?: {
    passed: boolean;
    violations: string[];
    suggestions: string[];
  };
  regenerationCount: number;
}

export interface HumanAnswerResult {
  readonly answer: string;
  readonly passedQualityCheck: boolean;
  readonly violations: readonly string[];
  readonly suggestions: readonly string[];
  readonly regenerationCount: number;
}

/**
 * Programmatically cleans and humanizes text by stripping AI phrasing,
 * conversational throat-clearing, corporate clichés, and markdown formatting.
 *
 * @param text The input text to clean.
 * @returns Cleaned, human-authentic text.
 */
export function sanitizeHumanText(text: string): string {
  let cleaned = text;

  // Natural verb normalization: replace corporate jargon with plain direct engineering verbs
  cleaned = cleaned
    .replace(/\butilizing\b/gi, 'using')
    .replace(/\butilized\b/gi, 'used')
    .replace(/\butilize\b/gi, 'use')
    .replace(/\butilizes\b/gi, 'uses')
    .replace(/\bleveraging\b/gi, 'applying')
    .replace(/\bleveraged\b/gi, 'applied')
    .replace(/\bleverage\b/gi, 'apply')
    .replace(/\bleverages\b/gi, 'applies');

  // Remove forbidden patterns
  for (const pattern of FORBIDDEN_PATTERNS) {
    cleaned = cleaned.replace(pattern, '');
  }
  for (const pattern of CORPORATE_FILLER_PATTERNS) {
    cleaned = cleaned.replace(pattern, '');
  }
  for (const pattern of AI_PHRASING_PATTERNS) {
    cleaned = cleaned.replace(pattern, '');
  }

  // Remove conversational preambles & throat-clearing
  cleaned = cleaned.replace(
    /^(Certainly!|Sure!|Sure thing!|Here is|Here's an|I'd be happy to|Gladly|Of course!)[,\.\s]+/i,
    ''
  );
  cleaned = cleaned.replace(
    /^(As an experienced|As a seasoned|With over \d+ years of experience in)[^,]+,\s*/i,
    ''
  );

  // Remove unnecessary explanation
  cleaned = cleaned.replace(
    /^(I think|I believe|In my opinion|It seems to me|From my perspective),?\s*/i,
    ''
  );
  cleaned = cleaned.replace(
    /(I would say that|I would like to mention that|It is worth noting that|I want to point out that),?\s*/gi,
    ''
  );
  cleaned = cleaned.replace(
    /\s*(?:I look forward to (?:hearing from you|discussing this opportunity)|Thank you for (?:your time and consideration|considering my application))\.?\s*$/i,
    ''
  );
  cleaned = cleaned.replace(
    /\b(in conclusion|to summarize|in summary|to conclude),?\s*/gi,
    ''
  );

  // Remove stylistic devices & markdown in plain answers
  cleaned = cleaned
    .replace(/—/g, ', ')
    .replace(/:\s*$/gm, '.')
    .replace(/^\s*[-•*]\s+/gm, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n');

  // Collapse duplicate spaces and clean up orphan punctuation
  cleaned = cleaned
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/^\s*[,;.-]\s*/, '')
    .replace(/([.!?])\s*[,;]\s*/g, '$1 ')
    .replace(/\s+([,;.!?])/g, '$1')
    .trim();

  // Capitalize initial letter if stripped first word was lowercase
  if (cleaned.length > 0) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }

  return cleaned;
}

/**
 * Applies writing quality validation and cleaning to text (synchronous version).
 * Cleans conversational preambles, forbidden AI phrases, and corporate filler,
 * then validates against the candidate's WritingStyleProfile.
 *
 * @param text The input text to clean and validate.
 * @param writingStyle The candidate's writing style profile.
 * @returns Object containing cleaned text, quality check status, violations, and suggestions.
 */
export function applyWritingQualityPassSync(
  text: string,
  writingStyle: WritingStyleProfile
): {
  cleanedText: string;
  passedQualityCheck: boolean;
  violations: readonly string[];
  suggestions: readonly string[];
} {
  const cleaned = sanitizeHumanText(text);
  const result = validateWritingQuality(cleaned, writingStyle);

  return {
    cleanedText: cleaned,
    passedQualityCheck: result.passed,
    violations: result.violations,
    suggestions: result.suggestions,
  };
}