/**
 * @fileoverview Real-World Canonical Careers End-to-End Simulation Test Suite.
 *
 * Simulates the complete candidate journey for Canonical Distributed Systems Engineer
 * (https://canonical.com/careers/4581200):
 * 1. Real Canonical job extraction (mission, values, distributed systems & open source requirements).
 * 2. 14-Point Resume Golden Standard tailoring & vector PDF compilation.
 * 3. Evidence-grounded 'Why Canonical?' pitch & cover letter synthesis.
 * 4. Form crawling & dry-run planning for Canonical's application form (Greenhouse-backed).
 * 5. Submission Hard Gate verification (halts at awaiting_user_review).
 * 6. Automated post-apply redirect detection (`/confirmation`) & Kanban pipeline update.
 *
 * @vitest-environment happy-dom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { indexedDB } from 'fake-indexeddb';
import {
  createEmptyProfile,
  createProfileId,
  createSkillId,
  createExperienceId,
  createJobPostingId,
  createRequirementId,
  createApplicationId,
  createFieldId,
  createEvidenceId,
  createClaimId,
  buildEvidenceGraph,
  evaluateJobRequirements,
  tailorCandidateResume,
  generateGroundedCoverLetter,
  generateResumePdfBlob,
  extractCompanyCulture,
  evaluateCompanyCultureAlignment,
  generateDryRunPlan,
  createApplicationRecord,
  type JobPosting,
  type CandidateProfile,
  type ApplicationForm,
  type ApplicationField,
} from '@applykit/domain';
import {
  IndexedDbApplicationRepository,
  deleteDatabase,
  setApplicationRepository,
} from '../storage/index.js';
import { processSubmissionDetection } from '../background/submission-detector.js';
import { inspectPageForms } from '../content/form-crawler.js';

describe('Canonical Careers (4581200) Real-World End-to-End Simulation', () => {
  let appRepo: IndexedDbApplicationRepository;

  const canonicalJobUrl = 'https://canonical.com/careers/4581200';

  const canonicalJobDescription = `
    About Canonical:
    Canonical is a leading provider of open source software and operating system technologies,
    best known for Ubuntu. Our mission is to make open source software accessible and reliable
    for developers and enterprises globally. We are an international, remote-first team driven by
    autonomous ownership and engineering craftsmanship.

    The Role: Distributed Systems Engineer
    We are seeking a Distributed Systems Engineer to design, architect, and deliver high-throughput,
    fault-tolerant backend streaming pipelines and edge infrastructure for the Snappy/Ubuntu IoT ecosystem.

    Requirements:
    - Proven experience designing and architecting scalable backend systems in Go or Python.
    - Deep expertise in distributed systems, consensus algorithms, and fault tolerance.
    - Practical experience with data streaming technologies including Apache Kafka or MQTT.
    - Working knowledge of Linux systems internals and container orchestration (Kubernetes, LXD).
    - Strong communication and autonomous ownership in a remote environment.
  `;

  const canonicalJob: JobPosting = {
    id: createJobPostingId('job_canonical_4581200'),
    url: canonicalJobUrl,
    title: 'Distributed Systems Engineer',
    companyName: 'Canonical',
    location: 'Remote (Worldwide / EMEA)',
    workplaceType: 'remote',
    employmentType: 'full_time',
    rawDescription: canonicalJobDescription,
    parsedAt: '2026-09-28T12:00:00Z',
    requirements: [
      {
        id: createRequirementId('req_go'),
        rawText: 'Scalable backend systems in Go or Python',
        category: 'technical_skill',
        importance: 'required',
        normalizedSkillOrCompetency: 'Go',
        yearsRequired: 4,
        isRequired: true,
        matchedEvidenceIds: [],
      },
      {
        id: createRequirementId('req_dist'),
        rawText: 'Deep expertise in distributed systems and consensus',
        category: 'technical_skill',
        importance: 'required',
        normalizedSkillOrCompetency: 'Distributed Systems',
        yearsRequired: 5,
        isRequired: true,
        matchedEvidenceIds: [],
      },
      {
        id: createRequirementId('req_kafka'),
        rawText: 'Data streaming technologies including Apache Kafka or MQTT',
        category: 'technical_skill',
        importance: 'required',
        normalizedSkillOrCompetency: 'Kafka',
        yearsRequired: 3,
        isRequired: true,
        matchedEvidenceIds: [],
      },
      {
        id: createRequirementId('req_linux'),
        rawText: 'Linux systems internals and container orchestration',
        category: 'technical_skill',
        importance: 'preferred',
        normalizedSkillOrCompetency: 'Linux',
        yearsRequired: 4,
        isRequired: false,
        matchedEvidenceIds: [],
      },
    ],
    metadata: { ats: 'greenhouse' },
  };

  const candidateProfile: CandidateProfile = {
    ...createEmptyProfile(createProfileId('prof_canonical_candidate')),
    identity: {
      legalFirstName: 'Morgan',
      legalLastName: 'Reed',
      preferredName: 'Morgan',
      email: 'morgan.reed@example.com',
      phone: '+44 20 7946 0991',
      location: { country: 'United Kingdom', city: 'London' },
      workAuthorization: { isAuthorizedInCountry: true, requiresSponsorship: false, authorizedCountries: ['UK'] },
      demographics: {},
    },
    links: {
      github: 'https://github.com/mreed',
      linkedin: 'https://linkedin.com/in/mreed',
      portfolio: 'https://mreed.dev',
      customLinks: [],
    },
    skills: [
      { id: createSkillId('sk_go'), name: 'Go', normalizedName: 'go', category: 'language', proficiency: 'expert', yearsOfExperience: 6, evidenceRefs: [] },
      { id: createSkillId('sk_dist'), name: 'Distributed Systems', normalizedName: 'distributed systems', category: 'architecture_pattern', proficiency: 'expert', yearsOfExperience: 7, evidenceRefs: [] },
      { id: createSkillId('sk_kafka'), name: 'Kafka', normalizedName: 'kafka', category: 'cloud_infrastructure', proficiency: 'expert', yearsOfExperience: 5, evidenceRefs: [] },
      { id: createSkillId('sk_linux'), name: 'Linux', normalizedName: 'linux', category: 'devops_tool', proficiency: 'expert', yearsOfExperience: 8, evidenceRefs: [] },
    ],
    professional: {
      headline: 'Lead Distributed Systems Engineer',
      summary: 'Senior distributed systems engineer with 6+ years experience in Go and Kafka.',
      totalYearsOfExperience: 5,
      primaryRoles: ['Distributed Systems Engineer'],
      targetRoles: ['Distributed Systems Engineer'],
      preferredLocations: ['Remote', 'London, UK'],
      workplacePreference: 'remote',
      isOpenToRelocation: true,
    },
    education: [
      {
        id: 'edu_imperial' as any,
        degree: 'BSc Computer Science',
        institution: 'Imperial College London',
        fieldOfStudy: 'Computer Science',
        endDate: '2018-06',
        isCompleted: true,
        honors: ['First Class Honours'],
        relevantCoursework: [],
        activities: [],
        evidenceRefs: [],
      },
    ],
    experiences: [
      {
        id: createExperienceId('exp_lead_dist'),
        company: 'CloudStream Infrastructure Ltd',
        title: 'Lead Distributed Systems Engineer',
        employmentType: 'full_time',
        location: 'London, UK',
        isRemote: true,
        startDate: '2021-03',
        isCurrent: true,
        description: 'Architecting distributed streaming pipelines and consensus engines in Go.',
        technologiesUsed: ['Go', 'Kafka', 'Linux', 'Docker', 'Kubernetes'],
        evidenceRefs: [],
        highlights: [
          'Engineered low-latency Raft consensus streaming engine in Go processing 300,000 events/second.',
          'Active contributor to open source Kubernetes and Linux ecosystem telemetry projects.',
          'Optimized Linux kernel networking socket parameters to reduce tail latency by 35%.',
        ],
      },
    ],
  };

  const ev1 = {
    id: createEvidenceId('ev_raft_stream'),
    source: { type: 'resume_bullet' as const, sourceId: 'exp_lead_dist' },
    description: 'High throughput streaming and consensus in Go',
    textSnippet: 'Engineered low-latency Raft consensus streaming engine in Go processing 300,000 events/second.',
    verificationStatus: 'verified' as const,
    confidenceScore: 1.0,
    createdAt: '2026-09-28T00:00:00Z',
    tags: ['Go', 'Distributed Systems', 'Kafka'],
  };
  const ev2 = {
    id: createEvidenceId('ev_oss_contrib'),
    source: { type: 'git_repository' as const, sourceId: 'github_oss' },
    description: 'Open source contributions',
    textSnippet: 'Active contributor to open source Kubernetes and Linux ecosystem telemetry projects.',
    verificationStatus: 'verified' as const,
    confidenceScore: 1.0,
    createdAt: '2026-09-28T00:00:00Z',
    tags: ['Open Source', 'Linux', 'Ubuntu'],
  };
  const evidenceGraph = buildEvidenceGraph([ev1, ev2], []);

  beforeEach(async () => {
    await deleteDatabase(indexedDB);
    appRepo = new IndexedDbApplicationRepository(indexedDB);
    setApplicationRepository(appRepo);
  });

  afterEach(() => {
    appRepo?.close();
    setApplicationRepository(null);
  });

  it('Stage 1: Extracts culture, matches qualifications, and tailors a 14-point Golden Resume', async () => {
    // 1. Company Culture Extraction
    const culture = extractCompanyCulture(canonicalJobDescription, 'Canonical');
    expect(culture.companyName).toBe('Canonical');
    expect(culture.coreValues).toContain('Open Source & Transparency');
    expect(culture.engineeringPrinciples).toContain('Distributed Systems & Reliability');
    expect(culture.productEcosystem).toContain('Ubuntu');

    // 2. Cultural Alignment
    const alignment = evaluateCompanyCultureAlignment(culture, candidateProfile, evidenceGraph);
    expect(alignment.score).toBeGreaterThanOrEqual(0.6);
    expect(alignment.whyUsPitch).toContain('Canonical');
    expect(alignment.whyUsPitch).toContain('Open Source');

    // 3. Requirement Matching
    const matchResult = evaluateJobRequirements(
      canonicalJob.requirements,
      candidateProfile,
      evidenceGraph
    );
    expect(matchResult.requiredMetCount).toBe(3);
    expect(matchResult.hardGapsCount).toBe(0);

    // 4. Resume Tailoring with 14-point check
    const tailoredResume = tailorCandidateResume(canonicalJob, candidateProfile, evidenceGraph, {
      templateId: 'modern',
      onePageFit: true,
    });
    expect(tailoredResume.targetJobTitle).toBe('Distributed Systems Engineer');
    expect(tailoredResume.companyName).toBe('Canonical');
    expect(tailoredResume.qualityAudit?.overallScore).toBeGreaterThanOrEqual(80);

    // 5. Vector PDF Generation
    const pdfBlob = await generateResumePdfBlob(tailoredResume, candidateProfile, {
      templateId: 'modern',
      density: 'standard',
      showTargetBadge: true,
    });
    expect(pdfBlob).toBeDefined();
    expect(pdfBlob.size).toBeGreaterThan(1500);

    const buf = await pdfBlob.arrayBuffer();
    const magicHeader = String.fromCharCode(...new Uint8Array(buf).slice(0, 5));
    expect(magicHeader).toBe('%PDF-');

    // 6. Grounded Cover Letter with "Why Canonical?" paragraph
    const coverLetter = generateGroundedCoverLetter(canonicalJob, candidateProfile, evidenceGraph, {
      cultureAlignment: alignment,
    });
    expect(coverLetter.bodyParagraphs.length).toBeGreaterThanOrEqual(2);
    expect(coverLetter.fullText).toContain('Canonical');
    expect(coverLetter.fullText).toContain('Raft consensus');
  });

  it('Stage 2: Crawls Canonical form, forms dry-run plan, and halts at awaiting_user_review (Submission Hard Gate)', async () => {
    // Simulate Canonical's application form fields (derived from Greenhouse)
    const formFields: ApplicationField[] = [
      {
        id: createFieldId('fld_first_name'),
        selector: '#first_name',
        label: 'First Name',
        fieldType: 'text',
        confidenceScore: 1.0,
        isRequired: true,
        inferredMappingKey: 'first_name',
      },
      {
        id: createFieldId('fld_last_name'),
        selector: '#last_name',
        label: 'Last Name',
        fieldType: 'text',
        confidenceScore: 1.0,
        isRequired: true,
        inferredMappingKey: 'last_name',
      },
      {
        id: createFieldId('fld_email'),
        selector: '#email',
        label: 'Email',
        fieldType: 'email',
        confidenceScore: 1.0,
        isRequired: true,
        inferredMappingKey: 'email',
      },
      {
        id: createFieldId('fld_phone'),
        selector: '#phone',
        label: 'Phone',
        fieldType: 'tel',
        confidenceScore: 1.0,
        isRequired: true,
        inferredMappingKey: 'phone',
      },
      {
        id: createFieldId('fld_linkedin'),
        selector: '#job_app_linkedin',
        label: 'LinkedIn Profile',
        fieldType: 'text',
        confidenceScore: 1.0,
        isRequired: false,
        inferredMappingKey: 'linkedin_url',
      },
      {
        id: createFieldId('fld_github'),
        selector: '#job_app_github',
        label: 'GitHub Profile',
        fieldType: 'text',
        confidenceScore: 1.0,
        isRequired: false,
        inferredMappingKey: 'github_url',
      },
    ];

    const form: ApplicationForm = {
      id: 'canonical_form_4581200',
      url: 'https://canonical.com/careers/4581200/apply',
      detectedAts: 'greenhouse',
      fields: formFields,
      submitButtonSelector: '#submit_app',
      isMultiStep: false,
      inspectedAt: '2026-09-28T12:00:00Z',
    };

    const plan = generateDryRunPlan(form, candidateProfile);

    // Verify all standard profile fields mapped
    expect(plan.actions.length).toBe(6);
    expect(plan.actions.find((a) => a.action.selector === '#first_name')?.action.value).toBe('Morgan');
    expect(plan.actions.find((a) => a.action.selector === '#last_name')?.action.value).toBe('Reed');
    expect(plan.actions.find((a) => a.action.selector === '#email')?.action.value).toBe('morgan.reed@example.com');
    expect(plan.actions.find((a) => a.action.selector === '#job_app_linkedin')?.action.value).toBe('https://linkedin.com/in/mreed');

    // Invariant: Submission button must be strictly excluded from automated dry-run plan
    const submitAction = plan.actions.find((a) => a.action.selector === '#submit_app');
    expect(submitAction).toBeUndefined();

    // Create and track Canonical application record
    const appId = createApplicationId('app_canonical_4581200');
    const app = createApplicationRecord({
      id: appId,
      candidateProfileId: candidateProfile.id,
      jobPostingId: canonicalJob.id,
      companyName: 'Canonical',
      jobTitle: 'Distributed Systems Engineer',
      jobPostingUrl: canonicalJobUrl,
      matchedRequirementsScore: 0.95,
      recruiterName: 'Canonical Talent Acquisition',
      notes: 'Applied via official careers portal.',
    });
    await appRepo.saveApplication(app);

    // Transition to awaiting_user_review
    await appRepo.updateApplicationStatus(appId, 'ready_to_fill');
    await appRepo.updateApplicationStatus(appId, 'dry_run_review');
    await appRepo.updateApplicationStatus(appId, 'executing_actions');
    const waitingApp = await appRepo.updateApplicationStatus(appId, 'awaiting_user_review');

    expect(waitingApp.currentStatus).toBe('awaiting_user_review');
  });

  it('Stage 2b: Accurately crawls real Canonical Careers DOM with search box preceding job-apply-form', async () => {
    delete (window as any).location;
    window.location = new URL('https://canonical.com/careers/4581200/application') as any;

    document.body.innerHTML = `
      <form action="/search" class="p-search-box">
        <input type="search" name="q" placeholder="Search..." />
        <button type="submit">Search</button>
      </form>
      <form id="job-apply-form" action="/careers/4581200" method="POST" enctype="multipart/form-data" class="js-roles-list--form" data-ga-submit-category="Form" data-ga-submit-action="job application: 4581200" data-ga-submit-label="Submit Application" >
        <input type="hidden" name="id" value="4581200" />
        <input type="hidden" name="mapped_url_token" id="gh_src" value="" />
        <label for="first_name" class="is-required">First Name</label>
        <input id="first_name" name="first_name" type="text" required maxlength="255"/>
        <label for="last_name" class="is-required">Last Name</label>
        <input id="last_name" name="last_name" type="text" required maxlength="255"/>
        <label for="email" class="is-required">Email</label>
        <input id="email" name="email" type="text" required maxlength="255"/>
        <label for="phone" class="">Phone</label>
        <input id="phone" name="phone" type="text" maxlength="255"/>
        <label for="resume" class="is-required">Resume</label>
        <input id="resume" name="resume" type="file" required accept=".pdf, .doc, .docx, .txt, .rtf"/>
        <label for="question_36959928" class="is-required">When evaluating distributed system design, what is the one question you instinctively ask first?</label>
        <textarea id="question_36959928" name="question_36959928" required></textarea>
        <label for="question_41855638" class="is-required">In which country do you currently work?</label>
        <select name="question_41855638" id="question_41855638" required>
          <option value="" disabled selected>Select an option</option>
          <option value="United States">United States</option>
          <option value="United Kingdom">United Kingdom</option>
          <option value="Canada">Canada</option>
        </select>
        <label for="question_42880856" class="is-required">During this application process I agree to use only my own words...</label>
        <select name="question_42880856" id="question_42880856" required>
          <option value="" disabled selected>Select an option</option>
          <option value="0">No</option>
          <option value="1">Yes</option>
        </select>
        <label for="question_37490520" class="is-required">How did you perform in mathematics at high school?</label>
        <select name="question_37490520" id="question_37490520" required>
          <option value="" disabled selected>Select an option</option>
          <option value="Top 50% at school">Top 50% at school</option>
          <option value="Top 20% at school">Top 20% at school</option>
          <option value="Top 10% at school">Top 10% at school</option>
          <option value="Top 5% at school">Top 5% at school</option>
        </select>
        <label for="question_37491142" class="is-required">How did you perform in your native language at high school?</label>
        <select name="question_37491142" id="question_37491142" required>
          <option value="" disabled selected>Select an option</option>
          <option value="Top 50% at school">Top 50% at school</option>
          <option value="Top 20% at school">Top 20% at school</option>
          <option value="Top 10% at school">Top 10% at school</option>
          <option value="Top 5% at school">Top 5% at school</option>
        </select>
        <label for="question_41855687" class="is-required">Please share your rationale or evidence for the high school performance selections above...</label>
        <textarea id="question_41855687" name="question_41855687" required></textarea>
        <label for="question_37490054" class="is-required">What was your bachelor's university degree result, or expected result if you have not yet graduated?</label>
        <input id="question_37490054" name="question_37490054" type="text" required />
        <label for="question_37491668" class="is-required">We require all colleagues to meet in person 2-4 times a year... Are you able and willing to travel internationally for these events?</label>
        <select name="question_37491668" id="question_37491668" required>
          <option value="" disabled selected>Select an option</option>
          <option value="0">No</option>
          <option value="1">Yes</option>
        </select>
        <label for="question_37493242" class="is-required">Please confirm that you have read and agree to Canonical's Recruitment Privacy Notice and Privacy Policy</label>
        <select name="question_37493242" id="question_37493242" required>
          <option value="" disabled selected>Select an option</option>
          <option value="Acknowledge/Confirm">Acknowledge/Confirm</option>
        </select>
        <label for="question_55259163" class="is-required">In the past ten years, looking only at the time since you graduated your first undergraduate degree, how many years have you been in full-time employment?</label>
        <select name="question_55259163" id="question_55259163" required>
          <option value="" disabled selected>Select an option</option>
          <option value="1">1</option>
          <option value="3">3</option>
          <option value="5">5</option>
          <option value="10+">10+</option>
        </select>
        <input type="submit" class="p-button--positive u-no-margin--bottom js-submit-button" name="submit_button" value="Submit application"/>
      </form>
    `;

    const forms = inspectPageForms(document);
    expect(forms.length).toBeGreaterThanOrEqual(1);

    const canonicalForm = (forms.find((f) => f.id === 'job-apply-form' || f.detectedAts === 'greenhouse') || forms[0])!;
    expect(canonicalForm).toBeDefined();

    // Verify search box was bypassed and application inputs extracted
    const fieldNames = canonicalForm.fields.map((f) => f.name || f.label);
    expect(fieldNames).toContain('first_name');
    expect(fieldNames).toContain('last_name');
    expect(fieldNames).toContain('email');
    expect(fieldNames).toContain('phone');
    expect(fieldNames).toContain('resume');
    expect(fieldNames).toContain('question_36959928');
    expect(fieldNames).toContain('question_41855638');
    expect(fieldNames).toContain('question_42880856');
    expect(fieldNames).toContain('question_37490520');
    expect(fieldNames).toContain('question_37491142');
    expect(fieldNames).toContain('question_41855687');
    expect(fieldNames).toContain('question_37490054');
    expect(fieldNames).toContain('question_37491668');
    expect(fieldNames).toContain('question_37493242');
    expect(fieldNames).toContain('question_55259163');

    // Generate dry run plan and verify values
    const plan = generateDryRunPlan(canonicalForm, candidateProfile);
    expect(plan.actions.find((a) => a.action.selector === '#first_name')?.action.value).toBe('Morgan');
    expect(plan.actions.find((a) => a.action.selector === '#last_name')?.action.value).toBe('Reed');
    expect(plan.actions.find((a) => a.action.selector === '#email')?.action.value).toBe('morgan.reed@example.com');
    expect(plan.actions.find((a) => a.action.selector === '#question_41855638')?.action.value).toBe('United Kingdom');
    expect(plan.actions.find((a) => a.action.selector === '#question_42880856')?.action.value).toBe('1');
    expect(plan.actions.find((a) => a.action.selector === '#question_37490520')?.action.value).toBe('Top 5% at school');
    expect(plan.actions.find((a) => a.action.selector === '#question_37491142')?.action.value).toBe('Top 10% at school');
    expect(plan.actions.find((a) => a.action.selector === '#question_41855687')?.action.value).toContain('distinction');
    expect(plan.actions.find((a) => a.action.selector === '#question_37490054')?.action.value).toContain('First Class');
    expect(plan.actions.find((a) => a.action.selector === '#question_37491668')?.action.value).toBe('1');
    expect(plan.actions.find((a) => a.action.selector === '#question_37493242')?.action.value).toBe('Acknowledge/Confirm');
    expect(plan.actions.find((a) => a.action.selector === '#question_55259163')?.action.value).toBe('5');

    // Anti-Autonomous Submit Hard Gate: submit button must NOT have an action
    expect(plan.actions.some((a) => a.action.selector.includes('submit'))).toBe(false);
  });

  it('Stage 3: Detects post-submission ATS confirmation URL and idempotently advances Kanban pipeline to submitted', async () => {
    const appId = createApplicationId('app_canonical_active');
    const activeApp = createApplicationRecord({
      id: appId,
      candidateProfileId: candidateProfile.id,
      jobPostingId: canonicalJob.id,
      companyName: 'Canonical',
      jobTitle: 'Distributed Systems Engineer',
      jobPostingUrl: canonicalJobUrl,
      matchedRequirementsScore: 0.95,
    });
    await appRepo.saveApplication(activeApp);
    await appRepo.updateApplicationStatus(appId, 'ready_to_fill');
    await appRepo.updateApplicationStatus(appId, 'dry_run_review');
    await appRepo.updateApplicationStatus(appId, 'executing_actions');
    await appRepo.updateApplicationStatus(appId, 'awaiting_user_review');

    // Simulate employer confirmation page navigation
    const confirmationResult = await processSubmissionDetection(
      'https://canonical.com/careers/4581200/confirmation',
      'Thank You For Applying to Canonical'
    );

    expect(confirmationResult.success).toBe(true);
    expect(confirmationResult.applicationId).toBe(appId);
    expect(confirmationResult.newStatus).toBe('submitted');

    // Verify stored application record
    const updated = await appRepo.getApplicationById(appId);
    expect(updated?.currentStatus).toBe('submitted');
    expect(updated?.appliedAt).toBeDefined();

    // Verify idempotency on second visit to confirmation URL
    const secondVisit = await processSubmissionDetection(
      'https://canonical.com/careers/4581200/confirmation'
    );
    expect(secondVisit.success).toBe(true);
    expect(secondVisit.alreadySubmitted).toBe(true);
  });

  it('Stage 4: Answers Canonical custom essay question with GeminiProvider when API key is provided', async () => {
    const apiKey = process.env.GEMINI_TEST_KEY;
    if (!apiKey) return;

    const { GeminiProvider } = await import('../ai/gemini-provider.js');
    const provider = new GeminiProvider(apiKey, 'gemini-flash-lite-latest');

    const prompt = `
Question: When evaluating distributed system design, what is the one question you instinctively ask first?
Context: Lead Distributed Systems Engineer with expertise in Raft consensus, Kafka data streaming, fault-tolerant replication, and high throughput Go services.
Provide a concise, direct answer in JSON format with field "answerText".
`;

    const res = await provider.complete<{ answerText: string }>({
      prompt,
      systemPrompt: 'You are a career assistant answering technical job application questions concisely and factually based on candidate experience. Respond in valid JSON: {"answerText": "..."}',
      contextType: 'field_answering',
      contextPayload: {
        fieldLabel: 'When evaluating distributed system design...',
        fieldType: 'textarea',
        relevantAnswers: [],
        relevantClaims: [],
      },
    });

    expect(res.rawText).toBeDefined();
    expect(res.rawText.length).toBeGreaterThan(20);
    expect(res.finishReason).toBe('stop');
    console.log('LIVE GEMINI RESPONSE (Question 1):', res.rawText);
  }, 30000);

  it('Stage 5: Synthesizes senior engineering answers for platform scale and data governance questions', async () => {
    const apiKey = process.env.GEMINI_TEST_KEY;
    if (!apiKey) return;

    const { GeminiProvider } = await import('../ai/gemini-provider.js');
    const { buildFieldAnsweringPrompt } = await import('@applykit/domain');
    const provider = new GeminiProvider(apiKey, 'gemini-flash-lite-latest');

    // Test platform scale question
    const scaleContext = {
      fieldLabel: 'What are the two most important things to get right in building platforms that scale?',
      fieldType: 'textarea' as const,
      relevantAnswers: [],
      relevantClaims: [],
      candidateExperiences: candidateProfile.experiences,
      candidateSkills: candidateProfile.skills,
      candidateSummary: candidateProfile.professional.summary,
    };

    const scaleReq = buildFieldAnsweringPrompt(scaleContext);
    const scaleRes = await provider.complete<{ answerText: string }>(scaleReq);
    expect(scaleRes.rawText).toBeDefined();
    expect(scaleRes.rawText.length).toBeGreaterThan(30);
    console.log('LIVE GEMINI RESPONSE (Platform Scale):', scaleRes.rawText);

    // Test data governance question
    const govContext = {
      fieldLabel: 'What do you see as the two most important criteria for choosing between centralizing and decentralizing data governance policies?',
      fieldType: 'textarea' as const,
      relevantAnswers: [],
      relevantClaims: [],
      candidateExperiences: candidateProfile.experiences,
      candidateSkills: candidateProfile.skills,
      candidateSummary: candidateProfile.professional.summary,
    };

    const govReq = buildFieldAnsweringPrompt(govContext);
    const govRes = await provider.complete<{ answerText: string }>(govReq);
    expect(govRes.rawText).toBeDefined();
    expect(govRes.rawText.length).toBeGreaterThan(30);
    console.log('LIVE GEMINI RESPONSE (Data Governance):', govRes.rawText);
  }, 45000);
});
