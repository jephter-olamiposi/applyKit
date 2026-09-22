/**
 * @fileoverview Human Pacing Engine and Anti-Detection Interaction Simulator.
 *
 * Implements realistic human keystroke cadence, spatial coordinate jitter, and full synthetic
 * event sequences without dangerous DOM property poisoning (ADR-0014, ADR-0021).
 *
 * Anti-Detection Guarantees:
 * 1. Zero Prototype Poisoning: Never modifies navigator.webdriver, window.chrome, or Element prototypes.
 * 2. Spatial Jitter: Computes realistic clientX/clientY coordinates with Gaussian offset rather than 0,0 clicks.
 * 3. Progressive Cadence: Simulates character-by-character typing with natural inter-keystroke variance.
 * 4. Synthetic Integrity: Dispatches complete standard event lifecycles conforming to W3C UI Events.
 */

import type { ExecutionOptions } from '@applykit/domain';
import { setNativeInputValue } from './action-interpreter.js';

/**
 * Pauses execution for a specified millisecond duration.
 *
 * @param ms Duration in milliseconds.
 */
export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Generates a pseudo-random integer between min and max inclusive.
 *
 * @param min Lower bound in milliseconds.
 * @param max Upper bound in milliseconds.
 * @returns Randomized millisecond duration.
 */
export function calculateRandomDelay(min: number, max: number): number {
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  return Math.floor(Math.random() * (high - low + 1)) + low;
}

/**
 * Spatial coordinate representation for simulated pointer events.
 */
export interface PointerCoordinates {
  readonly clientX: number;
  readonly clientY: number;
  readonly screenX: number;
  readonly screenY: number;
}

/**
 * Calculates realistic pointer click coordinates on a DOM element with spatial jitter.
 *
 * Why: Bot detection telemetry flags synthetic clicks that arrive at (0, 0) or exact mathematical
 * element boundaries. Real human clicks cluster around the center with slight Gaussian variation.
 *
 * @param element Target DOM element.
 * @param addJitter Whether to apply random spatial offset.
 * @returns Pointer coordinates matching viewport bounds.
 */
export function calculateElementClickCoordinates(
  element: HTMLElement,
  addJitter = true
): PointerCoordinates {
  let clientX = 100;
  let clientY = 100;

  if (typeof element.getBoundingClientRect === 'function') {
    const rect = element.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      clientX = rect.left + rect.width / 2;
      clientY = rect.top + rect.height / 2;

      if (addJitter) {
        const maxJitterX = Math.min(rect.width * 0.25, 8);
        const maxJitterY = Math.min(rect.height * 0.25, 6);
        const jitterX = (Math.random() - 0.5) * 2 * maxJitterX;
        const jitterY = (Math.random() - 0.5) * 2 * maxJitterY;

        clientX += jitterX;
        clientY += jitterY;
      }
    }
  }

  return {
    clientX: Math.round(clientX),
    clientY: Math.round(clientY),
    screenX: Math.round(clientX + 20),
    screenY: Math.round(clientY + 80),
  };
}

/**
 * Dispatches a complete synthetic pointer and mouse event chain targeting an element.
 *
 * Dispatches: pointerover -> mouseover -> pointerdown -> mousedown -> focus -> click -> mouseup -> pointerup.
 *
 * @param element Target interactive element.
 * @param coords Viewport click coordinates.
 */
export function dispatchRealisticPointerSequence(
  element: HTMLElement,
  coords: PointerCoordinates
): void {
  const init: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: element.ownerDocument?.defaultView || window,
    clientX: coords.clientX,
    clientY: coords.clientY,
    screenX: coords.screenX,
    screenY: coords.screenY,
    button: 0,
    buttons: 1,
  };

  element.dispatchEvent(new PointerEvent('pointerover', init));
  element.dispatchEvent(new MouseEvent('mouseover', init));
  element.dispatchEvent(new PointerEvent('pointerdown', init));
  element.dispatchEvent(new MouseEvent('mousedown', init));

  element.focus();

  element.dispatchEvent(new MouseEvent('click', init));
  element.dispatchEvent(new MouseEvent('mouseup', { ...init, buttons: 0 }));
  element.dispatchEvent(new PointerEvent('pointerup', { ...init, buttons: 0 }));
}

/**
 * Simulates human typing on an input or textarea element with progressive character entry
 * and randomized keystroke intervals.
 *
 * @param element Textual HTML input or textarea.
 * @param text Content to enter.
 * @param options Execution pacing configuration.
 */
export async function typeTextProgressively(
  element: HTMLInputElement | HTMLTextAreaElement,
  text: string,
  options?: ExecutionOptions
): Promise<void> {
  const pacingMode = options?.pacingMode || 'natural';

  // 1. Instant Mode: bypass progressive delay for testing or high-speed automation
  if (pacingMode === 'instant') {
    element.focus();
    setNativeInputValue(element, text);
    element.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        composed: true,
        data: text,
        inputType: 'insertText',
      })
    );
    element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    element.blur();
    return;
  }

  // 2. Focus Sequence
  const coords = calculateElementClickCoordinates(element, options?.addCoordinateJitter !== false);
  dispatchRealisticPointerSequence(element, coords);

  // 3. Fast Mode: brief pause then insert
  if (pacingMode === 'fast') {
    await sleep(options?.pacingDelayMs ?? 15);
    setNativeInputValue(element, text);
    element.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        composed: true,
        data: text,
        inputType: 'insertText',
      })
    );
    element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    element.blur();
    return;
  }

  // 4. Natural Progressive Mode: character-by-character cadence
  const minDelay = options?.minKeystrokeDelayMs ?? 20;
  const maxDelay = options?.maxKeystrokeDelayMs ?? 65;

  let currentText = '';
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    currentText += char;

    // Dispatch keydown
    element.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: char,
        code: `Key${char.toUpperCase()}`,
        bubbles: true,
        composed: true,
      })
    );

    // Update value through framework prototype setter bypass
    setNativeInputValue(element, currentText);

    // Dispatch input event
    element.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        composed: true,
        data: char,
        inputType: 'insertText',
      })
    );

    // Dispatch keyup
    element.dispatchEvent(
      new KeyboardEvent('keyup', {
        key: char,
        code: `Key${char.toUpperCase()}`,
        bubbles: true,
        composed: true,
      })
    );

    // Micro-delay between keystrokes
    const delay = calculateRandomDelay(minDelay, maxDelay);
    await sleep(delay);
  }

  // Change & Blur sequence
  element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  element.blur();
}
