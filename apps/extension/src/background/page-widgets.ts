/**
 * @fileoverview Reads and sets React dropdowns that a content script cannot drive.
 *
 * Greenhouse's current application forms (and many other ATS pages) render questions
 * such as "Right to work" or "Where would you like to be based?" with react-select.
 * Its options only exist in React state until a person opens the menu, and it ignores
 * synthetic mouse and keyboard events, so the content script can neither list the
 * options nor pick one. Verified on a live Greenhouse form: dispatched mousedown,
 * ArrowDown, and typed input all left the menu closed, while the component's own
 * `selectOption` set the answer exactly as a click would.
 *
 * The content script runs in an isolated world and cannot see React's internals, so
 * these two functions are executed in the page's MAIN world through
 * `chrome.scripting.executeScript`. They are fixed functions shipped with the
 * extension (no strings are evaluated), they only read option labels and call the
 * component's own selection method, and the results cross back as plain JSON.
 *
 * Both functions are serialized by Chrome, so each must be self-contained: no imports,
 * no references to module scope, helpers declared inside the body.
 */

/** Attribute the annotator writes on each combobox input, read by the form crawlers. */
export const PAGE_OPTIONS_ATTRIBUTE = 'data-applykit-options';

/** One option as seen by the crawler. Values are stringified React option values. */
export interface PageWidgetOption {
  readonly value: string;
  readonly label: string;
}

/** Result of picking an option inside the page. */
export interface PageWidgetPickResult {
  readonly ok: boolean;
  readonly chosenLabel?: string;
  readonly reason?: string;
}

/**
 * MAIN-world: finds every react-select combobox on the page and writes its options
 * onto the input as JSON in {@link PAGE_OPTIONS_ATTRIBUTE}. DOM attributes are shared
 * between worlds, so the content script's synchronous crawler can then read them.
 *
 * @returns The number of comboboxes annotated.
 */
export function annotateReactSelectOptionsInPage(): number {
  const ATTRIBUTE = 'data-applykit-options';
  const MAX_DEPTH = 30;
  const MAX_OPTIONS = 400;

  type SelectProps = { selectOption: (option: unknown) => void; options: unknown[] };

  const findSelectProps = (element: Element): SelectProps | null => {
    const fiberKey = Object.keys(element).find((key) => key.startsWith('__reactFiber$'));
    if (!fiberKey) return null;
    let fiber = (element as unknown as Record<string, any>)[fiberKey];
    for (let depth = 0; fiber && depth < MAX_DEPTH; depth += 1) {
      const props = fiber.memoizedProps;
      if (props && typeof props.selectOption === 'function' && Array.isArray(props.options)) {
        return props as SelectProps;
      }
      fiber = fiber.return;
    }
    return null;
  };

  const flatten = (options: unknown[]): { value: string; label: string }[] => {
    const out: { value: string; label: string }[] = [];
    for (const option of options) {
      if (!option || typeof option !== 'object') continue;
      const record = option as Record<string, unknown>;
      // Grouped options nest their entries under `options`.
      if (Array.isArray(record.options)) {
        out.push(...flatten(record.options));
        continue;
      }
      const label = record.label;
      if (typeof label !== 'string' && typeof label !== 'number') continue;
      out.push({ value: String(record.value ?? label), label: String(label).trim() });
      if (out.length >= MAX_OPTIONS) break;
    }
    return out;
  };

  let annotated = 0;
  for (const input of Array.from(document.querySelectorAll('input[role="combobox"]'))) {
    const props = findSelectProps(input);
    if (!props) continue;
    const options = flatten(props.options);
    if (options.length === 0) continue;
    input.setAttribute(ATTRIBUTE, JSON.stringify(options));
    annotated += 1;
  }
  return annotated;
}

/**
 * MAIN-world: selects the option whose value or label matches `wanted` on the
 * react-select behind the element at `selector`. Matching is exact first, then
 * case- and whitespace-insensitive. It never falls back to a "closest" option:
 * a wrong answer on an application is worse than an unanswered field.
 */
export function pickReactSelectOptionInPage(selector: string, wanted: string): PageWidgetPickResult {
  const MAX_DEPTH = 30;
  const element = document.querySelector(selector);
  if (!element) return { ok: false, reason: 'field not found' };

  const fiberKey = Object.keys(element).find((key) => key.startsWith('__reactFiber$'));
  if (!fiberKey) return { ok: false, reason: 'not a React dropdown' };
  let fiber = (element as unknown as Record<string, any>)[fiberKey];
  let props: { selectOption: (option: unknown) => void; options: unknown[] } | null = null;
  for (let depth = 0; fiber && depth < MAX_DEPTH; depth += 1) {
    const candidate = fiber.memoizedProps;
    if (candidate && typeof candidate.selectOption === 'function' && Array.isArray(candidate.options)) {
      props = candidate;
      break;
    }
    fiber = fiber.return;
  }
  if (!props) return { ok: false, reason: 'not a React dropdown' };

  const flat: Record<string, unknown>[] = [];
  const walk = (options: unknown[]): void => {
    for (const option of options) {
      if (!option || typeof option !== 'object') continue;
      const record = option as Record<string, unknown>;
      if (Array.isArray(record.options)) walk(record.options);
      else flat.push(record);
    }
  };
  walk(props.options);

  const norm = (text: unknown): string => String(text ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  const target = norm(wanted);
  const match =
    flat.find((option) => String(option.value) === wanted || String(option.label) === wanted) ??
    flat.find((option) => norm(option.value) === target || norm(option.label) === target);
  if (!match) return { ok: false, reason: 'no option matches' };

  props.selectOption(match);
  return { ok: true, chosenLabel: String(match.label) };
}

/**
 * Runs {@link annotateReactSelectOptionsInPage} in the given tab frame.
 * Failure is not fatal: the crawler still lists the field, just without options.
 */
export async function annotatePageWidgets(tabId: number, frameId: number | undefined): Promise<number> {
  const [result] = await chrome.scripting.executeScript({
    target: frameId !== undefined ? { tabId, frameIds: [frameId] } : { tabId },
    world: 'MAIN',
    func: annotateReactSelectOptionsInPage,
  });
  return typeof result?.result === 'number' ? result.result : 0;
}

/**
 * Runs {@link pickReactSelectOptionInPage} in the given tab frame.
 */
export async function pickPageWidgetOption(
  tabId: number,
  frameId: number | undefined,
  selector: string,
  wanted: string
): Promise<PageWidgetPickResult> {
  const [result] = await chrome.scripting.executeScript({
    target: frameId !== undefined ? { tabId, frameIds: [frameId] } : { tabId },
    world: 'MAIN',
    func: pickReactSelectOptionInPage,
    args: [selector, wanted],
  });
  const value = result?.result as PageWidgetPickResult | undefined;
  return value && typeof value.ok === 'boolean' ? value : { ok: false, reason: 'page did not answer' };
}
