import { describe, it, expect } from 'vitest';
import {
  parsePlainTextResume,
  createProfileFromParsedResume,
  decomposeProfileIntoEvidence,
  deriveClaimsFromEvidence,
  buildEvidenceGraph,
  auditEvidenceGraphGrounding,
  createClaimId,
  createEvidenceId,
  type Evidence,
  type CandidateClaim,
} from '../index.js';

const SAMPLE_MARKDOWN_RESUME = `
# Jane Doe
jane.doe@example.com | (555) 123-4567 | San Francisco, CA
https://linkedin.com/in/janedoe | https://github.com/janedoe | https://janedoe.dev

## Professional Summary
Senior Full Stack Engineer with 7+ years of experience architecting distributed systems and reactive web applications using TypeScript, React, and Node.js.

## Work Experience
### Senior Software Engineer | Stripe | Mar 2021 - Present | San Francisco, CA
- Architected payment processing pipeline in TypeScript and Node.js, reducing p99 latency by 45%.
- Scaled distributed ledger service handling 50,000 requests per second with 99.999% availability.
- Mentored 4 junior engineers and conducted weekly technical architecture design reviews.

### Software Engineer | Acme Corp | Jan 2018 - Feb 2021 | Remote
- Built real-time analytics dashboard using React, TypeScript, and PostgreSQL.
- Automated CI/CD pipeline using Docker and GitHub Actions, cutting build duration from 25m to 6m.

## Projects
### ApplyKit | Open-Source Job Copilot
https://github.com/janedoe/applykit
- Built local-first Chrome extension using React, TypeScript, and IndexedDB.
- Implemented deterministic browser action interpreter ensuring safe form filling.

## Education
B.S. in Computer Science | Stanford University | 2017

## Technical Skills
Languages: TypeScript, JavaScript, Python, SQL, Rust
Frameworks: React, Node.js, Next.js, Express
Tools & Cloud: Docker, Kubernetes, AWS, PostgreSQL, Redis, Git
`;

describe('Evidence & Claim Verification Engine (Phase 4)', () => {
  describe('parsePlainTextResume', () => {
    it('accurately parses identity, contact, links, and summary from markdown resume', () => {
      const parsed = parsePlainTextResume(SAMPLE_MARKDOWN_RESUME);

      expect(parsed.identity.fullName).toBe('Jane Doe');
      expect(parsed.identity.email).toBe('jane.doe@example.com');
      expect(parsed.identity.phone).toBe('(555) 123-4567');
      expect(parsed.identity.links.linkedin).toBe('https://linkedin.com/in/janedoe');
      expect(parsed.identity.links.github).toBe('https://github.com/janedoe');
      expect(parsed.identity.links.portfolio).toBe('https://janedoe.dev');
      expect(parsed.summary).toContain('Senior Full Stack Engineer');
    });

    it('extracts structured work experience entries with dates and highlights', () => {
      const parsed = parsePlainTextResume(SAMPLE_MARKDOWN_RESUME);

      expect(parsed.experiences.length).toBe(2);

      const [stripe, acme] = parsed.experiences;
      expect(stripe?.company).toBe('Stripe');
      expect(stripe?.title).toBe('Senior Software Engineer');
      expect(stripe?.isCurrent).toBe(true);
      expect(stripe?.startDate).toBe('2021-03');
      expect(stripe?.highlights.length).toBe(3);
      expect(stripe?.technologiesUsed).toContain('TypeScript');
      expect(stripe?.technologiesUsed).toContain('Node.js');

      expect(acme?.company).toBe('Acme Corp');
      expect(acme?.title).toBe('Software Engineer');
      expect(acme?.isCurrent).toBe(false);
      expect(acme?.startDate).toBe('2018-01');
      expect(acme?.endDate).toBe('2021-02');
      expect(acme?.technologiesUsed).toContain('React');
      expect(acme?.technologiesUsed).toContain('PostgreSQL');
    });

    it('extracts projects, education, and technical skills', () => {
      const parsed = parsePlainTextResume(SAMPLE_MARKDOWN_RESUME);

      expect(parsed.projects.length).toBe(1);
      expect(parsed.projects[0]?.title).toBe('ApplyKit');
      expect(parsed.projects[0]?.repoUrl).toBe('https://github.com/janedoe/applykit');
      expect(parsed.projects[0]?.highlights.length).toBe(2);

      expect(parsed.education.length).toBe(1);
      expect(parsed.education[0]?.institution).toBe('Stanford University');
      expect(parsed.education[0]?.degree).toBe('B.S. in Computer Science');

      expect(parsed.skills).toContain('TypeScript');
      expect(parsed.skills).toContain('React');
      expect(parsed.skills).toContain('PostgreSQL');
      expect(parsed.skills).toContain('Docker');
    });

    it('gracefully handles plaintext resumes with uppercase headers and dash bullets', () => {
      const plainText = `
ALEX SMITH
alex@test.org | 555-987-6543
WORK EXPERIENCE
Google - Tech Lead (2019 - 2023)
- Led team of 8 backend engineers developing high-throughput microservices.
- Optimized search indexing query latency by 30%.
EDUCATION
Master of Science in Software Engineering, MIT, 2018
SKILLS
Go, Python, Kubernetes, GCP
`;
      const parsed = parsePlainTextResume(plainText);
      expect(parsed.identity.fullName).toBe('ALEX SMITH');
      expect(parsed.identity.email).toBe('alex@test.org');
      expect(parsed.experiences.length).toBe(1);
      expect(parsed.experiences[0]?.company).toBe('Google');
      expect(parsed.experiences[0]?.title).toBe('Tech Lead');
      expect(parsed.education.length).toBe(1);
      expect(parsed.skills).toContain('Go');
      expect(parsed.skills).toContain('Kubernetes');
    });
  });

  describe('Evidence Decomposition', () => {
    it('decomposes parsed resume into atomic evidence nodes and updates profile references', () => {
      const parsed = parsePlainTextResume(SAMPLE_MARKDOWN_RESUME);
      const { profile, evidence } = createProfileFromParsedResume(parsed);

      expect(profile.identity.legalFirstName).toBe('Jane');
      expect(profile.identity.legalLastName).toBe('Doe');
      expect(profile.experiences.length).toBe(2);

      // Verify that every experience bullet generated an atomic evidence item
      expect(evidence.length).toBeGreaterThanOrEqual(6);

      // Verify evidence references are linked back on experiences
      for (const exp of profile.experiences) {
        expect(exp.evidenceRefs.length).toBeGreaterThan(0);
        for (const refId of exp.evidenceRefs) {
          const matchingEvidence = evidence.find((e) => e.id === refId);
          expect(matchingEvidence).toBeDefined();
          expect(matchingEvidence?.source.sourceId).toBe(exp.id);
        }
      }

      // Verify project evidence references
      for (const proj of profile.projects) {
        expect(proj.evidenceRefs.length).toBeGreaterThan(0);
        for (const refId of proj.evidenceRefs) {
          const matchingEvidence = evidence.find((e) => e.id === refId);
          expect(matchingEvidence).toBeDefined();
        }
      }

      // Verify education evidence
      expect(profile.education[0]?.evidenceRefs.length).toBe(1);
      const eduEv = evidence.find((e) => e.id === profile.education[0]?.evidenceRefs[0]);
      expect(eduEv?.source.type).toBe('diploma');
      expect(eduEv?.confidenceScore).toBe(0.95);
    });

    it('links candidate skills to supporting evidence nodes', () => {
      const parsed = parsePlainTextResume(SAMPLE_MARKDOWN_RESUME);
      const { profile } = createProfileFromParsedResume(parsed);

      const tsSkill = profile.skills.find((s) => s.name === 'TypeScript');
      expect(tsSkill).toBeDefined();
      // TypeScript was mentioned in Stripe, Acme Corp, and ApplyKit
      expect(tsSkill?.evidenceRefs.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Candidate Claim Derivation', () => {
    it('derives skill proficiency claims with multi-source confidence boost', () => {
      const parsed = parsePlainTextResume(SAMPLE_MARKDOWN_RESUME);
      const { evidence } = createProfileFromParsedResume(parsed);
      const claims = deriveClaimsFromEvidence(evidence);

      const tsClaim = claims.find(
        (c) => c.claimType === 'skill_proficiency' && c.tags.includes('TypeScript')
      );
      expect(tsClaim).toBeDefined();
      expect(tsClaim?.supportedByEvidenceIds.length).toBeGreaterThanOrEqual(2);
      // Multi-source boost: 0.75 + 0.15 = 0.90
      expect(tsClaim?.confidence).toBeGreaterThanOrEqual(0.9);
      expect(tsClaim?.statement).toContain('TypeScript');
    });

    it('derives high-impact achievement claims from quantified metrics', () => {
      const parsed = parsePlainTextResume(SAMPLE_MARKDOWN_RESUME);
      const { evidence } = createProfileFromParsedResume(parsed);
      const claims = deriveClaimsFromEvidence(evidence);

      // Look for the 45% latency reduction claim
      const latencyClaim = claims.find(
        (c) => c.claimType === 'achievement' && c.statement.includes('45%')
      );
      expect(latencyClaim).toBeDefined();
      expect(latencyClaim?.supportedByEvidenceIds.length).toBe(1);
      expect(latencyClaim?.confidence).toBeGreaterThanOrEqual(0.8);
    });

    it('derives leadership claims from mentorship bullets', () => {
      const parsed = parsePlainTextResume(SAMPLE_MARKDOWN_RESUME);
      const { evidence } = createProfileFromParsedResume(parsed);
      const claims = deriveClaimsFromEvidence(evidence);

      const leadershipClaim = claims.find(
        (c) => c.claimType === 'leadership' && c.statement.toLowerCase().includes('mentored')
      );
      expect(leadershipClaim).toBeDefined();
      expect(leadershipClaim?.supportedByEvidenceIds.length).toBe(1);
    });
  });

  describe('Grounding Auditor & Zero-Hallucination Invariant', () => {
    it('marks a legitimate evidence graph as pristine with high grounding score', () => {
      const parsed = parsePlainTextResume(SAMPLE_MARKDOWN_RESUME);
      const { evidence } = createProfileFromParsedResume(parsed);
      const claims = deriveClaimsFromEvidence(evidence);
      const graph = buildEvidenceGraph(evidence, claims);

      const report = auditEvidenceGraphGrounding(graph);

      expect(report.isPristine).toBe(true);
      expect(report.unbackedClaims.length).toBe(0);
      expect(report.brokenReferences.length).toBe(0);
      expect(report.groundingScore).toBeGreaterThanOrEqual(0.8);
      expect(report.warnings.length).toBe(0);
    });

    it('detects unbacked claims and flags potential hallucinations', () => {
      const parsed = parsePlainTextResume(SAMPLE_MARKDOWN_RESUME);
      const { evidence } = createProfileFromParsedResume(parsed);
      const validClaims = deriveClaimsFromEvidence(evidence);

      // Inject an unbacked hallucinated claim (0 supporting evidence)
      const hallucinatedClaim: CandidateClaim = {
        id: createClaimId(),
        statement: 'Expert in Quantum Cryptography and Aerospace Engineering',
        claimType: 'skill_proficiency',
        supportedByEvidenceIds: [],
        confidence: 0.0,
        tags: ['Quantum Cryptography'],
        createdAt: new Date().toISOString(),
      };

      const claimsWithHallucination = [...validClaims, hallucinatedClaim];
      const graph = buildEvidenceGraph(evidence, claimsWithHallucination);

      const report = auditEvidenceGraphGrounding(graph);

      expect(report.isPristine).toBe(false);
      expect(report.unbackedClaims.length).toBe(1);
      expect(report.unbackedClaims[0]?.statement).toContain('Quantum Cryptography');
      expect(report.warnings.some((w) => w.includes('zero supporting evidence'))).toBe(true);
    });

    it('detects broken evidence references pointing to non-existent evidence IDs', () => {
      const fakeEvId = createEvidenceId();
      const brokenClaim: CandidateClaim = {
        id: createClaimId(),
        statement: 'Experienced with Machine Learning pipelines',
        claimType: 'skill_proficiency',
        supportedByEvidenceIds: [fakeEvId],
        confidence: 0.8,
        tags: ['Machine Learning'],
        createdAt: new Date().toISOString(),
      };

      const emptyGraph = buildEvidenceGraph([], [brokenClaim]);
      const report = auditEvidenceGraphGrounding(emptyGraph);

      expect(report.isPristine).toBe(false);
      expect(report.brokenReferences.length).toBe(1);
      expect(report.brokenReferences[0]?.missingEvidenceId).toBe(fakeEvId);
      expect(report.warnings.some((w) => w.includes('non-existent evidence'))).toBe(true);
    });
  });

  describe('Em-Dash & Advanced Resume Format Parsing', () => {
    const REALISTIC_RESUME = `Jephter Olamiposi Olaifa
jephterolaifa@gmail.com  |  github.com/jephter-olamiposi  |  linkedin.com/in/jephter-olaifa  |  dev.to/iamjephter

SKILLS
Languages: Rust, TypeScript, JavaScript, Python
Frameworks: Axum, Tokio, Node.js, Express, NestJS, React
Databases: PostgreSQL, SurrealDB, Redis
Infrastructure & Tools: AWS, Docker, Kubernetes, CI/CD, GitHub Actions

WORK EXPERIENCE
Software Engineer — CoreServe — Rust
Feb 2026 – Aug 2026
* Engineered a production-grade multi-tenant backend for logistics platform using Rust, Axum, and PostgreSQL.
* Designed transaction-safe wallet, billing, and settlement workflows.

Backend Engineer — GeoResinStore
Mar 2025 – Feb 2026
* Architected a modular e-commerce backend using Node.js and PostgreSQL.

PERSONAL PROJECTS
* wsblast (Rust) — Built a high-performance WebSocket load-testing CLI with zero allocations.
* Echo (Rust, Tauri, SQLite) — Built a cross-platform clipboard synchronization engine.

EDUCATION
Ladoke Akintola University of Technology — BSc, Information Systems
`;

    it('correctly parses em-dash experiences, bulleted projects, and education', () => {
      const parsed = parsePlainTextResume(REALISTIC_RESUME);

      expect(parsed.identity.fullName).toBe('Jephter Olamiposi Olaifa');
      expect(parsed.identity.email).toBe('jephterolaifa@gmail.com');
      expect(parsed.identity.links.github).toBe('https://github.com/jephter-olamiposi');
      expect(parsed.identity.links.linkedin).toBe('https://linkedin.com/in/jephter-olaifa');
      expect(parsed.identity.links.portfolio).toBe('https://dev.to/iamjephter');

      expect(parsed.experiences.length).toBe(2);
      expect(parsed.experiences[0]?.title).toBe('Software Engineer');
      expect(parsed.experiences[0]?.company).toBe('CoreServe');
      expect(parsed.experiences[0]?.startDate).toBe('2026-02');
      expect(parsed.experiences[0]?.endDate).toBe('2026-08');
      expect(parsed.experiences[0]?.highlights.length).toBe(2);

      expect(parsed.experiences[1]?.title).toBe('Backend Engineer');
      expect(parsed.experiences[1]?.company).toBe('GeoResinStore');
      expect(parsed.experiences[1]?.startDate).toBe('2025-03');
      expect(parsed.experiences[1]?.endDate).toBe('2026-02');

      expect(parsed.projects.length).toBe(2);
      expect(parsed.projects[0]?.title).toBe('wsblast (Rust)');
      expect(parsed.projects[0]?.description).toContain('WebSocket load-testing CLI');
      expect(parsed.projects[1]?.title).toBe('Echo (Rust, Tauri, SQLite)');

      expect(parsed.education.length).toBe(1);
      expect(parsed.education[0]?.institution).toBe('Ladoke Akintola University of Technology');
      expect(parsed.education[0]?.degree).toBe('BSc');
      expect(parsed.education[0]?.fieldOfStudy).toBe('Information Systems');

      expect(parsed.skills).toContain('Rust');
      expect(parsed.skills).toContain('AWS');
      expect(parsed.skills).not.toContain('Infrastructure & Tools: AWS');
    });
  });
});
