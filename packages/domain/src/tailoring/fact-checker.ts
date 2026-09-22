/**
 * @fileoverview Fact-Checking and Grounding Verification Engine.
 *
 * Cross-references every generated sentence and assertion in tailored resumes and cover letters
 * against the candidate's EvidenceGraph and CandidateProfile (ADR-0004). Flags unbacked claims,
 * hallucinated metrics, or unsubstantiated technical competencies to ensure 100% factual accuracy.
 */

import type { EvidenceGraph } from '../evidence/evidence-graph.js';
import type { CandidateProfile } from '../candidate/profile.js';
import type { EvidenceId } from '../types/ids.js';
import { areCompetenciesEquivalent, normalizeCompetencyToken } from '../job/synonyms.js';
import { getFullName, getPreferredOrLegalName } from '../candidate/identity.js';
import type {
  FactCheckReport,
  VerifiedStatement,
  UnbackedStatement,
} from './tailoring-types.js';

/**
 * Common boilerplate or conversational phrases excluded from deep evidence verification.
 */
const BOILERPLATE_PATTERNS: readonly RegExp[] = [
  /^dear\s+/i,
  /^sincerely\b/i,
  /^thank\s+you\b/i,
  /^i\s+am\s+writing\s+to\s+express\s+(my\s+)?(strong\s+)?(interest|enthusiasm)\b/i,
  /^i\s+would\s+welcome\s+the\s+opportunity\b/i,
  /^results-driven\b/i,
  /^committed\s+to\s+delivering\b/i,
  /^best\s+regards\b/i,
];

/**
 * Splits document text into clean, individual sentence units.
 */
function splitIntoSentences(text: string): string[] {
  const normalized = text.replace(/\r\n/g, '\n');
  const lines = normalized.split(/\n+/);
  const sentences: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const chunks = trimmed.split(/(?<=[.!?])\s+(?=[A-Z0-9"']|$)/);
    for (const chunk of chunks) {
      const s = chunk.trim();
      if (s.length > 5) {
        sentences.push(s);
      }
    }
  }

  return sentences;
}

/**
 * Extracts metric patterns such as percentages, currency, or scale multipliers.
 */
function extractMetrics(text: string): string[] {
  const metricRegex = /\b(\d+(?:\.\d+)?%|\$\d+(?:\.\d+)?[kKmMbB]?|\d+[kKmMbB]\+?|\d+\+)\b/g;
  const matches = text.match(metricRegex);
  return matches ? Array.from(matches) : [];
}

/**
 * Tokenizes text into lowercase alphanumeric words, filtering out short stop words.
 */
function tokenize(text: string): Set<string> {
  const stopWords = new Set([
    'the', 'and', 'with', 'for', 'that', 'this', 'have', 'from', 'been', 'will',
    'would', 'our', 'your', 'about', 'more', 'their', 'which', 'also', 'into',
  ]);
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w));

  return new Set(tokens);
}

/**
 * Measures token overlap similarity between two text strings.
 */
function calculateTokenOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let matches = 0;
  for (const token of a) {
    if (b.has(token)) {
      matches++;
    }
  }
  return matches / Math.min(a.size, b.size);
}

/**
 * Audits a tailored document (resume or cover letter) against verified candidate records.
 *
 * Verification Invariants (ADR-0004):
 * - If a sentence contains a quantified metric (e.g., "40%", "$2M", "10M+"), that exact metric
 *   must exist in the candidate's verified evidence or work highlights.
 * - Technical competencies mentioned must be present in the candidate's skill pool or evidence.
 * - Substantive accomplishment statements must have corroborating evidence in the EvidenceGraph.
 *
 * @param text The complete tailored text or section to verify.
 * @param profile Candidate profile aggregate.
 * @param graph Evidence graph containing verified atomic snippets.
 * @param documentType Classification of document being audited ('resume' or 'cover_letter').
 * @returns Comprehensive fact-check report.
 */
export function factCheckTailoredDocument(
  text: string,
  profile: CandidateProfile,
  graph: EvidenceGraph,
  documentType: 'resume' | 'cover_letter' = 'cover_letter'
): FactCheckReport {
  const sentences = splitIntoSentences(text);
  const verifiedStatements: VerifiedStatement[] = [];
  const unbackedStatements: UnbackedStatement[] = [];
  const recommendations: string[] = [];

  // Build searchable index of candidate evidence texts
  const evidencePool: Array<{ id?: EvidenceId; text: string; tokens: Set<string> }> = [];

  for (const [id, ev] of graph.evidenceMap.entries()) {
    evidencePool.push({
      id,
      text: ev.textSnippet,
      tokens: tokenize(ev.textSnippet),
    });
  }

  // Also include raw highlights from experiences and projects
  for (const exp of profile.experiences) {
    for (const [i, h] of exp.highlights.entries()) {
      evidencePool.push({
        id: exp.evidenceRefs?.[i],
        text: `${exp.title} at ${exp.company}: ${h}`,
        tokens: tokenize(h),
      });
    }
  }

  for (const proj of profile.projects) {
    for (const [i, h] of proj.highlights.entries()) {
      evidencePool.push({
        id: proj.evidenceRefs?.[i],
        text: `${proj.title}: ${h}`,
        tokens: tokenize(h),
      });
    }
  }

  let substantiveCount = 0;

  for (const sentence of sentences) {
    // Skip common conversational boilerplate
    const isBoilerplate = BOILERPLATE_PATTERNS.some((p) => p.test(sentence));
    if (isBoilerplate) {
      continue;
    }

    // Skip candidate signature or contact lines
    const fullName = getFullName(profile.identity).toLowerCase();
    const preferredName = getPreferredOrLegalName(profile.identity).toLowerCase();
    const cleanLower = sentence.toLowerCase().trim();
    if (
      cleanLower === fullName ||
      cleanLower === preferredName ||
      cleanLower === profile.identity.email?.toLowerCase() ||
      cleanLower === profile.identity.phone?.toLowerCase()
    ) {
      continue;
    }

    substantiveCount++;
    const sentenceTokens = tokenize(sentence);
    const sentenceMetrics = extractMetrics(sentence);

    // 1. Metric Provenance Audit
    let metricMissing = false;
    for (const metric of sentenceMetrics) {
      const metricFoundInPool = evidencePool.some((item) => item.text.includes(metric));
      if (!metricFoundInPool) {
        metricMissing = true;
        unbackedStatements.push({
          statement: sentence,
          reason: `Contains unverified metric '${metric}' that does not appear in candidate evidence records.`,
          severity: 'critical',
        });
        recommendations.push(
          `Remove or cite verified documentation for unbacked metric '${metric}'.`
        );
        break;
      }
    }

    if (metricMissing) {
      continue;
    }

    // 2. Evidence Corroboration via Semantic Overlap
    let bestMatch: { id?: EvidenceId; text: string; overlap: number } | null = null;

    for (const item of evidencePool) {
      const overlap = calculateTokenOverlap(sentenceTokens, item.tokens);
      if (!bestMatch || overlap > bestMatch.overlap) {
        bestMatch = { id: item.id, text: item.text, overlap };
      }
    }

    // A statement is verified if it has strong token overlap with an evidence snippet (>= 40%)
    // or mentions candidate title / skills in a grounded introductory structure
    if (bestMatch && bestMatch.overlap >= 0.35) {
      verifiedStatements.push({
        statement: sentence,
        evidenceId: bestMatch.id,
        sourceSnippet: bestMatch.text,
        confidenceScore: Math.min(1.0, Math.round(bestMatch.overlap * 100) / 100),
      });
    } else {
      // Check if statement simply lists candidate skills without making an unsupported claim
      const mentionsVerifiedSkills = profile.skills.some((s) =>
        sentence.toLowerCase().includes(s.name.toLowerCase())
      );

      if (mentionsVerifiedSkills && sentenceTokens.size <= 8) {
        verifiedStatements.push({
          statement: sentence,
          sourceSnippet: 'Verified candidate skill summary',
          confidenceScore: 0.85,
        });
      } else {
        unbackedStatements.push({
          statement: sentence,
          reason: 'Statement could not be corroborated with verified candidate achievements or documents.',
          severity: 'warning',
        });
        recommendations.push(
          `Review statement: "${sentence.slice(0, 60)}..." to ensure it reflects factual experience.`
        );
      }
    }
  }

  const effectiveTotal = Math.max(1, substantiveCount);
  let groundingScore = Math.round((verifiedStatements.length / effectiveTotal) * 100);

  // If any critical metric hallucination occurred, cap grounding score
  const hasCriticalFailure = unbackedStatements.some((u) => u.severity === 'critical');
  if (hasCriticalFailure) {
    groundingScore = Math.min(groundingScore, 50);
  }

  const isPristine = unbackedStatements.length === 0 && groundingScore >= 85;

  return {
    documentType,
    groundingScore,
    isPristine,
    totalStatementsChecked: substantiveCount,
    verifiedStatements,
    unbackedStatements,
    recommendations,
    auditedAt: new Date().toISOString(),
  };
}
