/**
 * @fileoverview Greenhouse's current job-boards.greenhouse.io layout, end to end.
 *
 * The fixture mirrors a live posting and form captured on 2026-10-24. Before these
 * fixes the page reader found no location, read the application form's labels as job
 * requirements, typed answers into react-select dropdowns (which records nothing), and
 * searched the whole page for options, landing on the hidden phone-country list.
 *
 * @vitest-environment happy-dom
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DryRunAction } from '@applykit/domain';
import { GreenhouseJobSiteAdapter } from '../content/adapters/greenhouse-adapter.js';
import { GreenhouseFormAdapter } from '../content/adapters/form/greenhouse-form-adapter.js';
import { executeSingleAction, simulateCustomComboboxSelect } from '../content/action-interpreter.js';
import { PAGE_OPTIONS_ATTRIBUTE } from '../content/page-widget-options.js';
import { isElementRequired } from '../content/adapters/form-crawler-helpers.js';
import {
  annotateReactSelectOptionsInPage,
  pickReactSelectOptionInPage,
} from '../background/page-widgets.js';

const URL_ = new URL('https://job-boards.greenhouse.io/northwind/jobs/1');

function loadFixture(): Document {
  const html = readFileSync(resolve(__dirname, 'fixtures', 'greenhouse-job-boards.html'), 'utf-8');
  return new DOMParser().parseFromString(html, 'text/html');
}

const RIGHT_TO_WORK = [
  { value: '101', label: "I'm a citizen or have permanent residency" },
  { value: '102', label: 'I have a visa which gives me temporary right to work' },
  { value: '103', label: "I'd need the company to sponsor my visa to work in this location" },
];

/** Gives an element the React fiber shape react-select exposes on live pages. */
function attachFakeReactSelect(element: Element, options: { value: string; label: string }[]) {
  const selectOption = vi.fn();
  const selectFiber = { memoizedProps: { options, selectOption }, return: null };
  const inputFiber = { memoizedProps: { id: element.id }, return: { memoizedProps: {}, return: selectFiber } };
  (element as unknown as Record<string, unknown>)['__reactFiber$test'] = inputFiber;
  return selectOption;
}

function selectAction(selector: string, value: string): DryRunAction {
  return {
    id: 'a1',
    fieldId: 'f1',
    action: { actionType: 'select_option', selector, value, requiresUserConfirmation: true },
    userConfirmed: true,
  } as unknown as DryRunAction;
}

describe('Greenhouse job-boards layout: job page', () => {
  it('reads title, company, location, and requirements from the description only', () => {
    const doc = loadFixture();
    const adapter = new GreenhouseJobSiteAdapter();
    expect(adapter.matches(URL_, doc)).toBe(true);

    const job = adapter.extract(doc, URL_);
    expect(job.title).toBe('Backend Engineer at Scale');
    // The role contains " at ", so the company must come from the last one.
    expect(job.companyName).toBe('Northwind Payments');
    expect(job.location).toBe('Remote (UK)');
    expect(job.workplaceType).toBe('remote');

    const texts = job.requirements.map((req) => req.rawText).join(' | ');
    expect(texts).toContain('Go');
    expect(texts).toContain('PostgreSQL');
    expect(texts).not.toMatch(/First Name|Submit application|Afghanistan/);
    expect(job.rawDescription).not.toMatch(/Afghanistan|First Name/);
  });
});

describe('Greenhouse job-boards layout: application form', () => {
  it('scopes to the form, skips widget internals, and lists react-select dropdowns as selects', () => {
    const doc = loadFixture();
    const rightToWork = doc.getElementById('question_3')!;
    rightToWork.setAttribute(PAGE_OPTIONS_ATTRIBUTE, JSON.stringify(RIGHT_TO_WORK));

    const form = new GreenhouseFormAdapter().crawlForm(doc);
    expect(form).not.toBeNull();
    expect(form!.id).toBe('application-form');

    const labels = form!.fields.map((field) => field.label);
    expect(labels).toEqual(expect.arrayContaining(['First Name', 'Email', 'Phone', 'LinkedIn Profile']));
    // The phone-country search box and react-select's hidden "required" mirror are not questions.
    expect(form!.fields.some((field) => field.selector.includes('iti-0__search-input'))).toBe(false);
    expect(form!.fields.some((field) => field.label === 'Input Field')).toBe(false);

    const rtw = form!.fields.find((field) => field.label.startsWith('Please confirm your right to work'))!;
    expect(rtw.fieldType).toBe('select');
    expect(rtw.isRequired).toBe(true);
    expect(rtw.options?.map((option) => option.label)).toEqual(RIGHT_TO_WORK.map((option) => option.label));

    // Untagged dropdowns are still listed as selects, just without options.
    const based = form!.fields.find((field) => field.label.startsWith('Where would you like to be based'))!;
    expect(based.fieldType).toBe('select');
    expect(based.options).toBeUndefined();

    expect(form!.submitButtonSelector).toBeDefined();
  });
});

describe('Page-world react-select helpers', () => {
  it('annotates options from the component and picks only an exact match', () => {
    document.body.innerHTML = '<input id="q" role="combobox"><input id="plain" role="combobox">';
    const input = document.getElementById('q')!;
    const selectOption = attachFakeReactSelect(input, RIGHT_TO_WORK);

    expect(annotateReactSelectOptionsInPage()).toBe(1);
    expect(JSON.parse(input.getAttribute(PAGE_OPTIONS_ATTRIBUTE)!)).toHaveLength(3);
    expect(document.getElementById('plain')!.hasAttribute(PAGE_OPTIONS_ATTRIBUTE)).toBe(false);

    const picked = pickReactSelectOptionInPage('#q', "i'd need the company to sponsor my visa to work in this location");
    expect(picked.ok).toBe(true);
    expect(selectOption).toHaveBeenCalledWith(RIGHT_TO_WORK[2]);

    // A near miss is refused: a wrong answer is worse than an empty one.
    selectOption.mockClear();
    expect(pickReactSelectOptionInPage('#q', 'sponsor').ok).toBe(false);
    expect(selectOption).not.toHaveBeenCalled();
    expect(pickReactSelectOptionInPage('#missing', 'x')).toEqual({ ok: false, reason: 'field not found' });
  });
});

describe('Filling dropdowns', () => {
  it('routes tagged react-select dropdowns through the page hook', async () => {
    const doc = loadFixture();
    doc.getElementById('question_3')!.setAttribute(PAGE_OPTIONS_ATTRIBUTE, JSON.stringify(RIGHT_TO_WORK));
    const pickPageOption = vi.fn().mockResolvedValue({ ok: true, chosenLabel: RIGHT_TO_WORK[0]!.label });

    await executeSingleAction(selectAction('#question_3', RIGHT_TO_WORK[0]!.label), doc, { highlightElements: false }, { pickPageOption });
    expect(pickPageOption).toHaveBeenCalledWith('#question_3', RIGHT_TO_WORK[0]!.label);
  });

  it('reports a failed pick instead of claiming the field was filled', async () => {
    const doc = loadFixture();
    doc.getElementById('question_3')!.setAttribute(PAGE_OPTIONS_ATTRIBUTE, JSON.stringify(RIGHT_TO_WORK));
    const pickPageOption = vi.fn().mockResolvedValue({ ok: false, reason: 'no option matches' });

    await expect(
      executeSingleAction(selectAction('#question_3', 'Maybe'), doc, { highlightElements: false }, { pickPageOption })
    ).rejects.toThrow(/Choose it yourself/);
    await expect(
      executeSingleAction(selectAction('#question_3', 'Maybe'), doc, { highlightElements: false }, {})
    ).rejects.toThrow(/Choose it yourself/);
  });

  it('never picks an option from a different question on the page', () => {
    const doc = loadFixture();
    // "Where would you like to be based?" has no open menu; the only [role=option]
    // elements on the page belong to the phone-country list.
    const based = doc.getElementById('question_4')!;
    expect(() => simulateCustomComboboxSelect(based, 'United Kingdom')).toThrow(/Choose it yourself/);
    expect((based as HTMLInputElement).value).toBe('');
  });
});

describe('Required markers', () => {
  it('treats a trailing asterisk in the label as required, even without aria-required', () => {
    document.body.innerHTML = '<label for="a">From where do you intend to work?<span>*</span></label><input id="a"><label for="b">Website</label><input id="b">';
    expect(isElementRequired(document.getElementById('a')!, 'From where do you intend to work?')).toBe(true);
    expect(isElementRequired(document.getElementById('b')!, 'Website')).toBe(false);
    expect(isElementRequired(document.getElementById('b')!, 'Website*')).toBe(true);
  });
});
