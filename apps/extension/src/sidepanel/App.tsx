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
    // 1. Fetch Profile Summary
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
      // Background might not have profile yet
    } finally {
      setProfileLoading(false);
    }

    // 2. Fetch Cached Extraction
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
      // Ignore cache miss
    }

    // 3. Fetch Provider Keys Status
    try {
      const res = await sendToBackground<
        { type: 'GET_API_KEYS_STATUS' },
        GetApiKeysStatusResponse
      >({ type: 'GET_API_KEYS_STATUS' });
      if (res && res.status) {
        setKeysStatus(res.status);
      }
    } catch {
      // Keys not yet initialized
    }

    // 4. Check Onboarding Status
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

  const shouldShowOnboarding =
    showOnboarding ||
    (hasCompletedOnboarding === false && !profileLoading && !profile?.isComplete);

  return (
    <div className="sidepanel-root">
      <header className="app-header">
        <div className="brand">
          <h1 className="brand-title">ApplyKit</h1>
          <span className="brand-subtitle">Job Application Copilot</span>
        </div>
        <span className="phase-pill">Phase 15</span>
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
                onViewRequirements={() => setActiveTab('requirements')}
                onViewMatch={() => setActiveTab('match')}
                error={extractionError}
              />
            )}

            {activeTab === 'requirements' && (
              <RequirementsList requirements={jobPosting?.requirements || []} />
            )}

            {activeTab === 'match' && (
              <MatchAnalysis
                jobPosting={jobPosting}
                onNavigateToTab={setActiveTab}
              />
            )}

            {activeTab === 'tailor' && (
              <TailoringStudio onNavigateToTab={setActiveTab} />
            )}

            {activeTab === 'evidence' && (
              <EvidenceViewer onProfileUpdated={loadInitialData} />
            )}

            {activeTab === 'form' && (
              <FormInspector onNavigateToTab={setActiveTab} />
            )}

            {activeTab === 'dry_run' && (
              <DryRunInspector onNavigateToTab={setActiveTab} />
            )}

            {activeTab === 'history' && (
              <ApplicationTracker onNavigateToTab={setActiveTab} />
            )}

            {activeTab === 'profile' && (
              <ProfileSummary
                profile={profile}
                loading={profileLoading}
                onProfileUpdated={loadInitialData}
              />
            )}

            {activeTab === 'settings' && (
              <ApiSettings
                keysStatus={keysStatus}
                onSaveKey={handleSaveKey}
                onRerunOnboarding={() => setShowOnboarding(true)}
              />
            )}
          </main>
        </>
      )}

      <footer className="app-footer">
        <p className="footer-text">
          Local-first &bull; Evidence-backed &bull; Candidate controlled
        </p>
      </footer>
    </div>
  );
};
