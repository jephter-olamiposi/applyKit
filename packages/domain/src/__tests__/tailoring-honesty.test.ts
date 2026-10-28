import { describe, it, expect } from 'vitest';
import { parsePlainTextResume } from '../evidence/parser.js';
import { createProfileFromParsedResume } from '../evidence/decomposer.js';
import { deriveClaimsFromEvidence } from '../evidence/claims.js';
import { buildEvidenceGraph } from '../evidence/evidence-graph.js';
import { tailorCandidateResume } from '../tailoring/resume-tailorer.js';
import { auditResumeQuality } from '../tailoring/resume-rules.js';
import { generateGroundedCoverLetter, possessive } from '../tailoring/cover-letter-generator.js';
import { factCheckTailoredDocument } from '../tailoring/fact-checker.js';
import { findAiPhrasing } from '../ai/writing-style.js';
import { createJobPostingId, createRequirementId } from '../types/ids.js';
import type { JobPosting } from '../job/job-posting.js';
import type { Requirement } from '../job/requirement.js';

const RESUME = `Boluwatife Olaifa
Lagos, Nigeria | bolu@example.com | linkedin.com/in/bolu

EXPERIENCE
Senior Backend Engineer, Kuda Lite (Lagos) | Jan 2023 - Present
- Mentored 3 junior engineers
- Built a double-entry ledger service in Go and PostgreSQL handling 1.2M transactions per day
- Cut payout reconciliation time from 6 hours to 40 minutes by moving batch jobs to Kafka consumers
Backend Engineer, CareLink Health | Mar 2020 - Dec 2022
- Designed REST and gRPC APIs in Go for appointment booking used by 40 clinics

PROJECTS
StatusHD - React Native app for posting HD media to WhatsApp Status

SKILLS
Go, PostgreSQL, Kafka, gRPC, React Native

EDUCATION
B.Tech Computer Science, LAUTECH, 2025
`;

function requirement(rawText: string, key: string): Requirement {
  return { id: createRequirementId(), rawText, normalizedSkillOrCompetency: key, category: 'technical_skill', importance: 'required', isRequired: true, matchedEvidenceIds: [] };
}

function setup() {
  const { profile: base, evidence } = createProfileFromParsedResume(parsePlainTextResume(RESUME));
  const claims = deriveClaimsFromEvidence(evidence);
  const profile = { ...base, claims };
  const job: JobPosting = {
    id: createJobPostingId('job_1'),
    url: 'https://jobs.example.com/1',
    title: 'Senior Backend Engineer (Go)',
    companyName: 'Northwind Payments',
    location: 'Remote',
    workplaceType: 'remote',
    employmentType: 'full_time',
    requirements: [
      requirement('Strong Go experience in production', 'Strong Go experience in production'),
      requirement('Experience with Kafka or another message queue', 'Kafka or another message queue'),
    ],
    metadata: {},
    parsedAt: '2026-10-24T00:00:00Z',
    rawDescription: 'We are hiring a backend engineer to own our ledger and payouts services.',
  };
  return { profile, job, graph: buildEvidenceGraph(evidence, claims) };
}

describe('Tailored resume honesty and readability', () => {
  it('keeps roles newest first and leads each role with the most relevant bullet', () => {
    const { profile, job, graph } = setup();
    const tailored = tailorCandidateResume(job, profile, graph);
    expect(tailored.experiences.map((e) => e.company)).toEqual(['Kuda Lite', 'CareLink Health']);
    expect(tailored.experiences[0]?.rankedHighlights[0]?.text).not.toBe('Mentored 3 junior engineers');
  });

  it('lists required skills found in requirement sentences', () => {
    const { profile, job, graph } = setup();
    const tailored = tailorCandidateResume(job, profile, graph);
    expect(tailored.skills.matchedRequired).toEqual(expect.arrayContaining(['Go', 'Kafka']));
  });

  it('writes a plain two-sentence summary from real facts', () => {
    const { profile, job, graph } = setup();
    const summary = tailorCandidateResume(job, profile, graph).tailoredSummary;
    expect(summary).toMatch(/^Senior Backend Engineer with \d+ years of experience building payments and healthcare systems in Go/);
    // The result names where it was done, verb first, never as an "At X, engineered" fragment.
    expect(summary).toMatch(/ at Kuda Lite\./);
    expect(summary).not.toMatch(/At Kuda Lite, [a-z]/);
    expect(summary).not.toMatch(/Core stack|passionate|results-driven/i);
    expect(tailorCandidateResume(job, profile, graph, { mentionCompany: false }).tailoredSummary).not.toMatch(/Northwind/);
    expect(summary).not.toContain('—');
  });

  it('passes the honesty checks on a clean resume', () => {
    const { profile, job, graph } = setup();
    const audit = tailorCandidateResume(job, profile, graph).qualityAudit!;
    expect(audit.checks.no_placeholders.status).toBe('passed');
    expect(audit.checks.facts_traceable.status).toBe('passed');
  });

  it('blocks a resume with a missing employer or an invented skill', () => {
    const { profile, job, graph } = setup();
    const tailored = tailorCandidateResume(job, profile, graph);
    const broken = {
      ...tailored,
      experiences: tailored.experiences.map((e, i) => (i === 0 ? { ...e, company: 'Company' } : e)),
      skills: { ...tailored.skills, additionalSkills: [...tailored.skills.additionalSkills, 'React'] },
    };
    const audit = auditResumeQuality(broken, profile, job, 'modern');
    expect(audit.checks.no_placeholders.status).toBe('failed');
    expect(audit.checks.facts_traceable.status).toBe('failed');
    expect(audit.isReady).toBe(false);
    expect(audit.overallScore).toBeLessThan(60);
  });

  it('writes a cover letter with no stock phrases, broken grammar, or em dashes', () => {
    const { profile, job, graph } = setup();
    const letter = generateGroundedCoverLetter(job, profile, graph);
    expect(findAiPhrasing(letter.fullText)).toEqual([]);
    expect(letter.fullText).toContain("I'd like to apply for the Senior Backend Engineer (Go) role at Northwind Payments.");
    expect(letter.fullText).toContain('At Kuda Lite, I built a double-entry ledger service');
    expect(letter.fullText).not.toMatch(/\b(includes|notably),? (built|cut|designed|migrated)\b/i);
    expect(letter.allCitations.every((c) => c.evidenceId)).toBe(true);
  });

  it('fact-checks its own letter as fully grounded', () => {
    const { profile, job, graph } = setup();
    const letter = generateGroundedCoverLetter(job, profile, graph);
    const report = factCheckTailoredDocument(letter.fullText, profile, graph, 'cover_letter');
    expect(report.unbackedStatements).toEqual([]);
    expect(report.groundingScore).toBe(100);
  });

  it('catches a wrong years-of-experience claim', () => {
    const { profile, graph } = setup();
    const report = factCheckTailoredDocument("I'm a backend engineer with 12 years of experience.", profile, graph, 'cover_letter');
    expect(report.unbackedStatements[0]?.severity).toBe('critical');
  });

  it('writes possessives correctly', () => {
    expect(possessive('Northwind Payments')).toBe("Northwind Payments'");
    expect(possessive('Acme')).toBe("Acme's");
  });
});
