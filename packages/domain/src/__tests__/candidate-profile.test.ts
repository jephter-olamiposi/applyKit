import { describe, it, expect } from 'vitest';
import {
  createEmptyProfile,
  validateProfile,
  getFullName,
  getPreferredOrLegalName,
  normalizeSkillName,
  findLinkForLabel,
  matchSavedAnswer,
  createSavedAnswerId,
} from '../index.js';

describe('CandidateProfile Subsystem', () => {
  it('creates an empty profile with default structure', () => {
    const profile = createEmptyProfile();
    expect(profile.version).toBe(1);
    expect(profile.identity.legalFirstName).toBe('');
    expect(profile.experiences).toHaveLength(0);
    expect(profile.skills).toHaveLength(0);
  });

  it('validates required identity fields and flags missing data', () => {
    const profile = createEmptyProfile();
    const result = validateProfile(profile);
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain('Legal first name is required.');
    expect(result.errors).toContain('Legal last name is required.');
    expect(result.errors).toContain('A valid email address is required.');
  });

  it('passes validation when minimal required fields are populated', () => {
    const profile = {
      ...createEmptyProfile(),
      identity: {
        legalFirstName: 'Alex',
        legalLastName: 'Chen',
        email: 'alex@example.com',
        phone: '+1 555-0199',
        location: {
          city: 'San Francisco',
          country: 'United States',
        },
        workAuthorization: {
          isAuthorizedInCountry: true,
          requiresSponsorship: false,
          authorizedCountries: ['US'],
        },
      },
    };

    const result = validateProfile(profile);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('resolves preferred name over legal name when available', () => {
    const identity = {
      legalFirstName: 'Alexander',
      legalLastName: 'Chen',
      preferredName: 'Alex',
      email: 'alex@example.com',
      phone: '555-1234',
      location: { city: 'SF', country: 'US' },
      workAuthorization: { isAuthorizedInCountry: true, requiresSponsorship: false, authorizedCountries: ['US'] },
    };

    expect(getFullName(identity)).toBe('Alexander Chen');
    expect(getPreferredOrLegalName(identity)).toBe('Alex Chen');
  });

  it('normalizes skill names consistently for semantic matching', () => {
    expect(normalizeSkillName('Node.js')).toBe('nodejs');
    expect(normalizeSkillName('TypeScript')).toBe('typescript');
    expect(normalizeSkillName('PostgreSQL ')).toBe('postgresql');
    expect(normalizeSkillName('React-Native')).toBe('reactnative');
  });

  it('matches profile links by label', () => {
    const links = {
      github: 'https://github.com/alexchen',
      linkedin: 'https://linkedin.com/in/alexchen',
      portfolio: 'https://alexchen.dev',
      customLinks: [{ label: 'Substack', url: 'https://alexchen.substack.com' }],
    };

    expect(findLinkForLabel(links, 'GitHub Profile')).toBe('https://github.com/alexchen');
    expect(findLinkForLabel(links, 'LinkedIn')).toBe('https://linkedin.com/in/alexchen');
    expect(findLinkForLabel(links, 'Personal Website')).toBe('https://alexchen.dev');
    expect(findLinkForLabel(links, 'Substack')).toBe('https://alexchen.substack.com');
  });

  it('matches saved answers based on prompt patterns', () => {
    const savedAnswers = [
      {
        id: createSavedAnswerId(),
        canonicalKey: 'work_auth:us',
        promptPatterns: ['authorized to work', 'legal authorization'],
        answerText: 'Yes, I am a US citizen and authorized to work indefinitely.',
        category: 'work_authorization' as const,
        tags: ['work_auth'],
        evidenceRefs: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    const matched = matchSavedAnswer(savedAnswers, 'Are you legally authorized to work in the US?');
    expect(matched).toBeDefined();
    expect(matched?.answerText).toBe('Yes, I am a US citizen and authorized to work indefinitely.');
  });
});
