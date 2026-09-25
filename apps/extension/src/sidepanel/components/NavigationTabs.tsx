/**
 * @fileoverview Streamlined 4-stage pipeline navigation component for ApplyKit Side Panel.
 *
 * Implements candidate-centric workflow navigation:
 * 1. Step 1: Job & Fit (Overview, Requirements, Match & Gaps)
 * 2. Step 2: Tailor (Resume & Cover Letter Studio, Evidence Graph)
 * 3. Step 3: Auto-Fill (1-Click Form Auto-Fill & Safety Dry Run)
 * 4. Step 4: Tracker (Saved Applications & Statuses)
 *
 * Provides a clear progression bar where each step naturally leads to the next,
 * eliminating cognitive overload from 10 unranked tabs.
 */

import React from 'react';

export type TabId =
  | 'overview'
  | 'requirements'
  | 'match'
  | 'tailor'
  | 'evidence'
  | 'form'
  | 'dry_run'
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
    id: 'step_job',
    stepNumber: 1,
    label: 'Job & Fit',
    defaultTab: 'overview',
    memberTabs: ['overview', 'requirements', 'match'],
    subTabs: [
      { id: 'overview', label: 'Job Details' },
      { id: 'requirements', label: 'Requirements' },
      { id: 'match', label: 'Match & Gaps' },
    ],
  },
  {
    id: 'step_tailor',
    stepNumber: 2,
    label: 'Tailor',
    defaultTab: 'tailor',
    memberTabs: ['tailor', 'evidence'],
    subTabs: [
      { id: 'tailor', label: 'Resume & Letter' },
      { id: 'evidence', label: 'Evidence Graph' },
    ],
  },
  {
    id: 'step_fill',
    stepNumber: 3,
    label: 'Auto-Fill',
    defaultTab: 'form',
    memberTabs: ['form', 'dry_run'],
    subTabs: [
      { id: 'form', label: '1-Click Auto-Fill' },
      { id: 'dry_run', label: 'Safety Dry Run' },
    ],
  },
  {
    id: 'step_tracker',
    stepNumber: 4,
    label: 'Tracker',
    defaultTab: 'history',
    memberTabs: ['history'],
    subTabs: [],
  },
];

/**
 * Renders the streamlined 4-step pipeline navigation and contextual subtabs.
 */
export const NavigationTabs: React.FC<NavigationTabsProps> = ({ activeTab, onTabChange }) => {
  const currentStep = PIPELINE_STEPS.find((step) => step.memberTabs.includes(activeTab));

  return (
    <div className="pipeline-nav-container">
      {/* 4-Step Primary Pipeline Bar */}
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
            {activeTab === 'profile' ? '👤 Verified Candidate Profile' : '⚙️ API & Extension Settings'}
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
