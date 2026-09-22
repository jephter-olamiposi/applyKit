/**
 * @fileoverview Integration tests for Phase 4 Evidence Ingestion and Grounding Verification.
 *
 * Verifies end-to-end evidence decomposition, batch IndexedDB persistence,
 * claim derivation, and background messaging contracts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { indexedDB } from 'fake-indexeddb';
import {
  createEvidenceId,
  createClaimId,
  type Evidence,
  type CandidateClaim,
} from '@applykit/domain';
import {
  IndexedDbEvidenceRepository,
  IndexedDbProfileRepository,
  deleteDatabase,
} from '../storage/index.js';
import type {
  IngestResumeRequest,
  IngestResumeResponse,
  GetEvidenceGraphRequest,
  GetEvidenceGraphResponse,
  AuditGroundingRequest,
  AuditGroundingResponse,
} from '../messages/contracts.js';

const SAMPLE_RESUME_TEXT = `
# Alex Rivera
alex.rivera@example.com | (555) 345-6789 | Austin, TX
https://linkedin.com/in/alexrivera | https://github.com/alexrivera | https://alexrivera.io

## Summary
Backend Platform Engineer with 6 years experience building distributed microservices with Go, TypeScript, and Kafka.

## Experience
### Senior Backend Engineer | CloudScale Inc | Jan 2021 - Present | Austin, TX
- Scaled event-driven ingestion pipeline with Go and Kafka handling 100,000 events/sec.
- Optimized PostgreSQL database indexes and connection pooling, reducing query response times by 55%.
- Mentored 3 junior software engineers and established architectural RFC review standards.

### Software Engineer | DataCorp | Jun 2018 - Dec 2020 | Remote
- Implemented microservices using TypeScript, Node.js, and Docker.
- Automated deployment workflows using GitHub Actions and AWS Terraform.

## Projects
### EventStream | High Throughput Messaging Client
https://github.com/alexrivera/eventstream
- Developed open-source Go client library for distributed message queues.
- Achieved sub-millisecond dispatch latency under heavy concurrency workloads.

## Education
B.S. in Computer Science | University of Texas at Austin | 2018

## Skills
Languages: Go, TypeScript, Python, SQL
Technologies: Kafka, Docker, Kubernetes, PostgreSQL, AWS, Redis, Git
`;

describe('Evidence Ingestion & Grounding Integration Suite (Phase 4)', () => {
  let evidenceRepo: IndexedDbEvidenceRepository;
  let profileRepo: IndexedDbProfileRepository;

  beforeEach(async () => {
    await deleteDatabase(indexedDB);
    evidenceRepo = new IndexedDbEvidenceRepository(indexedDB);
    profileRepo = new IndexedDbProfileRepository(indexedDB);
  });

  afterEach(async () => {
    evidenceRepo.close();
    profileRepo.close();
    await deleteDatabase(indexedDB);
    vi.restoreAllMocks();
  });

  describe('IndexedDbEvidenceRepository Batch Operations', () => {
    it('persists and retrieves batches of evidence items atomically', async () => {
      const ev1: Evidence = {
        id: createEvidenceId(),
        source: {
          type: 'resume_bullet',
          sourceId: 'exp_1',
          metadata: { company: 'CloudScale', title: 'Senior Backend Engineer' },
        },
        description: 'Scaled event pipeline to 100k events/sec',
        textSnippet: 'Scaled event-driven ingestion pipeline with Go and Kafka handling 100,000 events/sec.',
        verificationStatus: 'verified',
        confidenceScore: 0.9,
        tags: ['Go', 'Kafka', 'CloudScale'],
        createdAt: new Date().toISOString(),
      };

      const ev2: Evidence = {
        id: createEvidenceId(),
        source: {
          type: 'diploma',
          sourceId: 'edu_1',
          metadata: { institution: 'UT Austin', degree: 'B.S. in Computer Science' },
        },
        description: 'B.S. in Computer Science from UT Austin',
        textSnippet: 'B.S. in Computer Science, UT Austin',
        verificationStatus: 'verified',
        confidenceScore: 0.95,
        tags: ['education', 'Computer Science'],
        createdAt: new Date().toISOString(),
      };

      await evidenceRepo.saveEvidenceBatch([ev1, ev2]);

      const stored = await evidenceRepo.listEvidence();
      expect(stored.length).toBe(2);
      expect(stored.map((e) => e.id)).toContain(ev1.id);
      expect(stored.map((e) => e.id)).toContain(ev2.id);
    });

    it('persists claim batches and constructs complete EvidenceGraph', async () => {
      const evId = createEvidenceId();
      const ev: Evidence = {
        id: evId,
        source: {
          type: 'resume_bullet',
          sourceId: 'exp_1',
        },
        description: 'Postgres optimization',
        textSnippet: 'Optimized PostgreSQL queries reducing latency by 55%',
        verificationStatus: 'verified',
        confidenceScore: 0.9,
        tags: ['PostgreSQL'],
        createdAt: new Date().toISOString(),
      };

      const claim: CandidateClaim = {
        id: createClaimId(),
        statement: 'Expert in PostgreSQL performance optimization',
        claimType: 'skill_proficiency',
        supportedByEvidenceIds: [evId],
        confidence: 0.85,
        tags: ['PostgreSQL'],
        createdAt: new Date().toISOString(),
      };

      await evidenceRepo.saveEvidence(ev);
      await evidenceRepo.saveClaimBatch([claim]);

      const graph = await evidenceRepo.getEvidenceGraph();
      expect(graph.evidenceMap.size).toBe(1);
      expect(graph.evidenceMap.get(evId)?.textSnippet).toContain('latency by 55%');
      expect(graph.claims.length).toBe(1);
      expect(graph.claims[0]?.supportedByEvidenceIds).toContain(evId);
    });
  });

  describe('Background RPC Message Handling', () => {
    it('handles INGEST_RESUME_TEXT end-to-end', async () => {
      // Setup background message router simulation with mocked chrome runtime
      let messageListener: ((msg: any, sender: any, sendResponse: (res: any) => void) => boolean) | null = null;

      const mockChrome = {
        runtime: {
          onMessage: {
            addListener: vi.fn((fn) => {
              messageListener = fn;
            }),
          },
          lastError: null,
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

      // Import background script to register router
      await import('../background/index.js');
      expect(messageListener).not.toBeNull();

      // Dispatch INGEST_RESUME_TEXT
      const ingestReq: IngestResumeRequest = {
        type: 'INGEST_RESUME_TEXT',
        rawText: SAMPLE_RESUME_TEXT,
      };

      const ingestResponse = await new Promise<IngestResumeResponse>((resolve) => {
        messageListener!(ingestReq, {}, (res) => {
          resolve(res as IngestResumeResponse);
        });
      });

      expect(ingestResponse.success).toBe(true);
      expect(ingestResponse.evidenceCount).toBeGreaterThanOrEqual(6);
      expect(ingestResponse.claimsCount).toBeGreaterThanOrEqual(4);
      expect(ingestResponse.profileSummary?.fullName).toBe('Alex Rivera');
      expect(ingestResponse.profileSummary?.email).toBe('alex.rivera@example.com');
      expect(ingestResponse.auditReport?.isPristine).toBe(true);
      expect(ingestResponse.auditReport?.groundingScore).toBeGreaterThanOrEqual(0.8);
      expect(ingestResponse.auditReport?.unbackedClaims.length).toBe(0);

      // Dispatch GET_EVIDENCE_GRAPH
      const getGraphReq: GetEvidenceGraphRequest = {
        type: 'GET_EVIDENCE_GRAPH',
      };

      const graphResponse = await new Promise<GetEvidenceGraphResponse>((resolve) => {
        messageListener!(getGraphReq, {}, (res) => {
          resolve(res as GetEvidenceGraphResponse);
        });
      });

      expect(graphResponse.success).toBe(true);
      expect(graphResponse.evidence.length).toBeGreaterThanOrEqual(6);
      expect(graphResponse.claims.length).toBeGreaterThanOrEqual(4);
      expect(graphResponse.auditReport?.isPristine).toBe(true);

      // Dispatch AUDIT_GROUNDING
      const auditReq: AuditGroundingRequest = {
        type: 'AUDIT_GROUNDING',
      };

      const auditResponse = await new Promise<AuditGroundingResponse>((resolve) => {
        messageListener!(auditReq, {}, (res) => {
          resolve(res as AuditGroundingResponse);
        });
      });

      expect(auditResponse.success).toBe(true);
      expect(auditResponse.auditReport?.isPristine).toBe(true);
      expect(auditResponse.auditReport?.unbackedClaims.length).toBe(0);
    });
  });
});
