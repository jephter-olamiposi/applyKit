/**
 * @fileoverview Planner behaviour on question wording taken from live Greenhouse forms
 * (2026-10-24). Each case was a wrong or unsafe answer before.
 */

import { describe, it, expect } from 'vitest';
import {
  createEmptyProfile,
  createProfileId,
  generateDryRunPlan,
  classifyFormField,
  type ApplicationForm,
  type ApplicationField,
  type CandidateProfile,
} from '../index.js';

function profile(confirmedSponsorship: boolean): CandidateProfile {
  const empty = createEmptyProfile(createProfileId('planner_real'));
  return {
    ...empty,
    identity: {
      ...empty.identity,
      legalFirstName: 'Bolu',
      legalLastName: 'Olaifa',
      email: 'bolu@example.com',
      location: { city: 'Lagos', country: 'Nigeria' },
      workAuthorization: {
        isAuthorizedInCountry: false,
        requiresSponsorship: true,
        authorizedCountries: ['Nigeria'],
        confirmedByCandidate: confirmedSponsorship,
      },
    },
  };
}

function field(id: string, label: string, fieldType: ApplicationField['fieldType'], options?: string[]): ApplicationField {
  const classification = classifyFormField({ tag: fieldType === 'textarea' ? 'textarea' : 'input', type: 'text', label, id });
  return {
    id: id as ApplicationField['id'],
    selector: `#${id}`,
    fieldType,
    label,
    isRequired: true,
    options: options?.map((text, index) => ({ value: String(100 + index), label: text })),
    confidenceScore: classification.confidence,
    inferredMappingKey: classification.inferredProfilePath,
  };
}

const RIGHT_TO_WORK = [
  "I'm a citizen or have permanent residency",
  'I have a visa which gives me the permanent right to work',
  'I have a visa which gives me temporary right to work',
  "I'd need Monzo to sponsor my visa to work in this location",
];

function plan(candidate: CandidateProfile, fields: ApplicationField[]) {
  const form: ApplicationForm = {
    id: 'form_real',
    url: 'https://job-boards.greenhouse.io/example/jobs/1',
    detectedAts: 'greenhouse',
    isMultiStep: false,
    inspectedAt: new Date().toISOString(),
    fields,
  };
  return generateDryRunPlan(form, candidate);
}

describe('planner on real question wording', () => {
  it('maps a confirmed sponsorship need onto a sentence-style option, and asks first', () => {
    const rtw = field('q_rtw', '🛂 Please confirm your Right to Work status in the location where this job is advertised.', 'select', RIGHT_TO_WORK);
    const result = plan(profile(true), [rtw]);
    const action = result.actions.find((item) => item.fieldId === rtw.id)!;
    expect(action.action.value).toBe('103');
    expect(action.riskLevel).toBe('high');
    expect(action.userConfirmed).toBe(false);
  });

  it('leaves right-to-work alone until the candidate has confirmed it', () => {
    const rtw = field('q_rtw', '🛂 Please confirm your Right to Work status in the location where this job is advertised.', 'select', RIGHT_TO_WORK);
    expect(plan(profile(false), [rtw]).actions).toHaveLength(0);
  });

  it('never plans a dropdown value that is not one of its options', () => {
    // A yes/no sponsorship answer against options that are all sentences without "sponsor".
    const odd = field('q_odd', 'Work authorization status', 'select', ['Citizen', 'Permanent resident', 'Temporary visa']);
    const result = plan(profile(true), [odd]);
    expect(result.actions).toHaveLength(0);
    expect(result.skippedFields?.some((item) => item.fieldId === odd.id && item.reason === 'no_matching_option')).toBe(true);
  });

  it('does not answer name-pronunciation or pronoun questions with the name', () => {
    const say = field('q_say', "If you'd like to, please spell out your name how it's pronounced so we know how to say it.", 'text');
    const pronouns = field('q_pro', 'If you’d like to, please share your preferred pronouns (eg. they/them/theirs, she/her/hers).', 'text');
    expect(plan(profile(true), [say, pronouns]).actions).toHaveLength(0);
  });

  it('answers where the candidate works from, but not where they would like to be based', () => {
    const from = field('q_from', 'From where do you intend to work?', 'text');
    const based = field('q_based', 'Where would you like to be based?', 'select', ['London', 'UK - Outside London area']);
    const result = plan(profile(true), [from, based]);
    expect(result.actions.map((item) => item.fieldId)).toEqual([from.id]);
    expect(result.actions[0]!.action.value).toBe('Lagos, Nigeria');
  });
});
