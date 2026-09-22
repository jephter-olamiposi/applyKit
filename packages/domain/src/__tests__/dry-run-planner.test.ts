import { describe, it, expect } from 'vitest';
import {
  generateDryRunPlan,
  calculateActionRisk,
  updatePlanActionValue,
  togglePlanActionApproval,
  excludePlanAction,
  resolveEvidenceSourceTitle,
  approveAllLowRiskActions,
  approveAllActions,
  resetAllApprovals,
  createSelectiveDryRunPlan,
  createEmptyProfile,
  createFieldId,
} from '../index.js';
import type {
  ApplicationForm,
  ApplicationField,
  CandidateProfile,
} from '../index.js';

describe('Form Engine — Deterministic Browser Action Protocol & Dry Run Planner (Phase 8)', () => {
  const mockProfile: CandidateProfile = {
    ...createEmptyProfile(),
    identity: {
      legalFirstName: 'Alex',
      legalLastName: 'Rivera',
      email: 'alex.rivera@example.com',
      phone: '+1 555-0144',
      location: {
        city: 'Seattle',
        country: 'United States',
        addressLine1: '456 Pine Street',
        postalCode: '98101',
      },
      workAuthorization: {
        isAuthorizedInCountry: true,
        requiresSponsorship: false,
        authorizedCountries: ['US'],
      },
      demographics: {
        gender: 'Non-binary',
        veteranStatus: 'not_veteran',
        disabilityStatus: 'no_disability',
      },
    },
    links: {
      linkedin: 'https://linkedin.com/in/alexrivera',
      github: 'https://github.com/alexrivera',
      portfolio: 'https://alexrivera.dev',
      customLinks: [],
    },
    documents: [
      {
        id: 'doc_1' as any,
        fileName: 'Alex_Rivera_Resume_2026.pdf',
        documentType: 'resume',
        storageKey: 'storage_resume_1',
        mimeType: 'application/pdf',
        byteSize: 102400,
        sha256Checksum: 'hash123',
        uploadedAt: new Date().toISOString(),
        isPrimaryResume: true,
      },
    ],
  };

  describe('calculateActionRisk', () => {
    it('classifies legal work authorization and sponsorship as high risk', () => {
      const fieldAuth: ApplicationField = {
        id: createFieldId(),
        selector: '#work_auth',
        fieldType: 'radio',
        label: 'Are you authorized to work in the US?',
        isRequired: true,
        confidenceScore: 0.95,
        inferredMappingKey: 'identity.workAuthorizations',
      };
      expect(calculateActionRisk(fieldAuth, 'Yes')).toBe('high');

      const fieldSponsor: ApplicationField = {
        id: createFieldId(),
        selector: '#sponsorship',
        fieldType: 'radio',
        label: 'Will you require visa sponsorship?',
        isRequired: true,
        confidenceScore: 0.95,
        inferredMappingKey: 'identity.requiresSponsorship',
      };
      expect(calculateActionRisk(fieldSponsor, 'No')).toBe('high');
    });

    it('classifies EEO demographic disclosures as high risk', () => {
      const fieldGender: ApplicationField = {
        id: createFieldId(),
        selector: '#gender',
        fieldType: 'select',
        label: 'Gender',
        isRequired: false,
        confidenceScore: 0.95,
        inferredMappingKey: 'identity.demographics.gender',
      };
      expect(calculateActionRisk(fieldGender, 'Non-binary')).toBe('high');
    });

    it('classifies file uploads as high risk', () => {
      const fieldFile: ApplicationField = {
        id: createFieldId(),
        selector: '#resume_upload',
        fieldType: 'file_upload',
        label: 'Attach Resume',
        isRequired: true,
        confidenceScore: 0.97,
        inferredMappingKey: 'documents.resume',
      };
      expect(calculateActionRisk(fieldFile, 'Alex_Rivera_Resume_2026.pdf')).toBe('high');
    });

    it('classifies overwriting an existing non-empty DOM value as medium risk', () => {
      const fieldOverwrite: ApplicationField = {
        id: createFieldId(),
        selector: '#first_name',
        fieldType: 'text',
        label: 'First Name',
        currentValue: 'Alexander', // Non-empty and different from 'Alex'
        isRequired: true,
        confidenceScore: 0.95,
        inferredMappingKey: 'identity.legalFirstName',
      };
      expect(calculateActionRisk(fieldOverwrite, 'Alex')).toBe('medium');
    });

    it('classifies empty standard contact fields with high confidence as low risk', () => {
      const fieldEmpty: ApplicationField = {
        id: createFieldId(),
        selector: '#email',
        fieldType: 'text',
        label: 'Email Address',
        currentValue: '',
        isRequired: true,
        confidenceScore: 0.96,
        inferredMappingKey: 'identity.email',
      };
      expect(calculateActionRisk(fieldEmpty, 'alex.rivera@example.com')).toBe('low');
    });
  });

  describe('generateDryRunPlan', () => {
    it('generates declarative actions for text, select, radio, checkbox, and file inputs', () => {
      const fields: ApplicationField[] = [
        {
          id: createFieldId('fld_first_name'),
          selector: '#first_name',
          fieldType: 'text',
          label: 'First Name',
          isRequired: true,
          confidenceScore: 0.95,
          inferredMappingKey: 'identity.legalFirstName',
        },
        {
          id: createFieldId('fld_country'),
          selector: '#country_select',
          fieldType: 'select',
          label: 'Country',
          isRequired: true,
          confidenceScore: 0.92,
          inferredMappingKey: 'identity.country',
          options: [
            { value: 'CA', label: 'Canada' },
            { value: 'US', label: 'United States' },
            { value: 'GB', label: 'United Kingdom' },
          ],
        },
        {
          id: createFieldId('fld_sponsorship'),
          selector: '#sponsorship_group',
          fieldType: 'radio',
          label: 'Do you require sponsorship?',
          isRequired: true,
          confidenceScore: 0.94,
          inferredMappingKey: 'identity.requiresSponsorship',
          options: [
            { value: 'yes', label: 'Yes' },
            { value: 'no', label: 'No' },
          ],
        },
        {
          id: createFieldId('fld_resume'),
          selector: '#resume_file',
          fieldType: 'file_upload',
          label: 'Attach Resume',
          isRequired: true,
          confidenceScore: 0.98,
          inferredMappingKey: 'documents.resume',
        },
      ];

      const form: ApplicationForm = {
        id: 'form_123',
        url: 'https://boards.greenhouse.io/example/jobs/12345',
        detectedAts: 'greenhouse',
        submitButtonSelector: '#submit_app',
        fields,
        isMultiStep: false,
        inspectedAt: new Date().toISOString(),
      };

      const plan = generateDryRunPlan(form, mockProfile);

      expect(plan.formId).toBe('form_123');
      expect(plan.detectedAts).toBe('greenhouse');
      expect(plan.submitButtonSelector).toBe('#submit_app');
      expect(plan.actions.length).toBe(4);

      // 1. Text action
      const firstAction = plan.actions[0]!;
      expect(firstAction.action.actionType).toBe('fill_text');
      expect(firstAction.action.selector).toBe('#first_name');
      expect(firstAction.action.value).toBe('Alex');
      expect(firstAction.riskLevel).toBe('low');
      expect(firstAction.userConfirmed).toBe(true); // Low risk auto-approved

      // 2. Select action
      const selectAction = plan.actions[1]!;
      expect(selectAction.action.actionType).toBe('select_option');
      expect(selectAction.action.value).toBe('US');
      expect(selectAction.candidateValueUsed).toBe('United States');

      // 3. Radio action
      const radioAction = plan.actions[2]!;
      expect(radioAction.action.actionType).toBe('click');
      expect(radioAction.action.selector).toBe('#sponsorship_group input[value="no"]');
      expect(radioAction.riskLevel).toBe('high');
      expect(radioAction.userConfirmed).toBe(false); // High risk requires explicit user confirmation

      // 4. File action
      const fileAction = plan.actions[3]!;
      expect(fileAction.action.actionType).toBe('upload_file');
      expect(fileAction.action.value).toBe('Alex_Rivera_Resume_2026.pdf');
      expect(fileAction.riskLevel).toBe('high');

      // Overall plan approval state: false until high risk items are approved
      expect(plan.isApproved).toBe(false);
      expect(plan.stats.highRiskCount).toBe(2);
      expect(plan.stats.requiresConfirmationCount).toBe(2);
    });

    it('strictly skips anti-bot honeypot traps and records them in skippedFields', () => {
      const honeypotField: ApplicationField = {
        id: createFieldId('fld_hp'),
        selector: '#website_hp',
        fieldType: 'text',
        label: 'Website',
        isRequired: false,
        confidenceScore: 0.9,
        isHoneypotSuspect: true,
        inferredMappingKey: 'links.portfolio',
      };

      const form: ApplicationForm = {
        id: 'form_honeypot',
        url: 'https://careers.example.com/apply',
        detectedAts: 'generic',
        fields: [honeypotField],
        isMultiStep: false,
        inspectedAt: new Date().toISOString(),
      };

      const plan = generateDryRunPlan(form, mockProfile);

      expect(plan.actions.length).toBe(0);
      expect(plan.skippedFields.length).toBe(1);
      expect(plan.skippedFields[0]?.reason).toBe('honeypot_trap');
      expect(plan.skippedFields[0]?.description).toContain('honeypot trap');
    });

    it('records fields without candidate profile data in skippedFields', () => {
      const customField: ApplicationField = {
        id: createFieldId('fld_custom'),
        selector: '#custom_why_hire',
        fieldType: 'textarea',
        label: 'Why should we hire you?',
        isRequired: true,
        confidenceScore: 0.3,
        inferredMappingKey: 'custom_question',
      };

      const form: ApplicationForm = {
        id: 'form_missing',
        url: 'https://careers.example.com/apply',
        detectedAts: 'generic',
        fields: [customField],
        isMultiStep: false,
        inspectedAt: new Date().toISOString(),
      };

      const plan = generateDryRunPlan(form, mockProfile);

      expect(plan.actions.length).toBe(0);
      expect(plan.skippedFields.length).toBe(1);
      expect(plan.skippedFields[0]?.reason).toBe('no_profile_value');
    });

    it('strictly enforces anti-autonomous submit gate: zero submit button clicks', () => {
      const submitField: ApplicationField = {
        id: createFieldId('fld_submit'),
        selector: '#submit_application_btn',
        fieldType: 'text',
        label: 'Submit Application',
        isRequired: false,
        confidenceScore: 0.5,
      };

      const form: ApplicationForm = {
        id: 'form_submit_test',
        url: 'https://careers.example.com/apply',
        detectedAts: 'greenhouse',
        submitButtonSelector: '#submit_application_btn',
        fields: [submitField],
        isMultiStep: false,
        inspectedAt: new Date().toISOString(),
      };

      const plan = generateDryRunPlan(form, mockProfile);
      // Submit elements should never produce executable actions
      const submitActions = plan.actions.filter(
        (a) => a.action.actionType === 'click' && a.action.selector.includes('submit')
      );
      expect(submitActions.length).toBe(0);
    });
  });

  describe('Plan Mutation Helpers', () => {
    it('updatePlanActionValue overrides candidate value and marks userConfirmed', () => {
      const field: ApplicationField = {
        id: createFieldId('fld_name'),
        selector: '#first_name',
        fieldType: 'text',
        label: 'First Name',
        isRequired: true,
        confidenceScore: 0.95,
        inferredMappingKey: 'identity.legalFirstName',
      };

      const form: ApplicationForm = {
        id: 'form_edit',
        url: 'https://example.com/apply',
        detectedAts: 'generic',
        fields: [field],
        isMultiStep: false,
        inspectedAt: new Date().toISOString(),
      };

      const plan = generateDryRunPlan(form, mockProfile);
      const actionId = plan.actions[0]!.id;

      const updated = updatePlanActionValue(plan, actionId, 'Alexander');
      expect(updated.actions[0]!.candidateValueUsed).toBe('Alexander');
      expect(updated.actions[0]!.action.value).toBe('Alexander');
      expect(updated.actions[0]!.userConfirmed).toBe(true);
      expect(updated.actions[0]!.diffExplanation).toContain('Alexander');
    });

    it('togglePlanActionApproval updates confirmation and recalculates plan isApproved', () => {
      const field: ApplicationField = {
        id: createFieldId('fld_auth'),
        selector: '#work_auth',
        fieldType: 'radio',
        label: 'Work Authorization',
        isRequired: true,
        confidenceScore: 0.95,
        inferredMappingKey: 'identity.workAuthorizations',
      };

      const form: ApplicationForm = {
        id: 'form_auth',
        url: 'https://example.com/apply',
        detectedAts: 'generic',
        fields: [field],
        isMultiStep: false,
        inspectedAt: new Date().toISOString(),
      };

      const plan = generateDryRunPlan(form, mockProfile);
      expect(plan.isApproved).toBe(false);
      expect(plan.stats.requiresConfirmationCount).toBe(1);

      const approvedPlan = togglePlanActionApproval(plan, plan.actions[0]!.id, true);
      expect(approvedPlan.actions[0]!.userConfirmed).toBe(true);
      expect(approvedPlan.stats.requiresConfirmationCount).toBe(0);
      expect(approvedPlan.isApproved).toBe(true);
    });

    it('excludePlanAction removes action and moves to skippedFields', () => {
      const field: ApplicationField = {
        id: createFieldId('fld_github'),
        selector: '#github',
        fieldType: 'text',
        label: 'GitHub URL',
        isRequired: false,
        confidenceScore: 0.95,
        inferredMappingKey: 'links.github',
      };

      const form: ApplicationForm = {
        id: 'form_exclude',
        url: 'https://example.com/apply',
        detectedAts: 'generic',
        fields: [field],
        isMultiStep: false,
        inspectedAt: new Date().toISOString(),
      };

      const plan = generateDryRunPlan(form, mockProfile);
      expect(plan.actions.length).toBe(1);

      const excludedPlan = excludePlanAction(plan, plan.actions[0]!.id);
      expect(excludedPlan.actions.length).toBe(0);
      expect(excludedPlan.skippedFields.length).toBe(1);
      expect(excludedPlan.skippedFields[0]?.reason).toBe('user_excluded');
    });
  });

  describe('Human-in-the-Loop Review UI & Selective Execution (Phase 10)', () => {
    it('resolveEvidenceSourceTitle maps inferred keys to ground truth categories', () => {
      expect(
        resolveEvidenceSourceTitle({
          id: createFieldId('f1'),
          selector: '#name',
          fieldType: 'text',
          label: 'First Name',
          isRequired: true,
          confidenceScore: 0.9,
          inferredMappingKey: 'identity.legalFirstName',
        })
      ).toBe('Candidate Identity (Verified Profile)');

      expect(
        resolveEvidenceSourceTitle({
          id: createFieldId('f2'),
          selector: '#email',
          fieldType: 'email',
          label: 'Email Address',
          isRequired: true,
          confidenceScore: 0.9,
          inferredMappingKey: 'identity.email',
        })
      ).toBe('Contact Information (Verified Profile)');

      expect(
        resolveEvidenceSourceTitle({
          id: createFieldId('f3'),
          selector: '#sponsorship',
          fieldType: 'radio',
          label: 'Requires Visa',
          isRequired: true,
          confidenceScore: 0.85,
          inferredMappingKey: 'workauthorization.requiresSponsorship',
        })
      ).toBe('Legal Work Authorization (User Confirmation Required)');

      expect(
        resolveEvidenceSourceTitle({
          id: createFieldId('f4'),
          selector: '#gender',
          fieldType: 'select',
          label: 'Gender Identity',
          isRequired: false,
          confidenceScore: 0.8,
          inferredMappingKey: 'eeo_gender',
        })
      ).toBe('Demographic Disclosures (User Confirmation Required)');
    });

    it('generateDryRunPlan attaches sourceEvidenceTitle to every planned action', () => {
      const form: ApplicationForm = {
        id: 'form_citations',
        url: 'https://jobs.lever.co/test/apply',
        detectedAts: 'lever',
        fields: [
          {
            id: createFieldId('fld_name'),
            selector: '#first_name',
            fieldType: 'text',
            label: 'First Name',
            isRequired: true,
            confidenceScore: 0.95,
            inferredMappingKey: 'identity.legalFirstName',
          },
          {
            id: createFieldId('fld_eeo'),
            selector: '#gender_select',
            fieldType: 'select',
            label: 'Gender',
            isRequired: false,
            confidenceScore: 0.88,
            inferredMappingKey: 'eeo_gender',
            options: [{ label: 'Non-binary', value: 'Non-binary' }],
          },
        ],
        isMultiStep: false,
        inspectedAt: new Date().toISOString(),
      };

      const plan = generateDryRunPlan(form, mockProfile);
      expect(plan.actions.length).toBe(2);

      const nameAction = plan.actions.find((a) => a.action.selector === '#first_name')!;
      expect(nameAction.sourceEvidenceTitle).toBe('Candidate Identity (Verified Profile)');

      const eeoAction = plan.actions.find((a) => a.action.selector === '#gender_select')!;
      expect(eeoAction.sourceEvidenceTitle).toBe('Demographic Disclosures (User Confirmation Required)');
    });

    it('approveAllLowRiskActions approves low-risk actions while keeping high-risk unconfirmed', () => {
      const form: ApplicationForm = {
        id: 'form_batch_approval',
        url: 'https://jobs.lever.co/test/apply',
        detectedAts: 'lever',
        fields: [
          {
            id: createFieldId('fld_email'),
            selector: '#email',
            fieldType: 'email',
            label: 'Email',
            isRequired: true,
            confidenceScore: 0.95,
            inferredMappingKey: 'identity.email',
          },
          {
            id: createFieldId('fld_sponsorship'),
            selector: '#sponsorship',
            fieldType: 'radio',
            label: 'Requires Sponsorship',
            isRequired: true,
            confidenceScore: 0.9,
            inferredMappingKey: 'workauthorization.requiresSponsorship',
            options: [
              { label: 'Yes', value: 'yes' },
              { label: 'No', value: 'no' },
            ],
          },
        ],
        isMultiStep: false,
        inspectedAt: new Date().toISOString(),
      };

      const plan = generateDryRunPlan(form, mockProfile);
      expect(plan.stats.lowRiskCount).toBe(1);
      expect(plan.stats.highRiskCount).toBe(1);

      // High-risk unconfirmed, low-risk confirmed
      const lowRiskApproved = approveAllLowRiskActions(plan);
      expect(lowRiskApproved.actions.find((a) => a.riskLevel === 'low')?.userConfirmed).toBe(true);
      expect(lowRiskApproved.actions.find((a) => a.riskLevel === 'high')?.userConfirmed).toBe(false);
      expect(lowRiskApproved.isApproved).toBe(false);
    });

    it('approveAllActions approves all actions and marks plan isApproved = true', () => {
      const form: ApplicationForm = {
        id: 'form_all_approved',
        url: 'https://jobs.lever.co/test/apply',
        detectedAts: 'lever',
        fields: [
          {
            id: createFieldId('fld_sponsorship'),
            selector: '#sponsorship',
            fieldType: 'radio',
            label: 'Requires Sponsorship',
            isRequired: true,
            confidenceScore: 0.9,
            inferredMappingKey: 'workauthorization.requiresSponsorship',
            options: [
              { label: 'Yes', value: 'yes' },
              { label: 'No', value: 'no' },
            ],
          },
        ],
        isMultiStep: false,
        inspectedAt: new Date().toISOString(),
      };

      const plan = generateDryRunPlan(form, mockProfile);
      expect(plan.isApproved).toBe(false);

      const allApproved = approveAllActions(plan);
      expect(allApproved.isApproved).toBe(true);
      expect(allApproved.stats.requiresConfirmationCount).toBe(0);
    });

    it('resetAllApprovals resets high-risk actions to unconfirmed', () => {
      const form: ApplicationForm = {
        id: 'form_reset',
        url: 'https://jobs.lever.co/test/apply',
        detectedAts: 'lever',
        fields: [
          {
            id: createFieldId('fld_sponsorship'),
            selector: '#sponsorship',
            fieldType: 'radio',
            label: 'Requires Sponsorship',
            isRequired: true,
            confidenceScore: 0.9,
            inferredMappingKey: 'workauthorization.requiresSponsorship',
            options: [
              { label: 'Yes', value: 'yes' },
              { label: 'No', value: 'no' },
            ],
          },
        ],
        isMultiStep: false,
        inspectedAt: new Date().toISOString(),
      };

      const plan = generateDryRunPlan(form, mockProfile);
      const approved = approveAllActions(plan);
      expect(approved.isApproved).toBe(true);

      const resetPlan = resetAllApprovals(approved);
      expect(resetPlan.isApproved).toBe(false);
      expect(resetPlan.actions[0]?.userConfirmed).toBe(false);
    });

    it('createSelectiveDryRunPlan creates a single-action plan ready for execution', () => {
      const form: ApplicationForm = {
        id: 'form_selective',
        url: 'https://jobs.lever.co/test/apply',
        detectedAts: 'lever',
        fields: [
          {
            id: createFieldId('fld_1'),
            selector: '#name',
            fieldType: 'text',
            label: 'Name',
            isRequired: true,
            confidenceScore: 0.95,
            inferredMappingKey: 'identity.legalFirstName',
          },
          {
            id: createFieldId('fld_2'),
            selector: '#email',
            fieldType: 'email',
            label: 'Email',
            isRequired: true,
            confidenceScore: 0.95,
            inferredMappingKey: 'identity.email',
          },
        ],
        isMultiStep: false,
        inspectedAt: new Date().toISOString(),
      };

      const plan = generateDryRunPlan(form, mockProfile);
      expect(plan.actions.length).toBe(2);

      const targetActionId = plan.actions[1]!.id;
      const selectivePlan = createSelectiveDryRunPlan(plan, targetActionId);

      expect(selectivePlan.actions.length).toBe(1);
      expect(selectivePlan.actions[0]!.id).toBe(targetActionId);
      expect(selectivePlan.actions[0]!.userConfirmed).toBe(true);
      expect(selectivePlan.isApproved).toBe(true);
      expect(selectivePlan.stats.totalActions).toBe(1);
    });
  });
});
