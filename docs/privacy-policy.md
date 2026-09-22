# ApplyKit Privacy Policy

**Effective Date:** September 22, 2026  
**Last Updated:** September 22, 2026  

ApplyKit ("we", "our", or "the extension") is a local-first, privacy-respecting browser extension designed to assist job seekers with application form filling, requirement matching, and tailoring. We believe that your career history, qualifications, and personal data belong to you and should never leave your device without your explicit consent.

This Privacy Policy describes how ApplyKit handles personal information when you use the extension.

---

## 1. Core Architectural Principle: Local-First Privacy

ApplyKit is built on a **local-first, user-controlled architecture**:
- **Zero Central Telemetry:** ApplyKit has no tracking servers, no external analytics SDKs (no Google Analytics, Segment, Mixpanel, or PostHog), and no crash-reporting telemetry (no Sentry).
- **Local Storage Exclusivity:** All candidate data—including your name, contact details, work authorization, resume documents, extracted evidence items, verified claims, saved answers, cached job postings, and application history—is stored exclusively on your local machine using standard browser storage mechanisms (`IndexedDB` and `chrome.storage.local`).
- **Zero Monetization:** We do not sell, rent, monetize, or broker personal data to advertisers, recruiters, or data brokers.

---

## 2. Information Handled by the Extension

### A. Candidate Profile & Evidence Graph
When you use ApplyKit, you may enter or import:
- **Identity Information:** Legal name, preferred name, email address, phone number, location (city/country).
- **Work Authorization Details:** Work authorization status, visa requirements, and country authorizations.
- **Career & Evidence History:** Resume text, work experience bullets, projects, education, certifications, and skills.
- **Application History:** Job descriptions, application dates, and answers to custom questionnaire prompts.

**Storage Location:** Stored locally in your browser’s `IndexedDB` database (`applykit_db`).

### B. AI Provider Credentials
To utilize AI assistance (e.g. requirement matching or cover letter generation), you may configure personal API keys for third-party providers (OpenAI, Anthropic, Google Gemini, or OpenRouter).

**Storage Location & Security:**
- Keys are encrypted using Web Crypto AES-GCM with PBKDF2 key derivation.
- Keys reside exclusively inside the Extension Service Worker background context (`chrome.storage.local`).
- **Credential Isolation Guarantee (ADR-0002):** Host webpages, third-party scripts, and extension content scripts have **zero access** to your API keys.

---

## 3. Communication with External Services

ApplyKit communicates with external services under only two circumstances:

1. **Active Job Webpages (Local DOM Access Only):**
   - When you view a job posting or application form, ApplyKit inspects the page's HTML structure locally within your browser to identify job requirements and interactive form fields.
   - Webpage content is processed locally and is never uploaded to any central server.

2. **User-Initiated AI Requests:**
   - When you explicitly request AI extraction, matching, tailoring, or question answering, ApplyKit sends a scoped context payload directly from your browser to the AI provider you have selected (OpenAI, Anthropic, Google Gemini, or OpenRouter) using your own API key.
   - **Focused Scoping Invariant (ADR-0005):** Outbound payloads contain only the minimal information required for that specific operation (e.g. the job description text and relevant experience bullets). Personal demographics (EEO-1 disclosures) are processed locally and are **never** transmitted to external AI models.

---

## 4. Anti-Autonomous Submit Guarantee

ApplyKit operates under a non-negotiable safety invariant:

> **The AI proposes. The application validates. The user decides. The browser executes.**

ApplyKit is programmatically forbidden from clicking application submission buttons (`type="submit"`, buttons labeled "Submit", "Apply", etc.). The system halts before submission, requiring that you personally review all filled fields and manually submit your application.

---

## 5. Right to Erasure ("Right to be Forgotten")

In compliance with GDPR (Article 17) and CCPA, ApplyKit provides a complete, one-click Right to Erasure mechanism:
- Navigating to **Settings ➔ Privacy & Right to Erasure** and clicking **Purge All Data** permanently erases:
  1. All records across all IndexedDB object stores (`candidate_profiles`, `evidence_items`, `candidate_claims`, `job_postings`, `application_records`).
  2. The local database file (`applykit_db`).
  3. All extension-local settings and encrypted API credentials from `chrome.storage.local`.
- No residual traces, backups, or shadow copies remain on your computer or any external server.

---

## 6. Permissions Justification

ApplyKit requests only the minimum Chrome permissions necessary to function:
- **`sidePanel`**: Allows rendering the copilot interface in Chrome's native Side Panel adjacent to application forms.
- **`storage`**: Allows persisting candidate data locally in `IndexedDB` and `chrome.storage.local`.
- **`activeTab`**: Allows reading the active job posting HTML and filling application fields only when you actively use the extension on that tab.
- **`scripting`**: Allows executing deterministic, user-approved form-filling actions on the active application page.

ApplyKit **does not** request background tabs surveillance, cookies, web request interception (`webRequestBlocking`), or broad cross-site network inspection.

---

## 7. Changes to this Policy

Because ApplyKit operates locally without tracking servers, any updates to this privacy policy will be included directly in extension release notes and published in the repository.

---

## 8. Contact & Open Source Verification

ApplyKit is an open-source project. You can inspect our full source code, Content Security Policy, and storage architecture at:
[https://github.com/jephter-olamiposi/applyKit](https://github.com/jephter-olamiposi/applyKit)
