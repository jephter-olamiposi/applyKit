# Chrome Web Store Listing Package: ApplyKit

This document outlines the official store listing metadata, developer disclosures, and permission justifications required for the Chrome Web Store Developer Dashboard.

---

## 1. Store Metadata

- **Extension Name:** ApplyKit - Job Application Copilot
- **Short Name:** ApplyKit
- **Version:** 0.1.0
- **Category:** Productivity / Workflow
- **Language:** English (United States)
- **Support / Source URL:** https://github.com/jephter-olamiposi/applyKit

---

## 2. Summary & Descriptions

### Short Description (Max 132 characters)
> Local-first job application copilot with evidence-backed matching, dry-run form filling, and a strict anti-autonomous submit gate.

*(Character count: 129 / 132)*

### Detailed Description
```text
ApplyKit is a local-first, privacy-respecting browser copilot that assists job seekers with real applications across Greenhouse, Workday, Lever, Ashby, and custom career portals.

ApplyKit eliminates repetitive browser typing while ensuring you remain in complete control of every application:

THE CORE PHILOSOPHY
• The AI proposes.
• The application validates.
• The user decides.
• The browser executes.

KEY FEATURES
1. Evidence-Grounded Matching & Gap Analysis
• Link qualifications directly to verified accomplishments from your resume and work history.
• Identify matching requirements and clear experience gaps with zero hallucination.

2. Transparent Dry-Run Form Review
• View a field-by-field diff (current value vs. proposed value) before anything is filled into the page.
• Inspect proposed inputs and override values inline.
• Risk categorization flags sensitive fields (e.g. salary expectations and demographic disclosures) for mandatory confirmation.

3. Anti-Autonomous Submit Hard Gate (ADR-0006)
• ApplyKit is programmatically forbidden from automatically clicking application submission buttons.
• Execution halts at the final step, ensuring you personally review all answers before manual submission.

4. Multi-ATS Specialized Drivers
• Native support for Workday multi-step wizards, Greenhouse custom questions, Lever portfolio links, and Ashby comboboxes.
• Graceful handling of login barriers and validation error alerts.

5. Local-First Privacy & Right to Erasure
• All candidate profiles, evidence items, claims, and application records stay 100% locally in your browser.
• Zero telemetry, zero analytics tracking, zero data monetization.
• One-click Right to Erasure permanently purges all stored data and credentials.

6. Secure Credential Isolation (ADR-0002)
• Use your own AI provider keys (OpenAI, Anthropic, Google Gemini, OpenRouter).
• Keys are stored encrypted inside the Extension Service Worker and are never accessible to host webpages or content scripts.

Open Source & Auditable:
Inspect the full source code and security architecture at:
https://github.com/jephter-olamiposi/applyKit
```

---

## 3. Single Purpose Statement

> **ApplyKit's single purpose is to assist candidates with completing job application forms by matching verified qualifications against job requirements and safely filling form fields under strict user review.**

---

## 4. Permission Justifications (For CWS Reviewers)

| Permission | Technical Need & Justification |
| :--- | :--- |
| **`sidePanel`** | Required to display the ApplyKit copilot interface inside Chrome's native Side Panel adjacent to active job application pages, providing side-by-side match analysis and dry-run diff review without obscuring the application form. |
| **`storage`** | Required to persist the candidate's profile, atomic evidence graph, application tracking records, and encrypted AI provider credentials locally using `IndexedDB` and `chrome.storage.local`. No personal data is stored on external servers. |
| **`activeTab`** | Required to inspect the DOM of the active job posting and application form only when the candidate invokes the extension, extracting requirements and identifying form inputs. Does not run on background or inactive tabs. |
| **`scripting`** | Required to execute deterministic, typed `BrowserAction` commands (e.g. progressive keystroke text entry, option selection) into application form elements after the candidate has reviewed and approved the dry-run plan. |

---

## 5. Privacy Practices Disclosures

- **Does the extension collect user data?**  
  **No.** ApplyKit does not collect, transmit, or store personal information on any central server. All data resides in local browser storage (`IndexedDB` / `chrome.storage.local`).
- **Does the extension use remote code execution (`eval()`)?**  
  **No.** Enforced by Manifest V3 Content Security Policy (`script-src 'self'; object-src 'self'`).
- **Does the extension sell or transfer user data to third parties?**  
  **No.**
- **Does the extension use user data for purposes unrelated to the core function?**  
  **No.**
- **Does the extension use user data to determine creditworthiness or for lending purposes?**  
  **No.**
