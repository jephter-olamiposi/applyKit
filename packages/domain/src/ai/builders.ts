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

  const userPrompt = `Please parse the following job posting content into the required JSON schema.

Target Page: ${context.pageTitle || 'Job Posting'} (${context.pageUrl})

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

  const reqSummary = context.requirements
    .map((r, i) => `${i + 1}. [${r.importance.toUpperCase()}] ${r.rawText}`)
    .join('\n');

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
Role: ${context.jobTitle}
Company: ${context.companyName}

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
  const systemPrompt = buildHardenedSystemPrompt(
    `You are a professional job application assistant formulating answers to application form questions.

CRITICAL INVARIANTS:
1. Ground all responses strictly in the candidate's verified evidence and saved answers provided.
2. NEVER invent experiences, metrics, employer names, or degrees.
3. If the candidate has no relevant background to answer the prompt, produce a concise factual statement or advise the user to fill manually.
4. Adhere strictly to any specified character or word limits.

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

  const optionsText = context.options
    ? `Available Dropdown Options: ${context.options.map((o) => `"${o.label}" (value: ${o.value})`).join(', ')}`
    : '';

  const userPrompt = `Formulate an answer for the following application form field:
${wrappedLabel}

Field Type: ${context.fieldType}
${optionsText}
${context.maxLength ? `Max Characters: ${context.maxLength}` : ''}
${context.placeholder ? `Placeholder: ${context.placeholder}` : ''}

RELEVANT SAVED ANSWERS:
${answersText || 'None available.'}

SUPPORTING CANDIDATE CLAIMS:
${claimsText || 'None available.'}

Provide a natural, professional, evidence-backed answer strictly in JSON.`;

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
    `You are an expert executive resume writer.
Your task is to emphasize and tailor the candidate's existing, verified accomplishments for a target job.

CRITICAL INVARIANTS:
1. You may reword, polish, or reorder the candidate's existing bullets to emphasize relevant skills.
2. You must NEVER fabricate new metrics, projects, technologies, or responsibilities.
3. Every tailored bullet must correspond to a real, verifiable highlight in the candidate's background.

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

  const reqText = context.requirements.map((r) => `- [${r.importance}] ${r.rawText}`).join('\n');

  const expText = context.experiences
    .map(
      (e) => `Company: ${e.company} | Title: ${e.title}\nBullets:\n${e.highlights.map((h) => `  * ${h}`).join('\n')}`
    )
    .join('\n\n');

  const projText = context.projects
    .map((p) => `Project: ${p.title} (${p.technologiesUsed.join(', ')})\n  * ${p.description}`)
    .join('\n');

  const userPrompt = `Tailor candidate resume materials for the following target position:
Role: ${context.targetJobTitle}
Company: ${context.companyName}

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
    `You are an expert executive cover letter writer.
Your task is to draft a compelling, evidence-grounded cover letter tailored to the target job opportunity.

CRITICAL INVARIANTS:
1. Every achievement, scale metric, or technical responsibility in the body paragraphs MUST come directly from the provided verified candidate accomplishments.
2. You must NEVER invent metrics, achievements, employer partnerships, or technologies not present in the input.
3. Keep the tone professional, concise, and focused on demonstrated value.

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

  const reqText = context.requirements.map((r) => `- [${r.importance}] ${r.rawText}`).join('\n');
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

