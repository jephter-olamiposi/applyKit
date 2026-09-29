# ApplyKit — Chrome Web Store (CWS) Submission & Publishing Kit

This document provides the complete, copy-paste-ready submission package for publishing ApplyKit on the Google Chrome Web Store Developer Dashboard.

---

## 1. Store Listing Metadata

| Field | Value | Notes / Constraints |
| :--- | :--- | :--- |
| **Extension Name** | `ApplyKit - Job Application Copilot` | Matches `manifest.json` (max 45 chars) |
| **Short Description** | `Local-first job application copilot. Extract jobs, match skills, tailor 1-page resumes, and auto-fill forms with safety gates.` | Exactly 126 characters (max 132 chars) |
| **Primary Category** | `Productivity` | Alternative: `Workflow & Planning` |
| **Language** | `English (United States)` | Default extension locale |
| **Pricing** | `Free` | Zero in-app purchases |
| **Distribution ZIP** | `dist-release/applykit-extension-v0.1.0.zip` | Built via `npm run package` (630 KB) |

---

## 2. Full Store Description (Copy & Paste)

```markdown
ApplyKit is a local-first, privacy-respecting browser extension that helps candidates find, tailor, and apply to jobs safely and effortlessly.

Built with an unwavering commitment to candidate privacy: your resume, job history, and credentials NEVER leave your machine without your explicit consent.

═══════════════════════════════════════════════════════
⭐ KEY FEATURES
═══════════════════════════════════════════════════════

⚡ 1-Click Form Auto-Fill & Anti-Autonomous Submit Gate
• Automatically detects and maps application form fields across Greenhouse, Lever, Ashby, Workday, Recruitee, and custom career portals.
• Auto-fills personal details, location, phone, work authorization, salary expectations, and links in seconds.
• Hard Safety Gate: Programmatically halts before the submit button so you remain in 100% control of final submission.

🎯 14-Point Resume Golden Standard Audit & 1-Page PDF Generator
• Audits resumes against executive recruiter standards: 792pt 1-page budget, target keywords, value-driven titles, strong action verbs, quantifiable metrics, and verified links.
• 1-Click deterministic polishing to eliminate typos, buzzwords, and first-person pronouns without inventing experience.
• Exports to 4 professional PDF themes: Modern Clean, Classic Executive, Minimalist ATS, and Compact 1-Pager.

⚡ Instant Q&A Copilot
• Encountered an uncaptured screening question? Paste it into the Instant Q&A Copilot.
• 0ms Offline Fast-Path: Answers factual profile questions (Country, State, Salary, Work Auth, Notice Period, URLs) instantly without an API key.
• Evidence-Grounded AI Synthesis: Choose your tone (STAR Method, Concise, Motivational, Bullets) and length limit.
• 1-Click "Save to Profile" teaches ApplyKit so future forms fill it automatically.

🔒 Local-First Privacy & Zero Telemetry
• All candidate profiles, evidence graphs, and application records stay in your local browser (IndexedDB).
• Zero central tracking servers, zero analytics beacons, zero remote profiling.
• 1-Click "Factory Reset / Right to Erasure" completely wipes all local data at any time.

═══════════════════════════════════════════════════════
🤖 DO I NEED AN API KEY?
═══════════════════════════════════════════════════════

NO! An API key is NOT required for core features:
• Form field detection & 1-click Auto-Fill: 100% Offline / Free
• Resume parsing & skill matching: 100% Offline / Free
• Factual Instant Q&A & saved answers: 100% Offline / Free

For open-ended generative writing (tailored cover letters and long behavioral essays), ApplyKit offers a 1-click link to Google Gemini Flash, which is 100% FREE with NO credit card required. You can also bring your own OpenAI, Anthropic, or OpenRouter keys.

═══════════════════════════════════════════════════════
🚀 HOW TO USE
═══════════════════════════════════════════════════════
1. Install ApplyKit and complete the 3-minute onboarding wizard.
2. Navigate to any job posting on Greenhouse, Lever, Workday, Ashby, or Recruitee.
3. Open the ApplyKit Side Panel:
   - Step 1 (Job & Fit): Extract posting and view qualification match score.
   - Step 2 (Tailor): Tailor your resume and generate an evidence-backed cover letter.
   - Step 3 (Auto-Fill): Click "1-Click Auto-Fill" to populate the application form.
   - Step 4 (Instant Q&A): Paste any custom questions for immediate grounded answers.
   - Step 5 (Tracker): Track your applications and export your audit logs to CSV.
```

---

## 3. Chrome Web Store Permission Justifications (For Reviewers)

Google requires explicit explanations for every permission declared in `manifest.json`:

| Permission | Justification Text for Google Review Team |
| :--- | :--- |
| **`activeTab`** | *"Used to inspect the DOM of the active job application webpage when the user explicitly opens the extension side panel. This allows ApplyKit to detect form input fields (name, email, work authorization, etc.) and extract job posting requirements for candidate review."* |
| **`storage`** | *"Used to persist the candidate's profile, evidence graph, and application history locally on the user's machine using `chrome.storage.local` and `IndexedDB`. No candidate data or credentials are ever sent to central ApplyKit servers."* |
| **`scripting`** | *"Used to execute declarative, typed `BrowserAction` commands (filling text, selecting dropdown options) and inject non-destructive visual highlight overlays onto the active job application form only upon the user's explicit interaction."* |
| **`sidePanel`** | *"Used to render the ApplyKit copilot interface (job requirements overview, dry-run safety preview, tailoring studio, and instant Q&A solver) in Chrome's native side panel alongside the job application page."* |

---

## 4. Privacy Practices Declarations

When completing the Chrome Web Store Privacy tab:

1. **Single Purpose**:
   > *"ApplyKit assists job applicants by parsing job postings, matching qualifications against local candidate profile data, and safely filling application form fields under human review."*

2. **Data Usage Checkboxes**:
   - **Personally Identifiable Information (PII)**: Yes (Name, email, phone, address, employment history).
     - *Declaration*: *"Stored exclusively locally on the user's device in IndexedDB. Used solely to assist the user with filling out job applications they choose to submit. Never sold, never transferred to third parties, and never sent to central analytics servers."*
   - **Health / Financial / Authentication Information**: No.
   - **Personal Communications / Web History**: No.
   - **User Activity (Clicks, Mouse position)**: No.

3. **Certification**:
   - Confirm that you do not sell user data.
   - Confirm that you do not use or transfer user data for purposes unrelated to the extension's single purpose.
   - Confirm that you do not use or transfer user data to determine creditworthiness or for lending purposes.

---

## 5. Visual Asset Specifications

| Asset | Dimensions | Status | File Location |
| :--- | :--- | :---: | :--- |
| **Small Extension Icon** | 16 × 16 px | ✅ Ready | `apps/extension/public/icons/icon-16.png` |
| **Medium Extension Icon** | 48 × 48 px | ✅ Ready | `apps/extension/public/icons/icon-48.png` |
| **Large Store Icon** | 128 × 128 px | ✅ Ready | `apps/extension/public/icons/icon-128.png` |
| **Small Promo Tile** | 440 × 280 px | 🟡 Required | Export from side panel screenshot (16:10) |
| **Marquee Promo Tile** | 1400 × 560 px | ⚪ Optional | Banner for featured extension placement |
| **Store Screenshots** | 1280 × 800 px (or 640 × 400 px) | 🟡 Minimum 1 | Capture Side Panel next to a real ATS form |

---

## 6. How to Submit the Extension

1. **Build Distribution Archive**:
   ```bash
   npm run package
   ```
   Output: `dist-release/applykit-extension-v0.1.0.zip`

2. **Open Chrome Developer Dashboard**:
   - Navigate to [https://chrome.google.com/webstore/devconsole/](https://chrome.google.com/webstore/devconsole/).
   - Pay the one-time $5 Google Developer registration fee (if new account).

3. **Upload Package**:
   - Click **"New Item"** -> Select `dist-release/applykit-extension-v0.1.0.zip`.

4. **Fill In Store Listing**:
   - Copy & paste metadata, short description, and full description from Sections 1 and 2 above.
   - Upload icon (128x128) and at least one 1280x800 screenshot.

5. **Fill In Privacy Tab**:
   - Copy & paste justifications from Section 3.
   - Paste link to your hosted privacy policy (e.g., `https://jephter-olamiposi.github.io/applyKit/privacy` or your repository privacy document).

6. **Submit for Review**:
   - Click **"Submit for Review"**. Google review typically takes 24–48 hours for extensions with standard permissions.
