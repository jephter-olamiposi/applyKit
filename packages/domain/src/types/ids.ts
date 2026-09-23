/**
 * Generates a standard RFC 4122 v4 UUID.
 * Uses Web Crypto API when available; falls back to pseudo-random substitution in legacy test environments.
 */
function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

declare const __brand: unique symbol;

/**
 * Nominal type branding helper.
 * Enforces compile-time type safety preventing accidental substitution between distinct entity identifiers
 * (e.g., passing a JobPostingId where a ProfileId is expected).
 */
export type Brand<T, B extends string> = T & { readonly [__brand]: B };

/** Unique identifier for a CandidateProfile aggregate. */
export type ProfileId = Brand<string, 'ProfileId'>;

/** Unique identifier for an individual WorkExperience entry. */
export type ExperienceId = Brand<string, 'ExperienceId'>;

/** Unique identifier for a CandidateProject entry. */
export type ProjectId = Brand<string, 'ProjectId'>;

/** Unique identifier for an EducationRecord entry. */
export type EducationId = Brand<string, 'EducationId'>;

/** Unique identifier for a CandidateSkill entry. */
export type SkillId = Brand<string, 'SkillId'>;

/** Unique identifier for an uploaded or referenced Document. */
export type DocumentId = Brand<string, 'DocumentId'>;

/** Unique identifier for a canonical SavedAnswer entry. */
export type SavedAnswerId = Brand<string, 'SavedAnswerId'>;

/** Unique identifier for an atomic Evidence unit. */
export type EvidenceId = Brand<string, 'EvidenceId'>;

/** Unique identifier for a verified CandidateClaim. */
export type ClaimId = Brand<string, 'ClaimId'>;

/** Unique identifier for an extracted JobPosting. */
export type JobPostingId = Brand<string, 'JobPostingId'>;

/** Unique identifier for a normalized job Requirement. */
export type RequirementId = Brand<string, 'RequirementId'>;

/** Unique identifier for an ApplicationRecord. */
export type ApplicationId = Brand<string, 'ApplicationId'>;

/** Unique identifier for a detected ApplicationField in a form. */
export type FieldId = Brand<string, 'FieldId'>;

/** Unique identifier for a planned or executed BrowserAction. */
export type ActionId = Brand<string, 'ActionId'>;

/** Unique identifier for a DryRunPlan sequence. */
export type PlanId = Brand<string, 'PlanId'>;
export type WritingStyleProfileId = Brand<string, 'WritingStyleProfileId'>;
export type WritingSampleId = Brand<string, 'WritingSampleId'>;


function sanitizeOrGenerateId(prefix: string, id?: string): string {
  if (id && id.trim().length > 0) {
    return id.trim();
  }
  return `${prefix}_${generateUUID()}`;
}

/** Creates a branded ProfileId from an existing string or generates a new prefixed UUID. */
export function createProfileId(id?: string): ProfileId {
  return sanitizeOrGenerateId('prof', id) as ProfileId;
}

/** Creates a branded ExperienceId from an existing string or generates a new prefixed UUID. */
export function createExperienceId(id?: string): ExperienceId {
  return sanitizeOrGenerateId('exp', id) as ExperienceId;
}

/** Creates a branded ProjectId from an existing string or generates a new prefixed UUID. */
export function createProjectId(id?: string): ProjectId {
  return sanitizeOrGenerateId('proj', id) as ProjectId;
}

/** Creates a branded EducationId from an existing string or generates a new prefixed UUID. */
export function createEducationId(id?: string): EducationId {
  return sanitizeOrGenerateId('edu', id) as EducationId;
}

/** Creates a branded SkillId from an existing string or generates a new prefixed UUID. */
export function createSkillId(id?: string): SkillId {
  return sanitizeOrGenerateId('sk', id) as SkillId;
}

/** Creates a branded DocumentId from an existing string or generates a new prefixed UUID. */
export function createDocumentId(id?: string): DocumentId {
  return sanitizeOrGenerateId('doc', id) as DocumentId;
}

/** Creates a branded SavedAnswerId from an existing string or generates a new prefixed UUID. */
export function createSavedAnswerId(id?: string): SavedAnswerId {
  return sanitizeOrGenerateId('ans', id) as SavedAnswerId;
}

/** Creates a branded EvidenceId from an existing string or generates a new prefixed UUID. */
export function createEvidenceId(id?: string): EvidenceId {
  return sanitizeOrGenerateId('ev', id) as EvidenceId;
}

/** Creates a branded ClaimId from an existing string or generates a new prefixed UUID. */
export function createClaimId(id?: string): ClaimId {
  return sanitizeOrGenerateId('clm', id) as ClaimId;
}

/** Creates a branded JobPostingId from an existing string or generates a new prefixed UUID. */
export function createJobPostingId(id?: string): JobPostingId {
  return sanitizeOrGenerateId('job', id) as JobPostingId;
}

/** Creates a branded RequirementId from an existing string or generates a new prefixed UUID. */
export function createRequirementId(id?: string): RequirementId {
  return sanitizeOrGenerateId('req', id) as RequirementId;
}

/** Creates a branded ApplicationId from an existing string or generates a new prefixed UUID. */
export function createApplicationId(id?: string): ApplicationId {
  return sanitizeOrGenerateId('app', id) as ApplicationId;
}

/** Creates a branded FieldId from an existing string or generates a new prefixed UUID. */
export function createFieldId(id?: string): FieldId {
  return sanitizeOrGenerateId('fld', id) as FieldId;
}

/** Creates a branded ActionId from an existing string or generates a new prefixed UUID. */
export function createActionId(id?: string): ActionId {
  return sanitizeOrGenerateId('act', id) as ActionId;
}

/** Creates a branded PlanId from an existing string or generates a new prefixed UUID. */
export function createPlanId(id?: string): PlanId {
  return sanitizeOrGenerateId('plan', id) as PlanId;
}

export function createWritingStyleProfileId(id?: string): WritingStyleProfileId {
  return sanitizeOrGenerateId('wsp', id) as WritingStyleProfileId;
}

export function createWritingSampleId(id?: string): WritingSampleId {
  return sanitizeOrGenerateId('wsa', id) as WritingSampleId;
}

