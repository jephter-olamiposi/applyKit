/**
 * @fileoverview Main Application component for ApplyKit Chrome Side Panel.
 */

import React, { useState, useEffect, useCallback } from 'react';
import type { AIProviderName, JobPosting } from '@applykit/domain';
import { NavigationTabs, type TabId } from './components/NavigationTabs.js';
import { JobOverview } from './components/JobOverview.js';
import { RequirementsList } from './components/RequirementsList.js';
import { MatchAnalysis } from './components/MatchAnalysis.js';
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
import { sendToBackground } from '../messages/bridge.js';
import type {
  ExtractedPageData,
  CandidateProfileSummary,
  ApiKeysStatus,
  ExtractJobResponse,
  GetCandidateProfileSummaryResponse,
  GetApiKeysStatusResponse,
  CurrentExtractionResponse,
  SetApiKeyResponse,
} from '../messages/contracts.js';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [jobData, setJobData] = useState<ExtractedPageData | null>(null);
  const [jobPosting, setJobPosting] = useState<JobPosting | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractionError, setExtractionError] = useState<string | null>(null);

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

  const handleSaveKey = async (provider: AIProviderName, apiKey: string): Promise<boolean> => {
    const res = await sendToBackground<
      { type: 'SET_API_KEY'; provider: AIProviderName; apiKey: string },
      SetApiKeyResponse
    >({
      type: 'SET_API_KEY',
      provider,
      apiKey,
    });

    if (res.success) {
      setKeysStatus((prev) => ({ ...prev, [provider]: true }));
      return true;
    }
    return false;
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

  return (
    <div className="sidepanel-root">
      <header className="app-header">
        <div className="brand">
          <h1 className="brand-title">ApplyKit</h1>
          <span className="brand-subtitle">Job application workspace</span>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className={`header-util-btn ${activeTab === 'profile' ? 'header-util-btn-active' : ''}`}
            onClick={() => setActiveTab('profile')}
            title="Candidate Profile"
          >
            Profile
          </button>
          <button
            type="button"
            className={`header-util-btn ${activeTab === 'settings' ? 'header-util-btn-active' : ''}`}
            onClick={() => setActiveTab('settings')}
            title="API Keys & Settings"
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
          <NavigationTabs activeTab={activeTab} onTabChange={setActiveTab} />

          <main className="app-content">
            {activeTab === 'overview' && (
              <JobOverview
                jobData={jobData}
                jobPosting={jobPosting}
                isExtracting={isExtracting}
                onExtract={handleExtract}
                onViewRequirements={() => setActiveTab('review_matches')}
                onViewMatch={() => setActiveTab('review_matches')}
                onNavigateToTab={setActiveTab}
                error={extractionError}
              />
            )}

            {activeTab === 'sourced_feed' && (
              <SourcedOpportunitiesFeed
                profile={profile}
                onNavigateToTab={setActiveTab}
              />
            )}

            {activeTab === 'review_matches' && (
              <div className="focused-page">
                <div className="focused-page-header">
                  <p className="focused-page-kicker">Step 2</p>
                  <h2>Review Matches</h2>
                  <p>Check eligibility, requirements, and evidence before preparing documents.</p>
                </div>
                <MatchAnalysis jobPosting={jobPosting} onNavigateToTab={setActiveTab} />
                <RequirementsList
                  requirements={jobPosting?.requirements || []}
                  onNavigateToTab={setActiveTab}
                />
              </div>
            )}

            {activeTab === 'tailor_resume' && (
              <div className="focused-page">
                <div className="focused-page-header">
                  <p className="focused-page-kicker">Step 3</p>
                  <h2>Tailor Resume</h2>
                  <p>Reorder and emphasize verified experience without changing your facts.</p>
                </div>
                <TailoringStudio
                  initialMode="resume"
                  showModeSwitcher={false}
                  onNavigateToTab={setActiveTab}
                />
              </div>
            )}

            {activeTab === 'cover_letter' && (
              <div className="focused-page">
                <div className="focused-page-header">
                  <p className="focused-page-kicker">Step 3</p>
                  <h2>Cover Letter</h2>
                  <p>Prepare an evidence-backed letter for the selected job.</p>
                </div>
                <TailoringStudio
                  initialMode="cover_letter"
                  showModeSwitcher={false}
                  onNavigateToTab={setActiveTab}
                />
              </div>
            )}

            {activeTab === 'evidence' && (
              <EvidenceViewer onProfileUpdated={loadInitialData} />
            )}

            {activeTab === 'prepare_application' && (
              <div className="focused-page">
                <div className="focused-page-header">
                  <p className="focused-page-kicker">Step 5</p>
                  <h2>Prepare Application</h2>
                  <p>Review fields, answers, and browser actions before you submit manually.</p>
                </div>
                <FormInspector onNavigateToTab={setActiveTab} />
                <DryRunInspector onNavigateToTab={setActiveTab} />
                <InstantQuestionSolver initialOpen={false} isDedicatedTab={false} />
              </div>
            )}

            {activeTab === 'track' && (
              <div className="focused-page">
                <div className="focused-page-header">
                  <p className="focused-page-kicker">Step 6</p>
                  <h2>Track</h2>
                  <p>Keep every application, status, and next action in one place.</p>
                </div>
                <ApplicationTracker onNavigateToTab={setActiveTab} />
              </div>
            )}

            {activeTab === 'profile' && (
              <ProfileSummary
                profile={profile}
                loading={profileLoading}
                onProfileUpdated={loadInitialData}
                onPurged={handlePurged}
              />
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

      <footer className="app-footer">
        <p className="footer-text">
          Review every action before it runs.
        </p>
      </footer>
    </div>
  );
};
