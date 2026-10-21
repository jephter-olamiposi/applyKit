/**
 * @fileoverview Unit tests for Candidate Profile YAML Adapter (profile.example.yaml compatibility).
 */

import { describe, it, expect } from 'vitest';
import {
  serializePipelineProfileYaml,
  parsePipelineProfileYaml,
} from '../candidate/pipeline-yaml-adapter.js';
import { createEmptyProfile } from '../candidate/profile.js';
import { createProfileId } from '../types/ids.js';

describe('Candidate Profile YAML Adapter Suite (profile.example.yaml)', () => {
  const sampleProfile = {
    ...createEmptyProfile(createProfileId('prof_yaml_test')),
    identity: {
      legalFirstName: 'Jane',
      legalLastName: 'Doe',
      preferredName: 'Jane',
      email: 'jane.doe@example.org',
      phone: '+1 (555) 234-5678',
      location: { city: 'Berlin', country: 'Germany' },
      workAuthorization: {
        isAuthorizedInCountry: true,
        requiresSponsorship: false,
        authorizedCountries: ['Germany', 'European Union'],
      },
    },
    professional: {
      headline: 'Staff Distributed Systems Engineer',
      summary: 'Passionate about high-throughput Go and Rust architectures.',
      currentCompany: 'Stripe',
      totalYearsOfExperience: 9,
      primaryRoles: ['Backend Engineer'],
      targetRoles: ['Staff Distributed Systems Engineer', 'Senior Infrastructure Engineer'],
      preferredLocations: ['Remote', 'UTC+1'],
      workplacePreference: 'remote' as const,
      isOpenToRelocation: false,
    },
    skills: [
      {
        id: 's1' as any,
        name: 'Go',
        normalizedName: 'go',
        category: 'language' as const,
        proficiency: 'expert' as const,
        evidenceRefs: [],
      },
      {
        id: 's2' as any,
        name: 'Rust',
        normalizedName: 'rust',
        category: 'language' as const,
        proficiency: 'expert' as const,
        evidenceRefs: [],
      },
      {
        id: 's3' as any,
        name: 'PostgreSQL',
        normalizedName: 'postgresql',
        category: 'database' as const,
        proficiency: 'advanced' as const,
        evidenceRefs: [],
      },
    ],
    claims: [
      {
        id: 'c1' as any,
        statement: 'Go: 6 years production experience',
        claimType: 'years_experience' as const,
        supportedByEvidenceIds: [],
        confidence: 0.95,
        tags: ['backend'],
        createdAt: new Date().toISOString(),
      },
    ],
    experiences: [
      {
        id: 'exp1' as any,
        company: 'Stripe',
        title: 'Staff Software Engineer',
        employmentType: 'full_time' as const,
        location: 'Remote',
        isRemote: true,
        startDate: '2021-03',
        endDate: undefined,
        isCurrent: true,
        description: 'Led core ledger engine refactoring.',
        highlights: [
          'Scaled transaction throughput by 4x.',
          'Maintained 99.999% ledger uptime across multi-region deployment.',
        ],
        technologiesUsed: ['Go', 'PostgreSQL'],
        evidenceRefs: [],
      },
    ],
    projects: [
      {
        id: 'proj1' as any,
        title: 'Distributed Raft Consensus Engine',
        description: 'Open-source Raft implementation with zero-copy snapshotting.',
        url: 'https://github.com/example/raft-engine',
        highlights: ['Benchmarked at 150k ops/sec on commodity hardware.'],
        technologiesUsed: ['Rust'],
        evidenceRefs: [],
      },
    ],
    education: [
      {
        id: 'edu1' as any,
        institution: 'Technical University of Munich',
        degree: 'Master of Science',
        fieldOfStudy: 'Computer Science',
        endDate: '2016',
        isCompleted: true,
        honors: [],
        relevantCoursework: [],
        activities: [],
        evidenceRefs: [],
      },
    ],
    links: {
      linkedin: 'https://linkedin.com/in/janedoe',
      github: 'https://github.com/janedoe',
      portfolio: 'https://janedoe.dev',
      customLinks: [],
    },
    savedAnswers: [
      {
        id: 'ans1' as any,
        canonicalKey: 'notice_period',
        promptPatterns: ['notice period'],
        answerText: '2 weeks',
        category: 'notice_period' as const,
        tags: ['availability'],
        evidenceRefs: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'ans2' as any,
        canonicalKey: 'expected_salary',
        promptPatterns: ['expected salary'],
        answerText: '$160,000 USD',
        category: 'salary_expectations' as const,
        tags: ['compensation'],
        evidenceRefs: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
  };

  it('serializes a candidate profile into valid profile.yaml format', () => {
    const yaml = serializePipelineProfileYaml(sampleProfile);

    expect(yaml).toContain('identity:');
    expect(yaml).toContain('legal_name: "Jane Doe"');
    expect(yaml).toContain('filename_stem: "Jane_Doe"');
    expect(yaml).toContain('contact_for_forms:');
    expect(yaml).toContain('email: "jane.doe@example.org"');
    expect(yaml).toContain('phone: "+1 (555) 234-5678"');
    expect(yaml).toContain('linkedin: "https://linkedin.com/in/janedoe"');
    expect(yaml).toContain('location:');
    expect(yaml).toContain('city: "Berlin"');
    expect(yaml).toContain('country: "Germany"');
    expect(yaml).toContain('preferences:');
    expect(yaml).toContain('remote_only: true');
    expect(yaml).toContain('notice_period: "2 weeks"');
    expect(yaml).toContain('compensation_ask: "$160,000 USD"');
    expect(yaml).toContain('experience:');
    expect(yaml).toContain('employer: "Stripe"');
    expect(yaml).toContain('title: "Staff Software Engineer"');
    expect(yaml).toContain('Scaled transaction throughput by 4x.');
    expect(yaml).toContain('projects:');
    expect(yaml).toContain('name: "Distributed Raft Consensus Engine"');
    expect(yaml).toContain('education:');
    expect(yaml).toContain('institution: "Technical University of Munich"');
    expect(yaml).toContain('skills:');
    expect(yaml).toContain('languages: ["Go", "Rust"]');
  });

  it('parses a profile.yaml string into a CandidateProfile aggregate with round-trip fidelity', () => {
    const yaml = serializePipelineProfileYaml(sampleProfile);
    const parsed = parsePipelineProfileYaml(yaml);

    expect(parsed.identity.legalFirstName).toBe('Jane');
    expect(parsed.identity.legalLastName).toBe('Doe');
    expect(parsed.identity.email).toBe('jane.doe@example.org');
    expect(parsed.identity.phone).toBe('+1 (555) 234-5678');
    expect(parsed.identity.location.city).toBe('Berlin');
    expect(parsed.identity.location.country).toBe('Germany');
    expect(parsed.links.linkedin).toBe('https://linkedin.com/in/janedoe');
    expect(parsed.links.github).toBe('https://github.com/janedoe');
    expect(parsed.professional.workplacePreference).toBe('remote');
    expect(parsed.experiences.length).toBe(1);
    expect(parsed.experiences[0]?.company).toBe('Stripe');
    expect(parsed.experiences[0]?.title).toBe('Staff Software Engineer');
    expect(parsed.experiences[0]?.highlights.length).toBe(2);
    expect(parsed.projects.length).toBe(1);
    expect(parsed.projects[0]?.title).toBe('Distributed Raft Consensus Engine');
    expect(parsed.education.length).toBe(1);
    expect(parsed.education[0]?.institution).toBe('Technical University of Munich');
    expect(parsed.skills.some((s) => s.name === 'Go')).toBe(true);
    expect(parsed.skills.some((s) => s.name === 'Rust')).toBe(true);
    expect(parsed.savedAnswers.some((a) => a.canonicalKey === 'notice_period' && a.answerText === '2 weeks')).toBe(true);
  });

  it('safely parses empty and minimal templates without error', () => {
    const minimalYaml = `
identity:
  legal_name: "Alex Smith"
contact_for_forms:
  email: "alex@example.org"
location:
  country: "Canada"
preferences:
  remote_only: true
`;
    const parsed = parsePipelineProfileYaml(minimalYaml);
    expect(parsed.identity.legalFirstName).toBe('Alex');
    expect(parsed.identity.legalLastName).toBe('Smith');
    expect(parsed.identity.email).toBe('alex@example.org');
    expect(parsed.identity.location.country).toBe('Canada');
    expect(parsed.professional.workplacePreference).toBe('remote');
  });

  it('preserves no work authorization and monthly experience date ranges', () => {
    const yaml = `
identity:
  legal_name: "Alex Smith"
location:
  country: "Nigeria"
  work_authorisation: "None"
experience:
  - employer: "Example"
    title: "Engineer"
    dates: "2021-03 - 2024-01"
`;

    const parsed = parsePipelineProfileYaml(yaml);

    expect(parsed.identity.workAuthorization.authorizedCountries).toEqual([]);
    expect(parsed.identity.workAuthorization.isAuthorizedInCountry).toBe(false);
    expect(parsed.experiences[0]?.startDate).toBe('2021-03');
    expect(parsed.experiences[0]?.endDate).toBe('2024-01');
    expect(parsed.experiences[0]?.isCurrent).toBe(false);
  });
});
