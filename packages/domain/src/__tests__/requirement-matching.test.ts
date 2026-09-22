import { describe, it, expect } from 'vitest';
import {
  createRequirementId,
  createEvidenceId,
  createClaimId,
  createSkillId,
  createProjectId,
  createExperienceId,
  createEmptyProfile,
  evaluateJobRequirements,
  areCompetenciesEquivalent,
  normalizeCompetencyToken,
  getCompetencySynonyms,
  analyzeQualificationGaps,
  generateHighlightSuggestions,
  buildEvidenceGraph,
} from '../index.js';
import type {
  Requirement,
  Evidence,
  CandidateClaim,
  CandidateProfile,
} from '../index.js';

describe('Requirement Matching & Gap Analysis Engine', () => {
  describe('Competency Synonym Dictionary', () => {
    it('normalizes tokens while preserving technical symbols (+, #)', () => {
      expect(normalizeCompetencyToken('C++')).toBe('c++');
      expect(normalizeCompetencyToken('C#')).toBe('c#');
      expect(normalizeCompetencyToken('.NET Core')).toBe('.net core');
      expect(normalizeCompetencyToken('  React.js  ')).toBe('react.js');
      expect(normalizeCompetencyToken('CI/CD')).toBe('ci cd');
    });

    it('identifies equivalent technical synonyms and aliases', () => {
      expect(areCompetenciesEquivalent('React', 'React.js')).toBe(true);
      expect(areCompetenciesEquivalent('K8s', 'Kubernetes')).toBe(true);
      expect(areCompetenciesEquivalent('TypeScript', 'TS')).toBe(true);
      expect(areCompetenciesEquivalent('Golang', 'Go')).toBe(true);
      expect(areCompetenciesEquivalent('PostgreSQL', 'Postgres')).toBe(true);
      expect(areCompetenciesEquivalent('C#', '.NET')).toBe(true);
      expect(areCompetenciesEquivalent('AWS', 'Amazon Web Services')).toBe(true);
    });

    it('distinguishes disparate technologies', () => {
      expect(areCompetenciesEquivalent('Python', 'Java')).toBe(false);
      expect(areCompetenciesEquivalent('React', 'Angular')).toBe(false);
      expect(areCompetenciesEquivalent('Docker', 'Kubernetes')).toBe(false);
    });

    it('returns synonym clusters for known competencies', () => {
      const syns = getCompetencySynonyms('react');
      expect(syns.has('react')).toBe(true);
      expect(syns.has('react.js')).toBe(true);
      expect(syns.has('reactjs')).toBe(true);
    });
  });

  describe('Multi-Tier Requirement Evaluation', () => {
    const ev1 = createEvidenceId();
    const ev2 = createEvidenceId();

    const sampleRequirements: Requirement[] = [
      {
        id: createRequirementId(),
        rawText: 'At least 5 years of TypeScript production development',
        normalizedSkillOrCompetency: 'TypeScript',
        category: 'technical_skill',
        importance: 'required',
        yearsRequired: 5,
        isRequired: true,
        matchedEvidenceIds: [],
      },
      {
        id: createRequirementId(),
        rawText: 'Hands-on experience with Kubernetes orchestration',
        normalizedSkillOrCompetency: 'Kubernetes',
        category: 'technical_skill',
        importance: 'required',
        isRequired: true,
        matchedEvidenceIds: [],
      },
      {
        id: createRequirementId(),
        rawText: 'Familiarity with GraphQL APIs is preferred',
        normalizedSkillOrCompetency: 'GraphQL',
        category: 'technical_skill',
        importance: 'preferred',
        isRequired: false,
        matchedEvidenceIds: [],
      },
      {
        id: createRequirementId(),
        rawText: 'Experience with PostgreSQL relational data modeling',
        normalizedSkillOrCompetency: 'PostgreSQL',
        category: 'technical_skill',
        importance: 'preferred',
        isRequired: false,
        matchedEvidenceIds: [],
      },
    ];

    it('matches exact skills with verified evidence at 1.0 confidence', () => {
      const profile: CandidateProfile = {
        ...createEmptyProfile(),
        skills: [
          {
            id: createSkillId(),
            name: 'TypeScript',
            normalizedName: 'typescript',
            category: 'language',
            proficiency: 'expert',
            yearsOfExperience: 6,
            evidenceRefs: [ev1],
          },
        ],
      };

      const result = evaluateJobRequirements(sampleRequirements, profile);

      const tsMatch = result.matches.find(
        (m) => m.matchedCompetency === 'TypeScript'
      );
      expect(tsMatch).toBeDefined();
      expect(tsMatch?.isMatched).toBe(true);
      expect(tsMatch?.matchTier).toBe('exact_evidence');
      expect(tsMatch?.confidenceScore).toBe(1.0);
      expect(tsMatch?.matchedEvidenceIds).toContain(ev1);
    });

    it('matches synonymous competencies (K8s -> Kubernetes) with verified evidence', () => {
      const profile: CandidateProfile = {
        ...createEmptyProfile(),
        skills: [
          {
            id: createSkillId(),
            name: 'K8s',
            normalizedName: 'k8s',
            category: 'framework',
            proficiency: 'advanced',
            yearsOfExperience: 3,
            evidenceRefs: [ev2],
          },
        ],
      };

      const result = evaluateJobRequirements(sampleRequirements, profile);

      const k8sMatch = result.matches.find(
        (m) => m.requirementId === sampleRequirements[1]?.id
      );
      expect(k8sMatch).toBeDefined();
      expect(k8sMatch?.isMatched).toBe(true);
      expect(k8sMatch?.matchTier).toBe('synonym_evidence');
      expect(k8sMatch?.confidenceScore).toBe(0.85);
    });

    it('penalizes unbacked profile skills with degraded confidence (0.65)', () => {
      const profile: CandidateProfile = {
        ...createEmptyProfile(),
        skills: [
          {
            id: createSkillId(),
            name: 'TypeScript',
            normalizedName: 'typescript',
            category: 'language',
            proficiency: 'intermediate',
            yearsOfExperience: 5,
            evidenceRefs: [], // No evidence!
          },
        ],
      };

      const result = evaluateJobRequirements(sampleRequirements, profile);
      const tsMatch = result.matches[0];
      expect(tsMatch?.isMatched).toBe(true);
      expect(tsMatch?.matchTier).toBe('exact_skill');
      expect(tsMatch?.confidenceScore).toBe(0.65);
    });

    it('flags years of experience shortfall when candidate falls below requirement', () => {
      const profile: CandidateProfile = {
        ...createEmptyProfile(),
        skills: [
          {
            id: createSkillId(),
            name: 'TypeScript',
            normalizedName: 'typescript',
            category: 'language',
            proficiency: 'intermediate',
            yearsOfExperience: 3, // Requires 5!
            evidenceRefs: [ev1],
          },
        ],
      };

      const result = evaluateJobRequirements(sampleRequirements, profile);
      const tsMatch = result.matches[0];
      expect(tsMatch?.isMatched).toBe(true);
      expect(tsMatch?.yearsShortfall).toBe(2);
      expect(tsMatch?.confidenceScore).toBeLessThan(1.0);
      expect(result.experienceShortfallsCount).toBe(1);
    });

    it('matches through candidate claims in EvidenceGraph when skills map lacks entry', () => {
      const claimEvId = createEvidenceId();
      const claim: CandidateClaim = {
        id: createClaimId(),
        statement: 'Extensive production experience designing GraphQL microservices',
        claimType: 'skill_proficiency',
        supportedByEvidenceIds: [claimEvId],
        confidence: 0.9,
        tags: ['graphql', 'api'],
        createdAt: new Date().toISOString(),
      };

      const graph = buildEvidenceGraph([], [claim]);

      const profile = createEmptyProfile();
      const result = evaluateJobRequirements(sampleRequirements, profile, graph);

      const gqlMatch = result.matches.find(
        (m) => m.requirementId === sampleRequirements[2]?.id
      );
      expect(gqlMatch).toBeDefined();
      expect(gqlMatch?.isMatched).toBe(true);
      expect(gqlMatch?.matchTier).toBe('claim_match');
      expect(gqlMatch?.matchedEvidenceIds).toContain(claimEvId);
    });
  });

  describe('Gap Analysis Engine', () => {
    const ev1 = createEvidenceId();

    const requirements: Requirement[] = [
      {
        id: createRequirementId(),
        rawText: 'Must have 5+ years of Rust systems programming experience',
        normalizedSkillOrCompetency: 'Rust',
        category: 'technical_skill',
        importance: 'required',
        yearsRequired: 5,
        isRequired: true,
        matchedEvidenceIds: [],
      },
      {
        id: createRequirementId(),
        rawText: 'Deep familiarity with Kubernetes is strongly preferred',
        normalizedSkillOrCompetency: 'Kubernetes',
        category: 'technical_skill',
        importance: 'strongly_preferred',
        isRequired: true,
        matchedEvidenceIds: [],
      },
      {
        id: createRequirementId(),
        rawText: 'Experience with Redis is a nice to have',
        normalizedSkillOrCompetency: 'Redis',
        category: 'technical_skill',
        importance: 'nice_to_have',
        isRequired: false,
        matchedEvidenceIds: [],
      },
    ];

    it('classifies missing required criteria as critical hard gaps', () => {
      const profile: CandidateProfile = {
        ...createEmptyProfile(),
        skills: [
          {
            id: createSkillId(),
            name: 'Rust',
            normalizedName: 'rust',
            category: 'language',
            proficiency: 'intermediate',
            yearsOfExperience: 2, // Shortfall
            evidenceRefs: [ev1],
          },
        ],
      };

      const matchMatrix = evaluateJobRequirements(requirements, profile);
      const gapReport = analyzeQualificationGaps(requirements, matchMatrix.matches, profile);

      expect(gapReport.totalGaps).toBeGreaterThan(0);

      // K8s is strongly preferred and missing -> moderate hard_gap
      const k8sGap = gapReport.gaps.find((g) => g.competency === 'Kubernetes');
      expect(k8sGap).toBeDefined();
      expect(k8sGap?.category).toBe('hard_gap');
      expect(k8sGap?.severity).toBe('moderate');

      // Redis is nice to have and missing -> minor soft_gap
      const redisGap = gapReport.gaps.find((g) => g.competency === 'Redis');
      expect(redisGap).toBeDefined();
      expect(redisGap?.category).toBe('soft_gap');
      expect(redisGap?.severity).toBe('minor');

      // Rust has experience shortfall (2y vs 5y) -> critical shortfall
      const rustGap = gapReport.gaps.find((g) => g.competency === 'Rust');
      expect(rustGap).toBeDefined();
      expect(rustGap?.category).toBe('experience_shortfall');
      expect(rustGap?.severity).toBe('critical');
      expect(rustGap?.candidateYears).toBe(2);
      expect(rustGap?.requiredYears).toBe(5);
    });

    it('flags unbacked claims as unsubstantiated claims', () => {
      const profile: CandidateProfile = {
        ...createEmptyProfile(),
        skills: [
          {
            id: createSkillId(),
            name: 'Rust',
            normalizedName: 'rust',
            category: 'language',
            proficiency: 'expert',
            yearsOfExperience: 5,
            evidenceRefs: [], // Zero evidence!
          },
        ],
      };

      const matchMatrix = evaluateJobRequirements(requirements, profile);
      const gapReport = analyzeQualificationGaps(requirements, matchMatrix.matches, profile);

      const unbackedGap = gapReport.gaps.find(
        (g) => g.competency === 'Rust' && g.category === 'unsubstantiated_claim'
      );
      expect(unbackedGap).toBeDefined();
      expect(unbackedGap?.severity).toBe('moderate');
      expect(unbackedGap?.explanation).toContain('lacks linked resume or document evidence');
    });
  });

  describe('Highlight Suggestion Engine', () => {
    const requirements: Requirement[] = [
      {
        id: createRequirementId(),
        rawText: 'Experience building microservices with TypeScript and Docker',
        normalizedSkillOrCompetency: 'TypeScript',
        category: 'technical_skill',
        importance: 'required',
        isRequired: true,
        matchedEvidenceIds: [],
      },
      {
        id: createRequirementId(),
        rawText: 'Docker containerization proficiency',
        normalizedSkillOrCompetency: 'Docker',
        category: 'technical_skill',
        importance: 'required',
        isRequired: true,
        matchedEvidenceIds: [],
      },
      {
        id: createRequirementId(),
        rawText: 'PostgreSQL database optimization',
        normalizedSkillOrCompetency: 'PostgreSQL',
        category: 'technical_skill',
        importance: 'preferred',
        isRequired: false,
        matchedEvidenceIds: [],
      },
    ];

    it('ranks candidate projects and work experiences by alignment with requirements', () => {
      const profile: CandidateProfile = {
        ...createEmptyProfile(),
        projects: [
          {
            id: createProjectId(),
            title: 'High-Throughput Gateway',
            description: 'Microservice API gateway',
            highlights: [
              'Architected TypeScript services deployed with Docker containers',
              'Integrated PostgreSQL connection pooling',
            ],
            technologiesUsed: ['TypeScript', 'Docker', 'PostgreSQL'],
            evidenceRefs: [],
          },
          {
            id: createProjectId(),
            title: 'Mobile Companion App',
            description: 'iOS application in Swift',
            highlights: ['Designed offline caching'],
            technologiesUsed: ['Swift', 'CoreData'],
            evidenceRefs: [],
          },
        ],
        experiences: [
          {
            id: createExperienceId(),
            company: 'Tech Corp',
            title: 'Senior Backend Engineer',
            employmentType: 'full_time',
            location: 'Remote',
            isRemote: true,
            startDate: '2021-01',
            isCurrent: true,
            description: 'Lead backend engineer',
            highlights: [
              'Maintained Docker deployment pipelines across all TypeScript microservices',
            ],
            technologiesUsed: ['TypeScript', 'Docker'],
            evidenceRefs: [],
          },
        ],
      };

      const suggestions = generateHighlightSuggestions(requirements, profile);

      expect(suggestions.length).toBeGreaterThan(0);

      // Top suggestion should be either the gateway project or senior backend role, not the Swift app
      const top = suggestions[0];
      expect(top?.keyCompetenciesMatched).toContain('TypeScript');
      expect(top?.keyCompetenciesMatched).toContain('Docker');
      expect(top?.relevanceScore).toBeGreaterThanOrEqual(50);
      expect(top?.recommendedFocusBullets.length).toBeGreaterThan(0);

      // Swift app should not rank at the top
      const swiftSuggestion = suggestions.find((s) => s.title === 'Mobile Companion App');
      expect(swiftSuggestion).toBeUndefined(); // Touches 0 matching requirements
    });
  });
});
