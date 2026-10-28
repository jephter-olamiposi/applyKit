/**
 * @fileoverview The Resume tab: the tailored resume and cover letter for the current job.
 *
 * Resume: a readable preview, the few layout choices, downloads, and a plain account of
 * what changed and anything that must be fixed before sending (ADR-0004). Cover letter:
 * a short editable draft whose claims are checked against the resume; downloads use the
 * candidate's edits.
 */

import { NextStep } from './NextStep.js';
import React, { useState, useEffect, useCallback } from 'react';
import type {
  TailoredResume,
  TailoredCoverLetter,
  FactCheckReport,
  CandidateProfile,
  ResumeTemplateId,
  ResumeQualityAuditReport,
  SpacingDensity,
} from '@applykit/domain';
import {
  exportResumeAsMarkdown,
  exportResumeAsPlainText,
  exportCoverLetterAsPlainText,
  generateResumePdfBlob,
  generateCoverLetterPdfBlob,
  generateResumeDocxBlob,
  generateCoverLetterDocxBlob,
  getStandardResumeFilename,
  getStandardCoverLetterFilename,
  getApplicationFolderName,
  withEditedLetterText,
} from '@applykit/domain';
import { sendToBackground } from '../../messages/bridge.js';
import { PdfPreviewCanvas } from './PdfPreviewCanvas.js';
import { downloadBlob } from '../download-manager.js';
import type {
  GenerateTailoredResumeResponse,
  GenerateCoverLetterResponse,
  GenerateCoverLetterPdfResponse,
  GenerateResumePdfResponse,
  GenerateResumeDocxResponse,
  GenerateCoverLetterDocxResponse,
  FactCheckDocumentResponse,
  GetCandidateProfileResponse,
  ExtensionRequest,
  AutoFixResumeRequest,
  AutoFixResumeResponse,
  RewordResumeWithAiRequest,
  RewordResumeWithAiResponse,
} from '../../messages/contracts.js';

interface TailoringStudioProps {
  onNavigateToTab?: (tabId: any) => void;
  initialMode?: 'resume' | 'cover_letter';
  showModeSwitcher?: boolean;
}

export const TailoringStudio: React.FC<TailoringStudioProps> = ({
  onNavigateToTab,
  initialMode = 'resume',
  showModeSwitcher = true,
}) => {
  const [activeMode, setActiveMode] = useState<'resume' | 'cover_letter'>(initialMode);

  // Resume State
  const [tailoredResume, setTailoredResume] = useState<TailoredResume | null>(null);
  const [, setResumeFactCheck] = useState<FactCheckReport | null>(null);
  const [qualityAudit, setQualityAudit] = useState<ResumeQualityAuditReport | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<ResumeTemplateId>('modern');
  const [onePageFit, setOnePageFit] = useState<boolean>(false);
  const [resumeDensity, setResumeDensity] = useState<SpacingDensity>('standard');
  // Off by default: a resume normally does not print the target job title under the name.
  const [showTargetBadge, setShowTargetBadge] = useState<boolean>(false);
  // On by default: the resume cheat sheet says to name the company you are applying to.
  const [mentionCompany, setMentionCompany] = useState<boolean>(true);
  const [resumeBlobUrl, setResumeBlobUrl] = useState<string | null>(null);
  const [isRenderingPreview, setIsRenderingPreview] = useState<boolean>(false);
  const [previewRenderError, setPreviewRenderError] = useState<string | null>(null);
  const [isAutoFixing, setIsAutoFixing] = useState<boolean>(false);
  const [isRewording, setIsRewording] = useState<boolean>(false);
  const [rewordChanges, setRewordChanges] = useState<RewordResumeWithAiResponse['changes'] | null>(null);
  const [loadingResume, setLoadingResume] = useState(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [isGeneratingDocx, setIsGeneratingDocx] = useState(false);

  // Cover Letter State
  const [coverLetter, setCoverLetter] = useState<TailoredCoverLetter | null>(null);
  // Every tailored resume shares one filename, so each job's files go in their own folder.
  const applicationFolder = getApplicationFolderName(
    tailoredResume?.companyName ?? coverLetter?.companyName,
    tailoredResume?.targetJobTitle ?? coverLetter?.targetJobTitle
  );
  const [letterFactCheck, setLetterFactCheck] = useState<FactCheckReport | null>(null);
  const [loadingLetter, setLoadingLetter] = useState(false);
  const [editedLetterText, setEditedLetterText] = useState('');
  const [recipient, setRecipient] = useState('');

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
        setError('Could not load your profile.');
      });
  }, []);

  // Live Interactive PDF Preview Generator (ADR-0031)
  useEffect(() => {
    let isCancelled = false;

    if (!tailoredResume) {
      if (resumeBlobUrl) {
        URL.revokeObjectURL(resumeBlobUrl);
        setResumeBlobUrl(null);
      }
      return;
    }

    const timer = setTimeout(async () => {
      try {
        setIsRenderingPreview(true);
        setPreviewRenderError(null);
        const blob = await generateResumePdfBlob(tailoredResume, profile ?? undefined, {
          templateId: selectedTemplate,
          onePageFit,
          density: resumeDensity,
          showTargetBadge,
        });

        if (!isCancelled) {
          const createdUrl = URL.createObjectURL(blob);
          setResumeBlobUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return createdUrl;
          });
        }
      } catch (err) {
        if (!isCancelled) {
          setPreviewRenderError(err instanceof Error ? err.message : 'Failed to render PDF preview');
        }
      } finally {
        if (!isCancelled) {
          setIsRenderingPreview(false);
        }
      }
    }, 150);

    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [tailoredResume, selectedTemplate, onePageFit, resumeDensity, showTargetBadge, profile]);

  // Clean up object URL on unmount
  useEffect(() => {
    return () => {
      if (resumeBlobUrl) {
        URL.revokeObjectURL(resumeBlobUrl);
      }
    };
  }, [resumeBlobUrl]);

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
          mentionCompany?: boolean;
        },
        GenerateTailoredResumeResponse
      >({
        type: 'GENERATE_TAILORED_RESUME',
        templateId: selectedTemplate,
        onePageFit,
        mentionCompany,
      });

      if (!res.success || !res.tailoredResume) {
        throw new Error(res.error || 'Could not tailor your resume.');
      }

      setTailoredResume(res.tailoredResume);
      setResumeFactCheck(res.factCheck || null);
      setQualityAudit(res.qualityAudit || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingResume(false);
    }
  }, [selectedTemplate, onePageFit, mentionCompany]);

  // Refine the generated document without changing source evidence.
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
        throw new Error(res.error || 'Could not fix the wording.');
      }

      setTailoredResume(res.tailoredResume);
      if (res.qualityAudit) {
        setQualityAudit(res.qualityAudit);
      }
      setCopyFeedback('Wording fixed. No facts were changed or added.');
      setTimeout(() => setCopyFeedback(null), 4500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsAutoFixing(false);
    }
  };

  // AI rewording toward this job. The service worker keeps only lines that add no facts.
  const handleRewordWithAi = async () => {
    if (!tailoredResume) return;
    try {
      setIsRewording(true);
      setError(null);
      const res = await sendToBackground<RewordResumeWithAiRequest, RewordResumeWithAiResponse>({
        type: 'REWORD_RESUME_WITH_AI',
        resume: tailoredResume,
      });
      if (!res.success || !res.tailoredResume) {
        throw new Error(res.error || 'Could not reword the resume.');
      }
      setTailoredResume(res.tailoredResume);
      if (res.qualityAudit) setQualityAudit(res.qualityAudit);
      setRewordChanges(res.changes ?? []);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(/api key|no provider|not configured|unauthor/i.test(message) ? 'Add an AI key in Settings to reword your resume with AI.' : message);
    } finally {
      setIsRewording(false);
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
        },
        GenerateCoverLetterResponse
      >({
        type: 'GENERATE_COVER_LETTER',
        recipient: recipient.trim() || undefined,
      });

      if (!res.success || !res.coverLetter) {
        throw new Error(res.error || 'Could not write the letter.');
      }

      setCoverLetter(res.coverLetter);
      setEditedLetterText(res.coverLetter.fullText);
      setLetterFactCheck(res.factCheck || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingLetter(false);
    }
  }, [recipient]);

  // Initial load on mount. The letter is written on request, because the candidate may
  // want to set who it's addressed to first.
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
      setRecheckError('Could not check the letter. Try again.');
    } finally {
      setRechecking(false);
    }
  };

  // Clipboard Copy Helper
  const handleCopy = (text: string, label: string) => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopyFeedback(`${label} copied.`);
        setTimeout(() => setCopyFeedback(null), 3000);
      })
      .catch(() => {
        setCopyFeedback(`Could not copy. Your browser blocked clipboard access.`);
        setTimeout(() => setCopyFeedback(null), 3000);
      });
  };

  // File Download Helper

  // PDF Download Helper: Generates vector PDF directly in the client (ADR-0026) with background RPC fallback
  const handleDownloadPdf = async (
    requestType: 'GENERATE_COVER_LETTER_PDF' | 'GENERATE_RESUME_PDF',
    payload: Record<string, unknown>,
    filename: string
  ) => {
    setIsGeneratingPdf(true);
    setError(null);
    try {
      let blob: Blob | null = null;

      // 1. Direct client-side generation for instant vector download and zero IPC overhead
      if (requestType === 'GENERATE_RESUME_PDF' && tailoredResume) {
        blob = await generateResumePdfBlob(tailoredResume, profile ?? undefined, {
          templateId: selectedTemplate,
          onePageFit,
          density: resumeDensity,
          showTargetBadge,
        });
      } else if (requestType === 'GENERATE_COVER_LETTER_PDF' && coverLetter) {
        blob = await generateCoverLetterPdfBlob(coverLetter);
      }

      // 2. Fallback to background service worker RPC if client state is not available
      if (!blob) {
        const res = await sendToBackground<
          ExtensionRequest,
          GenerateCoverLetterPdfResponse | GenerateResumePdfResponse
        >({
          type: requestType,
          payload: {
            ...payload,
            density: resumeDensity,
            showTargetBadge,
          },
        } as unknown as ExtensionRequest);

        if (!res.success || !res.pdfBase64) {
          throw new Error(res.error || 'Failed to generate PDF');
        }

        const binaryString = atob(res.pdfBase64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        blob = new Blob([bytes], { type: 'application/pdf' });
      }

      if (blob) {
        await downloadBlob(blob, filename, applicationFolder);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to download PDF');
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  // DOCX Download Helper: Generates native Word document directly in client (ADR-0043, SKILL.md) with background fallback
  const handleDownloadDocx = async (
    requestType: 'GENERATE_RESUME_DOCX' | 'GENERATE_COVER_LETTER_DOCX',
    payload: Record<string, unknown>,
    suggestedFilename?: string
  ) => {
    setIsGeneratingDocx(true);
    setError(null);
    try {
      let blob: Blob | null = null;
      let filename = suggestedFilename;

      // 1. Direct client-side generation for instant file download and zero IPC overhead
      if (requestType === 'GENERATE_RESUME_DOCX' && tailoredResume) {
        blob = await generateResumeDocxBlob(tailoredResume, profile ?? undefined, {
          templateId: selectedTemplate,
          density: resumeDensity,
          showTargetBadge,
        });
        filename = filename || getStandardResumeFilename(profile, 'docx');
      } else if (requestType === 'GENERATE_COVER_LETTER_DOCX' && coverLetter) {
        blob = await generateCoverLetterDocxBlob(coverLetter, profile ?? undefined);
        filename = filename || getStandardCoverLetterFilename(profile, 'docx');
      }

      // 2. Fallback to background service worker RPC if client state is not available
      if (!blob) {
        const res = await sendToBackground<
          ExtensionRequest,
          GenerateCoverLetterDocxResponse | GenerateResumeDocxResponse
        >({
          type: requestType,
          payload: {
            ...payload,
            density: resumeDensity,
            showTargetBadge,
          },
        } as unknown as ExtensionRequest);

        if (!res.success || !res.docxBase64) {
          throw new Error(res.error || 'Failed to generate Word document');
        }

        const binaryString = atob(res.docxBase64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        blob = new Blob([bytes], {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        });
        if (res.filename) {
          filename = res.filename;
        }
      }

      if (blob) {
        await downloadBlob(blob, filename || 'Resume.docx', applicationFolder);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to download Word document');
    } finally {
      setIsGeneratingDocx(false);
    }
  };

  // Letter downloads are built from the candidate's edited text, not the first draft.
  const handleDownloadLetterPdf = async (letter: TailoredCoverLetter) => {
    setIsGeneratingPdf(true);
    setError(null);
    try {
      const blob = await generateCoverLetterPdfBlob(letter);
      await downloadBlob(blob, getStandardCoverLetterFilename(profile, 'pdf'), getApplicationFolderName(letter.companyName, letter.targetJobTitle));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the PDF.');
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const handleDownloadLetterDocx = async (letter: TailoredCoverLetter) => {
    setIsGeneratingDocx(true);
    setError(null);
    try {
      const blob = await generateCoverLetterDocxBlob(letter, profile ?? undefined);
      await downloadBlob(blob, getStandardCoverLetterFilename(profile, 'docx'), getApplicationFolderName(letter.companyName, letter.targetJobTitle));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the Word file.');
    } finally {
      setIsGeneratingDocx(false);
    }
  };

  const honestyIssues = qualityAudit
    ? [qualityAudit.checks.no_placeholders, qualityAudit.checks.facts_traceable]
        .filter((check) => check && check.status === 'failed')
        .flatMap((check) => check!.recommendations)
    : [];
  const styleIssues = qualityAudit
    ? Object.values(qualityAudit.checks).filter(
        (check) => check.status !== 'passed' && check.id !== 'no_placeholders' && check.id !== 'facts_traceable'
      )
    : [];
  const letterForExport = coverLetter ? withEditedLetterText(coverLetter, editedLetterText) : null;
  const wordCount = editedLetterText.split(/\s+/).filter(Boolean).length;

  return (
    <div className="ui-stack" role="region" aria-label={activeMode === 'resume' ? 'Resume' : 'Cover letter'}>
      {showModeSwitcher && (
        <div className="ui-segmented" role="group" aria-label="Document">
          <button type="button" aria-pressed={activeMode === 'resume'} onClick={() => setActiveMode('resume')}>
            Resume
          </button>
          <button
            type="button"
            aria-pressed={activeMode === 'cover_letter'}
            onClick={() => {
              setActiveMode('cover_letter');
              if (!coverLetter && !loadingLetter) generateLetter();
            }}
          >
            Cover letter
          </button>
        </div>
      )}

      {copyFeedback && <div className="ui-note ui-note-good" role="status">{copyFeedback}</div>}
      {error && (
        <div className="ui-note ui-note-bad" role="alert">
          {error}
          {/No job|extract|posting/i.test(error) && onNavigateToTab && (
            <div style={{ marginTop: 6 }}>
              <button type="button" className="ui-link" onClick={() => onNavigateToTab('overview')}>
                Read a job first
              </button>
            </div>
          )}
        </div>
      )}

      {activeMode === 'resume' && (
        <>
          {loadingResume && !tailoredResume && <p className="ui-subtle">Tailoring your resume for this job...</p>}

          {tailoredResume && (
            <>
              <div className="ui-spread">
                <p className="ui-text">
                  For <strong>{tailoredResume.targetJobTitle}</strong> at {tailoredResume.companyName}
                </p>
                <button type="button" className="ui-link" onClick={generateResume} disabled={loadingResume}>
                  {loadingResume ? 'Updating...' : 'Redo'}
                </button>
              </div>

              {honestyIssues.length > 0 ? (
                <div className="ui-note ui-note-bad" role="alert">
                  <strong style={{ fontWeight: 600 }}>Fix these before you send it:</strong>
                  <ul style={{ margin: '4px 0 0 16px' }}>
                    {honestyIssues.slice(0, 5).map((issue) => (
                      <li key={issue}>{issue}</li>
                    ))}
                  </ul>
                  {onNavigateToTab && (
                    <button type="button" className="ui-link" style={{ marginTop: 6 }} onClick={() => onNavigateToTab('profile')}>
                      Edit your profile
                    </button>
                  )}
                </div>
              ) : (
                <div className="ui-note ui-note-good">Everything on this resume comes from what you wrote. Nothing was added.</div>
              )}

              <PdfPreviewCanvas
                blobUrl={resumeBlobUrl}
                isGenerating={isRenderingPreview}
                filename={getStandardResumeFilename(profile, 'pdf')}
                docxFilename={getStandardResumeFilename(profile, 'docx')}
                isGeneratingDocx={isGeneratingDocx}
                onDownload={() => {
                  if (profile) {
                    handleDownloadPdf(
                      'GENERATE_RESUME_PDF',
                      { templateId: selectedTemplate, onePageFit, density: resumeDensity, showTargetBadge },
                      getStandardResumeFilename(profile, 'pdf')
                    );
                  }
                }}
                onDownloadDocx={() => {
                  handleDownloadDocx(
                    'GENERATE_RESUME_DOCX',
                    { templateId: selectedTemplate, density: resumeDensity, showTargetBadge },
                    getStandardResumeFilename(profile, 'docx')
                  );
                }}
                templateId={selectedTemplate}
                density={resumeDensity}
                onePageFit={onePageFit}
                showTargetBadge={showTargetBadge}
                onTemplateChange={(t) => setSelectedTemplate(t)}
                onDensityChange={(d) => setResumeDensity(d)}
                onOnePageFitToggle={(fit) => setOnePageFit(fit)}
                onShowTargetBadgeToggle={(show) => setShowTargetBadge(show)}
                companyName={tailoredResume.companyName}
                mentionCompany={mentionCompany}
                onMentionCompanyToggle={(on) => setMentionCompany(on)}
                error={previewRenderError}
              />

              <section className="ui-card" aria-label="Reword with AI">
                <div className="ui-spread">
                  <div>
                    <h3 className="ui-card-title">Reword for this job</h3>
                    <p className="ui-subtle">
                      The AI rewrites your summary and bullets in this job's language. Any line that adds a number, tool, or name you did not write is thrown out.
                    </p>
                  </div>
                </div>
                <button type="button" className="ui-btn ui-btn-block" style={{ marginTop: 8 }} disabled={isRewording} onClick={handleRewordWithAi}>
                  {isRewording ? 'Rewording...' : 'Reword with AI'}
                </button>
                {rewordChanges && (
                  <div className="ui-stack" style={{ gap: 6, marginTop: 10 }}>
                    <p className="ui-text">
                      {rewordChanges.filter((c) => c.accepted).length === 0
                        ? 'Nothing changed. Your wording already fits, or every suggestion added something you did not write.'
                        : `Reworded ${rewordChanges.filter((c) => c.accepted).length} line${rewordChanges.filter((c) => c.accepted).length === 1 ? '' : 's'}.`}
                      {rewordChanges.some((c) => !c.accepted)
                        ? ` Kept ${rewordChanges.filter((c) => !c.accepted).length} as you wrote them because the AI changed the facts.`
                        : ''}
                    </p>
                    <details className="ui-details">
                      <summary>See each change</summary>
                      <ul className="ui-list">
                        {rewordChanges.map((change) => (
                          <li key={change.id}>
                            <span className={`ui-chip ${change.accepted ? 'ui-chip-good' : 'ui-chip-warn'}`}>{change.accepted ? 'Used' : `Kept yours: ${change.reason}`}</span>
                            <p className="ui-subtle" style={{ marginTop: 4 }}>Before: {change.before}</p>
                            <p className="ui-text">After: {change.after}</p>
                          </li>
                        ))}
                      </ul>
                    </details>
                  </div>
                )}
              </section>

              <details className="ui-details ui-card">
                <summary>What changed for this job</summary>
                <div className="ui-stack" style={{ gap: 10 }}>
                  <div>
                    <p className="ui-label">Summary</p>
                    <p className="ui-text">{tailoredResume.tailoredSummary}</p>
                  </div>
                  {tailoredResume.skills.matchedRequired.length + tailoredResume.skills.matchedPreferred.length > 0 && (
                    <div>
                      <p className="ui-label">Skills moved to the front because the job asks for them</p>
                      <div className="ui-row" style={{ gap: 4 }}>
                        {[...tailoredResume.skills.matchedRequired, ...tailoredResume.skills.matchedPreferred].map((skill) => (
                          <span key={skill} className="ui-chip ui-chip-good">{skill}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  <div>
                    <p className="ui-label">Each role now leads with</p>
                    <ul className="ui-list">
                      {tailoredResume.experiences.map((exp) => (
                        <li key={exp.experienceId}>
                          <span style={{ color: 'var(--text)', fontWeight: 600 }}>{[exp.title, exp.company].filter(Boolean).join(', ')}</span>
                          {exp.rankedHighlights[0] && <p className="ui-subtle">{exp.rankedHighlights[0].text}</p>}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </details>

              {qualityAudit && styleIssues.length > 0 && (
                <details className="ui-details ui-card">
                  <summary>
                    Writing checks: {styleIssues.length} thing{styleIssues.length === 1 ? '' : 's'} to look at
                  </summary>
                  <ul className="ui-list">
                    {styleIssues.map((check) => (
                      <li key={check.id}>
                        <span style={{ color: 'var(--text)' }}>{check.name}</span>
                        <p className="ui-subtle">{check.description}</p>
                        {check.recommendations.slice(0, 2).map((rec) => (
                          <p key={rec} className="ui-subtle">{rec}</p>
                        ))}
                      </li>
                    ))}
                  </ul>
                  <button type="button" className="ui-btn ui-btn-sm" disabled={isAutoFixing} onClick={handleAutoFix}>
                    {isAutoFixing ? 'Fixing...' : 'Fix wording automatically'}
                  </button>
                </details>
              )}

              <div className="ui-row" style={{ gap: 14 }}>
                <button
                  type="button"
                  className="ui-link"
                  onClick={() => {
                    if (profile) handleCopy(exportResumeAsPlainText(tailoredResume, profile), 'Resume text');
                  }}
                >
                  Copy as plain text
                </button>
                <button
                  type="button"
                  className="ui-link"
                  onClick={() => {
                    if (profile) handleCopy(exportResumeAsMarkdown(tailoredResume, profile), 'Resume Markdown');
                  }}
                >
                  Copy as Markdown
                </button>
              </div>
            </>
          )}
        </>
      )}

      {activeMode === 'cover_letter' && (
        <>
          {!coverLetter && (
            <section className="ui-card ui-stack" style={{ gap: 10 }}>
              <p className="ui-text">
                A short letter in your voice: why this role, two results from your resume, and a plain close. You can edit
                every word before downloading.
              </p>
              <label>
                <span className="ui-label">Who it's addressed to (optional)</span>
                <input
                  className="ui-input"
                  type="text"
                  placeholder="e.g. Ada Lovelace, or leave blank"
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                />
              </label>
              <button type="button" className="ui-btn ui-btn-primary ui-btn-block" onClick={generateLetter} disabled={loadingLetter}>
                {loadingLetter ? 'Writing...' : 'Write my cover letter'}
              </button>
            </section>
          )}

          {coverLetter && (
            <>
              {letterFactCheck &&
                (letterFactCheck.unbackedStatements.length === 0 ? (
                  <div className="ui-note ui-note-good">Every claim in this letter comes from your resume.</div>
                ) : (
                  <div className="ui-note ui-note-warn" role="alert">
                    <strong style={{ fontWeight: 600 }}>Check these sentences. Your resume doesn't back them up:</strong>
                    <ul style={{ margin: '4px 0 0 16px' }}>
                      {letterFactCheck.unbackedStatements.slice(0, 4).map((u) => (
                        <li key={u.statement}>“{u.statement}”</li>
                      ))}
                    </ul>
                  </div>
                ))}
              {recheckError && <div className="ui-note ui-note-bad">{recheckError}</div>}

              <div>
                <div className="ui-spread" style={{ marginBottom: 4 }}>
                  <span className="ui-subtle">Edit freely. Downloads use your edits.</span>
                  <span className="ui-subtle">{wordCount} words</span>
                </div>
                <textarea
                  className="ui-textarea"
                  rows={16}
                  value={editedLetterText}
                  onChange={(e) => setEditedLetterText(e.target.value)}
                  aria-label="Cover letter"
                />
              </div>

              <div className="ui-row">
                <button
                  type="button"
                  className="ui-btn ui-btn-primary"
                  style={{ flex: 1 }}
                  disabled={isGeneratingPdf || !letterForExport}
                  onClick={() => letterForExport && handleDownloadLetterPdf(letterForExport)}
                >
                  {isGeneratingPdf ? 'Preparing PDF...' : 'Download PDF'}
                </button>
                <button
                  type="button"
                  className="ui-btn"
                  style={{ flex: 1 }}
                  disabled={isGeneratingDocx || !letterForExport}
                  onClick={() => letterForExport && handleDownloadLetterDocx(letterForExport)}
                >
                  {isGeneratingDocx ? 'Preparing Word file...' : 'Download Word'}
                </button>
              </div>
              <div className="ui-row" style={{ gap: 14 }}>
                <button
                  type="button"
                  className="ui-link"
                  onClick={() => {
                    if (profile && letterForExport) handleCopy(exportCoverLetterAsPlainText(letterForExport, profile), 'Letter');
                  }}
                >
                  Copy text
                </button>
                <button type="button" className="ui-link" onClick={recheckGrounding} disabled={rechecking}>
                  {rechecking ? 'Checking...' : 'Check my edits against my resume'}
                </button>
                <button type="button" className="ui-link" onClick={generateLetter} disabled={loadingLetter}>
                  {loadingLetter ? 'Writing...' : 'Start over'}
                </button>
              </div>
            </>
          )}
        </>
      )}

      {onNavigateToTab && (tailoredResume || coverLetter) && (
        <NextStep
          title="Fill the application"
          hint="Open the job's application form in this tab. ApplyKit fills what it knows and leaves Submit to you."
          actionLabel="Go to the application"
          onAction={() => onNavigateToTab('prepare_application')}
          secondary={
            activeMode === 'resume'
              ? { label: 'Write a cover letter first', onAction: () => onNavigateToTab('cover_letter') }
              : { label: 'Back to the resume', onAction: () => onNavigateToTab('tailor_resume') }
          }
        />
      )}
    </div>
  );
};
