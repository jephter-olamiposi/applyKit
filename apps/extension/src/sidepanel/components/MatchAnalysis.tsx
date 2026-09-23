/**
 * @fileoverview Requirement Matching & Gap Analysis Inspector for Side Panel UI.
 *
 * Implements candidate review interface for job alignment (ADR-0013):
 * - Deterministic multi-tier match matrix evaluation.
 * - Categorized qualification gap analysis with actionable mitigation recommendations.
 * - Tailoring highlight suggestions ranking candidate projects and work experiences.
 */

import React, { useState, useEffect, useCallback } from 'react';
import type {
  JobPosting,
  JobMatchMatrix,
  GapAnalysisReport,
  HighlightSuggestion,
  Requirement,
  RequirementMatch,
  RequirementGap,
} from '@applykit/domain';
import { sendToBackground } from '../../messages/bridge.js';
import type {
  MatchJobRequirementsRequest,
  MatchJobRequirementsResponse,
  AiRequirementAnalysisResult,
} from '../../messages/contracts.js';
import type { TabId } from './NavigationTabs.js';

interface MatchAnalysisProps {
  jobPosting: JobPosting | null;
  onNavigateToTab: (tab: TabId) => void;
}

type FilterView = 'all' | 'matched' | 'gaps' | 'highlights';

export const MatchAnalysis: React.FC<MatchAnalysisProps> = ({
  jobPosting,
  onNavigateToTab,
}) => {
  const [matrix, setMatrix] = useState<JobMatchMatrix | null>(null);
  const [gapAnalysis, setGapAnalysis] = useState<GapAnalysisReport | null>(null);
  const [highlights, setHighlights] = useState<readonly HighlightSuggestion[]>([]);
  const [aiAnalysis, setAiAnalysis] = useState<AiRequirementAnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [filterView, setFilterView] = useState<FilterView>('all');
  const [expandedReqId, setExpandedReqId] = useState<string | null>(null);

  const runAnalysis = useCallback(async () => {
    if (!jobPosting || !jobPosting.requirements || jobPosting.requirements.length === 0) {
      setMatrix(null);
      setGapAnalysis(null);
      setHighlights([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await sendToBackground<
        MatchJobRequirementsRequest,
        MatchJobRequirementsResponse
      >({
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
        setError(res.error || 'Failed to evaluate job requirements against candidate profile.');
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

  if (!jobPosting || !jobPosting.requirements || jobPosting.requirements.length === 0) {
    return (
      <div className="empty-state">
        <p className="empty-state-title">No Active Job Posting</p>
        <p className="empty-state-text">
          Extract a job posting first from the Overview tab to view requirements and perform gap analysis.
        </p>
        <button
          type="button"
          className="btn btn-primary"
          style={{ marginTop: '12px' }}
          onClick={() => onNavigateToTab('overview')}
        >
          Go to Overview
        </button>
      </div>
    );
  }

  // Determine overall fit classification based on composite score
  const getFitBadge = (score: number) => {
    if (score >= 80) {
      return { label: 'Strong Fit', className: 'fit-badge-strong' };
    }
    if (score >= 60) {
      return { label: 'Competitive Fit', className: 'fit-badge-competitive' };
    }
    return { label: 'Significant Gaps', className: 'fit-badge-warning' };
  };

  const getTierLabel = (tier: string) => {
    switch (tier) {
      case 'exact_evidence':
        return { text: '100% Verified Evidence', className: 'tier-exact-ev' };
      case 'synonym_evidence':
        return { text: '85% Synonym Match', className: 'tier-synonym-ev' };
      case 'claim_match':
        return { text: '75% Claim Match', className: 'tier-claim' };
      case 'exact_skill':
        return { text: '65% Unbacked Skill', className: 'tier-unbacked' };
      case 'synonym_skill':
        return { text: '60% Unbacked Synonym', className: 'tier-unbacked' };
      default:
        return { text: 'Unmatched', className: 'tier-unmatched' };
    }
  };

  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case 'critical':
        return { text: 'Critical', className: 'badge-severity-critical' };
      case 'moderate':
        return { text: 'Moderate', className: 'badge-severity-moderate' };
      default:
        return { text: 'Minor', className: 'badge-severity-minor' };
    }
  };

  const getCategoryLabel = (category: string) => {
    switch (category) {
      case 'hard_gap':
        return 'Missing Requirement';
      case 'soft_gap':
        return 'Missing Preference';
      case 'experience_shortfall':
        return 'Seniority Shortfall';
      case 'unsubstantiated_claim':
        return 'Unbacked Claim';
      default:
        return category;
    }
  };

  const fitInfo = matrix ? getFitBadge(matrix.overallMatchScore) : null;

  // Build lookup maps for rendering
  const reqMap = new Map<string, Requirement>(
    jobPosting.requirements.map((r) => [r.id, r])
  );
  const matchMap = new Map<string, RequirementMatch>(
    matrix ? matrix.matches.map((m) => [m.requirementId, m]) : []
  );
  const gapMap = new Map<string, RequirementGap>(
    gapAnalysis ? gapAnalysis.gaps.map((g) => [g.requirementId, g]) : []
  );

  const aiMatchMap = new Map<string, string>();
  if (aiAnalysis?.matches) {
    for (const m of aiAnalysis.matches) {
      if (m.requirementText && m.reasoning) {
        aiMatchMap.set(m.requirementText.toLowerCase().trim(), m.reasoning);
      }
    }
  }

  const matchedCount = matrix?.matches.filter((m) => m.isMatched).length ?? 0;
  const gapCount = gapAnalysis?.totalGaps ?? 0;

  return (
    <div className="match-analysis-container">
      <header className="match-header">
        <div>
          <h2 className="section-title">Requirement Matching &amp; Gap Analysis</h2>
          <p className="section-subtitle">
            {jobPosting.title} &bull; {jobPosting.companyName}
          </p>
        </div>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={loading}
          onClick={runAnalysis}
        >
          {loading ? 'Evaluating...' : 'Re-analyze'}
        </button>
      </header>

      {error && (
        <div className="error-banner" role="alert">
          <p className="error-text">{error}</p>
        </div>
      )}

      {loading && (
        <div className="loading-container">
          <div className="loading-spinner" />
          <p className="loading-text">Comparing candidate background against job criteria...</p>
        </div>
      )}

      {!loading && matrix && gapAnalysis && (
        <>
          {/* Fit Score Hero Card */}
          <section className="fit-hero-card">
            <div className="fit-hero-main">
              <div className="fit-score-circle">
                <span className="fit-score-value">{matrix.overallMatchScore}%</span>
                <span className="fit-score-label">Fit Score</span>
              </div>
              <div className="fit-hero-details">
                {fitInfo && (
                  <span className={`fit-pill ${fitInfo.className}`}>
                    {fitInfo.label}
                  </span>
                )}
                <p className="fit-summary-text">{gapAnalysis.summary}</p>
              </div>
            </div>

            <div className="fit-metrics-grid">
              <div className="fit-metric-item">
                <span className="fit-metric-num">
                  {matrix.requiredMetCount}/{matrix.requiredCount}
                </span>
                <span className="fit-metric-label">Required Met</span>
              </div>
              <div className="fit-metric-item">
                <span className="fit-metric-num">
                  {matrix.preferredMetCount}/{matrix.preferredCount}
                </span>
                <span className="fit-metric-label">Preferred Met</span>
              </div>
              <div className="fit-metric-item">
                <span className="fit-metric-num" style={{ color: gapAnalysis.criticalGapsCount > 0 ? '#f87171' : '#cbd5e1' }}>
                  {gapAnalysis.criticalGapsCount}
                </span>
                <span className="fit-metric-label">Critical Gaps</span>
              </div>
              <div className="fit-metric-item">
                <span className="fit-metric-num" style={{ color: matrix.experienceShortfallsCount > 0 ? '#fbbf24' : '#cbd5e1' }}>
                  {matrix.experienceShortfallsCount}
                </span>
                <span className="fit-metric-label">Shortfalls</span>
              </div>
            </div>
          </section>

          {/* AI Semantic Intelligence Section (ADR-0020) */}
          {aiAnalysis && (
            <section
              className="ai-intelligence-card"
              style={{
                background: 'linear-gradient(135deg, rgba(79, 70, 229, 0.15) 0%, rgba(147, 51, 234, 0.12) 100%)',
                border: '1px solid rgba(129, 140, 248, 0.35)',
                borderRadius: '10px',
                padding: '14px 16px',
                marginBottom: '14px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '16px' }}>✨</span>
                  <h3 style={{ fontSize: '13px', fontWeight: 600, color: '#e0e7ff', margin: 0 }}>
                    Gemini AI Semantic Evaluation
                  </h3>
                </div>
                <span
                  style={{
                    background: 'rgba(99, 102, 241, 0.3)',
                    color: '#c7d2fe',
                    padding: '2px 8px',
                    borderRadius: '12px',
                    fontSize: '11px',
                    fontWeight: 600,
                  }}
                >
                  {aiAnalysis.overallScore}% AI Alignment
                </span>
              </div>

              {aiAnalysis.keyStrengths && aiAnalysis.keyStrengths.length > 0 && (
                <div style={{ marginTop: '8px' }}>
                  <h4 style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#a5b4fc', margin: '0 0 4px 0' }}>
                    Key Candidate Strengths
                  </h4>
                  <ul style={{ margin: 0, paddingLeft: '16px', color: '#cbd5e1', fontSize: '12px', lineHeight: '1.4' }}>
                    {aiAnalysis.keyStrengths.map((str, idx) => (
                      <li key={idx} style={{ marginBottom: '2px' }}>{str}</li>
                    ))}
                  </ul>
                </div>
              )}

              {aiAnalysis.identifiedGaps && aiAnalysis.identifiedGaps.length > 0 && (
                <div style={{ marginTop: '8px' }}>
                  <h4 style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#fca5a5', margin: '0 0 4px 0' }}>
                    Real Gaps to Address
                  </h4>
                  <ul style={{ margin: 0, paddingLeft: '16px', color: '#cbd5e1', fontSize: '12px', lineHeight: '1.4' }}>
                    {aiAnalysis.identifiedGaps.map((gap, idx) => (
                      <li key={idx} style={{ marginBottom: '2px' }}>{gap}</li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}

          {/* View Filter Switcher */}
          <nav className="filter-pill-nav" aria-label="Requirement Filter Options">
            <button
              type="button"
              className={`filter-pill ${filterView === 'all' ? 'filter-pill-active' : ''}`}
              onClick={() => setFilterView('all')}
            >
              All ({jobPosting.requirements.length})
            </button>
            <button
              type="button"
              className={`filter-pill ${filterView === 'matched' ? 'filter-pill-active' : ''}`}
              onClick={() => setFilterView('matched')}
            >
              Matched ({matchedCount})
            </button>
            <button
              type="button"
              className={`filter-pill ${filterView === 'gaps' ? 'filter-pill-active' : ''}`}
              onClick={() => setFilterView('gaps')}
            >
              Gaps ({gapCount})
            </button>
            <button
              type="button"
              className={`filter-pill ${filterView === 'highlights' ? 'filter-pill-active' : ''}`}
              onClick={() => setFilterView('highlights')}
            >
              Highlights ({highlights.length})
            </button>
          </nav>

          {/* Highlight Suggestions Tab View */}
          {filterView === 'highlights' && (
            <section className="highlights-section">
              <h3 className="group-title">Recommended Experiences &amp; Projects to Feature</h3>
              {highlights.length === 0 ? (
                <p className="empty-notice">No specific highlight recommendations found.</p>
              ) : (
                <ul className="highlight-list">
                  {highlights.map((h) => (
                    <li key={h.id} className="highlight-card">
                      <div className="highlight-header">
                        <div>
                          <span className="highlight-type-badge">
                            {h.sourceType === 'project' ? 'Project' : 'Experience'}
                          </span>
                          <h4 className="highlight-title">{h.title}</h4>
                          {h.subtitle && <span className="highlight-subtitle">{h.subtitle}</span>}
                        </div>
                        <span className="highlight-score-pill">
                          {h.relevanceScore}% Relevance
                        </span>
                      </div>

                      <p className="highlight-rationale">{h.rationale}</p>

                      {h.recommendedFocusBullets.length > 0 && (
                        <div className="highlight-bullets-container">
                          <span className="bullets-title">Key Accomplishments to Emphasize:</span>
                          <ul className="highlight-bullet-list">
                            {h.recommendedFocusBullets.map((bullet, idx) => (
                              <li key={idx} className="highlight-bullet-item">
                                &bull; {bullet}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {/* Requirements & Gaps Views */}
          {filterView !== 'highlights' && (
            <section className="requirements-evaluation-section">
              <ul className="evaluation-list">
                {jobPosting.requirements
                  .filter((req) => {
                    const match = matchMap.get(req.id);
                    const gap = gapMap.get(req.id);
                    if (filterView === 'matched') return match && match.isMatched;
                    if (filterView === 'gaps') return Boolean(gap);
                    return true;
                  })
                  .map((req) => {
                    const match = matchMap.get(req.id);
                    const gap = gapMap.get(req.id);
                    const isExpanded = expandedReqId === req.id;
                    const tierInfo = match ? getTierLabel(match.matchTier) : null;
                    const sevBadge = gap ? getSeverityBadge(gap.severity) : null;

                    return (
                      <li
                        key={req.id}
                        className={`eval-card ${
                          match?.isMatched ? 'eval-card-matched' : 'eval-card-gap'
                        }`}
                      >
                        <div className="eval-card-header">
                          <div className="eval-status-indicator">
                            {match?.isMatched ? (
                              <span className="icon-matched" title="Requirement Met">
                                &#10003;
                              </span>
                            ) : (
                              <span className="icon-gap" title="Qualification Gap">
                                &#10007;
                              </span>
                            )}
                            <span className="eval-competency-tag">
                              {req.normalizedSkillOrCompetency}
                            </span>
                            <span className={`eval-importance-badge ${req.isRequired ? 'badge-req' : 'badge-pref'}`}>
                              {req.importance.replace('_', ' ')}
                            </span>
                          </div>

                          <div className="eval-badge-group">
                            {tierInfo && match?.isMatched && (
                              <span className={`tier-badge ${tierInfo.className}`}>
                                {tierInfo.text}
                              </span>
                            )}
                            {sevBadge && gap && (
                              <span className={`badge-severity ${sevBadge.className}`}>
                                {sevBadge.text}
                              </span>
                            )}
                          </div>
                        </div>

                        <p className="eval-raw-text">{req.rawText}</p>

                        {/* AI Semantic Reasoning Note (ADR-0020) */}
                        {(() => {
                          const aiReasoning =
                            aiMatchMap.get(req.rawText.toLowerCase().trim()) ||
                            Array.from(aiMatchMap.entries()).find(
                              ([k]) =>
                                k.includes(req.normalizedSkillOrCompetency.toLowerCase()) ||
                                req.rawText.toLowerCase().includes(k)
                            )?.[1];
                          if (!aiReasoning) return null;
                          return (
                            <div
                              className="ai-req-reasoning-box"
                              style={{
                                marginTop: '6px',
                                marginBottom: '8px',
                                padding: '8px 10px',
                                background: 'rgba(99, 102, 241, 0.08)',
                                borderRadius: '6px',
                                borderLeft: '3px solid #818cf8',
                                fontSize: '12px',
                                color: '#e2e8f0',
                                lineHeight: '1.4',
                              }}
                            >
                              <strong style={{ color: '#a5b4fc' }}>AI Alignment:</strong> {aiReasoning}
                            </div>
                          );
                        })()}

                        {/* Gap Explanation and Recommendation */}
                        {gap && (
                          <div className="gap-detail-box">
                            <div className="gap-detail-row">
                              <span className="gap-category-pill">
                                {getCategoryLabel(gap.category)}
                              </span>
                              <span className="gap-explanation">{gap.explanation}</span>
                            </div>
                            <div className="gap-recommendation">
                              <strong>Recommendation:</strong> {gap.recommendation}
                            </div>
                          </div>
                        )}

                        {/* Matched Evidence Citations */}
                        {match && match.isMatched && match.matchedEvidenceIds.length > 0 && (
                          <div className="evidence-citation-toggle">
                            <button
                              type="button"
                              className="btn-link"
                              onClick={() => setExpandedReqId(isExpanded ? null : req.id)}
                            >
                              {isExpanded
                                ? 'Hide Supporting Evidence'
                                : `View ${match.matchedEvidenceIds.length} Verified Evidence Citation(s)`}
                            </button>
                            {isExpanded && (
                              <div className="evidence-citation-drawer">
                                <p className="evidence-drawer-title">Verified Evidence References:</p>
                                <ul className="evidence-citation-list">
                                  {match.matchedEvidenceIds.map((evId) => (
                                    <li key={evId} className="evidence-citation-chip">
                                      ID: {evId}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
};
