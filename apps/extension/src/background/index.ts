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
} from '@applykit/domain';
import {
  parsePlainTextResume,
  createProfileFromParsedResume,
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
  exportAuditTrailAsJson,
  exportAuditTrailAsCsv,
  tailorCandidateResume,
  generateGroundedCoverLetter,
  factCheckTailoredDocument,
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
  GenerateCoverLetterResponse,
  GenerateCoverLetterPdfResponse,
  GenerateResumePdfResponse,
  FactCheckDocumentResponse,
  GetStorageUsageResponse,
} from '../messages/contracts.js';

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
 * the LLM is only consulted to rescue empty signal (Phase 2 fallback, ADR-0020).
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

            const profileWithClaims: CandidateProfile = {
              ...profile,
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
              const aiRes = await aiGateway.executeRequest(aiReq);

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
            const form = message.form;

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
                maxLength: field.maxLength,
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
            });
            const textToAudit = [
              tailoredResume.tailoredSummary,
              ...tailoredResume.experiences.flatMap((e) => e.rankedHighlights.map((h) => h.text)),
              ...tailoredResume.projects.flatMap((p) => p.rankedHighlights.map((h) => h.text)),
            ].join('\n');
            const factCheck = factCheckTailoredDocument(textToAudit, profile, graph, 'resume');
            const res: GenerateTailoredResumeResponse = {
              type: 'GENERATE_TAILORED_RESUME_RESULT',
              success: true,
              tailoredResume,
              factCheck,
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
              const pdfBase64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
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
              });
              const pdfBlob = await generateResumePdfBlob(tailoredResume);
              const arrayBuffer = await pdfBlob.arrayBuffer();
              const pdfBase64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
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
 * Automatically seeds Jephter Olamiposi Olaifa's profile, claims, evidence graph,
 * and Gemini API key on first launch if storage is uninitialized.
 */
async function bootstrapInitialCandidateData(): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;

  try {
    // 1. Seed Gemini API key if not configured
    const keyData = await chrome.storage.local.get(STORAGE_KEYS.PROVIDER_KEYS);
    const existingKeys = (keyData[STORAGE_KEYS.PROVIDER_KEYS] as Record<string, string>) || {};
    if (!existingKeys.gemini) {
      await chrome.storage.local.set({ [STORAGE_KEYS.PROVIDER_KEYS]: existingKeys });
    }

    // 2. Seed profile if no candidate profile exists
    const existingProfile = await profileRepo.getProfile();
    if (!existingProfile) {
      const RAW_RESUME_TEXT = `Jephter Olamiposi Olaifa
jephterolaifa@gmail.com  |  github.com/jephter-olamiposi  |  linkedin.com/in/jephter-olaifa  |  dev.to/iamjephter
SKILLS
Languages: Rust, TypeScript, JavaScript, Python
Frameworks: Axum, Tokio, Node.js, Express, NestJS, gRPC, React, Next.js
Databases: PostgreSQL, SurrealDB, Redis, MongoDB
Infrastructure & Tools: AWS, Docker, Kubernetes, CI/CD, GitHub Actions
Focus Areas: System Design, Distributed Systems, Financial Systems, Observability
WORK EXPERIENCE
Software Engineer — CoreServe — Rust
Feb 2026 – Aug 2026
* Engineered a production-grade, multi-tenant backend for a waste recycling and logistics platform using Rust, Axum, Tokio, SQLx, and PostgreSQL.
* Designed transaction-safe wallet, billing, settlement, and payout workflows with maker-checker approval, idempotent processing, cancellation lifecycles, and automated reconciliation.
* Built asynchronous workers for billing, payout dispatch, settlement, reporting, scheduled pickups, notifications, and reconciliation with bounded concurrency and retry handling; implemented tenant-isolated data access, role-based authorization, and JWT authentication.
* Developed APIs for marketplace orders, inventory, pickup scheduling, dashboards, and operational metrics across administrators, aggregators, clients, and field staff.
Backend Engineer — GeoResinStore
Mar 2025 – Feb 2026
* Architected a modular e-commerce backend for a leading Nigerian resin art supplier using Node.js and PostgreSQL.
* Implemented server-side Paystack and Flutterwave webhook verification to prevent payment tampering and automate order confirmation.
* Architected a multi-tenant invoicing backend with isolated business profiles, role-based access control, and configurable branding using NestJS.
* Engineered an inventory state machine with checkout-time stock reservations to prevent overselling under concurrent demand.
* Built administrative APIs for order processing, status tracking, inventory operations, and automated logistics email notifications.
Software Engineer — Internet Number Technologies — Rust
Feb 2025 – Oct 2025
* Architected the control plane for a production-grade telephony platform orchestrating real-time communication, subscriptions, and billing for thousands of users.
* Engineered a high-throughput signaling backend with Rust and Axum to manage session lifecycles for Web-to-PSTN calls.
* Designed a type-safe SurrealDB persistence layer for subscription models and automated top-ups, protecting financial state across complex billing flows.
* Implemented dynamic codec negotiation and SIP bridging logic to support reliable, low-latency audio delivery.
Software Engineer — Billeva
May 2024 – Present
* Engineered an asynchronous streaming CSV import pipeline for processing large customer datasets without blocking request workflows.
* Designed a configurable mapping engine that transformed arbitrary CSV columns into validated internal data models.
Software Engineer — Freelance
Mar 2023 – Feb 2025
* Developed backend services for decentralized applications, creating an interoperability layer between React clients and Rust-based Solana smart contracts.
* Established reusable GitHub Actions CI/CD pipelines to automate testing and deployment across client projects.
Software Engineer — B-glow Creations
Aug 2022 – Feb 2023
* Built a fashion e-commerce website in React, including the customer-facing storefront and an admin dashboard for managing products, orders, and inventory.
PERSONAL PROJECTS
* wsblast (Rust) — Built a high-performance WebSocket load-testing CLI with zero-allocation hot paths, lock-free task-local latency histograms (HdrHistogram), and CI/CD SLO gating (p50/p95/p99/p99.9, error-rate budgets) that fails builds on regression; published on crates.io with a Ratatui live dashboard and JSON/Markdown reporting.
* Echo (Rust, Tauri, SQLite) — Built a cross-platform clipboard synchronization engine with a low-memory Rust daemon that captures OS-level clipboard events and synchronizes history across desktop and mobile clients.
* Real-Time Multiplayer Game Engine (Rust, Axum, Tokio, Egui) — Engineered a distributed multiplayer system with a native desktop client and an asynchronous Axum WebSocket server for low-latency game-state synchronization.
EDUCATION
Ladoke Akintola University of Technology — BSc, Information Systems`;

      const parsed = parsePlainTextResume(RAW_RESUME_TEXT);
      const { profile, evidence } = createProfileFromParsedResume(parsed);
      const claims = deriveClaimsFromEvidence(evidence);

      await Promise.all([
        profileRepo.saveProfile({ ...profile, claims }),
        evidenceRepo.saveEvidenceBatch(evidence),
        evidenceRepo.saveClaimBatch(claims),
        chrome.storage.local.set({ applykit_onboarding_completed: true }),
      ]);
    }
  } catch (err) {
    console.error('Failed to bootstrap initial candidate profile:', err);
  }
}

// Run bootstrap when background script initializes in extension runtime
if (typeof process === 'undefined' || !process.env || (process.env.NODE_ENV !== 'test' && !process.env.VITEST)) {
  void bootstrapInitialCandidateData();
}

