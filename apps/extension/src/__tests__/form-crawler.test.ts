/**
 * @fileoverview Unit and DOM fixture tests for Form Crawler & Field Recognition (Phase 7).
 *
 * Verifies DOM traversal, semantic field classification, option extraction,
 * honeypot trap detection, and anti-submission control identification.
 *
 * @vitest-environment happy-dom
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  detectAtsPlatform,
  generateElementSelector,
  extractElementLabel,
  isElementRequired,
  extractNativeSelectOptions,
  isSubmitElement,
  crawlFormContainer,
  inspectPageForms,
} from '../content/form-crawler.js';

describe('Form Crawler & DOM Field Recognition (Phase 7)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('ATS Platform Detection', () => {
    it('detects ATS platform from standard job board URLs', () => {
      expect(detectAtsPlatform(document, 'https://boards.greenhouse.io/stripe/jobs/12345')).toBe('greenhouse');
      expect(detectAtsPlatform(document, 'https://jobs.lever.co/figma/67890')).toBe('lever');
      expect(detectAtsPlatform(document, 'https://acme.myworkdayjobs.com/en-US/Careers/job/123')).toBe('workday');
      expect(detectAtsPlatform(document, 'https://jobs.ashbyhq.com/linear/abcde')).toBe('ashby');
      expect(detectAtsPlatform(document, 'https://jobs.smartrecruiters.com/company/xyz')).toBe('smartrecruiters');
      expect(detectAtsPlatform(document, 'https://careers.customdomain.com/job/1')).toBe('generic');
    });

    it('detects ATS platform from DOM markers on white-labeled career portals', () => {
      document.body.innerHTML = `
        <div id="grnhse_app">
          <form id="application_form"></form>
        </div>
      `;
      expect(detectAtsPlatform(document, 'https://careers.spotify.com/apply')).toBe('greenhouse');

      document.body.innerHTML = `
        <div class="lever-form"></div>
      `;
      expect(detectAtsPlatform(document, 'https://careers.netflix.com/job')).toBe('lever');
    });
  });

  describe('Selector Generation Strategy', () => {
    it('prefers unique element ID', () => {
      document.body.innerHTML = `
        <form id="main_form">
          <input id="first_name_input" type="text" />
        </form>
      `;
      const input = document.getElementById('first_name_input')!;
      const sel = generateElementSelector(input, document);
      expect(sel).toBe('#first_name_input');
    });

    it('uses data-testid or data-automation-id when available', () => {
      document.body.innerHTML = `
        <form>
          <input data-testid="applicant-email" type="email" />
        </form>
      `;
      const input = document.querySelector('[data-testid="applicant-email"]')!;
      const sel = generateElementSelector(input, document);
      expect(sel).toBe('[data-testid="applicant-email"]');
    });

    it('uses unique name attribute when ID is missing', () => {
      document.body.innerHTML = `
        <form>
          <input name="applicant_phone" type="tel" />
        </form>
      `;
      const input = document.querySelector('input[name="applicant_phone"]')!;
      const sel = generateElementSelector(input, document);
      expect(sel).toBe('input[name="applicant_phone"]');
    });

    it('generates hierarchical nth-of-type path when attributes are generic', () => {
      document.body.innerHTML = `
        <form id="contact_form">
          <div><input type="text" /></div>
          <div><input type="text" /></div>
        </form>
      `;
      const inputs = document.querySelectorAll('input');
      const secondInput = inputs[1]!;
      const sel = generateElementSelector(secondInput, document);
      expect(sel).toContain('div:nth-of-type(2) > input');
    });
  });

  describe('Submit Control Identification (Anti-Autonomous Gate)', () => {
    it('identifies submit buttons by native type', () => {
      const btn = document.createElement('button');
      btn.type = 'submit';
      btn.textContent = 'Save';
      expect(isSubmitElement(btn)).toBe(true);

      const input = document.createElement('input');
      input.type = 'submit';
      input.value = 'Send';
      expect(isSubmitElement(input)).toBe(true);
    });

    it('identifies buttons with submit intent keywords', () => {
      const btn1 = document.createElement('button');
      btn1.type = 'button';
      btn1.textContent = 'Submit Application';
      expect(isSubmitElement(btn1)).toBe(true);

      const btn2 = document.createElement('button');
      btn2.type = 'button';
      btn2.textContent = 'Apply Now';
      expect(isSubmitElement(btn2)).toBe(true);
    });

    it('does not classify navigation or secondary buttons as submit', () => {
      const btn1 = document.createElement('button');
      btn1.type = 'button';
      btn1.textContent = 'Back to Jobs';
      expect(isSubmitElement(btn1)).toBe(false);

      const btn2 = document.createElement('button');
      btn2.type = 'button';
      btn2.textContent = 'Cancel';
      expect(isSubmitElement(btn2)).toBe(false);
    });
  });

  describe('End-to-End Application Form Crawling & Inspection', () => {
    it('crawls standard Greenhouse application form fixture and extracts typed fields', () => {
      document.body.innerHTML = `
        <form id="application_form" action="/jobs/123/apply" method="POST">
          <div class="field">
            <label for="first_name">First Name <span class="required">*</span></label>
            <input id="first_name" name="first_name" type="text" autocomplete="given-name" required />
          </div>

          <div class="field">
            <label for="last_name">Last Name <span class="required">*</span></label>
            <input id="last_name" name="last_name" type="text" autocomplete="family-name" required />
          </div>

          <div class="field">
            <label for="email">Email Address <span class="required">*</span></label>
            <input id="email" name="email" type="email" autocomplete="email" required />
          </div>

          <div class="field">
            <label for="phone">Phone Number</label>
            <input id="phone" name="phone" type="tel" autocomplete="tel" />
          </div>

          <div class="field">
            <label for="resume">Attach Resume/CV <span class="required">*</span></label>
            <input id="resume" name="resume" type="file" required />
          </div>

          <div class="field">
            <label for="linkedin">LinkedIn Profile</label>
            <input id="linkedin" name="urls[LinkedIn]" type="text" placeholder="https://linkedin.com/in/..." />
          </div>

          <div class="field">
            <label for="sponsorship_select">Will you now or in the future require visa sponsorship?</label>
            <select id="sponsorship_select" name="question_sponsorship">
              <option value="">Select an option</option>
              <option value="1">Yes</option>
              <option value="0">No</option>
            </select>
          </div>

          <fieldset class="field" role="group">
            <legend>Are you legally authorized to work in the United States?</legend>
            <label><input type="radio" name="work_auth" value="yes" /> Yes, authorized</label>
            <label><input type="radio" name="work_auth" value="no" /> No</label>
          </fieldset>

          <div class="field">
            <label for="cover_letter_text">Cover Letter / Note</label>
            <textarea id="cover_letter_text" name="cover_letter"></textarea>
          </div>

          <!-- Honeypot trap injected by anti-spam -->
          <div style="display: none">
            <input id="honeypot_field" name="honeypot_trap" type="text" />
          </div>

          <div class="actions">
            <input type="submit" id="submit_app" value="Submit Application" />
          </div>
        </form>
      `;

      const forms = inspectPageForms(document);
      expect(forms.length).toBe(1);

      const form = forms[0]!;
      expect(form.id).toBe('application_form');
      expect(form.submitButtonSelector).toBe('#submit_app');

      // Verify constituent fields
      expect(form.fields.length).toBeGreaterThanOrEqual(9);

      // 1. First Name
      const fn = form.fields.find((f) => f.selector === '#first_name');
      expect(fn).toBeDefined();
      expect(fn?.fieldType).toBe('text');
      expect(fn?.label).toContain('First Name');
      expect(fn?.isRequired).toBe(true);
      expect(fn?.inferredMappingKey).toBe('identity.legalFirstName');
      expect(fn?.confidenceScore).toBeGreaterThanOrEqual(0.95);

      // 2. Last Name
      const ln = form.fields.find((f) => f.selector === '#last_name');
      expect(ln?.inferredMappingKey).toBe('identity.legalLastName');

      // 3. Email
      const email = form.fields.find((f) => f.selector === '#email');
      expect(email?.fieldType).toBe('email');
      expect(email?.inferredMappingKey).toBe('identity.email');

      // 4. Resume File Upload
      const resume = form.fields.find((f) => f.selector === '#resume');
      expect(resume?.fieldType).toBe('file_upload');
      expect(resume?.inferredMappingKey).toBe('documents.resume');

      // 5. LinkedIn
      const linkedin = form.fields.find((f) => f.selector === '#linkedin');
      expect(linkedin?.inferredMappingKey).toBe('links.linkedin');

      // 6. Sponsorship Select
      const sponsor = form.fields.find((f) => f.selector === '#sponsorship_select');
      expect(sponsor?.fieldType).toBe('select');
      expect(sponsor?.options?.length).toBe(3);
      expect(sponsor?.inferredMappingKey).toBe('identity.requiresSponsorship');

      // 7. Radio Group
      const radio = form.fields.find((f) => f.fieldType === 'radio');
      expect(radio).toBeDefined();
      expect(radio?.name).toBe('work_auth');
      expect(radio?.options?.length).toBe(2);
      expect(radio?.inferredMappingKey).toBe('identity.workAuthorizations');

      // 8. Honeypot check
      const honeypot = form.fields.find((f) => f.selector === '#honeypot_field');
      expect(honeypot).toBeDefined();
      expect(honeypot?.isHoneypotSuspect).toBe(true);
    });

    it('crawls modern SPA application containers without explicit form tags', () => {
      document.body.innerHTML = `
        <div id="application" class="application-container">
          <div class="input-group">
            <label for="cand_name">Full Name</label>
            <input id="cand_name" type="text" autocomplete="name" required />
          </div>
          <div class="input-group">
            <label for="cand_email">Email</label>
            <input id="cand_email" type="email" required />
          </div>
          <button type="submit" class="btn-submit">Apply Now</button>
        </div>
      `;

      const forms = inspectPageForms(document);
      expect(forms.length).toBe(1);
      expect(forms[0]?.fields.length).toBe(2);
      expect(forms[0]?.submitButtonSelector).toContain('.btn-submit');
    });
  });
});
