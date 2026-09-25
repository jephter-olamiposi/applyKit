/**
 * @fileoverview Instant Question Solver Component for Side Panel UI.
 *
 * Provides a dedicated, evidence-grounded solver for application questions
 * missed or not captured by the automated form crawler (ADR-0004, ADR-0026):
 * 1. Accepts any pasted question from the ATS webpage.
 * 2. Grounds the response strictly in the candidate's verified evidence graph and claims.
 * 3. Provides 1-click clipboard copy or direct insertion into the currently focused DOM field.
 */

import React, { useState } from 'react';
import { sendToBackground } from '../../messages/bridge.js';
import type {
  AnswerAdHocQuestionRequest,
  AnswerAdHocQuestionResponse,
  InsertTextIntoActiveElementRequest,
  InsertTextIntoActiveElementResponse,
} from '../../messages/contracts.js';

interface InstantQuestionSolverProps {
  className?: string;
}

export const InstantQuestionSolver: React.FC<InstantQuestionSolverProps> = ({ className = '' }) => {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [confidence, setConfidence] = useState<number | null>(null);
  const [supportingCount, setSupportingCount] = useState<number>(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isInserting, setIsInserting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);

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
      });

      if (res.success && res.answerText) {
        setAnswer(res.answerText);
        setConfidence(res.confidence ?? 0.85);
        setSupportingCount(res.supportingClaimIds?.length ?? 0);
        setFeedback('Answer generated from your verified profile evidence!');
        setTimeout(() => setFeedback(null), 4000);
      } else {
        setError(res.error || 'Could not generate answer. Verify your AI API key is configured.');
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

  return (
    <div className={`instant-solver-card ${className}`}>
      <button
        type="button"
        className="instant-solver-toggle"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
      >
        <div className="solver-title-group">
          <span className="solver-icon">💡</span>
          <span className="solver-title">Instant Question Solver</span>
          <span className="solver-tag">Paste & Solve</span>
        </div>
        <span className="solver-arrow">{isOpen ? '▲ Hide' : '▼ Expand'}</span>
      </button>

      {isOpen && (
        <div className="instant-solver-body">
          <p className="instant-solver-desc">
            Did the form crawler miss a custom question? Paste it here to generate an evidence-backed answer and insert it directly into the focused field on the page.
          </p>

          <div className="solver-input-group">
            <label htmlFor="ad-hoc-question" className="solver-input-label">
              Application Question:
            </label>
            <textarea
              id="ad-hoc-question"
              rows={2}
              className="solver-textarea"
              placeholder="e.g. Why are you interested in this role? or Tell us about your experience with Rust/TypeScript..."
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
          </div>

          <div className="solver-actions-row">
            <button
              type="button"
              className="btn-solver-generate"
              disabled={isGenerating || !question.trim()}
              onClick={handleGenerateAnswer}
            >
              {isGenerating ? '🤖 Generating Grounded Answer...' : '🤖 Generate Answer'}
            </button>
          </div>

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

          {answer && (
            <div className="solver-result-box">
              <div className="solver-result-header">
                <span className="solver-result-label">Generated Grounded Answer:</span>
                {confidence !== null && (
                  <span className="solver-confidence-badge">
                    {Math.round(confidence * 100)}% Confidence ({supportingCount} verified claim{supportingCount === 1 ? '' : 's'})
                  </span>
                )}
              </div>
              <textarea
                rows={4}
                className="solver-answer-textarea"
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
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
                  className="btn-solver-insert"
                  disabled={isInserting}
                  onClick={handleInsert}
                  title="Insert this text directly into the focused field on the application page"
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
