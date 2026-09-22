/**
 * @fileoverview Job Overview display component for extracted posting content.
 */

import React from 'react';
import type { JobPosting } from '@applykit/domain';
import type { ExtractedPageData } from '../../messages/contracts.js';

interface JobOverviewProps {
  jobData: ExtractedPageData | null;
  jobPosting: JobPosting | null;
  isExtracting: boolean;
  onExtract: () => void;
  onViewRequirements?: () => void;
  onViewMatch?: () => void;
  error?: string | null;
}

/**
 * Displays active tab job posting data, extraction status, and trigger controls.
 */
export const JobOverview: React.FC<JobOverviewProps> = ({
  jobData,
  jobPosting,
  isExtracting,
  onExtract,
  onViewRequirements,
  onViewMatch,
  error,
}) => {
  const formatSalary = (salary: NonNullable<JobPosting['salaryRange']>) => {
    const formatter = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: salary.currency,
      maximumFractionDigits: 0,
    });
    const min = formatter.format(salary.min);
    const max = formatter.format(salary.max);
    return `${min} - ${max} / ${salary.period}`;
  };

  return (
    <div className="job-overview-container">
      <div className="action-bar">
        <button
          type="button"
          className="btn-primary"
          onClick={onExtract}
          disabled={isExtracting}
        >
          {isExtracting ? 'Extracting Page...' : 'Extract Job from Page'}
        </button>
      </div>

      {error && (
        <div className="alert-error" role="alert">
          <p className="alert-title">Extraction Error</p>
          <p className="alert-message">{error}</p>
        </div>
      )}

      {!jobData && !jobPosting && !error && (
        <div className="empty-state">
          <p className="empty-state-title">No Job Posting Extracted</p>
          <p className="empty-state-text">
            Navigate to any job application or career portal (Greenhouse, Lever, Workday, LinkedIn, etc.)
            and click <strong>Extract Job from Page</strong> to inspect metadata and requirements.
          </p>
        </div>
      )}

      {jobPosting && (
        <div className="job-details-card">
          <header className="job-card-header">
            <div className="job-title-group">
              <h2 className="job-card-title">{jobPosting.title}</h2>
              <p className="job-card-company">{jobPosting.companyName}</p>
            </div>
            <div className="badge-group">
              <span className="badge badge-site">
                {jobPosting.metadata.adapter ? `${jobPosting.metadata.adapter.toUpperCase()} Adapter` : 'Structured'}
              </span>
              <span className={`badge badge-${jobPosting.workplaceType}`}>
                {jobPosting.workplaceType.toUpperCase()}
              </span>
            </div>
          </header>

          <div className="job-metadata-grid">
            <div className="metadata-item">
              <span className="metadata-label">Location:</span>
              <span className="metadata-text">{jobPosting.location}</span>
            </div>

            <div className="metadata-item">
              <span className="metadata-label">Employment Type:</span>
              <span className="metadata-text">{jobPosting.employmentType.replace(/_/g, ' ')}</span>
            </div>

            {jobPosting.salaryRange && (
              <div className="metadata-item">
                <span className="metadata-label">Compensation:</span>
                <span className="metadata-text salary-highlight">
                  {formatSalary(jobPosting.salaryRange)}
                </span>
              </div>
            )}

            <div className="metadata-item">
              <span className="metadata-label">Requirements Parsed:</span>
              <span className="metadata-text">
                {jobPosting.requirements.length} qualifications identified
              </span>
            </div>
          </div>

          {jobPosting.requirements.length > 0 && (
            <div className="requirements-cta-card">
              <p className="cta-text">
                Found <strong>{jobPosting.requirements.length}</strong> requirements ({jobPosting.requirements.filter(r => r.isRequired).length} required).
              </p>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '6px' }}>
                {onViewMatch && (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={onViewMatch}
                  >
                    Analyze Match &amp; Gaps &rarr;
                  </button>
                )}
                {onViewRequirements && (
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={onViewRequirements}
                  >
                    Inspect Raw Requirements &rarr;
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="job-section">
            <h3 className="section-title">Job Description Summary</h3>
            <div className="body-preview">
              {jobPosting.rawDescription.slice(0, 600)}
              {jobPosting.rawDescription.length > 600 ? '...' : ''}
            </div>
          </div>
        </div>
      )}

      {!jobPosting && jobData && (
        <div className="job-details-card">
          <header className="job-card-header">
            <h2 className="job-card-title">
              {jobData.h1[0] || jobData.title || 'Untitled Posting'}
            </h2>
          </header>

          <div className="job-section">
            <h3 className="section-title">Extracted Text Preview</h3>
            <div className="body-preview">
              {jobData.cleanBodyText.slice(0, 600)}
              {jobData.cleanBodyText.length > 600 ? '...' : ''}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
