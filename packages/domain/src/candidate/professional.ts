/**
 * Workplace physical presence preferences.
 */
export type WorkplacePreference = 'remote' | 'hybrid' | 'onsite' | 'any' | 'flexible';

/**
 * Employment arrangements accepted during job sourcing.
 */
export type EmploymentPreference =
  | 'full_time'
  | 'part_time'
  | 'contract'
  | 'internship'
  | 'any';

/**
 * Seniority level targeted during job matching and resume tailoring.
 */
export type TargetSeniority = 'intern' | 'junior' | 'mid' | 'senior' | 'staff' | 'principal' | 'any';

/**
 * Target compensation structure and boundaries.
 */
export interface CompensationExpectation {
  readonly targetSalaryMin: number;
  readonly targetSalaryMax?: number;
  readonly currency: string;
  readonly period: 'hourly' | 'annual';
  readonly isNegotiable: boolean;
}

/**
 * High-level professional summary, experience metrics, and role preferences.
 */
export interface ProfessionalProfile {
  readonly headline: string;
  readonly summary: string;
  readonly currentTitle?: string;
  readonly totalYearsOfExperience: number;
  readonly primaryRoles: readonly string[];
  readonly targetRoles: readonly string[];
  /** Preferred role level; this is a targeting preference, not a claim about past titles. */
  readonly targetSeniority?: TargetSeniority;
  readonly preferredLocations: readonly string[];
  readonly workplacePreference: WorkplacePreference;
  /** Default employment arrangement used to filter sourced opportunities. */
  readonly employmentPreference?: EmploymentPreference;
  readonly compensationExpectation?: CompensationExpectation;
  readonly noticePeriodDays?: number;
  readonly earliestStartDate?: string;
  readonly isOpenToRelocation: boolean;
  readonly referralSource?: string;
}
