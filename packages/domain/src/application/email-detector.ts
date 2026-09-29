/**
 * @fileoverview Email & Interview Invite Auto-Detector for Kanban CRM.
 *
 * Parses email messages, recruiter communications, and interview invitations
 * to automatically detect interview stages, extract scheduling links, and correlate
 * them with in-progress candidate applications in IndexedDB.
 */

import type { ApplicationRecord } from './record.js';
import type { ApplicationId } from '../types/ids.js';

/**
 * Type of detected interview round.
 */
export type DetectedInterviewType =
  | 'phone_screen'
  | 'technical'
  | 'manager'
  | 'onsite'
  | 'take_home'
  | 'general';

/**
 * Structured interview invitation detection report.
 */
export interface EmailInterviewDetection {
  readonly isInterviewInvite: boolean;
  readonly confidenceScore: number;
  readonly matchedApplicationId?: ApplicationId;
  readonly companyName?: string;
  readonly jobTitle?: string;
  readonly schedulingUrl?: string;
  readonly interviewType: DetectedInterviewType;
  readonly recruiterNotesSnippet?: string;
}

/**
 * Regex patterns identifying scheduling links from major interview platforms.
 */
const SCHEDULING_URL_PATTERNS = [
  /https?:\/\/(?:www\.)?calendly\.com\/[a-zA-Z0-9_\-./]+/i,
  /https?:\/\/(?:www\.)?goodtime\.io\/[a-zA-Z0-9_\-./]+/i,
  /https?:\/\/job-boards\.greenhouse\.io\/[a-zA-Z0-9_\-./]+/i,
  /https?:\/\/app\.greenhouse\.io\/interviews\/[a-zA-Z0-9_\-./]+/i,
  /https?:\/\/jobs\.lever\.co\/[a-zA-Z0-9_\-./]+/i,
  /https?:\/\/(?:www\.)?cronofy\.com\/[a-zA-Z0-9_\-./]+/i,
  /https?:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}/i,
  /https?:\/\/(?:[a-zA-Z0-9-]+\.)?zoom\.us\/j\/[0-9]+/i,
];

/**
 * Phrasing indicating an interview invitation or scheduling request.
 */
const INVITATION_SUBJECT_PATTERNS = [
  /\b(?:invitation to interview|schedule your interview|interview invitation)\b/i,
  /\b(?:next steps|speaking with|phone screen|technical interview)\b/i,
  /\b(?:coding assessment|take-home challenge|virtual interview)\b/i,
  /\b(?:would love to chat|invitation to connect|chat about your application)\b/i,
];

const INVITATION_BODY_PATTERNS = [
  /\b(?:we would like to invite you to (?:an?|the) interview|schedule (?:a|an|some) time to speak)\b/i,
  /\b(?:please use the link below to (?:schedule|book)|pick a time that works for you)\b/i,
  /\b(?:excited to move forward with your application|next round of interviews)\b/i,
  /\b(?:congratulations on passing|technical assessment for the)\b/i,
];

/**
 * Classifies the interview round type based on message text.
 */
function classifyInterviewType(text: string): DetectedInterviewType {
  const lower = text.toLowerCase();
  if (lower.includes('technical') || lower.includes('coding') || lower.includes('system design') || lower.includes('architecture')) {
    return 'technical';
  }
  if (lower.includes('phone screen') || lower.includes('introductory call') || lower.includes('recruiter chat')) {
    return 'phone_screen';
  }
  if (lower.includes('hiring manager') || lower.includes('engineering manager') || lower.includes('team lead')) {
    return 'manager';
  }
  if (lower.includes('onsite') || lower.includes('final round') || lower.includes('panel interview')) {
    return 'onsite';
  }
  if (lower.includes('take-home') || lower.includes('assessment') || lower.includes('coding challenge')) {
    return 'take_home';
  }
  return 'general';
}

/**
 * Extracts the first recognized meeting or scheduling link from the email body.
 */
function extractSchedulingUrl(text: string): string | undefined {
  for (const pattern of SCHEDULING_URL_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      return match[0];
    }
  }
  return undefined;
}

/**
 * Parses an email subject, sender, and body to detect interview invitations,
 * extracting scheduling links and correlating the invite with tracked application records.
 *
 * @param email Subject, sender address, and body content of the email.
 * @param trackedApplications List of candidate's active application records from IndexedDB.
 * @returns Detection report with matched application and scheduling details.
 */
export function detectInterviewInvite(
  email: {
    readonly subject: string;
    readonly sender?: string;
    readonly bodyText: string;
  },
  trackedApplications: readonly ApplicationRecord[] = []
): EmailInterviewDetection {
  const combinedText = `${email.subject} ${email.sender || ''} ${email.bodyText}`;

  const subjectMatch = INVITATION_SUBJECT_PATTERNS.some((pat) => pat.test(email.subject));
  const bodyMatch = INVITATION_BODY_PATTERNS.some((pat) => pat.test(email.bodyText));
  const schedulingUrl = extractSchedulingUrl(combinedText);

  // Require at least subject/body signal or explicit scheduling URL with interview context
  if (!subjectMatch && !bodyMatch && !schedulingUrl) {
    return {
      isInterviewInvite: false,
      confidenceScore: 0,
      interviewType: 'general',
    };
  }

  const interviewType = classifyInterviewType(combinedText);
  let confidenceScore = 0.5;
  if (subjectMatch) confidenceScore += 0.25;
  if (bodyMatch) confidenceScore += 0.15;
  if (schedulingUrl) confidenceScore += 0.1;
  confidenceScore = Math.min(1.0, confidenceScore);

  // Correlate with tracked applications
  let matchedApp: ApplicationRecord | undefined;
  for (const app of trackedApplications) {
    const companyNorm = app.companyName.toLowerCase().trim();
    const titleNorm = app.jobTitle.toLowerCase().trim();

    if (companyNorm && combinedText.toLowerCase().includes(companyNorm)) {
      matchedApp = app;
      break;
    }
    if (titleNorm && combinedText.toLowerCase().includes(titleNorm)) {
      matchedApp = app;
      break;
    }
  }

  const recruiterNotesSnippet = schedulingUrl
    ? `Interview invitation detected (${interviewType}). Scheduling URL: ${schedulingUrl}`
    : `Interview invitation detected (${interviewType}).`;

  return {
    isInterviewInvite: true,
    confidenceScore,
    matchedApplicationId: matchedApp?.id,
    companyName: matchedApp?.companyName,
    jobTitle: matchedApp?.jobTitle,
    schedulingUrl,
    interviewType,
    recruiterNotesSnippet,
  };
}
