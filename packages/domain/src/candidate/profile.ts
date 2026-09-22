import type { ProfileId } from '../types/ids.js';
import { createProfileId } from '../types/ids.js';
import type { CandidateIdentity } from './identity.js';
import type { ProfessionalProfile } from './professional.js';
import type { WorkExperience } from './experience.js';
import type { CandidateProject } from './project.js';
import type { EducationRecord } from './education.js';
import type { CandidateSkill } from './skill.js';
import type { ProfileLinks } from './links.js';
import type { DocumentReference } from './document.js';
import type { SavedAnswer } from './saved-answer.js';
import type { CandidateClaim } from '../evidence/candidate-claim.js';

/**
 * Root aggregate representing the candidate's complete verified professional background.
 *
 * Invariant: The CandidateProfile and its linked EvidenceGraph represent the absolute source of truth.
 * ApplyKit strictly prohibits the AI from inventing, embellishing, or assuming credentials not
 * explicitly present in this aggregate.
 */
export interface CandidateProfile {
  readonly id: ProfileId;
  /** Monotonically increasing schema or revision number. */
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly identity: CandidateIdentity;
  readonly professional: ProfessionalProfile;
  readonly experiences: readonly WorkExperience[];
  readonly projects: readonly CandidateProject[];
  readonly education: readonly EducationRecord[];
  readonly skills: readonly CandidateSkill[];
  readonly links: ProfileLinks;
  readonly documents: readonly DocumentReference[];
  readonly savedAnswers: readonly SavedAnswer[];
  readonly claims: readonly CandidateClaim[];
}

/**
 * Creates an empty, minimally initialized CandidateProfile.
 */
export function createEmptyProfile(id?: ProfileId): CandidateProfile {
  const now = new Date().toISOString();
  return {
    id: id ?? createProfileId(),
    version: 1,
    createdAt: now,
    updatedAt: now,
    identity: {
      legalFirstName: '',
      legalLastName: '',
      email: '',
      phone: '',
      location: {
        city: '',
        country: '',
      },
      workAuthorization: {
        isAuthorizedInCountry: true,
        requiresSponsorship: false,
        authorizedCountries: [],
      },
    },
    professional: {
      headline: '',
      summary: '',
      totalYearsOfExperience: 0,
      primaryRoles: [],
      targetRoles: [],
      preferredLocations: [],
      workplacePreference: 'remote',
      isOpenToRelocation: false,
    },
    experiences: [],
    projects: [],
    education: [],
    skills: [],
    links: {
      customLinks: [],
    },
    documents: [],
    savedAnswers: [],
    claims: [],
  };
}

/**
 * Result object returned when validating a CandidateProfile.
 */
export interface ProfileValidationResult {
  readonly isValid: boolean;
  readonly errors: readonly string[];
}

/**
 * Validates that essential identity, contact, and structural invariants are satisfied.
 */
export function validateProfile(profile: CandidateProfile): ProfileValidationResult {
  const errors: string[] = [];

  if (!profile.identity.legalFirstName.trim()) {
    errors.push('Legal first name is required.');
  }
  if (!profile.identity.legalLastName.trim()) {
    errors.push('Legal last name is required.');
  }
  if (!profile.identity.email.trim() || !profile.identity.email.includes('@')) {
    errors.push('A valid email address is required.');
  }
  if (!profile.identity.phone.trim()) {
    errors.push('A contact phone number is required.');
  }
  if (!profile.identity.location.city.trim() || !profile.identity.location.country.trim()) {
    errors.push('Location city and country are required.');
  }
  if (profile.version < 1) {
    errors.push('Profile version must be a positive integer.');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}
