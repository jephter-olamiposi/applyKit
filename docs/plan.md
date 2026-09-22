# ApplyKit: Implementation Plan (Phases 0 - 15)

ApplyKit is a local-first, privacy-respecting browser extension and engine that assists candidates with job applications through deterministic browser automation, evidence-backed matching, and human-in-the-loop verification.

---

## Roadmap Overview

```
[Phase 0: Domain & Security] ──► [Phase 1: Extension Shell] ──► [Phase 2: Job Extraction]
               │                                                          │
               ▼                                                          ▼
[Phase 3: Profile Storage]   ──► [Phase 4: Evidence Engine] ──► [Phase 5: AI Subsystem]
               │                                                          │
               ▼                                                          ▼
[Phase 6: Matching & Gaps]   ──► [Phase 7: Form Recognition]──► [Phase 8: Dry Run Planner]
               │                                                          │
               ▼                                                          ▼
[Phase 9: Action Exec]       ──► [Phase 10: Review UI]      ──► [Phase 11: App Tracking]
               │                                                          │
               ▼                                                          ▼
[Phase 12: Tailoring]        ──► [Phase 13: ATS Adapters]   ──► [Phase 14: Safety & Pacing]
                                                                          │
                                                                          ▼
                                                                [Phase 15: E2E & Release]
```

---

## Phase 0: Foundation, Domain Models, and Security Architecture
- **Objective:** Establish the foundational TypeScript monorepo, strict domain types, deterministic action protocol contracts, threat model, and architectural boundaries before writing extension runtime code.
- **Deliverables:**
  - TypeScript workspace layout (`packages/domain`, `packages/extension`, `packages/shared`).
  - Strict TypeScript domain models: `CandidateProfile`, `Evidence`, `JobPosting`, `ApplicationField`, `BrowserAction`, `DryRunAction`, `ApplicationRecord`, and `AIProvider` contracts.
  - Security architecture documentation covering API key isolation, prompt injection defenses, deterministic action schemas, and zero-hallucination evidence boundaries.
  - Architecture Decision Records (ADRs) establishing local-first storage, service worker isolation, and deterministic execution protocols.
- **Exit Criteria:** All domain types compile cleanly without warnings; unit tests validate schema constraints and state machine transitions.

---

## Phase 1: Minimal Extension Shell & Message Bus
- **Objective:** Build the Manifest V3 extension skeleton with isolated contexts, structured messaging, and zero-privilege defaults.
- **Deliverables:**
  - `manifest.json` configured with MV3 compliance, minimal permissions (`activeTab`, `storage`, `scripting`, `sidePanel`).
  - Extension Service Worker (background script) acting as the single source of truth for secrets and external API calls.
  - Content script injector with isolated world execution.
  - Side panel and popup user interfaces built with typed communication channels.
  - Type-safe, asynchronous RPC message bus (`MessageBridge`) between content script, side panel, and background service worker.
- **Exit Criteria:** Extension loads in Chrome/Chromium; side panel renders; content script communicates bidirectionally with service worker without console errors or security leaks.

---

## Phase 2: Job Posting Extraction Engine
- **Objective:** Accurately extract job metadata, descriptions, and requirements from arbitrary webpages and known ATS layouts.
- **Deliverables:**
  - Extraction pipeline combining semantic DOM heuristics, JSON-LD (`JobPosting` schema), OpenGraph tags, and ATS-specific selectors (Greenhouse, Lever, Ashby, Workday).
  - Fallback LLM-assisted extractor for bespoke company career pages.
  - Requirement normalization engine: parsing raw job descriptions into categorized `Requirement` items (technical skills, experience years, credentials, responsibilities).
  - Importance classification (`required`, `strongly_preferred`, `preferred`, `nice_to_have`).
- **Exit Criteria:** Extraction tests pass across top 20 sample job posting HTML fixtures with >95% field accuracy.

---

## Phase 3: Local-First Storage & Profile Management
- **Objective:** Implement local-first persistence for candidate identity, professional history, skills, and application data with end-to-end user privacy.
- **Deliverables:**
  - IndexedDB storage layer with versioned migrations and schema integrity.
  - Strongly typed repositories: `ProfileRepository`, `JobRepository`, `ApplicationRepository`.
  - Secure credential storage using `chrome.storage.local` (encrypted with optional user passphrase).
  - Profile import/export functionality (JSON and standard Resume Schema formats).
  - Sensitive field protection (PII masking and opt-in redaction).
- **Exit Criteria:** Full profile CRUD operations verified in offline storage with zero external network requests.

---

## Phase 4: Evidence & Claim Verification Engine
- **Objective:** Transform raw candidate history and documents into verifiable claims backed by concrete evidence snippets.
- **Deliverables:**
  - Document parsing pipeline (PDF and text resumes, portfolio links, project documentation).
  - Evidence decomposition: splitting work experiences and projects into atomic `Evidence` units.
  - `CandidateClaim` linking system: connecting every skill proficiency and qualification assertion to explicit evidence references.
  - Confidence scoring model: calculating backing strength for every claimed capability.
  - Zero-hallucination constraint enforcement: rejecting any AI-generated claim that lacks backing evidence.
- **Exit Criteria:** Ingesting a sample resume creates a fully indexed, graph-linked set of claims and evidence references with verifiable source attributions.

---

## Phase 5: AI Provider Subsystem & Payload Scoping
- **Objective:** Construct a flexible, privacy-preserving AI provider abstraction supporting both cloud APIs and local/on-device models.
- **Deliverables:**
  - Pluggable provider implementations: Anthropic Claude, OpenAI, Google Gemini, OpenRouter, and local Ollama / Chrome Built-in AI (Prompt API).
  - Service worker isolation: all LLM network requests originate strictly from the service worker; API keys never touch web pages or DOM scripts.
  - Context Builders / Payload Scoping: constructing strictly scoped prompts (`FieldAnsweringContext`, `JobExtractionContext`) containing only the minimal data needed for the specific sub-task.
  - Strict structured output validation: forcing all LLM completions to conform to JSON schemas.
  - Prompt injection defense: robust XML wrapping, untrusted input demarcation, and safety wrappers.
- **Exit Criteria:** Multi-provider switching tested with token tracking, rate limiting, and zero exposure of candidate credentials or full profile to single-field completions.

---

## Phase 6: Requirement Matching & Gap Analysis
- **Objective:** Compare normalized job requirements against candidate claims to compute match scores and identify qualification gaps.
- **Deliverables:**
  - Semantic matcher comparing required competencies against candidate evidence graph.
  - Match scoring algorithm accounting for required vs. preferred criteria.
  - Gap analysis reporter: highlighting missing technologies, insufficient years of experience, or missing certifications.
  - Suggestion engine recommending which candidate projects or evidence items to highlight for the specific opportunity.
- **Exit Criteria:** Matching engine outputs deterministic match matrices with clear reasoning and evidence citations.

---

## Phase 7: Form Engine - DOM Inspection & Field Recognition
- **Objective:** Inspect job application web forms, identify input semantics, and construct a high-fidelity virtual representation of the form.
- **Deliverables:**
  - DOM crawler supporting standard inputs, textareas, native selects, custom dropdowns (ARIA listboxes, React Select), radio groups, checkboxes, and file upload dropzones.
  - Shadow DOM and iframe traversal (handling embedded ATS frames like Greenhouse and Lever embeds).
  - Field classifier: mapping DOM elements to canonical fields (First Name, Last Name, Email, Phone, Resume, LinkedIn, GitHub, Sponsorship, Salary Expectation).
  - Option matching engine: resolving fuzzy dropdown choices to candidate profile values.
- **Exit Criteria:** Field recognition engine detects >90% of fields on Greenhouse, Lever, Ashby, and Workday sample forms without false-positive submissions.

---

## Phase 8: Form Engine - Deterministic Browser Action Protocol & Dry Run Planner
- **Objective:** Formulate planned interactions as explicit, reversible, dry-runnable action sequences before touching the page.
- **Deliverables:**
  - Action planner generating typed `BrowserAction` commands (`click`, `fill_text`, `select_option`, `check`, `upload_file`).
  - `DryRunAction` pipeline: calculating before/after diffs, candidate value used, confidence score, and risk level (`low`, `medium`, `high`).
  - Safety validation rules: flagging destructive actions, submission buttons, or irreversible steps.
  - Invariant: AI never issues raw DOM commands; it only generates declarative action objects that the runtime validates against strict schemas.
- **Exit Criteria:** Action planner produces a comprehensive, verified execution plan from form fields and candidate profile without executing any DOM mutation.

---

## Phase 9: Form Engine - Execution & Interaction Interpreter
- **Objective:** Safely execute planned actions on the host webpage with human-paced, framework-compatible event dispatching.
- **Deliverables:**
  - Event simulator: dispatching full event lifecycles (`pointerdown`, `mousedown`, `focus`, `input`, `keydown`, `keyup`, `change`, `blur`) to satisfy React, Vue, and Angular synthetic event listeners.
  - File upload handler: staging and attaching resume/cover letter files to native file inputs.
  - Custom select and combobox driver: navigating ARIA-compliant options via simulated keystrokes and pointer events.
  - Non-destructive execution guarantee: automatically pausing before submitting buttons (`type="submit"`, "Submit Application", "Apply").
- **Exit Criteria:** Form inputs on live test fixtures are populated reliably with framework state synchronized; submission triggers are strictly blocked.

---

## Phase 10: Human-in-the-Loop Review UI & Dry Run Preview
- **Objective:** Present the candidate with an intuitive, transparent interface to inspect, adjust, and approve every action prior to execution.
- **Deliverables:**
  - Side panel Dry Run Inspector: interactive diff table showing target field, current value, proposed value, source evidence, and confidence.
  - Inline field highlighting and review indicators on the active web page.
  - One-click answer adjustments and manual overrides.
  - Selective execution: allowing candidates to execute all low-risk fills, individual fields, or skip uncertain fields.
  - Explicit confirmation gate before any action marked high-risk.
- **Exit Criteria:** User can visually review every planned field fill, modify values inline, and trigger execution with zero unexpected modifications.

---

## Phase 11: Application Tracking & Audit History
- **Objective:** Maintain an auditable, persistent log of all applications, submissions, and historical interactions.
- **Deliverables:**
  - Application state machine tracking lifecycle: `detected_job` -> `ready_to_fill` -> `dry_run_review` -> `executing_actions` -> `awaiting_user_review` -> `submitted`.
  - Application history repository storing company, role, posting URL, job description snapshot, date applied, and filled values.
  - Audit trail viewer: exportable JSON/CSV logs of all actions taken by the extension.
  - Status management: tracking interview stages, follow-up reminders, and response rates.
- **Exit Criteria:** Completing an application run creates an immutable historical record linked to the exact job snapshot and profile version used.

---

## Phase 12: Evidence-Grounded Tailoring (Resume & Cover Letter)
- **Objective:** Generate tailored resume summaries and cover letters strictly grounded in candidate evidence without factual exaggeration.
- **Deliverables:**
  - Dynamic resume section selector: ordering experiences and projects based on relevance to job requirements.
  - Evidence-grounded cover letter generator: constructing paragraphs citing specific verified accomplishments.
  - Fact-checking verification pass: cross-referencing every generated sentence against `CandidateClaim` database and flagging unbacked statements.
  - Export utilities: generating clean Markdown and formatted text for submission forms.
- **Exit Criteria:** Generated cover letters contain 100% verifiable citations to candidate evidence with zero invented metrics or roles.

---

## Phase 13: ATS-Specific Adapters & Deep Integration
- **Objective:** Provide specialized drivers for complex, multi-page, or non-standard Applicant Tracking Systems.
- **Deliverables:**
  - Workday Adapter: handling multi-page wizards, account login boundaries, step progression, and custom dropdown grids.
  - Greenhouse Adapter: custom demographic disclosures, EEO questions, and custom file uploaders.
  - Lever Adapter: handling dynamic custom questionnaire blocks and multi-line inputs.
  - Ashby Adapter: modern React comboboxes and dynamic validation states.
  - Generic Fallback Adapter: standard HTML5 forms and accessible web components.
- **Exit Criteria:** All supported ATS platforms achieve >90% automated fill success on standard multi-page applications.

---

## Phase 14: Safety, Compliance, and Anti-Detection Verification
- **Objective:** Ensure automated interactions adhere to human pacing, accessibility standards, and privacy regulations.
- **Deliverables:**
  - Pacing engine: randomized delays (100ms - 450ms) between keystrokes and form interactions to mimic human typing and avoid rate-limiting triggers.
  - Strict bot-detection resilience: avoiding non-standard DOM property poisoning, maintaining natural mouse movement paths.
  - Privacy compliance: 100% local data retention, one-click data purge ("Right to Erasure"), zero telemetry or external tracking.
  - Security audit: Content Security Policy (CSP) enforcement, denial of external script loading, zero dynamic eval.
- **Exit Criteria:** Automated security scan confirms zero remote script execution and full compliance with extension store safety policies.

---

## Phase 15: End-to-End Testing, Packaging & Release Readiness
- **Objective:** Finalize test suites, build pipeline, distribution packaging, and onboarding documentation.
- **Deliverables:**
  - End-to-end automated test suite (Playwright with Chrome Extension testing harness).
  - Production build pipeline with tree-shaking, source mapping, and bundle size optimization.
  - Chrome Web Store assets, manifest validation, privacy policy, and developer documentation.
  - User onboarding wizard: initial profile setup, resume import, and provider configuration.
- **Exit Criteria:** Clean CI pipeline passes 100% of unit, integration, and E2E tests; production zip installs and runs cleanly in clean browser profiles.
