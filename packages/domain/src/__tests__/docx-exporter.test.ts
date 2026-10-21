import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import {
  generateResumeDocxBlob,
  generateCoverLetterDocxBlob,
  getStandardResumeFilename,
  createEmptyProfile,
  createProfileId,
  type TailoredResume,
  type TailoredCoverLetter,
  type CandidateProfile,
  type ResumeTemplateId,
} from '../index.js';

describe('DOCX Resume & Cover Letter Exporter Suite (ADR-0043, SKILL.md)', () => {
  const sampleProfile: CandidateProfile = {
    ...createEmptyProfile(createProfileId('prof_jephter')),
    identity: {
      legalFirstName: 'Jephter',
      legalLastName: 'Olaifa',
      email: 'jephter@example.com',
      phone: '+1 555-0199',
      location: { city: 'Lagos', country: 'Nigeria' },
      workAuthorization: { isAuthorizedInCountry: true, requiresSponsorship: false, authorizedCountries: ['NG'] },
    },
    links: {
      github: 'https://github.com/jephter',
      linkedin: 'https://linkedin.com/in/jephter',
      portfolio: 'https://jephter.dev',
      customLinks: [],
    },
    education: [
      {
        id: 'edu_1' as any,
        institution: 'University of Lagos',
        degree: 'Bachelor of Science',
        fieldOfStudy: 'Computer Science',
        startDate: '2016-09',
        endDate: '2020-07',
        isCompleted: true,
        honors: ['First Class'],
        relevantCoursework: [],
        activities: [],
        evidenceRefs: [],
      },
    ],
  };

  const sampleResume: TailoredResume = {
    targetJobTitle: 'Staff Backend Engineer',
    companyName: 'HyperScale Corp',
    tailoredSummary:
      'Staff Backend Engineer with 8+ years specializing in distributed systems, high-concurrency event pipelines, and cloud database architectures. Proven record scaling payments settlement infrastructure to 50,000 TPS.',
    skills: {
      domainCategories: [
        {
          category: 'Languages',
          skills: ['Rust', 'TypeScript', 'Go', 'Python'],
        },
        {
          category: 'Databases & Storage',
          skills: ['PostgreSQL', 'SurrealDB', 'Redis'],
        },
        {
          category: 'Architecture & Systems',
          skills: ['Distributed Systems', 'Event-Driven Microservices', 'High Concurrency'],
        },
      ],
      matchedRequired: ['Rust', 'PostgreSQL', 'Distributed Systems'],
      matchedPreferred: ['SurrealDB'],
      additionalSkills: ['Docker', 'Kubernetes'],
    },
    experiences: [
      {
        experienceId: 'exp_1',
        company: 'CoreServe Global',
        title: 'Senior Distributed Systems Engineer',
        startDate: '2021-03',
        endDate: '2025-12',
        isCurrent: false,
        relevanceScore: 98,
        rankedHighlights: [
          {
            text: 'Architected distributed event settlement pipeline processing 50k transactions/sec with zero loss.',
            matchedRequirements: ['Distributed Systems', 'PostgreSQL'],
            confidenceScore: 0.99,
          },
          {
            text: 'Engineered idempotent ledger synchronization service reducing reconciliation drift by 99.4%.',
            matchedRequirements: ['Rust'],
            confidenceScore: 0.95,
          },
        ],
      },
    ],
    projects: [
      {
        projectId: 'proj_1',
        title: 'DistributedQueueEngine',
        role: 'Creator & Maintainer',
        relevanceScore: 92,
        technologiesUsed: ['Rust', 'Tokio', 'Redis'],
        rankedHighlights: [
          {
            text: 'Published open-source Raft consensus queue used in production across 40+ organizations.',
            matchedRequirements: ['Rust'],
            confidenceScore: 0.94,
          },
        ],
      },
    ],
    createdAt: new Date().toISOString(),
  };

  const sampleCoverLetter: TailoredCoverLetter = {
    targetJobTitle: 'Staff Backend Engineer',
    companyName: 'HyperScale Corp',
    candidateName: 'Jephter Olaifa',
    openingParagraph:
      'I am writing to express my enthusiastic interest in the Staff Backend Engineer position at HyperScale Corp.',
    bodyParagraphs: [
      {
        type: 'body',
        theme: 'Distributed Systems Scale',
        paragraphText:
          'At CoreServe Global, I designed transaction-safe settlement workflows processing 50k transactions per second with sub-50ms p99 latency.',
        citedAccomplishments: [],
      },
    ],
    closingParagraph: 'Thank you for your consideration.\n\nSincerely,\nJephter Olaifa',
    fullText: 'Dear Hiring Team...',
    allCitations: [],
    createdAt: new Date().toISOString(),
  };

  describe('getStandardResumeFilename (SKILL.md line 126)', () => {
    it('formats filename with Firstname_Lastname_Resume.docx', () => {
      const filename = getStandardResumeFilename(sampleProfile, 'docx');
      expect(filename).toBe('Jephter_Olaifa_Resume.docx');
    });

    it('formats filename with PreferredName when available', () => {
      const profileWithPreferred = {
        ...sampleProfile,
        identity: {
          ...sampleProfile.identity,
          preferredName: 'Jeff Olaifa',
        },
      };
      const filename = getStandardResumeFilename(profileWithPreferred, 'docx');
      expect(filename).toBe('Jeff_Olaifa_Resume.docx');
    });

    it('falls back to Resume.docx when profile is undefined', () => {
      expect(getStandardResumeFilename(undefined, 'docx')).toBe('Resume.docx');
    });
  });

  describe('generateResumeDocxBlob', () => {
    const templates: ResumeTemplateId[] = ['modern', 'classic', 'minimalist', 'compact'];

    for (const templateId of templates) {
      it(`generates valid DOCX blob for template: ${templateId}`, async () => {
        const blob = await generateResumeDocxBlob(sampleResume, sampleProfile, { templateId });

        expect(blob).toBeDefined();
        expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        expect(blob.size).toBeGreaterThan(8000);

        // Verify OpenXML internal structure by unzipping word/document.xml
        const arrayBuffer = await blob.arrayBuffer();
        const zip = await JSZip.loadAsync(arrayBuffer);
        const documentXml = await zip.file('word/document.xml')?.async('string');

        expect(documentXml).toBeDefined();
        expect(documentXml).toContain('Jephter Olaifa');
        expect(documentXml).not.toContain('Tailored for Staff Backend Engineer');
        expect(documentXml).toContain('PROFESSIONAL SUMMARY');
        expect(documentXml).toContain('TECHNICAL SKILLS');
        expect(documentXml).toContain('Languages:');
        expect(documentXml).toContain('Rust');
        expect(documentXml).toContain('WORK EXPERIENCE');
        expect(documentXml).toContain('CoreServe Global');
        expect(documentXml).toContain('Senior Distributed Systems Engineer');
        expect(documentXml).toContain('NOTABLE PROJECTS');
        expect(documentXml).toContain('DistributedQueueEngine');
        expect(documentXml).toContain('EDUCATION');
        expect(documentXml).toContain('University of Lagos');
      });
    }

    it('supports onePageFit budgeting and badge toggling', async () => {
      const blob = await generateResumeDocxBlob(sampleResume, sampleProfile, {
        templateId: 'compact',
        onePageFit: true,
        showTargetBadge: false,
      });

      expect(blob.size).toBeGreaterThan(5000);
      const arrayBuffer = await blob.arrayBuffer();
      const zip = await JSZip.loadAsync(arrayBuffer);
      const documentXml = await zip.file('word/document.xml')?.async('string');

      expect(documentXml).not.toContain('Tailored for Staff Backend Engineer');
    });
  });

  describe('generateCoverLetterDocxBlob', () => {
    it('generates valid DOCX blob for tailored cover letter', async () => {
      const blob = await generateCoverLetterDocxBlob(sampleCoverLetter, sampleProfile);

      expect(blob).toBeDefined();
      expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      expect(blob.size).toBeGreaterThan(8000);

      const arrayBuffer = await blob.arrayBuffer();
      const zip = await JSZip.loadAsync(arrayBuffer);
      const documentXml = await zip.file('word/document.xml')?.async('string');

      expect(documentXml).toContain('Jephter Olaifa');
      expect(documentXml).toContain('HyperScale Corp');
      expect(documentXml).toContain('Dear Hiring Team');
      expect(documentXml).toContain('CoreServe Global');
    });
  });
});
