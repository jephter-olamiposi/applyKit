# ApplyKit: Implementation Plan (Phases 0 - 15)

ApplyKit is a local-first, privacy-respecting browser extension and engine that assists candidates with job applications through deterministic browser automation, evidence-backed matching, and human-in-the-loop verification.

---

## Roadmap Overview

```
[Phase 0: Domain & Security] ✅ ──► [Phase 1: Extension Shell] ✅ ──► [Phase 2: Job Extraction] ✅
               │                                                                    │
               ▼                                                                    ▼
[Phase 3: Profile Storage]   ✅ ──► [Phase 4: Evidence Engine] ✅ ──► [Phase 5: AI Subsystem]   ✅
               │                                                                    │
               ▼                                                                    ▼
[Phase 6: Matching & Gaps]   ✅ ──► [Phase 7: Form Recognition]✅ ──► [Phase 8: Dry Run Planner]✅
               │                                                                    │
               ▼                                                                    ▼
[Phase 9: Action Exec]       ✅ ──► [Phase 10: Review UI]      ✅ ──► [Phase 11: App Tracking]  ✅
               │                                                                    │
               ▼                                                                    ▼
[Phase 12: Tailoring]        ✅ ──► [Phase 13: ATS Adapters]   ✅ ──► [Phase 14: Safety & Pacing]✅
                                                                                    │
                                                                                    ▼
                                                                          [Phase 15: E2E & Release] ✅
                                                                                    │
                                                                                    ▼
                                                          [Phase 16: Golden Standard & 1-Click Auto-Fill] ✅
```

---

## Phase 0: Foundation, Domain Models, and Security Architecture — ✅ Complete
- **Objective:** Establish the foundational TypeScript monorepo, strict domain types, deterministic action protocol contracts, threat model, and architectural boundaries before writing extension runtime code.
- **Deliverables:**
  - TypeScript workspace layout (`packages/domain`, `apps/extension`, `packages/shared`).
  - Strict TypeScript domain models: `CandidateProfile`, `Evidence`, `JobPosting`, `ApplicationField`, `BrowserAction`, `DryRunAction`, `ApplicationRecord`, and `AIProvider` contracts.
  - Security architecture documentation covering API key isolation, prompt injection defenses, deterministic action schemas, and zero-hallucination evidence boundaries.
  - Architecture Decision Records (ADRs) establishing local-first storage, service worker isolation, and deterministic execution protocols.
- **Exit Criteria:** All domain types compile cleanly without warnings; unit tests validate schema constraints and state machine transitions.

---

## Phase 1: Minimal Extension Shell & Message Bus — ✅ Complete
- **Objective:** Build the Manifest V3 extension skeleton with isolated contexts, structured messaging, and zero-privilege defaults.
- **Deliverables:**
  - `manifest.json` configured with MV3 compliance, minimal permissions (`activeTab`, `storage`, `scripting`, `sidePanel`).
  - Extension Service Worker (background script) acting as the single source of truth for secrets and external API calls.
  - Content script injector with isolated world execution.
  - Side panel and popup user interfaces built with typed communication channels.
  - Type-safe, asynchronous RPC message bus (`MessageBridge`) between content script, side panel, and background service worker.
- **Exit Criteria:** Extension loads in Chrome/Chromium; side panel renders; content script communicates bidirectionally with service worker without console errors or security leaks.

---

## Phase 2: Job Posting Extraction Engine — ✅ Complete
- **Objective:** Accurately extract job metadata, descriptions, and requirements from arbitrary webpages and known ATS layouts.
- **Deliverables:**
  - Extraction pipeline combining semantic DOM heuristics, JSON-LD (`JobPosting` schema), OpenGraph tags, and ATS-specific selectors (Greenhouse, Lever, Ashby, Workday).
  - Fallback LLM-assisted extractor for bespoke company career pages.
  - Requirement normalization engine: parsing raw job descriptions into categorized `Requirement` items (technical skills, experience years, credentials, responsibilities).
  - Importance classification (`required`, `strongly_preferred`, `preferred`, `nice_to_have`).
- **Exit Criteria:** Extraction tests pass across top 20 sample job posting HTML fixtures with >95% field accuracy.

---

## Phase 3: Local-First Storage & Profile Management — ✅ Complete
- **Objective:** Implement local-first persistence for candidate identity, professional history, skills, and application data with end-to-end user privacy.
- **Deliverables:**
  - IndexedDB storage layer with versioned migrations and schema integrity.
  - Strongly typed repositories: `ProfileRepository`, `JobRepository`, `ApplicationRepository`.
  - Secure credential storage using `chrome.storage.local` (encrypted with optional user passphrase).
  - Profile import/export functionality (JSON and standard Resume Schema formats).
  - Sensitive field protection (PII masking and opt-in redaction).
- **Exit Criteria:** Full profile CRUD operations verified in offline storage with zero external network requests.

---

## Phase 4: Evidence & Claim Verification Engine — ✅ Complete
- **Objective:** Transform raw candidate history and documents into verifiable claims backed by concrete evidence snippets.
- **Deliverables:**
  - Document parsing pipeline (PDF and text resumes, portfolio links, project documentation).
  - Evidence decomposition: splitting work experiences and projects into atomic `Evidence` units.
  - `CandidateClaim` linking system: connecting every skill proficiency and qualification assertion to explicit evidence references.
  - Confidence scoring model: calculating backing strength for every claimed capability.
  - Zero-hallucination constraint enforcement: rejecting any AI-generated claim that lacks backing evidence.
- **Exit Criteria:** Ingesting a sample resume creates a fully indexed, graph-linked set of claims and evidence references with verifiable source attributions.

---

## Phase 5: AI Provider Subsystem & Payload Scoping — ✅ Complete
- **Objective:** Construct a flexible, privacy-preserving AI provider abstraction supporting both cloud APIs and local/on-device models.
- **Deliverables:**
  - Pluggable provider implementations: Anthropic Claude, OpenAI, Google Gemini, OpenRouter, and local Ollama / Chrome Built-in AI (Prompt API).
  - Service worker isolation: all LLM network requests originate strictly from the service worker; API keys never touch web pages or DOM scripts.
  - Context Builders / Payload Scoping: constructing strictly scoped prompts (`FieldAnsweringContext`, `JobExtractionContext`) containing only the minimal data needed for the specific sub-task.
  - Strict structured output validation: forcing all LLM completions to conform to JSON schemas.
  - Prompt injection defense: robust XML wrapping, untrusted input demarcation, and safety wrappers.
- **Exit Criteria:** Multi-provider switching tested with token tracking, rate limiting, and zero exposure of candidate credentials or full profile to single-field completions.

---

## Phase 6: Requirement Matching & Gap Analysis — ✅ Complete
- **Objective:** Compare normalized job requirements against candidate claims to compute match scores and identify qualification gaps.
- **Deliverables:**
  - Semantic matcher comparing required competencies against candidate evidence graph.
  - Match scoring algorithm accounting for required vs. preferred criteria.
  - Gap analysis reporter: highlighting missing technologies, insufficient years of experience, or missing certifications.
  - Suggestion engine recommending which candidate projects or evidence items to highlight for the specific opportunity.
- **Exit Criteria:** Matching engine outputs deterministic match matrices with clear reasoning and evidence citations.

---

## Phase 7: Form Engine - DOM Inspection & Field Recognition — ✅ Complete
- **Objective:** Inspect job application web forms, identify input semantics, and construct a high-fidelity virtual representation of the form.
- **Deliverables:**
  - DOM crawler supporting standard inputs, textareas, native selects, custom dropdowns (ARIA listboxes, React Select), radio groups, checkboxes, and file upload dropzones.
  - Shadow DOM and iframe traversal (handling embedded ATS frames like Greenhouse and Lever embeds).
  - Field classifier: mapping DOM elements to canonical fields (First Name, Last Name, Email, Phone, Resume, LinkedIn, GitHub, Sponsorship, Salary Expectation).
  - Option matching engine: resolving fuzzy dropdown choices to candidate profile values.
- **Exit Criteria:** Field recognition engine detects >90% of fields on Greenhouse, Lever, Ashby, and Workday sample forms without false-positive submissions.

---

## Phase 8: Form Engine - Deterministic Browser Action Protocol & Dry Run Planner — ✅ Complete
- **Objective:** Formulate planned interactions as explicit, reversible, dry-runnable action sequences before touching the page.
- **Deliverables:**
  - Action planner generating typed `BrowserAction` commands (`click`, `fill_text`, `select_option`, `check`, `upload_file`).
  - `DryRunAction` pipeline: calculating before/after diffs, candidate value used, confidence score, and risk level (`low`, `medium`, `high`).
  - Safety validation rules: flagging destructive actions, submission buttons, or irreversible steps.
  - Invariant: AI never issues raw DOM commands; it only generates declarative action objects that the runtime validates against strict schemas.
- **Exit Criteria:** Action planner produces a comprehensive, verified execution plan from form fields and candidate profile without executing any DOM mutation.

---

## Phase 9: Form Engine - Execution & Interaction Interpreter — ✅ Complete
- **Objective:** Safely execute planned actions on the host webpage with human-paced, framework-compatible event dispatching.
- **Deliverables:**
  - Event simulator: dispatching full event lifecycles (`pointerdown`, `mousedown`, `focus`, `input`, `keydown`, `keyup`, `change`, `blur`) to satisfy React, Vue, and Angular synthetic event listeners.
  - File upload handler: staging and attaching resume/cover letter files to native file inputs.
  - Custom select and combobox driver: navigating ARIA-compliant options via simulated keystrokes and pointer events.
  - Non-destructive execution guarantee: automatically pausing before submitting buttons (`type="submit"`, "Submit Application", "Apply").
- **Exit Criteria:** Form inputs on live test fixtures are populated reliably with framework state synchronized; submission triggers are strictly blocked.

---

## Phase 10: Human-in-the-Loop Review UI & Dry Run Preview — ✅ Complete
- **Objective:** Present the candidate with an intuitive, transparent interface to inspect, adjust, and approve every action prior to execution.
- **Deliverables:**
  - Side panel Dry Run Inspector: interactive diff table showing target field, current value, proposed value, source evidence, and confidence.
  - Inline field highlighting and review indicators on the active web page.
  - One-click answer adjustments and manual overrides.
  - Selective execution: allowing candidates to execute all low-risk fills, individual fields, or skip uncertain fields.
  - Explicit confirmation gate before any action marked high-risk.
- **Exit Criteria:** User can visually review every planned field fill, modify values inline, and trigger execution with zero unexpected modifications.

---

## Phase 11: Application Tracking & Audit History — ✅ Complete
- **Objective:** Maintain an auditable, persistent log of all applications, submissions, and historical interactions.
- **Deliverables:**
  - Application state machine tracking lifecycle: `detected_job` -> `ready_to_fill` -> `dry_run_review` -> `executing_actions` -> `awaiting_user_review` -> `submitted`.
  - Application history repository storing company, role, posting URL, job description snapshot, date applied, and filled values.
  - Audit trail viewer: exportable JSON/CSV logs of all actions taken by the extension.
  - Status management: tracking interview stages, follow-up reminders, and response rates.
- **Exit Criteria:** Completing an application run creates an immutable historical record linked to the exact job snapshot and profile version used.

---

## Phase 12: Evidence-Grounded Tailoring (Resume & Cover Letter) — ✅ Complete
- **Objective:** Generate tailored resume summaries and cover letters strictly grounded in candidate evidence without factual exaggeration.
- **Deliverables:**
  - Dynamic resume section selector: ordering experiences and projects based on relevance to job requirements.
  - Evidence-grounded cover letter generator: constructing paragraphs citing specific verified accomplishments.
  - Fact-checking verification pass: cross-referencing every generated sentence against `CandidateClaim` database and flagging unbacked statements.
  - Export utilities: generating clean Markdown and formatted text for submission forms.
- **Exit Criteria:** Generated cover letters contain 100% verifiable citations to candidate evidence with zero invented metrics or roles.

---

## Phase 13: ATS-Specific Adapters & Deep Integration — ✅ Complete
- **Objective:** Provide specialized drivers for complex, multi-page, or non-standard Applicant Tracking Systems.
- **Deliverables:**
  - Workday Adapter: handling multi-page wizards, account login boundaries, step progression, and custom dropdown grids.
  - Greenhouse Adapter: custom demographic disclosures, EEO questions, and custom file uploaders.
  - Lever Adapter: handling dynamic custom questionnaire blocks and multi-line inputs.
  - Ashby Adapter: modern React comboboxes and dynamic validation states.
  - Generic Fallback Adapter: standard HTML5 forms and accessible web components.
- **Exit Criteria:** All supported ATS platforms achieve >90% automated fill success on standard multi-page applications.

---

## Phase 14: Safety, Compliance, and Anti-Detection Verification — ✅ Complete
- **Objective:** Ensure automated interactions adhere to human pacing, accessibility standards, and privacy regulations.
- **Deliverables:**
  - Pacing engine: randomized delays (100ms - 450ms) between keystrokes and form interactions to mimic human typing and avoid rate-limiting triggers.
  - Strict bot-detection resilience: avoiding non-standard DOM property poisoning, maintaining natural mouse movement paths.
  - Privacy compliance: 100% local data retention, one-click data purge ("Right to Erasure"), zero telemetry or external tracking.
  - Security audit: Content Security Policy (CSP) enforcement, denial of external script loading, zero dynamic eval.
- **Exit Criteria:** Automated security scan confirms zero remote script execution and full compliance with extension store safety policies.

---

## Phase 15: End-to-End Testing, Packaging & Release Readiness — ✅ Complete
- **Objective:** Finalize test suites, build pipeline, distribution packaging, and onboarding documentation.
- **Deliverables:**
  - End-to-end automated test suite: 38 test suites, 317 tests passing with 100% green coverage across domain and extension modules.
  - Automated extension packaging pipeline: `scripts/package-extension.mjs` verifying MV3 manifest compliance, CSP, and assets.
  - Tree-shaking and bundle optimization: PDF renderer isolated to background worker, reducing content script size by 96% (2.9MB down to 127KB).
  - Chrome Web Store assets, manifest validation, privacy policy, and developer documentation.
  - User onboarding wizard: initial profile setup, resume import, and provider configuration.
- **Exit Criteria:** Clean CI pipeline passes 100% of unit and integration tests; production zip packages cleanly and executes in browser without runtime errors.

---

## Phase 16: 14-Point Golden Standard Tailoring, 1-Click Auto-Fill & Ad-Hoc Solver (ADR-0026) — ✅ Complete
- **Objective:** Elevate resume tailoring to executive recruiter standards and eliminate repetitive per-field clicking with a safe, 1-click form filling workflow.
- **Deliverables:**
  - **14-Point Resume Golden Standard Engine (`resume-rules.ts`)**:
    - Audits 14 non-negotiable criteria: template selection, 792pt 1-page budget, target keywords, target company name, first item alignment, value titles, verified online links, no pronoun "I", no buzzwords, strong past-tense action verbs, impact metrics, impressive years (>=3), standard impressive sections, and typo/technology orthography normalization.
    - Deterministic 1-click auto-fixer (`autoFixResumeQualityIssues`) polishing resumes while preserving 100% factual fidelity (zero hallucination).
  - **Multi-Template PDF Generator (`pdf-exporter.ts`)**:
    - Four professional visual themes: Modern Clean (indigo accents), Classic Executive (serif hierarchy), Minimalist ATS (monochrome), and Compact 1-Pager (condensed budget).
    - Verified contact headers displaying candidate name, email, and live links (LinkedIn, GitHub, Portfolio).
  - **1-Click Auto-Fill Engine (`EXECUTE_ONE_CLICK_AUTO_FILL`)**:
    - Single-click background orchestration: form crawling -> profile mapping -> AI custom question answering -> batch approval -> human-paced execution.
    - **Anti-Autonomous Submit Hard Gate**: Strictly blocks submission buttons (`type="submit"`, "Submit Application", "Apply Now"), halting at `awaiting_user_review` for human verification.
  - **Instant Ad-Hoc Question Solver (`InstantQuestionSolver.tsx`)**:
    - In-panel question solver allowing candidates to paste uncaptured questions from complex pages, answer them against verified evidence, and insert them into the active element with 1 click.
  - **Iframe & Custom Input Crawler**:
    - Content script configured with `"all_frames": true` to inspect embedded Greenhouse/Ashby iframes, plus support for `[role="textbox"]`, `[contenteditable="true"]`, and `[role="combobox"]`.
- **Exit Criteria:** 14-point audit scores 100/100 on polished resumes; 1-click auto-fill completes all fields safely without submitting; all 317 tests pass.

---

## Phase 17: In-Page Floating Assistant Hub & Active Field Pills — ✅ Complete
- **Objective:** Provide zero-friction, in-page interaction by injecting an isolated Shadow DOM action hub and active field pills directly on job application pages.
- **Deliverables:**
  - Closed Shadow DOM container (`<applykit-in-page-hub>`) ensuring complete CSS isolation and preventing style contamination from or to the host webpage.
  - Active field focus pill (`[⚡ Auto-Fill]` and `[💡 Answer]`): appears above focused inputs, textareas, and comboboxes.
  - 1-Click floating action pill at bottom-right of detected forms (`[⚡ ApplyKit: 14 Fields Detected — Review & Fill]`).
  - Strict security adherence: API keys isolated to background worker; submission hard gate maintained.
- **Exit Criteria:** In-page floating pill appears on Greenhouse, Lever, and Workday forms without breaking host DOM; clicking pill fills target input safely.

---

## Phase 18: Smart PDF Resume Importer & Profile Bootstrapper — ✅ Complete
- **Objective:** Provide a 1-click onboarding experience where new users upload an existing PDF/DOCX resume to automatically construct their `CandidateProfile` and `EvidenceGraph`.
- **Deliverables:**
  - Client-side PDF text extractor and section segmenter.
  - Structured extraction mapping raw resume text to `CandidateIdentity`, `WorkExperience[]`, `CandidateProject[]`, `EducationRecord[]`, and `CandidateSkill[]`.
  - Automated `EvidenceGraph` decomposer creating verifiable claims with source citations.
  - Visual verification modal allowing candidates to inspect and refine parsed history before saving to local IndexedDB.
- **Exit Criteria:** Ingesting arbitrary PDF resume populates complete profile aggregate and generates >15 verifiable evidence nodes in < 3 seconds.

---

## Phase 19: Live Interactive PDF Preview Canvas & Styling Controls — ✅ Complete
- **Objective:** Provide an embedded, real-time vector PDF preview canvas in the Side Panel with zoom, template switching, and page-budget diagnostics.
- **Deliverables:**
  - Interactive PDF viewer canvas embedded inside `TailoringStudio.tsx` rendering live generated Blob URL.
  - Zoom and page flip controls (Fit, 75%, 100%, 125%, Next/Prev page).
  - Real-time template switcher (Modern Clean, Classic Executive, Minimalist ATS, Compact 1-Pager).
  - Dynamic single-page budget diagnostic flagging content spillover before export.
- **Exit Criteria:** Side Panel displays sharp vector PDF preview within 400ms of resume modifications with seamless template switching.

---

## Phase 20: Automated Submission Detector, Kanban Pipeline & Recruiter Notes — ✅ Complete
- **Objective:** Transform ApplyKit into an automatic application CRM by detecting submissions and organizing opportunities in a visual Kanban board.
- **Deliverables:**
  - Background WebNavigation listener detecting ATS confirmation and thank-you redirect routes.
  - Automated state advance: transitioning job status from `In Progress` to `Applied` with timestamp and immutable tailored resume snapshot.
  - Interactive 5-column Kanban pipeline board in Side Panel (`Saved` ➔ `Applied` ➔ `Interviewing` ➔ `Offer` ➔ `Archived`).
  - Recruiter contact notes, interview date reminders, and CSV/JSON export.
- **Exit Criteria:** Completing a real application automatically creates an applied record with the exact resume used and appears on the Kanban board.

---

## Phase 21: Targeted Company Mission & Cultural Alignment Engine — ✅ Complete
- **Objective:** Extract organizational culture, mission statements, and engineering principles from job descriptions and synthesize authentic, evidence-backed motivation pitches and cover letter alignment paragraphs.
- **Deliverables:**
  - Deterministic culture and values parser identifying core cultural values, engineering principles, and product ecosystem references.
  - Evidence alignment evaluator linking candidate verified accomplishments to employer values.
  - Grounded cover letter integration weaving an organizational alignment paragraph.
  - In-Page Assistant Hub dropzone pill for 1-click tailored resume PDF attachment.
- **Exit Criteria:** Analyzes employer posting, scores cultural alignment, generates authentic "Why Us?" narrative without hallucination, and attaches tailored PDF smoothly.

---

## Phase 22: Download Manager & Native Chrome Downloads API Integration — ✅ Complete
- **Objective:** Resolve browser-level PDF download failures in Chrome MV3 Extension Side Panels by declaring the `"downloads"` permission and integrating `chrome.downloads.download()` with persistent Base64 Data URLs and 60-second fallback Object URL lifespans.
- **Deliverables:**
  - Added `"downloads"` permission in `manifest.json` for reliable background file saving.
  - Built `download-manager.ts` (`downloadPdfBlob`, `blobToDataUrl`) handling blob URL lifetime, filename sanitization, and fallback DOM click anchoring with 60-second cleanup.
  - Integrated native download manager into `TailoringStudio.tsx`, eliminating synchronous blob URL revocation.
  - Unit test suite: 5/5 tests passing in `download-manager.test.ts`.
- **Exit Criteria:** Side Panel generates and saves vector PDF directly to user's local Downloads folder with descriptive filename (`resume-[name]-[company].pdf`) without premature blob revocation.

---

## Phase 23: Canonical Distributed Systems Engineer Real-World Simulation & Quality Verification — ✅ Complete
- **Objective:** Rigorously validate the end-to-end ApplyKit pipeline against Canonical's live careers portal (`https://canonical.com/careers/4581200` - Distributed Systems Engineer).
- **Deliverables:**
  - **Stage 1 (Culture Extraction, Matching & Vector PDF)**: Extracted Canonical culture (Ubuntu, Open Source & Transparency, Distributed Systems & Reliability), verified requirement matching (Go, Raft, Kafka, Linux), tailored 14-point Golden Resume with vector PDF compilation (`%PDF-`), and synthesized grounded cover letter.
  - **Stage 2 (Greenhouse Form Crawling & Submission Hard Gate)**: Mapped all standard applicant fields, staged dry-run plan with 6 actions, strictly excluded submission button, and verified system halt at `awaiting_user_review`.
  - **Stage 3 (Automated ATS Confirmation & Kanban Pipeline)**: Verified redirect detection on `/confirmation`, advanced Kanban status to `submitted`, stamped applied timestamp, and demonstrated idempotent handling.
  - Full workspace quality audit: 47 test files passing (383/383 tests 100% green), zero TypeScript errors (`tsc -b`), and packaged release archive (`applykit-extension-v0.1.0.zip`, 660.76 KB).
- **Exit Criteria:** All 3 stages pass deterministically with full adherence to ADR-0004 (Zero Hallucination) and ADR-0006 (Submission Hard Gate).

---

## Phase 24: Recruiter Email & Interview Invitation Auto-Detector (ADR-0035) — ✅ Complete
- **Objective:** Enable automatic detection of recruiter interview invitations and scheduling links without requiring privacy-invasive background webmail permissions.
- **Deliverables:**
  - Built deterministic detector in `email-detector.ts` classifying interview types (`phone_screen`, `technical`, `manager`, `onsite`, `take_home`).
  - Extracted scheduling links from Calendly, GoodTime, Greenhouse, Lever, Cronofy, Zoom, and Google Meet.
  - Correlated incoming messages with active IndexedDB applications and updated statuses to `interviewing`.
  - Integrated in-panel quick scanner (`[📧 Scan Invite]`) in `ApplicationTracker.tsx`.
- **Exit Criteria:** Tested and verified with 3/3 tests green.

---

## Phase 25: Evidence-Grounded Interview Prep & STAR Story Generator (ADR-0036) — ✅ Complete
- **Objective:** Generate role-specific technical deep-dive questions and verified STAR behavioral narratives directly from candidate evidence without hallucination.
- **Deliverables:**
  - Built interview prep engine in `interview-prep.ts` linking job requirements to verified evidence nodes.
  - Synthesized structured STAR stories (Situation, Task, Action, Result) citing verified evidence IDs.
  - Formulated reverse interview questions to ask hiring managers tailored to company culture.
  - Built interactive `InterviewPrepModal.tsx` launched from Kanban cards (`[🎯 Prep]`) and the detail drawer with 1-click clipboard copy.
- **Exit Criteria:** Tested and verified with 6/6 tests green across domain and component test suites.

---

## Phase 26: Deterministic Salary & Compensation Benchmark Extractor (ADR-0037) — ✅ Complete
- **Objective:** Automatically extract structured compensation data from job postings to populate Kanban cards and recruiter notes.
- **Deliverables:**
  - Built regex compensation parser in `salary-extractor.ts` supporting USD ($), GBP (£), EUR (€), CAD, and AUD ranges, hourly rates, and equity mentions.
  - Formatted human-readable compensation badges on Kanban cards.
- **Exit Criteria:** Tested and verified with 5/5 tests green.

---

## Phase 27: Client-Side Image Resume Ingestion Engine (ADR-0037) — ✅ Complete
- **Objective:** Support client-side onboarding for candidates with image-based resumes (.png, .jpg, .jpeg, .webp, .bmp) or scanned documents.
- **Deliverables:**
  - Built image inspector and bitmap text extractor in `image-resume-parser.ts` detecting magic bytes and extracting printable text/contact information.
  - Integrated image support into `bootstrapProfileFromResume`, `OnboardingWizard.tsx`, and `ProfileSummary.tsx`.
- **Exit Criteria:** Tested and verified with 4/4 tests green.



