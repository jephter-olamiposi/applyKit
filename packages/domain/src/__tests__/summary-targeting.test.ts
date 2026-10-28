/**
 * @fileoverview The tailored summary names a kind of system the posting asks for, but
 * only when the candidate's own bullets show that work.
 */

import { describe, it, expect } from 'vitest';
import { parsePlainTextResume } from '../evidence/parser.js';
import { createProfileFromParsedResume } from '../evidence/decomposer.js';
import { tailorCandidateResume } from '../tailoring/resume-tailorer.js';
import type { JobPosting } from '../job/job-posting.js';

const resume = (bullet: string) => `Ada Obi
ada@example.com
WORK EXPERIENCE
Backend Engineer — Kora
Jan 2022 – Present
* Implemented Paystack webhook verification to prevent payment tampering using Node.js.
* ${bullet}
SKILLS
Distributed Systems, Node.js
EDUCATION
University of Lagos — BSc, Computer Science`;

const job = {
  id: 'job_1',
  title: 'Backend Engineer',
  companyName: 'Monzo',
  url: 'https://example.com/job',
  rawDescription: 'You are interested in distributed systems and writing resilient software. Node.js.',
  requirements: [
    { id: 'r1', rawText: 'Interest in distributed systems', normalizedSkillOrCompetency: 'distributed systems', isRequired: true, category: 'technical_skill' },
    { id: 'r2', rawText: 'Node.js', normalizedSkillOrCompetency: 'node.js', isRequired: true, category: 'technical_skill' },
  ],
} as unknown as JobPosting;

describe('summary targeting', () => {
  it('names distributed systems when a bullet shows that work', () => {
    const { profile } = createProfileFromParsedResume(parsePlainTextResume(resume('Built a distributed ledger system that replicates balances across three regions.')));
    expect(tailorCandidateResume(job, profile).tailoredSummary.toLowerCase()).toContain('distributed systems');
  });

  it('does not when the skills list is the only place it appears', () => {
    const { profile } = createProfileFromParsedResume(parsePlainTextResume(resume('Wrote the admin dashboard for refunds.')));
    expect(tailorCandidateResume(job, profile).tailoredSummary.toLowerCase()).not.toContain('distributed');
  });
});
