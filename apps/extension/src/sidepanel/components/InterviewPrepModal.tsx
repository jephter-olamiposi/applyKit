/**
 * @fileoverview Evidence-grounded role interview preparation modal.
 *
 * Displays tailored technical questions, STAR behavioural narratives, and reverse
 * interview questions. Every item is generated from stored candidate evidence, so the
 * modal never claims experience the candidate has not recorded.
 */

import React, { useState, useMemo } from 'react';
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

  const prepKit: InterviewPrepKit = useMemo(() => {
    const profile = candidateProfile || createEmptyProfile(createProfileId('prof_default'));
    const graph = evidenceGraph || buildEvidenceGraph([], []);

    const job = {
      id: application.jobPostingId || createJobPostingId('job_generic'),
      url: application.jobPostingUrl,
      title: application.jobTitle,
      companyName: application.companyName,
      rawDescription: application.jobDescriptionSnapshot || '',
      requirements: [],
      location: 'Remote / Hybrid',
      workplaceType: 'remote' as const,
      employmentType: 'full_time' as const,
      parsedAt: application.updatedAt,
      metadata: { ats: 'generic' },
    };

    const culture = application.jobDescriptionSnapshot
      ? extractCompanyCulture(application.jobDescriptionSnapshot, application.companyName)
      : undefined;

    return generateInterviewPrepKit(job, profile, graph, { culture });
  }, [application, candidateProfile, evidenceGraph]);

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
            <div className="prep-badges">
              <span className="prep-badge">Role interview prep</span>
              <span className="prep-badge prep-badge-grounded">Evidence grounded</span>
            </div>
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
            Behavioural stories ({prepKit.behavioralQuestions.length})
          </button>
          <button
            type="button"
            className={`prep-tab ${activeTab === 'technical' ? 'prep-tab-active' : ''}`}
            aria-pressed={activeTab === 'technical'}
            onClick={() => setActiveTab('technical')}
          >
            Technical questions ({prepKit.technicalQuestions.length})
          </button>
          <button
            type="button"
            className={`prep-tab ${activeTab === 'reverse' ? 'prep-tab-active' : ''}`}
            aria-pressed={activeTab === 'reverse'}
            onClick={() => setActiveTab('reverse')}
          >
            Questions to ask ({prepKit.questionsToAskInterviewer.length})
          </button>
        </div>

        <div className="prep-body">
          {activeTab === 'behavioral' && (
            <div className="prep-list">
              <p className="prep-intro">
                Answers use the situation, task, action, result structure, built from experience
                highlights you have already recorded.
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

          {activeTab === 'technical' && (
            <div className="prep-list">
              <p className="prep-intro">
                Questions based on the core requirements of this role, with talking points from
                your recorded background.
              </p>

              {prepKit.technicalQuestions.map((q) => (
                <article className="prep-card" key={q.id}>
                  <h3 className="prep-question">{q.question}</h3>
                  <p className="prep-rationale">{q.relevanceRationale}</p>

                  <div className="prep-points">
                    <span className="prep-points-label">Talking points</span>
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

          {activeTab === 'reverse' && (
            <div className="prep-list">
              <p className="prep-intro">
                Questions about architecture, autonomy, and team culture that are worth asking in
                the interview.
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
            Built only from your saved profile and recorded evidence.
          </span>
          <button type="button" className="prep-footer-btn" onClick={onClose}>
            Close
          </button>
        </footer>
      </div>
    </div>
  );
};
