import { describe, it, expect } from 'vitest';
import {
  buildJobExtractionPrompt,
  buildRequirementMatchingPrompt,
  buildFieldAnsweringPrompt,
  buildResumeTailoringPrompt,
  buildCoverLetterPrompt,
  cleanJsonText,
  parseAndValidateJsonResponse,
  type JobExtractionContext,
  type RequirementMatchingContext,
  type FieldAnsweringContext,
  type ResumeTailoringContext,
  type CoverLetterContext,
  createRequirementId,
  createClaimId,
  createSkillId,
  createExperienceId,
  createProjectId,
  createSavedAnswerId,
} from '../index.js';

describe('AI Context Builders & Schema Validation Suite (Phase 5)', () => {
  describe('buildJobExtractionPrompt', () => {
    it('wraps untrusted webpage content in strict XML delimiters and strips scripts', () => {
      const dirtyHtml = `
        <h1>Staff Systems Engineer</h1>
        <script>window.__exfiltrate(document.cookie);</script>
        <p>Requirements: 5+ years of Rust and distributed systems experience.</p>
      `;

      const context: JobExtractionContext = {
        rawHtmlOrText: dirtyHtml,
        pageUrl: 'https://careers.example.com/job/123',
        pageTitle: 'Staff Systems Engineer',
      };

      const request = buildJobExtractionPrompt(context);

      expect(request.contextType).toBe('job_extraction');
      expect(request.systemPrompt).toContain('CRITICAL SAFETY DIRECTIVE');
      expect(request.systemPrompt).toContain('<untrusted_*>');
      expect(request.prompt).toContain('<untrusted_job_content>');
      expect(request.prompt).toContain('</untrusted_job_content>');
      expect(request.prompt).not.toContain('<script>');
      expect(request.prompt).not.toContain('window.__exfiltrate');
      expect(request.prompt).toContain('5+ years of Rust');
    });
  });

  describe('buildRequirementMatchingPrompt', () => {
    it('enforces factual non-hallucination directive and formats claims', () => {
      const context: RequirementMatchingContext = {
        jobTitle: 'Senior Backend Engineer',
        companyName: 'Acme Corp',
        requirements: [
          {
            id: createRequirementId(),
            rawText: 'Must have at least 4 years of Go experience.',
            normalizedSkillOrCompetency: 'go',
            category: 'technical_skill',
            importance: 'required',
            yearsRequired: 4,
            isRequired: true,
            matchedEvidenceIds: [],
          },
        ],
        candidateSkills: [
          {
            id: createSkillId(),
            name: 'Go',
            normalizedName: 'go',
            category: 'language',
            proficiency: 'expert',
            yearsOfExperience: 5,
            evidenceRefs: [],
          },
        ],
        candidateClaims: [
          {
            id: createClaimId('clm_go'),
            statement: 'Architected high-throughput Go ingestion pipeline handling 100k req/s.',
            claimType: 'skill_proficiency',
            supportedByEvidenceIds: [],
            confidence: 0.95,
            tags: ['Go'],
            createdAt: new Date().toISOString(),
          },
        ],
        relevantExperienceHighlights: [
          'Scaled Go services to 100k req/s at CloudScale.',
        ],
      };

      const request = buildRequirementMatchingPrompt(context);

      expect(request.contextType).toBe('requirement_matching');
      expect(request.systemPrompt).toContain('CRITICAL FACTUAL INVARIANT');
      expect(request.systemPrompt).toContain('Do NOT invent, assume, or hallucinate');
      expect(request.prompt).toContain('Must have at least 4 years of Go experience');
      expect(request.prompt).toContain('Architected high-throughput Go ingestion pipeline');
      expect(request.prompt).toContain('Scaled Go services to 100k req/s');
    });
  });

  describe('buildFieldAnsweringPrompt', () => {
    it('wraps field label and scopes strictly to relevant answers and claims', () => {
      const context: FieldAnsweringContext = {
        fieldLabel: 'Are you legally authorized to work in the United States?',
        fieldType: 'radio',
        options: [
          { label: 'Yes', value: 'yes' },
          { label: 'No', value: 'no' },
        ],
        relevantAnswers: [
          {
            id: createSavedAnswerId(),
            canonicalKey: 'work_auth:us_citizen',
            promptPatterns: ['authorized to work in the united states'],
            answerText: 'Yes, I am a US citizen authorized to work indefinitely without sponsorship.',
            category: 'work_authorization',
            tags: ['work_auth'],
            evidenceRefs: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        relevantClaims: [],
      };

      const request = buildFieldAnsweringPrompt(context);

      expect(request.contextType).toBe('field_answering');
      expect(request.prompt).toContain('<untrusted_field_label>');
      expect(request.prompt).toContain('Are you legally authorized to work in the United States?');
      expect(request.prompt).toContain('</untrusted_field_label>');
      expect(request.prompt).toContain('work_auth:us_citizen');
      expect(request.prompt).toContain('Yes, I am a US citizen');
      expect(request.prompt).toContain('Available Dropdown Options');
    });
  });

  describe('buildResumeTailoringPrompt', () => {
    it('scopes target job requirements and candidate experiences for tailored output', () => {
      const context: ResumeTailoringContext = {
        targetJobTitle: 'Staff Infrastructure Engineer',
        companyName: 'Stripe',
        requirements: [
          {
            id: createRequirementId(),
            rawText: 'Expertise in Kubernetes and multi-region deployment.',
            normalizedSkillOrCompetency: 'kubernetes',
            category: 'technical_skill',
            importance: 'required',
            isRequired: true,
            matchedEvidenceIds: [],
          },
        ],
        experiences: [
          {
            id: createExperienceId(),
            company: 'Fintech Co',
            title: 'Lead Architect',
            employmentType: 'full_time',
            location: 'Remote',
            isRemote: true,
            startDate: '2020-01',
            isCurrent: true,
            description: 'Infrastructure lead',
            highlights: ['Designed multi-region Kubernetes clusters across 3 AWS regions.'],
            technologiesUsed: ['Kubernetes', 'AWS'],
            evidenceRefs: [],
          },
        ],
        projects: [
          {
            id: createProjectId(),
            title: 'KubeDeploy',
            description: 'Automated Kubernetes operator',
            highlights: ['Used by 2,000 developers'],
            technologiesUsed: ['Go', 'Kubernetes'],
            evidenceRefs: [],
          },
        ],
        skills: [],
      };

      const request = buildResumeTailoringPrompt(context);

      expect(request.contextType).toBe('resume_tailoring');
      expect(request.prompt).toContain('Role: Staff Infrastructure Engineer');
      expect(request.prompt).toContain('Company: Stripe');
      expect(request.prompt).toContain('Expertise in Kubernetes and multi-region deployment');
      expect(request.prompt).toContain('Fintech Co');
      expect(request.prompt).toContain('KubeDeploy');
    });
  });

  describe('buildCoverLetterPrompt', () => {
    it('scopes target role, verified skills, and accomplishment bullets with prompt injection defense', () => {
      const context: CoverLetterContext = {
        targetJobTitle: 'Staff Backend Architect',
        companyName: 'ScaleGrid',
        candidateName: 'Jordan Lee',
        requirements: [
          {
            id: createRequirementId(),
            rawText: 'Deep expertise in event-driven systems and Kafka',
            normalizedSkillOrCompetency: 'kafka',
            category: 'technical_skill',
            importance: 'required',
            isRequired: true,
            matchedEvidenceIds: [],
          },
        ],
        candidateSkills: [
          {
            id: createSkillId(),
            name: 'Kafka',
            normalizedName: 'kafka',
            category: 'architecture_pattern',
            proficiency: 'expert',
            yearsOfExperience: 5,
            evidenceRefs: [],
          },
        ],
        verifiedAccomplishments: [
          'Architected Kafka streaming pipeline processing 100M+ events/day with 99.99% uptime.',
        ],
      };

      const request = buildCoverLetterPrompt(context);

      expect(request.contextType).toBe('cover_letter');
      expect(request.systemPrompt).toContain('expert executive cover letter writer');
      expect(request.prompt).toContain('<target_role>');
      expect(request.prompt).toContain('Staff Backend Architect');
      expect(request.prompt).toContain('</target_role>');
      expect(request.prompt).toContain('<company_name>');
      expect(request.prompt).toContain('ScaleGrid');
      expect(request.prompt).toContain('</company_name>');
      expect(request.prompt).toContain('Jordan Lee');
      expect(request.prompt).toContain('Kafka');
      expect(request.prompt).toContain('100M+ events/day');
    });
  });

  describe('cleanJsonText & parseAndValidateJsonResponse', () => {
    it('strips markdown code blocks and handles trailing commas', () => {
      const rawWithFences = '```json\n{\n  "title": "Lead Engineer",\n  "skills": ["Rust", "TypeScript",],\n}\n```';
      const result = parseAndValidateJsonResponse<{ title: string; skills: string[] }>(rawWithFences);

      expect(result.success).toBe(true);
      expect(result.data?.title).toBe('Lead Engineer');
      expect(result.data?.skills).toEqual(['Rust', 'TypeScript']);
    });

    it('extracts embedded JSON surrounded by conversational preamble and postscript', () => {
      const conversationalOutput = `
        Certainly! Here is the structured evaluation you requested:

        {
          "score": 92,
          "recommendation": "strong_hire"
        }

        Let me know if you need any additional clarification!
      `;

      const result = parseAndValidateJsonResponse<{ score: number; recommendation: string }>(
        conversationalOutput
      );

      expect(result.success).toBe(true);
      expect(result.data?.score).toBe(92);
      expect(result.data?.recommendation).toBe('strong_hire');
    });

    it('enforces schema validator guard and returns error on invalid structure', () => {
      const validJsonWrongSchema = '{"name": "Alice"}';

      const validator = (data: unknown): boolean => {
        return typeof data === 'object' && data !== null && 'role' in data;
      };

      const result = parseAndValidateJsonResponse(validJsonWrongSchema, validator);

      expect(result.success).toBe(false);
      expect(result.error).toContain('failed schema validation');
    });

    it('returns clear error on malformed unparseable text', () => {
      const malformed = 'Not valid JSON at all: { unclosed';
      const result = parseAndValidateJsonResponse(malformed);

      expect(result.success).toBe(false);
      expect(result.error).toContain('JSON parsing failed');
    });
  });
});
