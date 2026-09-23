# ApplyKit — Remaining Work Plan

Generated: 2025-09-22

---

## Executive Summary

Core product: **Complete** (300 tests pass, all ADRs implemented, extension packages).

Remaining gaps fall into 3 categories:
1. **Integration validation** — Real-site testing (not unit fixtures)
2. **Release infrastructure** — CI, Playwright E2E, store assets
3. **Feature enhancements** — PDF export, AI quality improvements

---

## Phase A: Real-World Integration Validation (Weeks 1-2)

### A.1 Real HTML Fixture Corpus
**Goal:** Validate extraction & field detection on 20+ real job pages

| Task | Details |
|------|---------|
| Collect fixtures | Save 20+ job pages (HTML + metadata) from: Greenhouse, Lever, Ashby, Workday, iCIMS, SmartRecruiters, generic career pages |
| Store in repo | `apps/extension/src/__tests__/fixtures/real-jobs/{ats}/{company-role}.html` + `.json` expected output |
| Add test suite | `extraction-real.test.ts` / `form-detection-real.test.ts` — run against fixtures, assert >95% field accuracy |
| CI integration | Run on every PR |

### A.2 Live Multi-Page ATS Testing
**Goal:** Verify Workday/Greenhouse wizard navigation, auth barriers, custom comboboxes

| Task | Details |
|------|---------|
| Test accounts | Create test accounts on Workday demo, Greenhouse demo, Lever demo |
| Playwright scripts | `tests/e2e/ats-workday.spec.ts`, `ats-greenhouse.spec.ts`, `ats-lever.spec.ts` |
| Scenarios | Login → multi-step wizard → custom dropdowns → EEO → file upload → review → submit gate |
| Assertions | All fields filled, no honeypot triggers, submit gate enforced |

### A.3 Cross-Browser Smoke Test
- Test in Chrome, Edge, Brave (Chromium-based)
- Verify side panel, content script injection, storage

---

## Phase B: Release Infrastructure (Weeks 2-3)

### B.1 CI/CD Pipeline (GitHub Actions)
```yaml
# .github/workflows/ci.yml
- Build & typecheck (npm run build)
- Unit tests (npm test)
- Lint (eslint, prettier)
- Package extension (npm run package)
- Upload artifact: applykit-extension-v{version}.zip
```

### B.2 Playwright E2E Suite
```typescript
// tests/e2e/full-journey.spec.ts
test('complete candidate journey', async () => {
  // 1. Onboarding → profile + resume ingest
  // 2. Job extraction on real page
  // 3. Match analysis
  // 4. Form inspection → dry run → execution
  // 5. Anti-submit gate verification
  // 6. Tracker confirmation + audit export
  // 7. Tailoring studio → PDF export
  // 8. Purge all data
});
```
- Run in headed + headless mode
- Screenshots on failure
- Run nightly + on PR

### B.3 Chrome Web Store Package
| Asset | Status |
|-------|--------|
| 128x128, 440x280, 1400x560 screenshots | ❌ Need to create |
| Privacy policy (GDPR/CCPA) | ❌ Need to write |
| Store description (132 chars) | ✅ In manifest |
| Developer dashboard setup | ❌ Manual |

---

## Phase C: PDF Export for Resume & Cover Letter (Week 1)

### C.1 Add PDF Generation
**Location:** `packages/domain/src/tailoring/exporters.ts` + new `pdf-exporter.ts`

```typescript
// New exports
export async function exportTailoredResumeAsPdf(
  tailored: TailoredResume,
  options: { fontSize?: number; margins?: Margins }
): Promise<Uint8Array>

export async function exportCoverLetterAsPdf(
  letter: CoverLetter,
  options: PdfOptions
): Promise<Uint8Array>
```

**Library:** `@react-pdf/renderer` (works in browser, no Node deps)
- Already used in extension context (no fs, no native modules)
- Bundle size: ~40 KB gzipped

### C.2 Side Panel Integration
- **TailoringStudio.tsx** → Add "Download PDF" buttons next to "Copy Markdown"
- Show preview before download
- Filename: `Resume_{Company}_{Role}.pdf` / `CoverLetter_{Company}_{Role}.pdf`

### C.3 PDF Styling
- Professional layout: header (name, contact), sections, bullets
- Cover letter: business letter format
- Font: system fonts (no external font loading)
- ATS-friendly: simple structure, no columns/graphics

---

## Phase D: AI Quality Improvements (Weeks 2-3)

### D.1 Why RAG_Techniques Is Not the Answer

| RAG_Techniques | ApplyKit |
|----------------|----------|
| Retrieves from large external corpus | Candidate evidence is small (resume ~5 KB) |
| Semantic search + top-k | Deterministic evidence graph (exact claim→evidence links) |
| Post-hoc citation checking | Pre-generation grounding (zero claims without evidence) |
| General QA over docs | Specific sub-tasks: field answering, tailoring, fact-check |

**ApplyKit's architecture already exceeds RAG for this use case.** The "not smart enough" issues are likely:

1. **Prompt quality** — scoped context missing key evidence
2. **Model choice** — using weaker model (Haiku vs Sonnet, Flash vs Pro)
3. **Few-shot examples** — no examples in prompts
4. **Schema enforcement** — JSON parsing failures silently degrade output

### D.2 Concrete AI Improvements

| Improvement | File | Effort |
|-------------|------|--------|
| **Add few-shot examples** to all builders (`builders.ts`) | `packages/domain/src/ai/builders.ts` | Low |
| **Upgrade default model** — Sonnet 3.5 / GPT-4o / Gemini 1.5 Pro | `apps/extension/src/ai/gateway.ts` | Low |
| **Add chain-of-thought** to field answering & tailoring prompts | `builders.ts` | Medium |
| **Validate JSON schema strictly** — reject & retry on parse failure | `providers/*`, `builders.ts` | Medium |
| **Evidence ranking** — send top-5 most relevant claims (not all) | `buildFieldAnsweringPrompt` | Low |
| **Temperature tuning** — 0.1 for extraction, 0.3 for tailoring | `builders.ts` | Low |

### D.3 Smartness Benchmark
Create `tests/ai-quality.spec.ts`:
```typescript
// Real prompts + expected outputs
// Score: factual accuracy, grounding, tone, completeness
// Run against all 4 providers, pick best default per task
```

---

## Phase E: Code Completeness Audit (Week 1)

### E.1 Missing/Incomplete Components

| Component | Status | Action |
|-----------|--------|--------|
| `packages/domain/src/tailoring/pdf-exporter.ts` | ❌ Missing | Create (Phase C) |
| `apps/extension/src/sidepanel/components/TailoringStudio.tsx` PDF buttons | ❌ Missing | Add (Phase C) |
| `apps/extension/src/__tests__/fixtures/real-jobs/` | ❌ Missing | Collect (Phase A.1) |
| `tests/e2e/` Playwright suite | ❌ Missing | Create (Phase B.2) |
| `.github/workflows/ci.yml` | ❌ Missing | Create (Phase B.1) |
| Privacy policy | ❌ Missing | Write (Phase B.3) |
| Store screenshots | ❌ Missing | Capture (Phase B.3) |
| `packages/domain/src/ai/builders.ts` few-shot examples | ⚠️ Partial | Enhance (Phase D.2) |
| `apps/extension/src/ai/gateway.ts` model defaults | ⚠️ Weak models | Upgrade (Phase D.2) |

### E.2 TypeScript Strictness
```bash
# Already clean — zero errors
npm run build
```

### E.3 Unused/Dead Code
```bash
# Check
npx ts-prune
# Remove any dead exports
```

---

## Phase F: Polish & Edge Cases (Week 3)

| Item | Details |
|------|---------|
| **Keyboard shortcuts** | `Cmd+Shift+A` open side panel, `Cmd+Enter` execute plan |
| **Offline indicator** | Show banner when no API keys configured |
| **Import/export validation** | Schema check on backup import, friendly errors |
| **Large resume handling** | Chunk PDF parsing, progress indicator |
| **Error boundaries** | React error boundaries in side panel components |
| **Accessibility** | ARIA labels, focus management, color contrast |
| **Performance** | Lazy-load heavy components (TailoringStudio, Tracker) |

---

## Dependency Graph

```
A.1 (fixtures) → A.2 (live ATS) → B.2 (Playwright E2E)
                                    ↓
C.1 (PDF) → C.2 (UI) → B.3 (store screenshots)
                                    ↓
D.2 (AI quality) → B.2 (E2E validates)
                                    ↓
E.1 (code audit) → B.1 (CI runs all)
```

---

## Timeline

| Week | Focus | Deliverables |
|------|-------|--------------|
| 1 | A.1, C.1, C.2, E.1 | Real fixtures, PDF export, code audit |
| 2 | A.2, D.2, B.1 | Live ATS tests, AI upgrades, CI pipeline |
| 3 | B.2, B.3, F | Playwright E2E, store assets, polish |

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Workday demo account unavailable | Medium | High | Use public Workday sandbox + mock where needed |
| PDF bundle size too large | Low | Medium | `@react-pdf/renderer` is tree-shakeable; test bundle |
| AI quality plateau | Medium | Medium | Benchmark across providers; accept "good enough" for v1 |
| Chrome Web Store review rejection | Low | High | Follow CSP, privacy policy, no remote code strictly |

---

## Quick Wins (Do First — < 1 day each)

1. ✅ Fix manifest `host_permissions` — **DONE**
2. Add few-shot examples to `buildFieldAnsweringPrompt`
3. Upgrade default model to Sonnet 3.5 / GPT-4o
4. Create `pdf-exporter.ts` with `@react-pdf/renderer`
5. Add "Download PDF" buttons to TailoringStudio
6. Collect 5 real job HTML fixtures (start small)
7. Write `.github/workflows/ci.yml`

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Real fixture extraction accuracy | >95% |
| Multi-page ATS fill success | >90% |
| Playwright E2E pass rate | 100% on main branch |
| PDF generation time | <2 sec |
| AI grounding score (fact-check) | >90% on benchmarks |
| Bundle size (with PDF) | <200 KB gzipped |
| Chrome Web Store approval | First submit |

---

## Notes on RAG_Techniques Repo

**Do not integrate.** The NirDiamant/RAG_Techniques repo contains patterns for:
- Document chunking + embedding + vector search
- Retrieval + reranking + generation
- Multi-hop reasoning over large corpora

**ApplyKit's evidence system is fundamentally different:**
- Evidence = atomic resume bullets (already chunked)
- Claims = explicit links to evidence (already grounded)
- Context = scoped to single field/requirement (already minimal)
- Hallucination prevention = structural (impossible by design)

The repo is valuable for *learning prompt patterns* (few-shot, CoT, self-consistency) — apply those to `builders.ts`, not the architecture.