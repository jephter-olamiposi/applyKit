import { describe, it, expect } from 'vitest';
import {
  detectInterviewInvite,
} from '../application/email-detector.js';
import {
  createApplicationRecord,
  createApplicationId,
  createJobPostingId,
  createProfileId,
} from '../index.js';

describe('Email & Interview Invite Auto-Detector for Kanban CRM', () => {
  const sampleApps = [
    createApplicationRecord({
      id: createApplicationId('app_canonical'),
      candidateProfileId: createProfileId('prof_1'),
      jobPostingId: createJobPostingId('job_1'),
      companyName: 'Canonical',
      jobTitle: 'Distributed Systems Engineer',
      jobPostingUrl: 'https://canonical.com/careers/4581200',
    }),
    createApplicationRecord({
      id: createApplicationId('app_stripe'),
      candidateProfileId: createProfileId('prof_1'),
      jobPostingId: createJobPostingId('job_2'),
      companyName: 'Stripe',
      jobTitle: 'Backend Engineer',
      jobPostingUrl: 'https://stripe.com/jobs/1234',
    }),
  ];

  it('detects Canonical technical interview invite and extracts Calendly link', () => {
    const email = {
      subject: 'Canonical Interview Invitation: Distributed Systems Engineer',
      sender: 'recruiting@canonical.com',
      bodyText: `
        Hi Morgan,
        We were impressed with your background in distributed systems and Go.
        We would like to invite you to a technical interview with our engineering team.
        Please use the link below to schedule time:
        https://calendly.com/canonical-talent/systems-technical-interview
        Looking forward to speaking!
      `,
    };

    const detection = detectInterviewInvite(email, sampleApps);

    expect(detection.isInterviewInvite).toBe(true);
    expect(detection.confidenceScore).toBeGreaterThanOrEqual(0.85);
    expect(detection.matchedApplicationId).toBe('app_canonical');
    expect(detection.companyName).toBe('Canonical');
    expect(detection.interviewType).toBe('technical');
    expect(detection.schedulingUrl).toBe('https://calendly.com/canonical-talent/systems-technical-interview');
    expect(detection.recruiterNotesSnippet).toContain('https://calendly.com');
  });

  it('detects introductory phone screen with Greenhouse scheduling link', () => {
    const email = {
      subject: 'Next Steps: Stripe Backend Engineer Application',
      sender: 'no-reply@greenhouse-mail.io',
      bodyText: `
        Hello Alex,
        Thank you for applying to Stripe. We would like to schedule an introductory phone screen.
        Please pick a time that works for you:
        https://app.greenhouse.io/interviews/schedule/abc123xyz
      `,
    };

    const detection = detectInterviewInvite(email, sampleApps);

    expect(detection.isInterviewInvite).toBe(true);
    expect(detection.matchedApplicationId).toBe('app_stripe');
    expect(detection.interviewType).toBe('phone_screen');
    expect(detection.schedulingUrl).toBe('https://app.greenhouse.io/interviews/schedule/abc123xyz');
  });

  it('gracefully ignores standard marketing or newsletter emails', () => {
    const email = {
      subject: 'Weekly Tech Digest: What is new in Linux 6.8',
      sender: 'newsletter@techdigest.io',
      bodyText: 'Here are the latest updates on the Linux kernel and open source...',
    };

    const detection = detectInterviewInvite(email, sampleApps);

    expect(detection.isInterviewInvite).toBe(false);
    expect(detection.confidenceScore).toBe(0);
    expect(detection.matchedApplicationId).toBeUndefined();
  });
});
