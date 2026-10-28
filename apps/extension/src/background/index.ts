/**
 * @fileoverview Extension Service Worker (Background Script).
 *
 * Trusted execution core of the ApplyKit Chrome Extension.
 * Enforces critical security boundaries:
 * 1. Sole context holding API provider credentials (ADR-0002).
 * 2. Message router between Side Panel and isolated Content Scripts.
 * 3. Enforces that raw API keys are never forwarded to caller contexts.
 */

import type {
  AIProviderName,
  CandidateProfile,
  JobPosting,
  AIRequest,
  Requirement,
  DryRunPlan,
  DryRunAction,
  ActionId,
  ExecutionOptions,
  ExecutionReport,
  ApplicationRecord,
  ApplicationId,
  AiJobExtractionResult,
  FieldAnsweringContext,
  ApplicationAnswerInput,
  ResumeRewriteResult,
  AiProposedFieldAnswer,
  ApplicationField,
  ApplicationForm,
  SavedAnswer,
  AnswerCategory,
} from '@applykit/domain';
import {
  parsePlainTextResume,
  createProfileFromParsedResume,
  bootstrapProfileFromResume,
  deriveClaimsFromEvidence,
  buildEvidenceGraph,
  auditEvidenceGraphGrounding,
  evaluateJobRequirements,
  analyzeQualificationGaps,
  generateHighlightSuggestions,
  generateDryRunPlan,
  updatePlanActionValue,
  togglePlanActionApproval,
  excludePlanAction,
  approveAllLowRiskActions,
  approveAllActions,
  resetAllApprovals,
  createSelectiveDryRunPlan,
  createApplicationRecord,
  transitionApplicationRecord,
  isValidStateTransition,
  createApplicationId,
  createProfileId,
  createJobPostingId,
  createSavedAnswerId,
  createFieldId,
  matchSavedAnswer,
  exportAuditTrailAsJson,
  exportAuditTrailAsCsv,
  exportPipelineTrackerCsv,
  exportPipelineTrackerMarkdown,
  tailorCandidateResume,
  generateGroundedCoverLetter,
  factCheckTailoredDocument,
  auditResumeQuality,
  autoFixResumeQualityIssues,
  buildJobExtractionPrompt,
  buildRequirementMatchingPrompt,
  parseAndValidateJsonResponse,
  isAiJobExtractionResult,
  jobPostingFromAiExtraction,
  isDegenerateJobPosting,
  buildFieldAnsweringPrompt,
  buildResumeRewritePrompt,
  applyResumeRewrite,
  isResumeRewriteResult,
  isAiAnswerableCustomField,
  withAiProposedFieldAnswers,
  getWritingStyleFromProfile,
  resolveCustomFieldDeterministicValue,
  sanitizeHumanText,
  isAiFieldAnswerResult,
  generateResumeDocxBlob,
  generateCoverLetterDocxBlob,
  getStandardResumeFilename,
  getStandardCoverLetterFilename,
  serializePipelineProfileYaml,
  parsePipelineProfileYaml,
  normalizeGreenhouseJobs,
  normalizeAshbyJobs,
  normalizeLeverJobs,
  screenSourcedOpportunities,
  DEFAULT_WATCHLIST_COMPANIES,
  pickJobForPage,
  roleFromPageTitle,
  type SourcedOpportunity,
} from '@applykit/domain';
import { isValidExtensionRequest } from '../messages/contracts.js';
import { annotatePageWidgets, pickPageWidgetOption } from './page-widgets.js';
import { draftGroundedAnswer } from './grounded-answer.js';
import {
  PENDING_SIDEPANEL_TAB_KEY,
} from '../storage/storage-keys.js';

function isUnsupportedAcademicQuestion(question: string, profile: CandidateProfile): boolean {
  const normalized = question.toLowerCase();
  const academicTerms = /\b(jamb|utme|waec|neco|sat|act|ib|a[- ]levels?|gcse|matriculation|entrance exam|high school results?|secondary school results?)\b/i;
  if (!academicTerms.test(normalized)) return false;
  const asksForEvidence = /\b(score|grade|result|ranking|rank|award|distinction|performance|percentile|mark|rationale|evidence|select(?:ion|ions)?)\b/i.test(normalized);
  if (!asksForEvidence) return false;
  const savedAcademicAnswer = (profile.savedAnswers || []).some((answer) =>
    (academicTerms.test(answer.canonicalKey) || answer.promptPatterns.some((pattern) => academicTerms.test(pattern))) &&
    answer.answerText.trim().length > 0
  );
  return !savedAcademicAnswer;
}
import {
  generateCoverLetterPdfBlob,
  generateResumePdfBlob,
} from '@applykit/domain/pdf-exporter';

import type {
  CandidateProfileSummary,
  CurrentExtractionResponse,
  ExtractedPageData,
  ExtractJobResponse,
  GetApiKeysStatusResponse,
  GetCandidateProfileSummaryResponse,
  PingResponse,
  SetApiKeyResponse,
  GetCandidateProfileResponse,
  SaveCandidateProfileResponse,
  ExportProfileYamlResponse,
  ImportProfileYamlResponse,
  FetchAtsJobsRequest,
  FetchAtsJobsResponse,
  AtsSourceStatus,
  GetSourcedOpportunitiesResponse,
  HarvestPageLinksResponse,
  ListSavedJobsResponse,
  ListApplicationsResponse,
  GetApplicationDetailResponse,
  UpdateApplicationStatusRequest,
  UpdateApplicationStatusResponse,
  DeleteApplicationRecordResponse,
  ExportAuditLogRequest,
  ExportAuditLogResponse,
  ExportBackupResponse,
  ImportBackupResponse,
  PurgeAllDataResponse,
  IngestResumeResponse,
  GetEvidenceGraphResponse,
  AuditGroundingResponse,
  CompleteAiTaskResponse,
  GetTokenMetricsResponse,
  ResetTokenMetricsResponse,
  MatchJobRequirementsResponse,
  AiRequirementAnalysisResult,
  InspectPageFormsResponse,
  GenerateDryRunPlanResponse,
  AnswerCustomFieldsResponse,
  UpdatePlanActionResponse,
  TogglePlanActionApprovalResponse,
  ExcludePlanActionResponse,
  ExecutePlanResponse,
  ExecuteContentPlanRequest,
  ExecuteContentPlanResponse,
  BatchApprovePlanActionsResponse,
  ExecuteSelectiveActionResponse,
  GenerateTailoredResumeResponse,
  AutoFixResumeRequest,
  AutoFixResumeResponse,
  AnswerAdHocQuestionRequest,
  SaveReusableAnswerRequest,
  InsertTextIntoActiveElementRequest,
  AnnotatePageWidgetsResponse,
  RewordResumeWithAiRequest,
  CheckApiKeyRequest,
  CheckApiKeyResponse,
  GetKeyChecksResponse,
  KeyChecks,
  RewordResumeWithAiResponse,
  PickPageWidgetOptionResponse,
  ExecuteOneClickAutoFillRequest,
  ExecuteOneClickAutoFillResponse,
  GenerateCoverLetterResponse,
  GenerateCoverLetterPdfResponse,
  GenerateResumePdfResponse,
  GenerateCoverLetterDocxResponse,
  GenerateResumeDocxResponse,
  FactCheckDocumentResponse,
  GetStorageUsageResponse,
  BootstrapProfileFromResumeRequest,
  BootstrapProfileFromResumeResponse,
  CommitBootstrappedProfileRequest,
  CommitBootstrappedProfileResponse,
  SubmissionDetectedNotification,
  SubmissionDetectedResponse,
  OpenSidePanelTabResponse,
  SidePanelTabId,
} from '../messages/contracts.js';

import {
  processSubmissionDetection,
  isSubmissionConfirmationUrl,
} from './submission-detector.js';

import {
  IndexedDbProfileRepository,
  IndexedDbJobRepository,
  IndexedDbApplicationRepository,
  IndexedDbEvidenceRepository,
  exportCandidateBackup,
  importCandidateBackup,
  purgeAllCandidateData,
  getStorageUsageSummary,
  getApiKeysStatus,
  setApiKey,
  getRawApiKey,
} from '../storage/index.js';

import { AIGateway } from '../ai/gateway.js';
import { checkApiKey, type KeyCheckResult } from '../ai/key-check.js';
import { researchCompany, type CompanyBrief } from '../ai/company-research.js';
import type { DraftAttempt } from './grounded-answer.js';

/**
 * Encodes binary data as a base64 string in bounded chunks.
 *
 * Spreading a large Uint8Array directly into String.fromCharCode overflows the
 * engine's argument stack for PDF blobs that commonly exceed 100KB.
 */
export function encodeBytesToBase64(arrayBuffer: ArrayBuffer): string {
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// Storage keys for isolated credentials and session cache
const STORAGE_KEYS = {
  PROVIDER_KEYS: 'applykit_secure_provider_keys',
  CANDIDATE_PROFILE: 'applykit_candidate_profile',
  LAST_EXTRACTION: 'applykit_last_extraction',
  LAST_JOB_POSTING: 'applykit_last_job_posting',
  ACTIVE_DRY_RUN_PLAN: 'applykit_active_dry_run_plan',
  ACTIVE_FORM: 'applykit_active_form',
  SOURCED_OPPORTUNITIES: 'applykit_sourced_opportunities',
} as const;

let cachedSourcedOpportunities: SourcedOpportunity[] = [];

export const profileRepo = new IndexedDbProfileRepository();
export const jobRepo = new IndexedDbJobRepository();
export const appRepo = new IndexedDbApplicationRepository();
export const evidenceRepo = new IndexedDbEvidenceRepository();
export const aiGateway = new AIGateway();

/**
 * Configure Chrome Side Panel to open when user clicks the extension action icon in the toolbar.
 */
if (typeof chrome !== 'undefined' && chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => {
      console.error('Failed to set side panel behavior:', error);
    });
}

/**
 * Resolves the browser tab the side panel should attach to when the request does
 * not originate from a content script.
 */
async function resolveActiveTabId(): Promise<number | undefined> {
  if (typeof chrome === 'undefined' || !chrome.tabs?.query) return undefined;
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tabs[0]?.id;
}

/**
 * Opens the side panel on the requesting tab and records which tab it should show.
 *
 * `chrome.sidePanel.open` only succeeds while a user gesture is still active, so this
 * runs inline in the message handler instead of a deferred task. The destination is
 * handed to the panel through session storage because the panel may not exist yet
 * when this call is made.
 */
async function openSidePanelOnTab(
  tab: SidePanelTabId,
  requestingTabId: number | undefined
): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.sidePanel?.open) {
    throw new Error('Side panel API is unavailable');
  }

  const targetTabId = requestingTabId ?? (await resolveActiveTabId());
  if (typeof targetTabId !== 'number') {
    throw new Error('No active tab to attach the side panel to');
  }

  if (chrome.storage?.session) {
    await chrome.storage.session.set({
      [PENDING_SIDEPANEL_TAB_KEY]: { tab, requestedAt: Date.now() },
    });
  }

  await chrome.sidePanel.open({ tabId: targetTabId });
}

/**
 * In-memory extraction cache indexed by tab ID.
 *
 * Prevents the side panel from showing a posting extracted on a different tab.
 */
const tabExtractionCache = new Map<number, { data: ExtractedPageData; jobPosting: JobPosting | null }>();

/**
 * In-memory cache holding the currently planned DryRunPlan for active candidate review.
 *
 * MV3 service workers are ephemeral, so the plan is mirrored to chrome.storage.local
 * after every mutation and rehydrated on wake (GET_ACTIVE_PLAN / execution paths).
 */
let activeDryRunPlan: DryRunPlan | null = null;

/** Mirrors the current plan to durable storage so it survives service-worker suspension. */
function persistActivePlan(): void {
  void chrome.storage.local.set({ [STORAGE_KEYS.ACTIVE_DRY_RUN_PLAN]: activeDryRunPlan });
}

/** Rehydrates the plan from storage when the service worker was suspended since generation. */
async function loadActivePlanFromStorage(): Promise<void> {
  if (activeDryRunPlan) return;
  const data = await chrome.storage.local.get(STORAGE_KEYS.ACTIVE_DRY_RUN_PLAN);
  const stored = data[STORAGE_KEYS.ACTIVE_DRY_RUN_PLAN];
  activeDryRunPlan = stored && typeof stored === 'object' ? (stored as DryRunPlan) : null;
}

/**
 * Retrieves candidate profile summary for Side Panel UI display.
 */
export async function getProfileSummary(): Promise<CandidateProfileSummary> {
  return profileRepo.getProfileSummary();
}

/**
 * Safely resolves the currently active webpage tab for sidepanel and background actions.
 * Prefers lastFocusedWindow, then currentWindow, and falls back to open web tabs if the focused tab is an internal or side panel view.
 */
async function getActiveWebTab(): Promise<chrome.tabs.Tab | null> {
  if (typeof chrome === 'undefined' || !chrome.tabs) return null;
  try {
    const [lastFocused] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (lastFocused && lastFocused.id && lastFocused.url && !isRestrictedTabUrl(lastFocused.url)) {
      return lastFocused;
    }
    const [current] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (current && current.id && current.url && !isRestrictedTabUrl(current.url)) {
      return current;
    }
    // Fallback: look for an active non-restricted tab across any window
    const allActive = await chrome.tabs.query({ active: true });
    const activeWeb = allActive.find((t) => t.url && !isRestrictedTabUrl(t.url));
    if (activeWeb && activeWeb.id) return activeWeb;

    // Fallback: find any tab currently open with http or https URL
    const allTabs = await chrome.tabs.query({});
    const webTab = allTabs.find((t) => t.url && (t.url.startsWith('http://') || t.url.startsWith('https://')));
    if (webTab && webTab.id) return webTab;

    return lastFocused || current || null;
  } catch {
    return null;
  }
}

/**
 * Checks whether the given tab URL is an internal browser page where content scripts cannot execute.
 */
function isRestrictedTabUrl(url: string): boolean {
  if (!url) return false;
  return (
    url.startsWith('chrome://') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('edge://') ||
    url.startsWith('about:') ||
    url.startsWith('view-source:') ||
    url.startsWith('https://chrome.google.com/webstore') ||
    url.startsWith('https://chromewebstore.google.com')
  );
}

/**
 * Dispatches a typed message to the webpage content script with programmatic injection and readiness polling.
 *
 * If content.js is not yet active (e.g. tabs opened before extension install/reload),
 * programmatically injects it and polls for PONG confirmation before sending the payload.
 */
async function sendToContentScriptWithFallback<TReq, TRes>(
  tabId: number,
  message: TReq,
  retries = 3
): Promise<TRes> {
  const trySendMessage = (): Promise<TRes> => {
    return new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
        } else {
          resolve(response as TRes);
        }
      });
    });
  };

  try {
    return await trySendMessage();
  } catch (initialErr) {
    if (!chrome.scripting) {
      throw initialErr;
    }

    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js'],
      });
    } catch (scriptErr) {
      const scriptErrMsg = scriptErr instanceof Error ? scriptErr.message : String(scriptErr);
      throw new Error(
        `Cannot inject ApplyKit script into this tab: ${scriptErrMsg}. If this tab was open before installing or reloading the extension, please refresh the webpage tab.`
      );
    }

    // Wait for content script to mount and attach listener
    for (let attempt = 0; attempt < retries; attempt++) {
      await new Promise((r) => setTimeout(r, 60 * (attempt + 1)));
      try {
        const pingPong = await new Promise<{ type: string }>((resolve, reject) => {
          chrome.tabs.sendMessage(tabId, { type: 'PING' }, (res) => {
            const err = chrome.runtime.lastError;
            if (err) reject(new Error(err.message));
            else resolve(res as { type: string });
          });
        });

        if (pingPong && pingPong.type === 'PONG') {
          return await trySendMessage();
        }
      } catch {
        // Continue retry loop
      }
    }

    try {
      return await trySendMessage();
    } catch {
      throw new Error(
        'Could not establish connection with this webpage. Please refresh the webpage tab and try again.'
      );
    }
  }
}

/**
 * Triggers job posting extraction on the currently active tab.
 */
export async function extractFromActiveTab(): Promise<ExtractJobResponse> {
  const activeTab = await getActiveWebTab();

  if (!activeTab || !activeTab.id) {
    return {
      type: 'EXTRACT_JOB_RESULT',
      success: false,
      error: 'No active browser tab found to extract from. Please select a job posting tab.',
    };
  }

  const tabId = activeTab.id;
  const tabUrl = activeTab.url || '';

  if (isRestrictedTabUrl(tabUrl)) {
    return {
      type: 'EXTRACT_JOB_RESULT',
      success: false,
      error: 'Cannot extract job postings from browser internal or Web Store pages. Please open an external job posting (e.g. Lever, Greenhouse, Workday, LinkedIn).',
    };
  }

  try {
    const response = await sendToContentScriptWithFallback<{ type: 'EXTRACT_JOB' }, ExtractJobResponse>(
      tabId,
      { type: 'EXTRACT_JOB' }
    );

    if (response && response.success && response.data) {
      return maybeAiRefineExtraction(tabId, tabUrl, response);
    }
    return response;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      type: 'EXTRACT_JOB_RESULT',
      success: false,
      error: `Extraction failed: ${msg}`,
    };
  }
}

/**
 * Persists a successful deterministic extraction (page data + posting) for later retrieval.
 */
async function commitExtraction(
  tabId: number,
  response: ExtractJobResponse
): Promise<ExtractJobResponse> {
  if (!response.success || !response.data) return response;
  tabExtractionCache.set(tabId, {
    data: response.data,
    jobPosting: response.jobPosting ?? null,
  });

  let committed = response;
  if (response.jobPosting) {
    // Re-extracting the same posting must update the existing record, not fork history.
    const existing = await jobRepo.getJobByUrl(response.jobPosting.url);
    const jobPosting = existing
      ? { ...response.jobPosting, id: existing.id }
      : response.jobPosting;
    await jobRepo.saveJob(jobPosting);
    committed = { ...response, jobPosting };
  }

  await chrome.storage.local.set({
    [STORAGE_KEYS.LAST_EXTRACTION]: response.data,
    ...(committed.jobPosting ? { [STORAGE_KEYS.LAST_JOB_POSTING]: committed.jobPosting } : {}),
  });
  return committed;
}

/**
 * Runs the LLM fallback extractor when deterministic extraction yields no usable job data.
 *
 * API Key Invariant: Executes only inside the background Service Worker (ADR-0002); the content
 * script never sees provider credentials. Failure degrades to the deterministic result rather
 * than failing the whole extraction.
 *
 * @param pageData Sanitized page data harvested by the content script.
 * @param tabUrl Source URL of the posting.
 * @returns A JobPosting when the LLM returned schema-valid data, otherwise null.
 */
async function runAiJobExtractionFallback(
  pageData: ExtractedPageData,
  tabUrl: string
): Promise<JobPosting | null> {
  const sourceText = (pageData.cleanBodyText || pageData.sanitizedXml || '').trim();
  if (sourceText.length < 40) {
    return null;
  }

  const request = buildJobExtractionPrompt({
    rawHtmlOrText: sourceText,
    pageUrl: tabUrl,
    pageTitle: pageData.title || pageData.ogTitle,
  });

  const response = await aiGateway.executeRequest(request);
  const parsed = parseAndValidateJsonResponse<AiJobExtractionResult>(response.rawText, isAiJobExtractionResult);

  if (!parsed.success || !parsed.data) {
    throw new Error(parsed.error || 'AI extraction returned malformed JSON.');
  }

  return jobPostingFromAiExtraction(parsed.data, tabUrl, sourceText);
}

/**
 * Attempts AI refinement for degenerate deterministic extractions, then commits and returns
 * the (possibly refined) response.
 *
 * Deterministic extraction stays authoritative whenever it produces usable requirements;
 * the LLM is only consulted to rescue empty signal when deterministic extraction yields insufficient content.
 */
async function maybeAiRefineExtraction(
  tabId: number,
  tabUrl: string,
  response: ExtractJobResponse
): Promise<ExtractJobResponse> {
  const deterministic = response.jobPosting;

  if (!deterministic || !isDegenerateJobPosting(deterministic)) {
    return commitExtraction(tabId, response);
  }

  try {
    const aiJob = await runAiJobExtractionFallback(response.data!, tabUrl);
    if (aiJob) {
      response.jobPosting = aiJob;
      response.aiRefined = true;
    } else {
      response.aiExtractionError = 'AI extraction produced no usable job data.';
    }
  } catch (err) {
    response.aiExtractionError = err instanceof Error ? err.message : String(err);
  }

  return commitExtraction(tabId, response);
}

/**
 * Triggers application form inspection on the active tab.
 */
/** Frames that only hold a captcha or a sign-in widget, never the application. */
const WIDGET_FRAME_HOST = /(^|\.)(google\.com|recaptcha\.net|hcaptcha\.com|challenges\.cloudflare\.com|gstatic\.com|youtube\.com|stripe\.com)$/i;

/**
 * Scans every frame with form fields separately and merges the forms, biggest first.
 * Returns null when per-frame scanning is not possible (no scripting access), so the
 * caller can fall back to a whole-tab message.
 */
async function inspectFormsPerFrame(tabId: number): Promise<InspectPageFormsResponse | null> {
  if (!chrome.scripting?.executeScript) return null;
  let frames: chrome.scripting.InjectionResult<{ fields: number; url: string }>[];
  try {
    frames = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => ({
        fields: document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]), textarea, select, [role=combobox]').length,
        url: location.href,
      }),
    });
  } catch {
    return null;
  }
  const candidates = frames
    .filter((frame) => (frame.result?.fields ?? 0) >= 2)
    .filter((frame) => {
      try {
        return frame.frameId === 0 || !WIDGET_FRAME_HOST.test(new URL(frame.result!.url).hostname);
      } catch {
        return frame.frameId === 0;
      }
    })
    .sort((a, b) => (b.result?.fields ?? 0) - (a.result?.fields ?? 0));
  if (candidates.length === 0) return null;

  const forms: ApplicationForm[] = [];
  for (const frame of candidates.slice(0, 4)) {
    const res = await new Promise<InspectPageFormsResponse | null>((resolve) => {
      chrome.tabs.sendMessage(tabId, { type: 'INSPECT_PAGE_FORMS' }, { frameId: frame.frameId }, (response) => {
        resolve(chrome.runtime.lastError ? null : (response as InspectPageFormsResponse));
      });
    });
    if (res?.success) forms.push(...res.forms);
  }
  if (forms.length === 0) return null;
  // The application is the form with the most fields; a captcha or newsletter box loses.
  forms.sort((a, b) => b.fields.length - a.fields.length);
  const best = forms[0]!.fields.length;
  return {
    type: 'INSPECT_PAGE_FORMS_RESULT',
    success: true,
    forms: forms.filter((form, index) => index === 0 || form.fields.length >= Math.min(4, best)),
  };
}

export async function inspectFormsFromActiveTab(): Promise<InspectPageFormsResponse> {
  const activeTab = await getActiveWebTab();

  if (!activeTab || !activeTab.id) {
    return {
      type: 'INSPECT_PAGE_FORMS_RESULT',
      success: false,
      forms: [],
      error: 'No active browser tab found to inspect forms on. Please click onto an application tab.',
    };
  }

  const tabId = activeTab.id;
  const tabUrl = activeTab.url || '';

  if (isRestrictedTabUrl(tabUrl)) {
    return {
      type: 'INSPECT_PAGE_FORMS_RESULT',
      success: false,
      forms: [],
      error: 'Cannot inspect application forms on browser internal or Web Store pages.',
    };
  }

  try {
    // Ask each frame that has fields, then put the biggest form first. Asking the whole
    // tab returned whichever frame answered first, which on Greenhouse was often the
    // two-field reCAPTCHA frame instead of the application.
    const perFrame = await inspectFormsPerFrame(tabId);
    if (perFrame) return perFrame;
    return await sendToContentScriptWithFallback<{ type: 'INSPECT_PAGE_FORMS' }, InspectPageFormsResponse>(
      tabId,
      { type: 'INSPECT_PAGE_FORMS' }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      type: 'INSPECT_PAGE_FORMS_RESULT',
      success: false,
      forms: [],
      error: `Form inspection failed: ${msg}`,
    };
  }
}

/**
 * Executes an approved DryRunPlan on the host webpage via the content script action interpreter.
 *
 * Invariant (ADR-0006): Application execution halts at awaiting_user_review before submit controls.
 *
 * @param plan Approved DryRunPlan to execute.
 * @param options Execution pacing and highlighting configuration.
 */
export async function executePlanOnActiveTab(
  plan: DryRunPlan,
  options?: ExecutionOptions
): Promise<ExecutePlanResponse> {
  const activeTab = await getActiveWebTab();

  if (!activeTab || !activeTab.id) {
    return {
      type: 'EXECUTE_PLAN_RESULT',
      success: false,
      error: 'No active browser tab found to execute actions on. Please select a job application tab.',
    };
  }

  const tabId = activeTab.id;
  const tabUrl = activeTab.url || '';

  if (isRestrictedTabUrl(tabUrl)) {
    return {
      type: 'EXECUTE_PLAN_RESULT',
      success: false,
      error: 'Cannot execute form actions on browser internal pages.',
    };
  }

  const payload: ExecuteContentPlanRequest = {
    type: 'EXECUTE_CONTENT_PLAN',
    plan,
    options,
  };

  try {
    const response = await sendToContentScriptWithFallback<ExecuteContentPlanRequest, ExecuteContentPlanResponse>(
      tabId,
      payload
    );

    return {
      type: 'EXECUTE_PLAN_RESULT',
      success: response.success,
      report: response.report,
      error: response.error,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      type: 'EXECUTE_PLAN_RESULT',
      success: false,
      error: `Action execution failed: ${msg}`,
    };
  }
}

/**
 * Automatically creates or updates an application journey when form actions are executed on an ATS form.
 *
 * Invariant (ADR-0006): Halts state at 'awaiting_user_review'. Never auto-submits.
 *
 * @param plan Active executed plan.
 * @param report Detailed execution report from the content script interpreter.
 */
export async function recordApplicationExecution(
  plan: DryRunPlan,
  report: ExecutionReport
): Promise<void> {
  try {
    const profile = await profileRepo.getProfile();
    // The job this form is for, not just the last one read: tailoring for Monzo, then
    // Mercury, then applying to Monzo must log a Monzo application.
    const forPage = await jobForFormPage(plan.formUrl || '', plan.formPageTitle);
    const job = forPage.job ?? undefined;

    const companyName = job?.companyName || forPage.companyLabel || plan.detectedAts.toUpperCase();
    const jobTitle = job?.title || roleFromPageTitle(plan.formPageTitle ?? '') || 'Job application';
    const jobPostingUrl = plan.formUrl || job?.url || '';
    const matchedRequirementsScore = job && profile && job.requirements.length > 0
      ? evaluateJobRequirements(job.requirements, profile).overallMatchScore / 100 // records store 0..1
      : 0;

    // Check if an existing application record exists for this job
    let app: ApplicationRecord | null = null;
    if (job?.id) {
      app = await appRepo.getApplicationByJobId(job.id);
    }
    if (!app && !job && jobPostingUrl) {
      // No saved job for this form: filling it twice must update one record, not add two.
      app = (await appRepo.listApplications(200)).find((record) => record.jobPostingUrl === jobPostingUrl) ?? null;
    }

    const filledMap: Record<string, string> = { ...(app?.filledValues || {}) };
    for (const action of plan.actions) {
      if (report.executedActionIds.includes(action.id)) {
        const key = action.action.description || action.action.selector;
        filledMap[key] = action.candidateValueUsed;
      }
    }

    if (app) {
      let updated = app;
      if (isValidStateTransition(updated.currentStatus, 'executing_actions')) {
        updated = transitionApplicationRecord(updated, 'executing_actions', 'Executing form filling plan');
      }
      updated = transitionApplicationRecord(
        updated,
        'awaiting_user_review',
        `Executed ${report.executedCount} field actions. Awaiting user review before manual submission.`,
        {
          filledFieldsCount: Object.keys(filledMap).length,
          filledValues: filledMap,
          dryRunLog: [...plan.actions],
        }
      );
      await appRepo.saveApplication(updated);
    } else {
      const newApp = createApplicationRecord({
        id: createApplicationId(),
        candidateProfileId: profile?.id || createProfileId(),
        jobPostingId: job?.id || createJobPostingId(),
        companyName,
        jobTitle,
        jobPostingUrl,
        jobDescriptionSnapshot: job?.rawDescription,
        matchedRequirementsScore,
      });

      let transitioned = transitionApplicationRecord(newApp, 'ready_to_fill', 'Form detected and actions planned');
      transitioned = transitionApplicationRecord(transitioned, 'dry_run_review', 'Dry run planned and reviewed');
      transitioned = transitionApplicationRecord(transitioned, 'executing_actions', 'Executing browser action plan');
      transitioned = transitionApplicationRecord(
        transitioned,
        'awaiting_user_review',
        `Executed ${report.executedCount} form fields. Awaiting user review before manual submission.`,
        {
          filledFieldsCount: Object.keys(filledMap).length,
          filledValues: filledMap,
          dryRunLog: [...plan.actions],
        }
      );

      await appRepo.saveApplication(transitioned);
    }
  } catch (err) {
    console.error('Failed to record application execution:', err);
  }
}

/**
 * Fetches, normalizes, and screens live opportunities from direct unauthenticated ATS boards.
 */
async function fetchAndScreenAtsJobs(
  slugsToScan?: readonly { name: string; slug: string; platform: 'greenhouse' | 'ashby' | 'lever' }[],
  keyword?: string,
  preferences?: FetchAtsJobsRequest
): Promise<{
  opportunities: SourcedOpportunity[];
  scannedCount: number;
  sourceStatuses: readonly AtsSourceStatus[];
}> {
  const ATS_REQUEST_TIMEOUT_MS = 12_000;
  const targetCompanies = slugsToScan && slugsToScan.length > 0
    ? slugsToScan
    : DEFAULT_WATCHLIST_COMPANIES.slice(0, 15);

  const profile = await profileRepo.getProfile();
  const allOpportunities: SourcedOpportunity[] = [];

  const sourceStatuses: AtsSourceStatus[] = [];
  const scanCompany = async (
    company: (typeof targetCompanies)[number]
  ): Promise<SourcedOpportunity[]> => {
    try {
      let url = '';
      if (company.platform === 'greenhouse') {
        url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(company.slug)}/jobs?content=true`;
      } else if (company.platform === 'ashby') {
        url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(company.slug)}?includeCompensation=true`;
      } else if (company.platform === 'lever') {
        url = `https://api.lever.co/v0/postings/${encodeURIComponent(company.slug)}?mode=json`;
      }

      if (!url) {
        sourceStatuses.push({
          company: company.name,
          platform: company.platform,
          status: 'failed',
          error: 'ApplyKit cannot read job boards from that site yet.',
        });
        return [];
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), ATS_REQUEST_TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetch(url, {
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!res.ok) {
        sourceStatuses.push({
          company: company.name,
          platform: company.platform,
          status: 'failed',
          error: `The job board did not respond (error ${res.status}).`,
        });
        return [];
      }

      const json = await res.json();
      let normalized: SourcedOpportunity[] = [];

      if (company.platform === 'greenhouse') {
        normalized = normalizeGreenhouseJobs(json, company.name);
      } else if (company.platform === 'ashby') {
        normalized = normalizeAshbyJobs(json, company.name, company.slug);
      } else if (company.platform === 'lever') {
        normalized = normalizeLeverJobs(json, company.name);
      }

      sourceStatuses.push({ company: company.name, platform: company.platform, status: 'ok' });
      return normalized;
    } catch (err) {
      console.warn(`[AtsFeedHarvester] Failed to fetch board for ${company.name}:`, err);
      sourceStatuses.push({
        company: company.name,
        platform: company.platform,
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  };

  const concurrency = 4;
  for (let index = 0; index < targetCompanies.length; index += concurrency) {
    const batch = targetCompanies.slice(index, index + concurrency);
    const batchResults = await Promise.all(batch.map(scanCompany));
    for (const opportunities of batchResults) {
      allOpportunities.push(...opportunities);
    }
  }

  // Filter by keyword if provided
  let filtered = allOpportunities;
  if (keyword && keyword.trim()) {
    const kwLower = keyword.trim().toLowerCase();
    filtered = allOpportunities.filter(
      (opp) =>
        opp.title.toLowerCase().includes(kwLower) ||
        (opp.descriptionSnippet || '').toLowerCase().includes(kwLower) ||
        opp.locationText.toLowerCase().includes(kwLower)
    );
  }

  // If candidate profile exists, screen with 5-Gate Waterfall and EV tiering
  let screened = filtered;
  if (profile) {
    screened = screenSourcedOpportunities(filtered, profile, {
      workplacePreference: preferences?.workplacePreference,
      employmentPreference: preferences?.employmentPreference,
    });
  }

  cachedSourcedOpportunities = screened;
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    try {
      await chrome.storage.local.set({ [STORAGE_KEYS.SOURCED_OPPORTUNITIES]: screened.slice(0, 150) });
    } catch {
      // Storage quota or serialization ignore
    }
  }

  return {
    opportunities: screened,
    scannedCount: allOpportunities.length,
    sourceStatuses,
  };
}

/**
 * Requests the isolated content script is allowed to originate.
 *
 * Everything else is a privileged operation that may only come from an extension
 * page (side panel or options page); the content script executes untrusted page
 * context and must not be able to read the profile, mutate settings, or execute plans.
 */
const CONTENT_SCRIPT_ALLOWED_REQUESTS: ReadonlySet<string> = new Set([
  'PING',
  'GET_CANDIDATE_PROFILE',
  'ANSWER_AD_HOC_QUESTION',
  'EXECUTE_ONE_CLICK_AUTO_FILL',
  'OPEN_SIDEPANEL_TAB',
  'SUBMISSION_DETECTED',
  'ANNOTATE_PAGE_WIDGETS',
  'PICK_PAGE_WIDGET_OPTION',
]);

/**
 * Authorizes a runtime message by its sender context.
 *
 * Invariant: privileged messages are rejected when they carry a `sender.tab`,
 * because only extension pages (which have no tab) may configure credentials,
 * mutate the profile, or execute a plan.
 */
function isAuthorizedMessageSender(
  requestType: string,
  sender: chrome.runtime.MessageSender | undefined
): boolean {
  const runtimeId = typeof chrome !== 'undefined' ? chrome.runtime?.id : undefined;
  if (!runtimeId || !sender || sender.id !== runtimeId) return false;

  if (typeof sender.tab?.id === 'number') {
    return CONTENT_SCRIPT_ALLOWED_REQUESTS.has(requestType);
  }

  return typeof sender.url === 'string' && sender.url.startsWith(`chrome-extension://${runtimeId}/`);
}

/**
 * Message listener orchestrating requests between extension components.
 */
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!isValidExtensionRequest(message) || !isAuthorizedMessageSender(message.type, sender)) {
      return false;
    }

    const type = message.type;

    switch (type) {
      case 'PING': {
        const pong: PingResponse = {
          type: 'PONG',
          timestamp: Date.now(),
        };
        sendResponse(pong);
        return false;
      }

      case 'OPEN_SIDEPANEL_TAB': {
        openSidePanelOnTab(message.tab, sender.tab?.id)
          .then(() => {
            const res: OpenSidePanelTabResponse = {
              type: 'OPEN_SIDEPANEL_TAB_RESULT',
              success: true,
            };
            sendResponse(res);
          })
          .catch((err) => {
            const res: OpenSidePanelTabResponse = {
              type: 'OPEN_SIDEPANEL_TAB_RESULT',
              success: false,
              error: err instanceof Error ? err.message : String(err),
            };
            sendResponse(res);
          });
        return true;
      }

      case 'GET_API_KEYS_STATUS': {
        getApiKeysStatus()
          .then((status) => {
            const res: GetApiKeysStatusResponse = {
              type: 'API_KEYS_STATUS_RESULT',
              status,
            };
            sendResponse(res);
          })
          .catch((err) => {
            console.error('Failed to get API keys status:', err);
            sendResponse({
              type: 'API_KEYS_STATUS_RESULT',
              status: { openai: false, anthropic: false, gemini: false, openrouter: false },
            });
          });
        return true;
      }

      case 'SET_API_KEY': {
        const payload = message as { provider: AIProviderName; apiKey: string };
        const validProviders: readonly AIProviderName[] = [
          'openai',
          'anthropic',
          'gemini',
          'openrouter',
        ];
        if (!validProviders.includes(payload.provider)) {
          sendResponse({
            type: 'SET_API_KEY_RESULT',
            success: false,
            provider: payload.provider,
            error: `Unsupported provider "${String(payload.provider)}".`,
          });
          return true;
        }
        if (typeof payload.apiKey !== 'string') {
          sendResponse({
            type: 'SET_API_KEY_RESULT',
            success: false,
            provider: payload.provider,
            error: 'API key must be a string.',
          });
          return true;
        }
        (async () => {
          const key = payload.apiKey.trim();
          // An empty key removes the stored one; anything else is checked with the
          // provider first so a wrong key is never saved silently.
          const check = key ? await checkApiKey(payload.provider, key) : undefined;
          if (check?.status === 'invalid') {
            await saveKeyCheck(payload.provider, check);
            return { type: 'SET_API_KEY_RESULT', success: false, provider: payload.provider, error: check.message, check } satisfies SetApiKeyResponse;
          }
          await setApiKey(payload.provider, key);
          if (check) await saveKeyCheck(payload.provider, check);
          return { type: 'SET_API_KEY_RESULT', success: true, provider: payload.provider, ...(check ? { check } : {}) } satisfies SetApiKeyResponse;
        })()
          .then((res) => sendResponse(res))
          .catch((err) => {
            sendResponse({
              type: 'SET_API_KEY_RESULT',
              success: false,
              provider: payload.provider,
              error: err instanceof Error ? err.message : String(err),
            });
          });
        return true;
      }

      case 'CHECK_API_KEY': {
        const payload = message as CheckApiKeyRequest;
        (async () => {
          const key = await getRawApiKey(payload.provider);
          const check: KeyCheckResult = key
            ? await checkApiKey(payload.provider, key)
            : { status: 'invalid', message: 'No key is saved for this provider.' };
          if (key) await saveKeyCheck(payload.provider, check);
          return { type: 'CHECK_API_KEY_RESULT', provider: payload.provider, check } satisfies CheckApiKeyResponse;
        })()
          .then((res) => sendResponse(res))
          .catch((err) =>
            sendResponse({
              type: 'CHECK_API_KEY_RESULT',
              provider: payload.provider,
              check: { status: 'unreachable', message: err instanceof Error ? err.message : String(err) },
            } satisfies CheckApiKeyResponse)
          );
        return true;
      }

      case 'GET_DRAFT_LOG': {
        chrome.storage.local
          .get(DRAFT_LOG_KEY)
          .then((stored) => sendResponse({ type: 'GET_DRAFT_LOG_RESULT', log: (stored[DRAFT_LOG_KEY] as unknown[]) ?? [] }))
          .catch(() => sendResponse({ type: 'GET_DRAFT_LOG_RESULT', log: [] }));
        return true;
      }

      case 'GET_KEY_CHECKS': {
        chrome.storage.local
          .get(KEY_CHECKS_STORAGE_KEY)
          .then((stored) => sendResponse({ type: 'GET_KEY_CHECKS_RESULT', checks: (stored[KEY_CHECKS_STORAGE_KEY] as KeyChecks) ?? {} } satisfies GetKeyChecksResponse))
          .catch(() => sendResponse({ type: 'GET_KEY_CHECKS_RESULT', checks: {} } satisfies GetKeyChecksResponse));
        return true;
      }

      case 'GET_CANDIDATE_PROFILE_SUMMARY': {
        getProfileSummary()
          .then((summary) => {
            const res: GetCandidateProfileSummaryResponse = {
              type: 'CANDIDATE_PROFILE_SUMMARY_RESULT',
              summary,
            };
            sendResponse(res);
          })
          .catch((err) => {
            sendResponse({
              type: 'CANDIDATE_PROFILE_SUMMARY_RESULT',
              error: err instanceof Error ? err.message : String(err),
            });
          });
        return true;
      }

      case 'EXTRACT_JOB': {
        extractFromActiveTab()
          .then((res) => sendResponse(res))
          .catch((err) => {
            const res: ExtractJobResponse = {
              type: 'EXTRACT_JOB_RESULT',
              success: false,
              error: err instanceof Error ? err.message : String(err),
            };
            sendResponse(res);
          });
        return true;
      }

      case 'GET_CURRENT_EXTRACTION': {
        (async () => {
          const activeTab = await getActiveWebTab();
          const cached = activeTab?.id != null ? tabExtractionCache.get(activeTab.id) : undefined;
          if (cached) {
            const res: CurrentExtractionResponse = {
              type: 'CURRENT_EXTRACTION_RESULT',
              data: cached.data,
              jobPosting: cached.jobPosting,
            };
            sendResponse(res);
            return;
          }

          const stored = await chrome.storage.local.get([
            STORAGE_KEYS.LAST_EXTRACTION,
            STORAGE_KEYS.LAST_JOB_POSTING,
          ]);
          const res: CurrentExtractionResponse = {
            type: 'CURRENT_EXTRACTION_RESULT',
            data: (stored[STORAGE_KEYS.LAST_EXTRACTION] as ExtractedPageData) || null,
            jobPosting: (stored[STORAGE_KEYS.LAST_JOB_POSTING] as JobPosting) || null,
          };
          sendResponse(res);
        })().catch(() => {
          sendResponse({
            type: 'CURRENT_EXTRACTION_RESULT',
            data: null,
            jobPosting: null,
          });
        });
        return true;
      }

      case 'FETCH_ATS_JOBS': {
        const payload = message as FetchAtsJobsRequest;
        fetchAndScreenAtsJobs(payload.slugs, payload.keyword, payload)
          .then(({ opportunities, scannedCount, sourceStatuses }) => {
            const res: FetchAtsJobsResponse = {
              type: 'FETCH_ATS_JOBS_RESULT',
              success: true,
              opportunities,
              scannedCount,
              sourceStatuses,
            };
            sendResponse(res);
          })
          .catch((err) => {
            const res: FetchAtsJobsResponse = {
              type: 'FETCH_ATS_JOBS_RESULT',
              success: false,
              opportunities: [],
              scannedCount: 0,
              error: err instanceof Error ? err.message : String(err),
            };
            sendResponse(res);
          });
        return true;
      }

      case 'GET_SOURCED_OPPORTUNITIES': {
        (async () => {
          if (cachedSourcedOpportunities.length > 0) {
            return cachedSourcedOpportunities;
          }
          if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            const stored = await chrome.storage.local.get(STORAGE_KEYS.SOURCED_OPPORTUNITIES);
            const list = stored[STORAGE_KEYS.SOURCED_OPPORTUNITIES];
            if (Array.isArray(list)) {
              cachedSourcedOpportunities = list;
              return list;
            }
          }
          return [];
        })()
          .then((opportunities) => {
            const res: GetSourcedOpportunitiesResponse = {
              type: 'GET_SOURCED_OPPORTUNITIES_RESULT',
              success: true,
              opportunities,
            };
            sendResponse(res);
          })
          .catch(() => {
            sendResponse({
              type: 'GET_SOURCED_OPPORTUNITIES_RESULT',
              success: true,
              opportunities: [],
            });
          });
        return true;
      }

      case 'HARVEST_PAGE_LINKS': {
        (async () => {
          const activeTab = await getActiveWebTab();
          if (!activeTab || !activeTab.id || isRestrictedTabUrl(activeTab.url || '')) {
            return {
              type: 'HARVEST_PAGE_LINKS_RESULT' as const,
              success: false,
              links: [],
              error: 'Cannot harvest links from this page. Please open a valid company careers or job board page.',
            };
          }
          return await sendToContentScriptWithFallback<
            { type: 'HARVEST_PAGE_LINKS' },
            HarvestPageLinksResponse
          >(activeTab.id, { type: 'HARVEST_PAGE_LINKS' });
        })()
          .then((res) => sendResponse(res))
          .catch((err) => {
            const res: HarvestPageLinksResponse = {
              type: 'HARVEST_PAGE_LINKS_RESULT',
              success: false,
              links: [],
              error: err instanceof Error ? err.message : String(err),
            };
            sendResponse(res);
          });
        return true;
      }

      case 'GET_CANDIDATE_PROFILE': {
        profileRepo
          .getProfile()
          .then((profile) => {
            const res: GetCandidateProfileResponse = {
              type: 'CANDIDATE_PROFILE_RESULT',
              profile,
            };
            sendResponse(res);
          })
          .catch((err) => {
            console.error('Failed to get candidate profile:', err);
            sendResponse({ type: 'CANDIDATE_PROFILE_RESULT', profile: null });
          });
        return true;
      }

      case 'SAVE_CANDIDATE_PROFILE': {
        const payload = message as { profile: CandidateProfile };
        profileRepo
          .saveProfile(payload.profile)
          .then(() => {
            const res: SaveCandidateProfileResponse = {
              type: 'SAVE_CANDIDATE_PROFILE_RESULT',
              success: true,
            };
            sendResponse(res);
          })
          .catch((err) => {
            sendResponse({
              type: 'SAVE_CANDIDATE_PROFILE_RESULT',
              success: false,
              error: err instanceof Error ? err.message : String(err),
            });
          });
        return true;
      }

      case 'EXPORT_PROFILE_YAML': {
        profileRepo
          .getProfile()
          .then((profile) => {
            if (!profile) {
              const res: ExportProfileYamlResponse = {
                type: 'EXPORT_PROFILE_YAML_RESULT',
                success: false,
                error: 'No candidate profile found to export.',
              };
              sendResponse(res);
              return;
            }
            try {
              const yaml = serializePipelineProfileYaml(profile);
              const stem = `${profile.identity.legalFirstName}_${profile.identity.legalLastName}`.replace(/\s+/g, '_');
              const filename = stem.length > 1 ? `${stem}_profile.yaml` : 'profile.yaml';
              const res: ExportProfileYamlResponse = {
                type: 'EXPORT_PROFILE_YAML_RESULT',
                success: true,
                yaml,
                filename,
              };
              sendResponse(res);
            } catch (err) {
              sendResponse({
                type: 'EXPORT_PROFILE_YAML_RESULT',
                success: false,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          })
          .catch((err) => {
            sendResponse({
              type: 'EXPORT_PROFILE_YAML_RESULT',
              success: false,
              error: err instanceof Error ? err.message : String(err),
            });
          });
        return true;
      }

      case 'IMPORT_PROFILE_YAML': {
        const payload = message as { yamlContent: string };
        profileRepo
          .getProfile()
          .then(async (existingProfile) => {
            try {
              const updated = parsePipelineProfileYaml(payload.yamlContent, existingProfile || undefined);
              await profileRepo.saveProfile(updated);
              const res: ImportProfileYamlResponse = {
                type: 'IMPORT_PROFILE_YAML_RESULT',
                success: true,
                profile: updated,
              };
              sendResponse(res);
            } catch (err) {
              sendResponse({
                type: 'IMPORT_PROFILE_YAML_RESULT',
                success: false,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          })
          .catch((err) => {
            sendResponse({
              type: 'IMPORT_PROFILE_YAML_RESULT',
              success: false,
              error: err instanceof Error ? err.message : String(err),
            });
          });
        return true;
      }

      case 'LIST_SAVED_JOBS': {
        const payload = message as { limit?: number };
        jobRepo
          .listJobs(payload.limit)
          .then((jobs) => {
            const res: ListSavedJobsResponse = {
              type: 'SAVED_JOBS_RESULT',
              jobs,
            };
            sendResponse(res);
          })
          .catch(() => {
            sendResponse({ type: 'SAVED_JOBS_RESULT', jobs: [] });
          });
        return true;
      }

      case 'LIST_APPLICATIONS': {
        const payload = message as { limit?: number };
        appRepo
          .listApplications(payload.limit)
          .then((applications) => {
            const res: ListApplicationsResponse = {
              type: 'APPLICATIONS_RESULT',
              applications,
            };
            sendResponse(res);
          })
          .catch(() => {
            sendResponse({ type: 'APPLICATIONS_RESULT', applications: [] });
          });
        return true;
      }

      case 'EXPORT_BACKUP': {
        exportCandidateBackup()
          .then((jsonString) => {
            const res: ExportBackupResponse = {
              type: 'EXPORT_BACKUP_RESULT',
              success: true,
              jsonString,
            };
            sendResponse(res);
          })
          .catch((err) => {
            sendResponse({
              type: 'EXPORT_BACKUP_RESULT',
              success: false,
              error: err instanceof Error ? err.message : String(err),
            });
          });
        return true;
      }

      case 'IMPORT_BACKUP': {
        const payload = message as { jsonString: string };
        importCandidateBackup(payload.jsonString)
          .then((result) => {
            const res: ImportBackupResponse = {
              type: 'IMPORT_BACKUP_RESULT',
              success: result.success,
              error: result.error,
            };
            sendResponse(res);
          })
          .catch((err) => {
            sendResponse({
              type: 'IMPORT_BACKUP_RESULT',
              success: false,
              error: err instanceof Error ? err.message : String(err),
            });
          });
        return true;
      }

      case 'GET_STORAGE_USAGE': {
        getStorageUsageSummary()
          .then((usage) => {
            const res: GetStorageUsageResponse = {
              type: 'STORAGE_USAGE_RESULT',
              usage,
            };
            sendResponse(res);
          })
          .catch(() => {
            sendResponse({
              type: 'STORAGE_USAGE_RESULT',
              usage: {
                hasProfile: false,
                evidenceCount: 0,
                claimsCount: 0,
                applicationsCount: 0,
                jobsCount: 0,
                keysConfiguredCount: 0,
              },
            });
          });
        return true;
      }

      case 'PURGE_ALL_DATA': {
        purgeAllCandidateData()
          .then((purgeResult) => {
            const res: PurgeAllDataResponse = {
              type: 'PURGE_ALL_DATA_RESULT',
              success: true,
              purgeResult,
            };
            sendResponse(res);
          })
          .catch((err) => {
            sendResponse({
              type: 'PURGE_ALL_DATA_RESULT',
              success: false,
              error: err instanceof Error ? err.message : String(err),
            });
          });
        return true;
      }

      case 'INGEST_RESUME_TEXT': {
        const payload = message as { rawText: string };
        (async () => {
          try {
            const parsed = parsePlainTextResume(payload.rawText);
            const { profile, evidence } = createProfileFromParsedResume(parsed);
            const claims = deriveClaimsFromEvidence(evidence);

            const existingProfile = await profileRepo.getProfile();
            const profileWithClaims: CandidateProfile = {
              ...profile,
              id: existingProfile ? existingProfile.id : profile.id,
              identity: {
                ...profile.identity,
                legalFirstName: profile.identity.legalFirstName || existingProfile?.identity.legalFirstName || '',
                legalLastName: profile.identity.legalLastName || existingProfile?.identity.legalLastName || '',
                email: profile.identity.email || existingProfile?.identity.email || '',
                phone: profile.identity.phone || existingProfile?.identity.phone || '',
                location: {
                  city: profile.identity.location?.city || existingProfile?.identity.location?.city || '',
                  stateOrProvince: profile.identity.location?.stateOrProvince || existingProfile?.identity.location?.stateOrProvince,
                  country: profile.identity.location?.country || existingProfile?.identity.location?.country || '',
                  addressLine1: existingProfile?.identity.location?.addressLine1,
                  postalCode: existingProfile?.identity.location?.postalCode,
                },
                workAuthorization: existingProfile?.identity.workAuthorization ?? profile.identity.workAuthorization,
              },
              professional: {
                ...profile.professional,
                compensationExpectation: existingProfile?.professional.compensationExpectation ?? profile.professional.compensationExpectation,
                noticePeriodDays: existingProfile?.professional.noticePeriodDays ?? profile.professional.noticePeriodDays,
                earliestStartDate: existingProfile?.professional.earliestStartDate ?? profile.professional.earliestStartDate,
              },
              savedAnswers: existingProfile?.savedAnswers ?? [],
              claims,
            };

            await Promise.all([
              profileRepo.saveProfile(profileWithClaims),
              evidenceRepo.saveEvidenceBatch(evidence),
              evidenceRepo.saveClaimBatch(claims),
            ]);

            const graph = buildEvidenceGraph(evidence, claims);
            const auditReport = auditEvidenceGraphGrounding(graph);
            const profileSummary = await profileRepo.getProfileSummary();

            const res: IngestResumeResponse = {
              type: 'INGEST_RESUME_TEXT_RESULT',
              success: true,
              evidenceCount: evidence.length,
              claimsCount: claims.length,
              profileSummary,
              auditReport,
            };
            sendResponse(res);
          } catch (err) {
            sendResponse({
              type: 'INGEST_RESUME_TEXT_RESULT',
              success: false,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        })();
        return true;
      }

      case 'BOOTSTRAP_PROFILE_FROM_RESUME': {
        const payload = message as BootstrapProfileFromResumeRequest;
        (async () => {
          try {
            let inputData: Uint8Array | string;
            if (payload.isBase64 || payload.fileName.toLowerCase().endsWith('.pdf')) {
              // Decode base64 payload into binary bytes
              const binaryString = atob(payload.fileData);
              const bytes = new Uint8Array(binaryString.length);
              for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
              }
              inputData = bytes;
            } else {
              inputData = payload.fileData;
            }

            const existingProfile = await profileRepo.getProfile();
            const bootstrapped = await bootstrapProfileFromResume(
              inputData,
              payload.fileName,
              existingProfile?.id
            );

            const claims = deriveClaimsFromEvidence(bootstrapped.evidence);
            const profileWithClaims: CandidateProfile = {
              ...bootstrapped.profile,
              claims,
            };

            const response: BootstrapProfileFromResumeResponse = {
              type: 'BOOTSTRAP_PROFILE_FROM_RESUME_RESULT',
              success: true,
              result: {
                rawText: bootstrapped.rawText,
                profile: profileWithClaims,
                evidenceCount: bootstrapped.evidence.length,
                experiencesCount: bootstrapped.profile.experiences.length,
                skillsCount: bootstrapped.profile.skills.length,
                educationCount: bootstrapped.profile.education.length,
                evidence: [...bootstrapped.evidence],
                claims: [...claims],
              },
            };
            sendResponse(response);
          } catch (err) {
            sendResponse({
              type: 'BOOTSTRAP_PROFILE_FROM_RESUME_RESULT',
              success: false,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        })();
        return true;
      }

      case 'COMMIT_BOOTSTRAPPED_PROFILE': {
        const payload = message as CommitBootstrappedProfileRequest;
        (async () => {
          try {
            const claims = payload.claims ?? deriveClaimsFromEvidence(payload.evidence);
            const fullProfile: CandidateProfile = {
              ...payload.profile,
              claims,
              updatedAt: new Date().toISOString(),
            };

            await Promise.all([
              profileRepo.saveProfile(fullProfile),
              evidenceRepo.saveEvidenceBatch(payload.evidence),
              evidenceRepo.saveClaimBatch(claims),
            ]);

            const response: CommitBootstrappedProfileResponse = {
              type: 'COMMIT_BOOTSTRAPPED_PROFILE_RESULT',
              success: true,
              profileId: fullProfile.id,
              evidenceCount: payload.evidence.length,
            };
            sendResponse(response);
          } catch (err) {
            sendResponse({
              type: 'COMMIT_BOOTSTRAPPED_PROFILE_RESULT',
              success: false,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        })();
        return true;
      }

      case 'GET_EVIDENCE_GRAPH': {
        (async () => {
          try {
            const [evidence, claims] = await Promise.all([
              evidenceRepo.listEvidence(500),
              evidenceRepo.listClaims(500),
            ]);
            const graph = buildEvidenceGraph(evidence, claims);
            const auditReport = auditEvidenceGraphGrounding(graph);

            const res: GetEvidenceGraphResponse = {
              type: 'GET_EVIDENCE_GRAPH_RESULT',
              success: true,
              evidence,
              claims,
              auditReport,
            };
            sendResponse(res);
          } catch (err) {
            sendResponse({
              type: 'GET_EVIDENCE_GRAPH_RESULT',
              success: false,
              evidence: [],
              claims: [],
              error: err instanceof Error ? err.message : String(err),
            });
          }
        })();
        return true;
      }

      case 'AUDIT_GROUNDING': {
        (async () => {
          try {
            const graph = await evidenceRepo.getEvidenceGraph();
            const auditReport = auditEvidenceGraphGrounding(graph);
            const res: AuditGroundingResponse = {
              type: 'AUDIT_GROUNDING_RESULT',
              success: true,
              auditReport,
            };
            sendResponse(res);
          } catch (err) {
            sendResponse({
              type: 'AUDIT_GROUNDING_RESULT',
              success: false,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        })();
        return true;
      }

      case 'COMPLETE_AI_TASK': {
        const payload = message as { request: AIRequest; preferredProvider?: AIProviderName };
        (async () => {
          try {
            const response = await aiGateway.executeRequest(payload.request, payload.preferredProvider);
            const res: CompleteAiTaskResponse = {
              type: 'COMPLETE_AI_TASK_RESULT',
              success: true,
              response,
            };
            sendResponse(res);
          } catch (err) {
            sendResponse({
              type: 'COMPLETE_AI_TASK_RESULT',
              success: false,
              error: err instanceof Error ? `${err.message} [STACK: ${err.stack}]` : String(err),
            });
          }
        })();
        return true;
      }

      case 'GET_TOKEN_METRICS': {
        aiGateway
          .getTokenMetrics()
          .then((metrics) => {
            const res: GetTokenMetricsResponse = {
              type: 'GET_TOKEN_METRICS_RESULT',
              metrics,
            };
            sendResponse(res);
          })
          .catch(() => {
            sendResponse({
              type: 'GET_TOKEN_METRICS_RESULT',
              metrics: {
                openai: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
                anthropic: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
                gemini: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
                openrouter: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
              },
            });
          });
        return true;
      }

      case 'RESET_TOKEN_METRICS': {
        aiGateway
          .resetTokenMetrics()
          .then(() => {
            const res: ResetTokenMetricsResponse = {
              type: 'RESET_TOKEN_METRICS_RESULT',
              success: true,
            };
            sendResponse(res);
          })
          .catch(() => {
            sendResponse({
              type: 'RESET_TOKEN_METRICS_RESULT',
              success: false,
            });
          });
        return true;
      }

      case 'MATCH_JOB_REQUIREMENTS': {
        const payload = message as { jobPostingId?: string; requirements?: Requirement[] };
        (async () => {
          try {
            const profile = await profileRepo.getProfile();
            if (!profile) {
              sendResponse({
                type: 'MATCH_JOB_REQUIREMENTS_RESULT',
                success: false,
                error: 'No candidate profile found. Please set up your profile or import a resume first.',
              });
              return;
            }

            const evidenceGraph = await evidenceRepo.getEvidenceGraph();

            let reqs = payload.requirements;
            if (!reqs || reqs.length === 0) {
              if (payload.jobPostingId) {
                const job = await jobRepo.getJobById(payload.jobPostingId as any);
                if (job) reqs = [...job.requirements];
              }
            }

            if (!reqs || reqs.length === 0) {
              const stored = await chrome.storage.local.get(STORAGE_KEYS.LAST_JOB_POSTING);
              const lastJob = stored[STORAGE_KEYS.LAST_JOB_POSTING] as JobPosting | undefined;
              if (lastJob && lastJob.requirements) {
                reqs = [...lastJob.requirements];
              }
            }

            if (!reqs || reqs.length === 0) {
              sendResponse({
                type: 'MATCH_JOB_REQUIREMENTS_RESULT',
                success: false,
                error: 'No requirements found. Extract a job posting first from the Overview tab.',
              });
              return;
            }

            let resolvedJob: JobPosting | undefined;
            if (payload.jobPostingId) {
              const j = await jobRepo.getJobById(payload.jobPostingId as any);
              if (j) resolvedJob = j;
            }
            if (!resolvedJob) {
              const stored = await chrome.storage.local.get(STORAGE_KEYS.LAST_JOB_POSTING);
              resolvedJob = stored[STORAGE_KEYS.LAST_JOB_POSTING] as JobPosting | undefined;
            }

            const matchMatrix = evaluateJobRequirements(reqs, profile, evidenceGraph);
            const gapAnalysis = analyzeQualificationGaps(reqs, matchMatrix.matches, profile, evidenceGraph);
            const highlightSuggestions = generateHighlightSuggestions(reqs, profile, evidenceGraph);

            // Execute AI semantic matching when provider key is available (ADR-0020)
            let aiAnalysis: AiRequirementAnalysisResult | undefined;
            try {
              const expHighlights: string[] = [];
              const expList = profile.experiences || (profile.professional as any)?.experiences || [];
              for (const exp of expList) {
                if (exp.highlights && Array.isArray(exp.highlights)) {
                  expHighlights.push(...exp.highlights.slice(0, 3));
                } else if (exp.description) {
                  expHighlights.push(`${exp.title} at ${exp.company}: ${exp.description.slice(0, 150)}`);
                }
              }

              const matchingContext = {
                jobTitle: resolvedJob?.title || 'Target Job',
                companyName: resolvedJob?.companyName || 'Target Company',
                requirements: reqs,
                candidateSkills: profile.skills,
                candidateClaims: evidenceGraph.claims.slice(0, 25),
                relevantExperienceHighlights: expHighlights.slice(0, 10),
              };

              const aiReq = buildRequirementMatchingPrompt(matchingContext);
              // Invariant (ADR-0013): Optional AI matching must not block deterministic evaluation or exceed Chrome MV3 SW limits
              const aiPromise = aiGateway.executeRequest(aiReq);
              const timeoutPromise = new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('AI semantic requirement matching timed out')), 5000)
              );
              const aiRes = await Promise.race([aiPromise, timeoutPromise]);

              function isAiRequirementAnalysis(value: unknown): value is AiRequirementAnalysisResult {
                if (typeof value !== 'object' || value === null) return false;
                const v = value as Record<string, unknown>;
                return (
                  typeof v.overallScore === 'number' &&
                  Array.isArray(v.matches) &&
                  Array.isArray(v.keyStrengths) &&
                  Array.isArray(v.identifiedGaps)
                );
              }

              const parsed = parseAndValidateJsonResponse<AiRequirementAnalysisResult>(
                aiRes.rawText,
                isAiRequirementAnalysis
              );
              if (parsed.success && parsed.data) {
                aiAnalysis = parsed.data;
              }
            } catch (aiErr) {
              // Deterministic match matrix remains authoritative if AI is offline or encounters rate limits
              console.warn('AI semantic requirement matching skipped or failed:', aiErr);
            }

            const res: MatchJobRequirementsResponse = {
              type: 'MATCH_JOB_REQUIREMENTS_RESULT',
              success: true,
              matchMatrix,
              gapAnalysis,
              highlightSuggestions: [...highlightSuggestions],
              ...(aiAnalysis ? { aiAnalysis } : {}),
            };
            sendResponse(res);
          } catch (err) {
            sendResponse({
              type: 'MATCH_JOB_REQUIREMENTS_RESULT',
              success: false,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        })();
        return true;
      }

      case 'INSPECT_PAGE_FORMS': {
        inspectFormsFromActiveTab()
          .then((res) => sendResponse(res))
          .catch((err) => {
            sendResponse({
              type: 'INSPECT_PAGE_FORMS_RESULT',
              success: false,
              forms: [],
              error: err instanceof Error ? err.message : String(err),
            });
          });
        return true;
      }

      case 'GENERATE_DRY_RUN_PLAN': {
        (async () => {
          try {
            const profile = await profileRepo.getProfile();
            if (!profile) {
              const res: GenerateDryRunPlanResponse = {
                type: 'GENERATE_DRY_RUN_PLAN_RESULT',
                success: false,
                error: 'Candidate profile not initialized. Please configure your profile first.',
              };
              sendResponse(res);
              return;
            }

            const plan = generateDryRunPlan(message.form, profile);
            activeDryRunPlan = plan;
            persistActivePlan();

            // Store the form for later AI answering
            void chrome.storage.local.set({ [STORAGE_KEYS.ACTIVE_FORM]: message.form });

            const res: GenerateDryRunPlanResponse = {
              type: 'GENERATE_DRY_RUN_PLAN_RESULT',
              success: true,
              plan,
            };
            sendResponse(res);
          } catch (err) {
            const res: GenerateDryRunPlanResponse = {
              type: 'GENERATE_DRY_RUN_PLAN_RESULT',
              success: false,
              error: err instanceof Error ? err.message : String(err),
            };
            sendResponse(res);
          }
        })();
        return true;
      }

      case 'ANSWER_CUSTOM_FIELDS': {
        (async () => {
          try {
            const profile = await profileRepo.getProfile();
            if (!profile) {
              const res: AnswerCustomFieldsResponse = {
                type: 'ANSWER_CUSTOM_FIELDS_RESULT',
                success: false,
                error: 'Candidate profile not initialized. Please configure your profile first.',
              };
              sendResponse(res);
              return;
            }

            const activePlan = message.plan;
            const form = message.form as ApplicationForm;

            const evidenceGraph = await evidenceRepo.getEvidenceGraph();
            const savedAnswers = profile.savedAnswers;
            const evidenceList = evidenceGraph ? Array.from(evidenceGraph.evidenceMap.values()) : [];
            // Same fallback as the question helper and one-click fill: with no evidence graph
            // yet, the profile's own claims are still real resume lines to draft from.
            const candidateClaims = evidenceList.length > 0 ? deriveClaimsFromEvidence(evidenceList) : (profile.claims || []);

            const aiAnswerableFields = form.fields.filter((field: ApplicationField) =>
              isAiAnswerableCustomField(field, { includeChoiceFields: true }) &&
              !activePlan.actions.some((a: DryRunAction) => a.fieldId === field.id)
            );

            if (aiAnswerableFields.length === 0) {
              const res: AnswerCustomFieldsResponse = {
                type: 'ANSWER_CUSTOM_FIELDS_RESULT',
                success: true,
                plan: activePlan,
              };
              sendResponse(res);
              return;
            }

            const answers: AiProposedFieldAnswer[] = [];
            const openJob = form?.url ? (await jobForFormPage(form.url, form.pageTitle)).job : null;
            const brief = await companyBriefFor(openJob);

            for (const field of aiAnswerableFields) {
              // Free-text questions ("What attracted you to Monzo?") go through the coached,
              // checked drafter. They used to be skipped unless a word in the question
              // matched a resume line, which ruled out most open questions.
              if (!field.options || field.options.length === 0) {
                const drafted = await draftGroundedAnswer({
                  question: field.label,
                  profile,
                  claims: candidateClaims,
                  job: openJob,
                  companyFacts: brief?.facts,
                  maxLength: field.maxLength,
                  execute: (request) => aiGateway.executeRequest(request),
                });
                if (drafted.ok) {
                  answers.push({
                    fieldId: field.id,
                    answerText: drafted.text,
                    confidence: drafted.confidence,
                    supportingClaimIds: drafted.supportingClaimIds,
                    isGrounded: true,
                  });
                }
                continue;
              }

              const relevantAnswers = savedAnswers.filter((ans) =>
                field.label.toLowerCase().includes(ans.canonicalKey.toLowerCase()) ||
                ans.promptPatterns.some((pattern) => field.label.toLowerCase().includes(pattern.toLowerCase()))
              );

              // Tokenize field label for keyword matching against evidence statements and tags
              const labelKeywords = field.label
                .toLowerCase()
                .replace(/[^a-z0-9\s]/g, ' ')
                .split(/\s+/)
                .filter((w) => w.length > 2);

              const keywordMatchedClaims = candidateClaims.filter((claim) => {
                const statementLower = claim.statement.toLowerCase();
                const tagsLower = (claim.tags || []).map((t) => t.toLowerCase());
                return labelKeywords.some(
                  (kw) => statementLower.includes(kw) || tagsLower.some((t) => t.includes(kw))
                );
              });

              const relevantClaims = keywordMatchedClaims;
              if (relevantClaims.length === 0) {
                continue;
              }

              const context: FieldAnsweringContext = {
                fieldLabel: field.label,
                fieldType: field.fieldType,
                options: field.options,
                placeholder: field.placeholder,
                relevantAnswers,
                relevantClaims,
                writingStyle: getWritingStyleFromProfile(profile),
                answerLengthPreference: 'normal',
                candidateExperiences: profile.experiences,
                candidateSkills: profile.skills,
                candidateEducation: profile.education,
                candidateSummary: profile.professional?.summary || profile.professional?.headline,
                fillingStrategy: 'ats_aggressive',
              };

              const request = buildFieldAnsweringPrompt(context);
              const response = await aiGateway.executeRequest(request);

              const parsed = parseAndValidateJsonResponse<{
                answerText: string;
                confidence: number;
                supportingClaimIds: string[];
                isGrounded: boolean;
                notes: string;
              }>(
                response.rawText,
                isAiFieldAnswerResult
              );

              if (parsed.success && parsed.data) {
                const answerText = parsed.data.answerText.trim();
                const canonicalClaimIds = new Set<string>(
                  [...(profile.claims || []), ...candidateClaims].map((claim) => claim.id)
                );
                const supportingClaimIds = parsed.data.supportingClaimIds.filter((id) =>
                  canonicalClaimIds.has(id)
                );
                // Zero-hallucination gate: an answer without a traceable claim is not staged.
                if (answerText && supportingClaimIds.length > 0) {
                  const confidence = Math.min(1, Math.max(0, parsed.data.confidence));
                  answers.push({
                    fieldId: field.id,
                    answerText,
                    confidence,
                    supportingClaimIds,
                    isGrounded: true,
                  });
                }
              }
            }

            const updatedPlan = withAiProposedFieldAnswers(activePlan, form, answers);
            activeDryRunPlan = updatedPlan;
            persistActivePlan();

            const res: AnswerCustomFieldsResponse = {
              type: 'ANSWER_CUSTOM_FIELDS_RESULT',
              success: true,
              plan: updatedPlan,
            };
            sendResponse(res);
          } catch (err) {
            const res: AnswerCustomFieldsResponse = {
              type: 'ANSWER_CUSTOM_FIELDS_RESULT',
              success: false,
              error: err instanceof Error ? err.message : String(err),
            };
            sendResponse(res);
          }
        })();
        return true;
      }

      case 'GET_ACTIVE_PLAN': {
        const respond = (plan: DryRunPlan | null) => {
          sendResponse({ type: 'ACTIVE_PLAN_RESULT', plan });
        };
        if (activeDryRunPlan) {
          respond(activeDryRunPlan);
          return false;
        }
        loadActivePlanFromStorage()
          .then(() => respond(activeDryRunPlan))
          .catch(() => respond(null));
        return true;
      }

      case 'GET_ACTIVE_FORM': {
        (async () => {
          const data = await chrome.storage.local.get(STORAGE_KEYS.ACTIVE_FORM);
          const form = data[STORAGE_KEYS.ACTIVE_FORM] as ApplicationForm | undefined;
          sendResponse({ type: 'ACTIVE_FORM_RESULT', form: form || null });
        })();
        return true;
      }

      case 'UPDATE_PLAN_ACTION': {
        (async () => {
          try {
            await loadActivePlanFromStorage();
            if (!activeDryRunPlan) {
              const res: UpdatePlanActionResponse = {
                type: 'UPDATE_PLAN_ACTION_RESULT',
                success: false,
                error: 'No active dry run plan to update.',
              };
              sendResponse(res);
              return;
            }

            activeDryRunPlan = updatePlanActionValue(
              activeDryRunPlan,
              message.actionId,
              message.userValue
            );
            persistActivePlan();

            const res: UpdatePlanActionResponse = {
              type: 'UPDATE_PLAN_ACTION_RESULT',
              success: true,
              plan: activeDryRunPlan,
            };
            sendResponse(res);
          } catch {
            sendResponse({
              type: 'UPDATE_PLAN_ACTION_RESULT',
              success: false,
              error: 'Failed to load the active dry run plan.',
            });
          }
        })();
        return true;
      }

      case 'TOGGLE_PLAN_ACTION_APPROVAL': {
        (async () => {
          try {
            await loadActivePlanFromStorage();
            if (!activeDryRunPlan) {
              const res: TogglePlanActionApprovalResponse = {
                type: 'TOGGLE_PLAN_ACTION_APPROVAL_RESULT',
                success: false,
                error: 'No active dry run plan to toggle.',
              };
              sendResponse(res);
              return;
            }

            activeDryRunPlan = togglePlanActionApproval(
              activeDryRunPlan,
              message.actionId,
              message.confirmed
            );
            persistActivePlan();

            const res: TogglePlanActionApprovalResponse = {
              type: 'TOGGLE_PLAN_ACTION_APPROVAL_RESULT',
              success: true,
              plan: activeDryRunPlan,
            };
            sendResponse(res);
          } catch {
            sendResponse({
              type: 'TOGGLE_PLAN_ACTION_APPROVAL_RESULT',
              success: false,
              error: 'Failed to load the active dry run plan.',
            });
          }
        })();
        return true;
      }

      case 'EXCLUDE_PLAN_ACTION': {
        (async () => {
          try {
            await loadActivePlanFromStorage();
            if (!activeDryRunPlan) {
              const res: ExcludePlanActionResponse = {
                type: 'EXCLUDE_PLAN_ACTION_RESULT',
                success: false,
                error: 'No active dry run plan to exclude action from.',
              };
              sendResponse(res);
              return;
            }

            activeDryRunPlan = excludePlanAction(activeDryRunPlan, message.actionId);
            persistActivePlan();

            const res: ExcludePlanActionResponse = {
              type: 'EXCLUDE_PLAN_ACTION_RESULT',
              success: true,
              plan: activeDryRunPlan,
            };
            sendResponse(res);
          } catch {
            sendResponse({
              type: 'EXCLUDE_PLAN_ACTION_RESULT',
              success: false,
              error: 'Failed to load the active dry run plan.',
            });
          }
        })();
        return true;
      }

      case 'EXECUTE_PLAN': {
        const payload = message as { planId?: string; options?: ExecutionOptions };
        (async () => {
          try {
            await loadActivePlanFromStorage();
            if (!activeDryRunPlan) {
              const res: ExecutePlanResponse = {
                type: 'EXECUTE_PLAN_RESULT',
                success: false,
                error: 'No active dry run plan found to execute. Please generate a dry run plan first.',
              };
              sendResponse(res);
              return;
            }
            if (payload.planId && payload.planId !== activeDryRunPlan.id) {
              const res: ExecutePlanResponse = {
                type: 'EXECUTE_PLAN_RESULT',
                success: false,
                error: 'The dry run plan has changed since it was generated. Please review the updated plan before executing.',
              };
              sendResponse(res);
              return;
            }

            const result = await executePlanOnActiveTab(activeDryRunPlan, payload.options);
            if (result.success && result.report) {
              await recordApplicationExecution(activeDryRunPlan, result.report);
            }
            sendResponse(result);
          } catch (err) {
            const res: ExecutePlanResponse = {
              type: 'EXECUTE_PLAN_RESULT',
              success: false,
              error: err instanceof Error ? err.message : String(err),
            };
            sendResponse(res);
          }
        })();
        return true;
      }

      case 'HIGHLIGHT_FORM_FIELD': {
        const payload = message as { selector: string; label?: string };
        (async () => {
          const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!activeTab || !activeTab.id) {
            sendResponse({
              type: 'HIGHLIGHT_FORM_FIELD_RESULT',
              success: false,
              error: 'No active tab to highlight the form field on.',
            });
            return;
          }
          chrome.tabs.sendMessage(activeTab.id, payload, () => {
            if (chrome.runtime && chrome.runtime.lastError) {
              sendResponse({
                type: 'HIGHLIGHT_FORM_FIELD_RESULT',
                success: false,
                error: chrome.runtime.lastError.message || 'Failed to send highlight message.',
              });
              return;
            }
            sendResponse({ type: 'HIGHLIGHT_FORM_FIELD_RESULT', success: true });
          });
        })();
        return true;
      }

      case 'CLEAR_FORM_FIELD_HIGHLIGHT': {
        (async () => {
          const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!activeTab || !activeTab.id) {
            sendResponse({
              type: 'CLEAR_FORM_FIELD_HIGHLIGHT_RESULT',
              success: false,
              error: 'No active tab to clear the form field highlight on.',
            });
            return;
          }
          chrome.tabs.sendMessage(activeTab.id, { type: 'CLEAR_FORM_FIELD_HIGHLIGHT' }, () => {
            if (chrome.runtime && chrome.runtime.lastError) {
              sendResponse({
                type: 'CLEAR_FORM_FIELD_HIGHLIGHT_RESULT',
                success: false,
                error: chrome.runtime.lastError.message || 'Failed to send clear-highlight message.',
              });
              return;
            }
            sendResponse({ type: 'CLEAR_FORM_FIELD_HIGHLIGHT_RESULT', success: true });
          });
        })();
        return true;
      }

      case 'TOGGLE_IN_PAGE_REVIEW_BADGES': {
        const payload = message as { enabled: boolean };
        (async () => {
          await loadActivePlanFromStorage();
          const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!activeTab || !activeTab.id) {
            sendResponse({ type: 'TOGGLE_IN_PAGE_REVIEW_BADGES_RESULT', success: false });
            return;
          }
          chrome.tabs.sendMessage(
            activeTab.id,
            {
              type: 'TOGGLE_IN_PAGE_REVIEW_BADGES',
              enabled: payload.enabled,
              plan: activeDryRunPlan,
            },
            (res) => {
              if (chrome.runtime && chrome.runtime.lastError) {
                sendResponse({ type: 'TOGGLE_IN_PAGE_REVIEW_BADGES_RESULT', success: false });
                return;
              }
              sendResponse(
                res || { type: 'TOGGLE_IN_PAGE_REVIEW_BADGES_RESULT', success: true }
              );
            }
          );
        })();
        return true;
      }

      case 'BATCH_APPROVE_PLAN_ACTIONS': {
        const payload = message as { mode: 'low_risk_only' | 'all' | 'reset' };
        (async () => {
          try {
            await loadActivePlanFromStorage();
            if (!activeDryRunPlan) {
              const res: BatchApprovePlanActionsResponse = {
                type: 'BATCH_APPROVE_PLAN_ACTIONS_RESULT',
                success: false,
                error: 'No active dry run plan found to batch-approve.',
              };
              sendResponse(res);
              return;
            }

            if (payload.mode === 'low_risk_only') {
              activeDryRunPlan = approveAllLowRiskActions(activeDryRunPlan);
            } else if (payload.mode === 'all') {
              activeDryRunPlan = approveAllActions(activeDryRunPlan);
            } else if (payload.mode === 'reset') {
              activeDryRunPlan = resetAllApprovals(activeDryRunPlan);
            }
            persistActivePlan();

            const res: BatchApprovePlanActionsResponse = {
              type: 'BATCH_APPROVE_PLAN_ACTIONS_RESULT',
              success: true,
              plan: activeDryRunPlan,
            };
            sendResponse(res);
          } catch {
            sendResponse({
              type: 'BATCH_APPROVE_PLAN_ACTIONS_RESULT',
              success: false,
              error: 'Failed to load the active dry run plan.',
            });
          }
        })();
        return true;
      }

      case 'EXECUTE_SELECTIVE_ACTION': {
        const payload = message as { actionId: ActionId; options?: ExecutionOptions };
        (async () => {
          try {
            await loadActivePlanFromStorage();
            if (!activeDryRunPlan) {
              const res: ExecuteSelectiveActionResponse = {
                type: 'EXECUTE_SELECTIVE_ACTION_RESULT',
                success: false,
                error: 'No active dry run plan found.',
              };
              sendResponse(res);
              return;
            }

            const selectivePlan = createSelectiveDryRunPlan(activeDryRunPlan, payload.actionId);
            const result = await executePlanOnActiveTab(selectivePlan, payload.options);
            if (result.success && result.report) {
              await recordApplicationExecution(selectivePlan, result.report);
            }

            const res: ExecuteSelectiveActionResponse = {
              type: 'EXECUTE_SELECTIVE_ACTION_RESULT',
              success: result.success,
              report: result.report,
              error: result.error,
            };
            sendResponse(res);
          } catch (err) {
            const res: ExecuteSelectiveActionResponse = {
              type: 'EXECUTE_SELECTIVE_ACTION_RESULT',
              success: false,
              error: err instanceof Error ? err.message : String(err),
            };
            sendResponse(res);
          }
        })();
        return true;
      }

      case 'GET_APPLICATION_DETAIL': {
        const payload = message as { id: ApplicationId };
        appRepo
          .getApplicationById(payload.id)
          .then((application) => {
            const res: GetApplicationDetailResponse = {
              type: 'GET_APPLICATION_DETAIL_RESULT',
              success: true,
              application: application || undefined,
            };
            sendResponse(res);
          })
          .catch((err) => {
            sendResponse({
              type: 'GET_APPLICATION_DETAIL_RESULT',
              success: false,
              error: err instanceof Error ? err.message : String(err),
            });
          });
        return true;
      }

      case 'UPDATE_APPLICATION_STATUS': {
        const payload = message as UpdateApplicationStatusRequest;
        appRepo
          .updateApplicationStatus(payload.id, payload.nextStatus, payload.reason, {
            ...(payload.interviewStage ? { interviewStage: payload.interviewStage } : {}),
            ...(payload.nextFollowUpDate ? { nextFollowUpDate: payload.nextFollowUpDate } : {}),
            ...(payload.notes !== undefined ? { notes: payload.notes } : {}),
            ...(payload.recruiterName !== undefined ? { recruiterName: payload.recruiterName } : {}),
            ...(payload.recruiterEmail !== undefined ? { recruiterEmail: payload.recruiterEmail } : {}),
            ...(payload.expectedSalary !== undefined ? { expectedSalary: payload.expectedSalary } : {}),
          })
          .then((application) => {
            const res: UpdateApplicationStatusResponse = {
              type: 'UPDATE_APPLICATION_STATUS_RESULT',
              success: true,
              application,
            };
            sendResponse(res);
          })
          .catch((err) => {
            sendResponse({
              type: 'UPDATE_APPLICATION_STATUS_RESULT',
              success: false,
              error: err instanceof Error ? err.message : String(err),
            });
          });
        return true;
      }

      case 'DELETE_APPLICATION_RECORD': {
        const payload = message as { id: ApplicationId };
        appRepo
          .deleteApplication(payload.id)
          .then(() => {
            const res: DeleteApplicationRecordResponse = {
              type: 'DELETE_APPLICATION_RECORD_RESULT',
              success: true,
            };
            sendResponse(res);
          })
          .catch((err) => {
            sendResponse({
              type: 'DELETE_APPLICATION_RECORD_RESULT',
              success: false,
              error: err instanceof Error ? err.message : String(err),
            });
          });
        return true;
      }

      case 'EXPORT_AUDIT_LOG': {
        const payload = message as ExportAuditLogRequest;
        appRepo
          .listApplications(1000)
          .then((applications) => {
            const timestamp = new Date().toISOString().slice(0, 10);
            let content: string;
            let filename: string;
            let mimeType: string;

            switch (payload.format) {
              case 'tracker-csv':
                content = exportPipelineTrackerCsv(applications);
                filename = `applykit-pipeline-tracker-${timestamp}.csv`;
                mimeType = 'text/csv';
                break;
              case 'tracker-md':
                content = exportPipelineTrackerMarkdown(applications);
                filename = `applykit-pipeline-tracker-${timestamp}.md`;
                mimeType = 'text/markdown';
                break;
              case 'json':
                content = exportAuditTrailAsJson(applications);
                filename = `applykit-audit-trail-${timestamp}.json`;
                mimeType = 'application/json';
                break;
              case 'csv':
              default:
                content = exportAuditTrailAsCsv(applications);
                filename = `applykit-audit-trail-${timestamp}.csv`;
                mimeType = 'text/csv';
                break;
            }

            const res: ExportAuditLogResponse = {
              type: 'EXPORT_AUDIT_LOG_RESULT',
              success: true,
              content,
              filename,
              mimeType,
            };
            sendResponse(res);
          })
          .catch((err) => {
            sendResponse({
              type: 'EXPORT_AUDIT_LOG_RESULT',
              success: false,
              error: err instanceof Error ? err.message : String(err),
            });
          });
        return true;
      }

      case 'GENERATE_TAILORED_RESUME': {
        const payload = (message as any).payload || message;
        loadTailoringContext(payload?.jobId)
          .then(({ profile, job, graph }) => {
            const tailoredResume = tailorCandidateResume(job, profile, graph, {
              maxBulletsPerItem: payload?.maxBulletsPerItem,
              maxProjects: payload?.maxProjects,
              templateId: payload?.templateId,
              onePageFit: payload?.onePageFit,
              mentionCompany: payload?.mentionCompany !== false,
            });
            const textToAudit = [
              tailoredResume.tailoredSummary,
              ...tailoredResume.experiences.flatMap((e) => e.rankedHighlights.map((h) => h.text)),
              ...tailoredResume.projects.flatMap((p) => p.rankedHighlights.map((h) => h.text)),
            ].join('\n');
            const factCheck = factCheckTailoredDocument(textToAudit, profile, graph, 'resume');
            const qualityAudit = tailoredResume.qualityAudit || auditResumeQuality(tailoredResume, profile, job, payload?.templateId);
            const res: GenerateTailoredResumeResponse = {
              type: 'GENERATE_TAILORED_RESUME_RESULT',
              success: true,
              tailoredResume,
              factCheck,
              qualityAudit,
            };
            sendResponse(res);
          })
          .catch((err) => {
            sendResponse({
              type: 'GENERATE_TAILORED_RESUME_RESULT',
              success: false,
              error: err instanceof Error ? err.message : String(err),
            });
          });
        return true;
      }

      case 'REWORD_RESUME_WITH_AI': {
        const payload = message as RewordResumeWithAiRequest;
        loadTailoringContext(payload.jobId)
          .then(async ({ profile, job }) => {
            const { systemPrompt, prompt } = buildResumeRewritePrompt(job, payload.resume);
            const response = await aiGateway.executeRequest({
              prompt,
              systemPrompt,
              contextType: 'resume_tailoring',
              // The prompt carries only the job and the resume's own lines.
              contextPayload: { targetJobTitle: job.title, companyName: job.companyName, requirements: [], experiences: [], projects: [], skills: [] },
              temperature: 0.2,
              maxTokens: 3500,
            });
            const parsed = parseAndValidateJsonResponse<ResumeRewriteResult>(response.rawText, isResumeRewriteResult);
            if (!parsed.success || !parsed.data) {
              throw new Error('The AI reply could not be read. Your resume was left as it was.');
            }
            const applied = applyResumeRewrite(payload.resume, parsed.data, profile, job);
            const qualityAudit = auditResumeQuality(applied.resume, profile, job, applied.resume.templateId || 'modern');
            const res: RewordResumeWithAiResponse = {
              type: 'REWORD_RESUME_WITH_AI_RESULT',
              success: true,
              tailoredResume: applied.resume,
              qualityAudit,
              changes: applied.changes,
            };
            sendResponse(res);
          })
          .catch((err) => {
            sendResponse({
              type: 'REWORD_RESUME_WITH_AI_RESULT',
              success: false,
              error: err instanceof Error ? err.message : String(err),
            } satisfies RewordResumeWithAiResponse);
          });
        return true;
      }

      case 'AUTO_FIX_RESUME': {
        const payload = message as AutoFixResumeRequest;
        loadTailoringContext(payload?.jobId)
          .then(({ profile, job }) => {
            const fixedResume = autoFixResumeQualityIssues(payload.resume, profile, job);
            const qualityAudit = auditResumeQuality(fixedResume, profile, job, fixedResume.templateId || 'modern');

            const res: AutoFixResumeResponse = {
              type: 'AUTO_FIX_RESUME_RESULT',
              success: true,
              tailoredResume: fixedResume,
              qualityAudit,
            };
            sendResponse(res);
          })
          .catch((err) => {
            sendResponse({
              type: 'AUTO_FIX_RESUME_RESULT',
              success: false,
              error: err instanceof Error ? err.message : String(err),
            });
          });
        return true;
      }

      case 'GENERATE_COVER_LETTER': {
        const payload = (message as any).payload || message;
        loadTailoringContext(payload?.jobId)
          .then(({ profile, job, graph }) => {
            const coverLetter = generateGroundedCoverLetter(job, profile, graph, {
              recipient: payload?.recipient,
              tone: payload?.tone,
            });
            const factCheck = factCheckTailoredDocument(coverLetter.fullText, profile, graph, 'cover_letter');
            const res: GenerateCoverLetterResponse = {
              type: 'GENERATE_COVER_LETTER_RESULT',
              success: true,
              coverLetter,
              factCheck,
            };
            sendResponse(res);
          })
          .catch((err) => {
            sendResponse({
              type: 'GENERATE_COVER_LETTER_RESULT',
              success: false,
              error: err instanceof Error ? err.message : String(err),
            });
          });
        return true;
      }

      case 'GENERATE_COVER_LETTER_PDF': {
        const payload = (message as any).payload || message;
        loadTailoringContext(payload?.jobId)
          .then(async ({ profile, job, graph }) => {
            try {
              const coverLetter = generateGroundedCoverLetter(job, profile, graph, {
                recipient: payload?.recipient,
                tone: payload?.tone,
              });
              const pdfBlob = await generateCoverLetterPdfBlob(coverLetter);
              const arrayBuffer = await pdfBlob.arrayBuffer();
              const pdfBase64 = encodeBytesToBase64(arrayBuffer);
              const res: GenerateCoverLetterPdfResponse = {
                type: 'GENERATE_COVER_LETTER_PDF_RESULT',
                success: true,
                pdfBase64,
              };
              sendResponse(res);
            } catch (err) {
              sendResponse({
                type: 'GENERATE_COVER_LETTER_PDF_RESULT',
                success: false,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          })
          .catch((err) => {
            sendResponse({
              type: 'GENERATE_COVER_LETTER_PDF_RESULT',
              success: false,
              error: err instanceof Error ? err.message : String(err),
            });
          });
        return true;
      }

      case 'GENERATE_RESUME_PDF': {
        const payload = (message as any).payload || message;
        loadTailoringContext(payload?.jobId)
          .then(async ({ profile, job, graph }) => {
            try {
              const tailoredResume = tailorCandidateResume(job, profile, graph, {
                maxBulletsPerItem: payload?.maxBulletsPerItem,
                maxProjects: payload?.maxProjects,
                templateId: payload?.templateId,
                onePageFit: payload?.onePageFit,
              });
              const pdfBlob = await generateResumePdfBlob(tailoredResume, profile, {
                templateId: payload?.templateId,
                onePageFit: payload?.onePageFit,
                density: payload?.density,
                showTargetBadge: payload?.showTargetBadge,
              });
              const arrayBuffer = await pdfBlob.arrayBuffer();
              const pdfBase64 = encodeBytesToBase64(arrayBuffer);
              const res: GenerateResumePdfResponse = {
                type: 'GENERATE_RESUME_PDF_RESULT',
                success: true,
                pdfBase64,
              };
              sendResponse(res);
            } catch (err) {
              sendResponse({
                type: 'GENERATE_RESUME_PDF_RESULT',
                success: false,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          })
          .catch((err) => {
            sendResponse({
              type: 'GENERATE_RESUME_PDF_RESULT',
              success: false,
              error: err instanceof Error ? err.message : String(err),
            });
          });
        return true;
      }

      case 'GENERATE_RESUME_DOCX': {
        const payload = (message as any).payload || message;
        loadTailoringContext(payload?.jobId)
          .then(async ({ profile, job, graph }) => {
            try {
              const tailoredResume = tailorCandidateResume(job, profile, graph, {
                maxBulletsPerItem: payload?.maxBulletsPerItem,
                maxProjects: payload?.maxProjects,
                templateId: payload?.templateId,
              });
              const docxBlob = await generateResumeDocxBlob(tailoredResume, profile, {
                templateId: payload?.templateId,
                density: payload?.density,
                showTargetBadge: payload?.showTargetBadge,
              });
              const arrayBuffer = await docxBlob.arrayBuffer();
              const docxBase64 = encodeBytesToBase64(arrayBuffer);
              const filename = getStandardResumeFilename(profile, 'docx');
              const res: GenerateResumeDocxResponse = {
                type: 'GENERATE_RESUME_DOCX_RESULT',
                success: true,
                docxBase64,
                filename,
              };
              sendResponse(res);
            } catch (err) {
              sendResponse({
                type: 'GENERATE_RESUME_DOCX_RESULT',
                success: false,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          })
          .catch((err) => {
            sendResponse({
              type: 'GENERATE_RESUME_DOCX_RESULT',
              success: false,
              error: err instanceof Error ? err.message : String(err),
            });
          });
        return true;
      }

      case 'GENERATE_COVER_LETTER_DOCX': {
        const payload = (message as any).payload || message;
        loadTailoringContext(payload?.jobId)
          .then(async ({ profile, job, graph }) => {
            try {
              const coverLetter = generateGroundedCoverLetter(job, profile, graph, {
                recipient: payload?.recipient,
                tone: payload?.tone,
              });
              const docxBlob = await generateCoverLetterDocxBlob(coverLetter, profile);
              const arrayBuffer = await docxBlob.arrayBuffer();
              const docxBase64 = encodeBytesToBase64(arrayBuffer);
              const filename = getStandardCoverLetterFilename(profile, 'docx');
              const res: GenerateCoverLetterDocxResponse = {
                type: 'GENERATE_COVER_LETTER_DOCX_RESULT',
                success: true,
                docxBase64,
                filename,
              };
              sendResponse(res);
            } catch (err) {
              sendResponse({
                type: 'GENERATE_COVER_LETTER_DOCX_RESULT',
                success: false,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          })
          .catch((err) => {
            sendResponse({
              type: 'GENERATE_COVER_LETTER_DOCX_RESULT',
              success: false,
              error: err instanceof Error ? err.message : String(err),
            });
          });
        return true;
      }

      case 'SUBMISSION_DETECTED': {
        const payload = message as SubmissionDetectedNotification;
        processSubmissionDetection(payload.url, payload.title, payload.atsType)
          .then((result) => {
            const res: SubmissionDetectedResponse = {
              type: 'SUBMISSION_DETECTED_RESULT',
              success: result.success,
              applicationId: result.applicationId,
              previousStatus: result.previousStatus,
              newStatus: result.newStatus,
              error: result.error,
            };
            sendResponse(res);
          })
          .catch((err) => {
            sendResponse({
              type: 'SUBMISSION_DETECTED_RESULT',
              success: false,
              error: err instanceof Error ? err.message : String(err),
            });
          });
        return true;
      }

      case 'ANSWER_AD_HOC_QUESTION': {
        const payload = message as AnswerAdHocQuestionRequest;
        (async () => {
          try {
            const profile = await profileRepo.getProfile();
            if (!profile) {
              sendResponse({
                type: 'ANSWER_AD_HOC_QUESTION_RESULT',
                success: false,
                error: 'Candidate profile not initialized. Please configure your profile first.',
              });
              return;
            }

            const questionText = (payload.question || '').trim();
            const questionLower = questionText.toLowerCase();

            // ---------------------------------------------------------
            // Stage 1: Fast-Path Deterministic Match (0ms offline, 0 API keys)
            // ---------------------------------------------------------
            // 1a. Check candidate's saved reusable answers
            const savedMatch = matchSavedAnswer(profile.savedAnswers || [], questionText);
            if (savedMatch && savedMatch.answerText.trim().length > 0) {
              sendResponse({
                type: 'ANSWER_AD_HOC_QUESTION_RESULT',
                success: true,
                answerText: savedMatch.answerText.trim(),
                confidence: 1.0,
                supportingClaimIds: [],
                notes: 'Retrieved instantly from your verified saved answers (0ms offline).',
              });
              return;
            }

            if (isUnsupportedAcademicQuestion(questionText, profile)) {
              sendResponse({
                type: 'ANSWER_AD_HOC_QUESTION_RESULT',
                success: false,
                error: 'This question needs your verified academic result or explanation. Add it to your profile or answer it manually before using autofill.',
              });
              return;
            }

            // 1b. Check deterministic profile attributes
            let fastPathAnswer: string | undefined;

            if ((questionLower.includes('country') || questionLower.includes('nation')) && !questionLower.includes('code')) {
              fastPathAnswer = profile.identity.location?.country;
            } else if ((questionLower.includes('state') || questionLower.includes('province') || questionLower.includes('region')) && (questionLower.includes('located') || questionLower.includes('live') || questionLower.includes('which') || questionLower.includes('what'))) {
              fastPathAnswer = profile.identity.location?.stateOrProvince;
            } else if (questionLower.includes('city') && (questionLower.includes('located') || questionLower.includes('live') || questionLower.includes('which') || questionLower.includes('what'))) {
              fastPathAnswer = profile.identity.location?.city;
            } else if (questionLower.includes('where') && (questionLower.includes('located') || questionLower.includes('live') || questionLower.includes('based') || questionLower.includes('reside'))) {
              fastPathAnswer = [profile.identity.location?.city, profile.identity.location?.stateOrProvince, profile.identity.location?.country].filter(Boolean).join(', ');
            } else if (questionLower.includes('phone') || questionLower.includes('telephone') || questionLower.includes('mobile')) {
              fastPathAnswer = profile.identity.phone;
            } else if (questionLower.includes('email')) {
              fastPathAnswer = profile.identity.email;
            } else if (questionLower.includes('current company') || questionLower.includes('current employer') || questionLower.includes('present employer')) {
              const curExp = profile.experiences.find((e) => e.isCurrent) || profile.experiences[0];
              fastPathAnswer = curExp?.company;
            } else if (questionLower.includes('current role') || questionLower.includes('current title') || questionLower.includes('current job') || questionLower.includes('present title')) {
              const curExp = profile.experiences.find((e) => e.isCurrent) || profile.experiences[0];
              fastPathAnswer = profile.professional.currentTitle || curExp?.title || profile.professional.headline;
            } else if (questionLower.includes('hear about') || questionLower.includes('referral source')) {
              fastPathAnswer = profile.professional.referralSource || (profile.links?.linkedin ? 'LinkedIn' : undefined);
            } else if ((questionLower.includes('authorized') || questionLower.includes('authorization') || questionLower.includes('right to work') || questionLower.includes('eligible to work')) && !questionLower.includes('sponsor')) {
              // Only answer legal questions the candidate has answered in their profile.
              if (profile.identity.workAuthorization?.confirmedByCandidate) {
                fastPathAnswer = profile.identity.workAuthorization.isAuthorizedInCountry
                  ? 'Yes, I am legally authorized to work in this country.'
                  : 'No, I am not currently authorized to work in this country.';
              }
            } else if (questionLower.includes('sponsor') || questionLower.includes('sponsorship')) {
              if (profile.identity.workAuthorization?.confirmedByCandidate) {
                fastPathAnswer = profile.identity.workAuthorization.requiresSponsorship
                  ? 'Yes, I will require employment visa sponsorship now or in the future.'
                  : 'No, I do not require employment visa sponsorship now or in the future.';
              }
            } else if (questionLower.includes('salary') || questionLower.includes('compensation') || questionLower.includes('expected pay') || questionLower.includes('desired pay')) {
              if (profile.professional.compensationExpectation?.targetSalaryMin) {
                fastPathAnswer = `${profile.professional.compensationExpectation.currency || 'USD'} ${profile.professional.compensationExpectation.targetSalaryMin.toLocaleString()}`;
              }
            } else if (questionLower.includes('notice') || questionLower.includes('notice period') || questionLower.includes('how much notice')) {
              if (profile.professional.noticePeriodDays != null) {
                fastPathAnswer = profile.professional.noticePeriodDays === 0
                  ? 'I can start right away. I have no notice period.'
                  : `${profile.professional.noticePeriodDays} days.`;
              }
            } else if (questionLower.includes('start date') || (questionLower.includes('start') && (questionLower.includes('when') || questionLower.includes('how soon')))) {
              fastPathAnswer = profile.professional.earliestStartDate || (profile.professional.noticePeriodDays != null ? `${profile.professional.noticePeriodDays} days notice` : undefined);
            } else if (questionLower.includes('relocat')) {
              fastPathAnswer = profile.professional.isOpenToRelocation
                ? 'Yes, I am open to relocating for the right opportunity.'
                : 'No, I am currently seeking remote roles or roles in my current location.';
            } else if (questionLower.includes('linkedin')) {
              fastPathAnswer = profile.links.linkedin;
            } else if (questionLower.includes('github')) {
              fastPathAnswer = profile.links.github;
            } else if (questionLower.includes('portfolio') || questionLower.includes('website')) {
              fastPathAnswer = profile.links.portfolio || profile.links.personalBlog;
            }

            // 1c. Check deterministic custom questions (e.g. distributed systems architecture, academics)
            if (!fastPathAnswer && !payload.userNotes) {
              const customDeterministic = resolveCustomFieldDeterministicValue(profile, {
                id: createFieldId('ad-hoc-field'),
                selector: 'textarea',
                fieldType: 'textarea',
                label: questionText,
                isRequired: false,
                confidenceScore: 0.95,
              });
              if (customDeterministic) {
                fastPathAnswer = customDeterministic;
              }
            }

            if (fastPathAnswer && fastPathAnswer.trim().length > 0) {
              sendResponse({
                type: 'ANSWER_AD_HOC_QUESTION_RESULT',
                success: true,
                answerText: fastPathAnswer.trim(),
                confidence: 1.0,
                supportingClaimIds: [],
                notes: 'Taken straight from your profile.',
              });
              return;
            }

            // ---------------------------------------------------------
            // Stage 2: Grounded AI Synthesis
            // ---------------------------------------------------------
            // Check if any AI provider is configured
            const keysStatus = await getApiKeysStatus();
            const hasAnyKey = keysStatus.openai || keysStatus.anthropic || keysStatus.gemini || keysStatus.openrouter;
            if (!hasAnyKey) {
              sendResponse({
                type: 'ANSWER_AD_HOC_QUESTION_RESULT',
                success: false,
                error: 'This one needs an AI key to draft. Add one in Settings, or write the answer yourself and save it for next time.',
              });
              return;
            }

            const evidenceGraph = await evidenceRepo.getEvidenceGraph();
            const evidenceList = evidenceGraph ? Array.from(evidenceGraph.evidenceMap.values()) : [];
            const candidateClaims = evidenceList.length > 0 ? deriveClaimsFromEvidence(evidenceList) : (profile.claims || []);

            // Coached prompt, grounding check, one retry with the problems, else nothing.
            const styleByTone: Record<string, ApplicationAnswerInput['style']> = {
              ats_aggressive: 'keywords',
              concise: 'concise',
              star: 'star',
              motivational: 'warm',
              bullets: 'bullets',
            };
            const openJob = await loadTailoringContext().then(({ job }) => job).catch(() => null);
            const brief = await companyBriefFor(openJob);
            const attempts: DraftAttempt[] = [];
            const drafted = await draftGroundedAnswer({
              onAttempt: (attempt) => attempts.push(attempt),
              companyFacts: brief?.facts,
              question: payload.question,
              profile,
              claims: candidateClaims,
              job: openJob,
              maxLength: payload.maxLength,
              style: styleByTone[payload.tone ?? ''] ?? 'default',
              candidateNote: payload.userNotes?.trim() || undefined,
              execute: (request) => aiGateway.executeRequest(request),
            });

            void logDraft({ question: payload.question, company: openJob?.companyName, facts: brief?.facts.length ?? 0, attempts, outcome: drafted.ok ? (drafted.removed ? 'repaired' : 'accepted') : drafted.draft ? 'needs_review' : 'dropped' });
            if (!drafted.ok) {
              sendResponse({
                type: 'ANSWER_AD_HOC_QUESTION_RESULT',
                success: false,
                error: drafted.reason,
                ...(drafted.draft ? { draftText: drafted.draft, problems: plainProblems(drafted.problems ?? [], openJob?.companyName) } : {}),
                ...(brief && brief.sources.length > 0 ? { companySources: brief.sources.map((source) => ({ ...source })) } : {}),
              });
              return;
            }

            sendResponse({
              type: 'ANSWER_AD_HOC_QUESTION_RESULT',
              success: true,
              answerText: drafted.text,
              confidence: drafted.confidence,
              supportingClaimIds: drafted.supportingClaimIds,
              notes: `${
                openJob
                  ? `Drafted from your resume, the ${openJob.companyName} posting${sourceLabels(brief) ? ` and ${sourceLabels(brief)}` : ''}.`
                  : 'Drafted from your resume.'
              }${drafted.removed && drafted.removed.length > 0 ? ` One sentence was cut because it said something your resume and the posting don't.` : ''} Read it before using it.`,
              ...(brief && brief.sources.length > 0 ? { companySources: brief.sources.map((source) => ({ ...source })) } : {}),
            });
          } catch (err) {
            sendResponse({
              type: 'ANSWER_AD_HOC_QUESTION_RESULT',
              success: false,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        })();
        return true;
      }

      case 'SAVE_REUSABLE_ANSWER': {
        const payload = message as SaveReusableAnswerRequest;
        (async () => {
          try {
            const profile = await profileRepo.getProfile();
            if (!profile) {
              sendResponse({
                type: 'SAVE_REUSABLE_ANSWER_RESULT',
                success: false,
                error: 'Candidate profile not initialized.',
              });
              return;
            }

            const now = new Date().toISOString();
            const newAnswer: SavedAnswer = {
              id: createSavedAnswerId(),
              canonicalKey: payload.question.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 50),
              promptPatterns: [payload.question.trim()],
              answerText: payload.answerText.trim(),
              category: (payload.category as AnswerCategory) || 'custom',
              tags: ['copilot_qa'],
              evidenceRefs: [],
              createdAt: now,
              updatedAt: now,
            };

            const existingAnswers = profile.savedAnswers || [];
            const filteredAnswers = existingAnswers.filter(
              (ans) => !ans.promptPatterns.some((p) => p.toLowerCase() === payload.question.trim().toLowerCase())
            );

            const updatedProfile: CandidateProfile = {
              ...profile,
              savedAnswers: [newAnswer, ...filteredAnswers],
              updatedAt: now,
            };

            await profileRepo.saveProfile(updatedProfile);

            sendResponse({
              type: 'SAVE_REUSABLE_ANSWER_RESULT',
              success: true,
              savedAnswerId: newAnswer.id,
            });
          } catch (err) {
            sendResponse({
              type: 'SAVE_REUSABLE_ANSWER_RESULT',
              success: false,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        })();
        return true;
      }

      case 'ANNOTATE_PAGE_WIDGETS': {
        // Only ever acts on the tab and frame that asked, never on a tab named in the payload.
        const tabId = sender.tab?.id;
        if (typeof tabId !== 'number') {
          sendResponse({ type: 'ANNOTATE_PAGE_WIDGETS_RESULT', success: false, annotated: 0, error: 'No tab' } satisfies AnnotatePageWidgetsResponse);
          return false;
        }
        annotatePageWidgets(tabId, sender.frameId)
          .then((annotated) => {
            sendResponse({ type: 'ANNOTATE_PAGE_WIDGETS_RESULT', success: true, annotated } satisfies AnnotatePageWidgetsResponse);
          })
          .catch((err) => {
            sendResponse({
              type: 'ANNOTATE_PAGE_WIDGETS_RESULT',
              success: false,
              annotated: 0,
              error: err instanceof Error ? err.message : String(err),
            } satisfies AnnotatePageWidgetsResponse);
          });
        return true;
      }

      case 'PICK_PAGE_WIDGET_OPTION': {
        const tabId = sender.tab?.id;
        if (typeof tabId !== 'number') {
          sendResponse({ type: 'PICK_PAGE_WIDGET_OPTION_RESULT', success: false, error: 'No tab' } satisfies PickPageWidgetOptionResponse);
          return false;
        }
        pickPageWidgetOption(tabId, sender.frameId, message.selector, message.wanted)
          .then((result) => {
            sendResponse({
              type: 'PICK_PAGE_WIDGET_OPTION_RESULT',
              success: result.ok,
              chosenLabel: result.chosenLabel,
              error: result.ok ? undefined : result.reason,
            } satisfies PickPageWidgetOptionResponse);
          })
          .catch((err) => {
            sendResponse({
              type: 'PICK_PAGE_WIDGET_OPTION_RESULT',
              success: false,
              error: err instanceof Error ? err.message : String(err),
            } satisfies PickPageWidgetOptionResponse);
          });
        return true;
      }

      case 'INSERT_TEXT_INTO_ACTIVE_ELEMENT': {
        const payload = message as InsertTextIntoActiveElementRequest;
        (async () => {
          try {
            const activeTab = await getActiveWebTab();
            if (!activeTab || !activeTab.id) {
              sendResponse({
                type: 'INSERT_TEXT_INTO_ACTIVE_ELEMENT_RESULT',
                success: false,
                error: 'No active browser tab found.',
              });
              return;
            }

            chrome.tabs.sendMessage(
              activeTab.id,
              {
                type: 'INSERT_TEXT_INTO_ACTIVE_ELEMENT',
                text: payload.text,
              },
              (res) => {
                if (chrome.runtime && chrome.runtime.lastError) {
                  sendResponse({
                    type: 'INSERT_TEXT_INTO_ACTIVE_ELEMENT_RESULT',
                    success: false,
                    error: chrome.runtime.lastError.message || 'Failed to communicate with active tab.',
                  });
                  return;
                }
                sendResponse(
                  res || {
                    type: 'INSERT_TEXT_INTO_ACTIVE_ELEMENT_RESULT',
                    success: true,
                  }
                );
              }
            );
          } catch (err) {
            sendResponse({
              type: 'INSERT_TEXT_INTO_ACTIVE_ELEMENT_RESULT',
              success: false,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        })();
        return true;
      }

      case 'EXECUTE_ONE_CLICK_AUTO_FILL': {
        const payload = message as ExecuteOneClickAutoFillRequest;
        (async () => {
          try {
            // Resolve target application form from payload or active DOM
            let targetForm = payload.form;
            if (!targetForm) {
              const inspectResult = await inspectFormsFromActiveTab();
              if (!inspectResult.success || !inspectResult.forms || inspectResult.forms.length === 0) {
                const res: ExecuteOneClickAutoFillResponse = {
                  type: 'EXECUTE_ONE_CLICK_AUTO_FILL_RESULT',
                  success: false,
                  error: inspectResult.error || 'No job application form detected on the active webpage. Please open or scroll to an application form.',
                };
                sendResponse(res);
                return;
              }
              targetForm = inspectResult.forms[0];
            }

            if (!targetForm) {
              const res: ExecuteOneClickAutoFillResponse = {
                type: 'EXECUTE_ONE_CLICK_AUTO_FILL_RESULT',
                success: false,
                error: 'No valid job application form detected.',
              };
              sendResponse(res);
              return;
            }

            const profile = await profileRepo.getProfile();
            if (!profile) {
              const res: ExecuteOneClickAutoFillResponse = {
                type: 'EXECUTE_ONE_CLICK_AUTO_FILL_RESULT',
                success: false,
                error: 'Candidate profile not initialized. Please configure your profile first.',
              };
              sendResponse(res);
              return;
            }

            let plan = generateDryRunPlan(targetForm, profile);

            // Synthesize grounded answers ONLY for fields not already resolved by deterministic planners or saved answers
            const aiAnswerableFields = targetForm.fields
              .filter((f) => isAiAnswerableCustomField(f, { includeChoiceFields: true }))
              .filter((field) => !plan.actions.some((a) => a.fieldId === field.id));
            if (aiAnswerableFields.length > 0) {
              try {
                const evidenceGraph = await evidenceRepo.getEvidenceGraph();
                const savedAnswers = profile.savedAnswers || [];
                const evidenceList = evidenceGraph ? Array.from(evidenceGraph.evidenceMap.values()) : [];
                const candidateClaims = evidenceList.length > 0
                  ? deriveClaimsFromEvidence(evidenceList)
                  : (profile.claims || []);

                const openJob = (await jobForFormPage(targetForm.url, targetForm.pageTitle)).job;
                const brief = await companyBriefFor(openJob);
                const knownClaimIds = new Set<string>(candidateClaims.map((claim) => claim.id));
                const answerPromises = aiAnswerableFields.map(async (field) => {
                  try {
                    if (!field.options || field.options.length === 0) {
                      const drafted = await draftGroundedAnswer({
                        question: field.label,
                        profile,
                        claims: candidateClaims,
                        job: openJob,
                        companyFacts: brief?.facts,
                        maxLength: field.maxLength,
                        execute: (request) => aiGateway.executeRequest(request),
                      });
                      return drafted.ok
                        ? { fieldId: field.id, answerText: drafted.text, confidence: drafted.confidence, supportingClaimIds: drafted.supportingClaimIds }
                        : null;
                    }

                    const relevantAnswers = savedAnswers.filter((ans) =>
                      field.label.toLowerCase().includes(ans.canonicalKey.toLowerCase()) ||
                      ans.promptPatterns.some((pattern) => field.label.toLowerCase().includes(pattern.toLowerCase()))
                    );

                    const labelKeywords = field.label
                      .toLowerCase()
                      .replace(/[^a-z0-9\s]/g, ' ')
                      .split(/\s+/)
                      .filter((w) => w.length > 2);

                    const keywordMatchedClaims = candidateClaims.filter((claim) => {
                      const statementLower = claim.statement.toLowerCase();
                      const tagsLower = (claim.tags || []).map((t) => t.toLowerCase());
                      return labelKeywords.some(
                        (kw) => statementLower.includes(kw) || tagsLower.some((t) => t.includes(kw))
                      );
                    });

                    const relevantClaims = keywordMatchedClaims.length >= 3
                      ? keywordMatchedClaims
                      : [
                          ...keywordMatchedClaims,
                          ...candidateClaims.slice(0, 10),
                        ].filter((c, idx, arr) => arr.findIndex((x) => x.id === c.id) === idx);

                    const context: FieldAnsweringContext = {
                      fieldLabel: field.label,
                      fieldType: field.fieldType,
                      options: field.options,
                      placeholder: field.placeholder,
                      relevantAnswers,
                      relevantClaims,
                      writingStyle: getWritingStyleFromProfile(profile),
                      answerLengthPreference: 'normal',
                      candidateExperiences: profile.experiences,
                      candidateSkills: profile.skills,
                      candidateEducation: profile.education,
                      candidateSummary: profile.professional?.summary || profile.professional?.headline,
                      fillingStrategy: 'ats_aggressive',
                    };

                    const request = buildFieldAnsweringPrompt(context);
                    const response = await aiGateway.executeRequest(request);

                    const parsed = parseAndValidateJsonResponse<{
                      answerText: string;
                      confidence: number;
                      supportingClaimIds: string[];
                      isGrounded: boolean;
                      notes: string;
                    }>(response.rawText, isAiFieldAnswerResult);
                    if (!parsed.success || !parsed.data) return null;

                    const answerText = sanitizeHumanText(parsed.data.answerText.trim());
                    // Same gate as everywhere else: no traceable resume line, no answer.
                    const supportingClaimIds = parsed.data.supportingClaimIds.filter((id) => knownClaimIds.has(id));
                    if (!answerText || supportingClaimIds.length === 0) return null;

                    return {
                      fieldId: field.id,
                      answerText,
                      confidence: parsed.data.confidence,
                      supportingClaimIds,
                    };
                  } catch (err) {
                    console.warn(`Failed to synthesize answer for field ${field.label}:`, err);
                    return null;
                  }
                });

                const settled = await Promise.allSettled(answerPromises);
                const answers: AiProposedFieldAnswer[] = [];
                for (const item of settled) {
                  if (item.status === 'fulfilled' && item.value) {
                    answers.push(item.value);
                  }
                }

                if (answers.length > 0) {
                  plan = withAiProposedFieldAnswers(plan, targetForm, answers);
                }
              } catch (aiErr) {
                console.warn('AI custom field answering encountered an issue during 1-click auto-fill:', aiErr);
              }
            }

            // One-click mode fills every planned field, including AI answers. The content
            // script independently blocks all submission controls.
            plan = approveAllActions(plan);
            activeDryRunPlan = plan;
            persistActivePlan();

            // Submission Hard Gate: execute approved actions on active tab while strictly halting before application submit controls
            const result = await executePlanOnActiveTab(plan, payload.options);
            if (result.success && result.report) {
              await recordApplicationExecution(plan, result.report);
            }

            const res: ExecuteOneClickAutoFillResponse = {
              type: 'EXECUTE_ONE_CLICK_AUTO_FILL_RESULT',
              success: result.success,
              report: result.report,
              plan,
              error: result.error,
            };
            sendResponse(res);
          } catch (err) {
            const res: ExecuteOneClickAutoFillResponse = {
              type: 'EXECUTE_ONE_CLICK_AUTO_FILL_RESULT',
              success: false,
              error: err instanceof Error ? err.message : String(err),
            };
            sendResponse(res);
          }
        })();
        return true;
      }

      case 'FACT_CHECK_DOCUMENT': {
        const payload = (message as any).payload || message;
        Promise.all([
          profileRepo.getProfile(),
          evidenceRepo.listEvidence(),
          evidenceRepo.listClaims(),
        ])
          .then(([profile, evidence, claims]) => {
            if (!profile) {
              throw new Error('Candidate profile not found.');
            }
            const graph = buildEvidenceGraph(evidence, claims);
            const factCheck = factCheckTailoredDocument(
              payload.text || '',
              profile,
              graph,
              payload.documentType || 'cover_letter'
            );
            const res: FactCheckDocumentResponse = {
              type: 'FACT_CHECK_DOCUMENT_RESULT',
              success: true,
              factCheck,
            };
            sendResponse(res);
          })
          .catch((err) => {
            sendResponse({
              type: 'FACT_CHECK_DOCUMENT_RESULT',
              success: false,
              error: err instanceof Error ? err.message : String(err),
            });
          });
        return true;
      }

      default:
        return false;
    }
  });
}

/**
 * Helper to retrieve candidate profile, target job, and evidence graph for document tailoring.
 */
/**
 * What ApplyKit can find about the open posting's company, for answers that should name
 * something specific about it. Uses the cache, the company's site, and a Gemini web
 * search when a Gemini key is saved. Never throws.
 */
async function companyBriefFor(job: JobPosting | null | undefined): Promise<CompanyBrief | null> {
  if (!job?.companyName) return null;
  try {
    const geminiKey = await getRawApiKey('gemini').catch(() => null);
    return await researchCompany(job, { geminiKey });
  } catch {
    return null;
  }
}

/** "monzo.com" style labels for the sources of company facts. */
function sourceLabels(brief: CompanyBrief | null): string {
  if (!brief || brief.facts.length === 0) return '';
  const hosts = [...new Set(brief.sources.map((source) => {
    try {
      return new URL(source.url).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  }).filter((host) => host && !/vertexaisearch|googleusercontent/.test(host)))];
  if (brief.via.includes('web_search')) return hosts.length > 0 ? `a web search (${hosts.slice(0, 2).join(', ')})` : 'a web search';
  return hosts[0] ?? 'the company website';
}

/** Last drafts and what the checker said, kept locally so problems can be looked into. */
const DRAFT_LOG_KEY = 'applykit_ai_draft_log';

async function logDraft(entry: { question: string; company?: string; facts: number; attempts: DraftAttempt[]; outcome: string }): Promise<void> {
  try {
    const stored = await chrome.storage.local.get(DRAFT_LOG_KEY);
    const log = ((stored[DRAFT_LOG_KEY] as unknown[]) ?? []).slice(-19);
    log.push({ at: new Date().toISOString(), ...entry });
    await chrome.storage.local.set({ [DRAFT_LOG_KEY]: log });
  } catch {
    // A log is a convenience.
  }
}

/** Checker messages rewritten for the candidate ("your resume", the company's name). */
function plainProblems(problems: readonly string[], company?: string): string[] {
  return [...new Set(problems)].map((problem) =>
    problem
      .replace(/the resume or the posting/g, company ? `your resume or the ${company} posting` : 'your resume')
      .replace(/^Name (.+?) and one specific fact about it from the company research or the posting\.$/, 'It never names $1, so it could have been sent to any company.')
      .replace(/^Name (.+?) and one specific thing from its posting\.$/, 'It never names $1, so it could have been sent to any company.')
  );
}

/** Where the last key check per provider is kept. Holds only the outcome, never the key. */
const KEY_CHECKS_STORAGE_KEY = 'applykit_key_checks';

async function saveKeyCheck(provider: AIProviderName, check: KeyCheckResult): Promise<void> {
  try {
    const stored = await chrome.storage.local.get(KEY_CHECKS_STORAGE_KEY);
    const checks = { ...((stored[KEY_CHECKS_STORAGE_KEY] as KeyChecks) ?? {}), [provider]: { ...check, checkedAt: new Date().toISOString() } };
    await chrome.storage.local.set({ [KEY_CHECKS_STORAGE_KEY]: checks });
  } catch {
    // The check result is a convenience for the Settings screen.
  }
}

/**
 * The saved job a form page belongs to (see `pickJobForPage`). Null when the form's
 * address names a company that is not the last job read and no saved job matches it.
 */
async function jobForFormPage(pageUrl: string, pageTitle?: string): Promise<ReturnType<typeof pickJobForPage>> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.LAST_JOB_POSTING);
  const lastJob = (stored[STORAGE_KEYS.LAST_JOB_POSTING] as JobPosting | undefined) ?? null;
  const savedJobs = await jobRepo.listJobs(50).catch(() => [] as JobPosting[]);
  return pickJobForPage(pageUrl, savedJobs, lastJob, pageTitle);
}

async function loadTailoringContext(jobId?: string) {
  const profile = await profileRepo.getProfile();
  if (!profile) {
    throw new Error('Candidate profile not found. Please create or import your profile.');
  }

  let job: JobPosting | null = null;
  if (jobId) {
    job = await jobRepo.getJobById(jobId as any);
  }
  if (!job && typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    const data = await chrome.storage.local.get(STORAGE_KEYS.LAST_JOB_POSTING);
    if (data[STORAGE_KEYS.LAST_JOB_POSTING]) {
      job = data[STORAGE_KEYS.LAST_JOB_POSTING] as JobPosting;
    }
  }
  if (!job) {
    throw new Error('No target job posting specified or currently detected on active tab.');
  }

  const evidence = await evidenceRepo.listEvidence();
  const claims = await evidenceRepo.listClaims();
  const graph = buildEvidenceGraph(evidence, claims);

  return { profile, job, graph };
}

/**
 * Monitors navigation events to detect ATS confirmation / thank-you pages automatically.
 */
if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.onUpdated) {
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url) {
      tabExtractionCache.delete(tabId);
    }
    if (changeInfo.status === 'complete' && tab && tab.url) {
      if (isSubmissionConfirmationUrl(tab.url).isConfirmation) {
        processSubmissionDetection(tab.url, tab.title).catch(() => {
          // Non-critical background observation
        });
      }
    }
  });
}

if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.onRemoved) {
  chrome.tabs.onRemoved.addListener((tabId) => {
    tabExtractionCache.delete(tabId);
  });
}
