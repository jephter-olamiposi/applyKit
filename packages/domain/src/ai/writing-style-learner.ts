import type { WritingStyleProfile, WritingSample, WritingStyleFeatures } from './writing-style.js';
import type { WritingStyleProfileId, WritingSampleId } from '../types/ids.js';
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

const PERSONAL_PHRASE_PATTERNS = [
    /\b(I (tend to|like to|prefer to|usually|often|typically|generally|mostly|frequently|rarely|never|always)\s+\w+)/gi,
    /\b(the (hard|difficult|challenging|tricky|interesting|key|main|core|real) part (is|was|wasn't|was not))/gi,
    /\b(what (matters|worked|didn't work|works|doesn't work))/gi,
    /\b(in my experience|from what I've seen|what I've found)/gi,
];

const ENGINEERING_DESCRIPTION_PATTERNS = [
    /\b(I (worked on|built|designed|implemented|architected|developed|created|maintained|optimized|debugged|refactored|rewrote|migrated|deployed|launched|shipped)\s+.{5,80})/gi,
    /\b(the (system|service|application|platform|framework|library|tool|pipeline|infrastructure|architecture) (I|we) (built|designed|maintained|scaled|optimized|refactored))/gi,
];

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 2);
}

function extractNgrams(text: string, n: number): string[] {
  const tokens = tokenize(text);
  const ngrams: string[] = [];
  for (let i = 0; i <= tokens.length - n; i++) {
    ngrams.push(tokens.slice(i, i + n).join(' '));
  }
  return ngrams;
}

function findPersonalPhrases(text: string): string[] {
  const phrases: string[] = [];
  for (const pattern of PERSONAL_PHRASE_PATTERNS) {
    const matches = text.match(pattern);
    if (matches) {
      phrases.push(...matches.map(m => m.trim()));
    }
  }
  return [...new Set(phrases)].slice(0, 20);
}

function findEngineeringDescriptions(text: string): string[] {
  const phrases: string[] = [];
  for (const pattern of ENGINEERING_DESCRIPTION_PATTERNS) {
    const matches = text.match(pattern);
    if (matches) {
      phrases.push(...matches.map(m => m.trim()));
    }
  }
  return [...new Set(phrases)].slice(0, 20);
}

function extractVocabulary(text: string, existingVocab: Set<string>): string[] {
  const tokens = tokenize(text);
  const bigrams = extractNgrams(text, 2);
  const trigrams = extractNgrams(text, 3);
  
  const vocab = new Set<string>([...existingVocab]);
  
  for (const token of tokens) {
    if (COMMON_ENGINEERING_TERMS.has(token) || 
        token.length > 6 && !COMMON_CORPORATE_WORDS.has(token)) {
      vocab.add(token);
    }
  }
  
  for (const bigram of bigrams) {
    if (!COMMON_CORPORATE_WORDS.has(bigram)) {
      vocab.add(bigram);
    }
  }
  
  for (const trigram of trigrams) {
    if (!COMMON_CORPORATE_WORDS.has(trigram)) {
      vocab.add(trigram);
    }
  }
  
  return [...vocab].slice(0, 100);
}

export function learnWritingStyle(
  samples: readonly WritingSample[],
  currentProfile?: WritingStyleProfile
): WritingStyleProfile {
  if (samples.length === 0) {
    return currentProfile ?? DEFAULT_WRITING_STYLE;
  }

  const userProvidedSamples = samples.filter(s => 
    s.context === 'user_provided' || s.context === 'edited_ai'
  );
  
  const allSamples = userProvidedSamples.length > 0 ? userProvidedSamples : samples;

  const combinedText = allSamples.map(s => s.text).join(' ');
  const features = extractWritingFeatures(combinedText);
  const personalPhrases = findPersonalPhrases(combinedText);
  const engineeringDescriptions = findEngineeringDescriptions(combinedText);
  const vocabulary = extractVocabulary(combinedText, new Set(currentProfile?.preferredVocabulary ?? []));

  let sentenceLength: 'short' | 'medium' | 'long' | 'varied' = 'medium';
  if (features.avgSentenceLength < 12) sentenceLength = 'short';
  else if (features.avgSentenceLength > 25) sentenceLength = 'long';
  else if (features.avgSentenceLength > 18) sentenceLength = 'varied';

  let technicalDetail: 'minimal' | 'moderate' | 'deep' = 'moderate';
  if (features.technicalTermDensity < 0.02) technicalDetail = 'minimal';
  else if (features.technicalTermDensity > 0.08) technicalDetail = 'deep';

  let formality: 'casual' | 'conversational' | 'professional' | 'formal' = 'conversational';
  if (features.firstPersonFrequency > 0.08 && features.corporatePhraseFrequency < 0.01) {
    formality = 'casual';
  } else if (features.corporatePhraseFrequency > 0.03 || features.passiveVoiceFrequency > 0.4) {
    formality = 'formal';
  } else if (features.firstPersonFrequency > 0.05) {
    formality = 'conversational';
  } else {
    formality = 'professional';
  }

  let confidence: 'measured' | 'confident' | 'direct' = 'direct';
  if (features.hedgeWordFrequency > 0.06) confidence = 'measured';
  else if (features.firstPersonFrequency > 0.06 && features.hedgeWordFrequency < 0.03) {
    confidence = 'confident';
  }

  const avoidedVocabulary = [...COMMON_CORPORATE_WORDS]
    .filter(w => combinedText.toLowerCase().includes(w.toLowerCase()))
    .slice(0, 30);

  const now = new Date().toISOString();
  const base = currentProfile ?? DEFAULT_WRITING_STYLE;

  return {
    ...base,
    sentenceLength,
    technicalDetail,
    preferredVocabulary: vocabulary,
    avoidedVocabulary,
    formality,
    confidence,
    answerLengthPreference: base.answerLengthPreference,
    personalPhrases: [...new Set([...base.personalPhrases, ...personalPhrases])].slice(0, 20),
    engineeringDescriptions: [...new Set([...base.engineeringDescriptions, ...engineeringDescriptions])].slice(0, 20),
    sampleCount: allSamples.length,
    lastUpdated: now,
    createdAt: base.createdAt,
  };
}

export function createWritingSample(
  id: WritingSampleId,
  text: string,
  context: WritingSample['context'],
  sourceQuestion?: string
): WritingSample {
  return {
    id,
    text: text.trim(),
    context,
    sourceQuestion,
    createdAt: new Date().toISOString(),
  };
}

export function updateWritingStyleFromEdit(
  originalAIAnswer: string,
  userEditedAnswer: string,
  currentProfile: WritingStyleProfile,
  sourceQuestion?: string
): { profile: WritingStyleProfile; sample: WritingSample } {
  const sample = createWritingSample(
    'sample_' + Date.now() as any,
    userEditedAnswer,
    'edited_ai',
    sourceQuestion
  );

  const newProfile = learnWritingStyle([sample, ...[]], currentProfile);
  
  return { profile: newProfile, sample };
}

export function updateWritingStyleFromUserAnswer(
  userAnswer: string,
  currentProfile: WritingStyleProfile,
  sourceQuestion?: string
): { profile: WritingStyleProfile; sample: WritingSample } {
  const sample = createWritingSample(
    'sample_' + Date.now() as any,
    userAnswer,
    'user_provided',
    sourceQuestion
  );

  const newProfile = learnWritingStyle([sample], currentProfile);
  
  return { profile: newProfile, sample };
}

export function mergeWritingProfiles(
  profileA: WritingStyleProfile,
  profileB: WritingStyleProfile
): WritingStyleProfile {
  const allSamples = profileA.sampleCount + profileB.sampleCount;
  const weightA = profileA.sampleCount / allSamples;
  const weightB = profileB.sampleCount / allSamples;

  return {
    id: profileA.id,
    sentenceLength: weightA > weightB ? profileA.sentenceLength : profileB.sentenceLength,
    technicalDetail: weightA > weightB ? profileA.technicalDetail : profileB.technicalDetail,
    preferredVocabulary: [...new Set([...profileA.preferredVocabulary, ...profileB.preferredVocabulary])].slice(0, 100),
    avoidedVocabulary: [...new Set([...profileA.avoidedVocabulary, ...profileB.avoidedVocabulary])].slice(0, 50),
    formality: weightA > weightB ? profileA.formality : profileB.formality,
    confidence: weightA > weightB ? profileA.confidence : profileB.confidence,
    answerLengthPreference: weightA > weightB ? profileA.answerLengthPreference : profileB.answerLengthPreference,
    personalPhrases: [...new Set([...profileA.personalPhrases, ...profileB.personalPhrases])].slice(0, 20),
    engineeringDescriptions: [...new Set([...profileA.engineeringDescriptions, ...profileB.engineeringDescriptions])].slice(0, 20),
    sampleCount: allSamples,
    lastUpdated: new Date().toISOString(),
    createdAt: profileA.createdAt < profileB.createdAt ? profileA.createdAt : profileB.createdAt,
  };
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