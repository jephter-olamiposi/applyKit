/**
 * @fileoverview Instant Question Solver & Copilot Q&A Component.
 *
 * Provides a dedicated, evidence-grounded solver for application questions:
 * 1. Fast-path deterministic evaluation: standard profile attributes and saved answers resolve in 0ms offline with 0 API keys.
 * 2. Grounded AI synthesis: narrative questions synthesize strictly against verified evidence claims.
 * 3. Tone controls: Concise, STAR Method, Motivational, or Bullets.
 * 4. Length controls: 150, 250, 500 chars, or Unlimited with live character counter.
 * 5. Actions: 1-click clipboard copy, in-page field insertion, and saving reusable answers to candidate profile.
 */

import React, { useState } from 'react';
import { sendToBackground } from '../../messages/bridge.js';
import type {
  AnswerAdHocQuestionRequest,
  AnswerAdHocQuestionResponse,
  InsertTextIntoActiveElementRequest,
  InsertTextIntoActiveElementResponse,
  SaveReusableAnswerRequest,
  SaveReusableAnswerResponse,
} from '../../messages/contracts.js';

export type QuestionTone = 'plain' | 'ats_aggressive' | 'concise' | 'star' | 'motivational' | 'bullets';

interface InstantQuestionSolverProps {
  readonly className?: string;
  readonly initialOpen?: boolean;
  readonly isDedicatedTab?: boolean;
}

const TONE_OPTIONS: readonly { id: QuestionTone; label: string; desc: string }[] = [
  { id: 'plain', label: 'Plain', desc: 'Short sentences, first person, real results' },
  { id: 'concise', label: 'Shorter', desc: 'Two or three sentences' },
  { id: 'star', label: 'A story (STAR)', desc: 'Situation, task, action, result' },
  { id: 'motivational', label: 'Warmer', desc: 'Friendly, still factual' },
  { id: 'bullets', label: 'Bullet points', desc: 'Short points, one result each' },
  { id: 'ats_aggressive', label: "Use the job's words", desc: "Uses the posting's terms for skills you have" },
];

const LENGTH_PRESETS: readonly { length: number | null; label: string }[] = [
  { length: 150, label: 'Up to 150 characters' },
  { length: 250, label: 'Up to 250 characters' },
  { length: 500, label: 'Up to 500 characters' },
  { length: null, label: 'Any length' },
];

const SAMPLE_QUESTIONS = [
  'What country are you located in?',
  'Are you legally authorized to work?',
  'What is your target salary expectation?',
  'What is your notice period?',
  'Why are you interested in this role?',
] as const;

/**
 * Interactive Instant Q&A copilot component.
 */
export const InstantQuestionSolver: React.FC<InstantQuestionSolverProps> = ({
  className = '',
  initialOpen = true,
  isDedicatedTab = false,
}) => {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [answerNotes, setAnswerNotes] = useState<string | null>(null);
  const [companySources, setCompanySources] = useState<{ title: string; url: string }[]>([]);
  // A draft that did not pass every check is still shown, with what to look at.
  const [draftProblems, setDraftProblems] = useState<string[]>([]);

  const [selectedTone, setSelectedTone] = useState<QuestionTone>('plain');
  const [maxLength, setMaxLength] = useState<number | null>(null);

  const [isGenerating, setIsGenerating] = useState(false);
  const [isInserting, setIsInserting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(initialOpen || isDedicatedTab);

  const handleGenerateAnswer = async () => {
    if (!question.trim()) {
      setError('Please paste or type a question to answer.');
      return;
    }

    setIsGenerating(true);
    setError(null);
    setFeedback(null);

    try {
      const res = await sendToBackground<
        AnswerAdHocQuestionRequest,
        AnswerAdHocQuestionResponse
      >({
        type: 'ANSWER_AD_HOC_QUESTION',
        question: question.trim(),
        tone: selectedTone,
        maxLength: maxLength ?? undefined,
      });

      setDraftProblems([]);
      if (res.success && res.answerText) {
        setAnswer(res.answerText);
        setAnswerNotes(res.notes || null);
        setCompanySources(res.companySources ?? []);
      } else if (res.draftText) {
        setAnswer(res.draftText);
        setAnswerNotes(res.error || 'Check this draft before using it.');
        setCompanySources(res.companySources ?? []);
        setDraftProblems(res.problems ?? []);
      } else {
        setError(res.error || 'Could not write an answer. Check your profile, or the AI key in Settings.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopy = () => {
    if (!answer) return;
    navigator.clipboard
      .writeText(answer)
      .then(() => {
        setFeedback('Copied.');
        setTimeout(() => setFeedback(null), 3000);
      })
      .catch(() => {
        setError('Failed to copy to clipboard.');
      });
  };

  const handleInsert = async () => {
    if (!answer) return;
    setIsInserting(true);
    setError(null);

    try {
      const res = await sendToBackground<
        InsertTextIntoActiveElementRequest,
        InsertTextIntoActiveElementResponse
      >({
        type: 'INSERT_TEXT_INTO_ACTIVE_ELEMENT',
        text: answer,
      });

      if (res.success) {
        setFeedback('Inserted into the field on the page.');
        setTimeout(() => setFeedback(null), 4000);
      } else {
        setError(res.error || 'Click into the target text field on the webpage first, then click Insert.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsInserting(false);
    }
  };

  const handleSaveToProfile = async () => {
    if (!question.trim() || !answer.trim()) return;
    setIsSaving(true);
    setError(null);
    setFeedback(null);

    try {
      const res = await sendToBackground<
        SaveReusableAnswerRequest,
        SaveReusableAnswerResponse
      >({
        type: 'SAVE_REUSABLE_ANSWER',
        question: question.trim(),
        answerText: answer.trim(),
      });

      if (res.success) {
        setFeedback('Saved. ApplyKit will reuse it when a form asks the same question.');
        setTimeout(() => setFeedback(null), 5000);
      } else {
        setError(res.error || 'Failed to save answer to profile.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  };

  const currentChars = answer.length;
  const isOverLimit = maxLength !== null && currentChars > maxLength;

  const body = (
    <div className="ui-stack" style={{ gap: 10 }}>
      <p className="ui-subtle">
        Paste a question from the form that ApplyKit didn't fill. Simple ones (location, notice period, links) are answered
        from your profile. Open ones use your resume and need an AI key.
      </p>

      <div className="ui-row" style={{ gap: 6 }}>
        {SAMPLE_QUESTIONS.map((sampleQ) => (
          <button key={sampleQ} type="button" className="ui-chip" style={{ border: 'none', cursor: 'pointer' }} onClick={() => setQuestion(sampleQ)}>
            {sampleQ}
          </button>
        ))}
      </div>

      <label>
        <span className="ui-label">Question</span>
        <textarea
          id="ad-hoc-question"
          rows={isDedicatedTab ? 3 : 2}
          className="ui-textarea"
          style={{ minHeight: 56 }}
          placeholder="e.g. Why do you want to work here?"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
      </label>

      <div className="ui-row">
        <label className="ui-row" style={{ gap: 6 }}>
          <span className="ui-subtle">Style</span>
          <select className="ui-select" style={{ width: 'auto' }} value={selectedTone} onChange={(e) => setSelectedTone(e.target.value as QuestionTone)}>
            {TONE_OPTIONS.map((tone) => (
              <option key={tone.id} value={tone.id} title={tone.desc}>
                {tone.label}
              </option>
            ))}
          </select>
        </label>
        <label className="ui-row" style={{ gap: 6 }}>
          <span className="ui-subtle">Length</span>
          <select
            className="ui-select"
            style={{ width: 'auto' }}
            value={maxLength === null ? 'none' : String(maxLength)}
            onChange={(e) => setMaxLength(e.target.value === 'none' ? null : Number(e.target.value))}
          >
            {LENGTH_PRESETS.map((preset) => (
              <option key={preset.label} value={preset.length === null ? 'none' : String(preset.length)}>
                {preset.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <button type="button" className="ui-btn ui-btn-primary" disabled={isGenerating || !question.trim()} onClick={handleGenerateAnswer}>
        {isGenerating ? 'Writing...' : 'Generate answer'}
      </button>

      {error && <div className="ui-note ui-note-bad" role="alert">{error}</div>}
      {feedback && <div className="ui-note ui-note-good" role="status">{feedback}</div>}

      {answer && (
        <div className="ui-stack" style={{ gap: 6 }}>
          <div className="ui-spread">
            <span className="ui-subtle">{answerNotes || 'Drafted from your resume. Read it before using it.'}</span>
            <span className={`ui-subtle ${isOverLimit ? 'char-counter-over' : ''}`} style={isOverLimit ? { color: 'var(--danger-text)' } : undefined}>
              {currentChars}
              {maxLength !== null ? ` / ${maxLength}` : ''} characters
            </span>
          </div>
          {draftProblems.length > 0 && (
            <div className="ui-note ui-note-warn" role="status">
              Fix or remove these before you use it:
              <ul className="ui-plain-list" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                {draftProblems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            </div>
          )}
          <textarea rows={isDedicatedTab ? 6 : 4} className="ui-textarea" value={answer} onChange={(e) => setAnswer(e.target.value)} aria-label="Answer" />
          {companySources.length > 0 && (
            <details className="ui-details">
              <summary>Where the facts about the company came from ({companySources.length})</summary>
              <ul className="ui-plain-list" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                {companySources.map((source) => (
                  <li key={source.url}>
                    <a className="ui-link" href={source.url} target="_blank" rel="noopener noreferrer">
                      {/* Gemini search links are redirects; their title is the real site. */}
                      {/vertexaisearch|grounding-api-redirect/.test(source.url)
                        ? source.title || 'Web source'
                        : source.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '').slice(0, 70)}
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div className="ui-row">
            <button type="button" className="ui-btn ui-btn-sm ui-btn-primary" disabled={isInserting} onClick={handleInsert}>
              {isInserting ? 'Inserting...' : 'Insert into focused field'}
            </button>
            <button type="button" className="ui-btn ui-btn-sm" onClick={handleCopy}>
              Copy answer
            </button>
            <button type="button" className="ui-btn ui-btn-sm" disabled={isSaving} onClick={handleSaveToProfile}>
              {isSaving ? 'Saving...' : 'Save to profile'}
            </button>
          </div>
          <p className="ui-subtle">To insert, click into the field on the page first.</p>
        </div>
      )}
    </div>
  );

  if (isDedicatedTab) {
    return (
      <section className={`ui-card ${className}`} aria-label="Answer a question">
        <h3 className="ui-card-title" style={{ marginBottom: 8 }}>Answer a question</h3>
        {body}
      </section>
    );
  }

  return (
    <details className={`ui-details ui-card ${className}`} open={isOpen} onToggle={(e) => setIsOpen((e.target as HTMLDetailsElement).open)}>
      <summary>Answer a question the form asks</summary>
      {isOpen && body}
    </details>
  );
};
