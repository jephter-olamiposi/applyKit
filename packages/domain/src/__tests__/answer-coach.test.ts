/**
 * @fileoverview The answer coach: playbook choice, prompt content, and the checks that
 * throw away drafts with facts the resume and posting do not contain.
 */

import { describe, it, expect } from 'vitest';
import { parsePlainTextResume } from '../evidence/parser.js';
import { createProfileFromParsedResume } from '../evidence/decomposer.js';
import {
  buildApplicationAnswerPrompt,
  checkAnswerGrounding,
  classifyApplicationQuestion,
  fitToLength,
  groundingSourcesFor,
} from '../ai/answer-coach.js';
import { applyResumeRewrite, checkBulletRewrite, collectRewriteBullets } from '../ai/resume-rewrite.js';
import { tailorCandidateResume } from '../tailoring/resume-tailorer.js';
import { buildEvidenceGraph } from '../evidence/evidence-graph.js';
import { deriveClaimsFromEvidence } from '../evidence/claims.js';
import type { JobPosting } from '../job/job-posting.js';

const RESUME = `Jephter Olaifa
jephter@example.com
WORK EXPERIENCE
Software Engineer — CoreServe — Rust
Feb 2026 – Aug 2026
* Designed transaction-safe wallet, billing, settlement, and payout workflows with maker-checker approval, idempotent processing, and automated reconciliation.
Backend Engineer — GeoResinStore
Mar 2025 – Feb 2026
* Implemented server-side Paystack and Flutterwave webhook verification to prevent payment tampering and automate order confirmation.
* Architected a modular e-commerce backend for a Nigerian resin art supplier using Node.js and PostgreSQL.
Software Engineer — Freelance
Mar 2023 – Feb 2025
* Established reusable GitHub Actions CI/CD pipelines to automate testing and deployment across client projects.
SKILLS
Languages: Rust, TypeScript, Go
EDUCATION
Ladoke Akintola University of Technology — BSc, Information Systems`;

const JOB: JobPosting = {
  id: 'job_1' as JobPosting['id'],
  url: 'https://example.com',
  title: 'Senior Backend Engineer',
  companyName: 'Monzo',
  location: 'Remote (UK)',
  workplaceType: 'remote',
  employmentType: 'full_time',
  rawDescription: 'We are waving goodbye to traditional banking. We use Go and Kafka. As well as personal and business bank accounts, we offer credit cards.',
  requirements: [],
  parsedAt: '',
  metadata: {},
};

function load() {
  const { profile, evidence } = createProfileFromParsedResume(parsePlainTextResume(RESUME));
  const claims = deriveClaimsFromEvidence(evidence);
  return { profile: { ...profile, claims }, graph: buildEvidenceGraph(evidence, claims) };
}

describe('classifyApplicationQuestion', () => {
  it('routes real form questions to the right playbook', () => {
    expect(classifyApplicationQuestion('What attracted you to Monzo?')).toBe('why_company');
    expect(classifyApplicationQuestion("What's the most interesting project you've worked on recently?")).toBe('project_story');
    expect(classifyApplicationQuestion("Please tell us a little about your background and why you're interested in this role.")).toBe('background_and_why');
    expect(classifyApplicationQuestion('Why are you interested in this role?')).toBe('why_role');
    expect(classifyApplicationQuestion('How would you design an idempotent payout API?')).toBe('technical_depth');
  });
});

describe('buildApplicationAnswerPrompt', () => {
  it('includes the voice, the playbook, the posting, and the retry problems', () => {
    const { systemPrompt, prompt } = buildApplicationAnswerPrompt({
      question: 'What attracted you to Monzo?',
      evidence: [{ id: 'clm_1', text: 'Implemented Paystack webhook verification', role: 'GeoResinStore' }],
      skills: ['Rust'],
      job: JOB,
      maxLength: 500,
      previousProblems: ['The number "40%" is not in the resume or the posting.'],
    });
    expect(systemPrompt).toContain('VOICE');
    expect(systemPrompt).toContain('Facts about the company may come ONLY from the company research and the job posting');
    expect(systemPrompt).not.toMatch(/—/);
    expect(prompt).toContain('<posting>');
    expect(prompt).toContain('traditional banking');
    expect(prompt).toContain('[clm_1] (GeoResinStore)');
    expect(prompt).toContain('Hard limit: 500 characters');
    expect(prompt).toContain('YOUR PREVIOUS DRAFT WAS REJECTED');
  });
});

describe('checkAnswerGrounding', () => {
  const { profile } = load();
  const sources = groundingSourcesFor(profile, JOB);

  it('accepts an answer built from the resume and the posting', () => {
    const answer =
      "Monzo offers personal and business bank accounts, and payments are the work I know. At GeoResinStore I implemented Paystack and Flutterwave webhook verification to prevent payment tampering. I'd like to keep building money movement in Rust.";
    expect(checkAnswerGrounding(answer, sources)).toEqual([]);
  });

  it('catches invented numbers, tools, names, stock phrases, and dashes', () => {
    const answer =
      "I'm passionate about Monzo's 10 million customers — I cut latency by 40% using Kubernetes at Stripe.";
    const problems = checkAnswerGrounding(answer, sources).join(' | ');
    expect(problems).toMatch(/"10m"/);
    expect(problems).toMatch(/"40%"/);
    expect(problems).toMatch(/kubernetes/i);
    expect(problems).toMatch(/Stripe/);
    expect(problems).toMatch(/passionate/i);
    expect(problems).toMatch(/dashes/);
  });

  it('allows the real years of experience', () => {
    expect(checkAnswerGrounding("I've built backend systems for 3 years.", sources)).toEqual([]);
  });
});

describe('fitToLength', () => {
  it('ends on a sentence, or on a word with a full stop, never mid-word', () => {
    expect(fitToLength('First sentence here. Second one is longer than the limit allows.', 30)).toBe('First sentence here.');
    expect(fitToLength('One very long sentence without any stop that keeps going', 30)).toBe('One very long sentence.');
  });
});

describe('resume rewrite checks', () => {
  it('accepts rewording and rejects added facts', () => {
    const original = 'Implemented server-side Paystack and Flutterwave webhook verification to prevent payment tampering and automate order confirmation';
    expect(checkBulletRewrite(original, 'Built server-side Paystack and Flutterwave webhook verification that blocks payment tampering and confirms orders automatically', 'Backend Engineer GeoResinStore')).toBeUndefined();
    expect(checkBulletRewrite(original, 'Built Paystack webhook verification handling 2M payments a day', 'Backend Engineer GeoResinStore')).toMatch(/number 2m/);
    expect(checkBulletRewrite(original, 'Built Paystack webhook verification in Go on Kubernetes', 'Backend Engineer GeoResinStore')).toMatch(/added "(go|golang|kubernetes)"/i);
    expect(checkBulletRewrite(original, 'Built Paystack webhook verification for Shopify merchants', 'Backend Engineer GeoResinStore')).toMatch(/Shopify/i);
  });

  it('keeps the original wording for any line that fails, and checks the summary', () => {
    const { profile, graph } = load();
    const tailored = tailorCandidateResume(JOB, profile as never, graph);
    const bullets = collectRewriteBullets(tailored);
    const target = bullets.find((b) => b.text.includes('Paystack'))!;
    const other = bullets.find((b) => b.text.includes('GitHub Actions'))!;
    const { resume, changes } = applyResumeRewrite(
      tailored,
      {
        summary: 'Backend engineer who built a Kafka platform serving 50M users at Google.',
        bullets: [
          { id: target.id, text: 'Built server-side Paystack and Flutterwave webhook verification that blocks payment tampering' },
          { id: other.id, text: 'Built GitHub Actions CI/CD pipelines that cut deploy time by 80%' },
        ],
      },
      profile as never,
      JOB
    );
    const texts = [...resume.experiences, ...resume.projects].flatMap((item) => item.rankedHighlights.map((h) => h.text));
    expect(texts).toContain('Built server-side Paystack and Flutterwave webhook verification that blocks payment tampering');
    expect(texts.some((t) => t.includes('80%'))).toBe(false);
    expect(resume.tailoredSummary).toBe(tailored.tailoredSummary);
    expect(changes.filter((c) => c.accepted).map((c) => c.id)).toEqual([target.id]);
    expect(changes.find((c) => c.id === 'summary')?.accepted).toBe(false);
  });
});

describe('stricter grounding found by the end-to-end run', () => {
  const { profile } = load();
  const sources = groundingSourcesFor(profile, JOB);

  it('does not let a role date ("2025-10") vouch for an invented "10 million"', () => {
    expect(checkAnswerGrounding('Monzo has 10 million customers.', sources).join(' ')).toMatch(/10m/);
  });

  it('does not accept experience with a tool that is only in the skills list', () => {
    const problems = checkAnswerGrounding('I built payment services in Go at CoreServe.', groundingSourcesFor(profile)).join(' ');
    expect(problems).toMatch(/only in the skills list/);
  });
});

describe('names at the start of a sentence', () => {
  const { profile } = load();
  it('flags another company named as the first word', () => {
    expect(checkAnswerGrounding('Monzo offers bank accounts, and I built payment services.', groundingSourcesFor(profile)).join(' ')).toMatch(/Monzo/);
  });
  it('accepts the open company and ordinary opening verbs', () => {
    expect(checkAnswerGrounding('Monzo offers personal and business bank accounts.', groundingSourcesFor(profile, JOB))).toEqual([]);
    expect(checkAnswerGrounding('Implemented Paystack webhook verification at GeoResinStore.', groundingSourcesFor(profile))).toEqual([]);
  });
});

describe('banned words the candidate wrote themselves', () => {
  it('allows quoting a technical phrase from the resume but not the stock adjective', () => {
    const sources = { candidateText: 'Implemented dynamic codec negotiation and SIP bridging logic.' };
    expect(checkAnswerGrounding('At Internet Number Technologies I implemented dynamic codec negotiation.', { ...sources, candidateText: sources.candidateText + ' Internet Number Technologies' })).toEqual([]);
    expect(checkAnswerGrounding('I am a dynamic engineer.', sources).join(' ')).toMatch(/dynamic/);
  });
});

describe('background and why questions', () => {
  it('answers both halves of a two-part question', () => {
    expect(classifyApplicationQuestion("Please tell us a little about your background and why you're interested in this role.")).toBe('background_and_why');
    expect(classifyApplicationQuestion('Tell us about yourself.')).toBe('about_me');
  });

  it('puts company research in the prompt as fenced data', () => {
    const { profile } = load();
    const { prompt, systemPrompt } = buildApplicationAnswerPrompt({
      question: 'Why do you want to join Monzo?',
      evidence: [{ id: 'c1', text: 'Built payments.' }],
      skills: [],
      job: JOB,
      companyFacts: ['Monzo has a banking licence in the UK.'],
    });
    expect(prompt).toContain('<company_research>');
    expect(prompt).toContain('Monzo has a banking licence in the UK.');
    expect(systemPrompt).toMatch(/generic line/);
    expect(groundingSourcesFor(profile, JOB, ['Monzo has 13 million customers.']).postingText).toContain('13 million');
  });
});
