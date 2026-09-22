/**
 * Finite state machine stages governing the lifecycle of a job application.
 *
 * Invariant: Execution automatically halts at `awaiting_user_review`. The system is programmatically
 * forbidden from transitioning directly from `executing_actions` to `submitted`. Only human confirmation
 * triggers the transition to `submitted`.
 */
export type ApplicationState =
  | 'idle'
  | 'detected_job'
  | 'extracting_job'
  | 'matching_profile'
  | 'ready_to_fill'
  | 'dry_run_review'
  | 'executing_actions'
  | 'awaiting_user_review'
  | 'submitted'
  | 'interviewing'
  | 'offered'
  | 'rejected'
  | 'failed'
  | 'archived';

const ALLOWED_TRANSITIONS: Readonly<Record<ApplicationState, readonly ApplicationState[]>> = {
  idle: ['detected_job', 'extracting_job', 'ready_to_fill', 'archived'],
  detected_job: ['extracting_job', 'idle', 'archived'],
  extracting_job: ['matching_profile', 'failed', 'idle', 'archived'],
  matching_profile: ['ready_to_fill', 'failed', 'idle', 'archived'],
  ready_to_fill: ['dry_run_review', 'failed', 'idle', 'archived'],
  dry_run_review: ['executing_actions', 'ready_to_fill', 'idle', 'archived'],
  executing_actions: ['awaiting_user_review', 'failed'],
  awaiting_user_review: ['submitted', 'idle', 'archived'],
  submitted: ['interviewing', 'offered', 'rejected', 'archived'],
  interviewing: ['interviewing', 'offered', 'rejected', 'archived'],
  offered: ['archived', 'rejected'],
  rejected: ['archived', 'interviewing'],
  failed: ['idle', 'ready_to_fill', 'extracting_job', 'archived'],
  archived: ['idle', 'submitted', 'interviewing'],
};

/**
 * Evaluates whether transitioning between two states is permitted by the state machine.
 */
export function isValidStateTransition(from: ApplicationState, to: ApplicationState): boolean {
  if (from === to) return true;
  const allowed = ALLOWED_TRANSITIONS[from];
  return allowed ? allowed.includes(to) : false;
}

/**
 * Checks whether the given state represents a completed or terminal status for the active application cycle.
 */
export function isTerminalState(state: ApplicationState): boolean {
  return state === 'submitted' || state === 'offered' || state === 'rejected' || state === 'archived';
}
