/**
 * @fileoverview The extension's drafting loop: draft, check, retry once, else drop.
 * Runs against a scripted model so the behaviour is pinned without a real API key.
 */

import { describe, it, expect, vi } from 'vitest';
import { createEmptyProfile, createProfileId, type CandidateClaim, type CandidateProfile } from '@applykit/domain';
import { draftGroundedAnswer, postingForQuestion } from '../background/grounded-answer.js';

const profile: CandidateProfile = {
  ...createEmptyProfile(createProfileId('ga')),
  experiences: [
    {
      id: 'exp_1' as never,
      company: 'GeoResinStore',
      title: 'Backend Engineer',
      employmentType: 'full_time',
      location: '',
      isRemote: false,
      startDate: '2025-03',
      endDate: '2026-02',
      isCurrent: false,
      description: '',
      highlights: ['Implemented server-side Paystack and Flutterwave webhook verification to prevent payment tampering'],
      technologiesUsed: ['Node.js'],
      evidenceRefs: [],
    },
  ],
};
const claims = [{ id: 'clm_pay', statement: profile.experiences[0]!.highlights[0]! }] as unknown as CandidateClaim[];
const job = { title: 'Backend Engineer', companyName: 'Monzo', rawDescription: 'We offer personal and business bank accounts.' };
const reply = (answer: object) => ({ rawText: JSON.stringify(answer) });

describe('draftGroundedAnswer', () => {
  it('rejects an invented draft, retries with the problems, and returns the honest one', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce(reply({ answerText: "I'm passionate about Monzo's 10 million customers.", confidence: 0.9, supportingClaimIds: ['clm_pay'], isGrounded: true, notes: '' }))
      .mockResolvedValueOnce(
        reply({
          answerText: 'Monzo offers personal and business bank accounts, and I implemented Paystack and Flutterwave webhook verification at GeoResinStore.',
          confidence: 0.8,
          supportingClaimIds: ['clm_pay'],
          isGrounded: true,
          notes: '',
        })
      );
    const result = await draftGroundedAnswer({ question: 'What attracted you to Monzo?', profile, claims, job, execute });
    expect(result.ok).toBe(true);
    expect(result.ok && result.retried).toBe(true);
    const retryPrompt = execute.mock.calls[1]![0].prompt as string;
    expect(retryPrompt).toContain('YOUR PREVIOUS DRAFT WAS REJECTED');
    expect(retryPrompt).toMatch(/10m/);
    expect(retryPrompt).toMatch(/passionate/);
  });

  it('drops the answer when the second draft is still invented', async () => {
    const bad = reply({ answerText: 'I scaled Monzo to 10 million users.', confidence: 0.9, supportingClaimIds: ['clm_pay'], isGrounded: true, notes: '' });
    const execute = vi.fn().mockResolvedValue(bad);
    const result = await draftGroundedAnswer({ question: 'What attracted you to Monzo?', profile, claims, job, execute });
    expect(result.ok).toBe(false);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('ends within the character limit on a whole sentence', async () => {
    const execute = vi.fn().mockResolvedValue(
      reply({
        answerText: 'I implemented Paystack and Flutterwave webhook verification at GeoResinStore. It stopped payment tampering for every order and made confirmation automatic.',
        confidence: 0.8,
        supportingClaimIds: ['clm_pay'],
        isGrounded: true,
        notes: '',
      })
    );
    const result = await draftGroundedAnswer({ question: 'Tell us about yourself.', profile, claims, execute, maxLength: 90 });
    expect(result.ok && result.text).toBe('I implemented Paystack and Flutterwave webhook verification at GeoResinStore.');
  });
});

describe('postingForQuestion', () => {
  it('drops the open posting when the question names a different company', () => {
    expect(postingForQuestion('What attracted you to Northwind?', job)).toBeUndefined();
    expect(postingForQuestion('What attracted you to Monzo?', job)).toBe(job);
    expect(postingForQuestion('Why do you want to join us?', job)).toBe(job);
    expect(postingForQuestion('Tell us about yourself.', job)).toBe(job);
  });
});

describe('drafts that are mostly right', () => {
  it('cuts the one sentence that names something unsupported instead of dropping the answer', async () => {
    const execute = vi.fn().mockResolvedValue(
      reply({
        answerText:
          'Monzo offers personal and business bank accounts. At GeoResinStore I implemented Paystack and Flutterwave webhook verification to prevent payment tampering. I also know Vitess well.',
        confidence: 0.8,
        supportingClaimIds: ['clm_pay'],
        isGrounded: true,
        notes: '',
      })
    );
    const result = await draftGroundedAnswer({ question: 'What attracted you to Monzo?', profile, claims, job, execute });
    expect(result.ok).toBe(true);
    expect(result.ok && result.text).not.toMatch(/Vitess/);
    expect(result.ok && result.removed?.[0]).toMatch(/Vitess/);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('works out which resume lines were used when the model cites ids wrongly', async () => {
    const execute = vi.fn().mockResolvedValue(
      reply({
        answerText: 'Monzo offers personal and business bank accounts. I implemented server-side Paystack and Flutterwave webhook verification at GeoResinStore.',
        confidence: 0.8,
        supportingClaimIds: ['line-1'],
        isGrounded: true,
        notes: '',
      })
    );
    const result = await draftGroundedAnswer({ question: 'What attracted you to Monzo?', profile, claims, job, execute });
    expect(result.ok && result.supportingClaimIds).toEqual(['clm_pay']);
  });

  it('hands back the closest draft with its problems when it cannot be fixed', async () => {
    const execute = vi.fn().mockResolvedValue(
      reply({ answerText: 'I scaled Monzo to 10 million users.', confidence: 0.9, supportingClaimIds: ['clm_pay'], isGrounded: true, notes: '' })
    );
    const result = await draftGroundedAnswer({ question: 'What attracted you to Monzo?', profile, claims, job, execute });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.draft).toBe('I scaled Monzo to 10 million users.');
    expect(!result.ok && result.problems?.join(' ')).toMatch(/10m/);
  });

  it('lets the candidate name things in their own note', async () => {
    const execute = vi.fn().mockResolvedValue(
      reply({
        answerText: 'Monzo offers personal and business bank accounts, and I want to work on Monzo Pots. I implemented Paystack and Flutterwave webhook verification at GeoResinStore.',
        confidence: 0.8,
        supportingClaimIds: ['clm_pay'],
        isGrounded: true,
        notes: '',
      })
    );
    const result = await draftGroundedAnswer({ question: 'What attracted you to Monzo?', profile, claims, job, execute, candidateNote: 'mention Pots' });
    expect(result.ok).toBe(true);
  });
});
