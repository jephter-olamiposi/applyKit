/**
 * @fileoverview Evidence-grounded role interview preparation modal.
 *
 * Displays tailored technical questions, STAR behavioural narratives, and reverse
 * interview questions. Every item is generated from stored candidate evidence, so the
 * modal never claims experience the candidate has not recorded.
 */

import React, { useState, useMemo, useEffect } from 'react';
import { sendToBackground } from '../../messages/bridge.js';
import type {
  GetCandidateProfileRequest,
  GetCandidateProfileResponse,
  GetEvidenceGraphRequest,
  GetEvidenceGraphResponse,
} from '../../messages/contracts.js';
import type { ApplicationRecord, CandidateProfile, EvidenceGraph } from '@applykit/domain';
import {
  generateInterviewPrepKit,
  type InterviewPrepKit,
  extractCompanyCulture,
  createEmptyProfile,
  createProfileId,
  createJobPostingId,
  buildEvidenceGraph,
} from '@applykit/domain';

export interface InterviewPrepModalProps {
  readonly application: ApplicationRecord;
  readonly candidateProfile?: CandidateProfile | null;
  readonly evidenceGraph?: EvidenceGraph | null;
  readonly onClose: () => void;
}

type PrepTab = 'behavioral' | 'technical' | 'reverse';

export const InterviewPrepModal: React.FC<InterviewPrepModalProps> = ({
  application,
  candidateProfile,
  evidenceGraph,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<PrepTab>('behavioral');
  const [copiedIndex, setCopiedIndex] = useState<string | null>(null);
  // The tracker opens this without a profile. It used to fall back to an empty one, so
  // every story and talking point came out generic. Load the real resume instead.
  const [loadedProfile, setLoadedProfile] = useState<CandidateProfile | null>(candidateProfile ?? null);
  const [loadedGraph, setLoadedGraph] = useState<EvidenceGraph | null>(evidenceGraph ?? null);
  const [isLoading, setIsLoading] = useState(!candidateProfile || !evidenceGraph);

  useEffect(() => {
    if (candidateProfile && evidenceGraph) return;
    let cancelled = false;
    void (async () => {
      try {
        const [profileRes, graphRes] = await Promise.all([
          candidateProfile
            ? Promise.resolve(null)
            : sendToBackground<GetCandidateProfileRequest, GetCandidateProfileResponse>({ type: 'GET_CANDIDATE_PROFILE' }),
          evidenceGraph
            ? Promise.resolve(null)
            : sendToBackground<GetEvidenceGraphRequest, GetEvidenceGraphResponse>({ type: 'GET_EVIDENCE_GRAPH' }),
        ]);
        if (cancelled) return;
        if (profileRes?.profile) setLoadedProfile(profileRes.profile);
        if (graphRes?.success) setLoadedGraph(buildEvidenceGraph(graphRes.evidence, graphRes.claims));
      } catch {
        // Falls back to what the profile alone can support.
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [candidateProfile, evidenceGraph]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const prepKit: InterviewPrepKit = useMemo(() => {
    const profile = loadedProfile || createEmptyProfile(createProfileId('prof_default'));
    const graph = loadedGraph || buildEvidenceGraph([], []);

    const job = {
      id: application.jobPostingId || createJobPostingId('job_generic'),
      url: application.jobPostingUrl,
      title: application.jobTitle,
      companyName: application.companyName,
      rawDescription: application.jobDescriptionSnapshot || '',
      requirements: [],
      location: '',
      workplaceType: 'remote' as const,
      employmentType: 'full_time' as const,
      parsedAt: application.updatedAt,
      metadata: { ats: 'generic' },
    };

    const culture = application.jobDescriptionSnapshot
      ? extractCompanyCulture(application.jobDescriptionSnapshot, application.companyName)
      : undefined;

    return generateInterviewPrepKit(job, profile, graph, { culture });
  }, [application, loadedProfile, loadedGraph]);

  const handleCopyText = (id: string, text: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedIndex(id);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  return (
    <div
      className="prep-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`Interview preparation for ${application.jobTitle}`}
    >
      <div className="prep-modal">
        <header className="prep-modal-header">
          <div>
            <p className="prep-eyebrow">Interview prep, from your resume</p>
            <h2 className="prep-title">
              {application.jobTitle} at {application.companyName}
            </h2>
          </div>
          <button type="button" className="prep-close" onClick={onClose} aria-label="Close interview prep">
            &times;
          </button>
        </header>

        {prepKit.culturalThemes.length > 0 && (
          <div className="prep-theme-bar">
            <span className="prep-theme-label">Company focus</span>
            {prepKit.culturalThemes.slice(0, 3).map((theme, i) => (
              <span className="prep-theme-chip" key={`${theme}-${i}`}>
                {theme}
              </span>
            ))}
          </div>
        )}

        <div className="prep-tabs">
          <button
            type="button"
            className={`prep-tab ${activeTab === 'behavioral' ? 'prep-tab-active' : ''}`}
            aria-pressed={activeTab === 'behavioral'}
            onClick={() => setActiveTab('behavioral')}
          >
            Your stories ({prepKit.behavioralQuestions.length})
          </button>
          <button
            type="button"
            className={`prep-tab ${activeTab === 'technical' ? 'prep-tab-active' : ''}`}
            aria-pressed={activeTab === 'technical'}
            onClick={() => setActiveTab('technical')}
          >
            Technical ({prepKit.technicalQuestions.length})
          </button>
          <button
            type="button"
            className={`prep-tab ${activeTab === 'reverse' ? 'prep-tab-active' : ''}`}
            aria-pressed={activeTab === 'reverse'}
            onClick={() => setActiveTab('reverse')}
          >
            To ask them ({prepKit.questionsToAskInterviewer.length})
          </button>
        </div>

        <div className="prep-body">
          {isLoading && <p className="prep-intro">Reading your resume...</p>}
          {!isLoading && activeTab === 'behavioral' && (
            <div className="prep-list">
              <p className="prep-intro">
                Each story is one of your own resume lines laid out as situation, task, action and
                result. Say it in your own words.
              </p>

              {prepKit.behavioralQuestions.map((q) => {
                const star = q.starStory;
                const fullStoryText = star
                  ? `Situation: ${star.situation}\nTask: ${star.task}\nAction: ${star.action}\nResult: ${star.result}`
                  : '';

                return (
                  <article className="prep-card" key={q.id}>
                    <div className="prep-card-head">
                      <h3 className="prep-question">{q.question}</h3>
                      {star && (
                        <button
                          type="button"
                          className="prep-copy-btn"
                          onClick={() => handleCopyText(q.id, fullStoryText)}
                        >
                          {copiedIndex === q.id ? 'Copied' : 'Copy answer'}
                        </button>
                      )}
                    </div>
                    <p className="prep-rationale">{q.relevanceRationale}</p>

                    {star && (
                      <dl className="prep-star">
                        <dt>Situation</dt>
                        <dd>{star.situation}</dd>
                        <dt>Task</dt>
                        <dd>{star.task}</dd>
                        <dt>Action</dt>
                        <dd>{star.action}</dd>
                        <dt>Result</dt>
                        <dd>{star.result}</dd>
                      </dl>
                    )}
                  </article>
                );
              })}
            </div>
          )}

          {!isLoading && activeTab === 'technical' && (
            <div className="prep-list">
              <p className="prep-intro">
                Likely questions for what this job asks for, with points from your resume to
                mention.
              </p>

              {prepKit.technicalQuestions.map((q) => (
                <article className="prep-card" key={q.id}>
                  <h3 className="prep-question">{q.question}</h3>
                  <p className="prep-rationale">{q.relevanceRationale}</p>

                  <div className="prep-points">
                    <span className="prep-points-label">Points to mention</span>
                    <ul className="prep-points-list">
                      {q.talkingPoints.map((tp, i) => (
                        <li key={`${q.id}-point-${i}`}>{tp}</li>
                      ))}
                    </ul>
                  </div>
                </article>
              ))}
            </div>
          )}

          {!isLoading && activeTab === 'reverse' && (
            <div className="prep-list">
              <p className="prep-intro">
                Good questions to ask at the end. Pick two or three.
              </p>

              <div className="prep-reverse-list">
                {prepKit.questionsToAskInterviewer.map((q, idx) => (
                  <div className="prep-reverse-item" key={`reverse-${idx}`}>
                    <span className="prep-reverse-text">{q}</span>
                    <button
                      type="button"
                      className="prep-copy-btn"
                      onClick={() => handleCopyText(`rev_${idx}`, q)}
                    >
                      {copiedIndex === `rev_${idx}` ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <footer className="prep-footer">
          <span className="prep-footer-note">
            Nothing here is invented: it all comes from your resume and the job posting.
          </span>
          <button type="button" className="prep-footer-btn" onClick={onClose}>
            Close
          </button>
        </footer>
      </div>
    </div>
  );
};
