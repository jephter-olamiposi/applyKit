/**
 * @fileoverview Resumes whose bullets were wrapped by PDF text extraction.
 *
 * Text pulled from a PDF keeps its visual line breaks. Before the fix each wrapped
 * piece became its own "accomplishment", and a wrapped word such as "projects." was
 * read as the Projects heading, which swallowed the last job on the resume.
 */

import { describe, it, expect } from 'vitest';
import { parsePlainTextResume, joinWrappedBulletLines } from '../evidence/parser.js';

const WRAPPED = `Jephter Olaifa
jephter@example.com
WORK EXPERIENCE
Software Engineer — CoreServe — Rust
Feb 2026 – Aug 2026
• Engineered a production-grade, multi-tenant backend for a waste recycling and logistics platform using Rust,
Axum, Tokio, SQLx, and PostgreSQL.
• Designed transaction-safe wallet, billing, settlement, and payout workflows with maker-checker approval,
idempotent processing, cancellation lifecycles, and automated reconciliation.
Software Engineer — Freelance
Mar 2023 – Feb 2025
• Established reusable GitHub Actions CI/CD pipelines to automate testing and deployment across client
projects.
Software Engineer — B-glow Creations
Aug 2022 – Feb 2023
• Built a fashion e-commerce website in React.
PERSONAL PROJECTS
• wsblast (Rust) — Built a WebSocket load-testing CLI with lock-
free latency histograms.
EDUCATION
Ladoke Akintola University of Technology — BSc, Information Systems`;

describe('PDF-wrapped bullets', () => {
  it('rejoins wrapped bullets and keeps every role', () => {
    const parsed = parsePlainTextResume(WRAPPED);
    expect(parsed.experiences.map((exp) => exp.company)).toEqual(['CoreServe', 'Freelance', 'B-glow Creations']);
    expect(parsed.experiences[0]!.highlights).toEqual([
      'Engineered a production-grade, multi-tenant backend for a waste recycling and logistics platform using Rust, Axum, Tokio, SQLx, and PostgreSQL.',
      'Designed transaction-safe wallet, billing, settlement, and payout workflows with maker-checker approval, idempotent processing, cancellation lifecycles, and automated reconciliation.',
    ]);
    expect(parsed.experiences[1]!.highlights[0]).toMatch(/across client projects\.$/);
    // The stack tag is technology, not a location.
    expect(parsed.experiences[0]!.location ?? '').toBe('');
    expect(parsed.experiences[0]!.technologiesUsed).toContain('Rust');
  });

  it('keeps a hyphenated wrap as one word and leaves real paragraphs apart', () => {
    expect(joinWrappedBulletLines(['• Built lock-', 'free histograms.'])).toEqual(['• Built lock-free histograms.']);
    expect(joinWrappedBulletLines(['• Shipped the ledger.', 'Andela'])).toEqual(['• Shipped the ledger.', 'Andela']);
    expect(joinWrappedBulletLines(['• Led payments work for', 'Andela'])).toEqual(['• Led payments work for Andela']);
  });
});
