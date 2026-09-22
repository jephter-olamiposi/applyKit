# ApplyKit Architecture Decision Records (ADRs)

This document records the architectural decisions made for the ApplyKit platform, outlining context, alternatives considered, decisions made, and consequences.

---

## ADR-0001: Local-First Architecture with Zero Centralized Backend

### Context
Job applicants handle sensitive personal identifiable information (PII), resumes, work history, and job search records. Cloud-hosted backend services require hosting infrastructure, create single points of data breach failure, incur operational costs, and raise substantial privacy and GDPR/CCPA compliance concerns.

### Decision
ApplyKit will be built strictly as a **local-first extension**. All profile data, resumes, parsed jobs, and application logs will be persisted on the user's device using `IndexedDB` and `chrome.storage.local`. There is no mandatory ApplyKit central server.

### Consequences
- **Positive:** Maximum user privacy, zero server hosting costs, complete user data ownership, compliance with privacy regulations by design.
- **Negative:** Multi-device synchronization requires manual profile export/import (or future user-controlled encrypted cloud sync like iCloud/Google Drive).

---

## ADR-0002: Manifest V3 with Service Worker as Sole Network & API Gateway

### Context
Chrome extensions under Manifest V3 use background service workers, content scripts in isolated worlds, and UI pages (side panel/popup). Malicious host pages could attempt to compromise content scripts or steal API keys.

### Decision
All third-party AI provider API keys (OpenAI, Anthropic, Gemini, OpenRouter) and outbound network requests to LLM endpoints are strictly confined to the **Extension Service Worker**. Content scripts never receive API keys or make external network requests. All communication is routed through typed message passing (`chrome.runtime.sendMessage`).

### Consequences
- **Positive:** Complete isolation of sensitive API credentials from webpage scripts and DOM. Even if a host page attempts XSS or inspects DOM memory, it cannot retrieve provider keys.
- **Negative:** All AI-assisted tasks require asynchronous RPC hops between content scripts, UI, and the service worker.

---

## ADR-0003: Deterministic Browser Action Protocol Instead of Direct AI Code Execution

### Context
Autonomous agent frameworks often allow an LLM to generate arbitrary JavaScript or tool calls that execute directly against the active page (`page.evaluate()`, `eval()`). In browser extensions, this introduces catastrophic security risks, including remote code execution, prompt injection exploitation, and unintended form submissions.

### Decision
ApplyKit establishes a **Deterministic Browser Action Protocol**. The AI is never given execution capabilities. It only acts as a planner that outputs structured, typed intent data. The extension runtime translates this intent into a finite list of declarative `BrowserAction` commands (`click`, `fill_text`, `select_option`, etc.). A strictly validated, hardcoded interpreter in the content script executes these commands with human-like event simulation.

### Consequences
- **Positive:** Total immunity to remote code execution; actions are fully inspectable, auditable, and dry-runnable prior to DOM mutation.
- **Negative:** Custom non-standard web widgets require explicit adapter logic rather than relying on LLM ad-hoc script synthesis.

---

## ADR-0004: Candidate Profile as Absolute Source of Truth (Evidence-Backed Claims)

### Context
Generative AI models are prone to hallucinating facts, embellishing achievements, or fabricating skills when trying to maximize match scores for job applications. Applying with fabricated information damages candidate reputation and invalidates job offers.

### Decision
The `CandidateProfile` and its associated `Evidence` graph serve as the **absolute, immutable source of truth**. Every claim made, field populated, or summary generated must be backed by a verified `Evidence` record (resume bullet, project link, credential). If evidence does not exist, the system flags the requirement as a missing gap rather than generating fictitious experience.

### Consequences
- **Positive:** Absolute factual accuracy, zero risk of candidate misrepresentation, high trust.
- **Negative:** The candidate must invest initial effort to populate their profile and evidence thoroughly.

---

## ADR-0005: AI Context Payload Scoping

### Context
Sending the candidate's entire profile (including address, phone number, all past jobs, and personal demographics) to an external LLM on every form field or job extraction wastes token bandwidth and leaks sensitive data.

### Decision
Implement **Context Scoping**. The Service Worker constructs task-specific payloads:
- `JobExtractionContext`: Contains only job posting text; zero candidate data.
- `RequirementMatchingContext`: Contains only required skills and relevant experience bullets.
- `FieldAnsweringContext`: Contains only the specific question label and relevant candidate claims or saved answers.
- Demographic fields are processed locally without invoking external AI.

### Consequences
- **Positive:** Drastic reduction in token consumption, low latency, minimal data exposure to LLM providers.
- **Negative:** Requires specialized prompt context builders for each category of interaction.

---

## ADR-0006: Hard Stop at Submission Boundary (Mandatory Human Review)

### Context
Automated form submitters can submit erroneous applications, trigger rate limits, or violate platform terms of service. Candidates lose control over what is being sent to potential employers.

### Decision
ApplyKit strictly enforces a **Submission Hard Gate**. The form execution engine automatically stops once all inputs have been filled. It is programmatically forbidden from clicking elements with `type="submit"` or buttons with submission semantics. The final submission must always be performed manually by the candidate after visual inspection.

### Consequences
- **Positive:** Complete human-in-the-loop control, zero accidental submissions, full compliance with anti-bot policies.
- **Negative:** Applications cannot be submitted in a 100% background, unattended "hands-off" batch loop (which is an intentional safety design).

---

## ADR-0007: Strongly Typed Monorepo with Isolated Domain Package (`@applykit/domain`)

### Context
The domain model, evidence system, requirement structures, and browser action protocols are core to both the extension runtime, the side panel UI, background workers, and future CLI or desktop tools. Tight coupling to browser extension APIs in the domain types creates testing difficulty.

### Decision
Establish a monorepo structure with `@applykit/domain` as a standalone, zero-dependency TypeScript package. It contains purely functional entities, state machine transitions, validation logic, and protocol types, completely decoupled from Chrome APIs or DOM dependencies.

### Consequences
- **Positive:** 100% testable in pure Node/Vitest without mocking Chrome APIs; reusable across extension, web, and CLI packages; strict boundary enforcement.
- **Negative:** Requires monorepo configuration with npm workspaces and package references.

---

## ADR-0008: Chrome Extension Context Isolation & Declarative Message Bridge Architecture

### Context
Chrome Manifest V3 separates extension code into an Extension Service Worker (background), content scripts in webpage isolated worlds, and UI surfaces (Side Panel). Content scripts can access third-party webpage DOMs and could be compromised by malicious host page scripts. The Side Panel requires asynchronous access to background data, but must not directly access host DOM or hold raw provider API keys.

### Decision
Establish `apps/extension` with a typed RPC message bridge (`src/messages/`):
1. **Background Service Worker (`src/background/`)** is the sole trusted authority holding provider credentials (`chrome.storage.local`) and managing network boundaries. It returns boolean presence flags (`ApiKeysStatus`), never raw API keys.
2. **Content Script (`src/content/`)** performs purely read-only DOM extraction, strip dangerous tags (scripts, styles, noscript, iframes, svgs), and wraps all extracted text within `<untrusted_job_content>` XML tags to defend against prompt injection.
3. **Side Panel (`src/sidepanel/`)** renders a React interface communicating strictly via typed RPC messages (`sendToBackground`), displaying extraction results, candidate profile status, and trigger controls.
4. **Vite Bundler Configuration** produces standalone, zero-external-import entry points for `background.js` and `content.js` alongside the bundled React `sidepanel.html`.

### Consequences
- **Positive:** Strict credential isolation, zero exposure of API keys to content scripts or host pages, robust defense against indirect prompt injection, and clean decoupling of UI and background orchestration.
- **Negative:** Multi-context asynchronous messaging requires typed message serialization and routing overhead.

### Alternatives
- **Direct script evaluation (`chrome.tabs.executeScript` / `chrome.scripting.executeScript` with raw code strings):** Rejected due to security vulnerabilities, inability to audit static code, and violation of CSP / MV3 standards.
- **Storing API keys in `chrome.storage.sync` or accessible from content scripts:** Rejected due to severe credential leakage risks to malicious web pages.

---

## ADR-0009: Priority-Based Deterministic ATS Site Adapters and Heading-Aware Requirement Normalization

### Status
Accepted

### Context
Job postings across platforms (Greenhouse, Lever, Workday, company career portals) follow diverse DOM layouts and structured data conventions. Calling external LLM models to parse every job posting introduces latency (1–3s), financial API costs, token consumption, and non-deterministic extraction errors or hallucinations. Furthermore, distinguishing between hard non-negotiable requirements and preferred qualifications is crucial for honest candidate gap analysis.

### Decision
Implement a priority-ranked, deterministic extraction engine with zero external AI calls by default:
1. **Schema.org JSON-LD Adapter (Priority 100)**: Direct extraction from standardized structured data embedding salary ranges, company organizations, and employment types.
2. **Vendor ATS Adapters (Priority 90)**: Dedicated DOM scrapers for Greenhouse (`boards.greenhouse.io`), Lever (`jobs.lever.co`), and Workday (`*.myworkdayjobs.com`).
3. **Generic Semantic Adapter (Priority 10)**: Universal fallback utilizing OpenGraph metadata and common semantic HTML containers.
4. **Heading-Aware Requirement Normalizer**: Traverses semantic heading cues ("Requirements", "Qualifications", "Responsibilities", "Preferred", "Nice to Have") to accurately partition responsibilities from requirements and classify required vs. preferred qualifications without hallucinating or requiring LLM inference.
5. **Deterministic Categorization & Year Extraction**: Rule-based categorization (experience level, technical skill, soft skill, education credential, certification, domain knowledge, legal authorization) with integer year bounds parsing.

### Consequences
- **Positive:** Sub-10ms extraction time, zero LLM token costs for job parsing, reliable classification of required vs. preferred qualifications, and zero hallucination risk.
- **Negative:** New or heavily customized proprietary career portals may fall back to the generic semantic parser if no ATS signature or JSON-LD is present.

### Alternatives
- **LLM-only job parser:** Rejected due to API costs, latency, network dependency, and potential to hallucinate or omit requirements.
- **Pure regex body-text scraping:** Rejected due to loss of semantic structure (bullet hierarchies, salary objects, section headers).

---

## ADR-0010: Local-First IndexedDB Persistence Architecture, Data Sovereignty, and PII Sanitization

### Status
Accepted

### Context
Candidate job search records, resumes, work history, compensation expectations, and application traces are highly sensitive personal identifiable information (PII). Centralized cloud storage presents severe data breach vectors, compliance burdens (GDPR/CCPA), and ongoing infrastructure costs. Candidates must maintain total ownership over their professional records and credentials.

### Decision
Implement a purely local-first persistence architecture:
1. **Local IndexedDB Engine (`applykit_db`)**: Version-migrated, native IndexedDB engine maintaining five object stores: `profiles`, `jobs`, `applications`, `evidence`, and `claims`. Zero central telemetry or external database synchronizations.
2. **Encapsulated Repositories**: Concrete `IProfileRepository`, `IJobRepository`, `IApplicationRepository`, and `IEvidenceRepository` implementations abstracting raw IDB transactions behind strongly-typed domain aggregate operations.
3. **Data Sovereignty (Portable Backups & Right to be Forgotten)**:
   - Complete single-file JSON backup export (`exportCandidateBackup`).
   - Schema-validated backup restore (`importCandidateBackup`).
   - Atomic one-click local wipe (`purgeAllLocalData`) deleting `applykit_db` and clearing `chrome.storage.local`.
4. **PII Masking & Privacy Sanitization**: Deterministic masking functions (`maskEmail`, `maskPhone`, `maskPii`) redacting sensitive credentials and contact data in diagnostic logs.
5. **Secure Credential Storage**: Provider API keys reside strictly within `chrome.storage.local` in the Background Service Worker, never exposed to content scripts, with optional Web Crypto (AES-GCM/PBKDF2) encryption.

### Consequences
- **Positive:** Maximum candidate privacy, zero cloud hosting overhead, compliance by design with data protection laws, full offline capabilities, and complete user data sovereignty.
- **Negative:** Multi-device synchronization requires manual JSON backup transfer. Clearing browser cache without an exported backup permanently deletes local data.

### Alternatives
- **Cloud database (Firebase/Supabase):** Rejected to prevent PII exposure, eliminate server infrastructure costs, and guarantee offline sovereignty.
- **Pure `chrome.storage.local` for everything:** Rejected because `chrome.storage.local` lacks indices, handles large relational graphs (evidence, history, applications) inefficiently, and has a 10MB quota limit unless `unlimitedStorage` is requested.

---

## ADR-0011: Evidence Decomposition Pipeline, Claim Derivation, and Zero-Hallucination Grounding Auditor

### Status
Accepted

### Context
Generative AI tools frequently invent credentials, embellish achievements, or assume qualifications when tailoring job applications. Submitting fabricated credentials destroys candidate trust and causes immediate disqualification upon employer background verification. Furthermore, sending candidates' full raw resumes to external AI models incurs token costs and introduces privacy leakage risks.

### Decision
Implement a deterministic, local-first evidence decomposition and claim verification engine:
1. **Deterministic Document Parsing (`parsePlainTextResume`)**: Pure client-side parsing of plain text and Markdown resumes into canonical sections (identity, work experience, projects, education, and skills) with zero external LLM API calls.
2. **Atomic Evidence Decomposition (`decomposeProfileIntoEvidence`)**: Breaks down work experiences, projects, and credentials into atomic `Evidence` units. Each unit carries explicit provenance metadata (`EvidenceSource`: company, title, dates, bullet index) and a nominal `EvidenceId`.
3. **Evidence-Grounded Claim Derivation (`deriveClaimsFromEvidence`)**: Generates structured qualification assertions (`skill_proficiency`, `achievement`, `credential`, `leadership`, `years_experience`) strictly backed by explicit evidence IDs. No claim may exist in isolation.
4. **Deterministic Confidence Scoring (`calculateClaimConfidence`)**: Calculates backing strength mathematically based on evidence provenance: single-source base 0.75, multi-source corroboration boost (+0.15), quantified metric verification (+0.05), and penalty for unverified items (-0.15). Claims with 0 evidence are assigned 0.0 confidence.
5. **Zero-Hallucination Grounding Auditor (`auditEvidenceGraphGrounding`)**: Audits the complete graph relationship between claims and evidence nodes, computing a grounding score and flagging unbacked claims or dangling references. A graph is certified `isPristine` only when 100% of claims cite verified evidence and no broken links exist.
6. **Batch Local Persistence (`IndexedDbEvidenceRepository`)**: Batch transaction writes for atomic evidence and claims into IndexedDB (`evidence` and `claims` stores) with instant graph reconstruction (`getEvidenceGraph`).
7. **Side Panel Evidence Inspector (`EvidenceViewer`)**: Interactive UI for one-click resume ingestion, real-time grounding audit status, and expandable evidence snippet citations for each candidate claim.

### Consequences
- **Positive:** Total immunity to AI hallucinations, verified provenance for every claimed capability, full candidate privacy with offline decomposition, and auditable citations.
- **Negative:** Candidates must provide factual resume or project documentation; unsubstantiated assertions cannot be used to satisfy job requirements.

### Alternatives
- **LLM-generated claims without evidence links:** Rejected due to severe hallucination and candidate career risk.
- **Coarse profile-level matching without atomic bullet evidence:** Rejected because dry-run review requires displaying the exact source sentence/bullet proving each requirement match.

---

## ADR-0012: Multi-Provider AI Abstraction, Payload Scoping, Rate Limiting, and Structured JSON Defense

### Status
Accepted

### Context
Browser extensions communicating with external generative AI APIs (OpenAI, Anthropic, Gemini, OpenRouter) face multiple severe security and operational challenges:
1. Third-party job postings and ATS form fields are untrusted and can contain indirect prompt injection vectors.
2. Exposing the candidate's complete profile, contact details, or credentials to external models on every prompt wastes tokens and violates local-first privacy.
3. Content scripts executing in web page contexts can have their memory or network requests inspected by host page scripts.
4. Runaway extension loops can exhaust user API credits rapidly.
5. Models frequently wrap JSON outputs in Markdown code blocks (` ```json ... ``` `) or produce trailing commas, breaking native `JSON.parse`.

### Decision
Implement a hardened, isolated AI provider subsystem and payload scoping pipeline:
1. **Background Service Worker Isolation (`AIGateway`)**: All outbound LLM HTTP requests originate exclusively from the Background Service Worker. API keys reside in `chrome.storage.local` and never touch content scripts or web pages.
2. **Pluggable Base HTTP Providers (`BaseHttpProvider`)**: Standardized implementation with resilient request handling (`fetchWithRetry`), exponential backoff on HTTP 429/5xx, explicit 30-second abort timeouts, and provider implementations for OpenAI (`gpt-4o-mini`), Anthropic (`claude-3-5-haiku-20241022`), Google Gemini (`gemini-1.5-flash`), and OpenRouter (`meta-llama/llama-3.3-70b-instruct`).
3. **Scoped Context Builders & Prompt Hardening (`packages/domain/src/ai/builders.ts`)**: Task-specific prompt builders (`buildJobExtractionPrompt`, `buildRequirementMatchingPrompt`, `buildFieldAnsweringPrompt`, `buildResumeTailoringPrompt`) that strip PII and pass only minimal scoped fields. All third-party inputs are enclosed in strict XML delimiters (`<untrusted_job_content>`, `<untrusted_field_label>`) with system instructions forbidding delimiter escaping.
4. **Structured JSON Cleaning & Schema Validation (`parseAndValidateJsonResponse`)**: Deterministic cleanup (`cleanJsonText`) stripping Markdown code fences, repairing trailing commas, and extracting root JSON objects before runtime validation against domain schema guards.
5. **Sliding-Window Rate Limiter & Token Accounting**: 20 requests/minute sliding-window cap per provider preventing runaway API loops, coupled with persistent cumulative token tracking across prompt and completion tokens stored in `chrome.storage.local`.
6. **Token Metrics Management UI**: Side panel settings dashboard displaying real-time token metrics with a one-click reset action.

### Consequences
- **Positive:** Zero API key leakage risk, robust prompt injection defense, minimal token consumption, resilient JSON parsing, and full candidate visibility over API consumption.
- **Negative:** Adding a new AI provider requires defining its request and error mapping in `apps/extension/src/ai/`.

### Alternatives
- **Content script direct AI calls:** Rejected because web page scripts could intercept API keys or network requests.
- **Unscoped global profile prompt injection:** Rejected because sending full candidate resumes on every field answer incurs unnecessary token costs and leaks PII to third-party models.

---

## ADR-0013: Deterministic Multi-Tier Requirement Matching, Gap Categorization, and Candidate Highlight Engine

### Status
Accepted

### Context
Evaluating candidate alignment against employer job criteria using probabilistic LLM prompts alone leads to non-deterministic fit scores, potential hallucinations of missing qualifications, and external API latency. Candidates preparing real job applications require instant, objective feedback that proves why they match a role, precisely where qualification shortfalls exist, and which verified accomplishments to highlight for maximum impact.

### Decision
Implement an offline, evidence-grounded requirement matching and gap analysis subsystem:
1. **Deterministic Multi-Tier Matching (`evaluateJobRequirements`)**:
   - Tier 1: Exact skill name match with verified evidence (`1.0` confidence).
   - Tier 2: Synonym cluster resolution (`synonyms.ts`) mapping technical equivalents (e.g. `React` vs `React.js`, `K8s` vs `Kubernetes`, `Golang` vs `Go`, `C#` vs `.NET`) backed by verified evidence (`0.85` confidence).
   - Tier 3: EvidenceGraph claim assertions (`CandidateClaim`) with provenance validation (`0.75` confidence).
   - Tier 4: Profile skill assertions lacking document evidence (`0.65` degraded confidence).
   - Weighted scoring formula: 75% non-negotiable criteria (`required`, `strongly_preferred`) and 25% preferred criteria (`preferred`, `nice_to_have`).
2. **Seniority & Experience Shortfall Detection**:
   - Explicit evaluation comparing job requirement `yearsRequired` against candidate verified years.
   - Computes shortfall gaps and proportionally deducts confidence scores for under-tenured competencies.
3. **Structured Gap Analysis Reporter (`analyzeQualificationGaps`)**:
   - Classifies discrepancies into four distinct taxonomies:
     - `hard_gap`: Missing required or strongly preferred qualification (`critical` / `moderate` severity).
     - `soft_gap`: Missing preferred qualification (`minor` severity).
     - `experience_shortfall`: Verified competency with fewer years than requested.
     - `unsubstantiated_claim`: Skill claimed in profile but lacking backing evidence in `EvidenceGraph`.
   - Generates actionable mitigation recommendations for each detected gap.
4. **Tailoring Highlight Engine (`generateHighlightSuggestions`)**:
   - Evaluates candidate `projects` and `experiences` against requirements, calculating normalized relevance scores.
   - Extracts specific verifiable accomplishment bullets addressing the employer's core criteria.
5. **Extension RPC & Side Panel UI (`MatchAnalysis`)**:
   - Background RPC route (`MATCH_JOB_REQUIREMENTS`) coordinating local repositories.
   - Dedicated side panel view featuring composite fit rating, category filtering, expandable evidence snippet citations, and highlight cards.

### Consequences
- **Positive:** 100% deterministic, instant offline evaluation with zero token cost, complete immunity to hallucinated qualifications, and auditable evidence provenance.
- **Negative:** Non-standard competencies omitted from the candidate profile will be flagged as gaps unless imported or manually added.

### Alternatives
- **Pure LLM prompt evaluation:** Rejected due to hallucination risks, API costs, network latency, and non-reproducible scoring across runs.
- **Naive substring keyword search:** Rejected due to excessive false positives and inability to resolve technical acronyms (`k8s` vs `kubernetes`).

---

## ADR-0014: Deterministic Form DOM Crawler, Semantic Field Classifier, and Anti-Submission Hard Gate

### Status
Accepted

### Context
Automating or assisting with job application web forms requires inspecting arbitrary DOM elements across diverse ATS platforms (Greenhouse, Lever, Workday, Ashby, SmartRecruiters, custom career sites) without executing dynamic scripts (`eval()`), submitting applications autonomously, or falling into anti-bot honeypot traps. Third-party forms frequently vary their input attributes, wrap labels in custom parent elements, or employ complex radio and custom dropdown controls. Furthermore, candidate submissions must never be automated to the point of final submission without mandatory human visual confirmation.

### Decision
Implement a deterministic DOM crawling, semantic field classification, and submission protection pipeline:
1. **Deterministic Content Script DOM Crawler (`form-crawler.ts`)**:
   - Traverses standard inputs, textareas, native selects, ARIA listboxes/comboboxes, radio button groups, checkboxes, and file upload dropzones.
   - Robust selector generator strategy prioritizing immutable identifiers: `#id` -> `[data-testid]` / `[data-automation-id]` -> `[name]` -> unique class selector -> hierarchical `nth-of-type` fallback path.
   - Visual label extraction inspecting `<label for="...">`, parent `<label>`, `<fieldset><legend>`, and ARIA attributes (`aria-label`, `aria-labelledby`).
   - ATS vendor detection (`detectAtsPlatform`) from URL hostname patterns and DOM container markers.
2. **Semantic Field Classifier (`canonical-fields.ts`)**:
   - Deterministic 5-strategy classification hierarchy: HTML5 `autocomplete` tokens (0.98 confidence), input `type` hints (0.95), visual label regex patterns (0.80–0.96), element name/id tokens (0.70–0.85), and placeholder text (0.60–0.80).
   - Direct mapping to canonical profile attributes (`first_name`, `last_name`, `email`, `phone`, `resume`, `cover_letter`, `linkedin_url`, `github_url`, `work_authorization`, `visa_sponsorship`, `salary_expectation`, EEO disclosures).
   - Deterministic value lookup (`resolveProfileValueForField`) extracting candidate profile properties without external LLM network hops or hallucinations.
3. **Anti-Bot Honeypot Trap Detection (`isHoneypotField`)**:
   - Inspects element attributes for spam trap tokens (`honeypot`, `hidden field`, `anti_spam`, `trap`, `hp_`).
   - Evaluates computed layout properties (`display: none`, `visibility: hidden`, `opacity: 0`, dimensions `<= 1px`, or offscreen positioning `< -500px`).
   - Flags honeypot fields so they are strictly excluded from automated action plans, preventing anti-bot disqualification.
4. **Discrete Choice & Option Matching Engine (`option-matcher.ts`)**:
   - Resolves discrete select options and radio choices using a 5-tier resolution strategy: exact match, boolean intent (`Yes`/`No`), country aliases (`USA`/`United States`), EEO disclosures (including decline options), and token substring heuristics.
5. **Anti-Autonomous Submission Hard Gate (`isSubmitElement`)**:
   - Identifies submission buttons by checking `type="submit"` and submit intent keywords (`/submit/i`, `/apply\s*now/i`, `/send\s*application/i`).
   - Records `submitButtonSelector` on the `ApplicationForm` schema.
   - Programmatically forbids automated clicks on identified submit buttons, halting automation at `awaiting_user_review` (enforcing ADR-0006).
6. **Side Panel Form Inspector UI (`FormInspector.tsx`)**:
   - Interactive UI providing one-click DOM inspection of the active tab.
   - Displays ATS platform badge, input counters, and active submit gate status.
   - Renders recognized fields table with canonical keys, confidence scores, honeypot alerts, and live candidate profile value previews.

### Consequences
- **Positive:** Highly robust field recognition across major ATS vendors, zero automated submission risk, immunity to anti-bot honeypots, zero LLM token costs for form parsing, and transparent candidate preview.
- **Negative:** Highly obscure or dynamic custom canvas/iframe forms without accessible DOM attributes may require custom adapter extensions in Phase 13.

### Alternatives
- **LLM-driven DOM interpretation (sending full HTML to LLM):** Rejected due to massive token costs, latency (several seconds per form), prompt injection vulnerabilities from malicious form labels, and non-deterministic field mappings.
- **Blind CSS selector autofill:** Rejected because lack of honeypot checks and missing submission gates would cause bot bans and accidental premature submissions.

---

## ADR-0015: Deterministic Browser Action Protocol, Action Risk Stratification, and Dry Run Planning Engine

### Status
Accepted

### Context
Automated form-filling browser extensions often execute immediate, invisible DOM mutations without prior user inspection. In the context of real job applications, unattended writes risk corrupting previously entered answers, answering sensitive demographic (EEO) or legal work authorization questions inaccurately, triggering anti-bot security rejections via honeypot traps, or accidentally firing application submission buttons. The candidate must be provided with complete transparency, explicit before/after diffs, and the authority to approve, edit, or reject any planned interaction before the webpage is modified.

### Decision
Implement a deterministic browser action planning engine, multi-tier risk stratification model, and dry-run preview protocol:
1. **Deterministic Action Planning Pipeline (`planner.ts`)**:
   - Accepts an inspected `ApplicationForm` and verified `CandidateProfile`.
   - Maps inputs to typed declarative commands (`fill_text`, `select_option`, `click`, `check`, `upload_file`) without evaluating arbitrary JavaScript or invoking probabilistic LLM calls.
   - Enforces the Honeypot Shield: inputs flagged as `isHoneypotSuspect` are excluded from execution and logged in `skippedFields`.
2. **Action Risk Stratification**:
   - **High Risk**: EEO demographic disclosures (`eeo_*`, `identity.demographics`), legal work authorization / visa sponsorship questions, and file uploads. High-risk actions require explicit candidate approval (`userConfirmed: false` by default).
   - **Medium Risk**: Overwriting existing non-empty DOM values, fields with confidence scores between 0.60 and 0.84, or open-ended custom questions.
   - **Low Risk**: High-confidence (>= 0.85) standard identity, contact, link, and address fields where the DOM input is currently blank. Low-risk actions are pre-approved for execution efficiency.
3. **Anti-Autonomous Submission Gate (ADR-0006 Hard Enforcement)**:
   - Validates all planned actions via `validateBrowserActionSafety`. Clicks targeting submit buttons or matching submission intent keywords are rejected from the plan.
   - Retains `submitButtonSelector` exclusively for informational display and candidate orientation.
4. **Before/After Action Diffs & Inline Candidate Overrides**:
   - Generates human-readable diff explanations comparing existing DOM values against candidate profile values.
   - Provides an inline editing mechanism (`updatePlanActionValue`) allowing the candidate to adjust proposed values directly in the UI prior to execution.
   - Allows candidates to exclude/skip specific fields (`excludePlanAction`) or toggle approval status (`togglePlanActionApproval`).
5. **Background RPC & Side Panel UI (`DryRunInspector.tsx`)**:
   - Background service worker caches the active `DryRunPlan` across tab navigation.
   - Side panel view displays risk distribution metrics, anti-submission assurance banner, filterable action diff cards, inline override editors, and execution readiness indicators.

### Consequences
- **Positive:** Complete candidate transparency, total immunity to accidental submissions, elimination of honeypot traps, auditable action diffs, and compliance with the core philosophy (*AI proposes, application validates, user decides, browser executes*).
- **Negative:** Requires an extra visual review step for candidates compared to fully autonomous "one-click apply" bots (which is an intentional safety feature).

### Alternatives
- **Direct autonomous DOM autofill without dry run:** Rejected due to severe candidate risk of misrepresentation, submitting corrupted answers, or triggering anti-bot bans.
- **LLM-generated arbitrary script actions (`page.evaluate` strings):** Rejected due to remote code execution risks and violation of Chrome Manifest V3 security boundaries.

---

## ADR-0016: Synthetic DOM Event Simulation, Framework Value Tracking Bypass, and Paced Execution Engine

### Status
Accepted

### Context
Modern web applications and applicant tracking systems (Greenhouse, Lever, Ashby, Workday) are built using reactive frontend frameworks such as React 16+, Vue, and Angular. In these frameworks, directly setting `element.value = "..."` or `element.checked = true` via JavaScript fails to update the component's internal state. Specifically, React installs a prototype property tracker (`_valueTracker`) on HTML inputs; when direct property assignment occurs, React fails to detect a diff and wipes the value upon blur. Furthermore, instantaneous synchronous DOM writes trigger anti-bot heuristics (Cloudflare, PerimeterX, Datadome), and autonomous filling bots risk triggering accidental application submissions.

### Decision
Implement a content script browser action execution engine, native prototype setter bypass protocol, and paced interaction simulator:
1. **Native Property Setter Bypass (`action-interpreter.ts`)**:
   - Access the native property descriptor from the prototype (`HTMLInputElement.prototype`, `HTMLTextAreaElement.prototype`) and invoke its native setter (`descriptor.set.call(element, value)`).
   - This bypasses React and Vue property interception, ensuring internal state trackers register the update prior to event bubbling.
2. **Complete Synthetic Event Lifecycles**:
   - For text fields (`simulateTextInput`): Dispatches `pointerdown` -> `mousedown` -> native `focus()` -> native setter mutation -> `InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText' })` -> `Event('change', { bubbles: true })` -> native `blur()`.
   - For dropdowns (`simulateSelectOption`): Dispatches native focus, sets select value, synchronizes `option.selected`, and fires `input` and `change`.
   - For checkboxes (`simulateCheckbox`): Dispatches `click()` toggle, enforces native setter, and propagates `input` and `change`.
   - For file attachments (`simulateFileUpload`): Constructs a typed `File` object and populates `input.files` via synthetic `DataTransfer` items.
3. **Execution Pacing & Visual Feedback Engine**:
   - Human-paced microtask delay (configurable, defaults to 150ms) between consecutive form actions, eliminating bot detection flags.
   - Smooth element scroll-into-view and transient green highlight outline (`2px solid #10b981`) to provide visual confirmation of filled fields.
4. **Anti-Autonomous Submission Hard Gate (ADR-0006 Hard Stop)**:
   - Programmatically refuses to click any element classified as a submission button (`isSubmitElement`), or possessing submission semantics (`isSubmissionIntent`).
   - Halts execution cleanly before the submit button, setting `haltedAtSubmissionGate: true` in the `ExecutionReport`.
5. **Execution Orchestration & UI Feedback (`DryRunInspector.tsx`)**:
   - Background service worker exposes `EXECUTE_PLAN` RPC which dispatches `EXECUTE_CONTENT_PLAN` to the active tab's isolated content script.
   - Side panel displays execution metrics (total planned, executed, failed, duration), highlights any partial selector failures, and renders the Anti-Autonomous Submit Gate completion banner prompting the candidate to review and submit manually.

### Consequences
- **Positive:** Guaranteed form value persistence across React, Vue, and Angular ATS forms; avoidance of anti-bot bans via natural interaction pacing; transparent visual feedback; absolute protection against accidental or unverified application submissions.
- **Negative:** Paced filling of 10–20 fields takes 1.5–3 seconds compared to instantaneous programmatic DOM writes (an intentional tradeoff for reliability and bot safety).

### Alternatives
- **Naive property assignment (`element.value = val`):** Rejected because React immediately discards changes on input blur.
- **Dynamic JavaScript injection (`eval()` / script injection):** Rejected due to Chrome MV3 security policies and prompt injection vulnerability.
- **Fully autonomous form submission:** Strictly rejected under ADR-0006 to preserve human agency and decision-making authority.

---

## ADR-0017: Human-in-the-Loop Review UI, In-Page Visual Synchronization, and Selective Execution Engine

### Status
Accepted

### Context
During form filling, candidates reviewing planned actions in the Side Panel need:
1. Ground-truth evidence citations linking every proposed value directly back to verified profile records (ADR-0001, ADR-0004).
2. Direct visual correlation between action cards in the Side Panel and physical inputs on complex, multi-column ATS application forms.
3. An optional in-page preview overlay rendering candidate values directly beside live form inputs prior to DOM mutation.
4. Flexible, granular execution controls: 1-click batch approval of low-risk fields without compromising explicit confirmation gates on high-risk legal/demographic questions, as well as isolated single-field execution ("Fill Field").
5. Continuous enforcement of the Anti-Autonomous Submission Hard Gate (ADR-0006) across all batch and selective execution flows.

### Decision
Implement the Human-in-the-Loop Review UI, In-Page Visual Synchronization Protocol, and Selective Execution Engine:

1. **Ground-Truth Evidence Citations (`planner.ts`)**:
   - `resolveEvidenceSourceTitle(field)` maps inferred mapping keys to verified source categories (e.g., `Candidate Identity (Verified Profile)`, `Contact Information (Verified Profile)`, `Legal Work Authorization (User Confirmation Required)`, `Demographic Disclosures (User Confirmation Required)`).
   - Attached to each `DryRunAction` as `sourceEvidenceTitle` and presented with an evidence badge (`🔗 Grounding: ...`) on the Side Panel review card.

2. **In-Page Visual Synchronization & Attention Callouts (`in-page-inspector.ts`)**:
   - Side panel action card hover or focus sends `HIGHLIGHT_FORM_FIELD` message to the active tab's isolated content script.
   - The content script saves original styles, applies a high-contrast attention outline (`3px solid #3b82f6`, `outlineOffset: 3px`, `box-shadow`), centers the element via smooth `scrollIntoView`, and mounts a floating `.applykit-focus-callout` badge above the input.
   - On blur, mouse leave, or target transition, `clearTargetHighlight` cleanly restores original element styles and purges all callout nodes.

3. **Non-Invasive In-Page Preview Overlay (`renderInPageReviewBadges`)**:
   - When toggled in the Side Panel, the content script renders `.applykit-preview-badge` pill elements directly adjacent to target inputs displaying the candidate value staged for insertion.
   - Injected with `pointer-events: none` and scoped styles to guarantee zero interference with host page click events, autofocus handlers, or validation listeners.
   - `removeInPageReviewBadges` ensures 100% teardown of injected badges and style tags.

4. **Granular Batch Approval Modes (`planner.ts`)**:
   - `approveAllLowRiskActions(plan)`: Batch approves fields with `riskLevel === 'low'` (e.g. name, email, phone) while strictly preserving `userConfirmed: false` on `riskLevel === 'high'` fields (EEO, work authorization, sponsorship, resume files).
   - `approveAllActions(plan)`: Candidate-initiated full batch confirmation for experienced users.
   - `resetAllApprovals(plan)`: Reverts confirmations to baseline risk-stratified defaults.

5. **Isolated Selective Single-Field Execution (`createSelectiveDryRunPlan`)**:
   - Generates an isolated, single-action sub-plan marked `isApproved = true` for the targeted field.
   - Dispatches to the background service worker via `EXECUTE_SELECTIVE_ACTION` which executes the sub-plan through `executeBrowserPlan`.
   - Guarantees that native React/Vue setter bypasses, synthetic event lifecycles, and the Anti-Autonomous Submission Hard Gate apply identically to individual field fills.

### Consequences
- **Positive:** Complete candidate confidence and situational awareness; zero ambiguity regarding data provenance; seamless visual mapping between side panel and webpage; fine-grained execution flexibility; absolute preservation of the Anti-Autonomous Submit Hard Gate.
- **Negative:** Visual overlays require careful scoped styling to prevent layout shift on fragile third-party ATS pages.

### Alternatives
- **Direct inline DOM autofill on card hover:** Rejected because it mutates webpage state before candidate decision and breaks form validation lifecycles.
- **Separate lightweight execution code path for single-field execution:** Rejected to avoid duplicating native setter bypasses, synthetic event lifecycles, and safety gate checks; using `createSelectiveDryRunPlan` reuses the validated execution pipeline.

---

## ADR-0018: Application Journey State Machine, Immutable Audit Logging, and Local-First Application Tracking

### Status
Accepted

### Context
Job candidates apply to multiple roles across diverse companies and platforms. Tracking application progression, interview stages, follow-up deadlines, and historical outcomes is often fragmented across spreadsheets and emails. Furthermore, because ApplyKit executes automated browser actions in the candidate's browser, there is a strict operational, safety, and compliance need for immutable, exportable audit trails of every interaction (selectors touched, values inserted, risk levels, and ground-truth evidence citations). When exporting audit trails to standard formats like CSV for personal records or spreadsheet analysis, unescaped user or employer input introduces formula-injection vulnerabilities (CSV Injection / Formula Injection). Finally, adhering to ADR-0006 (Anti-Autonomous Submit Hard Gate) requires a strict boundary where automated executions halt at `awaiting_user_review` and can only transition to `submitted` via explicit, intentional human action.

### Decision
Implement an immutable, deterministic application journey state machine, structured audit logging, CSV formula injection neutralization, and local-first tracker repository:

1. **Extended Application State Machine (`packages/domain/src/application/state.ts`)**:
   - Comprehensive lifecycle: `idle` -> `detected_job` -> `ready_to_fill` -> `dry_run_review` -> `executing_actions` -> `awaiting_user_review` -> `submitted` -> `interviewing` -> `offered` | `rejected` | `archived`.
   - Strict transition guards (`ALLOWED_TRANSITIONS`) ensuring provenance cannot be forged (e.g., cannot jump from `idle` or `ready_to_fill` straight to `submitted`).
   - Terminal state classification: `'submitted' | 'offered' | 'rejected' | 'archived'`.

2. **Automatic Execution Snapshots & Hard Gate (`apps/extension/src/background/index.ts`)**:
   - `recordApplicationExecution(plan, report)` captures company name, job title, job URL, job description snapshot, and executed action diffs upon plan completion.
   - The background service worker strictly transitions the record to `awaiting_user_review`. It is programmatically forbidden from transitioning to `submitted`.

3. **Candidate-Initiated Submission Confirmation**:
   - The candidate visually reviews the filled form in the browser and manually clicks the employer's submit button.
   - The candidate then clicks "Confirm Manual Submission" in the Side Panel Tracker, transitioning the status to `submitted` and stamping `appliedAt`.

4. **Formula-Injection Hardened CSV & JSON Exporter (`packages/domain/src/application/audit-exporter.ts`)**:
   - Exports immutable audit trails containing executed selectors, values, risk ratings, and evidence citations.
   - Neutralizes CSV formula injection (`sanitizeCsvCell`): prepends a single quote (`'`) to any cell starting with `=`, `+`, `-`, `@`, `\t`, or `\r`.
   - Strictly complies with RFC 4180 quote escaping (`""`).

5. **Local-First Tracker Repository & Right to Erasure**:
   - `IApplicationRepository.updateApplicationStatus` persists stage updates, interview notes, and follow-up reminders in `IndexedDB`.
   - `DELETE_APPLICATION_RECORD` implements atomic single-record deletion honoring candidate data sovereignty.

6. **Side Panel Tracker Dashboard (`apps/extension/src/sidepanel/components/ApplicationTracker.tsx`)**:
   - Metric cards (Tracked, Awaiting Review, Submitted, Interviewing, Offered, Response Rate).
   - Search & status filters.
   - Detailed drawer with submission gate confirmation, status transitions, interview stage tracker, follow-up date picker, executed actions table, immutable audit history timeline, and 1-click JSON/CSV exports.

### Consequences
- **Positive:** Complete visibility into past applications, immutable verification logs, safe spreadsheet exports, zero autonomous submission violations, full compliance with GDPR/CCPA data sovereignty.
- **Negative:** Candidate must manually confirm submission in the side panel after clicking submit on the ATS page.

### Alternatives
- **Allowing the extension to mark applications as `submitted` automatically:** Rejected under ADR-0006 because the extension never clicks submit and cannot assume the submission succeeded without human verification.
- **Unsanitized CSV output:** Rejected due to OWASP CSV Injection vulnerabilities where malicious job titles or company names execute DDE commands in Excel.

---

## ADR-0019: Evidence-Grounded Application Tailoring, Fact-Checking Verification, and Factual Grounding Governance

### Status
Accepted

### Context
Job candidates customizing resumes and drafting cover letters for target opportunities face a severe hazard when using generative AI: hallucinated credentials, exaggerated metrics, assumed responsibilities, or fabricated employer partnerships. Submitting unverified or embellished claims destroys candidate credibility during technical screening, background checks, and employer reference audits. Furthermore, candidates need materials tailored specifically to role criteria, with high-priority requirements addressed first. In accordance with ApplyKit's core operating philosophy (*The AI proposes, the application validates, the user decides, the browser executes*), all tailored outputs must be strictly grounded in verified facts, auditable against the candidate's `EvidenceGraph`, and editable with immediate fact-checking verification.

### Decision
Implement an evidence-grounded tailoring pipeline, dynamic resume section/bullet selector, structured cover letter assembler, sentence-level fact-checking verification pass, and export suite:

1. **Dynamic Resume Section & Bullet Selector (`packages/domain/src/tailoring/resume-tailorer.ts`)**:
   - Pure functional deterministic pipeline reordering experiences, projects, and skills based on target job criteria.
   - Experiences and projects ranked by requirement alignment scores.
   - Accomplishment bullets within each item ranked with matching bullets prioritized and mapped to `EvidenceId` citations from the `EvidenceGraph`.
   - Skills partitioned into `matchedRequired`, `matchedPreferred`, and `additionalSkills`.
   - Synthesizes an executive summary referencing verified title, tenure, and verified metric bullets without inventing numbers.

2. **Evidence-Grounded Cover Letter Generator (`packages/domain/src/tailoring/cover-letter-generator.ts`)**:
   - Sectional structure: opening paragraph, themed body paragraphs, closing paragraph, and consolidated full text.
   - Body paragraphs strictly cite top verified accomplishments from `EvidenceGraph` (`AccomplishmentCitation` with `evidenceId` and verbatim `sourceSnippet`).
   - Zero hallucination guarantee: no invented metrics, companies, or technologies.

3. **Sentence-Level Fact-Checking Verification Pass (`packages/domain/src/tailoring/fact-checker.ts`)**:
   - Audits every generated or candidate-edited sentence against the candidate's `EvidenceGraph`, work experiences, projects, and skills.
   - **Metric Provenance Audit**: any percentage, currency, or multiplier metric in the text (e.g. `40%`, `$50M`, `10M+`) must have exact provenance in candidate records. Missing metrics are flagged as `critical` violations and cap the grounding score at <= 50%.
   - **Competency & Assertion Overlap**: calculates token overlap against evidence nodes and flags unsubstantiated statements.
   - Returns `FactCheckReport`: `groundingScore` (0–100%), `isPristine` flag (>= 85% score, 0 unbacked statements), verified statements list, unbacked statements list, and actionable recommendations.

4. **Scoped AI Prompt Builders with Untrusted Delimiters (`packages/domain/src/ai/builders.ts`)**:
   - `buildCoverLetterPrompt` and `buildResumeTailoringPrompt` encapsulate untrusted job titles, requirements, and company names in `<target_role>` and `<company_name>` XML delimiters.
   - Enforces system prompt directives forbidding metric synthesis or experience fabrication.

5. **Clean Markdown & Plain-Text Exporters (`packages/domain/src/tailoring/exporters.ts`)**:
   - Pure export formatters generating structured Markdown with headers/links or clean plain text ready for direct pasting into ATS input textareas.

6. **Side Panel Tailoring Studio (`apps/extension/src/sidepanel/components/TailoringStudio.tsx`)**:
   - Interactive view with mode switcher (Tailored Resume vs. Cover Letter).
   - Live Grounding Score card with Pristine certification badge and unbacked statement warnings.
   - Sectional viewers and full-text editor with a live "Re-check Grounding" button.
   - 1-click clipboard copy and file downloads (.md / .txt).

### Consequences
- **Positive:** Absolute factual accuracy, zero risk of hallucinated credentials, verifiable citations for every claim, full offline functionality without external LLM keys, and complete candidate control.
- **Negative:** If a candidate has sparse resume documentation or missing metrics in their profile, the tailored documents remain conservative and factual rather than inventing persuasive embellishments.

### Alternatives
- **Direct unconstrained LLM cover letter generation:** Rejected due to frequent hallucinations of non-existent metrics, tools, and past projects.
- **Keyword stuffing without bullet ranking:** Rejected because ATS and human reviewers expect coherent, prioritized narratives addressing core requirements.

---

## ADR-0020: ATS-Specific Form Adapters, Multi-Step Wizard Progression, and Authentication Barrier Detection

### Status
Accepted

### Context
Applicant Tracking Systems in production diverge significantly from standard single-page HTML5 forms:
1. **Workday**: Heavily relies on multi-page application wizards with 4–6 steps ("My Information", "My Experience", "Application Questions", "Voluntary Disclosures", "Review"), gates application access behind candidate account creation/sign-in screens, and renders custom search-and-select prompt grids rather than native HTML `<select>` elements.
2. **Greenhouse**: Integrates complex demographic self-identification questionnaires (EEO race, gender, veteran, and disability disclosures) in distinct sub-containers, alongside styled custom file dropzones triggering hidden file inputs.
3. **Lever**: Deploys dynamic card-based question blocks, multiline textareas, data-processing consent checkboxes, and indexed URL input schemas (`urls[LinkedIn]`, `urls[GitHub]`, `urls[Portfolio]`).
4. **Ashby**: Renders modern React comboboxes (`[role="combobox"]`), floating listbox popovers (`[role="listbox"]`, `[role="option"]`), dynamic validation error indicators (`[aria-invalid="true"]`), and custom drag-and-drop file targets.
5. **Generic Web Forms**: Legacy or bespoke career portals requiring progressive fallback heuristics for fieldsets, progress indicators, and standard controls.

Without specialized ATS drivers, generic crawlers mistake intermediate wizard navigation buttons for final submission triggers, fail to parse ARIA comboboxes, attempt to autofill login passwords into application fields, or misclassify EEO questions.

### Decision
1. **Modular ATS Form Adapter Architecture (`apps/extension/src/content/adapters/form/`)**:
   - Defined `AtsFormAdapter` interface requiring:
     - `matches(url: URL, doc: Document): boolean`
     - `detectAuthBarrier(doc: Document): AuthBarrierInfo | null`
     - `detectWizardState(doc: Document): StepProgressionInfo | null`
     - `detectValidationErrors(doc: Document): readonly AtsValidationMessage[]`
     - `crawlForm(doc: Document, container?: HTMLElement): ApplicationForm | null`
   - Established prioritized registry: Workday (priority 40), Greenhouse (priority 30), Lever (priority 30), Ashby (priority 30), and Generic Fallback (priority 10).

2. **Wizard Progression vs. Anti-Autonomous Submit Gate (ADR-0006)**:
   - "Save and Continue" / "Next" wizard step navigation buttons are identified as `nextStepButtonSelector` on intermediate wizard steps (`isFinalStep: false`).
   - The final submission button is identified strictly on the review/final step (`isFinalStep: true`), where automated clicks remain programmatically forbidden.

3. **Authentication Barrier Detection**:
   - `detectAuthBarrier` identifies candidate sign-in walls, account creation forms, and password-only inputs before application access.
   - Prevents attempting to insert profile data into login fields, presenting a clear guidance banner in the Side Panel UI.

4. **Demographic & EEO Disclosure Protection (ADR-0003)**:
   - Greenhouse and Lever demographic questions (gender, race, veteran status, disability) are classified with canonical keys (`eeo_gender`, `eeo_race`, `eeo_veteran`, `eeo_disability`) and marked `high` risk, ensuring explicit candidate confirmation before filling.

5. **Action Interpreter Custom Combobox Engine (`simulateCustomComboboxSelect`)**:
   - Added support for ARIA combobox inputs and custom button popups.
   - Focuses trigger element, types search queries if textual input, locates matching `[role="option"]` items in popup listboxes, and safely clicks the selected option without autonomous submit hazard.

6. **Side Panel UI ATS Integration (`FormInspector.tsx`)**:
   - Platform badge with vendor-specific theme colors (`ats-badge-workday`, `ats-badge-greenhouse`, `ats-badge-lever`, `ats-badge-ashby`).
   - Prominent authentication barrier warning card with sign-in control locator.
   - Wizard progression card displaying current step, total steps, step name, and next-step indicator.
   - Live ATS validation error cards displaying active form error messages.

### Consequences
- **Positive:** >90% automated fill accuracy on complex multi-page wizards, clear candidate guidance on login walls, robust custom combobox support, and zero risk of accidental submission during multi-step navigation.
- **Negative:** Highly customized, non-standard enterprise Workday instances with unique tenant automation IDs may occasionally fall back to generic heuristics.

### Alternatives
- **Single monolithic crawler with vendor `if/else` checks:** Rejected due to high cyclomatic complexity, tight coupling, and brittle regression risks when updating single ATS vendors.
- **Treating wizard "Next" buttons as final submit:** Rejected because multi-page applications would require manual navigation for every single page change.

---

## ADR-0021: Human Pacing Engine, Anti-Detection Resilience, and Right to Erasure Data Sovereignty

### Status
Accepted

### Context
Modern job application portals (Workday, Greenhouse, Ashby, Lever) integrate sophisticated bot-detection and rate-limiting heuristics (Cloudflare Turnstile, DataDome, Kasada, hCaptcha, PerimeterX) that analyze browser automation footprints:
1. **Unnatural Input Cadence:** Instantaneous form population across dozens of inputs without intermediate keystrokes or natural human latency triggers automation score degradation.
2. **Synthetic Boundary Coordinates:** Simulated pointer clicks arriving at exact coordinates `(0, 0)` or strict mathematical element bounds reveal automated headless scripts.
3. **Truncated Event Lifecycles:** Disagreeable event sequences that omit standard W3C UI Event transitions (`pointerover`, `mouseover`, `pointerdown`, `mousedown`, `focus`, `click`, `mouseup`, `pointerup`) fail framework validation listeners.
4. **Detectable Property Poisoning:** Naive automation tools attempt to bypass bot detection by monkey-patching `navigator.webdriver` via `Object.defineProperty(navigator, 'webdriver', { get: () => false })`. Anti-bot systems explicitly detect this through `Object.getOwnPropertyDescriptor` (detecting JavaScript wrapper functions rather than native C++ implementations).
5. **Privacy & Data Sovereignty:** GDPR Article 17 and CCPA mandate that candidates have complete sovereignty over personal data with a verifiable, atomic "Right to Erasure" ("Right to be Forgotten") wiping all locally cached candidate profiles, evidence items, claims, job postings, application records, and provider credentials without leaving residual traces.

### Decision
1. **Anti-Detection Non-Poisoning Invariant (ADR-0014, ADR-0021)**:
   - ApplyKit programmatically forbids overriding `navigator.webdriver`, `window.chrome`, or fundamental JavaScript prototypes (`Object.prototype`, `Function.prototype`, `Element.prototype`).
   - Anti-detection resilience is achieved exclusively through authentic W3C event synthesis, realistic spatial coordinate jitter, and human typing cadences, leaving the browser runtime untampered.

2. **Human Pacing Engine (`pacing-engine.ts`)**:
   - Implemented configurable pacing cadences:
     - `natural`: progressive character typing (20-65ms delay with randomized jitter) and spatial coordinate jitter around element centers.
     - `fast`: rapid entry (15ms delay) for accelerated review workflows.
     - `instant`: immediate value assignment bypassing delays for automated test suites.
   - Spatial coordinate jitter (`calculateElementClickCoordinates`): computes bounding rect center with Gaussian coordinate variance within element boundaries, ensuring non-zero, human-like coordinates.
   - Progressive keystroke synthesis (`typeTextProgressively`): simulates character-by-character entry with native setter bypass and standard `keydown`, `input` (`inputType: 'insertText'`), and `keyup` event dispatches.
   - Full synthetic pointer lifecycle (`dispatchRealisticPointerSequence`): dispatches `pointerover` -> `mouseover` -> `pointerdown` -> `mousedown` -> `focus` -> `click` -> `mouseup` -> `pointerup` with realistic `clientX`/`clientY` and `screenX`/`screenY` coordinates.

3. **Atomic Right to Erasure Purge Engine (`purge-engine.ts`)**:
   - `purgeAllCandidateData()`:
     - Clears all records across all IndexedDB object stores (`candidate_profiles`, `job_postings`, `application_records`, `evidence_items`, `candidate_claims`).
     - Drops the IndexedDB database (`applykit_db`) with connection timeout safeguards.
     - Atomically wipes extension-local storage (`chrome.storage.local`) and encrypted provider credentials.
     - Returns a structured `PurgeResult` audit record.
   - `getStorageUsageSummary()`:
     - Computes live counts across candidate profiles, evidence records, claims, applications, jobs, and configured provider keys.
     - Powers the Storage Audit card in the Sidepanel UI, providing total transparency to the candidate.

4. **Manifest V3 Content Security Policy & Static Integrity**:
   - Configured strict extension Content Security Policy: `"extension_pages": "script-src 'self'; object-src 'self'"`.
   - Verified through automated static analysis tests that production code contains zero dynamic code execution (`eval`, `new Function`) and zero commercial tracking/telemetry SDKs (`google-analytics`, `mixpanel`, `segment`, `sentry`).

### Consequences
- **Positive:**
  - High resilience against bot-detection heuristics without risky DOM prototype tampering.
  - Natural typing cadence prevents rate-limiting and form validation errors.
  - Complete candidate data sovereignty adhering to GDPR/CCPA Right to Erasure.
  - Transparent storage usage metrics displayed directly in the Sidepanel UI.
  - Strict Content Security Policy protects extension context against remote script injection.
- **Negative:**
  - Natural progressive typing introduces a slight latency per form field (100-300ms per text field), which can be switched to fast/instant mode when desired.

### Alternatives
- **Tampering with `navigator.webdriver` via content scripts:** Rejected because anti-bot engines (Cloudflare, Kasada) specifically inspect prototype descriptors and flag JavaScript-wrapped getters.
- **Soft deletion (flagging records as `is_deleted: true`):** Rejected because GDPR/CCPA Right to Erasure requires permanent, unrecoverable data deletion across all local storage mechanisms.











