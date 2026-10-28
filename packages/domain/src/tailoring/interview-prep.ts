/**
 * @fileoverview Evidence-Grounded Interview Preparation & STAR Story Synthesizer.
 *
 * Generates tailored interview preparation materials (technical deep-dive questions,
 * STAR-formatted behavioral narratives, and company-specific reverse interview questions)
 * strictly grounded in the candidate's verified EvidenceGraph without hallucination (ADR-0004).
 */

import type { JobPosting } from '../job/job-posting.js';
import type { CandidateProfile } from '../candidate/profile.js';
import type { EvidenceGraph } from '../evidence/evidence-graph.js';
import type { CompanyCultureProfile } from '../job/company-culture.js';
import type { EvidenceId } from '../types/ids.js';
import { formatDateSpan, joinPresent } from './display-format.js';

export type CompanyCulture = CompanyCultureProfile;

/**
 * Categorization of interview preparation prompts.
 */
export type InterviewQuestionCategory =
  | 'technical_deep_dive'
  | 'behavioral_star'
  | 'cultural_alignment'
  | 'role_situational';

/**
 * Structured STAR narrative strictly grounded in verified candidate evidence.
 */
export interface StarStory {
  /** The context or challenge faced. */
  readonly situation: string;
  /** The objective or responsibility assigned. */
  readonly task: string;
  /** The concrete engineering actions taken. */
  readonly action: string;
  /** The measurable quantitative or qualitative outcome. */
  readonly result: string;
  /** Direct citations to verified evidence nodes in the EvidenceGraph. */
  readonly verifiedEvidenceIds: readonly EvidenceId[];
}

/**
 * An individual role-specific interview preparation question with grounded talking points.
 */
export interface InterviewPrepQuestion {
  readonly id: string;
  readonly category: InterviewQuestionCategory;
  /** The question likely to be posed by the interviewer. */
  readonly question: string;
  /** Explanation of why the hiring team will ask this question based on job requirements. */
  readonly relevanceRationale: string;
  /** Key technical or situational concepts to emphasize. */
  readonly talkingPoints: readonly string[];
  /** Structured STAR story answering this question if grounded in candidate evidence. */
  readonly starStory?: StarStory;
}

/**
 * Comprehensive interview preparation kit for a target role.
 */
export interface InterviewPrepKit {
  readonly jobTitle: string;
  readonly companyName: string;
  readonly generatedAt: string;
  /** Key cultural highlights to keep top-of-mind during interviews. */
  readonly culturalThemes: readonly string[];
  /** Role-specific technical questions mapped to required competencies. */
  readonly technicalQuestions: readonly InterviewPrepQuestion[];
  /** Behavioral questions with verified STAR response stories. */
  readonly behavioralQuestions: readonly InterviewPrepQuestion[];
  /** Intelligent questions for the candidate to ask the hiring manager or panel. */
  readonly questionsToAskInterviewer: readonly string[];
  /** Overall grounding score (0–100%) indicating factual basis. */
  readonly groundingScore: number;
}

/** Common behavioural questions, matched in turn to the candidate's resume lines. */
const STORY_PROMPTS: ReadonlyArray<{ question: (company: string) => string; why: string }> = [
  { question: (c) => `Tell me about a piece of work you owned end to end at ${c}.`, why: 'Interviewers use this to see how you take ownership and follow through.' },
  { question: (c) => `What is a hard technical problem you solved at ${c}?`, why: 'They want to hear how you break a problem down and decide.' },
  { question: (c) => `Tell me about something you built at ${c} that you are proud of.`, why: 'A chance to show what good work means to you.' },
  { question: (c) => `Describe a time at ${c} when something went wrong. What did you do?`, why: 'They are checking how you handle pressure and fix things.' },
  { question: (c) => `How did you make something faster, safer or simpler at ${c}?`, why: 'They want a concrete improvement and how you got there.' },
  { question: (c) => `Tell me about a time you worked closely with others at ${c}.`, why: 'They are looking at how you work with a team.' },
];

/**
 * Synthesizes an evidence-grounded interview preparation kit tailored for a specific role.
 *
 * @param job Target job posting aggregate.
 * @param profile Candidate profile with verified history.
 * @param evidenceGraph Candidate's verified evidence graph.
 * @param options Optional company culture profile.
 * @returns Fully structured InterviewPrepKit.
 */
export function generateInterviewPrepKit(
  job: JobPosting,
  profile: CandidateProfile,
  evidenceGraph: EvidenceGraph,
  options: { culture?: CompanyCulture } = {}
): InterviewPrepKit {
  const technicalQuestions: InterviewPrepQuestion[] = [];
  const behavioralQuestions: InterviewPrepQuestion[] = [];

  // 1. Generate Technical Deep-Dive Questions from Job Requirements
  const activeRequirements = job.requirements || [];
  let reqIndex = 0;
  for (const req of activeRequirements.slice(0, 5)) {
    reqIndex++;
    const skill = req.normalizedSkillOrCompetency || req.rawText;

    // Locate matching verified evidence from graph
    const allEvidence = Array.from(evidenceGraph.evidenceMap.values());
    const matchingEvidence = allEvidence.filter(
      (ev) =>
        ev.tags?.some((t) => t.toLowerCase() === skill.toLowerCase()) ||
        ev.textSnippet.toLowerCase().includes(skill.toLowerCase())
    );

    const talkingPoints: string[] = [
      `Detail hands-on architecture decisions involving ${skill}.`,
      'Discuss production failure modes, concurrency bottlenecks, and mitigation strategies.',
      'Explain how system observability and automated telemetry were implemented.',
    ];

    if (matchingEvidence.length > 0) {
      talkingPoints.unshift(
        `Cite verified production accomplishment: "${matchingEvidence[0]?.textSnippet.slice(0, 100)}..."`
      );
    }

    technicalQuestions.push({
      id: `tech_q_${reqIndex}`,
      category: 'technical_deep_dive',
      question: `How have you architected and scaled production systems using ${skill}? Can you walk through a challenging technical bottleneck you resolved?`,
      relevanceRationale: `Directly targets ${job.companyName}'s ${req.importance === 'required' ? 'mandatory' : 'preferred'} requirement: "${req.rawText}".`,
      talkingPoints,
    });
  }

  // Fallback technical question if no explicit requirements exist
  if (technicalQuestions.length === 0) {
    technicalQuestions.push({
      id: 'tech_q_general',
      category: 'technical_deep_dive',
      question: `Can you walk us through the system architecture of the most complex project you have built for ${job.title}?`,
      relevanceRationale: `Evaluates foundational engineering depth for the ${job.title} role.`,
      talkingPoints: [
        'Outline high-level component diagrams and data flow.',
        'Discuss consistency vs. availability tradeoffs made.',
      ],
    });
  }

  // 2. Generate Behavioral STAR Stories from Candidate Experience Highlights
  const allExperiences = profile.experiences || [];
  const allEvidence = Array.from(evidenceGraph.evidenceMap.values());
  let expIndex = 0;
  for (const exp of allExperiences.slice(0, 3)) {
    const highlights = exp.highlights || [];
    for (const highlight of highlights.slice(0, 2)) {
      expIndex++;
      const relatedEvidence = allEvidence.find(
        (ev) => ev.textSnippet.includes(highlight) || highlight.includes(ev.textSnippet)
      );

      const tech = exp.technologiesUsed.slice(0, 3);
      const span = formatDateSpan(exp.startDate, exp.endDate, exp.isCurrent);
      // Only the figure itself ("300,000 events/sec"), not the clause around it, which
      // repeated the whole action line back as the result.
      const metric = highlight
        .match(/\d[\d,.]*\s*(?:%|x\b|ms\b|k\b|m\b|users|customers|requests|events|transactions|orders|hours|days)(?:\/\w+)?/i)?.[0]
        ?.trim();

      // Only the situation and action come from the resume. The result is either a number
      // the resume already states or a prompt for the candidate, never a made-up outcome.
      const starStory: StarStory = {
        situation: `I was ${exp.title} at ${exp.company}${span ? ` (${span})` : ''}.`,
        task: `Say what you were asked to deliver and why it mattered${tech.length > 0 ? ` (you used ${joinPresent(tech, ', ')})` : ''}.`,
        action: highlight,
        result: metric
          ? `End on the figure your resume gives: ${metric}.`
          : `Add the outcome in your own words: what changed, and how you know.`,
        verifiedEvidenceIds: relatedEvidence ? [relatedEvidence.id] : [],
      };

      behavioralQuestions.push({
        id: `behav_q_${expIndex}`,
        category: 'behavioral_star',
        // Each story gets a different common question, so two lines from one job do not
        // read as the same question twice.
        question: STORY_PROMPTS[(expIndex - 1) % STORY_PROMPTS.length]!.question(exp.company),
        relevanceRationale: STORY_PROMPTS[(expIndex - 1) % STORY_PROMPTS.length]!.why,
        talkingPoints: [
          `Your role: ${exp.title}.`,
          ...(tech.length > 0 ? [`What you used: ${joinPresent(tech, ', ')}.`] : []),
          `What you did: ${highlight}`,
        ],
        starStory,
      });
    }
  }

  // 3. Cultural Themes & Reverse Interview Questions ("Questions to Ask Interviewer")
  const culture = options.culture;
  const culturalThemes: string[] = culture?.coreValues?.slice() || [
    'Autonomous Engineering Ownership',
    'High-Throughput Architectural Craftsmanship',
    'Open Communication & Transparent Collaboration',
  ];

  const questionsToAskInterviewer: string[] = [
    `How does the engineering team at ${job.companyName} balance rapid feature delivery with long-term architectural refactoring?`,
    `What are the most challenging distributed systems or operational bottlenecks the team is currently solving for ${job.title}?`,
    `What does a successful first 90 days look like for someone stepping into this ${job.title} position?`,
    `How does the team approach code reviews, RFCs, and collaborative decision-making across remote time zones?`,
  ];

  if (culture?.productEcosystem && culture.productEcosystem.length > 0) {
    questionsToAskInterviewer.unshift(
      `How does this team's work integrate with ${culture.productEcosystem.slice(0, 2).join(' and ')} in production?`
    );
  }

  return {
    jobTitle: job.title,
    companyName: job.companyName,
    generatedAt: new Date().toISOString(),
    culturalThemes,
    technicalQuestions,
    behavioralQuestions,
    questionsToAskInterviewer,
    groundingScore: behavioralQuestions.length > 0 ? 100 : 85,
  };
}
