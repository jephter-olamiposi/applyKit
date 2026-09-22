/**
 * @fileoverview Tab navigation component for ApplyKit Side Panel.
 */

import React from 'react';

export type TabId = 'overview' | 'requirements' | 'match' | 'tailor' | 'evidence' | 'form' | 'dry_run' | 'history' | 'profile' | 'settings';

interface NavigationTabsProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

interface TabDefinition {
  id: TabId;
  label: string;
}

const TABS: TabDefinition[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'requirements', label: 'Requirements' },
  { id: 'match', label: 'Match & Gaps' },
  { id: 'tailor', label: 'Tailor' },
  { id: 'evidence', label: 'Evidence' },
  { id: 'form', label: 'Form' },
  { id: 'dry_run', label: 'Dry Run' },
  { id: 'history', label: 'Tracker' },
  { id: 'profile', label: 'Profile' },
  { id: 'settings', label: 'API Keys' },
];

/**
 * Renders the top-level tab switcher.
 */
export const NavigationTabs: React.FC<NavigationTabsProps> = ({ activeTab, onTabChange }) => {
  return (
    <nav className="tab-navigation" role="tablist" aria-label="Extension navigation">
      {TABS.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            role="tab"
            type="button"
            aria-selected={isActive}
            className={`tab-button ${isActive ? 'tab-button-active' : ''}`}
            onClick={() => onTabChange(tab.id)}
          >
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
};
