/**
 * @fileoverview Typed message contracts across Chrome extension execution contexts.
 *
 * MV3 architectures divide execution across isolated contexts:
 * 1. Content scripts (untrusted webpage DOM access, zero secrets allowed)
 * 2. Background service worker (trusted core, sole gateway for network and secrets)
 * 3. Side panel UI (extension-origin user review interface)
 *
 * All inter-context communication MUST be typed and validated against these schemas.
 */

import type {
  AIProviderName,
  JobPosting,
  CandidateProfile,
  ApplicationRecord,
  ApplicationId,
  ApplicationState,
  Evidence,
  CandidateClaim,
  GroundingAuditReport,
  AIRequest,
  AIResponse,
  TokenUsage,
  Requirement,
  JobMatchMatrix,
  GapAnalysisReport,
  HighlightSuggestion,
  ApplicationForm,
  DryRunPlan,
  ActionId,
  PlanId,
  ExecutionReport,
  ExecutionOptions,
  TailoredResume,
  TailoredCoverLetter,
  FactCheckReport,
  ResumeTemplateId,
  ResumeQualityAuditReport,
  AnswerCategory,
  SpacingDensity,
  SourcedOpportunity,
} from '@applykit/domain';
import type { StorageUsageSummary, PurgeResult } from '../storage/purge-engine.js';

/**
 * Raw extraction payload produced by content script DOM crawlers.
 *
 * Untrusted page text is strictly packaged alongside an XML-sanitized
 * representation to mitigate indirect prompt injection attacks downstream.
 */
export interface ExtractedPageData {
  /** The full URL of the active webpage where extraction occurred. */
  url: string;
  /** Document title extracted from the `<title>` tag. */
  title: string;
  /** Meta description from `<meta name="description">` or OpenGraph tags if present. */
  metaDescription?: string;
  /** Meta keywords extracted from `<meta name="keywords">`. */
  metaKeywords?: string[];
  /** Canonical link target if specified by `<link rel="canonical">`. */
  canonicalUrl?: string;
  /** OpenGraph title attribute for social share cards. */
  ogTitle?: string;
  /** OpenGraph site name attribute identifying the ATS or company portal. */
  ogSiteName?: string;
  /** Top-level H1 headings present in the main content container. */
  h1: string[];
  /** Secondary section headings (H2, H3) helping outline job structure. */
  headings: string[];
  /** Currently selected text on the page, if the user highlighted a specific job section. */
  selectedText?: string;
  /** Normalized, stripped text content of visible webpage body elements. */
  cleanBodyText: string;
  /**
   * Untrusted page content safely demarcated within `<untrusted_job_content>` XML tags.
   * Mandated by ADR-0005 to prevent prompt injection when forwarded to AI models.
   */
  sanitizedXml: string;
  /** Structured JSON-LD schemas discovered in `<script type="application/ld+json">` tags. */
  jsonLd: Record<string, unknown>[];
  /** ISO 8601 timestamp marking when extraction was performed. */
  extractedAt: string;
}

/**
 * Boolean-only presence flags for configured AI provider keys.
 *
 * Invariant (ADR-0002): Never send raw API keys to UI or content script callers.
 * The background context reports ONLY whether a key exists, preserving credential isolation.
 */
export type ApiKeysStatus = Record<AIProviderName, boolean>;

/**
 * High-level summary of candidate profile for quick side panel status display.
 */
export interface CandidateProfileSummary {
  /** Unique candidate identifier. */
  id: string;
  /** Candidate's full name. */
  fullName: string;
  /** Professional headline. */
  headline: string;
  /** Primary contact email address. */
  email: string;
  /** Count of verified skills associated with the profile. */
  skillsCount: number;
  /** Count of historical employment and contract positions. */
  experienceCount: number;
  /** Count of evidence-backed claims in the candidate's evidence graph. */
  claimsCount: number;
  /** Whether core identity and at least one experience or skill are populated. */
  isComplete: boolean;
}

/**
 * Ping message used for context handshake and liveness detection.
 */
export interface PingRequest {
  type: 'PING';
}

export interface PingResponse {
  type: 'PONG';
  timestamp: number;
}

/**
 * Trigger DOM extraction inside the active tab's content script.
 */
export interface ExtractJobRequest {
  type: 'EXTRACT_JOB';
}

export interface ExtractJobResponse {
  type: 'EXTRACT_JOB_RESULT';
  success: boolean;
  data?: ExtractedPageData;
  jobPosting?: JobPosting;
  error?: string;
  /** True when the posting was produced (or refined) by the LLM fallback extractor. */
  aiRefined?: boolean;
  /** Non-fatal diagnostic when the LLM fallback failed but deterministic data was preserved. */
  aiExtractionError?: string;
}

/**
 * Query provider key configuration status from the background service worker.
 */
export interface GetApiKeysStatusRequest {
  type: 'GET_API_KEYS_STATUS';
}

export interface GetApiKeysStatusResponse {
  type: 'API_KEYS_STATUS_RESULT';
  status: ApiKeysStatus;
}

/**
 * Store a provider API key securely in background `chrome.storage.local`.
 */
export interface SetApiKeyRequest {
  type: 'SET_API_KEY';
  provider: AIProviderName;
  apiKey: string;
}

export interface SetApiKeyResponse {
  type: 'SET_API_KEY_RESULT';
  success: boolean;
  provider: AIProviderName;
  error?: string;
}

/**
 * Fetch candidate profile summary from background storage.
 */
export interface GetCandidateProfileSummaryRequest {
  type: 'GET_CANDIDATE_PROFILE_SUMMARY';
}

export interface GetCandidateProfileSummaryResponse {
  type: 'CANDIDATE_PROFILE_SUMMARY_RESULT';
  summary?: CandidateProfileSummary;
  error?: string;
}

/**
 * Retrieve the most recently cached extraction for the active tab.
 */
export interface GetCurrentExtractionRequest {
  type: 'GET_CURRENT_EXTRACTION';
}

export interface CurrentExtractionResponse {
  type: 'CURRENT_EXTRACTION_RESULT';
  data: ExtractedPageData | null;
  jobPosting?: JobPosting | null;
}

/**
 * Fetch full candidate profile from background storage.
 */
export interface GetCandidateProfileRequest {
  type: 'GET_CANDIDATE_PROFILE';
}

export interface GetCandidateProfileResponse {
  type: 'CANDIDATE_PROFILE_RESULT';
  profile: CandidateProfile | null;
}

/**
 * Persist updated candidate profile to background storage.
 */
export interface SaveCandidateProfileRequest {
  type: 'SAVE_CANDIDATE_PROFILE';
  profile: CandidateProfile;
}

export interface SaveCandidateProfileResponse {
  type: 'SAVE_CANDIDATE_PROFILE_RESULT';
  success: boolean;
  error?: string;
}

/**
 * Request to export candidate profile into job-application-pipeline YAML format.
 */
export interface ExportProfileYamlRequest {
  type: 'EXPORT_PROFILE_YAML';
}

/**
 * Result payload containing the generated profile.yaml string.
 */
export interface ExportProfileYamlResponse {
  type: 'EXPORT_PROFILE_YAML_RESULT';
  success: boolean;
  yaml?: string;
  filename?: string;
  error?: string;
}

/**
 * Request to import and merge profile.yaml into local candidate profile.
 */
export interface ImportProfileYamlRequest {
  type: 'IMPORT_PROFILE_YAML';
  yamlContent: string;
}

/**
 * Result payload after parsing and saving candidate profile from YAML.
 */
export interface ImportProfileYamlResponse {
  type: 'IMPORT_PROFILE_YAML_RESULT';
  success: boolean;
  profile?: CandidateProfile;
  error?: string;
}

/**
 * Request to fetch and screen live jobs from direct ATS boards (Greenhouse, Ashby, Lever).
 */
export interface FetchAtsJobsRequest {
  type: 'FETCH_ATS_JOBS';
  /** Optional custom company slugs or undefined to scan the curated default watchlist. */
  slugs?: readonly { name: string; slug: string; platform: 'greenhouse' | 'ashby' | 'lever' }[];
  /** Optional keyword filter (e.g. 'backend', 'staff', 'typescript'). */
  keyword?: string;
  /** Temporary workplace filter for this search; saved profile preference remains unchanged. */
  workplacePreference?: 'remote' | 'hybrid' | 'onsite' | 'any';
  /** Temporary employment filter for this search; saved profile preference remains unchanged. */
  employmentPreference?: 'full_time' | 'part_time' | 'contract' | 'internship' | 'any';
}

/**
 * Per-provider result for a bounded ATS sourcing scan.
 */
export interface AtsSourceStatus {
  readonly company: string;
  readonly platform: 'greenhouse' | 'ashby' | 'lever';
  readonly status: 'ok' | 'failed';
  readonly error?: string;
}

/**
 * Result payload containing normalized, 5-gate screened, and EV-ranked opportunities.
 */
export interface FetchAtsJobsResponse {
  type: 'FETCH_ATS_JOBS_RESULT';
  success: boolean;
  opportunities: SourcedOpportunity[];
  scannedCount: number;
  sourceStatuses?: readonly AtsSourceStatus[];
  error?: string;
}

/**
 * Request to retrieve previously sourced opportunities from background cache/storage.
 */
export interface GetSourcedOpportunitiesRequest {
  type: 'GET_SOURCED_OPPORTUNITIES';
}

/**
 * Result payload with cached sourced opportunities.
 */
export interface GetSourcedOpportunitiesResponse {
  type: 'GET_SOURCED_OPPORTUNITIES_RESULT';
  success: boolean;
  opportunities: SourcedOpportunity[];
}

/**
 * Request to harvest job posting links visible on the active browser tab.
 */
export interface HarvestPageLinksRequest {
  type: 'HARVEST_PAGE_LINKS';
}

/**
 * Result payload containing links discovered on the active page.
 */
export interface HarvestPageLinksResponse {
  type: 'HARVEST_PAGE_LINKS_RESULT';
  success: boolean;
  links: Array<{ url: string; title: string }>;
  error?: string;
}

/**
 * Fetch recent saved jobs from local storage.
 */
export interface ListSavedJobsRequest {
  type: 'LIST_SAVED_JOBS';
  limit?: number;
}

export interface ListSavedJobsResponse {
  type: 'SAVED_JOBS_RESULT';
  jobs: JobPosting[];
}

/**
 * Fetch application tracking history from local storage.
 */
export interface ListApplicationsRequest {
  type: 'LIST_APPLICATIONS';
  limit?: number;
}

export interface ListApplicationsResponse {
  type: 'APPLICATIONS_RESULT';
  applications: ApplicationRecord[];
}

/**
 * Export complete local data snapshot as JSON string.
 */
export interface ExportBackupRequest {
  type: 'EXPORT_BACKUP';
}

export interface ExportBackupResponse {
  type: 'EXPORT_BACKUP_RESULT';
  success: boolean;
  jsonString?: string;
  error?: string;
}

/**
 * Restore local stores from a backup JSON string.
 */
export interface ImportBackupRequest {
  type: 'IMPORT_BACKUP';
  jsonString: string;
}

export interface ImportBackupResponse {
  type: 'IMPORT_BACKUP_RESULT';
  success: boolean;
  error?: string;
}

/**
 * Request local storage usage metrics across all ApplyKit stores.
 */
export interface GetStorageUsageRequest {
  type: 'GET_STORAGE_USAGE';
}

export interface GetStorageUsageResponse {
  type: 'STORAGE_USAGE_RESULT';
  usage: StorageUsageSummary;
}

/**
 * Purge all candidate profile data, evidence, jobs, applications, and credentials.
 */
export interface PurgeAllDataRequest {
  type: 'PURGE_ALL_DATA';
}

export interface PurgeAllDataResponse {
  type: 'PURGE_ALL_DATA_RESULT';
  success: boolean;
  purgeResult?: PurgeResult;
  error?: string;
}

/**
 * Ingest plain text or markdown resume, decompose into evidence, and derive claims.
 */
export interface IngestResumeRequest {
  type: 'INGEST_RESUME_TEXT';
  rawText: string;
}

export interface IngestResumeResponse {
  type: 'INGEST_RESUME_TEXT_RESULT';
  success: boolean;
  evidenceCount?: number;
  claimsCount?: number;
  profileSummary?: CandidateProfileSummary;
  auditReport?: GroundingAuditReport;
  error?: string;
}

/**
 * Parse an uploaded resume (PDF base64, TXT, MD, or JSON) into a full CandidateProfile
 * and decomposed EvidenceGraph preview before user approval (Phase 18).
 */
export interface BootstrapProfileFromResumeRequest {
  type: 'BOOTSTRAP_PROFILE_FROM_RESUME';
  fileData: string;
  fileName: string;
  isBase64?: boolean;
}

export interface BootstrapProfileFromResumeResponse {
  type: 'BOOTSTRAP_PROFILE_FROM_RESUME_RESULT';
  success: boolean;
  result?: {
    rawText: string;
    profile: CandidateProfile;
    evidenceCount: number;
    experiencesCount: number;
    skillsCount: number;
    educationCount: number;
    evidence: Evidence[];
    claims: CandidateClaim[];
  };
  error?: string;
}

/**
 * Commit a reviewed and approved bootstrapped candidate profile and evidence graph into IndexedDB.
 */
export interface CommitBootstrappedProfileRequest {
  type: 'COMMIT_BOOTSTRAPPED_PROFILE';
  profile: CandidateProfile;
  evidence: Evidence[];
  claims?: CandidateClaim[];
}

export interface CommitBootstrappedProfileResponse {
  type: 'COMMIT_BOOTSTRAPPED_PROFILE_RESULT';
  success: boolean;
  profileId?: string;
  evidenceCount?: number;
  error?: string;
}

/**
 * Retrieve current evidence nodes and claims graph from local storage.
 */
export interface GetEvidenceGraphRequest {
  type: 'GET_EVIDENCE_GRAPH';
}

export interface GetEvidenceGraphResponse {
  type: 'GET_EVIDENCE_GRAPH_RESULT';
  success: boolean;
  evidence: Evidence[];
  claims: CandidateClaim[];
  auditReport?: GroundingAuditReport;
  error?: string;
}

/**
 * Audit grounding integrity of current stored evidence and claims.
 */
export interface AuditGroundingRequest {
  type: 'AUDIT_GROUNDING';
}

export interface AuditGroundingResponse {
  type: 'AUDIT_GROUNDING_RESULT';
  success: boolean;
  auditReport?: GroundingAuditReport;
  error?: string;
}

/**
 * Dispatch an AI request through the background Service Worker gateway.
 */
export interface CompleteAiTaskRequest {
  type: 'COMPLETE_AI_TASK';
  request: AIRequest;
  preferredProvider?: AIProviderName;
}

export interface CompleteAiTaskResponse {
  type: 'COMPLETE_AI_TASK_RESULT';
  success: boolean;
  response?: AIResponse;
  error?: string;
}

/**
 * Fetch token usage metrics across all configured providers.
 */
export interface GetTokenMetricsRequest {
  type: 'GET_TOKEN_METRICS';
}

export interface GetTokenMetricsResponse {
  type: 'GET_TOKEN_METRICS_RESULT';
  metrics: Record<AIProviderName, TokenUsage>;
}

/**
 * Reset token usage counters.
 */
export interface ResetTokenMetricsRequest {
  type: 'RESET_TOKEN_METRICS';
}

export interface ResetTokenMetricsResponse {
  type: 'RESET_TOKEN_METRICS_RESULT';
  success: boolean;
}

/**
 * Match active job requirements against candidate profile and evidence graph.
 */
export interface MatchJobRequirementsRequest {
  type: 'MATCH_JOB_REQUIREMENTS';
  jobPostingId?: string;
  requirements?: Requirement[];
}

/**
 * Semantic match result evaluated for an individual requirement by the LLM.
 */
export interface AiRequirementMatch {
  readonly requirementText: string;
  readonly status: 'strong_match' | 'partial_match' | 'gap' | 'unclear';
  readonly reasoning: string;
  readonly matchedClaimIds: readonly string[];
  readonly matchedSkillNames: readonly string[];
}

/**
 * Structured LLM semantic requirement analysis output.
 */
export interface AiRequirementAnalysisResult {
  readonly overallScore: number;
  readonly matches: readonly AiRequirementMatch[];
  readonly keyStrengths: readonly string[];
  readonly identifiedGaps: readonly string[];
}

export interface MatchJobRequirementsResponse {
  type: 'MATCH_JOB_REQUIREMENTS_RESULT';
  success: boolean;
  matchMatrix?: JobMatchMatrix;
  gapAnalysis?: GapAnalysisReport;
  highlightSuggestions?: HighlightSuggestion[];
  aiAnalysis?: AiRequirementAnalysisResult;
  error?: string;
}

/**
 * Request to inspect and crawl active webpage form elements.
 */
export interface InspectPageFormsRequest {
  type: 'INSPECT_PAGE_FORMS';
}

export interface InspectPageFormsResponse {
  type: 'INSPECT_PAGE_FORMS_RESULT';
  success: boolean;
  forms: ApplicationForm[];
  error?: string;
}

/**
 * Generate a validated DryRunPlan from an inspected form and candidate profile.
 */
export interface GenerateDryRunPlanRequest {
  type: 'GENERATE_DRY_RUN_PLAN';
  form: ApplicationForm;
}

export interface GenerateDryRunPlanResponse {
  type: 'GENERATE_DRY_RUN_PLAN_RESULT';
  success: boolean;
  plan?: DryRunPlan;
  error?: string;
}

/**
 * Request AI-generated answers for open-answer custom questions in a form.
 * These are staged as unconfirmed medium-risk actions pending candidate review.
 */
export interface AnswerCustomFieldsRequest {
  type: 'ANSWER_CUSTOM_FIELDS';
  form: ApplicationForm;
  plan: DryRunPlan;
}

/**
 * Response containing AI-proposed answers appended to the plan.
 */
export interface AnswerCustomFieldsResponse {
  type: 'ANSWER_CUSTOM_FIELDS_RESULT';
  success: boolean;
  plan?: DryRunPlan;
  error?: string;
}

/**
 * Retrieve the currently cached active DryRunPlan.
 */
export interface GetActivePlanRequest {
  type: 'GET_ACTIVE_PLAN';
}

export interface GetActivePlanResponse {
  type: 'ACTIVE_PLAN_RESULT';
  plan: DryRunPlan | null;
}

/**
 * Retrieve the currently cached active ApplicationForm (used for AI field answering).
 */
export interface GetActiveFormRequest {
  type: 'GET_ACTIVE_FORM';
}

export interface GetActiveFormResponse {
  type: 'ACTIVE_FORM_RESULT';
  form: ApplicationForm | null;
}

/**
 * Override the candidate value of a planned action inline.
 */
export interface UpdatePlanActionRequest {
  type: 'UPDATE_PLAN_ACTION';
  actionId: ActionId;
  userValue: string;
}

export interface UpdatePlanActionResponse {
  type: 'UPDATE_PLAN_ACTION_RESULT';
  success: boolean;
  plan?: DryRunPlan;
  error?: string;
}

/**
 * Toggle user confirmation approval for a planned high-risk action.
 */
export interface TogglePlanActionApprovalRequest {
  type: 'TOGGLE_PLAN_ACTION_APPROVAL';
  actionId: ActionId;
  confirmed?: boolean;
}

export interface TogglePlanActionApprovalResponse {
  type: 'TOGGLE_PLAN_ACTION_APPROVAL_RESULT';
  success: boolean;
  plan?: DryRunPlan;
  error?: string;
}

/**
 * Exclude a planned action from execution.
 */
export interface ExcludePlanActionRequest {
  type: 'EXCLUDE_PLAN_ACTION';
  actionId: ActionId;
}

export interface ExcludePlanActionResponse {
  type: 'EXCLUDE_PLAN_ACTION_RESULT';
  success: boolean;
  plan?: DryRunPlan;
  error?: string;
}

/**
 * Execute an approved DryRunPlan on the host webpage.
 */
export interface ExecutePlanRequest {
  type: 'EXECUTE_PLAN';
  planId?: PlanId;
  options?: ExecutionOptions;
}

export interface ExecutePlanResponse {
  type: 'EXECUTE_PLAN_RESULT';
  success: boolean;
  report?: ExecutionReport;
  error?: string;
}

/**
 * Content script internal message to execute a DryRunPlan.
 */
export interface ExecuteContentPlanRequest {
  type: 'EXECUTE_CONTENT_PLAN';
  plan: DryRunPlan;
  options?: ExecutionOptions;
}

export interface ExecuteContentPlanResponse {
  type: 'EXECUTE_CONTENT_PLAN_RESULT';
  success: boolean;
  report?: ExecutionReport;
  error?: string;
}

/**
 * Highlight a specific form field on the active webpage.
 */
export interface HighlightFormFieldRequest {
  type: 'HIGHLIGHT_FORM_FIELD';
  selector: string;
  label?: string;
}

export interface HighlightFormFieldResponse {
  type: 'HIGHLIGHT_FORM_FIELD_RESULT';
  success: boolean;
}

/**
 * Clears active form field highlight on the active webpage.
 */
export interface ClearFormFieldHighlightRequest {
  type: 'CLEAR_FORM_FIELD_HIGHLIGHT';
}

export interface ClearFormFieldHighlightResponse {
  type: 'CLEAR_FORM_FIELD_HIGHLIGHT_RESULT';
  success: boolean;
}

/**
 * Toggles in-page preview badges overlay on the active webpage.
 */
export interface ToggleInPageReviewBadgesRequest {
  type: 'TOGGLE_IN_PAGE_REVIEW_BADGES';
  enabled: boolean;
  plan?: DryRunPlan;
}

export interface ToggleInPageReviewBadgesResponse {
  type: 'TOGGLE_IN_PAGE_REVIEW_BADGES_RESULT';
  success: boolean;
  count?: number;
}

/**
 * Batch-approve actions in active DryRunPlan.
 */
export interface BatchApprovePlanActionsRequest {
  type: 'BATCH_APPROVE_PLAN_ACTIONS';
  mode: 'low_risk_only' | 'all' | 'reset';
}

export interface BatchApprovePlanActionsResponse {
  type: 'BATCH_APPROVE_PLAN_ACTIONS_RESULT';
  success: boolean;
  plan?: DryRunPlan;
  error?: string;
}

/**
 * Execute a single selective action from the active DryRunPlan.
 */
export interface ExecuteSelectiveActionRequest {
  type: 'EXECUTE_SELECTIVE_ACTION';
  actionId: ActionId;
  options?: ExecutionOptions;
}

export interface ExecuteSelectiveActionResponse {
  type: 'EXECUTE_SELECTIVE_ACTION_RESULT';
  success: boolean;
  report?: ExecutionReport;
  error?: string;
}

/**
 * Fetch detailed record and audit history for a specific application.
 */
export interface GetApplicationDetailRequest {
  type: 'GET_APPLICATION_DETAIL';
  id: ApplicationId;
}

export interface GetApplicationDetailResponse {
  type: 'GET_APPLICATION_DETAIL_RESULT';
  success: boolean;
  application?: ApplicationRecord;
  error?: string;
}

/**
 * Transition the status of an application record with an appended audit entry.
 */
export interface UpdateApplicationStatusRequest {
  type: 'UPDATE_APPLICATION_STATUS';
  id: ApplicationId;
  nextStatus: ApplicationState;
  reason?: string;
  interviewStage?: string;
  nextFollowUpDate?: string;
  notes?: string;
  recruiterName?: string;
  recruiterEmail?: string;
  expectedSalary?: string;
}

export interface UpdateApplicationStatusResponse {
  type: 'UPDATE_APPLICATION_STATUS_RESULT';
  success: boolean;
  application?: ApplicationRecord;
  error?: string;
}

/**
 * Delete a specific application record (Right to Erasure compliance).
 */
export interface DeleteApplicationRecordRequest {
  type: 'DELETE_APPLICATION_RECORD';
  id: ApplicationId;
}

export interface DeleteApplicationRecordResponse {
  type: 'DELETE_APPLICATION_RECORD_RESULT';
  success: boolean;
  error?: string;
}

/**
 * Export application history and audit logs as JSON, sanitized CSV, canonical 8-col tracker CSV, or Markdown.
 */
export interface ExportAuditLogRequest {
  type: 'EXPORT_AUDIT_LOG';
  format: 'json' | 'csv' | 'tracker-csv' | 'tracker-md';
}

export interface ExportAuditLogResponse {
  type: 'EXPORT_AUDIT_LOG_RESULT';
  success: boolean;
  content?: string;
  filename?: string;
  mimeType?: string;
  error?: string;
}

/**
 * Generate evidence-grounded tailored resume.
 */
export interface GenerateTailoredResumeRequest {
  type: 'GENERATE_TAILORED_RESUME';
  jobId?: string;
  maxBulletsPerItem?: number;
  maxProjects?: number;
  templateId?: ResumeTemplateId;
  onePageFit?: boolean;
}

export interface GenerateTailoredResumeResponse {
  type: 'GENERATE_TAILORED_RESUME_RESULT';
  success: boolean;
  tailoredResume?: TailoredResume;
  factCheck?: FactCheckReport;
  qualityAudit?: ResumeQualityAuditReport;
  error?: string;
}

/**
 * Deterministically auto-fix quality issues in a tailored resume according to 14-point standard.
 */
export interface AutoFixResumeRequest {
  type: 'AUTO_FIX_RESUME';
  resume: TailoredResume;
  jobId?: string;
}

export interface AutoFixResumeResponse {
  type: 'AUTO_FIX_RESUME_RESULT';
  success: boolean;
  tailoredResume?: TailoredResume;
  qualityAudit?: ResumeQualityAuditReport;
  error?: string;
}

/**
 * Verifiable evidence citation linking an assistant answer back to the candidate's resume or profile.
 */
export interface GroundedEvidenceCitation {
  readonly id: string;
  readonly statement: string;
  readonly sourceTitle?: string;
  readonly sourceSnippet?: string;
  readonly confidence: number;
}

/**
 * Ad-hoc question answering for questions missed by the form crawler or user prompts.
 */
export interface AnswerAdHocQuestionRequest {
  type: 'ANSWER_AD_HOC_QUESTION';
  question: string;
  maxLength?: number;
  tone?: 'concise' | 'star' | 'motivational' | 'bullets' | 'technical' | 'conversational' | 'executive' | 'ats_aggressive';
  userNotes?: string;
}

export interface AnswerAdHocQuestionResponse {
  type: 'ANSWER_AD_HOC_QUESTION_RESULT';
  success: boolean;
  answerText?: string;
  confidence?: number;
  supportingClaimIds?: string[];
  supportingCitations?: GroundedEvidenceCitation[];
  sourceResumeName?: string;
  notes?: string;
  error?: string;
}

/**
 * Persists an ad-hoc or custom question answer into the candidate's verified savedAnswers.
 */
export interface SaveReusableAnswerRequest {
  type: 'SAVE_REUSABLE_ANSWER';
  question: string;
  answerText: string;
  category?: AnswerCategory | string;
}

export interface SaveReusableAnswerResponse {
  type: 'SAVE_REUSABLE_ANSWER_RESULT';
  success: boolean;
  savedAnswerId?: string;
  error?: string;
}

/**
 * Request to insert text into the active/focused element on the webpage.
 */
export interface InsertTextIntoActiveElementRequest {
  type: 'INSERT_TEXT_INTO_ACTIVE_ELEMENT';
  text: string;
}

export interface InsertTextIntoActiveElementResponse {
  type: 'INSERT_TEXT_INTO_ACTIVE_ELEMENT_RESULT';
  success: boolean;
  error?: string;
}

/**
 * 1-Click execution request to inspect, answer, approve, and fill all safe fields.
 */
export interface ExecuteOneClickAutoFillRequest {
  type: 'EXECUTE_ONE_CLICK_AUTO_FILL';
  form?: ApplicationForm;
  options?: {
    pacingDelayMs?: number;
    highlightElements?: boolean;
  };
}

export interface ExecuteOneClickAutoFillResponse {
  type: 'EXECUTE_ONE_CLICK_AUTO_FILL_RESULT';
  success: boolean;
  report?: ExecutionReport;
  plan?: DryRunPlan;
  error?: string;
}

/**
 * Generate evidence-grounded cover letter.
 */
export interface GenerateCoverLetterRequest {
  type: 'GENERATE_COVER_LETTER';
  jobId?: string;
  recipient?: string;
  tone?: 'technical' | 'conversational' | 'executive';
}

export interface GenerateCoverLetterResponse {
  type: 'GENERATE_COVER_LETTER_RESULT';
  success: boolean;
  coverLetter?: TailoredCoverLetter;
  factCheck?: FactCheckReport;
  error?: string;
}

/**
 * Generate PDF for tailored cover letter.
 */
export interface GenerateCoverLetterPdfRequest {
  type: 'GENERATE_COVER_LETTER_PDF';
  jobId?: string;
  recipient?: string;
  tone?: 'technical' | 'conversational' | 'executive';
}

export interface GenerateCoverLetterPdfResponse {
  type: 'GENERATE_COVER_LETTER_PDF_RESULT';
  success: boolean;
  pdfBase64?: string;
  error?: string;
}

/**
 * Generate PDF for tailored resume.
 */
export interface GenerateResumePdfRequest {
  type: 'GENERATE_RESUME_PDF';
  jobId?: string;
  maxBulletsPerItem?: number;
  maxProjects?: number;
  templateId?: ResumeTemplateId;
  onePageFit?: boolean;
  density?: SpacingDensity;
  showTargetBadge?: boolean;
}

export interface GenerateResumePdfResponse {
  type: 'GENERATE_RESUME_PDF_RESULT';
  success: boolean;
  pdfBase64?: string;
  error?: string;
}

/**
 * Generate native Word (.docx) document for tailored resume (ADR-0043).
 */
export interface GenerateResumeDocxRequest {
  type: 'GENERATE_RESUME_DOCX';
  jobId?: string;
  maxBulletsPerItem?: number;
  maxProjects?: number;
  templateId?: ResumeTemplateId;
  density?: SpacingDensity;
  showTargetBadge?: boolean;
}

export interface GenerateResumeDocxResponse {
  type: 'GENERATE_RESUME_DOCX_RESULT';
  success: boolean;
  docxBase64?: string;
  filename?: string;
  error?: string;
}

/**
 * Generate native Word (.docx) document for tailored cover letter (ADR-0043).
 */
export interface GenerateCoverLetterDocxRequest {
  type: 'GENERATE_COVER_LETTER_DOCX';
  jobId?: string;
  recipient?: string;
  tone?: 'technical' | 'conversational' | 'executive';
}

export interface GenerateCoverLetterDocxResponse {
  type: 'GENERATE_COVER_LETTER_DOCX_RESULT';
  success: boolean;
  docxBase64?: string;
  filename?: string;
  error?: string;
}

/**
 * Automated ATS submission detected by content script observer or background navigation (Phase 20).
 */
export interface SubmissionDetectedNotification {
  type: 'SUBMISSION_DETECTED';
  url: string;
  title: string;
  atsType?: string;
}

export interface SubmissionDetectedResponse {
  type: 'SUBMISSION_DETECTED_RESULT';
  success: boolean;
  applicationId?: string;
  previousStatus?: string;
  newStatus?: string;
  error?: string;
}

/**
 * Fact-check an arbitrary candidate document against EvidenceGraph.
 */
export interface FactCheckDocumentRequest {
  type: 'FACT_CHECK_DOCUMENT';
  text: string;
  documentType: 'resume' | 'cover_letter';
}

export interface FactCheckDocumentResponse {
  type: 'FACT_CHECK_DOCUMENT_RESULT';
  success: boolean;
  factCheck?: FactCheckReport;
  error?: string;
}

/**
 * Discriminated union of all extension RPC request types.
 */
export type ExtensionRequest =
  | PingRequest
  | ExtractJobRequest
  | GetApiKeysStatusRequest
  | SetApiKeyRequest
  | GetCandidateProfileSummaryRequest
  | GetCurrentExtractionRequest
  | GetCandidateProfileRequest
  | SaveCandidateProfileRequest
  | ListSavedJobsRequest
  | ListApplicationsRequest
  | GetApplicationDetailRequest
  | UpdateApplicationStatusRequest
  | DeleteApplicationRecordRequest
  | ExportAuditLogRequest
  | ExportBackupRequest
  | ImportBackupRequest
  | GetStorageUsageRequest
  | PurgeAllDataRequest
  | IngestResumeRequest
  | GetEvidenceGraphRequest
  | AuditGroundingRequest
  | CompleteAiTaskRequest
  | GetTokenMetricsRequest
  | ResetTokenMetricsRequest
  | MatchJobRequirementsRequest
  | InspectPageFormsRequest
  | GenerateDryRunPlanRequest
  | GetActivePlanRequest
  | UpdatePlanActionRequest
  | TogglePlanActionApprovalRequest
  | ExcludePlanActionRequest
  | ExecutePlanRequest
  | ExecuteContentPlanRequest
  | HighlightFormFieldRequest
  | ClearFormFieldHighlightRequest
  | ToggleInPageReviewBadgesRequest
  | BatchApprovePlanActionsRequest
  | ExecuteSelectiveActionRequest
  | GenerateTailoredResumeRequest
  | AutoFixResumeRequest
  | AnswerAdHocQuestionRequest
  | SaveReusableAnswerRequest
  | InsertTextIntoActiveElementRequest
  | ExecuteOneClickAutoFillRequest
  | GenerateCoverLetterRequest
  | FactCheckDocumentRequest
  | AnswerCustomFieldsRequest
  | GetActiveFormRequest
  | BootstrapProfileFromResumeRequest
  | CommitBootstrappedProfileRequest
  | GenerateCoverLetterPdfRequest
  | GenerateResumePdfRequest
  | GenerateCoverLetterDocxRequest
  | GenerateResumeDocxRequest
  | ExportProfileYamlRequest
  | ImportProfileYamlRequest
  | FetchAtsJobsRequest
  | GetSourcedOpportunitiesRequest
  | HarvestPageLinksRequest
  | SubmissionDetectedNotification;

/**
 * Performs boundary validation for untrusted runtime messages before handlers
 * access payload fields. TypeScript types are erased in the service worker.
 */
export function isValidExtensionRequest(value: unknown): value is ExtensionRequest {
  if (!value || typeof value !== 'object') return false;
  const message = value as Record<string, unknown>;
  if (typeof message.type !== 'string') return false;

  const nonEmptyText = (candidate: unknown, maxLength: number): candidate is string =>
    typeof candidate === 'string' && candidate.trim().length > 0 && candidate.length <= maxLength;
  const objectValue = (candidate: unknown): candidate is Record<string, unknown> =>
    typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate);
  const id = (candidate: unknown): candidate is string => nonEmptyText(candidate, 256);

  switch (message.type) {
    case 'SET_API_KEY':
      return ['openai', 'anthropic', 'gemini', 'openrouter'].includes(String(message.provider)) &&
        nonEmptyText(message.apiKey, 4096);
    case 'SAVE_CANDIDATE_PROFILE':
      return objectValue(message.profile);
    case 'IMPORT_BACKUP':
      return nonEmptyText(message.jsonString, 20 * 1024 * 1024);
    case 'IMPORT_PROFILE_YAML':
      return nonEmptyText(message.yamlContent, 2 * 1024 * 1024);
    case 'UPDATE_PLAN_ACTION':
      return id(message.actionId) && typeof message.userValue === 'string' && message.userValue.length <= 100_000;
    case 'TOGGLE_PLAN_ACTION_APPROVAL':
    case 'EXCLUDE_PLAN_ACTION':
    case 'EXECUTE_SELECTIVE_ACTION':
      return id(message.actionId);
    case 'EXECUTE_PLAN':
      return message.planId === undefined || id(message.planId);
    case 'EXECUTE_CONTENT_PLAN': {
      if (!objectValue(message.plan) || !Array.isArray(message.plan.actions)) return false;
      return message.plan.actions.every((action) => {
        if (!objectValue(action) || !id(action.id) || !nonEmptyText(action.actionType, 64)) return false;
        if ('selector' in action && action.selector !== undefined && !nonEmptyText(action.selector, 4096)) return false;
        return true;
      });
    }
    case 'ANSWER_AD_HOC_QUESTION':
      return nonEmptyText(message.question, 20_000) &&
        (message.maxLength === undefined || (Number.isInteger(message.maxLength) && Number(message.maxLength) > 0 && Number(message.maxLength) <= 100_000)) &&
        (message.userNotes === undefined || typeof message.userNotes === 'string' && message.userNotes.length <= 20_000);
    case 'SAVE_REUSABLE_ANSWER':
      return nonEmptyText(message.question, 20_000) && nonEmptyText(message.answerText, 100_000);
    case 'INSERT_TEXT_INTO_ACTIVE_ELEMENT':
      return typeof message.text === 'string' && message.text.length <= 100_000;
    case 'EXECUTE_ONE_CLICK_AUTO_FILL':
      return message.form === undefined || objectValue(message.form);
    default:
      return true;
  }
}

/**
 * Discriminated union of all extension RPC response types.
 */
export type ExtensionResponse =
  | PingResponse
  | ExtractJobResponse
  | GetApiKeysStatusResponse
  | SetApiKeyResponse
  | GetCandidateProfileSummaryResponse
  | CurrentExtractionResponse
  | GetCandidateProfileResponse
  | SaveCandidateProfileResponse
  | ExportProfileYamlResponse
  | ImportProfileYamlResponse
  | FetchAtsJobsResponse
  | GetSourcedOpportunitiesResponse
  | HarvestPageLinksResponse
  | ListSavedJobsResponse
  | ListApplicationsResponse
  | GetApplicationDetailResponse
  | UpdateApplicationStatusResponse
  | DeleteApplicationRecordResponse
  | ExportAuditLogResponse
  | ExportBackupResponse
  | ImportBackupResponse
  | GetStorageUsageResponse
  | PurgeAllDataResponse
  | IngestResumeResponse
  | GetEvidenceGraphResponse
  | AuditGroundingResponse
  | CompleteAiTaskResponse
  | GetTokenMetricsResponse
  | ResetTokenMetricsResponse
  | MatchJobRequirementsResponse
  | InspectPageFormsResponse
  | GenerateDryRunPlanResponse
  | GetActivePlanResponse
  | UpdatePlanActionResponse
  | TogglePlanActionApprovalResponse
  | ExcludePlanActionResponse
  | ExecutePlanResponse
  | ExecuteContentPlanResponse
  | HighlightFormFieldResponse
  | ClearFormFieldHighlightResponse
  | ToggleInPageReviewBadgesResponse
  | BatchApprovePlanActionsResponse
  | ExecuteSelectiveActionResponse
  | GenerateTailoredResumeResponse
  | AutoFixResumeResponse
  | AnswerAdHocQuestionResponse
  | SaveReusableAnswerResponse
  | InsertTextIntoActiveElementResponse
  | ExecuteOneClickAutoFillResponse
  | GenerateCoverLetterResponse
  | GenerateCoverLetterPdfResponse
  | GenerateResumePdfResponse
  | GenerateCoverLetterDocxResponse
  | GenerateResumeDocxResponse
  | FactCheckDocumentResponse
  | AnswerCustomFieldsResponse
  | GetActiveFormResponse
  | BootstrapProfileFromResumeResponse
  | CommitBootstrappedProfileResponse
  | SubmissionDetectedResponse;
