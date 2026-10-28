/**
 * @fileoverview Drafts one application answer with an AI model, then checks it.
 *
 * Flow: build the coached prompt (voice, playbook for this kind of question, the
 * candidate's resume lines, the open posting) -> ask the model -> check the draft
 * against the resume and the posting -> if anything is off, ask once more with the
 * exact problems -> if it is still off, return nothing. Every place in the extension
 * that drafts an answer goes through here, so they all behave the same.
 */

import {
  buildApplicationAnswerPrompt,
  checkAnswerGrounding,
  classifyApplicationQuestion,
  fitToLength,
  groundingSourcesFor,
  isAiFieldAnswerResult,
  parseAndValidateJsonResponse,
  type AIRequest,
  type AiFieldAnswerResult,
  type ApplicationAnswerInput,
  type CandidateClaim,
  type CandidateProfile,
  type FieldAnsweringContext,
  type JobPosting,
} from '@applykit/domain';

/** Sends one request to whichever provider the candidate set up. */
export type ExecuteAiRequest = (request: AIRequest) => Promise<{ rawText: string }>;

export interface GroundedAnswerRequest {
  readonly question: string;
  readonly profile: CandidateProfile;
  readonly claims: readonly CandidateClaim[];
  readonly job?: Pick<JobPosting, 'title' | 'companyName' | 'rawDescription'> | null;
  readonly maxLength?: number;
  readonly style?: ApplicationAnswerInput['style'];
  readonly candidateNote?: string;
  /** Facts found about the open posting's company (its site, a web search). */
  readonly companyFacts?: readonly string[];
  readonly execute: ExecuteAiRequest;
  /** Called with every draft and what the checker found, for the troubleshooting log. */
  readonly onAttempt?: (attempt: DraftAttempt) => void;
}

export type GroundedAnswerResult =
  | {
      readonly ok: true;
      readonly text: string;
      readonly supportingClaimIds: string[];
      readonly confidence: number;
      readonly retried: boolean;
      /** Sentences cut from the model's draft because they named something unsupported. */
      readonly removed?: readonly string[];
    }
  | {
      readonly ok: false;
      readonly reason: string;
      readonly problems?: readonly string[];
      /**
       * The closest draft, for screens where the candidate reads and edits before using
       * it. Never filled into a form automatically.
       */
      readonly draft?: string;
      readonly supportingClaimIds?: string[];
    };

/** Every attempt, for the local troubleshooting log. */
export interface DraftAttempt {
  readonly text: string;
  readonly problems: readonly string[];
}

/** Most resume lines a single prompt carries; enough for any real resume. */
const MAX_EVIDENCE_LINES = 60;

/** Pairs each claim with the role it came from, so the model can say "At CoreServe". */
function evidenceLines(profile: CandidateProfile, claims: readonly CandidateClaim[]) {
  const roleOf = (statement: string) => {
    const exp = profile.experiences.find((item) => item.highlights.some((h) => h.trim() === statement.trim()));
    if (exp) return `${exp.title}, ${exp.company}`;
    const project = profile.projects.find((item) => item.highlights.some((h) => h.trim() === statement.trim()) || item.description === statement);
    return project ? `Project: ${project.title}` : undefined;
  };
  // A one-line project yields the same line twice (description and bullet); send it once.
  const seen = new Set<string>();
  const unique = claims.filter((claim) => {
    const key = claim.statement.replace(/\s+/g, ' ').trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return unique.slice(0, MAX_EVIDENCE_LINES).map((claim) => ({ id: claim.id, text: claim.statement, role: roleOf(claim.statement) }));
}

/**
 * The open posting, unless the question names a different company. "What attracted you
 * to Northwind?" while the Monzo posting is still the last one read must not be answered
 * with Monzo's details.
 */
export function postingForQuestion<T extends Pick<JobPosting, 'companyName'>>(question: string, job: T | undefined): T | undefined {
  if (!job) return undefined;
  const named = question.match(/\b(?:to|at|join|with|for|about)\s+([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,3})\s*\??\s*$/)?.[1]?.replace(/'s$/, '');
  if (!named || /^(us|our|this|the)$/i.test(named)) return job;
  const company = job.companyName.toLowerCase();
  const asked = named.toLowerCase();
  return company.includes(asked) || asked.includes(company) ? job : undefined;
}

/**
 * A "why us" answer that never names the company could have been sent to anyone. When
 * the posting (and maybe research) is there, ask for one specific thing about it.
 */
function companySpecificProblems(
  question: string,
  answer: string,
  job: Pick<JobPosting, 'companyName'> | undefined,
  companyFacts: readonly string[]
): string[] {
  if (!job?.companyName) return [];
  const kind = classifyApplicationQuestion(question);
  if (kind !== 'why_company' && kind !== 'background_and_why') return [];
  if (answer.toLowerCase().includes(job.companyName.toLowerCase())) return [];
  return [
    companyFacts.length > 0
      ? `Name ${job.companyName} and one specific fact about it from the company research or the posting.`
      : `Name ${job.companyName} and one specific thing from its posting.`,
  ];
}

/** Sentences of an answer, keeping their end punctuation. */
function sentencesOf(text: string): string[] {
  return text.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g)?.map((part) => part.trim()).filter(Boolean) ?? [text];
}

/** The quoted term in a checker message ("Vitess" in '"Vitess" is not named ...'). */
function flaggedTerm(problem: string): string | undefined {
  return problem.match(/"([^"]+)"/)?.[1];
}

/**
 * Resume lines the answer draws on, found by shared words. Models often return ids in a
 * slightly different form, and a draft used to be thrown away for that alone.
 */
function inferSupport(answer: string, evidence: ReadonlyArray<{ id: string; text: string }>): string[] {
  const words = (text: string) => new Set((text.toLowerCase().match(/[a-z][a-z0-9+#.-]{4,}/g) ?? []).map((w) => w.slice(0, 7)));
  const answerWords = words(answer);
  return evidence
    .map((line) => {
      let shared = 0;
      for (const word of words(line.text)) if (answerWords.has(word)) shared += 1;
      return { id: line.id, shared };
    })
    .filter((line) => line.shared >= 3)
    .sort((a, b) => b.shared - a.shared)
    .slice(0, 4)
    .map((line) => line.id);
}

/**
 * Cuts the sentences that carry a flagged term or stock phrase and re-checks what is
 * left. A draft with one bad sentence used to be dropped whole; most of it was fine.
 */
function repairDraft(
  text: string,
  problems: readonly string[],
  check: (candidate: string) => string[]
): { text: string; removed: string[] } | undefined {
  const terms = problems.map(flaggedTerm).filter((term): term is string => Boolean(term));
  if (terms.length === 0 || terms.length !== problems.length) return undefined;
  const sentences = sentencesOf(text.replace(/\s*[—–]\s*/g, ', '));
  const removed = sentences.filter((sentence) => terms.some((term) => sentence.toLowerCase().includes(term.toLowerCase())));
  const kept = sentences.filter((sentence) => !removed.includes(sentence));
  // Keep at least two sentences, and most of the draft, or the answer stops answering.
  if (kept.length < Math.min(2, sentences.length) || kept.join(' ').length < text.length * 0.5) return undefined;
  const repaired = kept.join(' ');
  return check(repaired).length === 0 ? { text: repaired, removed } : undefined;
}

/**
 * Drafts and checks one answer. Returns the answer only when it cites real resume lines
 * and every number, tool, and name in it appears in the resume or the posting.
 */
export async function draftGroundedAnswer(request: GroundedAnswerRequest): Promise<GroundedAnswerResult> {
  const evidence = evidenceLines(request.profile, request.claims);
  if (evidence.length === 0) return { ok: false, reason: 'Your profile has no resume lines to draw on yet.' };

  const job = postingForQuestion(request.question, request.job ?? undefined);
  // Company facts belong to the open posting's company, so they go wherever it goes.
  const companyFacts = job ? request.companyFacts ?? [] : [];
  const baseSources = groundingSourcesFor(request.profile, job, companyFacts);
  // Names the candidate typed in the question or their note ("mention PlanetScale's
  // Postgres work") are theirs to use; only their numbers and tools stay checked.
  const sources = {
    ...baseSources,
    postingText: [baseSources.postingText ?? '', request.question, request.candidateNote ?? ''].join(' \n '),
  };
  const knownClaimIds = new Set<string>(request.claims.map((claim) => claim.id));
  const skills = request.profile.skills.map((skill) => skill.name);

  const check = (candidate: string) => [
    ...checkAnswerGrounding(candidate, sources),
    ...companySpecificProblems(request.question, candidate, job, companyFacts),
  ];

  let previousProblems: string[] | undefined;
  let best: { text: string; problems: string[]; supportingClaimIds: string[] } | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { systemPrompt, prompt } = buildApplicationAnswerPrompt({
      question: request.question,
      evidence,
      skills,
      job,
      maxLength: request.maxLength,
      style: request.style,
      candidateNote: request.candidateNote,
      companyFacts,
      previousProblems,
    });
    // The context payload is only the question; the gateway's privacy layer sees no
    // more of the profile than the prompt itself carries.
    const contextPayload = {
      fieldLabel: request.question,
      fieldType: 'textarea',
      relevantAnswers: [],
      relevantClaims: [],
    } as unknown as FieldAnsweringContext;
    const response = await request.execute({
      prompt,
      systemPrompt,
      contextType: 'field_answering',
      contextPayload,
      temperature: attempt === 0 ? 0.3 : 0.2,
      maxTokens: 900,
    });

    const parsed = parseAndValidateJsonResponse<AiFieldAnswerResult>(response.rawText, isAiFieldAnswerResult);
    if (!parsed.success || !parsed.data) {
      previousProblems = ['Return only the JSON object described in the instructions.'];
      request.onAttempt?.({ text: response.rawText.slice(0, 600), problems: previousProblems });
      continue;
    }
    const text = parsed.data.answerText.trim();
    if (!text || parsed.data.isGrounded === false) {
      return { ok: false, reason: "Your resume doesn't have enough to answer this one honestly. Answer it yourself, or add a line to your resume first." };
    }

    const cited = parsed.data.supportingClaimIds.filter((id) => knownClaimIds.has(id));
    const fitted = fitToLength(text, request.maxLength);
    const supportingClaimIds = cited.length > 0 ? cited : inferSupport(fitted, evidence);
    const problems = check(fitted);
    request.onAttempt?.({ text: fitted, problems });
    if (problems.length === 0) {
      return {
        ok: true,
        text: fitted,
        supportingClaimIds,
        confidence: Math.min(1, Math.max(0, parsed.data.confidence)),
        retried: attempt > 0,
      };
    }

    // Cut the offending sentences before spending another model call.
    const repaired = repairDraft(fitted, problems, check);
    if (repaired) {
      return {
        ok: true,
        text: repaired.text,
        supportingClaimIds: cited.length > 0 ? cited : inferSupport(repaired.text, evidence),
        confidence: Math.min(1, Math.max(0, parsed.data.confidence)) * 0.9,
        retried: attempt > 0,
        removed: repaired.removed,
      };
    }
    if (!best || problems.length <= best.problems.length) best = { text: fitted, problems, supportingClaimIds };
    previousProblems = problems;
  }

  return {
    ok: false,
    reason: best
      ? 'Check this draft before using it. Some of it is not backed by your resume or the posting.'
      : 'The AI did not return a usable draft. Try again, or answer this one yourself.',
    problems: best?.problems ?? previousProblems,
    ...(best ? { draft: best.text, supportingClaimIds: best.supportingClaimIds } : {}),
  };
}
