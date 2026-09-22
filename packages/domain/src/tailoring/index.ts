/**
 * @fileoverview Public entry point for the domain tailoring subsystem.
 *
 * Provides dynamic resume section selection, evidence-grounded cover letter generation,
 * fact-checking verification, and clean Markdown/plain-text exporters (ADR-0004).
 */

export * from './tailoring-types.js';
export * from './resume-tailorer.js';
export * from './cover-letter-generator.js';
export * from './fact-checker.js';
export * from './exporters.js';
