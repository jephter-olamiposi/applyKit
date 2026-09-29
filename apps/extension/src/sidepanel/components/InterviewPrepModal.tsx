/**
 * @fileoverview Evidence-Grounded Role Interview Preparation Modal (Phase 25).
 *
 * Displays tailored technical deep-dive questions, verified STAR behavioral narratives,
 * and company-specific reverse interview questions backed 100% by candidate evidence (ADR-0004).
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

export const InterviewPrepModal: React.FC<InterviewPrepModalProps> = ({
  application,
  candidateProfile,
  evidenceGraph,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<'technical' | 'behavioral' | 'reverse'>('behavioral');
  const [copiedIndex, setCopiedIndex] = useState<string | null>(null);

  // Synthesize prep kit from application and profile data
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
    navigator.clipboard.writeText(text);
    setCopiedIndex(id);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/50">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300">
                🎯 Role Interview Prep Kit
              </span>
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300">
                ✓ 100% Evidence Grounded
              </span>
            </div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white mt-1">
              {application.jobTitle} @ {application.companyName}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xl font-bold p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Culture Themes Bar */}
        {prepKit.culturalThemes.length > 0 && (
          <div className="px-5 py-2.5 bg-indigo-50/60 dark:bg-indigo-950/30 border-b border-indigo-100 dark:border-indigo-900/40 flex items-center gap-2 overflow-x-auto text-xs">
            <span className="font-semibold text-indigo-900 dark:text-indigo-200 shrink-0">Company Focus:</span>
            {prepKit.culturalThemes.slice(0, 3).map((theme, i) => (
              <span
                key={i}
                className="bg-white dark:bg-slate-800 border border-indigo-200 dark:border-indigo-800 text-slate-700 dark:text-slate-300 px-2 py-0.5 rounded-md whitespace-nowrap"
              >
                {theme}
              </span>
            ))}
          </div>
        )}

        {/* Navigation Tabs */}
        <div className="flex border-b border-slate-200 dark:border-slate-800 px-5 pt-2 gap-4 text-xs font-semibold">
          <button
            onClick={() => setActiveTab('behavioral')}
            className={`pb-2.5 border-b-2 transition-colors ${
              activeTab === 'behavioral'
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 dark:border-indigo-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400'
            }`}
          >
            ⭐ STAR Behavioral Stories ({prepKit.behavioralQuestions.length})
          </button>
          <button
            onClick={() => setActiveTab('technical')}
            className={`pb-2.5 border-b-2 transition-colors ${
              activeTab === 'technical'
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 dark:border-indigo-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400'
            }`}
          >
            💻 Technical Deep-Dives ({prepKit.technicalQuestions.length})
          </button>
          <button
            onClick={() => setActiveTab('reverse')}
            className={`pb-2.5 border-b-2 transition-colors ${
              activeTab === 'reverse'
                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 dark:border-indigo-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400'
            }`}
          >
            ❓ Questions to Ask ({prepKit.questionsToAskInterviewer.length})
          </button>
        </div>

        {/* Tab Content */}
        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          {activeTab === 'behavioral' && (
            <div className="space-y-4">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                These questions use the proven <strong>STAR</strong> method (Situation, Task, Action, Result) constructed strictly from your verified experience highlights.
              </p>

              {prepKit.behavioralQuestions.map((q) => {
                const star = q.starStory;
                const fullStoryText = star
                  ? `Situation: ${star.situation}\nTask: ${star.task}\nAction: ${star.action}\nResult: ${star.result}`
                  : '';

                return (
                  <div
                    key={q.id}
                    className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-850 shadow-xs"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                        "{q.question}"
                      </h4>
                      {star && (
                        <button
                          onClick={() => handleCopyText(q.id, fullStoryText)}
                          className="shrink-0 text-xs px-2.5 py-1 rounded-md bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-medium transition-colors"
                        >
                          {copiedIndex === q.id ? '✓ Copied' : '📋 Copy STAR'}
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 italic">
                      Why they ask: {q.relevanceRationale}
                    </p>

                    {star && (
                      <div className="mt-3 grid grid-cols-1 gap-2 text-xs bg-slate-50 dark:bg-slate-900/60 p-3 rounded-lg border border-slate-100 dark:border-slate-800">
                        <div>
                          <strong className="text-indigo-600 dark:text-indigo-400">Situation:</strong>{' '}
                          <span className="text-slate-700 dark:text-slate-300">{star.situation}</span>
                        </div>
                        <div>
                          <strong className="text-indigo-600 dark:text-indigo-400">Task:</strong>{' '}
                          <span className="text-slate-700 dark:text-slate-300">{star.task}</span>
                        </div>
                        <div>
                          <strong className="text-indigo-600 dark:text-indigo-400">Action:</strong>{' '}
                          <span className="text-slate-800 dark:text-slate-200 font-medium">{star.action}</span>
                        </div>
                        <div>
                          <strong className="text-emerald-600 dark:text-emerald-400">Result:</strong>{' '}
                          <span className="text-slate-700 dark:text-slate-300">{star.result}</span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {activeTab === 'technical' && (
            <div className="space-y-4">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Technical questions tailored to the core engineering requirements of this role, paired with talking points from your verified background.
              </p>

              {prepKit.technicalQuestions.map((q) => (
                <div
                  key={q.id}
                  className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-850 shadow-xs"
                >
                  <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                    {q.question}
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 italic">
                    {q.relevanceRationale}
                  </p>

                  <div className="mt-3">
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Recommended Talking Points:
                    </span>
                    <ul className="mt-1 space-y-1 text-xs text-slate-600 dark:text-slate-300 list-disc list-inside">
                      {q.talkingPoints.map((tp, i) => (
                        <li key={i}>{tp}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'reverse' && (
            <div className="space-y-4">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Stand out as a thoughtful engineering candidate by asking high-signal questions about architecture, autonomy, and team culture.
              </p>

              <div className="space-y-2">
                {prepKit.questionsToAskInterviewer.map((q, idx) => (
                  <div
                    key={idx}
                    className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-850 flex items-start justify-between gap-3 text-xs"
                  >
                    <span className="text-slate-800 dark:text-slate-200 font-medium">
                      "{q}"
                    </span>
                    <button
                      onClick={() => handleCopyText(`rev_${idx}`, q)}
                      className="shrink-0 px-2 py-0.5 text-xs rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 transition-colors"
                    >
                      {copiedIndex === `rev_${idx}` ? '✓ Copied' : '📋 Copy'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50 flex items-center justify-between">
          <span className="text-xs text-slate-500 dark:text-slate-400">
            ApplyKit Evidence Grounding Guarantee • No hallucinated metrics
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold transition-colors"
          >
            Close Prep Kit
          </button>
        </div>
      </div>
    </div>
  );
};
