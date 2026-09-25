/**
 * @fileoverview Tailoring Studio Component for Resumes and Cover Letters.
 *
 * Provides candidate review and export interface for evidence-grounded documents (ADR-0004):
 * 1. Dynamic Resume Selector: Ranked experiences, projects, and partitioned skills.
 * 2. Evidence-Grounded Cover Letter: Sectional assembly strictly citing verified accomplishments.
 * 3. Fact-Checking Verification: Automated verification dial flagging unbacked statements.
 * 4. Clean Exporters: 1-click Markdown, plain text, and local file downloads.
 */

import React, { useState, useEffect, useCallback } from 'react';
import type {
  TailoredResume,
  TailoredCoverLetter,
  FactCheckReport,
  CandidateProfile,
  ResumeTemplateId,
  ResumeQualityAuditReport,
} from '@applykit/domain';
import {
  exportResumeAsMarkdown,
  exportResumeAsPlainText,
  exportCoverLetterAsMarkdown,
  exportCoverLetterAsPlainText,
} from '@applykit/domain';
import { sendToBackground } from '../../messages/bridge.js';
import type {
  GenerateTailoredResumeResponse,
  GenerateCoverLetterResponse,
  GenerateCoverLetterPdfRequest,
  GenerateCoverLetterPdfResponse,
  GenerateResumePdfRequest,
  GenerateResumePdfResponse,
  FactCheckDocumentResponse,
  GetCandidateProfileResponse,
  ExtensionRequest,
  AutoFixResumeRequest,
  AutoFixResumeResponse,
} from '../../messages/contracts.js';

interface TailoringStudioProps {
  onNavigateToTab?: (tabId: any) => void;
}

export const TailoringStudio: React.FC<TailoringStudioProps> = ({ onNavigateToTab }) => {
  const [activeMode, setActiveMode] = useState<'resume' | 'cover_letter'>('resume');

  // Resume State
  const [tailoredResume, setTailoredResume] = useState<TailoredResume | null>(null);
  const [resumeFactCheck, setResumeFactCheck] = useState<FactCheckReport | null>(null);
  const [qualityAudit, setQualityAudit] = useState<ResumeQualityAuditReport | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<ResumeTemplateId>('modern');
  const [onePageFit, setOnePageFit] = useState<boolean>(true);
  const [isAutoFixing, setIsAutoFixing] = useState<boolean>(false);
  const [showAuditDetails, setShowAuditDetails] = useState<boolean>(false);
  const [loadingResume, setLoadingResume] = useState(false);

  // Cover Letter State
  const [coverLetter, setCoverLetter] = useState<TailoredCoverLetter | null>(null);
  const [letterFactCheck, setLetterFactCheck] = useState<FactCheckReport | null>(null);
  const [loadingLetter, setLoadingLetter] = useState(false);
  const [editedLetterText, setEditedLetterText] = useState('');
  const [recipient, setRecipient] = useState('');
  const [tone, setTone] = useState<'technical' | 'conversational' | 'executive'>('technical');

  // Shared State
  const [profile, setProfile] = useState<CandidateProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const [rechecking, setRechecking] = useState(false);
  const [recheckError, setRecheckError] = useState<string | null>(null);

  // Load Candidate Profile
  useEffect(() => {
    sendToBackground<{ type: 'GET_CANDIDATE_PROFILE' }, GetCandidateProfileResponse>({
      type: 'GET_CANDIDATE_PROFILE',
    })
      .then((res) => {
        if (res.profile) {
          setProfile(res.profile);
        }
      })
      .catch((err) => {
        console.error('Failed to load profile for tailoring studio:', err);
        setError('Failed to load your candidate profile for tailoring.');
      });
  }, []);

  // Fetch Tailored Resume
  const generateResume = useCallback(async () => {
    try {
      setLoadingResume(true);
      setError(null);
      const res = await sendToBackground<
        {
          type: 'GENERATE_TAILORED_RESUME';
          templateId?: ResumeTemplateId;
          onePageFit?: boolean;
        },
        GenerateTailoredResumeResponse
      >({
        type: 'GENERATE_TAILORED_RESUME',
        templateId: selectedTemplate,
        onePageFit,
      });

      if (!res.success || !res.tailoredResume) {
        throw new Error(res.error || 'Failed to generate tailored resume.');
      }

      setTailoredResume(res.tailoredResume);
      setResumeFactCheck(res.factCheck || null);
      setQualityAudit(res.qualityAudit || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingResume(false);
    }
  }, [selectedTemplate, onePageFit]);

  // 1-Click Auto-Polish for 14-Point Resume Golden Standard
  const handleAutoFix = async () => {
    if (!tailoredResume) return;
    try {
      setIsAutoFixing(true);
      setError(null);
      const res = await sendToBackground<
        AutoFixResumeRequest,
        AutoFixResumeResponse
      >({
        type: 'AUTO_FIX_RESUME',
        resume: tailoredResume,
      });

      if (!res.success || !res.tailoredResume) {
        throw new Error(res.error || 'Failed to auto-polish resume.');
      }

      setTailoredResume(res.tailoredResume);
      if (res.qualityAudit) {
        setQualityAudit(res.qualityAudit);
      }
      setCopyFeedback('⚡ Auto-polished! 14-point golden standard applied (removed pronouns & buzzwords, improved metrics & action verbs, budgeted to 1 page).');
      setTimeout(() => setCopyFeedback(null), 4500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsAutoFixing(false);
    }
  };

  // Fetch Tailored Cover Letter
  const generateLetter = useCallback(async () => {
    try {
      setLoadingLetter(true);
      setError(null);
      const res = await sendToBackground<
        {
          type: 'GENERATE_COVER_LETTER';
          recipient?: string;
          tone?: 'technical' | 'conversational' | 'executive';
        },
        GenerateCoverLetterResponse
      >({
        type: 'GENERATE_COVER_LETTER',
        recipient: recipient.trim() || undefined,
        tone,
      });

      if (!res.success || !res.coverLetter) {
        throw new Error(res.error || 'Failed to generate cover letter.');
      }

      setCoverLetter(res.coverLetter);
      setEditedLetterText(res.coverLetter.fullText);
      setLetterFactCheck(res.factCheck || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingLetter(false);
    }
  }, [recipient, tone]);

  // Initial load on mount
  useEffect(() => {
    generateResume();
  }, [generateResume]);

  // Re-check edited cover letter grounding
  const recheckGrounding = async () => {
    if (!editedLetterText.trim()) return;
    try {
      setRechecking(true);
      const res = await sendToBackground<
        { type: 'FACT_CHECK_DOCUMENT'; text: string; documentType: 'cover_letter' },
        FactCheckDocumentResponse
      >({
        type: 'FACT_CHECK_DOCUMENT',
        text: editedLetterText,
        documentType: 'cover_letter',
      });

      if (res.success && res.factCheck) {
        setLetterFactCheck(res.factCheck);
      }
    } catch (err) {
      console.error('Fact-check verification failed:', err);
      setLetterFactCheck(null);
      setRecheckError('Fact-check verification could not be completed. Please try again.');
    } finally {
      setRechecking(false);
    }
  };

  // Clipboard Copy Helper
  const handleCopy = (text: string, label: string) => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopyFeedback(`✓ ${label} copied to clipboard!`);
        setTimeout(() => setCopyFeedback(null), 3000);
      })
      .catch(() => {
        setCopyFeedback(`Could not copy ${label}. Clipboard access is unavailable.`);
        setTimeout(() => setCopyFeedback(null), 3000);
      });
  };

  // File Download Helper
  const handleDownload = (filename: string, content: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // PDF Download Helper (base64 from background)
  const handleDownloadPdf = async (
    requestType: 'GENERATE_COVER_LETTER_PDF' | 'GENERATE_RESUME_PDF',
    payload: Record<string, unknown>,
    filename: string
  ) => {
    try {
      const res = await sendToBackground<
        ExtensionRequest,
        GenerateCoverLetterPdfResponse | GenerateResumePdfResponse
      >({
        type: requestType,
        payload,
      } as unknown as ExtensionRequest);

      if (!res.success || !res.pdfBase64) {
        throw new Error(res.error || 'Failed to generate PDF');
      }

      // Convert base64 to blob and download
      const binaryString = atob(res.pdfBase64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to download PDF');
    }
  };

  return (
    <div className="tailoring-studio-container" role="region" aria-label="Tailoring Studio">
      {/* Mode Switcher & Target Indicator */}
      <div className="tailoring-header">
        <div className="tailoring-title-row">
          <div>
            <h2 className="tailoring-heading">Tailoring Studio</h2>
            <p className="tailoring-subheading">
              Evidence-grounded resumes and cover letters with zero hallucination guarantee.
            </p>
          </div>
          <div className="tailoring-mode-pills">
            <button
              type="button"
              className={`mode-pill ${activeMode === 'resume' ? 'mode-pill-active' : ''}`}
              onClick={() => setActiveMode('resume')}
            >
              Tailored Resume
            </button>
            <button
              type="button"
              className={`mode-pill ${activeMode === 'cover_letter' ? 'mode-pill-active' : ''}`}
              onClick={() => {
                setActiveMode('cover_letter');
                if (!coverLetter && !loadingLetter) {
                  generateLetter();
                }
              }}
            >
              Cover Letter
            </button>
          </div>
        </div>

        {copyFeedback && (
          <div className="tailoring-copy-toast" role="status">
            {copyFeedback}
          </div>
        )}

        {error && (
          <div className="tailoring-error-banner" role="alert">
            <span className="error-icon">⚠️</span>
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* 1. TAILORED RESUME VIEW                                                   */}
      {/* ========================================================================= */}
      {activeMode === 'resume' && (
        <div className="tailoring-resume-view">
          {loadingResume ? (
            <div className="tailoring-loading-state">
              <div className="loading-spinner" />
              <p>Reordering experiences and ranking verified bullets...</p>
            </div>
          ) : tailoredResume ? (
            <div className="resume-content-layout">
              {/* Target Role & Grounding Score Banner */}
              <div className="grounding-score-card">
                <div className="score-main-info">
                  <div className="target-opportunity-badge">
                    Target: <strong>{tailoredResume.targetJobTitle}</strong> at <strong>{tailoredResume.companyName}</strong>
                  </div>
                  {resumeFactCheck && (
                    <div className="fact-check-status-row">
                      <span className={`grounding-score-pill ${resumeFactCheck.isPristine ? 'score-pristine' : 'score-good'}`}>
                        {resumeFactCheck.isPristine ? '✓ 100% Grounded (Pristine)' : `${resumeFactCheck.groundingScore}% Grounded`}
                      </span>
                      <span className="statements-checked-count">
                        {resumeFactCheck.totalStatementsChecked} statements audited against EvidenceGraph
                      </span>
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  className="btn-refresh-tailoring"
                  onClick={generateResume}
                  disabled={loadingResume}
                  title="Regenerate resume ordering"
                >
                  ↻ Refresh
                </button>
              </div>

              {/* Template Selector & Layout Controls */}
              <div className="resume-design-toolbar">
                <div className="template-picker-group">
                  <span className="template-picker-label">Design Template:</span>
                  <div className="template-pill-buttons">
                    {(['modern', 'classic', 'minimalist', 'compact'] as ResumeTemplateId[]).map((tId) => (
                      <button
                        key={tId}
                        type="button"
                        className={`template-pill ${selectedTemplate === tId ? 'template-pill-active' : ''}`}
                        onClick={() => setSelectedTemplate(tId)}
                      >
                        {tId === 'modern' && '✨ Modern'}
                        {tId === 'classic' && '🏛️ Classic'}
                        {tId === 'minimalist' && '📄 Minimalist ATS'}
                        {tId === 'compact' && '⚡ Compact'}
                      </button>
                    ))}
                  </div>
                </div>

                <label className="one-page-checkbox-label">
                  <input
                    type="checkbox"
                    checked={onePageFit}
                    onChange={(e) => setOnePageFit(e.target.checked)}
                  />
                  <span>Enforce 1-Page Fit (US Letter 792pt budget)</span>
                </label>
              </div>

              {/* 14-Point Resume Golden Standard Audit Dial */}
              {qualityAudit && (() => {
                const totalCount = qualityAudit.totalCount;
                const passedCount = qualityAudit.passedCount;
                const warningCount = Object.values(qualityAudit.checks).filter((c) => c.status === 'warning').length;
                const failedCount = Object.values(qualityAudit.checks).filter((c) => c.status === 'failed').length;
                const isGoldenStandard = passedCount === totalCount && warningCount === 0 && failedCount === 0;
                const pageBudgetCheck = qualityAudit.checks.one_page_fit;

                return (
                  <div className="resume-quality-audit-card">
                    <div className="quality-audit-header">
                      <div className="quality-audit-score-group">
                        <div className="quality-score-circle">
                          <span className="quality-score-num">{qualityAudit.overallScore}</span>
                          <span className="quality-score-max">/100</span>
                        </div>
                        <div className="quality-score-meta">
                          <h4 className="quality-card-title">14-Point Golden Standard</h4>
                          <div className="quality-status-pill-row">
                            <span
                              className={`quality-status-badge ${
                                isGoldenStandard
                                  ? 'quality-status-golden'
                                  : qualityAudit.overallScore >= 80
                                  ? 'quality-status-good'
                                  : 'quality-status-warn'
                              }`}
                            >
                              {isGoldenStandard
                                ? '🏆 Golden Standard Met (14/14)'
                                : `${passedCount}/14 Passed • ${warningCount + failedCount} to Polish`}
                            </span>
                            {pageBudgetCheck && (
                              <span className={`budget-pill ${pageBudgetCheck.status === 'passed' ? 'budget-fit' : 'budget-over'}`}>
                                {pageBudgetCheck.status === 'passed' ? '✓ Fits 1 Page' : '⚠️ Over budget'}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="quality-actions-group">
                        <button
                          type="button"
                          className="btn-auto-fix-golden"
                          disabled={isAutoFixing}
                          onClick={handleAutoFix}
                          title="Automatically remove buzzwords, eliminate 'I', normalize typos, and budget to 1 page"
                        >
                          {isAutoFixing ? 'Polishing...' : '⚡ 1-Click Auto-Polish'}
                        </button>
                        <button
                          type="button"
                          className="btn-toggle-audit-details"
                          onClick={() => setShowAuditDetails(!showAuditDetails)}
                        >
                          {showAuditDetails ? '▲ Hide Checklist' : '▼ View 14 Checks'}
                        </button>
                      </div>
                    </div>

                    {/* Collapsible 14-Point Checklist */}
                    {showAuditDetails && (
                      <div className="quality-checklist-container">
                        <div className="checklist-grid">
                          {Object.values(qualityAudit.checks).map((check) => (
                            <div key={check.id} className={`audit-item-card audit-item-${check.status}`}>
                              <div className="audit-item-top">
                                <span className="audit-check-icon">
                                  {check.status === 'passed' ? '✅' : check.status === 'warning' ? '⚠️' : '❌'}
                                </span>
                                <span className="audit-item-name">{check.name}</span>
                                <span className="audit-item-score">{check.score}pts</span>
                              </div>
                              <p className="audit-item-desc">{check.description}</p>
                              {check.recommendations.length > 0 && (
                                <div className="audit-item-recs">
                                  {check.recommendations.map((rec, rIdx) => (
                                    <span key={rIdx} className="audit-rec-chip">
                                      💡 {rec}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Professional Summary */}
              <div className="tailored-section-card">
                <h3 className="tailored-section-title">Tailored Professional Summary</h3>
                <p className="tailored-summary-text">{tailoredResume.tailoredSummary}</p>
              </div>

              {/* Skills Alignment */}
              <div className="tailored-section-card">
                <h3 className="tailored-section-title">Matched Technical Competencies</h3>
                <div className="skills-partition-group">
                  {tailoredResume.skills.matchedRequired.length > 0 && (
                    <div className="skill-bucket">
                      <span className="skill-bucket-label bucket-required">Required Criteria Matched:</span>
                      <div className="skill-tags-row">
                        {tailoredResume.skills.matchedRequired.map((skill) => (
                          <span key={skill} className="skill-tag skill-tag-required">
                            ✓ {skill}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {tailoredResume.skills.matchedPreferred.length > 0 && (
                    <div className="skill-bucket">
                      <span className="skill-bucket-label bucket-preferred">Preferred Qualifications Matched:</span>
                      <div className="skill-tags-row">
                        {tailoredResume.skills.matchedPreferred.map((skill) => (
                          <span key={skill} className="skill-tag skill-tag-preferred">
                            + {skill}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {tailoredResume.skills.additionalSkills.length > 0 && (
                    <div className="skill-bucket">
                      <span className="skill-bucket-label bucket-additional">Additional Verified Skills:</span>
                      <div className="skill-tags-row">
                        {tailoredResume.skills.additionalSkills.slice(0, 8).map((skill) => (
                          <span key={skill} className="skill-tag skill-tag-additional">
                            {skill}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Ranked Work Experiences */}
              <div className="tailored-section-card">
                <h3 className="tailored-section-title">Ranked Work Experience</h3>
                <div className="experiences-ranked-list">
                  {tailoredResume.experiences.map((exp) => (
                    <div key={exp.experienceId} className="ranked-experience-item">
                      <div className="exp-header-row">
                        <div>
                          <h4 className="exp-title-text">{exp.title}</h4>
                          <span className="exp-company-text">{exp.company}</span>
                        </div>
                        <span className="exp-relevance-pill">{exp.relevanceScore}% Match</span>
                      </div>
                      <ul className="ranked-highlights-list">
                        {exp.rankedHighlights.map((h, i) => (
                          <li key={i} className="ranked-highlight-bullet">
                            <span className="bullet-content">{h.text}</span>
                            <div className="bullet-grounding-tags">
                              {h.sourceEvidenceId && (
                                <span className="evidence-badge">🔗 Grounding Verified</span>
                              )}
                              {h.matchedRequirements.map((req) => (
                                <span key={req} className="req-match-pill">{req}</span>
                              ))}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>

              {/* Projects */}
              {tailoredResume.projects.length > 0 && (
                <div className="tailored-section-card">
                  <h3 className="tailored-section-title">Notable Projects</h3>
                  <div className="projects-ranked-list">
                    {tailoredResume.projects.map((proj) => (
                      <div key={proj.projectId} className="ranked-project-item">
                        <div className="proj-header-row">
                          <h4 className="proj-title-text">{proj.title}</h4>
                          <span className="proj-relevance-pill">{proj.relevanceScore}% Match</span>
                        </div>
                        {proj.technologiesUsed.length > 0 && (
                          <div className="proj-tech-row">
                            {proj.technologiesUsed.map((t) => (
                              <span key={t} className="tech-badge">{t}</span>
                            ))}
                          </div>
                        )}
                        <ul className="ranked-highlights-list">
                          {proj.rankedHighlights.map((h, i) => (
                            <li key={i} className="ranked-highlight-bullet">
                              <span className="bullet-content">{h.text}</span>
                              {h.sourceEvidenceId && (
                                <span className="evidence-badge">🔗 Grounding Verified</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Action Toolbar */}
              <div className="tailoring-actions-bar">
                <button
                  type="button"
                  className="btn-action-primary"
                  onClick={() => {
                    if (profile) {
                      const md = exportResumeAsMarkdown(tailoredResume, profile);
                      handleCopy(md, 'Resume Markdown');
                    }
                  }}
                >
                  Copy Markdown
                </button>
                <button
                  type="button"
                  className="btn-action-secondary"
                  onClick={() => {
                    if (profile) {
                      const txt = exportResumeAsPlainText(tailoredResume, profile);
                      handleCopy(txt, 'Resume Plain Text');
                    }
                  }}
                >
                  Copy Plain Text
                </button>
                <button
                  type="button"
                  className="btn-action-download"
                  onClick={() => {
                    if (profile) {
                      const md = exportResumeAsMarkdown(tailoredResume, profile);
                      const filename = `resume-tailored-${tailoredResume.companyName.toLowerCase().replace(/[^a-z0-9]/g, '-')}.md`;
                      handleDownload(filename, md, 'text/markdown');
                    }
                  }}
                >
                  Download .md
                </button>
                <button
                  type="button"
                  className="btn-action-download"
                  onClick={() => {
                    if (profile) {
                      handleDownloadPdf(
                        'GENERATE_RESUME_PDF',
                        {
                          jobId: undefined,
                          templateId: selectedTemplate,
                          onePageFit,
                          maxBulletsPerItem: undefined,
                          maxProjects: undefined,
                        },
                        `resume-${selectedTemplate}-${tailoredResume.companyName.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${tailoredResume.targetJobTitle.toLowerCase().replace(/[^a-z0-9]/g, '-')}.pdf`
                      );
                    }
                  }}
                >
                  Download PDF ({selectedTemplate.toUpperCase()})
                </button>
              </div>
            </div>
          ) : (
            <div className="tailoring-empty-state">
              <p>No job posting detected. Navigate to a job posting and click Extract.</p>
            </div>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* 2. COVER LETTER VIEW                                                      */}
      {/* ========================================================================= */}
      {activeMode === 'cover_letter' && (
        <div className="tailoring-cover-letter-view">
          {/* Customization Options Bar */}
          <div className="cover-letter-config-bar">
            <div className="config-field">
              <label htmlFor="cl-recipient">Recipient / Team:</label>
              <input
                id="cl-recipient"
                type="text"
                className="config-input"
                placeholder="e.g. Hiring Team or Jane Doe"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
              />
            </div>
            <div className="config-field">
              <label htmlFor="cl-tone">Tone:</label>
              <select
                id="cl-tone"
                className="config-select"
                value={tone}
                onChange={(e) => setTone(e.target.value as any)}
              >
                <option value="technical">Technical Focus</option>
                <option value="conversational">Conversational</option>
                <option value="executive">Executive</option>
              </select>
            </div>
            <button
              type="button"
              className="btn-action-draft"
              onClick={generateLetter}
              disabled={loadingLetter}
            >
              {loadingLetter ? 'Drafting...' : '↻ Generate Letter'}
            </button>
          </div>

          {loadingLetter ? (
            <div className="tailoring-loading-state">
              <div className="loading-spinner" />
              <p>Synthesizing evidence-grounded cover letter...</p>
            </div>
          ) : coverLetter ? (
            <div className="cover-letter-content-layout">
              {/* Fact-Check Verification Card */}
              {letterFactCheck && (
                <div className={`fact-check-card ${letterFactCheck.isPristine ? 'card-pristine' : 'card-warning'}`}>
                  <div className="fact-check-top">
                    <div>
                      <h4 className="fact-check-title">
                        {letterFactCheck.isPristine
                          ? '✓ 100% Evidence-Grounded'
                          : `⚠️ Grounding Verification: ${letterFactCheck.groundingScore}%`}
                      </h4>
                      <p className="fact-check-desc">
                        {letterFactCheck.verifiedStatements.length} verified statements cited directly from CandidateProfile and EvidenceGraph.
                      </p>
                    </div>
                    <button
                      type="button"
                      className="btn-recheck-grounding"
                      onClick={recheckGrounding}
                      disabled={rechecking}
                      title="Re-audit after manual edits"
                    >
                      {rechecking ? 'Auditing...' : 'Re-check Grounding'}
                    </button>
                  </div>

                  {letterFactCheck.unbackedStatements.length > 0 && (
                    <div className="unbacked-warnings-list">
                      {letterFactCheck.unbackedStatements.map((u, i) => (
                        <div key={i} className="unbacked-warning-pill">
                          <span className="warning-badge">{u.severity.toUpperCase()}</span>
                          <span className="warning-reason">{u.reason}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {recheckError && <p className="form-error-msg">{recheckError}</p>}

              {/* Letter Editor */}
              <div className="cover-letter-editor-container">
                <div className="editor-meta-header">
                  <span>Target: {coverLetter.targetJobTitle} – {coverLetter.companyName}</span>
                  <span>{editedLetterText.split(/\s+/).filter(Boolean).length} words</span>
                </div>
                <textarea
                  className="cover-letter-textarea"
                  rows={14}
                  value={editedLetterText}
                  onChange={(e) => setEditedLetterText(e.target.value)}
                  placeholder="Cover letter text..."
                />
              </div>

              {/* Cited Evidence Accomplishments */}
              {coverLetter.allCitations.length > 0 && (
                <div className="tailored-section-card">
                  <h3 className="tailored-section-title">Verified Evidence Cited</h3>
                  <div className="citations-list">
                    {coverLetter.allCitations.map((cit, idx) => (
                      <div key={idx} className="citation-snippet-card">
                        <span className="citation-num">#{idx + 1}</span>
                        <span className="citation-text">{cit.sourceSnippet}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Export Toolbar */}
              <div className="tailoring-actions-bar">
                <button
                  type="button"
                  className="btn-action-primary"
                  onClick={() => {
                    if (profile) {
                      const md = exportCoverLetterAsMarkdown(
                        { ...coverLetter, fullText: editedLetterText },
                        profile
                      );
                      handleCopy(md, 'Cover Letter Markdown');
                    }
                  }}
                >
                  Copy Markdown
                </button>
                <button
                  type="button"
                  className="btn-action-secondary"
                  onClick={() => {
                    if (profile) {
                      const txt = exportCoverLetterAsPlainText(
                        { ...coverLetter, fullText: editedLetterText },
                        profile
                      );
                      handleCopy(txt, 'Cover Letter Plain Text');
                    }
                  }}
                >
                  Copy Plain Text
                </button>
                <button
                  type="button"
                  className="btn-action-download"
                  onClick={() => {
                    const filename = `cover-letter-${coverLetter.companyName.toLowerCase().replace(/[^a-z0-9]/g, '-')}.txt`;
                    handleDownload(filename, editedLetterText, 'text/plain');
                  }}
                >
                  Download .txt
                </button>
                <button
                  type="button"
                  className="btn-action-download"
                  onClick={() => {
                    handleDownloadPdf(
                      'GENERATE_COVER_LETTER_PDF',
                      {
                        jobId: undefined,
                        recipient,
                        tone,
                      },
                      `cover-letter-${coverLetter.companyName.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${coverLetter.targetJobTitle.toLowerCase().replace(/[^a-z0-9]/g, '-')}.pdf`
                    );
                  }}
                >
                  Download PDF
                </button>
              </div>
            </div>
          ) : (
            <div className="tailoring-empty-state">
              <p>Click "Generate Letter" to draft an evidence-grounded cover letter.</p>
            </div>
          )}
        </div>
      )}

      {/* Pipeline Forward Progression Card */}
      <div className="pipeline-next-step-card">
        <div className="next-step-info">
          <span className="next-step-title">Materials Ready?</span>
          <span className="next-step-desc">
            Proceed to the application form to auto-fill all fields and custom questions in 1 click.
          </span>
        </div>
        <button
          type="button"
          className="btn-primary btn-next-step"
          onClick={() => onNavigateToTab?.('form')}
        >
          Next Step: Auto-Fill Application Form &rarr;
        </button>
      </div>
    </div>
  );
};
