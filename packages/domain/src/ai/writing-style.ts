import type { WritingStyleProfileId, WritingSampleId } from '../types/ids.js';

export type AnswerLength = 'short' | 'normal' | 'detailed';

export type FormalityLevel = 'casual' | 'conversational' | 'professional' | 'formal';

export type ConfidenceLevel = 'measured' | 'confident' | 'direct';

export interface WritingStyleProfile {
  readonly id: WritingStyleProfileId;
  readonly sentenceLength: 'short' | 'medium' | 'long' | 'varied';
  readonly technicalDetail: 'minimal' | 'moderate' | 'deep';
  readonly preferredVocabulary: readonly string[];
  readonly avoidedVocabulary: readonly string[];
  readonly formality: FormalityLevel;
  readonly confidence: ConfidenceLevel;
  readonly answerLengthPreference: AnswerLength;
  readonly personalPhrases: readonly string[];
  readonly engineeringDescriptions: readonly string[];
  readonly sampleCount: number;
  readonly lastUpdated: string;
  readonly createdAt: string;
}

export interface WritingSample {
  readonly id: WritingSampleId;
  readonly text: string;
  readonly context: 'application_answer' | 'cover_letter' | 'resume_bullet' | 'user_provided' | 'edited_ai';
  readonly sourceQuestion?: string;
  readonly createdAt: string;
}

export interface WritingStyleFeatures {
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
}

export const DEFAULT_WRITING_STYLE: WritingStyleProfile = {
  id: 'default' as WritingStyleProfileId,
  sentenceLength: 'medium',
  technicalDetail: 'moderate',
  preferredVocabulary: [],
  avoidedVocabulary: [],
  formality: 'conversational',
  confidence: 'direct',
  answerLengthPreference: 'normal',
  personalPhrases: [],
  engineeringDescriptions: [],
  sampleCount: 0,
  lastUpdated: new Date().toISOString(),
  createdAt: new Date().toISOString(),
};

export const FORBIDDEN_PATTERNS = [
  /I am excited to bring my expertise in/i,
  /I am passionate about leveraging/i,
  /I possess extensive expertise in/i,
  /I have a proven track record of/i,
  /cutting edge technologies/i,
  /robust and scalable solutions/i,
  /architect.*solutions/i,
  /leverage.*synergy/i,
  /drive.*results/i,
  /best practices/i,
  /deliverables/i,
  /stakeholders/i,
  /holistic approach/i,
  /deep dive/i,
  /move the needle/i,
  /game changer/i,
  /paradigm shift/i,
  /next level/i,
] as const;

export const CORPORATE_FILLER_PATTERNS = [
  /\b(in order to|due to the fact that|with respect to|in terms of|as far as.*is concerned)\b/gi,
  /\b(utilize|leverage|synergize|optimize|facilitate|orchestrate)\b/gi,
  /\b(strong passion|deep passion|excited to|thrilled to|eager to)\b/gi,
  /\b(proven track record|extensive experience|solid background|wealth of experience)\b/gi,
  /\b(cross-functional|end-to-end|best-in-class|world-class|top-tier)\b/gi,
  /\b(seamless integration|robust architecture|scalable solution)\b/gi,
] as const;

export const AI_PHRASING_PATTERNS = [
  /^I am (writing to|pleased to|excited to|delighted to)/,
  /^This (letter|response|answer) (serves to|demonstrates|highlights|showcases)/,
  /^(In conclusion|To summarize|Overall|In summary),/,
  /^Furthermore,|^Moreover,|^Additionally,|^Consequently,/,
  /—/,
  /:/,
  /^\s*[-•]\s+/m,
] as const;

export function createWritingStyleProfile(
  id: WritingStyleProfileId,
  overrides: Partial<WritingStyleProfile> = {}
): WritingStyleProfile {
  const now = new Date().toISOString();
  return {
    ...DEFAULT_WRITING_STYLE,
    id,
    ...overrides,
    createdAt: overrides.createdAt ?? now,
    lastUpdated: now,
  };
}

export function extractWritingFeatures(text: string): WritingStyleFeatures {
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const words = text.split(/\s+/).filter(w => w.length > 0);
  const avgSentenceLength = sentences.length > 0 ? words.length / sentences.length : 0;

  const technicalTerms = words.filter(w => 
    /^(api|database|server|client|async|await|promise|callback|interface|type|interface|class|function|module|package|library|framework|runtime|compiler|garbage|memory|thread|process|network|protocol|http|tcp|udp|dns|ssl|tls|auth|oauth|jwt|token|hash|encrypt|decrypt|serialize|deserialize|parse|validate|transform|pipeline|queue|stream|buffer|cache|index|query|schema|migration|deploy|ci|cd|docker|kubernetes|terraform|ansible|monitor|log|metric|alert|trace|span|latency|throughput|bandwidth|reliability|availability|consistency|partition|replica|leader|follower|consensus|raft|paxos)$/i.test(w)
  ).length;
  const technicalTermDensity = words.length > 0 ? technicalTerms / words.length : 0;

  const firstPerson = (text.match(/\b(I|my|me|mine)\b/gi) || []).length;
  const firstPersonFrequency = words.length > 0 ? firstPerson / words.length : 0;

  const passiveVoice = (text.match(/\b(was|were|been|being)\s+\w+ed\b/gi) || []).length;
  const passiveVoiceFrequency = sentences.length > 0 ? passiveVoice / sentences.length : 0;

  const hedgeWords = (text.match(/\b(maybe|perhaps|possibly|potentially|somewhat|fairly|relatively|generally|typically|usually|often|sometimes|might|could|would|should)\b/gi) || []).length;
  const hedgeWordFrequency = words.length > 0 ? hedgeWords / words.length : 0;

  const corporatePhrases = CORPORATE_FILLER_PATTERNS.reduce((count, pattern) => {
    const matches = text.match(pattern);
    return count + (matches ? matches.length : 0);
  }, 0);
  const corporatePhraseFrequency = words.length > 0 ? corporatePhrases / words.length : 0;

  const transitionWords = (text.match(/\b(however|therefore|furthermore|moreover|additionally|consequently|nevertheless|thus|hence|accordingly)\b/gi) || []).length;
  const transitionWordFrequency = sentences.length > 0 ? transitionWords / sentences.length : 0;

  const emDashCount = (text.match(/—/g) || []).length;
  const emDashFrequency = words.length > 0 ? emDashCount / words.length : 0;

  const colonCount = (text.match(/:/g) || []).length;
  const colonFrequency = words.length > 0 ? colonCount / words.length : 0;

  const bulletCount = (text.match(/^\s*[-•]\s+/gm) || []).length;
  const bulletPointFrequency = sentences.length > 0 ? bulletCount / sentences.length : 0;

  const headingCount = (text.match(/^#{1,6}\s+/gm) || []).length;
  const headingFrequency = sentences.length > 0 ? headingCount / sentences.length : 0;

  return {
    avgSentenceLength,
    technicalTermDensity,
    firstPersonFrequency,
    passiveVoiceFrequency,
    hedgeWordFrequency,
    corporatePhraseFrequency,
    transitionWordFrequency,
    emDashFrequency,
    colonFrequency,
    bulletPointFrequency,
    headingFrequency,
  };
}

export function validateWritingQuality(text: string, profile: WritingStyleProfile): {
  passed: boolean;
  violations: string[];
  suggestions: string[];
} {
  const violations: string[] = [];
  const suggestions: string[] = [];

  const features = extractWritingFeatures(text);

  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(text)) {
      violations.push(`Forbidden pattern detected: ${pattern.source}`);
    }
  }

  for (const pattern of CORPORATE_FILLER_PATTERNS) {
    if (pattern.test(text)) {
      violations.push(`Corporate filler detected: ${pattern.source}`);
    }
  }

  for (const pattern of AI_PHRASING_PATTERNS) {
    if (pattern.test(text)) {
      violations.push(`AI phrasing detected: ${pattern.source}`);
    }
  }

  if (features.emDashFrequency > 0.005) {
    violations.push('Em dashes detected — avoid as stylistic device');
  }

  if (features.colonFrequency > 0.01) {
    violations.push('Colon-based constructions detected — avoid as stylistic device');
  }

  if (features.bulletPointFrequency > 0.1) {
    violations.push('Bullet points detected in plain answer — avoid unless format requires');
  }

  if (features.headingFrequency > 0.05) {
    violations.push('Headings detected in plain answer — avoid unless format requires');
  }

  if (features.corporatePhraseFrequency > 0.02) {
    violations.push('High corporate phrase density');
  }

  if (features.passiveVoiceFrequency > 0.3) {
    violations.push('High passive voice usage');
  }

  if (features.hedgeWordFrequency > 0.05) {
    violations.push('Excessive hedging language');
  }

  if (features.transitionWordFrequency > 0.15) {
    violations.push('Excessive artificial transitions');
  }

  if (profile.avoidedVocabulary.length > 0) {
    for (const avoided of profile.avoidedVocabulary) {
      if (text.toLowerCase().includes(avoided.toLowerCase())) {
        violations.push(`Uses avoided word: "${avoided}"`);
      }
    }
  }

  const minLength = profile.answerLengthPreference === 'short' ? 20 : profile.answerLengthPreference === 'normal' ? 50 : 100;
  const maxLength = profile.answerLengthPreference === 'short' ? 100 : profile.answerLengthPreference === 'normal' ? 300 : 800;
  if (text.length < minLength) {
    suggestions.push(`Answer may be too short (${text.length} chars, prefer ${minLength}+)`);
  }
  if (text.length > maxLength) {
    suggestions.push(`Answer may be too long (${text.length} chars, prefer <${maxLength})`);
  }

  if (profile.preferredVocabulary.length > 0) {
    const usedPreferred = profile.preferredVocabulary.filter(w => 
      text.toLowerCase().includes(w.toLowerCase())
    );
    if (usedPreferred.length === 0 && profile.sampleCount > 5) {
      suggestions.push('Consider using your preferred vocabulary');
    }
  }

  return {
    passed: violations.length === 0,
    violations,
    suggestions,
  };
}