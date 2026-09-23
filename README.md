# ApplyKit

A local-first, user-controlled job application copilot built as a Chrome Manifest V3 extension.

## Overview

ApplyKit assists candidates with real job applications by extracting job postings, matching against a verified candidate profile, preparing tailored materials, and safely filling application forms while keeping the user in complete control.

**The AI proposes. The application validates. The user decides. The browser executes.**

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Chrome Extension (MV3)                     │
├─────────────────┬─────────────────────┬─────────────────────────┤
│  Service Worker │  Content Script     │  Side Panel (React)     │
│  (Background)   │  (Isolated World)   │                         │
├─────────────────┼─────────────────────┼─────────────────────────┤
│ • API gateway   │ • DOM extraction    │ • Job overview          │
│ • Secure key    │ • Action execution  │ • Match review          │
│   storage       │   (interpreter)     │ • Fill / submit actions │
└─────────────────┴─────────────────────┴─────────────────────────┘
                              │
                              ▼
                    ┌───────────────────┐
                    │  @applykit/domain │  (zero-dependency)
                    ├───────────────────┤
                    │ • CandidateProfile│
                    │ • EvidenceGraph   │
                    │ • JobPosting      │
                    │ • Form / Actions  │
                    │ • AI contexts     │
                    └───────────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
       IndexedDB                         chrome.storage.local
  (profile, evidence,                    (encrypted provider
   jobs, applications)                    keys, settings)
```

## Non-Negotiable Invariants

1. **Zero Hallucination** — All claims backed by the `EvidenceGraph`. Missing evidence = flagged gap.
2. **API Key Isolation** — Keys never leave the Service Worker. Content scripts and web pages never receive keys or make external AI calls.
3. **Submission Hard Gate** — Extension cannot click submit buttons. Execution halts at `awaiting_user_review`; candidate manually submits.
4. **Deterministic Browser Actions** — AI outputs structured intent (`BrowserAction`), never executable code. All DOM operations go through a typed interpreter.
5. **Prompt Injection Defense** — Third-party content wrapped in strict XML delimiters; JSON Schema validation on model outputs.
6. **Local-First Privacy** — All candidate data stored locally. Outbound AI payloads use focused contexts with minimal required information.
7. **Production Code Only** — No stubs, mocks, or placeholder branches in production paths.

## Tech Stack

- **Language**: TypeScript (strict), ES2022
- **Extension**: Chrome MV3, Service Worker, Content Scripts, Side Panel API
- **UI**: React, Vite, Tailwind CSS
- **Persistence**: IndexedDB, `chrome.storage.local` (encrypted keys)
- **Testing**: Vitest (311 tests, deterministic + live AI)
- **AI Providers**: OpenAI, Anthropic, Gemini, OpenRouter (configurable)

## Project Structure

```
applykit/
├── apps/
│   └── extension/              # Chrome MV3 extension
│       ├── background/         # Service worker (API gateway, key storage)
│       ├── content/            # Content script (DOM extraction, interpreter)
│       ├── sidepanel/          # React side panel
│       └── settings/           # Settings page (profile editor, API keys)
├── packages/
│   └── domain/                 # @applykit/domain (pure TS)
│       ├── src/candidate/      # Profile, Identity, Experience, Skills
│       ├── src/evidence/       # Evidence, Claims, EvidenceGraph
│       ├── src/job/            # JobPosting, Requirements, Evaluation
│       ├── src/form/           # ApplicationField, BrowserAction, Planner
│       ├── src/application/    # Application state machine
│       └── src/ai/             # AIProvider, Contexts, Prompt sanitization
└── docs/
    ├── plan.md                 # 16-phase implementation roadmap
    ├── architecture.md         # Context boundaries & message passing
    ├── domain-model.md         # Entity specifications
    ├── security.md             # Threat model, key isolation, injection defense
    ├── privacy.md              # Local-first persistence, context scoping
    └── decisions.md            # Architecture Decision Records
```

## Quick Start

```bash
# Install dependencies
npm ci

# Build extension
npm run build

# Package for Chrome Web Store
npm run package

# Run tests (deterministic)
npm test

# Run live AI tests (requires GEMINI_TEST_KEY)
GEMINI_TEST_KEY=<key> npx vitest run apps/extension/src/__tests__/live/
```

Load the unpacked extension from `apps/extension/dist` at `chrome://extensions`.

## Configuration

1. Open the side panel on any job posting
2. Click **Settings** → enter your AI provider API key(s)
3. Complete your candidate profile (identity, experience, skills, saved answers)
4. On a job page, open the side panel → **Extract & Analyze Job**
5. Review match / gap analysis → **Prepare Application**
6. Review filled form → manually submit

## Testing

```bash
# Full suite (311 tests)
npm test

# Deterministic unit / integration only
npx vitest run --exclude **/live/**

# Live AI verification (real Gemini, real Tether fixture)
GEMINI_TEST_KEY=<key> npx vitest run apps/extension/src/__tests__/live/
```

## Security

- Keys encrypted at rest via Web Crypto API (AES-GCM, PBKDF2)
- No telemetry, no external dependencies beyond chosen AI provider
- All network requests user-initiated and visible in DevTools

## License

MIT