import type { FocusedContext, AIContextType } from './contexts.js';
import type { WritingStyleProfile, WritingStyleFeatures } from './writing-style.js';
import type { CandidateProfile } from '../candidate/profile.js';
import type { JobPosting } from '../job/job-posting.js';
import type { EvidenceGraph } from '../evidence/evidence-graph.js';
import { validateWritingQuality, extractWritingFeatures, createWritingStyleProfile, DEFAULT_WRITING_STYLE, FORBIDDEN_PATTERNS, CORPORATE_FILLER_PATTERNS, AI_PHRASING_PATTERNS } from './writing-style.js';

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

export const HUMAN_ANSWER_PIPELINE_STEPS: readonly PipelineStep[] = [
  {
    name: 'understand_question',
    execute: async (ctx) => ({
      ...ctx,
      // Question understanding happens in the prompt
    }),
  },
  {
    name: 'find_relevant_experience',
    execute: async (ctx) => ({
      ...ctx,
      // Experience matching happens before pipeline
    }),
  },
  {
    name: 'find_relevant_projects',
    execute: async (ctx) => ({
      ...ctx,
      // Project matching happens before pipeline
    }),
  },
  {
    name: 'find_company_context',
    execute: async (ctx) => ({
      ...ctx,
      // Company research happens before pipeline if needed
    }),
  },
  {
    name: 'draft_natural_answer',
    execute: async (ctx) => {
      // This step is implemented via AI prompt
      return ctx;
    },
  },
  {
    name: 'remove_generic_ai_language',
    execute: async (ctx) => {
      if (!ctx.draftedAnswer) return ctx;
      let cleaned = ctx.draftedAnswer;
      
      for (const pattern of FORBIDDEN_PATTERNS) {
        cleaned = cleaned.replace(pattern, '');
      }
      for (const pattern of CORPORATE_FILLER_PATTERNS) {
        cleaned = cleaned.replace(pattern, '');
      }
      for (const pattern of AI_PHRASING_PATTERNS) {
        cleaned = cleaned.replace(pattern, '');
      }
      
      cleaned = cleaned
        .replace(/—/g, '')
        .replace(/:/g, '')
        .replace(/^\s*[-•]\s+/gm, '')
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      
      return { ...ctx, cleanedAnswer: cleaned };
    },
  },
  {
    name: 'remove_unnecessary_explanation',
    execute: async (ctx) => {
      if (!ctx.cleanedAnswer) return ctx;
      let answer = ctx.cleanedAnswer;
      
      answer = answer.replace(
        /^(I think|I believe|In my opinion|It seems to me|From my perspective),?\s*/i,
        ''
      );
      answer = answer.replace(
        /(I would say that|I would like to mention that|It is worth noting that|I want to point out that),?\s*/gi,
        ''
      );
      answer = answer.replace(
        /(in conclusion|to summarize|overall|in summary),?\s*$/i,
        ''
      );
      
      return { ...ctx, cleanedAnswer: answer.trim() };
    },
  },
  {
    name: 'validate_writing_quality',
    execute: async (ctx) => {
      if (!ctx.cleanedAnswer) return ctx;
      const result = validateWritingQuality(ctx.cleanedAnswer, ctx.writingStyle);
      return { 
        ...ctx, 
        validatedAnswer: ctx.cleanedAnswer,
        qualityResult: result,
      };
    },
  },
  {
    name: 'check_user_style',
    execute: async (ctx) => {
      if (!ctx.validatedAnswer || !ctx.qualityResult?.passed) return ctx;
      const features = extractWritingFeatures(ctx.validatedAnswer);
      const suggestions: string[] = [];
      
      if (ctx.writingStyle.preferredVocabulary.length > 0) {
        const usedPreferred = ctx.writingStyle.preferredVocabulary.filter(w => 
          ctx.validatedAnswer!.toLowerCase().includes(w.toLowerCase())
        );
        if (usedPreferred.length === 0 && ctx.writingStyle.sampleCount > 5) {
          suggestions.push('Consider using your preferred vocabulary');
        }
      }
      
      return { 
        ...ctx, 
        qualityResult: {
          ...ctx.qualityResult!,
          suggestions: [...ctx.qualityResult!.suggestions, ...suggestions],
        },
      };
    },
  },
];

export async function runHumanAnswerPipeline(
  ctx: PipelineContext,
  maxRegenerations = 3
): Promise<PipelineContext> {
  let currentCtx = ctx;
  
  for (let attempt = 0; attempt <= maxRegenerations; attempt++) {
    currentCtx = { ...currentCtx, regenerationCount: attempt };
    
    for (const step of HUMAN_ANSWER_PIPELINE_STEPS) {
      currentCtx = await step.execute(currentCtx);
    }
    
    if (currentCtx.qualityResult?.passed) {
      return currentCtx;
    }
    
    if (attempt < maxRegenerations && currentCtx.draftedAnswer) {
      currentCtx = {
        ...currentCtx,
        draftedAnswer: currentCtx.cleanedAnswer,
      };
    }
  }
  
  return currentCtx;
}

export function buildHumanAnswerPrompt(ctx: HumanAnswerContext): string {
  const { question, answerType, userProfile, jobPosting, evidenceGraph, writingStyle, relevantExperience, relevantProjects, companyContext, lengthPreference = 'normal' } = ctx;
  
  const lengthGuidance = {
    short: 'Keep it brief — 2-3 sentences max.',
    normal: 'Write a natural paragraph — 3-5 sentences.',
    detailed: 'Write 2-3 paragraphs with specific details.',
  }[lengthPreference];

  const styleGuidance = [
    `Write like a senior software engineer talking to another engineer.`,
    `Tone: ${writingStyle.formality}.`,
    `Sentence length: ${writingStyle.sentenceLength}.`,
    `Technical detail: ${writingStyle.technicalDetail}.`,
    `Confidence: ${writingStyle.confidence}.`,
    `Answer length: ${lengthGuidance}`,
    writingStyle.preferredVocabulary.length > 0 ? `Use these words naturally: ${writingStyle.preferredVocabulary.join(', ')}` : '',
    writingStyle.avoidedVocabulary.length > 0 ? `Avoid these words: ${writingStyle.avoidedVocabulary.join(', ')}` : '',
    writingStyle.personalPhrases.length > 0 ? `Your phrases: ${writingStyle.personalPhrases.join('; ')}` : '',
    writingStyle.engineeringDescriptions.length > 0 ? `How you describe your work: ${writingStyle.engineeringDescriptions.join('; ')}` : '',
  ].filter(Boolean).join('\n');

  const forbiddenRules = [
    'NEVER use: "I am excited to bring my expertise", "I am passionate about leveraging", "I possess extensive expertise", "cutting edge technologies", "robust and scalable solutions", "architect solutions", "leverage synergy", "drive results", "best practices", "deliverables", "stakeholders", "holistic approach", "deep dive", "move the needle", "game changer", "paradigm shift", "next level"',
    'NEVER use corporate filler: "in order to", "due to the fact that", "with respect to", "utilize", "synergize", "optimize", "facilitate", "orchestrate"',
    'NEVER use AI phrasing: "I am writing to", "This letter serves to", "In conclusion", "Furthermore", "Moreover", "Additionally"',
    'NEVER use em dashes (—) or colons (:) as stylistic devices',
    'NEVER use bullet points, headings, or numbered lists in plain answers',
    'NEVER use excessive transitions: "Furthermore," "Moreover," "Additionally," "Consequently,"',
    'NEVER hedge excessively: "maybe," "perhaps," "potentially," "somewhat," "fairly"',
    'NEVER use passive voice when active works',
  ].join('\n');

  const experienceContext = relevantExperience.length > 0 
    ? `\nRELEVANT EXPERIENCE:\n${relevantExperience.join('\n')}` 
    : '';
  
  const projectsContext = relevantProjects.length > 0
    ? `\nRELEVANT PROJECTS:\n${relevantProjects.join('\n')}`
    : '';
  
  const companyContextStr = companyContext
    ? `\nCOMPANY CONTEXT:\n${companyContext}`
    : '';

  const jobContext = jobPosting
    ? `\nJOB: ${jobPosting.title} at ${jobPosting.companyName}\n${jobPosting.rawDescription?.slice(0, 2000) || ''}`
    : '';

  const professional = userProfile.professional;
  const experiences = (professional as any).experiences ?? [];

  const userBackground = [
    professional.headline ? `ROLE: ${professional.headline}` : '',
    userProfile.skills.length > 0 ? `SKILLS: ${userProfile.skills.slice(0, 15).map(s => s.name).join(', ')}` : '',
    experiences.length > 0 ? `RECENT ROLES: ${experiences.slice(0, 3).map((e: any) => `${e.title} at ${e.company}`).join(', ')}` : '',
  ].filter(Boolean).join('\n');

  return `${styleGuidance}

FORBIDDEN — These will cause rejection:
${forbiddenRules}

CONTEXT:
${userBackground}
${experienceContext}
${projectsContext}
${jobContext}
${companyContextStr}

QUESTION: ${question}

Write a natural, human answer. No corporate speak. No AI phrasing. Direct and specific.`;
}

export interface HumanAnswerResult {
  readonly answer: string;
  readonly passedQualityCheck: boolean;
  readonly violations: readonly string[];
  readonly suggestions: readonly string[];
  readonly regenerationCount: number;
}

export async function generateHumanAnswer(
  context: HumanAnswerContext,
  aiGenerate: (prompt: string) => Promise<string>,
  maxRegenerations = 3
): Promise<HumanAnswerResult> {
  const initialCtx: PipelineContext = {
    originalQuestion: context.question,
    answerType: context.answerType,
    userProfile: context.userProfile,
    jobPosting: context.jobPosting,
    evidenceGraph: context.evidenceGraph,
    writingStyle: context.writingStyle,
    relevantExperience: context.relevantExperience,
    relevantProjects: context.relevantProjects,
    companyContext: context.companyContext,
    lengthPreference: context.lengthPreference ?? 'normal',
    regenerationCount: 0,
  };

  let currentCtx = initialCtx;

  for (let attempt = 0; attempt <= maxRegenerations; attempt++) {
    currentCtx = { ...currentCtx, regenerationCount: attempt };

    if (attempt === 0 || !currentCtx.draftedAnswer) {
      const prompt = buildHumanAnswerPrompt(context);
      const drafted = await aiGenerate(prompt);
      currentCtx = { ...currentCtx, draftedAnswer: drafted };
    }

    for (const step of HUMAN_ANSWER_PIPELINE_STEPS) {
      currentCtx = await step.execute(currentCtx);
    }

    if (currentCtx.qualityResult?.passed) {
      return {
        answer: currentCtx.validatedAnswer || currentCtx.cleanedAnswer || currentCtx.draftedAnswer || '',
        passedQualityCheck: true,
        violations: [],
        suggestions: currentCtx.qualityResult?.suggestions || [],
        regenerationCount: attempt,
      };
    }

    if (attempt < maxRegenerations) {
      currentCtx = {
        ...currentCtx,
        draftedAnswer: currentCtx.cleanedAnswer,
      };
    }
  }

  return {
    answer: currentCtx.validatedAnswer || currentCtx.cleanedAnswer || currentCtx.draftedAnswer || '',
    passedQualityCheck: false,
    violations: currentCtx.qualityResult?.violations || [],
    suggestions: currentCtx.qualityResult?.suggestions || [],
    regenerationCount: maxRegenerations,
  };
}

/**
 * Applies the writing quality validation and cleaning to already-generated text (synchronous version).
 * Used for deterministic content (cover letters, resumes) that wasn't AI-generated.
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
  // Apply cleaning steps directly (no async)
  let cleaned = text;

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
    /(in conclusion|to summarize|overall|in summary),?\s*$/i,
    ''
  );

  // Remove stylistic devices
  cleaned = cleaned
    .replace(/—/g, '')
    .replace(/:/g, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // Validate quality
  const result = validateWritingQuality(cleaned, writingStyle);

  return {
    cleanedText: cleaned,
    passedQualityCheck: result.passed,
    violations: result.violations,
    suggestions: result.suggestions,
  };
}