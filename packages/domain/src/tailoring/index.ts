/**
 * @fileoverview Public entry point for the domain tailoring subsystem.
 *
 * Provides dynamic resume section selection, evidence-grounded cover letter generation,
 * fact-checking verification, clean Markdown/plain-text exporters, and the 14-Point
 * Resume Golden Standard audit & template engine (ADR-0004, ADR-0026).
 */

export * from './tailoring-types.js';
export * from './resume-tailorer.js';
export * from './cover-letter-generator.js';
export * from './fact-checker.js';
export * from './exporters.js';
export * from './resume-rules.js';

