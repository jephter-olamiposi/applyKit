import { describe, it, expect } from 'vitest';
import {
  classifyFormField,
  isHoneypotField,
  matchFieldOption,
  getFormUnmappedRequiredFields,
  isFormReadyForDryRun,
  resolveProfileValueForField,
  createFieldId,
  createEmptyProfile,
} from '../index.js';
import type { ApplicationField, ApplicationForm } from '../index.js';

describe('Form Engine - Canonical Field Classification & Option Matcher', () => {
  describe('Semantic Field Classifier', () => {
    it('classifies input via HTML autocomplete attributes with highest confidence (0.98)', () => {
      const result = classifyFormField({
        tag: 'input',
        autocomplete: 'given-name',
        placeholder: 'Enter text',
      });

      expect(result.canonicalKey).toBe('first_name');
      expect(result.confidence).toBe(0.98);
      expect(result.inferredProfilePath).toBe('identity.legalFirstName');
      expect(result.rationale).toContain('autocomplete');
    });

    it('classifies native email and tel inputs', () => {
      const emailRes = classifyFormField({ tag: 'input', type: 'email' });
      expect(emailRes.canonicalKey).toBe('email');
      expect(emailRes.confidence).toBeGreaterThanOrEqual(0.95);

      const telRes = classifyFormField({ tag: 'input', type: 'tel' });
      expect(telRes.canonicalKey).toBe('phone');
      expect(telRes.confidence).toBeGreaterThanOrEqual(0.94);
    });

    it('classifies fields by visual label text with high confidence', () => {
      expect(
        classifyFormField({ tag: 'input', label: 'First Name *' }).canonicalKey
      ).toBe('first_name');

      expect(
        classifyFormField({ tag: 'input', label: 'Last Name / Surname' }).canonicalKey
      ).toBe('last_name');

      expect(
        classifyFormField({ tag: 'input', label: 'Attach Resume / CV' }).canonicalKey
      ).toBe('resume');

      expect(
        classifyFormField({ tag: 'input', label: 'LinkedIn Profile URL' }).canonicalKey
      ).toBe('linkedin_url');

      expect(
        classifyFormField({ tag: 'input', label: 'GitHub Profile' }).canonicalKey
      ).toBe('github_url');

      expect(
        classifyFormField({
          tag: 'input',
          label: 'Will you now or in the future require visa sponsorship?',
        }).canonicalKey
      ).toBe('visa_sponsorship');

      expect(
        classifyFormField({
          tag: 'input',
          label: 'Are you legally authorized to work in the United States?',
        }).canonicalKey
      ).toBe('work_authorization');

      expect(
        classifyFormField({ tag: 'input', label: 'Desired Salary / Compensation' }).canonicalKey
      ).toBe('salary_expectation');
    });

    it('classifies fields by name/id tokens when label is missing', () => {
      const result = classifyFormField({
        tag: 'input',
        name: 'applicant_first_name',
      });
      expect(result.canonicalKey).toBe('first_name');
      expect(result.confidence).toBeGreaterThanOrEqual(0.70);
    });

    it('falls back to custom_question when no canonical pattern matches', () => {
      const result = classifyFormField({
        tag: 'textarea',
        label: 'Why do you want to work at our company and what is your favorite color?',
      });
      expect(result.canonicalKey).toBe('custom_question');
      expect(result.confidence).toBe(0.30);
    });
  });

  describe('Honeypot Trap Detection', () => {
    it('detects honeypots by suspicious element naming', () => {
      expect(isHoneypotField({ tag: 'input', name: 'honeypot_trap' })).toBe(true);
      expect(isHoneypotField({ tag: 'input', id: 'anti_spam_field' })).toBe(true);
    });

    it('detects honeypots by hidden styling or offscreen positioning', () => {
      expect(
        isHoneypotField({ tag: 'input', name: 'email_confirm' }, { display: 'none' })
      ).toBe(true);

      expect(
        isHoneypotField({ tag: 'input', name: 'user_website' }, { visibility: 'hidden' })
      ).toBe(true);

      expect(
        isHoneypotField({ tag: 'input', name: 'phone_alt' }, { opacity: '0' })
      ).toBe(true);

      expect(
        isHoneypotField({ tag: 'input', name: 'first_name' }, { left: -9999, top: 0 })
      ).toBe(true);
    });

    it('identifies standard visible fields as legitimate (not honeypot)', () => {
      expect(
        isHoneypotField(
          { tag: 'input', name: 'first_name', label: 'First Name' },
          { display: 'block', visibility: 'visible', opacity: '1', width: 250, height: 36, left: 100 }
        )
      ).toBe(false);
    });
  });

  describe('Option Matcher Engine', () => {
    it('resolves exact value and label matches with 1.0 confidence', () => {
      const options = [
        { value: 'full_time', label: 'Full Time' },
        { value: 'contract', label: 'Contractor' },
      ];

      const resVal = matchFieldOption(options, 'full_time');
      expect(resVal.matchedOption?.value).toBe('full_time');
      expect(resVal.confidence).toBe(1.0);
      expect(resVal.strategy).toBe('exact');

      const resLbl = matchFieldOption(options, 'Contractor');
      expect(resLbl.matchedOption?.value).toBe('contract');
      expect(resLbl.confidence).toBe(1.0);
    });

    it('resolves boolean sponsorship and authorization intent', () => {
      const options = [
        { value: '1', label: 'Yes, I require sponsorship' },
        { value: '0', label: 'No, I do not require sponsorship' },
      ];

      const resNo = matchFieldOption(options, false, 'visa_sponsorship');
      expect(resNo.matchedOption?.value).toBe('0');
      expect(resNo.strategy).toBe('boolean');
      expect(resNo.confidence).toBeGreaterThanOrEqual(0.95);

      const resYes = matchFieldOption(options, true, 'visa_sponsorship');
      expect(resYes.matchedOption?.value).toBe('1');
    });

    it('resolves country name and code equivalents', () => {
      const options = [
        { value: 'USA', label: 'United States of America' },
        { value: 'GBR', label: 'United Kingdom' },
        { value: 'CAN', label: 'Canada' },
      ];

      const resUs = matchFieldOption(options, 'US', 'country');
      expect(resUs.matchedOption?.value).toBe('USA');
      expect(resUs.strategy).toBe('synonym');

      const resUk = matchFieldOption(options, 'UK', 'country');
      expect(resUk.matchedOption?.value).toBe('GBR');
    });

    it('resolves EEO gender and self-disclosure decline options', () => {
      const options = [
        { value: 'male', label: 'Man / Male' },
        { value: 'female', label: 'Woman / Female' },
        { value: 'decline', label: 'I prefer not to say' },
      ];

      const resMale = matchFieldOption(options, 'male', 'eeo_gender');
      expect(resMale.matchedOption?.value).toBe('male');

      const resDecline = matchFieldOption(options, 'prefer_not_to_say', 'eeo_gender');
      expect(resDecline.matchedOption?.value).toBe('decline');
    });

    it('returns null and fallback strategy when no option matches', () => {
      const options = [
        { value: 'opt1', label: 'Option Alpha' },
        { value: 'opt2', label: 'Option Beta' },
      ];

      const res = matchFieldOption(options, 'Totally Unrelated Value');
      expect(res.matchedOption).toBeNull();
      expect(res.confidence).toBe(0.0);
      expect(res.strategy).toBe('fallback');
    });
  });

  describe('Form Virtual Representation & Readiness Helpers', () => {
    it('detects unmapped required fields and calculates dry-run readiness', () => {
      const readyField: ApplicationField = {
        id: createFieldId(),
        selector: '#first_name',
        fieldType: 'text',
        label: 'First Name',
        isRequired: true,
        confidenceScore: 0.95,
        inferredMappingKey: 'identity.legalFirstName',
      };

      const unmappedField: ApplicationField = {
        id: createFieldId(),
        selector: '#custom_ssn',
        fieldType: 'text',
        label: 'Security ID',
        isRequired: true,
        confidenceScore: 0.2, // Low confidence & no mapping key
      };

      const formNotReady: ApplicationForm = {
        id: 'form_1',
        url: 'https://careers.example.com/apply',
        detectedAts: 'greenhouse',
        fields: [readyField, unmappedField],
        isMultiStep: false,
        inspectedAt: new Date().toISOString(),
      };

      expect(isFormReadyForDryRun(formNotReady)).toBe(false);
      const unmapped = getFormUnmappedRequiredFields(formNotReady);
      expect(unmapped.length).toBe(1);
      expect(unmapped[0]?.selector).toBe('#custom_ssn');

      const formReady: ApplicationForm = {
        ...formNotReady,
        fields: [readyField],
      };
      expect(isFormReadyForDryRun(formReady)).toBe(true);
    });
  });

  describe('resolveProfileValueForField', () => {
    it('resolves identity and contact fields correctly from candidate profile', () => {
      const profile = createEmptyProfile();
      const populatedProfile = {
        ...profile,
        identity: {
          ...profile.identity,
          legalFirstName: 'Jane',
          legalLastName: 'Doe',
          email: 'jane.doe@example.com',
          phone: '+1 555-0199',
          location: {
            city: 'San Francisco',
            country: 'United States',
            addressLine1: '123 Market St',
            postalCode: '94105',
          },
          workAuthorization: {
            isAuthorizedInCountry: true,
            requiresSponsorship: false,
            authorizedCountries: ['US'],
          },
          demographics: {
            gender: 'Female',
            raceEthnicity: 'Asian',
            veteranStatus: 'not_veteran' as const,
            disabilityStatus: 'no_disability' as const,
          },
        },
        links: {
          linkedin: 'https://linkedin.com/in/janedoe',
          github: 'https://github.com/janedoe',
          portfolio: 'https://janedoe.dev',
          customLinks: [],
        },
      };

      expect(resolveProfileValueForField(populatedProfile, 'first_name')).toBe('Jane');
      expect(resolveProfileValueForField(populatedProfile, 'last_name')).toBe('Doe');
      expect(resolveProfileValueForField(populatedProfile, 'full_name')).toBe('Jane Doe');
      expect(resolveProfileValueForField(populatedProfile, 'email')).toBe('jane.doe@example.com');
      expect(resolveProfileValueForField(populatedProfile, 'phone')).toBe('+1 555-0199');
      expect(resolveProfileValueForField(populatedProfile, 'location_city')).toBe('San Francisco');
      expect(resolveProfileValueForField(populatedProfile, 'location_address')).toBe('123 Market St');
      expect(resolveProfileValueForField(populatedProfile, 'postal_code')).toBe('94105');
      expect(resolveProfileValueForField(populatedProfile, 'country')).toBe('United States');
      expect(resolveProfileValueForField(populatedProfile, 'linkedin_url')).toBe('https://linkedin.com/in/janedoe');
      expect(resolveProfileValueForField(populatedProfile, 'github_url')).toBe('https://github.com/janedoe');
      expect(resolveProfileValueForField(populatedProfile, 'portfolio_url')).toBe('https://janedoe.dev');
      expect(resolveProfileValueForField(populatedProfile, 'work_authorization')).toBe('Yes');
      expect(resolveProfileValueForField(populatedProfile, 'visa_sponsorship')).toBe('No');
      expect(resolveProfileValueForField(populatedProfile, 'eeo_gender')).toBe('Female');
      expect(resolveProfileValueForField(populatedProfile, 'eeo_veteran')).toBe('not_veteran');
      expect(resolveProfileValueForField(populatedProfile, 'eeo_disability')).toBe('no_disability');
      expect(resolveProfileValueForField(populatedProfile, 'custom_question')).toBeUndefined();
    });
  });
});

