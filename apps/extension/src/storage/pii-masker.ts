/**
 * @fileoverview PII Masking and Privacy Sanitization Utilities.
 *
 * Implements deterministic redaction for candidate contact information (ADR-0005)
 * when generating diagnostic logs, export summaries, or preparing non-identity LLM contexts.
 */

import type { CandidateProfile } from '@applykit/domain';

/**
 * Masks an email address preserving only the leading initial and domain.
 * Example: "jane.doe@company.org" -> "j***@company.org"
 */
export function maskEmail(email: string): string {
  const trimmed = email.trim();
  const atIndex = trimmed.indexOf('@');
  if (atIndex <= 1) {
    return '***@***';
  }

  const username = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex);
  const firstChar = username.charAt(0);
  const lastChar = username.length > 2 ? username.charAt(username.length - 1) : '';

  return `${firstChar}***${lastChar}${domain}`;
}

/**
 * Masks a telephone number preserving only the final 4 digits.
 * Example: "+1 (555) 234-5678" -> "***-***-5678"
 */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) {
    return '***-***';
  }

  const last4 = digits.slice(-4);
  return `***-***-${last4}`;
}

/**
 * Replaces recognized PII patterns (emails, phone numbers, and SSNs) with redaction markers.
 */
export function maskPii(text: string): string {
  // Redact email addresses
  const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
  let result = text.replace(emailRegex, (matched) => maskEmail(matched));

  // Redact US/International phone numbers
  const phoneRegex = /(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g;
  result = result.replace(phoneRegex, (matched) => maskPhone(matched));

  // Redact 9-digit SSN-like patterns
  const ssnRegex = /\b\d{3}-\d{2}-\d{4}\b/g;
  result = result.replace(ssnRegex, '***-**-****');

  return result;
}

/**
 * Creates a sanitized, privacy-safe copy of a CandidateProfile for diagnostic inspection.
 */
export function maskCandidateProfileForDiagnostics(profile: CandidateProfile): Record<string, unknown> {
  return {
    id: profile.id,
    version: profile.version,
    updatedAt: profile.updatedAt,
    identity: {
      legalFirstName: profile.identity.legalFirstName.charAt(0) + '***',
      legalLastName: profile.identity.legalLastName.charAt(0) + '***',
      email: maskEmail(profile.identity.email),
      phone: maskPhone(profile.identity.phone),
      location: profile.identity.location,
      workAuthorization: profile.identity.workAuthorization,
    },
    professional: profile.professional,
    skillsCount: profile.skills.length,
    experiencesCount: profile.experiences.length,
    projectsCount: profile.projects.length,
    educationCount: profile.education.length,
    claimsCount: profile.claims.length,
  };
}
