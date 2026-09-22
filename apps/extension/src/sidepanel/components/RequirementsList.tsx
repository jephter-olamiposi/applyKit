/**
 * @fileoverview Requirements List component for displaying normalized job qualifications.
 */

import React from 'react';
import type { Requirement } from '@applykit/domain';

interface RequirementsListProps {
  requirements: readonly Requirement[];
}

export const RequirementsList: React.FC<RequirementsListProps> = ({ requirements }) => {
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
    </div>
  );
};
