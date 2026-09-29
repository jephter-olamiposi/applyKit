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

export type QuestionTone = 'concise' | 'star' | 'motivational' | 'bullets';

interface InstantQuestionSolverProps {
  readonly className?: string;
  readonly initialOpen?: boolean;
  readonly isDedicatedTab?: boolean;
}

const TONE_OPTIONS: readonly { id: QuestionTone; label: string; desc: string }[] = [
  { id: 'concise', label: '🎯 Concise', desc: 'Direct, factual, outcome-oriented' },
  { id: 'star', label: '⭐ STAR Method', desc: 'Situation, Task, Action, Result' },
  { id: 'motivational', label: '🔥 Motivational', desc: 'Enthusiastic and team-focused' },
  { id: 'bullets', label: '📋 Bullets', desc: 'Impact-focused bullet points' },
];

const LENGTH_PRESETS: readonly { length: number | null; label: string }[] = [
  { length: 150, label: '150 chars' },
  { length: 250, label: '250 chars' },
  { length: 500, label: '500 chars' },
  { length: null, label: 'Unlimited' },
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
  const [confidence, setConfidence] = useState<number | null>(null);
  const [supportingCount, setSupportingCount] = useState<number>(0);
  const [answerNotes, setAnswerNotes] = useState<string | null>(null);

  const [selectedTone, setSelectedTone] = useState<QuestionTone>('concise');
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

      if (res.success && res.answerText) {
        setAnswer(res.answerText);
        setConfidence(res.confidence ?? 0.85);
        setSupportingCount(res.supportingClaimIds?.length ?? 0);
        setAnswerNotes(res.notes || null);
        setFeedback(res.notes || 'Answer ready from verified candidate evidence.');
        setTimeout(() => setFeedback(null), 4000);
      } else {
        setError(res.error || 'Could not generate answer. Verify profile details or AI API key.');
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
        setFeedback('✓ Copied answer to clipboard!');
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
        setFeedback('✓ Successfully inserted into active form field on webpage!');
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
        setFeedback('💾 Answer saved to profile! Future applications will resolve this question automatically in 0ms.');
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

  return (
    <div className={`instant-solver-card ${isDedicatedTab ? 'solver-card-dedicated' : ''} ${className}`}>
      {!isDedicatedTab && (
        <button
          type="button"
          className="instant-solver-toggle"
          onClick={() => setIsOpen(!isOpen)}
          aria-expanded={isOpen}
        >
          <div className="solver-title-group">
            <span className="solver-icon">⚡</span>
            <span className="solver-title">Instant Q&A Copilot</span>
            <span className="solver-tag">Paste & Solve</span>
          </div>
          <span className="solver-arrow">{isOpen ? '▲ Hide' : '▼ Expand'}</span>
        </button>
      )}

      {isOpen && (
        <div className="instant-solver-body">
          {isDedicatedTab && (
            <div className="solver-dedicated-header">
              <div className="solver-dedicated-title-row">
                <span className="solver-dedicated-icon">⚡</span>
                <div>
                  <h3 className="solver-dedicated-title">Instant Q&A Copilot</h3>
                  <p className="solver-dedicated-subtitle">
                    Paste any application question to generate an evidence-backed answer.
                  </p>
                </div>
              </div>
              <div className="solver-feature-pills">
                <span className="feature-pill">⚡ 0ms Offline Fast-Path for Profile Data</span>
                <span className="feature-pill">🛡️ Zero Hallucination Evidence Grounding</span>
              </div>
            </div>
          )}

          {!isDedicatedTab && (
            <p className="instant-solver-desc">
              Did an ATS form miss a custom question? Paste it here to generate an evidence-backed answer and insert it directly into the webpage field.
            </p>
          )}

          {/* Quick Example Chips */}
          <div className="solver-chips-container">
            <span className="solver-chips-label">Quick Try:</span>
            <div className="solver-chips-row">
              {SAMPLE_QUESTIONS.map((sampleQ) => (
                <button
                  key={sampleQ}
                  type="button"
                  className="solver-chip-btn"
                  onClick={() => setQuestion(sampleQ)}
                >
                  {sampleQ}
                </button>
              ))}
            </div>
          </div>

          {/* Question Input */}
          <div className="solver-input-group">
            <label htmlFor="ad-hoc-question" className="solver-input-label">
              Application Question:
            </label>
            <textarea
              id="ad-hoc-question"
              rows={isDedicatedTab ? 3 : 2}
              className="solver-textarea"
              placeholder="e.g. Why are you interested in this role? or What country are you in? or Tell us about your experience..."
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
          </div>

          {/* Tone & Length Selectors */}
          <div className="solver-controls-row">
            {/* Tone Selector */}
            <div className="solver-control-group">
              <span className="solver-control-label">Tone:</span>
              <div className="solver-btn-group" role="group" aria-label="Answer Tone">
                {TONE_OPTIONS.map((tone) => (
                  <button
                    key={tone.id}
                    type="button"
                    className={`solver-option-btn ${selectedTone === tone.id ? 'solver-option-active' : ''}`}
                    onClick={() => setSelectedTone(tone.id)}
                    title={tone.desc}
                  >
                    {tone.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Length Presets */}
            <div className="solver-control-group">
              <span className="solver-control-label">Length Limit:</span>
              <div className="solver-btn-group" role="group" aria-label="Length Limit">
                {LENGTH_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    className={`solver-option-btn ${maxLength === preset.length ? 'solver-option-active' : ''}`}
                    onClick={() => setMaxLength(preset.length)}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Generate Button Row */}
          <div className="solver-actions-row">
            <button
              type="button"
              className="btn-solver-generate"
              disabled={isGenerating || !question.trim()}
              onClick={handleGenerateAnswer}
            >
              {isGenerating ? '⚡ Generating Answer...' : '⚡ Generate Grounded Answer'}
            </button>
          </div>

          {/* Error & Feedback Messages */}
          {error && (
            <div className="solver-alert-error" role="alert">
              ⚠️ {error}
            </div>
          )}

          {feedback && (
            <div className="solver-alert-success" role="status">
              {feedback}
            </div>
          )}

          {/* Result Output Box */}
          {answer && (
            <div className="solver-result-box">
              <div className="solver-result-header">
                <span className="solver-result-label">Generated Grounded Answer:</span>
                <div className="solver-badges-group">
                  {confidence !== null && (
                    <span className="solver-confidence-badge">
                      {Math.round(confidence * 100)}% Confidence
                      {supportingCount > 0 ? ` (${supportingCount} claim${supportingCount === 1 ? '' : 's'})` : ''}
                    </span>
                  )}
                  <span className={`char-counter-badge ${isOverLimit ? 'char-counter-over' : ''}`}>
                    {currentChars}{maxLength !== null ? ` / ${maxLength}` : ''} chars
                  </span>
                </div>
              </div>

              {answerNotes && (
                <div className="solver-result-note">
                  ℹ️ {answerNotes}
                </div>
              )}

              <textarea
                rows={isDedicatedTab ? 6 : 4}
                className="solver-answer-textarea"
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder="Candidate answer text..."
              />

              <div className="solver-result-actions">
                <button
                  type="button"
                  className="btn-solver-copy"
                  onClick={handleCopy}
                  title="Copy answer to clipboard"
                >
                  📋 Copy Answer
                </button>
                <button
                  type="button"
                  className="btn-solver-save"
                  disabled={isSaving}
                  onClick={handleSaveToProfile}
                  title="Save this answer to your verified profile for automatic future reuse"
                >
                  {isSaving ? 'Saving...' : '💾 Save to Profile'}
                </button>
                <button
                  type="button"
                  className="btn-solver-insert"
                  disabled={isInserting}
                  onClick={handleInsert}
                  title="Insert this text directly into the focused field on the application webpage"
                >
                  {isInserting ? 'Inserting...' : '⚡ Insert into Focused Field'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
