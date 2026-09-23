/**
 * Comprehensive end-to-end live verification of the ApplyKit form-filling pipeline.
 *
 * Drives the SAME code paths the production background/content scripts use, against the
 * real Tether job-application form fixture and (when GEMINI_TEST_KEY is set) the real
 * Gemini API. Verifies every field type: deterministic profile fills, radio groups,
 * selects, checkboxes, custom open-answer AI questions, and the anti-submit hard gate.
 *
 * @vitest-environment happy-dom
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { inspectPageForms } from '../../content/form-crawler.js';
import { executeBrowserPlan } from '../../content/action-interpreter.js';
import {
  generateDryRunPlan,
  isAiAnswerableCustomField,
  withAiProposedFieldAnswers,
  approveAllActions,
  createEmptyProfile,
  resolveProfileValueForField,
  deriveClaimsFromEvidence,
  buildFieldAnsweringPrompt,
  parseAndValidateJsonResponse,
  getWritingStyleFromProfile,
  type CandidateProfile,
  type ClaimType,
  type Evidence,
  type AiProposedFieldAnswer,
  type ApplicationField,
} from '@applykit/domain';
import { AIGateway } from '../../ai/gateway.js';

const FIXTURE = '/tmp/tether.html';
const GEMINI_KEY = process.env.GEMINI_TEST_KEY;
const hasLiveKey = Boolean(GEMINI_KEY);

function makeProfile(): CandidateProfile {
  const profile: CandidateProfile = {
    ...createEmptyProfile(),
    identity: {
      legalFirstName: 'Chukwuemeka',
      legalLastName: 'Adebayo',
      email: 'c.adebayo.swe@gmail.com',
      phone: '+234 801 555 0142',
      location: { city: 'Lagos', country: 'Nigeria', stateOrProvince: 'Lagos', postalCode: '100001' },
      workAuthorization: {
        isAuthorizedInCountry: false,
        requiresSponsorship: false,
        authorizedCountries: ['Nigeria'],
      },
    },
    professional: {
      headline: 'Senior Node.js Engineer — Distributed Systems & Open Source',
      summary:
        'Senior backend engineer with 9 years of production experience in Node.js, TypeScript, and distributed systems. Maintainer of public npm modules.',
      currentTitle: 'Senior Software Engineer',
      totalYearsOfExperience: 9,
      primaryRoles: ['Backend Engineer', 'Node.js Engineer'],
      targetRoles: ['Senior Node.js Engineer'],
      preferredLocations: ['Remote - Worldwide'],
      workplacePreference: 'remote',
      compensationExpectation: {
        targetSalaryMin: 180000,
        targetSalaryMax: 220000,
        currency: 'USD',
        period: 'annual',
        isNegotiable: true,
      },
      isOpenToRelocation: false,
    },
    links: {
      github: 'https://github.com/cadebayo',
      linkedin: 'https://www.linkedin.com/in/cadebayo',
      portfolio: 'https://cadebayo.dev',
      customLinks: [],
    },
    documents: [
      {
        id: 'doc_1' as never,
        fileName: 'Chukwuemeka_Adebayo_Resume_2026.pdf',
        documentType: 'resume',
        storageKey: 'storage_resume_1',
        mimeType: 'application/pdf',
        byteSize: 204800,
        sha256Checksum: 'abc123',
        uploadedAt: new Date().toISOString(),
        isPrimaryResume: true,
      },
    ],
    savedAnswers: [
      {
        id: 'ans_1' as never,
        canonicalKey: 'why_company:tether',
        promptPatterns: ['interested in working', 'why do you want to work', 'why are you interested'],
        answerText:
          'Tether builds the financial rails at the edge of adoption, and I want to work on systems that operate reliably at that scale. My background in distributed event systems and payment platforms maps directly to the problems on this team.',
        category: 'why_company',
        tags: ['tether', 'why_company'],
        evidenceRefs: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'ans_2' as never,
        canonicalKey: 'behavioral:interesting_project',
        promptPatterns: ['interesting project', 'project you worked on', 'recent project'],
        answerText:
          'A NATS-based event broker for a payments platform that handled about 40k messages per second across sharded consumers. I designed the topology, wrote the core stream code, and hardened the retry and dead-letter paths.',
        category: 'behavioral',
        tags: ['project', 'nats', 'distributed'],
        evidenceRefs: ['ev_5' as never],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'ans_3' as never,
        canonicalKey: 'technical_overview:modular_npm',
        promptPatterns: ['npm module', 'modular code', 'modular code based'],
        answerText:
          'I have built and maintained about a dozen public npm modules and keep packages small, dependency-light, and semantically versioned. I favor split packages over a single monolith so teams can compose the pieces they need.',
        category: 'technical_overview',
        tags: ['npm', 'modular'],
        evidenceRefs: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
  };

  const claims: Array<{ type: ClaimType; stmt: string; tags: string[]; conf: number }> = [
    { type: 'skill_proficiency', stmt: '9 years of production Node.js for high-throughput financial services', tags: ['node.js', 'backend'], conf: 0.98 },
    { type: 'skill_proficiency', stmt: 'Published and maintain 12 public npm modules', tags: ['npm', 'open source'], conf: 0.94 },
    { type: 'skill_proficiency', stmt: 'Deep experience with modular architecture and monorepos', tags: ['modular', 'architecture'], conf: 0.93 },
    { type: 'leadership', stmt: 'Tech lead for a 6-engineer team building a payment platform', tags: ['leadership', 'team'], conf: 0.9 },
    { type: 'achievement', stmt: 'Designed a NATS-based event broker handling 40k msg/s', tags: ['distributed', 'nats'], conf: 0.92 },
    { type: 'domain_knowledge', stmt: 'Contributions to open-source P2P and decentralized networking projects', tags: ['p2p', 'network'], conf: 0.88 },
    { type: 'skill_proficiency', stmt: 'Strong testing discipline: unit, integration, contract and e2e suites', tags: ['testing'], conf: 0.94 },
  ];

  const evidence: Evidence[] = claims.map((c, i) =>
    ({
      id: `ev_${i + 1}` as never,
      source: { sourceType: 'resume', sourceId: `resume_${i + 1}`, snippetRef: `l${i + 1}` },
      description: c.stmt,
      textSnippet: c.stmt,
      verificationStatus: 'verified',
      confidenceScore: c.conf,
      createdAt: new Date().toISOString(),
      tags: c.tags,
    }) as unknown as Evidence
  );

  const derivedClaims = deriveClaimsFromEvidence(evidence);
  return {
    ...profile,
    claims: derivedClaims.map((dc, i) => ({
      id: dc.id,
      statement: claims[i]?.stmt ?? dc.statement,
      claimType: claims[i]?.type ?? dc.claimType,
      supportedByEvidenceIds: dc.supportedByEvidenceIds,
      confidence: claims[i]?.conf ?? dc.confidence,
      tags: claims[i]?.tags ?? dc.tags,
      createdAt: dc.createdAt,
    })),
  };
}

describe('End-to-end form filling pipeline (production code paths)', () => {
  let form: ReturnType<typeof inspectPageForms>[number] | undefined;

  beforeAll(() => {
    if (!existsSync(FIXTURE)) {
      return;
    }
    const html = readFileSync(FIXTURE, 'utf-8');
    document.open();
    document.write(html);
    document.close();
    const forms = inspectPageForms(document);
    form = forms[0];
  });

  it('crawls the full Tether form with every field mapped', () => {
    if (!form) return;
    expect(form.fields.length).toBe(14);
    const labels = form.fields.map((f) => f.label.toLowerCase());
    ['Full name', 'Email address', 'Phone number', 'CV or resume', 'country', 'Expected annual salary'].forEach((l) =>
      expect(labels.some((x) => x.includes(l.toLowerCase()))).toBe(true)
    );
    expect(form.submitButtonSelector).toContain('submit-application-form-button');
  });

  it('deterministically fills every profile-mapped field', () => {
    if (!form) return;
    const profile = makeProfile();
    const plan = generateDryRunPlan(form, profile);

    const cover = new Map(plan.actions.map((a) => [a.fieldId, a]));

    for (const field of form.fields) {
      const expected = resolveProfileValueForField(profile, field.inferredMappingKey || field.label);
      if (!expected) {
        // Not profile-mapped -> should be either AI-answerable or skipped for another reason
        if (!isAiAnswerableCustomField(field)) {
          expect(plan.skippedFields.some((s) => s.fieldId === field.id) || cover.has(field.id)).toBe(true);
        }
        continue;
      }
      const action = cover.get(field.id);
      expect(action, `no plan action for mapped field "${field.label}"`).toBeDefined();
      if (field.fieldType === 'radio' || field.fieldType === 'select') {
        expect(['click', 'select_option']).toContain(action!.action.actionType);
      } else {
        expect(action!.action.value).toBe(expected);
      }
    }
  });

  it('answers all custom open-answer questions with the real Gemini API', async () => {
    if (!form) return;
    if (!hasLiveKey) return;
    const profile = makeProfile();
    const results: Array<{ label: string; ok: boolean; sample?: string; latencyMs: number }> = [];

    const gateway = new AIGateway({
      get: async () => {
        return { applykit_secure_provider_keys: { gemini: GEMINI_KEY } } as never;
      },
      set: async () => {},
    });

    const aiFields = form.fields.filter(isAiAnswerableCustomField);
    expect(aiFields.length).toBe(5);

    const answers: AiProposedFieldAnswer[] = [];

    for (const field of aiFields) {
      // Mirror background ANSWER_CUSTOM_FIELDS relevance selection exactly.
      const relevantAnswers = profile.savedAnswers.filter(
        (ans) =>
          field.label.toLowerCase().includes(ans.canonicalKey.toLowerCase()) ||
          ans.promptPatterns.some((p) => field.label.toLowerCase().includes(p.toLowerCase()))
      );
      const labelKeywords = field.label
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 2);
      const keywordMatchedClaims = profile.claims.filter((claim) => {
        const s = claim.statement.toLowerCase();
        const tags = (claim.tags || []).map((t) => t.toLowerCase());
        return labelKeywords.some((kw) => s.includes(kw) || tags.some((t) => t.includes(kw)));
      });

      const t0 = Date.now();
      const context = {
        fieldLabel: field.label,
        fieldType: field.fieldType,
        options: field.options,
        placeholder: field.placeholder,
        relevantAnswers,
        relevantClaims:
          keywordMatchedClaims.length >= 3
            ? keywordMatchedClaims
            : [...keywordMatchedClaims, ...profile.claims.slice(0, 5)],
        writingStyle: getWritingStyleFromProfile(profile),
        answerLengthPreference: 'normal',
      };
      const request = buildFieldAnsweringPrompt(context as never);
      const response = await gateway.executeRequest(request, 'gemini');

      interface FieldAnsweringResult {
        answerText: string;
        confidence: number;
        supportingClaimIds: string[];
        isGrounded: boolean;
        notes: string;
      }
      const isResult = (v: unknown): v is FieldAnsweringResult =>
        typeof v === 'object' && v !== null && typeof (v as Record<string, unknown>).answerText === 'string';
      const parsed = parseAndValidateJsonResponse<FieldAnsweringResult>(response.rawText, isResult);

      const latencyMs = Date.now() - t0;
      if (parsed.success && parsed.data) {
        answers.push({
          fieldId: field.id,
          answerText: parsed.data.answerText,
          confidence: Math.min(1, Math.max(0, parsed.data.confidence ?? 0.8)),
          supportingClaimIds: parsed.data.supportingClaimIds ?? [],
        });
      }
      results.push({
        label: field.label.slice(0, 50),
        ok: parsed.success && Boolean(parsed.data?.answerText.trim()),
        sample: parsed.data?.answerText.slice(0, 140),
        latencyMs,
      });
    }

    console.log('\n===== LIVE GEMINI FIELD ANSWERS =====');
    for (const r of results) {
      console.log(`\n[${r.ok ? 'OK' : 'FAIL'}] ${r.label} (${r.latencyMs}ms)`);
      if (r.sample) console.log('   ->', r.sample);
    }

    expect(answers.length).toBe(5);
    const freeTextAnswers = answers.filter((a) => {
      const field = form!.fields.find((f) => f.id === a.fieldId);
      return field?.fieldType !== 'number';
    });
    for (const a of freeTextAnswers) {
      expect(a.answerText.trim().length).toBeGreaterThan(10);
    }
    // Numeric fields should contain only digits
    const numeric = answers.filter((a) => form!.fields.find((f) => f.id === a.fieldId)?.fieldType === 'number');
    for (const a of numeric) {
      expect(a.answerText.trim()).toMatch(/^\d+$/);
    }
  }, 180000);

  it('merges AI answers into a complete, reviewable plan', () => {
    if (!form) return;
    const profile = makeProfile();
    const plan = generateDryRunPlan(form, profile);

    const fakeAnswers: AiProposedFieldAnswer[] = form.fields
      .filter(isAiAnswerableCustomField)
      .map((f, i) => ({
        fieldId: f.id,
        answerText: `Grounded evidence-backed answer for question ${i + 1}`,
        confidence: 0.8,
        supportingClaimIds: [],
      }));

    const merged = withAiProposedFieldAnswers(plan, form, fakeAnswers);

    // Every required field now covered, either deterministic or AI-proposed
    const covered = new Set(merged.actions.map((a) => a.fieldId));
    const uncoveredRequired = form.fields.filter((f) => f.isRequired && !covered.has(f.id));
    expect(uncoveredRequired.length).toBe(0);

    // AI-proposed answers are staged as unconfirmed, medium-risk review items
    const aiProposed = merged.actions.filter(
      (a) => a.sourceEvidenceTitle === 'AI Proposal Grounded in Evidence Graph'
    );
    expect(aiProposed.length).toBe(fakeAnswers.length);
    expect(aiProposed.every((a) => a.userConfirmed === false && a.riskLevel === 'medium')).toBe(true);
  });

  it('executes the approved deterministic plan against the live DOM (interpreter path)', async () => {
    if (!form) return;
    const profile = makeProfile();
    const plan = generateDryRunPlan(form, profile, { includeRedundantFills: true });

    const executed = await executeBrowserPlan(plan, document, {
      highlightElements: false,
      pacingMode: 'instant',
      simulateKeystrokes: false,
      pacingDelayMs: 0,
    });

    const byField = new Map(plan.actions.filter((a) => a.userConfirmed).map((a) => [a.fieldId, a]));

    for (const field of form.fields) {
      const action = byField.get(field.id);
      if (!action) continue;
      if (action.action.actionType !== 'fill_text') continue;
      const el = document.querySelector<HTMLInputElement>(field.selector);
      if (!el) continue;
      expect(el.value.length).toBeGreaterThan(0);
    }
    // Only low-risk deterministic fields are approved without candidate review
    expect(executed.failedCount).toBe(0);
    expect(executed.executedCount).toBeGreaterThanOrEqual(7);
    expect(executed.haltedAtSubmissionGate).toBe(true);
  }, 30000);
});

describe('Yes/No, checkbox, and option-extra fields (synthetic form)', () => {
  const SYNTHETIC = `
    <form id="app">
      <legend-p style="display:none"></legend-p>
      <div>
        <label>Full name</label><input name="name" id="f_name">
      </div>
      <div>
        <legend>Are you legally authorized to work in Nigeria?</legend>
        <label><input type="radio" name="auth" value="yes"> Yes</label>
        <label><input type="radio" name="auth" value="no"> No</label>
      </div>
      <div>
        <legend>Will you now or in the future require visa sponsorship?</legend>
        <label><input type="radio" name="sponsor" value="yes"> Yes</label>
        <label><input type="radio" name="sponsor" value="no"> No</label>
      </div>
      <div>
        <label><input type="checkbox" name="poc_selfid"> I self-identify as a member of an underrepresented group</label>
      </div>
      <div>
        <label>How did you hear about us?</label>
        <select name="source">
          <option value="">Select...</option>
          <option value="linkedin">LinkedIn</option>
          <option value="referral">Referral</option>
        </select>
      </div>
      <div>
        <label>GitHub URL</label><input name="gh" id="gh_url">
      </div>
      <button type="submit" id="submit">Submit Application</button>
    </form>
  `;

  it('maps yes/no radios, checkbox, and select to correct actions', () => {
    document.body.innerHTML = SYNTHETIC;
    const forms = inspectPageForms(document);
    expect(forms.length).toBe(1);
    const form = forms[0]!;

    const profile: CandidateProfile = {
      ...makeProfile(),
      identity: {
        ...makeProfile().identity,
        workAuthorization: {
          isAuthorizedInCountry: false,
          requiresSponsorship: false,
          authorizedCountries: ['Nigeria'],
        },
        demographics: {
          gender: 'Male',
          veteranStatus: 'not_veteran',
          disabilityStatus: 'no_disability',
        },
      },
    };

    const plan = generateDryRunPlan(form, profile, { includeRedundantFills: true });
    const actions = new Map(plan.actions.map((a) => [a.fieldId, a]));

    // Auth radio: authorized in-country flag says No -> select "no" radio
    const authField = form.fields.find((f) => f.label.includes('Are you legally authorized'));
    const authAction = authField ? actions.get(authField.id) : undefined;
    expect(authAction).toBeDefined();
    expect(authAction?.action.actionType).toBe('click');
    // sponsorship radio: does not require sponsorship -> No
    const sponsorField = form.fields.find((f) => f.label.includes('visa sponsorship'));
    const sponsorAction = sponsorField ? actions.get(sponsorField.id) : undefined;
    expect(sponsorAction).toBeDefined();

    // EEO checkbox remains unchecked unless candidate affirmatively opted in
    const checkboxField = form.fields.find((f) => f.fieldType === 'checkbox');
    const checkboxAction = checkboxField ? actions.get(checkboxField.id) : undefined;
    if (checkboxAction) {
      const isCheck = checkboxAction.action.actionType === 'check';
      expect(isCheck).toBe(false);
    }

    // Referral select resolves from profile ("LinkedIn")
    const selectAction = [...actions.values()].find((a) => a.action.actionType === 'select_option');
    expect(selectAction).toBeDefined();
    expect(selectAction?.action.value).toBe('linkedin');
  });

  it('executes yes/no + checkbox + select actions in the DOM', async () => {
    document.body.innerHTML = SYNTHETIC;
    const forms = inspectPageForms(document);
    const form = forms[0]!;
    const profile: CandidateProfile = {
      ...makeProfile(),
      identity: {
        ...makeProfile().identity,
        workAuthorization: {
          isAuthorizedInCountry: false,
          requiresSponsorship: false,
          authorizedCountries: ['Nigeria'],
        },
      },
    };
    const plan = generateDryRunPlan(form, profile, { includeRedundantFills: true });
    const approved = approveAllActions(plan);

    await executeBrowserPlan(approved, document, {
      highlightElements: false,
      pacingMode: 'instant',
      simulateKeystrokes: false,
      pacingDelayMs: 0,
    });

    const authYes = document.querySelector<HTMLInputElement>('input[name="auth"][value="yes"]');
    const authNo = document.querySelector<HTMLInputElement>('input[name="auth"][value="no"]');
    expect(authYes?.checked).toBe(false);
    expect(authNo?.checked).toBe(true);

    const sponsorYes = document.querySelector<HTMLInputElement>('input[name="sponsor"][value="yes"]');
    const sponsorNo = document.querySelector<HTMLInputElement>('input[name="sponsor"][value="no"]');
    expect(sponsorYes?.checked).toBe(false);
    expect(sponsorNo?.checked).toBe(true);

    const gh = document.querySelector<HTMLInputElement>('#gh_url');
    expect(gh?.value).toContain('github.com/cadebayo');
  });

  it('hard-gates: never generates or executes submit clicks', async () => {
    document.body.innerHTML = SYNTHETIC;
    const forms = inspectPageForms(document);
    const form = forms[0]!;
    const profile = makeProfile();
    const plan = generateDryRunPlan(form, profile, { includeRedundantFills: true });

    // No action targets the submit button
    for (const action of plan.actions) {
      expect(action.action.selector).not.toContain('#submit');
    }
    // Interpreter refuses programmatic submit execution (reports failed, halted at gate)
    const submitBtn = document.querySelector<HTMLElement>('#submit');
    expect(submitBtn).toBeDefined();
    const forgedReport = await executeBrowserPlan(
      {
        ...plan,
        actions: [
          {
            ...plan.actions[0]!,
            id: 'forged' as never,
            userConfirmed: true,
            action: { actionType: 'click', selector: '#submit', value: undefined, description: 'x', requiresUserConfirmation: true },
          },
        ],
      },
      document,
      { highlightElements: false, pacingMode: 'instant', simulateKeystrokes: false, pacingDelayMs: 0 }
    );
    expect(forgedReport.failedCount).toBeGreaterThan(0);
    expect(forgedReport.haltedAtSubmissionGate).toBe(true);
    expect(forgedReport.executedActionIds).not.toContain('forged' as never);
  });
});