/**
 * @fileoverview Form Execution Protocol & Reporting Types.
 *
 * Defines the contract and audit telemetry produced when declarative BrowserAction
 * sequences are executed on the host webpage's DOM.
 */

import type { ActionId, PlanId } from '../types/ids.js';

/**
 * Cadence mode for simulated human interaction pacing.
 */
export type PacingCadenceMode = 'natural' | 'fast' | 'instant';

/**
 * Options configuring browser action execution pacing, human typing cadence, and visual feedback.
 */
export interface ExecutionOptions {
  /**
   * Pacing delay in milliseconds injected between consecutive DOM interactions.
   * Default: 150ms. Mimics natural human pacing and allows reactive frameworks
   * (React, Angular, Vue) sufficient microtask cycles to process state updates.
   */
  readonly pacingDelayMs?: number;

  /**
   * Overall pacing cadence mode:
   * - 'natural': Human-paced with randomized keystroke intervals and coordinate jitter (default).
   * - 'fast': Low-delay typing (10-30ms) suitable for rapid execution.
   * - 'instant': Single-burst programmatic assignment without progressive delay.
   */
  readonly pacingMode?: PacingCadenceMode;

  /**
   * Whether to simulate progressive keystroke-by-keystroke entry rather than single-step assignment.
   * Default: true in 'natural' mode, false in 'instant'.
   */
  readonly simulateKeystrokes?: boolean;

  /**
   * Minimum delay between keystrokes in milliseconds (used in progressive typing).
   * Default: 25ms.
   */
  readonly minKeystrokeDelayMs?: number;

  /**
   * Maximum delay between keystrokes in milliseconds (used in progressive typing).
   * Default: 85ms.
   */
  readonly maxKeystrokeDelayMs?: number;

  /**
   * Whether to add natural spatial coordinate jitter to simulated mouse clicks.
   * Default: true.
   */
  readonly addCoordinateJitter?: boolean;

  /**
   * Whether to temporarily render a visual outline around elements as they are modified.
   * Default: true. Provides transparent visual cues to the candidate during execution.
   */
  readonly highlightElements?: boolean;
}

/**
 * Details of a single planned action that encountered a DOM error during execution.
 */
export interface FailedActionDetail {
  readonly actionId: ActionId;
  readonly selector: string;
  readonly error: string;
}

/**
 * Immutable audit report generated upon completion of a DryRunPlan execution sequence.
 */
export interface ExecutionReport {
  readonly planId: PlanId;
  /** Total number of actions targeted in this execution run. */
  readonly totalPlanned: number;
  /** Number of actions executed without errors. */
  readonly executedCount: number;
  /** Number of actions that threw errors or could not locate their target element. */
  readonly failedCount: number;
  /**
   * Security Invariant (ADR-0006): Confirms that execution halted safely prior to any
   * submission controls, requiring final human manual confirmation.
   */
  readonly haltedAtSubmissionGate: boolean;
  /** Ordered list of unique action IDs successfully executed. */
  readonly executedActionIds: readonly ActionId[];
  /** Detailed failure records for any failed actions. */
  readonly failedActions: readonly FailedActionDetail[];
  /** Total execution duration in milliseconds including pacing intervals. */
  readonly durationMs: number;
  /** ISO 8601 timestamp marking completion. */
  readonly completedAt: string;
}
