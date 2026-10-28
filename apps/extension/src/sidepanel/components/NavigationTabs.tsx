/**
 * @fileoverview Primary navigation for the side panel.
 *
 * Four tabs that follow how a person applies for a job: look at the job, get the resume
 * ready, fill the application, keep track of it. Profile and settings live in the header
 * because they are set up once, not used on every application.
 */

import React from 'react';
import type { SidePanelTabId } from '../../messages/contracts.js';

/**
 * Destinations the navigation bar can select.
 *
 * Re-exported from the message contracts so the panel and the service worker
 * cannot disagree about which tabs exist.
 */
export type TabId = SidePanelTabId;

/** The four top-level sections shown in the tab bar. */
export type PrimarySection = 'job' | 'resume' | 'apply' | 'tracker';

interface SectionDefinition {
  readonly id: PrimarySection;
  readonly label: string;
  readonly defaultTab: TabId;
  readonly memberTabs: readonly TabId[];
}

const SECTIONS: readonly SectionDefinition[] = [
  { id: 'job', label: 'Job', defaultTab: 'overview', memberTabs: ['overview', 'review_matches', 'sourced_feed'] },
  { id: 'resume', label: 'Resume', defaultTab: 'tailor_resume', memberTabs: ['tailor_resume', 'cover_letter'] },
  { id: 'apply', label: 'Apply', defaultTab: 'prepare_application', memberTabs: ['prepare_application'] },
  { id: 'tracker', label: 'Tracker', defaultTab: 'track', memberTabs: ['track'] },
];

/** Returns the top-level section a tab belongs to, or undefined for profile and settings. */
export function sectionForTab(tab: TabId): PrimarySection | undefined {
  return SECTIONS.find((section) => section.memberTabs.includes(tab))?.id;
}

interface NavigationTabsProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

/**
 * Renders the tab bar. Selecting a tab that is already active keeps the current sub-view.
 */
export const NavigationTabs: React.FC<NavigationTabsProps> = ({ activeTab, onTabChange }) => {
  const current = sectionForTab(activeTab);

  return (
    <nav className="ui-tabs" role="tablist" aria-label="Sections">
      {SECTIONS.map((section) => (
        <button
          key={section.id}
          type="button"
          role="tab"
          className="ui-tab"
          aria-selected={current === section.id}
          onClick={() => {
            if (current !== section.id) onTabChange(section.defaultTab);
          }}
        >
          {section.label}
        </button>
      ))}
    </nav>
  );
};
