/**
 * Live check of answer drafting against the real Gemini API, to tune prompts with real
 * model output instead of guesses.
 *
 * Runs only when you provide your own key and resume, on your own machine:
 *
 *   GEMINI_TEST_KEY=your-key APPLYKIT_RESUME=/path/to/resume.txt \
 *     npx vitest run apps/extension/src/__tests__/live/answer-eval.test.ts
 *
 * For each question it prints whether the draft was accepted, repaired (a sentence cut),
 * needs review, or dropped, with the checker's reasons. Nothing is saved.
 */

import { describe, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { parsePlainTextResume, createProfileFromParsedResume, deriveClaimsFromEvidence, type JobPosting } from '@applykit/domain';
import { GeminiProvider } from '../../ai/gemini-provider.js';
import { draftGroundedAnswer, type DraftAttempt } from '../../background/grounded-answer.js';
import { researchCompany } from '../../ai/company-research.js';

const KEY = process.env.GEMINI_TEST_KEY;
const RESUME = process.env.APPLYKIT_RESUME;

const JOB = {
  title: 'Software Engineer - PlanetScale Postgres',
  companyName: 'PlanetScale',
  url: 'https://job-boards.greenhouse.io/planetscale/jobs/0000000',
  rawDescription:
    'PlanetScale is growing rapidly and reinventing the database space. The PlanetScale platform delivers a fully managed, multi-cloud Postgres service designed for the most demanding production workloads. You will design and build the control plane that provisions, scales, and heals Postgres clusters with minimal customer-visible downtime. You will build and maintain high availability, disaster recovery, and data protection solutions. Experience with Go or Rust in production. Experience operating PostgreSQL. Experience with distributed systems.',
} as unknown as JobPosting;

const QUESTIONS = [
  "Please tell us a little about your background and why you're interested in this role.",
  'Why do you want to work at PlanetScale?',
  'Tell us about a project you are proud of.',
  'How do you make a payment workflow safe to retry?',
];

describe('live answer drafting (real Gemini)', () => {
  it('drafts answers and reports what the checker found', { timeout: 300_000 }, async () => {
    if (!KEY || !RESUME || !existsSync(RESUME)) return; // skipped unless you opt in

    const { profile, evidence } = createProfileFromParsedResume(parsePlainTextResume(readFileSync(RESUME, 'utf8')));
    const claims = deriveClaimsFromEvidence(evidence);
    const provider = new GeminiProvider(KEY, undefined, 30_000);
    const brief = await researchCompany(JOB, { geminiKey: KEY, storage: { get: async () => ({}), set: async () => undefined } as never });
    console.log(`\nCompany facts (${brief.via.join(', ') || 'none'}):\n${brief.facts.map((f) => `  - ${f}`).join('\n')}\n`);

    for (const question of QUESTIONS) {
      const attempts: DraftAttempt[] = [];
      const result = await draftGroundedAnswer({
        question,
        profile,
        claims,
        job: JOB,
        companyFacts: brief.facts,
        execute: (request) => provider.complete(request),
        onAttempt: (attempt) => attempts.push(attempt),
      });
      const outcome = result.ok ? (result.removed ? 'REPAIRED' : 'ACCEPTED') : result.draft ? 'NEEDS REVIEW' : 'DROPPED';
      console.log(`=== ${outcome}: ${question}`);
      attempts.forEach((attempt, i) => console.log(`  attempt ${i + 1}: ${attempt.text}\n    problems: ${attempt.problems.join(' | ') || 'none'}`));
      if (result.ok) console.log(`  final: ${result.text}\n`);
    }
  });
});
