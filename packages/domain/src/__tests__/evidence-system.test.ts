import { describe, it, expect } from 'vitest';
import {
  createEvidenceId,
  createClaimId,
  buildEvidenceGraph,
  getSupportingEvidenceForClaim,
  findUnbackedClaims,
  isClaimSubstantiated,
  type Evidence,
  type CandidateClaim,
} from '../index.js';

describe('Evidence & Claim Subsystem', () => {
  const ev1: Evidence = {
    id: createEvidenceId('ev_1'),
    source: {
      type: 'resume_bullet',
      sourceId: 'doc_resume_2025',
      uri: 'resume.pdf',
    },
    description: 'Led migration of microservices to TypeScript and Node.js',
    textSnippet: 'Led migration of 6 core Python services to TypeScript/Node.js, cutting p99 latency by 40%.',
    verificationStatus: 'verified',
    confidenceScore: 0.95,
    createdAt: new Date().toISOString(),
    tags: ['typescript', 'nodejs', 'performance'],
  };

  const ev2: Evidence = {
    id: createEvidenceId('ev_2'),
    source: {
      type: 'git_commit',
      sourceId: 'commit_a1b2c3',
      uri: 'https://github.com/org/repo/commit/a1b2c3',
    },
    description: 'Implemented Distributed Rate Limiter in Redis',
    textSnippet: 'feat: add sliding window rate limiter using Redis and Lua script',
    verificationStatus: 'verified',
    confidenceScore: 1.0,
    createdAt: new Date().toISOString(),
    tags: ['redis', 'distributed-systems'],
  };

  const claim1: CandidateClaim = {
    id: createClaimId('clm_1'),
    statement: 'Extensive production experience with TypeScript and latency optimization',
    claimType: 'achievement',
    supportedByEvidenceIds: [ev1.id],
    confidence: 0.9,
    tags: ['typescript'],
    createdAt: new Date().toISOString(),
  };

  const claimUnbacked: CandidateClaim = {
    id: createClaimId('clm_2'),
    statement: '10 years experience with Rust in embedded avionics',
    claimType: 'years_experience',
    supportedByEvidenceIds: [],
    confidence: 0.2,
    tags: ['rust', 'avionics'],
    createdAt: new Date().toISOString(),
  };

  it('builds evidence graph and resolves supporting evidence for claims', () => {
    const graph = buildEvidenceGraph([ev1, ev2], [claim1, claimUnbacked]);
    const supporting = getSupportingEvidenceForClaim(graph, claim1);

    expect(supporting).toHaveLength(1);
    expect(supporting[0]?.id).toBe(ev1.id);
    expect(supporting[0]?.textSnippet).toContain('cutting p99 latency by 40%');
  });

  it('identifies unbacked claims that lack supporting evidence', () => {
    const unbacked = findUnbackedClaims([claim1, claimUnbacked]);
    expect(unbacked).toHaveLength(1);
    expect(unbacked[0]?.id).toBe(claimUnbacked.id);
    expect(isClaimSubstantiated(claimUnbacked)).toBe(false);
  });

  it('verifies that substantiated claims meet confidence threshold and have evidence', () => {
    expect(isClaimSubstantiated(claim1)).toBe(true);
  });
});
