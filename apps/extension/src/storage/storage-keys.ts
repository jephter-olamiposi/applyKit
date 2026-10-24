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
