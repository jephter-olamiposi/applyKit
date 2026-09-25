/**
 * @fileoverview Requirements List component for displaying normalized job qualifications.
 */

import React from 'react';
import type { Requirement } from '@applykit/domain';
import type { TabId } from './NavigationTabs.js';

interface RequirementsListProps {
  requirements: readonly Requirement[];
  onNavigateToTab?: (tab: TabId) => void;
}

export const RequirementsList: React.FC<RequirementsListProps> = ({ requirements, onNavigateToTab }) => {
  if (requirements.length === 0) {
    return (
      <div className="empty-state">
        <p className="empty-state-title">No Requirements Extracted</p>
        <p className="empty-state-text">
          Extract a job posting first from the Overview tab to view parsed qualifications.
        </p>
      </div>
    );
  }

  const requiredItems = requirements.filter((r) => r.isRequired);
  const preferredItems = requirements.filter((r) => !r.isRequired);

  const renderCategoryBadge = (category: string) => {
    const formatted = category.replace(/_/g, ' ');
    return <span className="badge badge-category">{formatted}</span>;
  };

  return (
    <div className="requirements-view-container">
      <header className="requirements-header">
        <h2 className="section-title">Job Requirements &amp; Qualifications</h2>
        <div className="requirements-metrics">
          <span className="metric-pill metric-required">
            Required: {requiredItems.length}
          </span>
          <span className="metric-pill metric-preferred">
            Preferred: {preferredItems.length}
          </span>
          <span className="metric-pill metric-total">
            Total: {requirements.length}
          </span>
        </div>
      </header>

      {requiredItems.length > 0 && (
        <section className="requirements-group">
          <h3 className="group-title required-group-title">
            Must-Have / Required Qualifications ({requiredItems.length})
          </h3>
          <ul className="requirements-list">
            {requiredItems.map((req) => (
              <li key={req.id} className="requirement-card required-card">
                <div className="requirement-card-header">
                  <span className="competency-tag">{req.normalizedSkillOrCompetency}</span>
                  {renderCategoryBadge(req.category)}
                  {req.yearsRequired !== undefined && (
                    <span className="badge badge-years">{req.yearsRequired}+ yrs</span>
                  )}
                </div>
                <p className="requirement-raw-text">{req.rawText}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {preferredItems.length > 0 && (
        <section className="requirements-group">
          <h3 className="group-title preferred-group-title">
            Preferred / Nice-to-Have ({preferredItems.length})
          </h3>
          <ul className="requirements-list">
            {preferredItems.map((req) => (
              <li key={req.id} className="requirement-card preferred-card">
                <div className="requirement-card-header">
                  <span className="competency-tag">{req.normalizedSkillOrCompetency}</span>
                  {renderCategoryBadge(req.category)}
                  {req.yearsRequired !== undefined && (
                    <span className="badge badge-years">{req.yearsRequired}+ yrs</span>
                  )}
                </div>
                <p className="requirement-raw-text">{req.rawText}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Pipeline Forward Progression Card */}
      <div className="pipeline-next-step-card">
        <div className="next-step-info">
          <span className="next-step-title">Requirements Reviewed</span>
          <span className="next-step-desc">
            Analyze your qualifications against these requirements, or proceed to tailoring your materials.
          </span>
        </div>
        <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
          {onNavigateToTab && (
            <>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => onNavigateToTab('match')}
              >
                Analyze Match &amp; Gaps &rarr;
              </button>
              <button
                type="button"
                className="btn-primary btn-next-step"
                onClick={() => onNavigateToTab('tailor')}
              >
                Next Step: Tailor Materials &rarr;
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
