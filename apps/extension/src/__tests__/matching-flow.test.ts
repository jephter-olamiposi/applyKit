/**
 * @fileoverview Integration tests for Phase 6 Requirement Matching & Gap Analysis Flow.
 *
 * Verifies end-to-end deterministic matching, qualification gap analysis,
 * candidate highlight recommendations, and background RPC message dispatching.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { indexedDB } from 'fake-indexeddb';
import {
  createRequirementId,
  type Requirement,
} from '@applykit/domain';
import { deleteDatabase } from '../storage/index.js';
import type {
  IngestResumeRequest,
  IngestResumeResponse,
  MatchJobRequirementsRequest,
  MatchJobRequirementsResponse,
} from '../messages/contracts.js';

const SAMPLE_RESUME = `
# Jordan Lee
jordan.lee@example.com | (555) 789-0123 | Seattle, WA
https://linkedin.com/in/jordanlee | https://github.com/jordanlee

## Summary
Senior Distributed Systems Engineer with 5 years experience designing event-driven systems using Go, Kafka, and PostgreSQL.

## Experience
### Senior Software Engineer | StreamLine Corp | Jan 2021 - Present | Seattle, WA
- Built high-throughput stream processing pipelines in Go and Kafka processing 50,000 events/second.
- Tuned PostgreSQL query planners and partition tables, reducing p99 database latency by 40%.
- Implemented containerized deployment manifests using Docker.

### Software Engineer | CloudBase | Jun 2019 - Dec 2020 | Remote
- Developed REST APIs and microservices in TypeScript and Node.js.
- Automated CI/CD integration testing with Docker.

## Projects
### DistributedLog | Consensus-Driven Commit Log
https://github.com/jordanlee/distributedlog
- Engineered a lightweight Raft consensus cluster in Go.
- Implemented zero-copy network serialization with sub-millisecond tail latency.

## Skills
Languages: Go, TypeScript, SQL
Technologies: Kafka, Docker, PostgreSQL, Linux, Git
`;

describe('Requirement Matching & Gap Analysis Flow (Phase 6)', () => {
  let messageListener: ((message: unknown, sender: unknown, sendResponse: (res: unknown) => void) => boolean | void) | null = null;
  let bg: typeof import('../background/index.js');

  beforeAll(async () => {
    await deleteDatabase(indexedDB);

    const mockChrome = {
      runtime: {
        onMessage: {
          addListener: vi.fn((listener) => {
            messageListener = listener;
          }),
        },
      },
      tabs: {
        query: vi.fn().mockResolvedValue([]),
        sendMessage: vi.fn(),
      },
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({}),
          set: vi.fn().mockResolvedValue(undefined),
        },
      },
      sidePanel: {
        setPanelBehavior: vi.fn().mockResolvedValue(undefined),
      },
    };

    // @ts-expect-error Mocking global chrome
    globalThis.chrome = mockChrome;
    globalThis.indexedDB = indexedDB;

    bg = await import('../background/index.js');
  });

  afterAll(async () => {
    if (bg) {
      bg.profileRepo.close();
      bg.jobRepo.close();
      bg.evidenceRepo.close();
      bg.appRepo.close();
    }
    await deleteDatabase(indexedDB);
    vi.restoreAllMocks();
  });

  it('handles error when no candidate profile exists', async () => {
    expect(messageListener).not.toBeNull();

    const matchReq: MatchJobRequirementsRequest = {
      type: 'MATCH_JOB_REQUIREMENTS',
      requirements: [],
    };

    const matchRes = await new Promise<MatchJobRequirementsResponse>((resolve) => {
      messageListener!(matchReq, {}, (res) => resolve(res as MatchJobRequirementsResponse));
    });

    expect(matchRes.success).toBe(false);
    expect(matchRes.error).toContain('No candidate profile found');
  });

  it('handles error when profile exists but no job requirements exist', async () => {
    // 1. Ingest profile first
    const ingestReq: IngestResumeRequest = {
      type: 'INGEST_RESUME_TEXT',
      rawText: SAMPLE_RESUME,
    };

    await new Promise<IngestResumeResponse>((resolve) => {
      messageListener!(ingestReq, {}, (res) => resolve(res as IngestResumeResponse));
    });

    // 2. Dispatch with empty requirements
    const matchReq: MatchJobRequirementsRequest = {
      type: 'MATCH_JOB_REQUIREMENTS',
      requirements: [],
    };

    const matchRes = await new Promise<MatchJobRequirementsResponse>((resolve) => {
      messageListener!(matchReq, {}, (res) => resolve(res as MatchJobRequirementsResponse));
    });

    expect(matchRes.success).toBe(false);
    expect(matchRes.error).toContain('No requirements found');
  });

  it('runs complete matching and gap analysis against ingested profile via RPC', async () => {
    // Define job requirements
    const testRequirements: Requirement[] = [
      {
        id: createRequirementId(),
        rawText: 'Strong proficiency in Golang microservices',
        normalizedSkillOrCompetency: 'Golang', // Synonym for Go!
        category: 'technical_skill',
        importance: 'required',
        isRequired: true,
        matchedEvidenceIds: [],
      },
      {
        id: createRequirementId(),
        rawText: 'Deep experience with Apache Kafka messaging',
        normalizedSkillOrCompetency: 'Kafka',
        category: 'technical_skill',
        importance: 'required',
        isRequired: true,
        matchedEvidenceIds: [],
      },
      {
        id: createRequirementId(),
        rawText: 'Must have at least 8 years of TypeScript production experience',
        normalizedSkillOrCompetency: 'TypeScript',
        category: 'technical_skill',
        importance: 'required',
        yearsRequired: 8, // Shortfall: Jordan only has ~2-5 years
        isRequired: true,
        matchedEvidenceIds: [],
      },
      {
        id: createRequirementId(),
        rawText: 'Production experience with Kubernetes orchestration is required',
        normalizedSkillOrCompetency: 'Kubernetes',
        category: 'technical_skill',
        importance: 'required', // Jordan does not have K8s -> Hard gap
        isRequired: true,
        matchedEvidenceIds: [],
      },
      {
        id: createRequirementId(),
        rawText: 'Familiarity with Redis caching is a plus',
        normalizedSkillOrCompetency: 'Redis',
        category: 'technical_skill',
        importance: 'nice_to_have', // Soft gap
        isRequired: false,
        matchedEvidenceIds: [],
      },
    ];

    // Dispatch MATCH_JOB_REQUIREMENTS
    const matchReq: MatchJobRequirementsRequest = {
      type: 'MATCH_JOB_REQUIREMENTS',
      requirements: testRequirements,
    };

    const matchRes = await new Promise<MatchJobRequirementsResponse>((resolve) => {
      messageListener!(matchReq, {}, (res) => resolve(res as MatchJobRequirementsResponse));
    });

    expect(matchRes.success).toBe(true);
    expect(matchRes.matchMatrix).toBeDefined();
    expect(matchRes.gapAnalysis).toBeDefined();
    expect(matchRes.highlightSuggestions).toBeDefined();

    // Verify Match Matrix
    const matrix = matchRes.matchMatrix!;
    expect(matrix.totalRequirements).toBe(5);
    expect(matrix.requiredCount).toBe(4);
    // Golang (Go), Kafka, TypeScript are met; Kubernetes is missing
    expect(matrix.requiredMetCount).toBe(3);
    expect(matrix.overallMatchScore).toBeGreaterThan(40);
    expect(matrix.overallMatchScore).toBeLessThan(100);

    // Verify Gap Analysis
    const gaps = matchRes.gapAnalysis!;
    expect(gaps.totalGaps).toBeGreaterThan(0);

    // Kubernetes should be a hard gap
    const k8sGap = gaps.gaps.find((g) => g.competency === 'Kubernetes');
    expect(k8sGap).toBeDefined();
    expect(k8sGap?.category).toBe('hard_gap');
    expect(k8sGap?.severity).toBe('critical');

    // TypeScript should be an experience shortfall
    const tsGap = gaps.gaps.find((g) => g.competency === 'TypeScript' && g.category === 'experience_shortfall');
    expect(tsGap).toBeDefined();
    expect(tsGap?.requiredYears).toBe(8);

    // Redis should be a soft gap
    const redisGap = gaps.gaps.find((g) => g.competency === 'Redis');
    expect(redisGap).toBeDefined();
    expect(redisGap?.category).toBe('soft_gap');
    expect(redisGap?.severity).toBe('minor');

    // Verify Highlight Suggestions
    const highlights = matchRes.highlightSuggestions!;
    expect(highlights.length).toBeGreaterThan(0);
    const topSuggestion = highlights[0];
    expect(topSuggestion?.relevanceScore).toBeGreaterThan(0);
    expect(topSuggestion?.keyCompetenciesMatched.length).toBeGreaterThan(0);
  });
});
