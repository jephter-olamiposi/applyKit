/**
 * @fileoverview Canonical list of `chrome.storage.local` keys owned by ApplyKit.
 *
 * Purge operations must remove only these keys. Clearing the whole storage area would
 * also delete configuration owned by other extension features and prevent a clean reinstall.
 */
export const APPLYKIT_STORAGE_KEYS = [
  'applykit_secure_provider_keys',
  'applykit_candidate_profile',
  'applykit_last_extraction',
  'applykit_last_job_posting',
  'applykit_active_dry_run_plan',
  'applykit_active_form',
  'applykit_sourced_opportunities',
  'applykit_onboarding_completed',
] as const;

/**
 * `chrome.storage.session` key carrying a side panel destination requested from a page.
 *
 * Session storage is used rather than `local` because the value is transient routing
 * state: it never touches disk and is gone when the browser closes.
 */
export const PENDING_SIDEPANEL_TAB_KEY = 'applykit_pending_sidepanel_tab';

/**
 * Maximum age of a pending destination before it is treated as stale.
 *
 * Without an expiry, a hint left behind by an earlier request could redirect the
 * panel the next time the candidate opens it for an unrelated posting.
 */
export const PENDING_SIDEPANEL_TAB_TTL_MS = 60_000;
