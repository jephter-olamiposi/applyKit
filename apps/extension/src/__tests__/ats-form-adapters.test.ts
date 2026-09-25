/**
 * @fileoverview Integration and unit test suite for ATS Form Adapters (Phase 13).
 *
 * Verifies specialized form extraction, multi-step wizard progression tracking,
 * authentication barrier detection, and custom control interaction across Workday,
 * Greenhouse, Lever, Ashby, and Generic web application forms.
 *
 * @vitest-environment happy-dom
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  WorkdayFormAdapter,
  GreenhouseFormAdapter,
  LeverFormAdapter,
  AshbyFormAdapter,
  GenericFormAdapter,
  RecruiteeFormAdapter,
  findMatchingFormAdapter,
  inspectPageWithAtsAdapters,
} from '../content/adapters/form/index.js';
import {
  simulateCustomComboboxSelect,
} from '../content/action-interpreter.js';

describe('ATS Form Adapters & Deep Integration Suite (Phase 13)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('WorkdayFormAdapter', () => {
    const adapter = new WorkdayFormAdapter();

    it('matches workday URLs and DOM markers', () => {
      const wdUrl = new URL('https://acme.myworkdayjobs.com/en-US/Careers/job/12345/apply');
      const genericUrl = new URL('https://unknowncompany.com/apply');

      expect(adapter.matches(wdUrl, document)).toBe(true);
      expect(adapter.matches(genericUrl, document)).toBe(false);

      document.body.innerHTML = '<div data-automation-id="workdayApplication"></div>';
      expect(adapter.matches(genericUrl, document)).toBe(true);
    });

    it('detects candidate authentication and registration barrier', () => {
      document.body.innerHTML = `
        <div data-automation-id="signInPage">
          <form data-automation-id="signInForm">
            <input data-automation-id="email" type="email" />
            <input data-automation-id="password" type="password" />
            <button data-automation-id="signInSubmitButton" type="submit">Sign In</button>
          </form>
        </div>
      `;

      const barrier = adapter.detectAuthBarrier(document);
      expect(barrier).not.toBeNull();
      expect(barrier?.isBlocked).toBe(true);
      expect(barrier?.message).toContain('Workday requires signing in');
      expect(barrier?.signInButtonSelector).toBe('[data-automation-id="signInSubmitButton"]');
    });

    it('detects multi-step wizard progression on intermediate step', () => {
      document.body.innerHTML = `
        <header data-automation-id="pageHeader">
          <h1>Step 2 of 5: My Experience</h1>
        </header>
        <div data-automation-id="workdayApplication">
          <input data-automation-id="jobTitle" type="text" value="Staff Engineer" />
          <button data-automation-id="bottom-navigation-next-button">Save and Continue</button>
        </div>
      `;

      const wizard = adapter.detectWizardState(document);
      expect(wizard).not.toBeNull();
      expect(wizard?.isMultiStep).toBe(true);
      expect(wizard?.currentStepIndex).toBe(2);
      expect(wizard?.totalSteps).toBe(5);
      expect(wizard?.stepName).toBe('My Experience');
      expect(wizard?.isFinalStep).toBe(false);
      expect(wizard?.nextStepButtonSelector).toBe('[data-automation-id="bottom-navigation-next-button"]');

      // Intermediate step must NOT classify 'Save and Continue' as submit button
      const form = adapter.crawlForm(document);
      expect(form).not.toBeNull();
      expect(form?.isMultiStep).toBe(true);
      expect(form?.currentStepIndex).toBe(2);
      expect(form?.submitButtonSelector).toBeUndefined();
    });

    it('identifies submit button strictly on final review step', () => {
      document.body.innerHTML = `
        <header data-automation-id="pageHeader">
          <h1>Step 5 of 5: Review and Submit</h1>
        </header>
        <div data-automation-id="workdayApplication">
          <p>Please review your information before final submission.</p>
          <button data-automation-id="submitButton" type="submit">Submit Application</button>
        </div>
      `;

      const wizard = adapter.detectWizardState(document);
      expect(wizard?.isFinalStep).toBe(true);

      const form = adapter.crawlForm(document);
      expect(form).not.toBeNull();
      expect(form?.submitButtonSelector).toBe('[data-automation-id="submitButton"]');
    });

    it('extracts Workday custom automation fields and prompt dropdowns', () => {
      document.body.innerHTML = `
        <div data-automation-id="workdayApplication">
          <div class="field">
            <label id="lbl_fn">Legal First Name</label>
            <input id="input_fn" data-automation-id="legalNameSection_firstName" aria-labelledby="lbl_fn" type="text" />
          </div>
          <div class="field">
            <label id="lbl_ln">Legal Last Name</label>
            <input id="input_ln" data-automation-id="legalNameSection_lastName" aria-labelledby="lbl_ln" type="text" />
          </div>
          <div class="field">
            <label id="lbl_phone">Phone Number</label>
            <input id="input_phone" data-automation-id="phone-number" aria-labelledby="lbl_phone" type="tel" />
          </div>
          <div class="field">
            <label id="lbl_country">Country / Region</label>
            <button data-automation-id="searchBox" id="btn_country" aria-labelledby="lbl_country">Select Country</button>
          </div>
        </div>
      `;

      const form = adapter.crawlForm(document);
      expect(form).not.toBeNull();
      expect(form?.fields.length).toBe(4);

      const fn = form?.fields.find((f) => f.inferredMappingKey === 'identity.legalFirstName');
      expect(fn).toBeDefined();

      const ln = form?.fields.find((f) => f.inferredMappingKey === 'identity.legalLastName');
      expect(ln).toBeDefined();

      const phone = form?.fields.find((f) => f.inferredMappingKey === 'identity.phone');
      expect(phone).toBeDefined();

      const country = form?.fields.find((f) => f.selector.includes('btn_country'));
      expect(country).toBeDefined();
      expect(country?.fieldType).toBe('select');
    });

    it('detects Workday validation errors', () => {
      document.body.innerHTML = `
        <div data-automation-id="workdayApplication">
          <div data-automation-id="errorMessage" class="error">Postal code is required for the selected country.</div>
        </div>
      `;

      const errors = adapter.detectValidationErrors(document);
      expect(errors.length).toBe(1);
      expect(errors[0]?.message).toContain('Postal code is required');
    });
  });

  describe('GreenhouseFormAdapter', () => {
    const adapter = new GreenhouseFormAdapter();

    it('matches greenhouse URLs and DOM elements', () => {
      const ghUrl = new URL('https://boards.greenhouse.io/stripe/jobs/12345');
      const customUrl = new URL('https://careers.company.com/apply?gh_jid=999');
      const unrelatedUrl = new URL('https://company.com/careers');

      expect(adapter.matches(ghUrl, document)).toBe(true);
      expect(adapter.matches(customUrl, document)).toBe(true);
      expect(adapter.matches(unrelatedUrl, document)).toBe(false);

      document.body.innerHTML = '<div id="grnhse_app"><form id="application_form"></form></div>';
      expect(adapter.matches(unrelatedUrl, document)).toBe(true);
    });

    it('extracts demographic EEO questions and sets canonical keys', () => {
      document.body.innerHTML = `
        <form id="application_form">
          <div id="main_fields">
            <input id="first_name" name="first_name" type="text" />
            <input id="last_name" name="last_name" type="text" />
            <input id="email" name="email" type="email" />
          </div>

          <div id="eeo_questions">
            <div class="field">
              <label for="eeo_gender">Gender</label>
              <select id="eeo_gender" name="job_application[gender]">
                <option value="">Please select</option>
                <option value="Female">Female</option>
                <option value="Male">Male</option>
                <option value="Decline to Self-Identify">I decline to self-identify</option>
              </select>
            </div>
            <div class="field">
              <label for="eeo_race">Race / Ethnicity</label>
              <select id="eeo_race" name="job_application[race]">
                <option value="">Please select</option>
                <option value="Asian">Asian</option>
                <option value="Black">Black or African American</option>
              </select>
            </div>
            <div class="field">
              <label for="eeo_veteran">Veteran Status</label>
              <select id="eeo_veteran" name="job_application[veteran_status]">
                <option value="">Please select</option>
                <option value="1">I am not a protected veteran</option>
              </select>
            </div>
            <div class="field">
              <label for="eeo_disability">Disability Status</label>
              <select id="eeo_disability" name="job_application[disability_status]">
                <option value="">Please select</option>
                <option value="0">No, I do not have a disability</option>
              </select>
            </div>
          </div>

          <input type="submit" id="submit_app" value="Submit Application" />
        </form>
      `;

      const form = adapter.crawlForm(document);
      expect(form).not.toBeNull();
      expect(form?.detectedAts).toBe('greenhouse');
      expect(form?.submitButtonSelector).toBe('#submit_app');

      const gender = form?.fields.find((f) => f.inferredMappingKey === 'identity.eeo.gender');
      expect(gender).toBeDefined();
      expect(gender?.options?.length).toBe(4);

      const race = form?.fields.find((f) => f.inferredMappingKey === 'identity.eeo.race');
      expect(race).toBeDefined();

      const veteran = form?.fields.find((f) => f.inferredMappingKey === 'identity.eeo.veteranStatus');
      expect(veteran).toBeDefined();

      const disability = form?.fields.find((f) => f.inferredMappingKey === 'identity.eeo.disabilityStatus');
      expect(disability).toBeDefined();
    });

    it('extracts custom file upload containers for resume and cover letter', () => {
      document.body.innerHTML = `
        <form id="application_form">
          <div id="resume_fieldset">
            <label>Resume/CV</label>
            <input id="resume" type="file" name="resume" />
          </div>
          <div id="cover_letter_fieldset">
            <label>Cover Letter</label>
            <input id="cover_letter" type="file" name="cover_letter" />
          </div>
          <input type="submit" id="submit_app" value="Submit" />
        </form>
      `;

      const form = adapter.crawlForm(document);
      expect(form).not.toBeNull();

      const resumeField = form?.fields.find((f) => f.selector === '#resume');
      expect(resumeField?.fieldType).toBe('file_upload');
      expect(resumeField?.inferredMappingKey).toBe('documents.resume');

      const coverLetterField = form?.fields.find((f) => f.selector === '#cover_letter');
      expect(coverLetterField?.fieldType).toBe('file_upload');
      expect(coverLetterField?.inferredMappingKey).toBe('documents.coverLetter');
    });
  });

  describe('LeverFormAdapter', () => {
    const adapter = new LeverFormAdapter();

    it('matches lever.co URLs and DOM classes', () => {
      const leverUrl = new URL('https://jobs.lever.co/figma/12345/apply');
      const unrelatedUrl = new URL('https://company.com/apply');

      expect(adapter.matches(leverUrl, document)).toBe(true);
      expect(adapter.matches(unrelatedUrl, document)).toBe(false);

      document.body.innerHTML = '<div class="lever-form"></div>';
      expect(adapter.matches(unrelatedUrl, document)).toBe(true);
    });

    it('extracts explicit social links and custom questionnaire blocks', () => {
      document.body.innerHTML = `
        <div class="lever-form">
          <div class="section-wrapper">
            <input name="name" type="text" placeholder="Full name" />
            <input name="email" type="email" placeholder="Email" />
            <input name="urls[LinkedIn]" type="text" placeholder="LinkedIn URL" />
            <input name="urls[GitHub]" type="text" placeholder="GitHub URL" />
            <input name="urls[Portfolio]" type="text" placeholder="Portfolio URL" />
          </div>

          <div class="application-question">
            <div class="application-label">Why do you want to join our engineering team?</div>
            <textarea name="comments[motivation]"></textarea>
          </div>

          <div class="application-question">
            <label class="checkbox-label">
              <input type="checkbox" name="consent[data_processing]" required />
              I consent to the processing of my personal data
            </label>
          </div>

          <button id="btn-submit" type="submit" class="postings-btn-submit">Submit application</button>
        </div>
      `;

      const form = adapter.crawlForm(document);
      expect(form).not.toBeNull();
      expect(form?.detectedAts).toBe('lever');
      expect(form?.submitButtonSelector).toBe('#btn-submit');

      const linkedin = form?.fields.find((f) => f.inferredMappingKey === 'links.linkedin');
      expect(linkedin).toBeDefined();
      expect(linkedin?.confidenceScore).toBe(0.98);

      const github = form?.fields.find((f) => f.inferredMappingKey === 'links.github');
      expect(github).toBeDefined();

      const portfolio = form?.fields.find((f) => f.inferredMappingKey === 'links.portfolio');
      expect(portfolio).toBeDefined();

      const motivation = form?.fields.find((f) => f.fieldType === 'textarea');
      expect(motivation?.label).toContain('Why do you want to join');

      const consent = form?.fields.find((f) => f.fieldType === 'checkbox');
      expect(consent?.isRequired).toBe(true);
    });
  });

  describe('AshbyFormAdapter', () => {
    const adapter = new AshbyFormAdapter();

    it('matches ashbyhq URLs and DOM markers', () => {
      const ashbyUrl = new URL('https://jobs.ashbyhq.com/linear/5678/apply');
      const unrelatedUrl = new URL('https://random.com/apply');

      expect(adapter.matches(ashbyUrl, document)).toBe(true);
      expect(adapter.matches(unrelatedUrl, document)).toBe(false);

      document.body.innerHTML = '<div data-ashby="true"></div>';
      expect(adapter.matches(unrelatedUrl, document)).toBe(true);
    });

    it('extracts React comboboxes and custom dropzones', () => {
      document.body.innerHTML = `
        <div id="ashby-application-form">
          <input name="name" type="text" placeholder="Full name" />
          
          <div class="combobox-field">
            <label id="lbl-source">How did you hear about us?</label>
            <input
              id="source-combobox"
              role="combobox"
              aria-labelledby="lbl-source"
              aria-controls="source-listbox"
              type="text"
            />
            <ul id="source-listbox" role="listbox">
              <li role="option" data-value="linkedin">LinkedIn</li>
              <li role="option" data-value="referral">Employee Referral</li>
              <li role="option" data-value="twitter">Twitter / X</li>
            </ul>
          </div>

          <div data-testid="file-upload-dropzone">
            <input id="resume-file" type="file" name="resume" />
          </div>

          <button data-testid="submit-application-button" type="submit">Submit Application</button>
        </div>
      `;

      const form = adapter.crawlForm(document);
      expect(form).not.toBeNull();
      expect(form?.detectedAts).toBe('ashby');
      expect(form?.submitButtonSelector).toBe('[data-testid="submit-application-button"]');

      const combobox = form?.fields.find((f) => f.selector === '#source-combobox');
      expect(combobox).toBeDefined();
      expect(combobox?.fieldType).toBe('select');
      expect(combobox?.options?.length).toBe(3);

      const fileDropzone = form?.fields.find((f) => f.selector === '#resume-file');
      expect(fileDropzone?.fieldType).toBe('file_upload');
    });

    it('detects dynamic validation errors on invalid inputs', () => {
      document.body.innerHTML = `
        <div id="ashby-application-form">
          <div class="ashby-form-field-error">Please provide a valid email address.</div>
        </div>
      `;

      const errors = adapter.detectValidationErrors(document);
      expect(errors.length).toBe(1);
      expect(errors[0]?.message).toContain('Please provide a valid email');
    });
  });

  describe('GenericFormAdapter', () => {
    const adapter = new GenericFormAdapter();

    it('matches any URL as fallback', () => {
      expect(adapter.matches(new URL('https://anything.com'), document)).toBe(true);
    });

    it('crawls standard HTML5 application forms', () => {
      document.body.innerHTML = `
        <form id="application">
          <fieldset>
            <legend>Candidate Details</legend>
            <input id="user_email" type="email" placeholder="Email" required />
            <input id="user_phone" type="tel" placeholder="Phone" />
          </fieldset>
          <input id="submit_btn" type="submit" value="Apply Now" />
        </form>
      `;

      const form = adapter.crawlForm(document);
      expect(form).not.toBeNull();
      expect(form?.detectedAts).toBe('generic');
      expect(form?.fields.length).toBe(2);
      expect(form?.submitButtonSelector).toBe('#submit_btn');
    });
  });

  describe('findMatchingFormAdapter & inspectPageWithAtsAdapters', () => {
    it('selects Workday adapter for Workday domains', () => {
      const url = new URL('https://netflix.myworkdayjobs.com/apply');
      const adapter = findMatchingFormAdapter(url, document);
      expect(adapter.id).toBe('workday');
    });

    it('selects Greenhouse adapter for Greenhouse domains', () => {
      const url = new URL('https://boards.greenhouse.io/stripe/jobs/1');
      const adapter = findMatchingFormAdapter(url, document);
      expect(adapter.id).toBe('greenhouse');
    });

    it('selects Lever adapter for Lever domains', () => {
      const url = new URL('https://jobs.lever.co/acme/2');
      const adapter = findMatchingFormAdapter(url, document);
      expect(adapter.id).toBe('lever');
    });

    it('selects Ashby adapter for Ashby domains', () => {
      const url = new URL('https://jobs.ashbyhq.com/post/3');
      const adapter = findMatchingFormAdapter(url, document);
      expect(adapter.id).toBe('ashby');
    });

    it('selects Recruitee adapter for Recruitee domains', () => {
      const url = new URL('https://holepunch.recruitee.com/o/senior-node-engineer');
      const adapter = findMatchingFormAdapter(url, document);
      expect(adapter.id).toBe('recruitee');
    });

    it('inspects page and returns structured forms with adapter metadata', () => {
      document.body.innerHTML = `
        <div id="grnhse_app">
          <form id="application_form">
            <input id="first_name" name="first_name" type="text" />
            <input id="last_name" name="last_name" type="text" />
            <input type="submit" id="submit_app" />
          </form>
        </div>
      `;

      // Set URL to Greenhouse
      Object.defineProperty(document, 'location', {
        value: new URL('https://boards.greenhouse.io/job/10'),
        writable: true,
      });

      const forms = inspectPageWithAtsAdapters(document);
      expect(forms.length).toBe(1);
      expect(forms[0]?.detectedAts).toBe('greenhouse');
      expect(forms[0]?.fields.length).toBe(2);
    });
  });

  describe('RecruiteeFormAdapter', () => {
    const adapter = new RecruiteeFormAdapter();

    it('matches recruitee domains and form markers', () => {
      const recruiteeUrl = new URL('https://holepunch.recruitee.com/o/senior-node-engineer');
      const otherUrl = new URL('https://example.com/jobs/1');

      expect(adapter.matches(recruiteeUrl, document)).toBe(true);
      expect(adapter.matches(otherUrl, document)).toBe(false);

      document.body.innerHTML = '<form id="offer-application-form"></form>';
      expect(adapter.matches(otherUrl, document)).toBe(true);
    });

    it('crawls Recruitee form fields including radio groups and custom questions', () => {
      document.body.innerHTML = `
        <form id="offer-application-form">
          <div>
            <label for="name">Full name *</label>
            <input id="name" name="candidate[name]" type="text" required />
          </div>
          <div>
            <label for="email">Email *</label>
            <input id="email" name="candidate[email]" type="email" required />
          </div>
          <div>
            <label for="salary">What is your expected salary? (annual USD) *</label>
            <input id="salary" name="candidate[salary]" type="number" required />
          </div>
          <fieldset>
            <legend>How do you rate your own skills with Node.js? *</legend>
            <label><input type="radio" name="candidate.skills.nodejs" value="Beginner" /> Beginner</label>
            <label><input type="radio" name="candidate.skills.nodejs" value="Intermediate" /> Intermediate</label>
            <label><input type="radio" name="candidate.skills.nodejs" value="Advanced" /> Advanced</label>
          </fieldset>
          <div>
            <label for="why_holepunch">Why are you interested in Holepunch? *</label>
            <textarea id="why_holepunch" name="candidate[why_holepunch]" required></textarea>
          </div>
          <button type="submit" class="sc-csisgn-0 cWtVVQ">Send</button>
        </form>
      `;

      const form = adapter.crawlForm(document);
      expect(form).not.toBeNull();
      expect(form?.detectedAts).toBe('recruitee');
      expect(form?.fields.length).toBe(5);

      // Verify radio group extraction
      const radioField = form?.fields.find((f) => f.fieldType === 'radio');
      expect(radioField).toBeDefined();
      expect(radioField?.label).toContain('Node.js');
      expect(radioField?.options?.length).toBe(3);
      expect(radioField?.options?.map((o) => o.value)).toEqual(['Beginner', 'Intermediate', 'Advanced']);

      // Verify salary numeric field
      const salaryField = form?.fields.find((f) => f.fieldType === 'number');
      expect(salaryField).toBeDefined();
      expect(salaryField?.inferredMappingKey).toBe('professional.targetSalary');

      // Verify Send button identified
      expect(form?.submitButtonSelector).toBe('button.sc-csisgn-0');
    });
  });

  describe('Action Interpreter Custom Combobox Simulation', () => {
    it('simulates selecting option from custom ARIA combobox popup', () => {
      document.body.innerHTML = `
        <div class="combobox-wrapper">
          <input id="custom-combo" role="combobox" type="text" />
          <ul role="listbox">
            <li role="option" data-value="engineering">Engineering Team</li>
            <li role="option" data-value="design">Product Design</li>
          </ul>
        </div>
      `;

      const input = document.getElementById('custom-combo') as HTMLElement;
      let clickedOption = false;
      const engOption = document.querySelector('[data-value="engineering"]')!;
      engOption.addEventListener('click', () => {
        clickedOption = true;
      });

      simulateCustomComboboxSelect(input, 'Engineering Team');
      expect(clickedOption).toBe(true);
    });
  });
});
