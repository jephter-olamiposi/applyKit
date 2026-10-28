/**
 * @fileoverview How well the candidate fits the current job, in plain words.
 *
 * Shows three things a person actually wants to know before spending time on an
 * application: can I apply from where I live, how many of the requirements do I meet,
 * and which ones are missing. Every "yes" is backed by the deterministic matcher, which
 * only counts something as met when the candidate's own resume shows it (ADR-0013).
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  verifyJobEligibility,
  type JobPosting,
  type JobMatchMatrix,
  type GapAnalysisReport,
  type HighlightSuggestion,
  type RequirementMatch,
  type CandidateProfile,
  type JobEligibilityReport,
} from '@applykit/domain';
import { sendToBackground } from '../../messages/bridge.js';
import type {
  MatchJobRequirementsRequest,
  MatchJobRequirementsResponse,
  AiRequirementAnalysisResult,
  GetCandidateProfileResponse,
} from '../../messages/contracts.js';
import type { TabId } from './NavigationTabs.js';

interface MatchAnalysisProps {
  jobPosting: JobPosting | null;
  onNavigateToTab: (tab: TabId) => void;
}

const GATE_LABELS: Record<string, string> = {
  geography: 'Location',
  work_authorization: 'Work permit',
  entity: 'Contract type',
  timezone: 'Time zone',
  requirements: 'Hard requirements',
};

/** Headline for the fit score. Wording stays modest: the score is a guide, not a verdict. */
function fitHeadline(score: number, missingRequired: number): string {
  if (missingRequired === 0 && score >= 80) return 'Strong fit';
  if (score >= 60) return missingRequired > 0 ? 'Good fit with a few gaps' : 'Good fit';
  return 'Weak fit';
}

/**
 * Renders the fit summary, the eligibility check, and the requirement-by-requirement list.
 */
export const MatchAnalysis: React.FC<MatchAnalysisProps> = ({ jobPosting, onNavigateToTab }) => {
  const [matrix, setMatrix] = useState<JobMatchMatrix | null>(null);
  const [gapAnalysis, setGapAnalysis] = useState<GapAnalysisReport | null>(null);
  const [highlights, setHighlights] = useState<readonly HighlightSuggestion[]>([]);
  const [aiAnalysis, setAiAnalysis] = useState<AiRequirementAnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<CandidateProfile | null>(null);
  const [showOnlyGaps, setShowOnlyGaps] = useState(false);

  useEffect(() => {
    sendToBackground<{ type: 'GET_CANDIDATE_PROFILE' }, GetCandidateProfileResponse>({ type: 'GET_CANDIDATE_PROFILE' })
      .then((res) => {
        if (res.profile) setProfile(res.profile);
      })
      .catch(() => undefined);
  }, []);

  const eligibility: JobEligibilityReport | null = useMemo(() => {
    if (!jobPosting || !profile) return null;
    return verifyJobEligibility(jobPosting, profile);
  }, [jobPosting, profile]);

  const runAnalysis = useCallback(async () => {
    if (!jobPosting || jobPosting.requirements.length === 0) {
      setMatrix(null);
      setGapAnalysis(null);
      setHighlights([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await sendToBackground<MatchJobRequirementsRequest, MatchJobRequirementsResponse>({
        type: 'MATCH_JOB_REQUIREMENTS',
        jobPostingId: jobPosting.id,
        requirements: [...jobPosting.requirements],
      });
      if (res.success && res.matchMatrix && res.gapAnalysis) {
        setMatrix(res.matchMatrix);
        setGapAnalysis(res.gapAnalysis);
        setHighlights(res.highlightSuggestions || []);
        setAiAnalysis(res.aiAnalysis || null);
      } else {
        setError(res.error || 'Could not compare this job with your resume.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [jobPosting]);

  useEffect(() => {
    runAnalysis();
  }, [runAnalysis]);

  if (!jobPosting) return null;

  if (jobPosting.requirements.length === 0) {
    return (
      <div className="ui-note">
        This posting does not list clear requirements, so there is nothing to compare yet. You can still tailor your
        resume to it.
      </div>
    );
  }

  const matchById = new Map<string, RequirementMatch>((matrix?.matches ?? []).map((m) => [m.requirementId, m]));
  const missingRequired = matrix ? matrix.requiredCount - matrix.requiredMetCount : 0;
  const rows = jobPosting.requirements.filter((req) => !showOnlyGaps || !matchById.get(req.id)?.isMatched);

  return (
    <div className="ui-stack">
      {eligibility && <EligibilityNote report={eligibility} />}

      <section className="ui-card" aria-label="Fit">
        {loading && !matrix && <p className="ui-subtle">Comparing this job with your resume...</p>}
        {error && <div className="ui-note ui-note-bad">{error}</div>}

        {matrix && (
          <div className="ui-stack" style={{ gap: 8 }}>
            <div className="ui-spread">
              <h3 className="ui-card-title">{fitHeadline(matrix.overallMatchScore, missingRequired)}</h3>
              <span className="ui-subtle">{matrix.overallMatchScore}% match</span>
            </div>
            <div className="ui-meter" aria-hidden="true">
              <span style={{ width: `${matrix.overallMatchScore}%` }} />
            </div>
            <p className="ui-text">
              You meet {matrix.requiredMetCount} of {matrix.requiredCount} required
              {matrix.preferredCount > 0 ? ` and ${matrix.preferredMetCount} of ${matrix.preferredCount} nice-to-have` : ''}{' '}
              items.{gapAnalysis && gapAnalysis.totalGaps > 0 ? ` ${gapAnalysis.summary}` : ''}
            </p>
            {aiAnalysis && aiAnalysis.keyStrengths.length > 0 && (
              <p className="ui-subtle">Also worth knowing: {aiAnalysis.keyStrengths.slice(0, 2).join('; ')}.</p>
            )}
          </div>
        )}
      </section>

      {matrix && (
        <section className="ui-card" aria-label="Requirements">
          <div className="ui-spread" style={{ marginBottom: 10 }}>
            <h3 className="ui-card-title">What they ask for</h3>
            <button type="button" className="ui-link" onClick={() => setShowOnlyGaps((v) => !v)}>
              {showOnlyGaps ? 'Show all' : 'Show only gaps'}
            </button>
          </div>
          <ul className="ui-list">
            {rows.map((req) => {
              const match = matchById.get(req.id);
              const partly = Boolean(match?.isMatched && match.missingParts && match.missingParts.length > 0);
              // A skill that appears only in the skills list, never in a job, is a claim the
              // resume does not back up yet; say so rather than showing a green "Yes".
              const listedOnly = Boolean(match?.isMatched && (match.matchTier === 'exact_skill' || match.matchTier === 'synonym_skill'));
              const chip = !match?.isMatched
                ? { label: 'Missing', cls: req.isRequired ? 'ui-chip-bad' : 'ui-chip-warn' }
                : listedOnly
                ? { label: 'Listed only', cls: 'ui-chip-warn' }
                : partly
                ? { label: 'Partly', cls: 'ui-chip-warn' }
                : { label: 'Yes', cls: 'ui-chip-good' };
              return (
                <li key={req.id}>
                  <div className="ui-spread" style={{ alignItems: 'flex-start' }}>
                    <span className="ui-text" style={{ color: 'var(--text)' }}>
                      {req.rawText}
                      {!req.isRequired && <span className="ui-subtle"> (nice to have)</span>}
                    </span>
                    <span className={`ui-chip ${chip.cls}`}>{chip.label}</span>
                  </div>
                  {match && <p className="ui-subtle" style={{ marginTop: 2 }}>{match.rationale}</p>}
                </li>
              );
            })}
            {rows.length === 0 && <li className="ui-subtle">No gaps. Every listed requirement shows up in your resume.</li>}
          </ul>
        </section>
      )}

      {highlights.length > 0 && (
        <section className="ui-card" aria-label="What to lead with">
          <h3 className="ui-card-title">Lead with this</h3>
          <p className="ui-subtle" style={{ marginBottom: 8 }}>The parts of your history that match this job best.</p>
          <ul className="ui-list">
            {highlights.slice(0, 3).map((item) => (
              <li key={item.id}>
                <strong style={{ fontWeight: 600 }}>{item.title}</strong>
                {item.subtitle && <span className="ui-subtle"> · {item.subtitle}</span>}
                {item.recommendedFocusBullets[0] && <p className="ui-subtle">{item.recommendedFocusBullets[0]}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <button type="button" className="ui-btn ui-btn-primary ui-btn-block" onClick={() => onNavigateToTab('tailor_resume')}>
        Tailor my resume for this job
      </button>
    </div>
  );
};

/**
 * Can the candidate apply from where they are? Shown first because a "remote" role that
 * is only open to one country makes everything else moot.
 */
const EligibilityNote: React.FC<{ report: JobEligibilityReport }> = ({ report }) => {
  const tone = report.verdict === 'BLOCKED' ? 'ui-note-bad' : report.verdict === 'CONDITIONAL' ? 'ui-note-warn' : 'ui-note-good';
  const headline =
    report.verdict === 'BLOCKED'
      ? `You probably can't apply: ${GATE_LABELS[report.fatalGate ?? ''] ?? 'eligibility'} doesn't match.`
      : report.verdict === 'CONDITIONAL'
      ? 'You can apply, but check one thing first.'
      : 'You can apply from where you are.';
  const issues = report.checks.filter((check) => check.status !== 'passed');

  return (
    <div className={`ui-note ${tone}`} role="status">
      <strong style={{ fontWeight: 600 }}>{headline}</strong>
      {report.verbatimEvidence && <p style={{ marginTop: 4 }}>The posting says: “{report.verbatimEvidence}”</p>}
      {issues.length > 0 && <p style={{ marginTop: 4 }}>{issues.map((check) => check.reason).join(' ')}</p>}
      <details className="ui-details" style={{ marginTop: 6 }}>
        <summary>What we checked</summary>
        <ul className="ui-list">
          {report.checks.map((check) => (
            <li key={check.gate} style={{ padding: '4px 0', border: 'none' }}>
              <strong style={{ fontWeight: 600 }}>{GATE_LABELS[check.gate] ?? check.gate}:</strong>{' '}
              {check.status === 'passed' ? 'OK' : check.status === 'conditional' ? 'Check' : 'Blocked'}. {check.reason}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
};
