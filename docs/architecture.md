# ApplyKit Architecture Specification

ApplyKit is engineered as a local-first, privacy-preserving Chrome extension built on Manifest V3. The architecture enforces strict security isolation between untrusted web content, user interface components, and the background service worker managing sensitive credentials and candidate data.

---

## 1. High-Level System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                    CHROME BROWSER                                       │
│                                                                                         │
│  ┌─────────────────────────────────┐           ┌─────────────────────────────────────┐  │
│  │     Untrusted Host Webpage      │           │       Extension Side Panel / UI     │  │
│  │   (ATS Form: Greenhouse, etc.)  │           │   (Dry Run Inspector, Profile UI)   │  │
│  │                                 │           │                                     │  │
│  │  ┌───────────────────────────┐  │           │  ┌───────────────────────────────┐  │  │
│  │  │  Host Page DOM & Scripts  │  │           │  │   Review & Action Approvals   │  │  │
│  │  └─────────────┬─────────────┘  │           │  └──────────────┬────────────────┘  │  │
│  │                │ DOM Events     │           │                 │                   │  │
│  │  ┌─────────────▼─────────────┐  │           │  ┌──────────────▼────────────────┐  │  │
│  │  │   Content Script (MV3)    │  │           │  │   Side Panel Controller       │  │  │
│  │  │ - Form Inspector         │  │           │  │ - Diff Viewer & Overrides     │  │  │
│  │  │ - Action Interpreter      │  │           │  │ - Profile Editor              │  │  │
│  │  │ - NO API KEYS / SECRETS   │  │           │  └──────────────┬────────────────┘  │  │
│  │  └─────────────┬─────────────┘  │                             │                   │  │
│  └────────────────┼────────────────┘                             │                   │  │
│                   │                                              │                   │  │
│                   │  chrome.runtime.sendMessage (Type-safe RPC)  │                   │  │
│                   └──────────────────────┬───────────────────────┘                   │  │
│                                          │                                           │  │
│  ┌───────────────────────────────────────▼────────────────────────────────────────┐  │  │
│  │                 Extension Service Worker (Secure Core)                         │  │  │
│  │                                                                                │  │  │
│  │  ┌─────────────────────────┐  ┌───────────────────────┐  ┌──────────────────┐  │  │  │
│  │  │   Message Router / RPC  │  │ Application Lifecycle │  │ AI Context       │  │  │  │
│  │  │   Request Validation    │  │ State Machine         │  │ Scoping Engine   │  │  │  │
│  │  └────────────┬────────────┘  └───────────┬───────────┘  └────────┬─────────┘  │  │  │
│  │               │                           │                       │            │  │  │
│  │  ┌────────────▼────────────┐  ┌───────────▼───────────┐  ┌────────▼─────────┐  │  │  │
│  │  │  Action Planner         │  │ Evidence & Matching   │  │ AI Provider      │  │  │  │
│  │  │  (DryRunAction Builder) │  │ Engine                │  │ Clients (Isolated│  │  │  │
│  │  └────────────┬────────────┘  └───────────┬───────────┘  └────────┬─────────┘  │  │  │
│  │               │                           │                       │            │  │  │
│  │  ┌────────────▼───────────────────────────▼───────────────────────▼─────────┐  │  │  │
│  │  │ Local Storage Layer (chrome.storage.local / IndexedDB)                   │  │  │  │
│  │  │ - Candidate Profile & Claims (Local only)                                │  │  │  │
│  │  │ - Encrypted Provider API Keys                                            │  │  │  │
│  │  │ - Application Records & Audit Trail                                      │  │  │  │
│  │  └──────────────────────────────────────────────────────────────────────────┘  │  │  │
│  └───────────────────────────────────────┬────────────────────────────────────────┘  │  │
└──────────────────────────────────────────┼──────────────────────────────────────────────┘
                                           │
                                           │ HTTPS (Scoped Payloads Only)
                                           ▼
                       ┌───────────────────────────────────────┐
                       │          AI Service Providers         │
                       │ (Anthropic / OpenAI / Gemini / Local) │
                       └───────────────────────────────────────┘
```

---

## 2. Component Boundaries & Isolation

### A. Host Webpage (Untrusted Zone)
- **Nature:** Arbitrary third-party JavaScript and HTML rendered by the ATS or company job board.
- **Threat Vector:** May contain malicious scripts attempting to inspect browser storage, scrape extension data, or execute indirect prompt injection via job postings or form labels.
- **Boundary Guarantee:** The extension does not expose any global variables, window properties, or prototype augmentations to the host page.

### B. Content Script (Isolated World)
- **Execution Context:** Standard MV3 isolated world. Has direct access to the webpage DOM, but runs in an isolated JavaScript execution environment.
- **Responsibilities:**
  - Crawling DOM elements to detect form fields (`<input>`, `<textarea>`, `<select>`, ARIA widgets).
  - Executing deterministic `BrowserAction` commands (e.g. dispatching trusted mouse and keyboard events).
  - Extracting raw job posting text and structured metadata.
- **Strict Invariants:**
  - **ZERO SECRETS:** No API keys, passwords, or persistent sensitive identity documents are ever passed to or cached in the content script.
  - **NO ARBITRARY EVAL:** Never executes `eval()`, `new Function()`, or unverified script snippets received from the AI or page.
  - **DETERMINISTIC INTERPRETER:** Only understands a finite, typed enum of actions (`click`, `fill_text`, `select_option`, `check`, `uncheck`, `upload_file`).

### C. Extension Service Worker (Trusted Core)
- **Execution Context:** Background service worker lifecycle. Completely isolated from webpage DOM.
- **Responsibilities:**
  - Managing provider API keys and external network communication.
  - Storing and retrieving the canonical `CandidateProfile` and `Evidence` database.
  - Executing the Application State Machine (`ApplicationRecord`).
  - Scoping AI context payloads: constructing strictly minimal prompts for extraction and field matching.
  - Generating dry-run plans (`DryRunAction[]`) with confidence scoring and risk tagging.
- **Strict Invariants:**
  - All outbound LLM requests originate strictly from this context.
  - Webpage scripts have no capability to message the service worker directly unless authorized by extension-internal ID and validated by message schemas.

### D. Side Panel / Popup UI (User Review Layer)
- **Execution Context:** Chrome extension privileged page (`chrome-extension://`).
- **Responsibilities:**
  - Rendering the Dry-Run Review UI: presenting field-by-field diffs (current value vs. proposed value).
  - Candidate profile management and evidence graph inspection.
  - Configuration of AI providers and models.
  - Explicit user confirmation gates for medium- and high-risk actions.

---

## 3. End-to-End Data Flow

### Step 1: Job Detection & Extraction
1. Candidate navigates to a job posting URL.
2. The Content Script inspects the DOM for job posting indicators (JSON-LD schemas, standard ATS headers, meta tags).
3. The Content Script sends a typed `EXTRACT_JOB_REQUEST` to the Service Worker.
4. The Service Worker normalizes the raw job description into structured `JobPosting` and `Requirement[]` entities. If ambiguous, it invokes the scoped LLM extractor via the `JobExtractionContext`.

### Step 2: Profile Matching & Gap Analysis
1. The Service Worker loads the candidate's active `CandidateProfile` and associated `CandidateClaim` graph from local storage.
2. The Matching Engine compares the normalized `Requirement` list against candidate claims and evidence.
3. A match matrix is computed, identifying:
   - Strong matches backed by direct evidence.
   - Inferred matches requiring confirmation.
   - Missing qualifications / skill gaps.
4. The result is returned to the Side Panel UI for candidate visibility.

### Step 3: Form Inspection & Dry-Run Planning
1. When the candidate opens the job application form, the Content Script scans active input elements and extracts metadata (labels, placeholders, types, options, validation constraints).
2. The field list is transmitted to the Service Worker.
3. The Action Planner maps each field to candidate data:
   - Direct mappings (First Name, Email, Phone, LinkedIn URL) are resolved with 100% confidence.
   - Custom questions (e.g., "Describe a challenging project you delivered") are routed to the AI Provider using the scoped `FieldAnsweringContext`.
4. The Action Planner generates an array of `DryRunAction` objects:
   ```json
   {
     "id": "action_42",
     "action": {
       "actionType": "fill_text",
       "selector": "input#email",
       "value": "alex.chen@example.com",
       "description": "Fill primary email address"
     },
     "currentValue": "",
     "candidateValueUsed": "alex.chen@example.com",
     "confidence": 1.0,
     "riskLevel": "low",
     "userConfirmed": true
   }
   ```

### Step 4: Human-in-the-Loop Review
1. The `DryRunAction` list is rendered in the Side Panel.
2. For each action, the candidate can:
   - Accept the proposed value.
   - Edit the proposed answer inline.
   - Reject the action (skip the field).
3. The candidate clicks **Execute Approved Actions**.

### Step 5: Deterministic Execution
1. The Service Worker transmits the approved `BrowserAction[]` to the Content Script.
2. The Content Script iterates through actions sequentially:
   - Scrolls element into view.
   - Simulates human focus and input events.
   - Dispatches `input` and `change` events to trigger host framework change detection (React, Vue, etc.).
   - Pauses with randomized human-like delay (50ms - 200ms).
3. **Hard Stop at Submission:** The interpreter strictly refuses to execute actions on buttons tagged with `type="submit"` or containing submission semantics. The final "Submit Application" action remains strictly manual for the candidate.
4. The application state updates to `awaiting_user_review` and creates an immutable `ApplicationRecord` in local history.
