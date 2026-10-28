/**
 * @fileoverview Side panel shell: header, the four sections, and onboarding for new users.
 */

import React, { useState, useEffect, useCallback } from 'react';
import type { AIProviderName, JobPosting } from '@applykit/domain';
import { NavigationTabs, sectionForTab, type TabId } from './components/NavigationTabs.js';
import { JobOverview } from './components/JobOverview.js';
import { ProfileSummary } from './components/ProfileSummary.js';
import { EvidenceViewer } from './components/EvidenceViewer.js';
import { FormInspector } from './components/FormInspector.js';
import { DryRunInspector } from './components/DryRunInspector.js';
import { ApplicationTracker } from './components/ApplicationTracker.js';
import { TailoringStudio } from './components/TailoringStudio.js';
import { ApiSettings } from './components/ApiSettings.js';
import { OnboardingWizard } from './components/OnboardingWizard.js';
import { InstantQuestionSolver } from './components/InstantQuestionSolver.js';
import { SourcedOpportunitiesFeed } from './components/SourcedOpportunitiesFeed.js';
import { AtsSourcingEngine } from './components/AtsSourcingEngine.js';
import { sendToBackground } from '../messages/bridge.js';
import { SIDE_PANEL_TAB_IDS } from '../messages/contracts.js';
import {
  PENDING_SIDEPANEL_TAB_KEY,
  PENDING_SIDEPANEL_TAB_TTL_MS,
} from '../storage/storage-keys.js';
import type {
  ExtractedPageData,
  CandidateProfileSummary,
  ApiKeysStatus,
  ExtractJobResponse,
  GetCandidateProfileSummaryResponse,
  GetApiKeysStatusResponse,
  CurrentExtractionResponse,
  SetApiKeyResponse,
  SidePanelTabId,
} from '../messages/contracts.js';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [jobData, setJobData] = useState<ExtractedPageData | null>(null);
  const [jobPosting, setJobPosting] = useState<JobPosting | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractionError, setExtractionError] = useState<string | null>(null);
  // Bumped when the form panel creates a field-by-field plan so the review list reloads it.
  const [planRevision, setPlanRevision] = useState(0);

  const [profile, setProfile] = useState<CandidateProfileSummary | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);

  // Onboarding state
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState<boolean | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);

  const [keysStatus, setKeysStatus] = useState<ApiKeysStatus>({
    openai: false,
    anthropic: false,
    gemini: false,
    openrouter: false,
  });

  const loadInitialData = useCallback(async () => {
    try {
      setProfileLoading(true);
      const res = await sendToBackground<
        { type: 'GET_CANDIDATE_PROFILE_SUMMARY' },
        GetCandidateProfileSummaryResponse
      >({ type: 'GET_CANDIDATE_PROFILE_SUMMARY' });
      if (res && res.summary) {
        setProfile(res.summary);
      }
    } catch {
      // Profile repository may not be initialized yet
    } finally {
      setProfileLoading(false);
    }

    try {
      const res = await sendToBackground<
        { type: 'GET_CURRENT_EXTRACTION' },
        CurrentExtractionResponse
      >({ type: 'GET_CURRENT_EXTRACTION' });
      if (res) {
        if (res.data) setJobData(res.data);
        if (res.jobPosting) setJobPosting(res.jobPosting);
      }
    } catch {
      // No active job extraction in cache
    }

    try {
      const res = await sendToBackground<
        { type: 'GET_API_KEYS_STATUS' },
        GetApiKeysStatusResponse
      >({ type: 'GET_API_KEYS_STATUS' });
      if (res && res.status) {
        setKeysStatus(res.status);
      }
    } catch {
      // Provider keys not yet configured
    }

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      try {
        const stored = await chrome.storage.local.get('applykit_onboarding_completed');
        setHasCompletedOnboarding(Boolean(stored.applykit_onboarding_completed));
      } catch {
        setHasCompletedOnboarding(false);
      }
    } else {
      setHasCompletedOnboarding(false);
    }
  }, []);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  // The in-page hub opens the panel when the candidate attaches a document. The
  // destination arrives through session storage because the panel does not exist
  // yet at the moment the request is made, and a live change listener covers the
  // case where it is already open.
  useEffect(() => {
    if (typeof chrome === 'undefined' || !chrome.storage?.session) return;

    const sessionStorage = chrome.storage.session;
    let cancelled = false;

    const applyPendingTab = (value: unknown): boolean => {
      if (cancelled || !value || typeof value !== 'object') return false;
      const pending = value as { tab?: unknown; requestedAt?: unknown };
      if (
        typeof pending.tab !== 'string' ||
        !(SIDE_PANEL_TAB_IDS as readonly string[]).includes(pending.tab) ||
        typeof pending.requestedAt !== 'number' ||
        Date.now() - pending.requestedAt > PENDING_SIDEPANEL_TAB_TTL_MS
      ) {
        return false;
      }
      setActiveTab(pending.tab as SidePanelTabId);
      return true;
    };

    sessionStorage
      .get(PENDING_SIDEPANEL_TAB_KEY)
      .then((stored) => {
        if (applyPendingTab(stored[PENDING_SIDEPANEL_TAB_KEY])) {
          return sessionStorage.remove(PENDING_SIDEPANEL_TAB_KEY);
        }
        return undefined;
      })
      .catch(() => undefined);

    const handleStorageChange = (
      changes: Record<string, chrome.storage.StorageChange>
    ): void => {
      const change = changes[PENDING_SIDEPANEL_TAB_KEY];
      if (!change) return;
      applyPendingTab(change.newValue);
      sessionStorage.remove(PENDING_SIDEPANEL_TAB_KEY).catch(() => undefined);
    };

    sessionStorage.onChanged.addListener(handleStorageChange);
    return () => {
      cancelled = true;
      sessionStorage.onChanged.removeListener(handleStorageChange);
    };
  }, []);

  const handleExtract = async () => {
    setIsExtracting(true);
    setExtractionError(null);

    try {
      const res = await sendToBackground<
        { type: 'EXTRACT_JOB' },
        ExtractJobResponse
      >({ type: 'EXTRACT_JOB' });

      if (res.success) {
        if (res.data) setJobData(res.data);
        if (res.jobPosting) setJobPosting(res.jobPosting);
      } else {
        setExtractionError(res.error || 'Failed to extract job posting data.');
      }
    } catch (err) {
      setExtractionError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsExtracting(false);
    }
  };

  const handleSaveKey = async (provider: AIProviderName, apiKey: string): Promise<SetApiKeyResponse> => {
    const res = await sendToBackground<
      { type: 'SET_API_KEY'; provider: AIProviderName; apiKey: string },
      SetApiKeyResponse
    >({
      type: 'SET_API_KEY',
      provider,
      apiKey,
    });

    if (res.success) {
      setKeysStatus((prev) => ({ ...prev, [provider]: apiKey.trim().length > 0 }));
    }
    return res;
  };

  const handlePurged = () => {
    setProfile(null);
    setHasCompletedOnboarding(false);
    setShowOnboarding(true);
    setActiveTab('overview');
  };

  const shouldShowOnboarding =
    showOnboarding ||
    (hasCompletedOnboarding === false && !profileLoading && !profile?.isComplete);

  const section = sectionForTab(activeTab);
  const showUtility = activeTab === 'profile' || activeTab === 'settings';

  return (
    <div className="sidepanel-root">
      <header className="app-header">
        <h1 className="brand-title">ApplyKit</h1>
        <div className="header-actions">
          <button
            type="button"
            className={`header-util-btn ${activeTab === 'profile' ? 'header-util-btn-active' : ''}`}
            onClick={() => setActiveTab('profile')}
          >
            Profile
          </button>
          <button
            type="button"
            className={`header-util-btn ${activeTab === 'settings' ? 'header-util-btn-active' : ''}`}
            onClick={() => setActiveTab('settings')}
          >
            Settings
          </button>
        </div>
      </header>

      {shouldShowOnboarding ? (
        <main className="app-content">
          <OnboardingWizard
            onComplete={() => {
              setHasCompletedOnboarding(true);
              setShowOnboarding(false);
              loadInitialData();
            }}
            onCancel={hasCompletedOnboarding ? () => setShowOnboarding(false) : undefined}
          />
        </main>
      ) : (
        <>
          {!showUtility && <NavigationTabs activeTab={activeTab} onTabChange={setActiveTab} />}
          {showUtility && (
            <div className="ui-spread" style={{ marginBottom: 12 }}>
              <h2 className="ui-title">{activeTab === 'profile' ? 'Your profile' : 'Settings'}</h2>
              <button type="button" className="ui-link" onClick={() => setActiveTab('overview')}>
                Back to the job
              </button>
            </div>
          )}

          <main className="app-content">
            {(activeTab === 'overview' || activeTab === 'review_matches') && (
              <JobOverview
                jobData={jobData}
                jobPosting={jobPosting}
                isExtracting={isExtracting}
                onExtract={handleExtract}
                onNavigateToTab={setActiveTab}
                error={extractionError}
              />
            )}

            {activeTab === 'sourced_feed' && (
              <div className="ui-stack">
                <button type="button" className="ui-link" style={{ alignSelf: 'flex-start' }} onClick={() => setActiveTab('overview')}>
                  Back to the job on this page
                </button>
                <SourcedOpportunitiesFeed profile={profile} onNavigateToTab={setActiveTab} />
                <AtsSourcingEngine initialExpanded={false} />
              </div>
            )}

            {section === 'resume' && (
              <div>
                <div className="ui-segmented" role="group" aria-label="Document">
                  <button type="button" aria-pressed={activeTab === 'tailor_resume'} onClick={() => setActiveTab('tailor_resume')}>
                    Resume
                  </button>
                  <button type="button" aria-pressed={activeTab === 'cover_letter'} onClick={() => setActiveTab('cover_letter')}>
                    Cover letter
                  </button>
                </div>
                <TailoringStudio
                  key={activeTab}
                  initialMode={activeTab === 'cover_letter' ? 'cover_letter' : 'resume'}
                  showModeSwitcher={false}
                  onNavigateToTab={setActiveTab}
                />
              </div>
            )}

            {activeTab === 'prepare_application' && (
              <div className="ui-stack">
                <FormInspector onNavigateToTab={setActiveTab} onPlanReady={() => setPlanRevision((n) => n + 1)} />
                <DryRunInspector key={planRevision} onNavigateToTab={setActiveTab} />
                <InstantQuestionSolver initialOpen={false} isDedicatedTab={false} />
              </div>
            )}

            {activeTab === 'track' && <ApplicationTracker onNavigateToTab={(tab) => setActiveTab(tab as typeof activeTab)} />}

            {(activeTab === 'profile' || activeTab === 'evidence') && (
              <div className="ui-stack">
                <ProfileSummary
                  profile={profile}
                  loading={profileLoading}
                  onProfileUpdated={loadInitialData}
                />
                <details className="ui-details ui-card" open={activeTab === 'evidence'}>
                  <summary>Lines from your resume that ApplyKit can quote</summary>
                  <EvidenceViewer />
                </details>
              </div>
            )}

            {activeTab === 'settings' && (
              <ApiSettings
                keysStatus={keysStatus}
                onSaveKey={handleSaveKey}
                onRerunOnboarding={() => setShowOnboarding(true)}
                onPurged={handlePurged}
              />
            )}
          </main>
        </>
      )}
    </div>
  );
};
