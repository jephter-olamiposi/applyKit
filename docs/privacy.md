# ApplyKit Privacy Specification & Data Scoping Architecture

ApplyKit is built on an unwavering commitment to candidate privacy and data sovereignty. Job seekers entrust the system with highly personal data: contact details, employment history, compensation targets, demographic disclosures, and career aspirations. This document specifies the privacy guarantees, local-first storage architecture, and strict AI payload scoping rules.

---

## 1. Privacy Guarantees & Principles

1. **Local-First Storage:** All candidate profile data, resumes, documents, and application history remain stored locally on the user's device (via `chrome.storage.local` and `IndexedDB`).
2. **Zero Central Telemetry:** ApplyKit operates without central tracking servers, analytics beacons, or remote user profiling. There is no ApplyKit cloud database storing candidate resumes or application records.
3. **User Data Sovereignty:** The candidate retains full ownership of their data:
   - One-click export of complete profile and history in standard JSON format.
   - One-click purge ("Right to be Forgotten") that completely wipes all extension storage and cached files.
4. **Local Model Support:** Candidates who desire 100% offline privacy can configure ApplyKit to use local models (e.g., via Ollama or Chrome's Built-in AI Prompt API), ensuring that zero bytes of data ever leave their machine.

---

## 2. AI Provider Payload Scoping

A common anti-pattern in AI tooling is serializing the entire user profile and dumping it into every LLM prompt. ApplyKit strictly forbids this practice. Prompts are constructed using **Scoped Contexts** that expose only the minimal attributes required for the immediate task.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Candidate Profile Database                         │
│  [Identity] [Demographics] [Full History] [All Skills] [Saved Answers]      │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                         Context Scoping Filter
                                       │
       ┌───────────────────────────────┼───────────────────────────────┐
       ▼                               ▼                               ▼
┌─────────────────────┐     ┌─────────────────────┐     ┌─────────────────────┐
│JobExtractionContext │     │RequirementMatching  │     │FieldAnsweringContext│
│- Raw Job Posting    │     │ Context             │     │- Field Label/Type   │
│- ZERO Candidate Data│     │- Job Requirements   │     │- Relevant Claim(s)  │
│                     │     │- Relevant Skills &  │     │- Specific Answer(s) │
│                     │     │  Experience Bullets │     │  Only               │
└──────────┬──────────┘     └──────────┬──────────┘     └──────────┬──────────┘
           │                           │                           │
           ▼                           ▼                           ▼
     AI Provider                 AI Provider                 AI Provider
```

### 2.1 Context Scoping Rules

| Task | Allowed Data in Prompt | Strictly Prohibited Data |
|---|---|---|
| **Job Posting Extraction** | Job description HTML/text, page URL metadata. | **ALL candidate data** (name, email, resume, skills, profile). |
| **Requirement Matching** | Extracted job requirements, list of technical skills, relevant work experience achievement bullets. | Full contact info, home address, phone, salary expectations, demographic disclosures, documents. |
| **Field Answering** | Target form label, input type, dropdown options, and specific relevant saved answer or claim. | Irrelevant work history, contact details (unless field is an email/phone field), demographics. |
| **Resume Tailoring** | Job title, required qualifications, candidate's work experiences and projects. | Candidate demographics, contact info, unrelated saved answers. |

### 2.2 Demographic & EEO Field Handling

Equal Employment Opportunity (EEO) and demographic questions (race, gender, veteran status, disability status) require special privacy safeguards:
- **No AI Processing:** Demographic questions are resolved **exclusively via deterministic local mapping** from the candidate's explicit profile settings. They are **never sent to external AI providers**.
- **Default to "Decline to Self-Identify":** If the candidate has not configured explicit demographic preferences, the form engine defaults to selecting "I do not wish to answer" / "Decline to self-identify", or leaves the optional field blank.

---

## 3. Data Flow Boundaries

```
[Webpage DOM] ──(DOM Elements only)──► [Content Script]
                                            │
                                            ▼ (Field Metadata: IDs, labels)
                                    [Service Worker]
                                     ├── [Candidate Profile (Encrypted DB)]
                                     │         │ (Scoped Projection)
                                     │         ▼
                                     └──► [AI Provider Payload] ──► [LLM API]
```

1. **Host Page Boundary:** The host webpage never receives access to profile records or other form field values not directly entered into the current page.
2. **Third-Party Boundary:** When third-party LLM providers (Anthropic, OpenAI, Google) are used, requests are transmitted over encrypted TLS directly from the extension service worker to the provider's API endpoint. No intermediary proxies are used unless explicitly configured by the user.

---

## 4. Data Retention & Deletion

- **Retention:** Application history and job posting snapshots are retained locally to assist the candidate in tracking application progress and interview prep.
- **Wipe Command:** Candidates can invoke `ApplyKit.storage.purgeAll()`, which immediately executes:
  - `chrome.storage.local.clear()`
  - `indexedDB.deleteDatabase("applykit_db")`
  - Removal of all cached file buffers and document references.
