/**
 * @fileoverview Scoped AI Prompt Builders and Context Demarcators.
 *
 * Enforces Context Scoping (ADR-0005) and Indirect Prompt Injection Defense (ADR-0002).
 * Constructs minimal, task-focused prompt requests where untrusted webpage content
 * is wrapped in strict XML tags, and candidate PII is withheld unless strictly required.
 */

import type {
  JobExtractionContext,
  RequirementMatchingContext,
  FieldAnsweringContext,
  ResumeTailoringContext,
  CoverLetterContext,
} from './contexts.js';
import type { AIRequest } from './provider.js';
import type { WritingStyleProfile } from './writing-style.js';
import { wrapUntrustedContent, buildHardenedSystemPrompt } from './sanitization.js';

/**
 * Builds an AIRequest for extracting structured job requirements from an external page.
 *
 * Privacy Invariant: Transmits ZERO candidate profile or identity data to the LLM.
 *
 * @param context Scoped job extraction context containing page text and URL.
 * @returns AIRequest configured for structured job extraction.
 */
export function buildJobExtractionPrompt(
  context: JobExtractionContext
): AIRequest<JobExtractionContext> {
  const systemPrompt = buildHardenedSystemPrompt(
    `You are an expert technical recruiter and job posting parser.
Your task is to extract structured job metadata and requirements from the provided webpage text.

Return a valid JSON object matching this schema:
{
  "title": string,
  "companyName": string,
  "location": string,
  "workplaceType": "remote" | "hybrid" | "onsite",
  "employmentType": "full_time" | "part_time" | "contract" | "internship",
  "salaryRange": {
    "min": number | null,
    "max": number | null,
    "currency": string,
    "period": "yearly" | "monthly" | "hourly"
  } | null,
  "responsibilities": string[],
  "requirements": Array<{
    "text": string,
    "category": "experience_level" | "technical_skill" | "soft_skill" | "education_credential" | "certification" | "domain_knowledge" | "legal_authorization",
    "importance": "required" | "preferred",
    "minYears": number | null
  }>
}`
  );

  const wrappedText = wrapUntrustedContent(context.rawHtmlOrText, 'untrusted_job_content');
  const pageTitle = wrapUntrustedContent(context.pageTitle || 'Job Posting', 'untrusted_page_title');

  const userPrompt = `Please parse the following job posting content into the required JSON schema.

Target Page: ${pageTitle} (${context.pageUrl})

${wrappedText}`;

  return {
    prompt: userPrompt,
    systemPrompt,
    contextType: 'job_extraction',
    contextPayload: context,
    temperature: 0.1,
    maxTokens: 3000,
  };
}

/**
 * Builds an AIRequest for evaluating candidate alignment and gap analysis against job requirements.
 *
 * Privacy Invariant: Strictly withholds candidate phone number, email address, street address,
 * salary targets, and demographic self-disclosures.
 *
 * @param context Scoped requirement matching context containing qualifications and candidate claims.
 * @returns AIRequest configured for deterministic match analysis.
 */
export function buildRequirementMatchingPrompt(
  context: RequirementMatchingContext
): AIRequest<RequirementMatchingContext> {
  const systemPrompt = buildHardenedSystemPrompt(
    `You are an honest, objective candidate evaluation assistant.
Your task is to compare candidate qualifications and verified evidence against job requirements.

CRITICAL FACTUAL INVARIANT:
- Do NOT invent, assume, or hallucinate credentials or skills the candidate does not have.
- If a requirement is not clearly supported by candidate claims, classify it as a "gap".

Return a valid JSON object matching this schema:
{
  "overallScore": number (0 to 100),
  "matches": Array<{
    "requirementText": string,
    "status": "strong_match" | "partial_match" | "gap" | "unclear",
    "reasoning": string,
    "matchedClaimIds": string[],
    "matchedSkillNames": string[]
  }>,
  "keyStrengths": string[],
  "identifiedGaps": string[]
}`
  );

  const reqSummary = wrapUntrustedContent(
    context.requirements
      .map((r, i) => `${i + 1}. [${r.importance.toUpperCase()}] ${r.rawText}`)
      .join('\n'),
    'untrusted_job_requirements'
  );

  const skillsSummary = context.candidateSkills
    .map((s) => `- ${s.name} (${s.proficiency}${s.yearsOfExperience ? `, ${s.yearsOfExperience}y` : ''})`)
    .join('\n');

  const claimsSummary = context.candidateClaims
    .map((c) => `- [${c.id}] ${c.statement} (${(c.confidence * 100).toFixed(0)}% conf)`)
    .join('\n');

  const highlightsSummary = context.relevantExperienceHighlights
    .map((h) => `- ${h}`)
    .join('\n');

  const userPrompt = `Compare the candidate's verified background against the job requirements for:
Role: ${wrapUntrustedContent(context.jobTitle, 'target_role')}
Company: ${wrapUntrustedContent(context.companyName, 'company_name')}

JOB REQUIREMENTS:
${reqSummary}

CANDIDATE VERIFIED SKILLS:
${skillsSummary || 'None specified.'}

CANDIDATE EVIDENCE-BACKED CLAIMS:
${claimsSummary || 'None specified.'}

RELEVANT ACCOMPLISHMENT HIGHLIGHTS:
${highlightsSummary || 'None specified.'}

Perform a strict, grounded gap analysis returning only the specified JSON format.`;

  return {
    prompt: userPrompt,
    systemPrompt,
    contextType: 'requirement_matching',
    contextPayload: context,
    temperature: 0.1,
    maxTokens: 2500,
  };
}

/**
 * Builds an AIRequest for answering an individual form field or essay prompt.
 *
 * Privacy Invariant: Payload is restricted strictly to the single active question and relevant claims.
 * The candidate's broader profile and unrelated application records are completely excluded.
 *
 * @param context Scoped field answering context containing field details and relevant evidence.
 * @returns AIRequest configured for single-field response generation.
 */
export function buildFieldAnsweringPrompt(
  context: FieldAnsweringContext
): AIRequest<FieldAnsweringContext> {
  const writingStyle = context.writingStyle;
  const lengthPref = context.answerLengthPreference ?? 'normal';

  const lengthGuidance = {
    short: 'Keep it brief — 2-3 sentences max.',
    normal: 'Write a natural paragraph — 3-5 sentences.',
    detailed: 'Write 2-3 paragraphs with specific details.',
  }[lengthPref];

  const styleGuidance = writingStyle ? [
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
  ].filter(Boolean).join('\n') : '';

  const forbiddenRules = [
    'NEVER invent qualifications, scores, dates, employers, tools, awards, or academic results. If the evidence does not support an answer, return an empty answerText and isGrounded false.',
    'NEVER mention the AI, the profile, evidence, missing data, verification, inability to answer, or instructions to the candidate in answerText. Unsupported answers are blocked before insertion.',
    'NEVER use corporate cliché filler: "I am excited to bring my expertise", "I am passionate about leveraging", "I possess extensive expertise", "cutting edge technologies", "robust and scalable solutions", "architect solutions", "leverage synergy", "drive results", "best practices", "deliverables", "stakeholders", "holistic approach", "deep dive", "move the needle", "game changer", "paradigm shift", "next level"',
    'NEVER use corporate filler: "in order to", "due to the fact that", "with respect to", "utilize", "synergize", "optimize", "facilitate", "orchestrate"',
    'NEVER use AI phrasing: "I am writing to", "This letter serves to", "In conclusion", "Furthermore", "Moreover", "Additionally"',
    'NEVER use em dashes (—) or colons (:) as stylistic devices',
    'NEVER use bullet points, headings, or numbered lists in plain answers',
    'NEVER use excessive transitions: "Furthermore," "Moreover," "Additionally," "Consequently,"',
    'NEVER hedge excessively: "maybe," "perhaps," "potentially," "somewhat," "fairly"',
    'NEVER use passive voice when active works',
  ].join('\n');

  const systemPrompt = buildHardenedSystemPrompt(
    `You are a precise job application copilot formulating natural answers from verified candidate evidence.

CRITICAL DIRECTIVES:
1. Use only the supplied candidate evidence. Never fill gaps with assumptions or ATS-oriented claims.
2. If the evidence does not support the question, return an empty answerText, confidence 0, and isGrounded false.
3. Answer in the candidate's voice, the way they would type it themselves. Do not mention the AI, profile, evidence, verification, missing data, or this instruction.
4. Use the exact requested format and limits.
5. For technical questions, use concrete trade-offs only when supported by the candidate's work.
6. Prefer plain words and short sentences. No corporate filler and no self-praise.

${styleGuidance ? `WRITING STYLE (match this voice):\n${styleGuidance}\n` : ''}

FORBIDDEN — These will cause rejection:
${forbiddenRules}

Return a valid JSON object matching this schema:
{
  "answerText": string,
  "confidence": number (0.0 to 1.0),
  "supportingClaimIds": string[],
  "isGrounded": boolean,
  "notes": string
}`
  );

  const wrappedLabel = wrapUntrustedContent(context.fieldLabel, 'untrusted_field_label');

  const answersText = context.relevantAnswers
    .map((a) => `[${a.canonicalKey}]: ${a.answerText}`)
    .join('\n\n');

  const claimsText = context.relevantClaims
    .map((c) => `- [${c.id}] ${c.statement}`)
    .join('\n');

  const expText = (context.candidateExperiences || [])
    .map((e) => {
      const highlights = (e.highlights || []).map((h) => `    * ${h}`).join('\n');
      const techs = (e.technologiesUsed || []).length > 0 ? ` (Technologies: ${e.technologiesUsed.join(', ')})` : '';
      return `- ${e.title} at ${e.company}${techs}${e.description ? `\n    ${e.description}` : ''}${highlights ? `\n${highlights}` : ''}`;
    })
    .join('\n');

  const skillsText = (context.candidateSkills || [])
    .map((s) => `${s.name}${s.proficiency ? ` (${s.proficiency})` : ''}`)
    .join(', ');

  const eduText = (context.candidateEducation || [])
    .map((ed) => `${ed.degree} in ${ed.fieldOfStudy} from ${ed.institution}${ed.gpa ? ` (GPA: ${ed.gpa})` : ''}${ed.honors?.length ? ` (Honors: ${ed.honors.join(', ')})` : ''}`)
    .join('; ');

  const optionsText = context.options && context.options.length > 0
    ? `Available dropdown options:\n${wrapUntrustedContent(
        context.options.map((o) => `"${o.label}" (value: ${o.value})`).join('\n'),
        'untrusted_field_options'
      )}`
    : '';

  const userPrompt = `Answer the following application form field using only the evidence supplied below:
${wrappedLabel}

Field Type: ${context.fieldType}
${context.fieldType === 'number' ? 'Instruction: This field requires a single numeric value (e.g. 9 or 10 for ratings, or target salary integer). In answerText, provide solely the numeric digits.' : ''}
${optionsText}
${context.maxLength ? `Max Characters: ${context.maxLength}` : ''}
${context.placeholder ? `Placeholder: ${wrapUntrustedContent(context.placeholder, 'untrusted_placeholder')}` : ''}

${context.candidateSummary ? `CANDIDATE SUMMARY:\n${context.candidateSummary}\n` : ''}
${expText ? `CANDIDATE WORK EXPERIENCE & PRODUCTION HIGHLIGHTS:\n${expText}\n` : ''}
${skillsText ? `CANDIDATE VERIFIED SKILLS:\n${skillsText}\n` : ''}
${eduText ? `CANDIDATE EDUCATION:\n${eduText}\n` : ''}

RELEVANT SAVED ANSWERS:
${answersText || 'None available.'}

SUPPORTING CANDIDATE CLAIMS:
${claimsText || 'None available.'}

Provide an answer strictly in JSON. If dropdown or radio options are available, return the exact option value or label supported by the evidence. If the evidence does not support an answer, return an empty answerText, confidence 0, and isGrounded false.`;

  return {
    prompt: userPrompt,
    systemPrompt,
    contextType: 'field_answering',
    contextPayload: context,
    temperature: 0.2,
    maxTokens: 1000,
  };
}

/**
 * Builds an AIRequest for tailoring candidate resume highlights to a target job opportunity.
 *
 * Privacy Invariant: Excludes candidate contact details, demographics, and unrelated saved answers.
 *
 * @param context Scoped resume tailoring context containing job requirements and candidate experiences.
 * @returns AIRequest configured for tailored accomplishment highlighting.
 */
export function buildResumeTailoringPrompt(
  context: ResumeTailoringContext
): AIRequest<ResumeTailoringContext> {
  const systemPrompt = buildHardenedSystemPrompt(
    `You are a careful resume editor. Your job is to make the candidate's existing bullets clearer and more specific, not to make them sound impressive.

CRITICAL INVARIANTS:
1. Keep the candidate's facts, numbers, tools, employers, and scope exactly as given. Never add a metric, technology, responsibility, or result that is not in the input.
2. Start each bullet with a plain past-tense verb (Built, Led, Shipped, Reduced, Fixed, Migrated, Wrote). Do not use "spearheaded", "engineered", "orchestrated", "leveraged", "facilitated", "utilized", or "synergized".
3. Write the summary as 2-3 short sentences: the candidate's role, tenure only if the input states it, the main kind of work they did, and one real result from the input. Do not use "proven track record", "passionate", "committed to", "results-driven", "dynamic", or flattery about the company.
4. Describe work the way the candidate would describe it to another engineer: concrete nouns, short clauses, no adjectives used for praise.
5. Every bullet must correspond to a real highlight in the candidate's background.

Return a valid JSON object matching this schema:
{
  "tailoredSummary": string,
  "tailoredExperiences": Array<{
    "company": string,
    "title": string,
    "tailoredHighlights": string[],
    "emphasizedSkills": string[]
  }>
}`
  );

  const reqText = wrapUntrustedContent(
    context.requirements.map((r) => `- [${r.importance}] ${r.rawText}`).join('\n'),
    'untrusted_job_requirements'
  );

  const expText = context.experiences
    .map(
      (e) => `Company: ${e.company} | Title: ${e.title}\nBullets:\n${e.highlights.map((h) => `  * ${h}`).join('\n')}`
    )
    .join('\n\n');

  const projText = context.projects
    .map((p) => `Project: ${p.title} (${p.technologiesUsed.join(', ')})\n  * ${p.description}`)
    .join('\n');

  const userPrompt = `Tailor candidate resume materials for the following target position:
Role: ${wrapUntrustedContent(context.targetJobTitle, 'target_role')}
Company: ${wrapUntrustedContent(context.companyName, 'company_name')}

KEY REQUIREMENTS:
${reqText}

CANDIDATE ACTUAL EXPERIENCES:
${expText}

CANDIDATE PROJECTS:
${projText}

Output the tailored highlights strictly adhering to the JSON schema.`;

  return {
    prompt: userPrompt,
    systemPrompt,
    contextType: 'resume_tailoring',
    contextPayload: context,
    temperature: 0.2,
    maxTokens: 2500,
  };
}

/**
 * Builds an AIRequest for generating an evidence-grounded cover letter tailored to a target position.
 *
 * Privacy Invariant: Outbound payload includes only job criteria, candidate name, verified skills,
 * and verified accomplishment snippets. Contact details, demographics, and unneeded fields are omitted.
 *
 * @param context Scoped cover letter context containing role criteria and verified achievements.
 * @returns AIRequest configured for grounded cover letter generation.
 */
export function buildCoverLetterPrompt(
  context: CoverLetterContext
): AIRequest<CoverLetterContext> {
  const systemPrompt = buildHardenedSystemPrompt(
    `You are helping a candidate write a cover letter in their own voice. The result should read like a person wrote it after looking at the job, not like a template.

CRITICAL INVARIANTS:
1. Every achievement, scale metric, or technical responsibility in the body paragraphs MUST come directly from the provided verified candidate accomplishments.
2. Never invent metrics, achievements, employer partnerships, or technologies not present in the input.
3. Keep the tone direct and specific. One concrete example is worth more than three adjectives.
4. Do not open with "I am writing to apply", "I am excited", or "I would be a perfect fit". Do not close with "Thank you for your time and consideration".
5. Do not repeat the job description back to the reader. Say what the candidate did and why it matters for this role.
6. Avoid "passionate", "results-driven", "proven track record", "leverage", "synergy", "cutting-edge", and "dynamic".

Return a valid JSON object matching this schema:
{
  "openingParagraph": string,
  "bodyParagraphs": Array<{
    "theme": string,
    "paragraphText": string,
    "citedAccomplishment": string
  }>,
  "closingParagraph": string
}`
  );

  const reqText = wrapUntrustedContent(
    context.requirements.map((r) => `- [${r.importance}] ${r.rawText}`).join('\n'),
    'untrusted_job_requirements'
  );
  const skillsText = context.candidateSkills.map((s) => s.name).join(', ');
  const accomplishmentsText = context.verifiedAccomplishments.map((a) => `- ${a}`).join('\n');

  const userPrompt = `Generate an evidence-grounded cover letter for the following position:
Role: ${wrapUntrustedContent(context.targetJobTitle, 'target_role')}
Company: ${wrapUntrustedContent(context.companyName, 'company_name')}
Candidate Name: ${context.candidateName}

KEY REQUIREMENTS:
${reqText}

VERIFIED CANDIDATE SKILLS:
${skillsText}

VERIFIED ACCOMPLISHMENTS:
${accomplishmentsText}

Output the tailored cover letter strictly adhering to the JSON schema.`;

  return {
    prompt: userPrompt,
    systemPrompt,
    contextType: 'cover_letter',
    contextPayload: context,
    temperature: 0.2,
    maxTokens: 2500,
  };
}
