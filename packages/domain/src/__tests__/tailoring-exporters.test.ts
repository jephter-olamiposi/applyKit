import { describe, it, expect } from 'vitest';
import {
  exportResumeAsMarkdown,
  exportResumeAsPlainText,
  exportCoverLetterAsMarkdown,
  exportCoverLetterAsPlainText,
  createEmptyProfile,
  createProfileId,
  type TailoredResume,
  type TailoredCoverLetter,
  type CandidateProfile,
} from '../index.js';

describe('Tailoring Exporters Suite (Phase 12)', () => {
  const profile: CandidateProfile = {
    ...createEmptyProfile(createProfileId('prof_sam')),
    identity: {
      legalFirstName: 'Sam',
      legalLastName: 'Altman',
      email: 'sam@example.com',
      phone: '+1 555-0100',
      location: { city: 'San Francisco', stateOrProvince: 'CA', country: 'USA' },
      workAuthorization: { isAuthorizedInCountry: true, requiresSponsorship: false, authorizedCountries: ['USA'] },
    },
    links: {
      github: 'https://github.com/sam',
      linkedin: 'https://linkedin.com/in/sam',
      portfolio: 'https://sam.dev',
      customLinks: [],
    },
    education: [
      {
        id: 'edu_1' as any,
        institution: 'Stanford University',
        degree: 'B.S.',
        fieldOfStudy: 'Computer Science',
        startDate: '2015',
        endDate: '2019',
        isCompleted: true,
        honors: [],
        relevantCoursework: [],
        activities: [],
        evidenceRefs: [],
      },
    ],
  };

  const sampleResume: TailoredResume = {
    targetJobTitle: 'Staff Software Engineer',
    companyName: 'NextGen AI',
    tailoredSummary: 'Proven software architect with 8+ years building high scale platforms.',
    skills: {
      matchedRequired: ['TypeScript', 'Node.js', 'Distributed Systems'],
      matchedPreferred: ['Kubernetes'],
      additionalSkills: ['GraphQL', 'Redis'],
    },
    experiences: [
      {
        experienceId: 'exp_1',
        company: 'CloudVentures',
        title: 'Principal Engineer',
        startDate: '2021-01',
        isCurrent: true,
        relevanceScore: 95,
        rankedHighlights: [
          {
            text: 'Scaled core ingestion service to 20M events per second.',
            matchedRequirements: ['Distributed Systems'],
            confidenceScore: 0.95,
          },
        ],
      },
    ],
    projects: [
      {
        projectId: 'proj_1',
        title: 'AsyncWorker',
        relevanceScore: 85,
        technologiesUsed: ['TypeScript', 'Redis'],
        rankedHighlights: [
          {
            text: 'Open-source distributed task queue with over 3,000 GitHub stars.',
            matchedRequirements: ['TypeScript'],
            confidenceScore: 0.9,
          },
        ],
      },
    ],
    createdAt: '2026-03-20T10:00:00Z',
  };

  const sampleCoverLetter: TailoredCoverLetter = {
    targetJobTitle: 'Staff Software Engineer',
    companyName: 'NextGen AI',
    candidateName: 'Sam Altman',
    openingParagraph: 'I am writing to express my strong enthusiasm for the Staff Software Engineer position at NextGen AI.',
    bodyParagraphs: [
      {
        type: 'body',
        theme: 'Distributed Systems Impact',
        paragraphText: 'In my role at CloudVentures, I scaled core ingestion service to 20M events per second.',
        citedAccomplishments: [],
      },
    ],
    closingParagraph: 'Thank you for your time and consideration.\n\nSincerely,\nSam Altman',
    fullText: 'Dear Hiring Team at NextGen AI,\n\nI am writing to express my strong enthusiasm for the Staff Software Engineer position at NextGen AI.\n\nIn my role at CloudVentures, I scaled core ingestion service to 20M events per second.\n\nThank you for your time and consideration.\n\nSincerely,\nSam Altman',
    allCitations: [],
    createdAt: '2026-03-20T10:00:00Z',
  };

  it('exports resume as clean Markdown with structured sections and links', () => {
    const md = exportResumeAsMarkdown(sampleResume, profile);

    expect(md).toContain('# Sam Altman');
    expect(md).toContain('sam@example.com | +1 555-0100 | San Francisco, CA, USA');
    expect(md).toContain('[LinkedIn](https://linkedin.com/in/sam)');
    expect(md).toContain('## Professional Summary');
    expect(md).toContain('Proven software architect with 8+ years');
    expect(md).toContain('## Technical Skills');
    expect(md).toContain('Core Competencies:** TypeScript, Node.js, Distributed Systems');
    expect(md).toContain('## Professional Experience');
    expect(md).toContain('### Principal Engineer | CloudVentures');
    expect(md).toContain('- Scaled core ingestion service to 20M events per second.');
    expect(md).toContain('## Notable Projects');
    expect(md).toContain('### AsyncWorker');
    expect(md).toContain('## Education');
    expect(md).toContain('B.S. in Computer Science** – Stanford University (2019)');
  });

  it('exports resume as plain text suitable for ATS copy-paste', () => {
    const txt = exportResumeAsPlainText(sampleResume, profile);

    expect(txt).toContain('SAM ALTMAN');
    expect(txt).toContain('PROFESSIONAL SUMMARY');
    expect(txt).toContain('TECHNICAL SKILLS');
    expect(txt).toContain('PROFESSIONAL EXPERIENCE');
    expect(txt).toContain('NOTABLE PROJECTS');
    expect(txt).toContain('EDUCATION');
    expect(txt).toContain('* Scaled core ingestion service to 20M events per second.');
  });

  it('exports cover letter as clean Markdown', () => {
    const md = exportCoverLetterAsMarkdown(sampleCoverLetter, profile);

    expect(md).toContain('# Sam Altman');
    expect(md).toContain('**Application for:** Staff Software Engineer at NextGen AI');
    expect(md).toContain('scaled core ingestion service to 20M events per second');
  });

  it('exports cover letter as plain text', () => {
    const txt = exportCoverLetterAsPlainText(sampleCoverLetter, profile);

    expect(txt).toContain('Sam Altman');
    expect(txt).toContain('Application: Staff Software Engineer - NextGen AI');
    expect(txt).toContain('Dear Hiring Team at NextGen AI');
  });
});
