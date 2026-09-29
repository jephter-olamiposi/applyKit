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
  ActionId,
  ExecutionOptions,
  ExecutionReport,
  ApplicationRecord,
  ApplicationId,
  ApplicationState,
  AiJobExtractionResult,
  FieldAnsweringContext,
  AiProposedFieldAnswer,
  ApplicationField,
  ApplicationForm,
  WritingStyleProfile,
  SavedAnswer,
  AnswerCategory,
  EvidenceId,
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
  matchSavedAnswer,
  exportAuditTrailAsJson,
  exportAuditTrailAsCsv,
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
  isAiAnswerableCustomField,
  withAiProposedFieldAnswers,
  getWritingStyleFromProfile,
} from '@applykit/domain';
import {
  generateCoverLetterPdfBlob,
  generateResumePdfBlob,
} from '@applykit/domain/pdf-exporter';

import type {
  ApiKeysStatus,
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
  ListSavedJobsResponse,
  ListApplicationsResponse,
  GetApplicationDetailResponse,
  UpdateApplicationStatusRequest,
  UpdateApplicationStatusResponse,
  DeleteApplicationRecordResponse,
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
  GetActivePlanResponse,
  AnswerCustomFieldsRequest,
  AnswerCustomFieldsResponse,
  UpdatePlanActionResponse,
  TogglePlanActionApprovalResponse,
  ExcludePlanActionResponse,
  ExecutePlanResponse,
  ExecuteContentPlanRequest,
  ExecuteContentPlanResponse,
  HighlightFormFieldResponse,
  ClearFormFieldHighlightResponse,
  ToggleInPageReviewBadgesResponse,
  BatchApprovePlanActionsResponse,
  ExecuteSelectiveActionResponse,
  GenerateTailoredResumeResponse,
  AutoFixResumeRequest,
  AutoFixResumeResponse,
  AnswerAdHocQuestionRequest,
  AnswerAdHocQuestionResponse,
  GroundedEvidenceCitation,
  SaveReusableAnswerRequest,
  SaveReusableAnswerResponse,
  InsertTextIntoActiveElementRequest,
  InsertTextIntoActiveElementResponse,
  ExecuteOneClickAutoFillRequest,
  ExecuteOneClickAutoFillResponse,
  GenerateCoverLetterResponse,
  GenerateCoverLetterPdfResponse,
  GenerateResumePdfResponse,
  FactCheckDocumentResponse,
  GetStorageUsageResponse,
  BootstrapProfileFromResumeRequest,
  BootstrapProfileFromResumeResponse,
  CommitBootstrappedProfileRequest,
  CommitBootstrappedProfileResponse,
  SubmissionDetectedNotification,
  SubmissionDetectedResponse,
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
  purgeAllLocalData,
  purgeAllCandidateData,
  getStorageUsageSummary,
} from '../storage/index.js';

import { AIGateway } from '../ai/gateway.js';

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
} as const;

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
 * In-memory fallback extraction cache indexed by tab ID.
 */
const tabExtractionCache = new Map<number, ExtractedPageData>();

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
 * Retrieves the current configured status of provider API keys.
 *
 * Invariant (ADR-0002): Returns boolean indicators only. Never returns raw secret keys.
 */
export async function getApiKeysStatus(): Promise<ApiKeysStatus> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.PROVIDER_KEYS);
  const keys = (result[STORAGE_KEYS.PROVIDER_KEYS] as Record<string, string>) || {};

  return {
    openai: Boolean(keys.openai && keys.openai.trim().length > 0),
    anthropic: Boolean(keys.anthropic && keys.anthropic.trim().length > 0),
    gemini: Boolean(keys.gemini && keys.gemini.trim().length > 0),
    openrouter: Boolean(keys.openrouter && keys.openrouter.trim().length > 0),
  };
}

/**
 * Securely persists an AI provider API key in background storage.
 *
 * @param provider The provider identifier.
 * @param apiKey The raw secret API key.
 */
export async function setApiKey(provider: AIProviderName, apiKey: string): Promise<boolean> {
  const existing = await chrome.storage.local.get(STORAGE_KEYS.PROVIDER_KEYS);
  const currentKeys = (existing[STORAGE_KEYS.PROVIDER_KEYS] as Record<string, string>) || {};

  currentKeys[provider] = apiKey.trim();
  await chrome.storage.local.set({ [STORAGE_KEYS.PROVIDER_KEYS]: currentKeys });
  return true;
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
  tabExtractionCache.set(tabId, response.data);
  if (response.jobPosting) {
    await jobRepo.saveJob(response.jobPosting);
  }
  await chrome.storage.local.set({
    [STORAGE_KEYS.LAST_EXTRACTION]: response.data,
    ...(response.jobPosting ? { [STORAGE_KEYS.LAST_JOB_POSTING]: response.jobPosting } : {}),
  });
  return response;
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
    const storedJob = await chrome.storage.local.get(STORAGE_KEYS.LAST_JOB_POSTING);
    const job = storedJob[STORAGE_KEYS.LAST_JOB_POSTING] as JobPosting | undefined;

    const companyName = job?.companyName || plan.detectedAts.toUpperCase();
    const jobTitle = job?.title || 'Job Application';
    const jobPostingUrl = plan.formUrl || job?.url || '';

    // Check if an existing application record exists for this job
    let app: ApplicationRecord | null = null;
    if (job?.id) {
      app = await appRepo.getApplicationByJobId(job.id);
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
        matchedRequirementsScore: 0,
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
 * Message listener orchestrating requests between extension components.
 */
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message !== 'object' || !('type' in message)) {
      return false;
    }

    const type = (message as { type: string }).type;

    switch (type) {
      case 'PING': {
        const pong: PingResponse = {
          type: 'PONG',
          timestamp: Date.now(),
        };
        sendResponse(pong);
        return false;
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
        if (typeof payload.apiKey !== 'string' || payload.apiKey.trim().length === 0) {
          sendResponse({
            type: 'SET_API_KEY_RESULT',
            success: false,
            provider: payload.provider,
            error: 'API key must be a non-empty string.',
          });
          return true;
        }
        setApiKey(payload.provider, payload.apiKey)
          .then(() => {
            const res: SetApiKeyResponse = {
              type: 'SET_API_KEY_RESULT',
              success: true,
              provider: payload.provider,
            };
            sendResponse(res);
          })
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
        chrome.storage.local
          .get([STORAGE_KEYS.LAST_EXTRACTION, STORAGE_KEYS.LAST_JOB_POSTING])
          .then((stored) => {
            const data = (stored[STORAGE_KEYS.LAST_EXTRACTION] as ExtractedPageData) || null;
            const jobPosting = (stored[STORAGE_KEYS.LAST_JOB_POSTING] as any) || null;
            const res: CurrentExtractionResponse = {
              type: 'CURRENT_EXTRACTION_RESULT',
              data,
              jobPosting,
            };
            sendResponse(res);
          })
          .catch(() => {
            sendResponse({
              type: 'CURRENT_EXTRACTION_RESULT',
              data: null,
              jobPosting: null,
            });
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
            const candidateClaims = evidenceList.length > 0 ? deriveClaimsFromEvidence(evidenceList) : [];

            const aiAnswerableFields = form.fields.filter((field: ApplicationField) =>
              isAiAnswerableCustomField(field)
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

            for (const field of aiAnswerableFields) {
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

              // Supply keyword matches supplemented by candidate core evidence so context is never starved
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
              };

              const request = buildFieldAnsweringPrompt(context);
              const response = await aiGateway.executeRequest(request);

              interface FieldAnsweringResult {
                answerText: string;
                confidence: number;
                supportingClaimIds: string[];
                isGrounded: boolean;
                notes: string;
              }

              function isFieldAnsweringResult(value: unknown): value is FieldAnsweringResult {
                return (
                  typeof value === 'object' &&
                  value !== null &&
                  typeof (value as Record<string, unknown>).answerText === 'string' &&
                  typeof (value as Record<string, unknown>).confidence === 'number' &&
                  Array.isArray((value as Record<string, unknown>).supportingClaimIds)
                );
              }

              const parsed = parseAndValidateJsonResponse<FieldAnsweringResult>(
                response.rawText,
                isFieldAnsweringResult
              );

              if (parsed.success && parsed.data) {
                const answerText = parsed.data.answerText.trim();
                if (answerText) {
                  const confidence = Math.min(1, Math.max(0, parsed.data.confidence ?? 0.8));
                  const supportingClaimIds = parsed.data.supportingClaimIds?.length > 0
                    ? parsed.data.supportingClaimIds
                    : relevantClaims.slice(0, 3).map((c) => c.id);
                  answers.push({
                    fieldId: field.id,
                    answerText,
                    confidence,
                    supportingClaimIds,
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
        const payload = message as { format: 'json' | 'csv' };
        appRepo
          .listApplications(1000)
          .then((applications) => {
            const isJson = payload.format === 'json';
            const content = isJson
              ? exportAuditTrailAsJson(applications)
              : exportAuditTrailAsCsv(applications);
            const timestamp = new Date().toISOString().slice(0, 10);
            const filename = `applykit-audit-trail-${timestamp}.${isJson ? 'json' : 'csv'}`;
            const mimeType = isJson ? 'application/json' : 'text/csv';

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
              if (profile.identity.workAuthorization) {
                fastPathAnswer = profile.identity.workAuthorization.isAuthorizedInCountry
                  ? 'Yes, I am legally authorized to work in this country.'
                  : 'No, I am not currently authorized to work in this country.';
              }
            } else if (questionLower.includes('sponsor') || questionLower.includes('sponsorship')) {
              if (profile.identity.workAuthorization) {
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
                  ? 'Immediate — I can start right away without a notice period.'
                  : `${profile.professional.noticePeriodDays} days notice period.`;
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

            if (fastPathAnswer && fastPathAnswer.trim().length > 0) {
              sendResponse({
                type: 'ANSWER_AD_HOC_QUESTION_RESULT',
                success: true,
                answerText: fastPathAnswer.trim(),
                confidence: 1.0,
                supportingClaimIds: [],
                notes: 'Resolved deterministically from verified profile attributes (0ms offline).',
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
                error: 'No AI provider API key configured. You can get a free Google Gemini key in 1 click at https://aistudio.google.com/app/apikey (100% free) and add it in Settings, or configure your profile answers to enable offline fast-path answering.',
              });
              return;
            }

            const evidenceGraph = await evidenceRepo.getEvidenceGraph();
            const savedAnswers = profile.savedAnswers || [];
            const evidenceList = evidenceGraph ? Array.from(evidenceGraph.evidenceMap.values()) : [];
            const candidateClaims = evidenceList.length > 0 ? deriveClaimsFromEvidence(evidenceList) : (profile.claims || []);

            // Tokenize question for keyword matching against evidence claims
            const qTokens = questionLower.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2);
            const matchedClaims = candidateClaims.filter((claim) => {
              const stmt = claim.statement.toLowerCase();
              const tags = (claim.tags || []).map((t) => t.toLowerCase());
              return qTokens.some((t) => stmt.includes(t) || tags.some((tag) => tag.includes(t)));
            });

            const relevantClaims = matchedClaims.length >= 3
              ? matchedClaims.slice(0, 10)
              : [...matchedClaims, ...candidateClaims.slice(0, 10)].filter((c, idx, arr) => arr.findIndex((x) => x.id === c.id) === idx);

            // Build tone instructions
            let toneInstruction = '';
            if (payload.tone === 'star') {
              toneInstruction = ' Structure the response using the STAR method (Situation, Task, Action, Result).';
            } else if (payload.tone === 'concise') {
              toneInstruction = ' Keep the response extremely concise, direct, and factual.';
            } else if (payload.tone === 'motivational') {
              toneInstruction = ' Use an engaging, enthusiastic, and forward-looking tone.';
            } else if (payload.tone === 'bullets') {
              toneInstruction = ' Format the response using concise, impact-oriented bullet points.';
            }

            const context: FieldAnsweringContext = {
              fieldLabel: `${payload.question}${toneInstruction}${payload.maxLength ? ` (Strict limit: max ${payload.maxLength} characters)` : ''}`,
              fieldType: 'textarea',
              relevantAnswers: savedAnswers.slice(0, 5),
              relevantClaims,
              writingStyle: getWritingStyleFromProfile(profile),
              answerLengthPreference: payload.maxLength && payload.maxLength < 200 ? 'short' : 'normal',
              candidateExperiences: profile.experiences,
              candidateSkills: profile.skills,
              candidateEducation: profile.education,
              candidateSummary: profile.professional?.summary || profile.professional?.headline,
            };

            const request = buildFieldAnsweringPrompt(context);
            const response = await aiGateway.executeRequest(request);

            interface FieldAnsweringResult {
              answerText: string;
              confidence: number;
              supportingClaimIds: string[];
              isGrounded: boolean;
              notes: string;
            }

            function isFieldAnsweringResult(value: unknown): value is FieldAnsweringResult {
              return (
                typeof value === 'object' &&
                value !== null &&
                typeof (value as Record<string, unknown>).answerText === 'string'
              );
            }

            const parsed = parseAndValidateJsonResponse<FieldAnsweringResult>(
              response.rawText,
              isFieldAnsweringResult
            );

            let finalAnswer = parsed.success && parsed.data ? parsed.data.answerText.trim() : '';
            if (!finalAnswer) {
              try {
                const cleaned = response.rawText.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
                const obj = JSON.parse(cleaned);
                if (obj && typeof obj.answerText === 'string') {
                  finalAnswer = obj.answerText.trim();
                } else if (obj && typeof obj.answer === 'string') {
                  finalAnswer = obj.answer.trim();
                }
              } catch {
                finalAnswer = response.rawText.trim();
              }
            }

            const confidence = parsed.success && parsed.data ? (parsed.data.confidence ?? 0.85) : 0.85;
            const supportingClaimIds = parsed.success && parsed.data ? (parsed.data.supportingClaimIds || []) : relevantClaims.slice(0, 3).map((c) => c.id);

            // Enforce character limit if specified
            if (payload.maxLength && finalAnswer.length > payload.maxLength) {
              const truncated = finalAnswer.slice(0, payload.maxLength);
              const lastPeriod = truncated.lastIndexOf('.');
              if (lastPeriod > payload.maxLength * 0.7) {
                finalAnswer = truncated.slice(0, lastPeriod + 1);
              } else {
                finalAnswer = truncated.trim();
              }
            }

            sendResponse({
              type: 'ANSWER_AD_HOC_QUESTION_RESULT',
              success: true,
              answerText: finalAnswer,
              confidence,
              supportingClaimIds,
              notes: 'Synthesized with AI strictly grounded in verified evidence claims.',
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

            // Synthesize grounded answers for custom questions where deterministic mappings do not apply
            const aiAnswerableFields = targetForm.fields.filter(isAiAnswerableCustomField);
            if (aiAnswerableFields.length > 0) {
              try {
                const evidenceGraph = await evidenceRepo.getEvidenceGraph();
                const savedAnswers = profile.savedAnswers || [];
                const evidenceList = evidenceGraph ? Array.from(evidenceGraph.evidenceMap.values()) : [];
                const candidateClaims = evidenceList.length > 0
                  ? deriveClaimsFromEvidence(evidenceList)
                  : (profile.claims || []);

                const answerPromises = aiAnswerableFields.map(async (field) => {
                  try {
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
                    };

                    const request = buildFieldAnsweringPrompt(context);
                    const response = await aiGateway.executeRequest(request);

                    let answerText = '';
                    try {
                      const cleaned = response.rawText.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
                      const obj = JSON.parse(cleaned);
                      if (obj && typeof obj.answerText === 'string') {
                        answerText = obj.answerText.trim();
                      } else if (obj && typeof obj.answer === 'string') {
                        answerText = obj.answer.trim();
                      }
                    } catch {
                      answerText = response.rawText.trim();
                    }

                    if (answerText && answerText.length > 0) {
                      return {
                        fieldId: field.id,
                        answerText,
                        confidence: 0.85,
                        supportingClaimIds: relevantClaims.slice(0, 3).map((c) => c.id),
                      };
                    }
                    return null;
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

            // Batch-approve planned candidate actions for single-click dispatch
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
 * Monitors navigation events to detect ATS confirmation / thank-you pages automatically (Phase 20).
 */
if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.onUpdated) {
  chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab && tab.url) {
      if (isSubmissionConfirmationUrl(tab.url).isConfirmation) {
        processSubmissionDetection(tab.url, tab.title).catch(() => {
          // Non-critical background observation
        });
      }
    }
  });
}


