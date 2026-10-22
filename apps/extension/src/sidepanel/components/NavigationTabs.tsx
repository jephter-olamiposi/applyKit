/**
 * @fileoverview Streamlined 5-stage pipeline navigation component for ApplyKit Side Panel.
 *
 * Implements candidate-centric workflow navigation:
 * 1. Find Jobs (current-page extraction and sourced opportunities)
 * 2. Review Matches (requirements and evidence-backed fit)
 * 3. Tailor Resume (resume, letter, and evidence review)
 * 4. Prepare Application (form preparation and safety review)
 * 5. Track (saved applications and statuses)
 *
 * Provides a clear progression bar where each step naturally leads to the next,
 * eliminating cognitive overload from 10 unranked tabs.
 */

import React from 'react';

export type TabId =
  | 'overview'
  | 'sourced_feed'
  | 'review_matches'
  | 'tailor_resume'
  | 'cover_letter'
  | 'evidence'
  | 'prepare_application'
  | 'track'
  | 'requirements'
  | 'match'
  | 'tailor'
  | 'form'
  | 'dry_run'
  | 'instant_qa'
  | 'history'
  | 'profile'
  | 'settings';

interface NavigationTabsProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

interface PipelineStep {
  id: string;
  stepNumber: number;
  label: string;
  defaultTab: TabId;
  memberTabs: readonly TabId[];
  subTabs: readonly { id: TabId; label: string }[];
}

const PIPELINE_STEPS: readonly PipelineStep[] = [
  {
    id: 'step_source',
    stepNumber: 1,
    label: 'Find Jobs',
    defaultTab: 'overview',
    memberTabs: ['overview', 'sourced_feed'],
    subTabs: [
      { id: 'overview', label: 'Extract Current Job' },
      { id: 'sourced_feed', label: 'Search Jobs' },
    ],
  },
  {
    id: 'step_verify',
    stepNumber: 2,
    label: 'Review Matches',
    defaultTab: 'review_matches',
    memberTabs: ['review_matches', 'match', 'requirements'],
    subTabs: [
      { id: 'review_matches', label: 'Fit & Eligibility' },
    ],
  },
  {
    id: 'step_tailor',
    stepNumber: 3,
    label: 'Tailor Resume',
    defaultTab: 'tailor_resume',
    memberTabs: ['tailor_resume', 'cover_letter', 'tailor', 'evidence'],
    subTabs: [
      { id: 'tailor_resume', label: 'Resume' },
      { id: 'cover_letter', label: 'Cover Letter' },
    ],
  },
  {
    id: 'step_fill',
    stepNumber: 4,
    label: 'Prepare Application',
    defaultTab: 'prepare_application',
    memberTabs: ['prepare_application', 'form', 'dry_run', 'instant_qa'],
    subTabs: [
      { id: 'prepare_application', label: 'Application Form' },
    ],
  },
  {
    id: 'step_track',
    stepNumber: 5,
    label: 'Track',
    defaultTab: 'track',
    memberTabs: ['track', 'history'],
    subTabs: [],
  },
];

/**
 * Renders the streamlined 5-step pipeline navigation and contextual subtabs.
 */
export const NavigationTabs: React.FC<NavigationTabsProps> = ({ activeTab, onTabChange }) => {
  const currentStep = PIPELINE_STEPS.find((step) => step.memberTabs.includes(activeTab));

  return (
    <div className="pipeline-nav-container">
      {/* Primary pipeline navigation keeps one candidate task visible at a time. */}
      <nav className="pipeline-steps-bar" role="tablist" aria-label="Application Pipeline">
        {PIPELINE_STEPS.map((step) => {
          const isActive = currentStep?.id === step.id;
          return (
            <button
              key={step.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={`pipeline-step-btn ${isActive ? 'pipeline-step-active' : ''}`}
              onClick={() => onTabChange(step.defaultTab)}
            >
              <span className="step-num">{step.stepNumber}</span>
              <span className="step-label">{step.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Contextual Sub-Tabs (when active step has secondary views) */}
      {currentStep && currentStep.subTabs.length > 0 && (
        <div className="pipeline-subtabs-bar">
          {currentStep.subTabs.map((sub) => {
            const isSubActive = activeTab === sub.id;
            return (
              <button
                key={sub.id}
                type="button"
                className={`pipeline-subtab-btn ${isSubActive ? 'subtab-active' : ''}`}
                onClick={() => onTabChange(sub.id)}
              >
                {sub.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Quick return banner if on Profile or Settings */}
      {!currentStep && (activeTab === 'profile' || activeTab === 'settings') && (
        <div className="utility-active-banner">
          <span className="utility-title">
            {activeTab === 'profile' ? 'Candidate profile' : 'Extension settings'}
          </span>
          <button
            type="button"
            className="btn-return-pipeline"
            onClick={() => onTabChange('overview')}
          >
            &larr; Return to Application Pipeline
          </button>
        </div>
      )}
    </div>
  );
};
