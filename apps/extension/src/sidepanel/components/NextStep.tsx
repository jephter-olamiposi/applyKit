/**
 * @fileoverview The "what now" card at the end of each screen.
 *
 * Every screen ends with one clear next action (read the job, tailor the resume, fill the
 * form, log it), so the candidate never has to work out where to go from a finished step.
 */

import React from 'react';

export interface NextStepProps {
  /** What to do next, as a short instruction. */
  readonly title: string;
  /** One line of help, when the step needs it. */
  readonly hint?: string;
  readonly actionLabel: string;
  readonly onAction: () => void;
  /** A lighter second choice ("Write a cover letter first"). */
  readonly secondary?: { readonly label: string; readonly onAction: () => void };
  readonly disabled?: boolean;
}

export const NextStep: React.FC<NextStepProps> = ({ title, hint, actionLabel, onAction, secondary, disabled }) => (
  <section className="ui-card ui-stack next-step" style={{ gap: 8 }} aria-label="Next step">
    <div>
      <p className="next-step-eyebrow">Next</p>
      <h3 className="ui-card-title">{title}</h3>
      {hint && <p className="ui-subtle" style={{ marginTop: 2 }}>{hint}</p>}
    </div>
    <button type="button" className="ui-btn ui-btn-primary ui-btn-block" onClick={onAction} disabled={disabled}>
      {actionLabel}
    </button>
    {secondary && (
      <button type="button" className="ui-link" style={{ alignSelf: 'flex-start' }} onClick={secondary.onAction}>
        {secondary.label}
      </button>
    )}
  </section>
);
