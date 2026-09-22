/**
 * @fileoverview Deterministic Competency Synonym & Alias Dictionary.
 *
 * Normalizes technical skills and professional competencies to canonical identifiers,
 * resolving colloquial variations (e.g., 'React' vs 'React.js', 'K8s' vs 'Kubernetes')
 * without requiring external LLM queries or incurring network latency.
 */

/**
 * Maps lowercase canonical competency identifiers to their recognized synonyms and aliases.
 */
const SYNONYM_GROUPS: readonly (readonly string[])[] = [
  // Languages & Runtimes
  ['typescript', 'ts'],
  ['javascript', 'js', 'ecmascript'],
  ['python', 'py', 'python3'],
  ['golang', 'go'],
  ['csharp', 'c#', '.net', 'dotnet'],
  ['cpp', 'c++'],
  ['rust', 'rustlang'],
  ['ruby', 'rails', 'ruby on rails'],
  ['java'],
  ['php'],
  ['swift'],
  ['kotlin'],

  // Frontend Frameworks & Libraries
  ['react', 'reactjs', 'react.js'],
  ['nextjs', 'next.js'],
  ['vue', 'vuejs', 'vue.js'],
  ['angular', 'angularjs', 'angular.js'],
  ['svelte', 'sveltekit'],
  ['tailwind', 'tailwindcss'],
  ['html', 'html5'],
  ['css', 'css3'],

  // Backend & APIs
  ['node', 'nodejs', 'node.js'],
  ['express', 'expressjs', 'express.js'],
  ['graphql', 'gql'],
  ['rest', 'restful', 'rest api', 'restful api', 'restful apis'],
  ['grpc', 'protobuf'],

  // Databases & Caches
  ['postgresql', 'postgres'],
  ['mongodb', 'mongo'],
  ['mysql'],
  ['redis'],
  ['elasticsearch', 'elastic search', 'es'],
  ['sql'],
  ['nosql'],

  // Cloud & DevOps
  ['kubernetes', 'k8s'],
  ['docker', 'containerization', 'containers'],
  ['aws', 'amazon web services'],
  ['gcp', 'google cloud', 'google cloud platform'],
  ['azure', 'microsoft azure'],
  ['terraform', 'iac', 'infrastructure as code'],
  ['cicd', 'ci/cd', 'continuous integration', 'continuous deployment'],

  // Architecture & Engineering Practices
  ['microservices', 'distributed systems'],
  ['tdd', 'test driven development', 'unit testing'],
  ['agile', 'scrum'],
];

/**
 * Bi-directional lookup map from any normalized alias/synonym to its canonical cluster.
 */
const ALIAS_TO_CLUSTER = new Map<string, ReadonlySet<string>>();

for (const group of SYNONYM_GROUPS) {
  const normalizedGroup = group.map((item) => normalizeCompetencyToken(item));
  const clusterSet = new Set<string>(normalizedGroup);
  for (const item of normalizedGroup) {
    ALIAS_TO_CLUSTER.set(item, clusterSet);
  }
}

/**
 * Normalizes a raw competency or skill string into a standardized comparison token.
 *
 * Preserves essential technical characters like '+' in 'c++' and '#' in 'c#',
 * while stripping standard punctuation, extra whitespace, and casing differences.
 *
 * @param text Raw skill name, requirement text, or acronym.
 * @returns Cleaned, lowercase token for matching.
 */
export function normalizeCompetencyToken(text: string): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .trim()
    // Convert hyphens and slashes to spaces unless part of specific tokens
    .replace(/[/\\_-]+/g, ' ')
    // Remove characters that do not form technical tokens (preserving letters, digits, '.', '+', '#')
    .replace(/[^a-z0-9.+ #]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Retrieves all recognized synonymous variations for a given competency.
 *
 * @param competency Skill or competency name (e.g. 'k8s' or 'Kubernetes').
 * @returns Set of normalized synonyms including the input itself.
 */
export function getCompetencySynonyms(competency: string): ReadonlySet<string> {
  const normalized = normalizeCompetencyToken(competency);
  if (!normalized) return new Set();

  const cluster = ALIAS_TO_CLUSTER.get(normalized);
  if (cluster) return cluster;

  // Fallback to singleton set for unregistered competencies
  return new Set([normalized]);
}

/**
 * Evaluates whether two competency descriptions refer to the same technical capability.
 *
 * Checks exact match, normalized token equality, and synonym cluster membership.
 *
 * @param a First competency name.
 * @param b Second competency name.
 * @returns True if competencies represent equivalent skills.
 */
export function areCompetenciesEquivalent(a: string, b: string): boolean {
  if (!a || !b) return false;

  const normA = normalizeCompetencyToken(a);
  const normB = normalizeCompetencyToken(b);

  if (normA === normB) return true;

  const clusterA = ALIAS_TO_CLUSTER.get(normA);
  if (clusterA && clusterA.has(normB)) return true;

  const clusterB = ALIAS_TO_CLUSTER.get(normB);
  if (clusterB && clusterB.has(normA)) return true;

  return false;
}
