# ApplyKit

A Chrome extension that helps you apply for jobs without making things up.

ApplyKit reads a job posting, tailors your resume and cover letter to it using only what your resume already says, fills the application form, and keeps track of where every application stands. You stay in control the whole way: it never presses Submit, and every answer it writes can be traced back to a line in your resume.

Everything is stored in your browser. An AI key is optional.

## What it does

| Step | Where | What happens |
|---|---|---|
| 1. Set up once | Setup | Upload your resume (PDF, Word or text). ApplyKit reads your jobs, bullets, projects, skills and education into a profile you can check and edit. |
| 2. Read the job | **Job** tab | Pulls the title, company and requirements from the posting, then shows how well you match each requirement, based on what your resume shows. |
| 3. Tailor your resume | **Resume** tab | Picks and orders your own bullets for this job and writes a short summary from them. Download as PDF or Word. With an AI key, **Reword with AI** rewrites lines in the job's language and refuses any line that adds a number, tool or name you did not write. |
| 4. Write a cover letter | **Resume** tab | Built from your strongest lines for this job, in plain first person. |
| 5. Fill the application | **Apply** tab | Scans the form, shows what it will put in each field, and fills it. Open questions ("Why do you want to work here?") are drafted from your resume plus facts about the company. You check everything and press Submit yourself. |
| 6. Track it | **Tracker** tab | Every filled application lands under "To submit". Mark it submitted, move it through interviews and offers, keep recruiter notes, and open interview prep built from your resume. |

Each screen ends with a **Next** card, so you always know where to go from a finished step.

## How it stays honest

- **Nothing is invented.** Resume bullets are your own lines, chosen and ordered. AI rewording is checked line by line: a reworded bullet may not add a number, tool or name its original did not have.
- **Answers are checked before you see them.** Every number, tool and company name in a drafted answer must appear in your resume, the job posting, or the facts found about the company. A sentence that fails is cut. A draft that still fails is shown with what to fix, and is never filled into a form automatically.
- **Company research is factual.** For "why us" questions, ApplyKit reads the company's own website and, with a Gemini key, runs a Google search through Gemini. Answers must name something specific about the company, and you can see where each fact came from.
- **It never submits.** Filling stops before the Submit button. Work permit, visa and demographic questions always need your tick.

## Privacy

- Your profile, resume, jobs and applications are stored in your browser (IndexedDB). Nothing is sent to ApplyKit.
- AI keys are encrypted at rest (AES-GCM) and only used by the extension's service worker. Web pages and content scripts never see them.
- When you use AI features, your resume lines and the job posting go to the provider you chose. Company research sends only the company name and role.
- **Settings** lets you download a backup, copy a local log of recent AI drafts for troubleshooting, or delete everything.

## Install

### Use the built extension

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Press **Load unpacked** and pick the `ApplyKit-extension` folder (or `apps/extension/dist` after a build).
3. Open any job posting and click the ApplyKit icon to open the side panel.

After updating the code, press the reload icon on ApplyKit in `chrome://extensions`, then refresh any job pages that were already open.

### Add an AI key (optional)

ApplyKit works without one. A key turns on drafted answers, AI rewording and company web search.

1. Make a free key at [Google AI Studio](https://aistudio.google.com/app/apikey). OpenAI, Anthropic and OpenRouter keys also work.
2. In ApplyKit, open **Settings**, pick the provider, paste the key and press **Check and save**. ApplyKit checks the key with the provider before saving it, and shows "Works", "Rejected" or "Out of quota".

Note that Google may use requests on Gemini's free tier to improve its products. Set up billing on the key's project if you would rather it did not.

## Develop

Requires Node.js 20 or later.

```bash
npm ci            # install
npm run build     # type-check and build the extension into apps/extension/dist
npm test          # run the test suite (Vitest)
npm run package   # build a store-ready zip in dist-release/
```

### Live tests against a real AI provider

These are skipped unless you provide your own key, and nothing is saved.

```bash
# Drafts four real application questions with your resume and reports what the checker found
GEMINI_TEST_KEY=your-key APPLYKIT_RESUME=/path/to/resume.txt \
  npx vitest run apps/extension/src/__tests__/live/answer-eval.test.ts
```

## Project layout

```
apps/extension/            Chrome MV3 extension
  src/background/          Service worker: storage, AI gateway, drafting, form planning
  src/content/             Content script: reads jobs and forms, fills fields, in-page "Fill this form" bar
  src/sidepanel/           React side panel: Job, Resume, Apply, Tracker, Profile, Settings
  src/ai/                  AI providers, key check, company research
  src/storage/             IndexedDB repositories, encrypted key store, backup and erase
  src/messages/            Typed messages between the side panel, service worker and pages
packages/domain/           Pure TypeScript domain logic, no browser APIs
  src/evidence/            Resume parsing, evidence lines and claims
  src/job/                 Job postings, requirement matching, gap analysis, sourcing
  src/tailoring/           Resume tailoring, cover letters, PDF and Word export, writing checks
  src/ai/                  Prompt building, answer coaching and checking, resume rewording
  src/form/                Field classification and the fill plan
  src/application/         Application tracking state machine
docs/                      Architecture, security, privacy and design decisions
scripts/                   Packaging and icon generation
```

## How it fits together

```
 Side panel (React)  ──messages──▶  Service worker  ──▶  AI provider (optional)
        ▲                               │    │
        │                               │    └──▶  IndexedDB + encrypted key store
        │                               ▼
        └──────────────  Content script on the job page (reads, fills, never submits)

 All decisions (matching, tailoring, checking, planning) live in @applykit/domain.
```

- The **service worker** owns all storage and every network call. It is the only place that holds API keys.
- The **content script** runs on job pages. It reads postings and forms and fills fields it is told to. It works across frames, so an embedded form or a captcha box does not confuse it.
- The **side panel** is the interface. It talks to the service worker through typed, validated messages.
- **`@applykit/domain`** holds the logic as pure functions, so it is tested without a browser.

## Design rules

1. Every claim traces to a line in the candidate's resume.
2. API keys never leave the service worker.
3. The extension never clicks Submit.
4. AI returns data, never code. Page text is treated as data, never as instructions.
5. Candidate data stays local.

Design decisions and their reasons are recorded in [`docs/decisions.md`](docs/decisions.md).

## Docs

- [`docs/architecture.md`](docs/architecture.md): contexts, messages and storage
- [`docs/security.md`](docs/security.md): threat model, key handling, prompt injection
- [`docs/privacy.md`](docs/privacy.md) and [`docs/privacy-policy.md`](docs/privacy-policy.md): what is stored and what leaves the browser
- [`docs/decisions.md`](docs/decisions.md): architecture decision records
- [`docs/store-listing.md`](docs/store-listing.md) and [`docs/cws-submission-kit.md`](docs/cws-submission-kit.md): Chrome Web Store material

## License

MIT
