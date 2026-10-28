import { describe, it, expect } from 'vitest';
import { parsePlainTextResume, parseRoleHeader } from '../evidence/parser.js';
import { formatDegree } from '../tailoring/display-format.js';

const COMMA_LAYOUT = `Boluwatife Olaifa
Lagos, Nigeria | bolu@example.com | +234 801 234 5678

EXPERIENCE
Senior Backend Engineer, Kuda Lite (Lagos) | Jan 2023 - Present
- Built a double-entry ledger service in Go and PostgreSQL handling 1.2M transactions per day
- Cut payout reconciliation time from 6 hours to 40 minutes by moving batch jobs to Kafka consumers
Backend Engineer, CareLink Health | Mar 2020 - Dec 2022
- Designed REST and gRPC APIs in Go for appointment booking used by 40 clinics

PROJECTS
StatusHD - React Native app for posting HD media to WhatsApp Status
Medical Scribe - Local-first Tauri desktop app for clinical note taking

SKILLS
Go, PostgreSQL, Kafka, React Native

EDUCATION
B.Tech Computer Science, LAUTECH, 2025
`;

const MIXED_LAYOUT = `Ada Okafor
Abuja, Nigeria | ada@mail.com

EXPERIENCE
Flutterwave | Software Engineer II | Remote | Jun 2021 - Present
- Built settlement APIs in Java and Spring Boot
- Go to market support for 3 launches
Product Engineer at Paystack
Jan 2019 - May 2021
- Shipped checkout features in React and Node.js
Andela
Backend Developer
2017 - 2018
- Wrote Python services with Django

EDUCATION
University of Lagos
B.Sc. in Computer Science
2016
Bachelor of Science in Mathematics, University of California, Berkeley, 2014
`;

describe('Resume layouts seen in real CVs', () => {
  it('splits "Title, Company (City) | dates" into title, employer, and location', () => {
    const parsed = parsePlainTextResume(COMMA_LAYOUT);
    expect(parsed.experiences.map((e) => [e.title, e.company, e.location])).toEqual([
      ['Senior Backend Engineer', 'Kuda Lite', 'Lagos'],
      ['Backend Engineer', 'CareLink Health', undefined],
    ]);
    expect(parsed.experiences[0]?.startDate).toBe('2023-01');
    expect(parsed.experiences[0]?.isCurrent).toBe(true);
  });

  it('keeps every one-line project and does not credit React for React Native', () => {
    const parsed = parsePlainTextResume(COMMA_LAYOUT);
    expect(parsed.projects.map((p) => p.title)).toEqual(['StatusHD', 'Medical Scribe']);
    expect(parsed.projects[0]?.technologiesUsed).toEqual(['React Native']);
    expect(parsed.skills).not.toContain('React');
  });

  it('reads comma-separated Nigerian degrees without inventing a field or school', () => {
    const parsed = parsePlainTextResume(COMMA_LAYOUT);
    expect(parsed.education).toEqual([
      { institution: 'LAUTECH', degree: 'B.Tech', fieldOfStudy: 'Computer Science', graduationDate: '2025-05' },
    ]);
  });

  it('handles company-first, "at", and stacked layouts in one resume', () => {
    const parsed = parsePlainTextResume(MIXED_LAYOUT);
    expect(parsed.experiences.map((e) => [e.title, e.company])).toEqual([
      ['Software Engineer II', 'Flutterwave'],
      ['Product Engineer', 'Paystack'],
      ['Backend Developer', 'Andela'],
    ]);
    expect(parsed.experiences[0]?.location).toBe('Remote');
    expect(parsed.experiences[1]?.highlights).toEqual(['Shipped checkout features in React and Node.js']);
  });

  it('does not read the verb "go" as the Go language', () => {
    const parsed = parsePlainTextResume(MIXED_LAYOUT);
    expect(parsed.experiences[0]?.technologiesUsed).not.toContain('Go');
  });

  it('merges stacked education lines and keeps multi-part school names', () => {
    const parsed = parsePlainTextResume(MIXED_LAYOUT);
    expect(parsed.education[0]).toMatchObject({ institution: 'University of Lagos', degree: 'B.Sc.', fieldOfStudy: 'Computer Science' });
    expect(parsed.education[1]).toMatchObject({
      institution: 'University of California, Berkeley',
      degree: 'Bachelor of Science',
      fieldOfStudy: 'Mathematics',
    });
  });

  it('never fills unknown header parts with placeholders', () => {
    expect(parseRoleHeader(['Staff Engineer'])).toEqual({ title: 'Staff Engineer', company: '', location: undefined, dateText: undefined });
    const parsed = parsePlainTextResume('Jane Doe\nEDUCATION\nUniversity of Ibadan\n');
    expect(parsed.education[0]).toEqual({ institution: 'University of Ibadan', degree: '', fieldOfStudy: '' });
  });

  it('formats degree lines without repeating the subject', () => {
    expect(formatDegree({ degree: 'B.S. in Computer Science', fieldOfStudy: 'Computer Science' })).toBe('B.S. in Computer Science');
    expect(formatDegree({ degree: 'B.Tech', fieldOfStudy: 'Computer Science' })).toBe('B.Tech in Computer Science');
    expect(formatDegree({ degree: '', fieldOfStudy: 'Mathematics' })).toBe('Mathematics');
  });
});
