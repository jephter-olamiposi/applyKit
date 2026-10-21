import type { SkillId, EvidenceId } from '../types/ids.js';

/**
 * Technical, organizational, and domain skill taxonomies.
 */
export type SkillCategory =
  | 'language'
  | 'framework'
  | 'library'
  | 'database'
  | 'cloud_infrastructure'
  | 'devops_tool'
  | 'architecture_pattern'
  | 'testing_qa'
  | 'methodology'
  | 'soft_skill'
  | 'domain_expertise';

/**
 * Assessed level of skill mastery.
 */
export type SkillProficiency =
  | 'beginner'
  | 'intermediate'
  | 'advanced'
  | 'expert';

/**
 * A discrete technical capability or qualification held by the candidate.
 */
export interface CandidateSkill {
  readonly id: SkillId;
  readonly name: string;
  /** Normalized lowercase alphanumeric key for semantic matching (e.g. 'typescript', 'react', 'postgresql'). */
  readonly normalizedName: string;
  readonly category: SkillCategory;
  readonly proficiency: SkillProficiency;
  readonly yearsOfExperience?: number;
  readonly lastUsedYear?: number;
  /** References to supporting evidence proving practical usage of this skill. */
  readonly evidenceRefs: readonly EvidenceId[];
}

/**
 * Normalizes a raw skill string for canonical indexing and deterministic matching.
 * Strips punctuation (dots, hyphens, underscores) and whitespace, converting to lowercase.
 *
 * Example: "Node.js" -> "nodejs", "React-Native" -> "reactnative".
 */
export function normalizeSkillName(name: string): string {
  if (!name) return '';
  return name
    .toLowerCase()
    .trim()
    .replace(/[.\-_]/g, '')
    .replace(/\s+/g, '');
}

/**
 * Categorizes a technical skill or competency into a canonical taxonomy domain.
 *
 * Uses structural pattern matching against standard software engineering categories
 * without binding to individual candidates or specific organizational frameworks.
 *
 * @param name Skill or technology token to classify.
 * @returns Canonical SkillCategory.
 */
export function categorizeSkill(name: string): SkillCategory {
  const lower = name.toLowerCase().trim();
  if (!lower) return 'domain_expertise';

  if (
    /^(?:typescript|javascript|python|rust|go|golang|java|c\+\+|c#|c\b|ruby|php|swift|kotlin|sql|html|css|bash|shell|zsh|solidity|elixir|scala|haskell|r\b|lua|dart|perl)$/i.test(lower) ||
    /(?:scripting|programming\s+languages?)$/i.test(lower)
  ) {
    return 'language';
  }
  if (
    /^(?:react|react\.?js|react-native|vue|vue\.?js|angular|svelte|next\.?js|nuxt|express|express\.?js|nestjs|django|flask|fastapi|spring|spring\s+boot|rails|ruby\s+on\s+rails|axum|tokio|actix|grpc|graphql|apollo|egui|tauri|redux|zustand|tailwind|tailwindcss|electron|bootstrap)$/i.test(lower)
  ) {
    return 'framework';
  }
  if (
    /^(?:postgres|postgresql|mysql|mongodb|redis|cassandra|dynamodb|sqlite|elasticsearch|surrealdb|mariadb|couchdb|cockroachdb|prisma|sqlx|typeorm|drizzle|supabase|firestore)$/i.test(lower) ||
    /databases?|storage|caching/i.test(lower)
  ) {
    return 'database';
  }
  if (
    /^(?:aws|gcp|google\s+cloud|azure|docker|kubernetes|k8s|terraform|ci\/cd|linux|serverless|nginx|prometheus|grafana|datadog|helm|cloudflare|ansible|pulumi|lambda)$/i.test(lower) ||
    /infrastructure|cloud|devops/i.test(lower)
  ) {
    return 'cloud_infrastructure';
  }
  if (
    /^(?:git|github|gitlab|github\s+actions|jira|webpack|vite|vitest|jest|cypress|playwright|cargo|npm|yarn|pnpm|circleci)$/i.test(lower)
  ) {
    return 'devops_tool';
  }
  if (
    /^(?:system\s+design|distributed\s+systems|microservices|event-driven(?:\s+architecture)?|domain-driven(?:\s+design)?|rest|restful(?:\s+apis)?|high\s+concurrency|concurrency|multithreading|websockets?|pub\/sub|message\s+queues?|kafka|rabbitmq|observability|financial\s+systems|idempotency|signaling)$/i.test(lower) ||
    /architecture|distributed/i.test(lower)
  ) {
    return 'architecture_pattern';
  }
  if (
    /^(?:unit\s+testing|integration\s+testing|load\s+testing|e2e\s+testing|tdd|bdd|qa\s+automation|performance\s+testing)$/i.test(lower)
  ) {
    return 'testing_qa';
  }

  return 'domain_expertise';
}
