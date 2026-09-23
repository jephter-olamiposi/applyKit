/**
 * @applykit/domain
 *
 * Zero-dependency domain models, pure validation functions, and deterministic protocol contracts
 * for the ApplyKit job application copilot.
 */

export * from './types/ids.js';

export * from './candidate/identity.js';
export * from './candidate/professional.js';
export * from './candidate/experience.js';
export * from './candidate/project.js';
export * from './candidate/education.js';
export * from './candidate/skill.js';
export * from './candidate/links.js';
export * from './candidate/document.js';
export * from './candidate/saved-answer.js';
export * from './candidate/profile.js';

export * from './evidence/evidence-source.js';
export * from './evidence/evidence.js';
export * from './evidence/candidate-claim.js';
export * from './evidence/evidence-graph.js';
export * from './evidence/parser.js';
export * from './evidence/decomposer.js';
export * from './evidence/claims.js';
export * from './evidence/grounding.js';

export * from './job/requirement.js';
export * from './job/job-posting.js';
export * from './job/synonyms.js';
export * from './job/matching.js';
export * from './job/gap-analysis.js';
export * from './job/highlight-engine.js';

export * from './form/field-type.js';
export * from './form/canonical-fields.js';
export * from './form/application-field.js';
export * from './form/option-matcher.js';
export * from './form/form-schema.js';
export * from './form/browser-action.js';
export * from './form/dry-run.js';
export * from './form/planner.js';
export * from './form/execution.js';

export * from './application/state.js';
export * from './application/record.js';
export * from './application/audit-exporter.js';

export * from './ai/contexts.js';
export * from './ai/provider.js';
export * from './ai/sanitization.js';
export * from './ai/builders.js';
export * from './ai/validator.js';
export * from './ai/job-extraction.js';
export * from './ai/field-answering.js';
export * from './ai/writing-style.js';
export * from './ai/human-answer-pipeline.js';
export * from './ai/writing-style-learner.js';

export * from './tailoring/index.js';

