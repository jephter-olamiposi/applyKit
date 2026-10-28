/**
 * Physical or geographical address coordinates for candidate residency.
 */
export interface LocationInfo {
  readonly city: string;
  readonly stateOrProvince?: string;
  readonly country: string;
  readonly postalCode?: string;
  readonly addressLine1?: string;
  readonly addressLine2?: string;
}

/**
 * Legal authorization details governing the candidate's right to work.
 */
export interface WorkAuthorization {
  /** Legally authorized to work in the country of the targeted job. */
  readonly isAuthorizedInCountry: boolean;
  /** Requires employer sponsorship for visa/work permit now or in the future. */
  readonly requiresSponsorship: boolean;
  /** Specific visa classification (e.g., 'US Citizen', 'Permanent Resident', 'H-1B', 'EU Blue Card'). */
  readonly visaStatus?: string;
  /** ISO or full country names where candidate holds permanent citizenship or right to work. */
  readonly authorizedCountries: readonly string[];
  /**
   * True once the candidate has answered the authorization and sponsorship questions
   * themselves. Resume parsing cannot know these facts, so until this is set the form
   * filler leaves those questions for the candidate instead of guessing "Yes" or "No".
   */
  readonly confirmedByCandidate?: boolean;
}

/**
 * Standard self-identification demographics for compliance questionnaires (e.g. US EEO-1).
 *
 * Invariant: Demographic fields are strictly opt-in and processed locally through deterministic
 * matching rules. Under no circumstances are demographic disclosures sent to external AI providers.
 */
export interface DemographicDisclosures {
  /** Veteran status declaration for compliance reporting. */
  readonly veteranStatus?: 'veteran' | 'not_veteran' | 'decline_to_self_identify';
  /** Disability status declaration for compliance reporting. */
  readonly disabilityStatus?: 'yes_disability' | 'no_disability' | 'decline_to_self_identify';
  /** Self-declared race or ethnic identity. */
  readonly raceEthnicity?: string;
  /** Self-declared gender identity. */
  readonly gender?: string;
  /** Hispanic or Latino origin declaration. */
  readonly hispanicLatino?: boolean;
}

/**
 * Canonical legal and professional identity attributes for a candidate.
 */
export interface CandidateIdentity {
  readonly legalFirstName: string;
  /** Middle name(s), kept apart so a form's "Last name" gets only the surname. */
  readonly legalMiddleName?: string;
  readonly legalLastName: string;
  readonly preferredName?: string;
  readonly email: string;
  readonly phone: string;
  readonly location: LocationInfo;
  readonly workAuthorization: WorkAuthorization;
  readonly demographics?: DemographicDisclosures;
}

/**
 * Computes the candidate's legal full name formatted as "FirstName LastName".
 */
export function getFullName(identity: CandidateIdentity): string {
  return [identity.legalFirstName, identity.legalMiddleName, identity.legalLastName]
    .map((part) => (part ?? '').trim())
    .filter(Boolean)
    .join(' ');
}

/**
 * Computes the candidate's preferred name if populated; otherwise falls back to legal name.
 */
export function getPreferredOrLegalName(identity: CandidateIdentity): string {
  if (identity.preferredName && identity.preferredName.trim().length > 0) {
    return `${identity.preferredName} ${identity.legalLastName}`.trim();
  }
  return getFullName(identity);
}
