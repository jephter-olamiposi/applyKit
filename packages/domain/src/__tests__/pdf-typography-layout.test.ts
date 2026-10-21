import { describe, it, expect } from 'vitest';
import {
  generateResumePdfBlob,
  generateCoverLetterPdfBlob,
  createEmptyProfile,
  createProfileId,
  type TailoredResume,
  type TailoredCoverLetter,
  type CandidateProfile,
  type ResumeTemplateId,
  type SpacingDensity,
} from '../index.js';
import { extractTextFromPdfBytes } from '../evidence/pdf-text-extractor.js';

describe('PDF Typography & Layout Anti-Collision Suite', () => {
  const sampleProfile: CandidateProfile = {
    ...createEmptyProfile(createProfileId('prof_test_engineer')),
    identity: {
      legalFirstName: 'Ada',
      legalLastName: 'Lovelace',
      email: 'ada.lovelace@analytical.engine',
      phone: '+44 20 7946 0919',
      location: { city: 'London', stateOrProvince: 'Greater London', country: 'United Kingdom' },
      workAuthorization: { isAuthorizedInCountry: true, requiresSponsorship: false, authorizedCountries: ['UK'] },
    },
    links: {
      github: 'https://github.com/lovelace',
      linkedin: 'https://linkedin.com/in/ada-lovelace',
      portfolio: 'https://ada.engineer',
      customLinks: [],
    },
    education: [
      {
        id: 'edu_1' as any,
        institution: 'University of London',
        degree: 'Master of Science',
        fieldOfStudy: 'Mathematical Sciences & Computation',
        startDate: '1840-09',
        endDate: '1843-06',
        isCompleted: true,
        honors: ['First Class Honors'],
        relevantCoursework: [],
        activities: [],
        evidenceRefs: [],
      },
    ],
  };

  const sampleResume: TailoredResume = {
    targetJobTitle: 'Principal Distributed Systems Engineer',
    companyName: 'Analytical Engines Ltd',
    tailoredSummary:
      'Pioneering computing architect with extensive experience developing algorithmic instructions, concurrent processing models, and fault-tolerant compute architectures. Proven track record delivering verified computational pipelines.',
    skills: {
      domainCategories: [
        {
          category: 'Languages',
          skills: ['Assembly', 'C++', 'Rust', 'TypeScript'],
        },
        {
          category: 'Architecture & Systems',
          skills: ['Distributed Systems', 'Algorithmic Design', 'Concurrency Control'],
        },
      ],
      matchedRequired: ['Assembly', 'Distributed Systems'],
      matchedPreferred: ['Algorithmic Design'],
      additionalSkills: ['C++', 'Rust'],
    },
    experiences: [
      {
        experienceId: 'exp_1',
        company: 'Babbage Difference Engine Works',
        title: 'Chief Algorithmic Architect & Systems Lead',
        startDate: '1842-01',
        endDate: '1848-12',
        isCurrent: false,
        relevanceScore: 98,
        rankedHighlights: [
          {
            text: 'Formulated the first published computer algorithm designed for mechanical implementation on the Analytical Engine.',
            matchedRequirements: ['Algorithmic Design'],
            confidenceScore: 0.99,
          },
          {
            text: 'Authored extensive architectural annotations demonstrating looping routines, memory cells, and conditional branch sequencing.',
            matchedRequirements: ['Distributed Systems'],
            confidenceScore: 0.95,
          },
        ],
      },
    ],
    projects: [
      {
        projectId: 'proj_1',
        title: 'Bernoulli Number Computer',
        role: 'Creator & Lead Architect',
        relevanceScore: 95,
        technologiesUsed: ['Punched Cards', 'Mechanical Gears'],
        rankedHighlights: [
          {
            text: 'Synthesized complete mathematical computation sequence to calculate seventh Bernoulli number without human intervention.',
            matchedRequirements: ['Algorithmic Design'],
            confidenceScore: 0.98,
          },
        ],
      },
    ],
    createdAt: new Date().toISOString(),
  };

  const sampleCoverLetter: TailoredCoverLetter = {
    targetJobTitle: 'Principal Distributed Systems Engineer',
    companyName: 'Analytical Engines Ltd',
    candidateName: 'Ada Lovelace',
    openingParagraph:
      'I am writing to express my profound interest in the Principal Distributed Systems Engineer position at Analytical Engines Ltd.',
    bodyParagraphs: [
      {
        type: 'body',
        theme: 'Algorithmic Mastery',
        paragraphText:
          'At Babbage Difference Engine Works, I developed comprehensive mathematical instructions and modular computational routines for next-generation hardware.',
        citedAccomplishments: [],
      },
    ],
    closingParagraph: 'Thank you for your consideration.\n\nWarm regards,\nAda Lovelace',
    fullText: 'Dear Hiring Team...',
    allCitations: [],
    createdAt: new Date().toISOString(),
  };

  const templates: ResumeTemplateId[] = ['modern', 'classic', 'minimalist', 'compact'];
  const densities: SpacingDensity[] = ['standard', 'tight', 'relaxed'];

  for (const templateId of templates) {
    it(`renders resume PDF cleanly for template: ${templateId} with valid typography`, async () => {
      const blob = await generateResumePdfBlob(sampleResume, sampleProfile, { templateId });
      expect(blob).toBeDefined();
      expect(blob.size).toBeGreaterThan(1000);

      const arrayBuffer = await blob.arrayBuffer();
      const extractedText = await extractTextFromPdfBytes(new Uint8Array(arrayBuffer));

      expect(extractedText).toContain('Ada Lovelace');
      expect(extractedText).toContain('PROFESSIONAL SUMMARY');
      expect(extractedText).toContain('TECHNICAL SKILLS');
      expect(extractedText).toContain('WORK EXPERIENCE');
      expect(extractedText).toContain('Chief Algorithmic Architect & Systems Lead');
      expect(extractedText).toContain('Babbage Difference Engine Works');
      expect(extractedText).toContain('NOTABLE PROJECTS');
      expect(extractedText).toContain('Bernoulli Number Computer');
      expect(extractedText).toContain('EDUCATION');
      expect(extractedText).toContain('University of London');
    });
  }

  for (const density of densities) {
    it(`renders resume PDF with density override: ${density}`, async () => {
      const blob = await generateResumePdfBlob(sampleResume, sampleProfile, {
        templateId: 'modern',
        density,
      });
      expect(blob.size).toBeGreaterThan(1000);
    });
  }

  it('renders tailored cover letter PDF with proper typography spacing', async () => {
    const blob = await generateCoverLetterPdfBlob(sampleCoverLetter);
    expect(blob).toBeDefined();
    expect(blob.size).toBeGreaterThan(1000);

    const arrayBuffer = await blob.arrayBuffer();
    const extractedText = await extractTextFromPdfBytes(new Uint8Array(arrayBuffer));

    expect(extractedText).toContain('Analytical Engines Ltd');
    expect(extractedText).toContain('Dear Hiring Team');
    expect(extractedText).toContain('Babbage Difference Engine Works');
    expect(extractedText).toContain('Ada Lovelace');
  });
});
