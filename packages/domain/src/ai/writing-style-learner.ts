import type { WritingStyleProfile } from './writing-style.js';
import { extractWritingFeatures, DEFAULT_WRITING_STYLE } from './writing-style.js';
import type { CandidateProfile } from '../candidate/profile.js';

export interface LearnedStyleFeatures {
  readonly avgSentenceLength: number;
  readonly technicalTermDensity: number;
  readonly firstPersonFrequency: number;
  readonly passiveVoiceFrequency: number;
  readonly hedgeWordFrequency: number;
  readonly corporatePhraseFrequency: number;
  readonly transitionWordFrequency: number;
  readonly emDashFrequency: number;
  readonly colonFrequency: number;
  readonly bulletPointFrequency: number;
  readonly headingFrequency: number;
  readonly vocabulary: readonly string[];
  readonly personalPhrases: readonly string[];
  readonly engineeringDescriptions: readonly string[];
  readonly sampleCount: number;
}

const COMMON_ENGINEERING_TERMS = new Set([
  'backend', 'frontend', 'fullstack', 'api', 'database', 'server', 'client',
  'async', 'await', 'promise', 'callback', 'interface', 'type', 'class',
  'function', 'module', 'package', 'library', 'framework', 'runtime',
  'compiler', 'garbage', 'memory', 'thread', 'process', 'network',
  'protocol', 'http', 'tcp', 'udp', 'dns', 'ssl', 'tls', 'auth', 'oauth',
  'jwt', 'token', 'hash', 'encrypt', 'decrypt', 'serialize', 'deserialize',
  'parse', 'validate', 'transform', 'pipeline', 'queue', 'stream', 'buffer',
  'cache', 'index', 'query', 'schema', 'migration', 'deploy', 'ci', 'cd',
  'docker', 'kubernetes', 'terraform', 'ansible', 'monitor', 'log', 'metric',
  'alert', 'trace', 'span', 'latency', 'throughput', 'bandwidth', 'reliability',
  'availability', 'consistency', 'partition', 'replica', 'leader', 'follower',
  'consensus', 'raft', 'paxos', 'distributed', 'systems', 'microservices',
  'monolith', 'scalability', 'performance', 'optimization', 'debugging',
  'testing', 'unit', 'integration', 'e2e', 'tdd', 'refactoring', 'legacy',
  'technical debt', 'code review', 'pair programming', 'agile', 'scrum',
  'kanban', 'sprint', 'retrospective', 'planning', 'estimation',
]);

const COMMON_CORPORATE_WORDS = new Set([
  'leverage', 'synergy', 'optimize', 'facilitate', 'orchestrate', 'drive',
  'deliver', 'execute', 'implement', 'strategize', 'align', 'collaborate',
  'stakeholder', 'deliverable', 'milestone', 'roadmap', 'initiative',
  'best practice', 'cutting edge', 'state of the art', 'industry standard',
  'proven track record', 'extensive experience', 'solid background',
  'passionate about', 'excited to', 'thrilled to', 'eager to',
  'deep dive', 'holistic', 'end-to-end', 'cross-functional', 'robust',
  'scalable', 'seamless', 'world-class', 'top-tier', 'best-in-class',
]);



function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 2);
}





export function getWritingStyleFromProfile(profile: CandidateProfile): WritingStyleProfile {
  if ((profile as any).writingStyle) {
    return (profile as any).writingStyle;
  }

  const professional = profile.professional;
  const experiences = (professional as any).experiences ?? [];
  const projects = (professional as any).projects ?? [];

  const resumeText = [
    professional.headline,
    ...experiences.flatMap((e: any) => [e.title, e.company, ...(e.highlights ?? [])]),
    ...projects.flatMap((p: any) => [p.name, p.description, ...(p.highlights ?? [])]),
    ...profile.skills.map(s => s.name),
  ].filter(Boolean).join(' ');

  if (!resumeText.trim()) {
    return DEFAULT_WRITING_STYLE;
  }

  const features = extractWritingFeatures(resumeText);
  
  return {
    ...DEFAULT_WRITING_STYLE,
    sentenceLength: features.avgSentenceLength < 12 ? 'short' : features.avgSentenceLength > 25 ? 'long' : 'medium',
    technicalDetail: features.technicalTermDensity < 0.02 ? 'minimal' : features.technicalTermDensity > 0.08 ? 'deep' : 'moderate',
    preferredVocabulary: tokenize(resumeText)
      .filter(t => COMMON_ENGINEERING_TERMS.has(t) || (t.length > 6 && !COMMON_CORPORATE_WORDS.has(t)))
      .slice(0, 50),
    avoidedVocabulary: [...COMMON_CORPORATE_WORDS]
      .filter(w => resumeText.toLowerCase().includes(w.toLowerCase()))
      .slice(0, 30),
    formality: features.corporatePhraseFrequency > 0.03 ? 'formal' : 'conversational',
    confidence: features.hedgeWordFrequency > 0.06 ? 'measured' : 'direct',
    personalPhrases: [],
    engineeringDescriptions: [],
    sampleCount: 0,
    lastUpdated: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };
}