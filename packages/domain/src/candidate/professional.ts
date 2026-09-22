/**
 * Workplace physical presence preferences.
 */
export type WorkplacePreference = 'remote' | 'hybrid' | 'onsite' | 'flexible';

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
  readonly preferredLocations: readonly string[];
  readonly workplacePreference: WorkplacePreference;
  readonly compensationExpectation?: CompensationExpectation;
  readonly noticePeriodDays?: number;
  readonly isOpenToRelocation: boolean;
}
