/**
 * @fileoverview Job Overview display component for extracted posting content.
 */

import React, { useState, useEffect, useMemo } from 'react';
import type { JobPosting, CandidateProfile, JobEligibilityReport } from '@applykit/domain';
import { verifyJobEligibility } from '@applykit/domain';
import { sendToBackground } from '../../messages/bridge.js';
import type { ExtractedPageData, GetCandidateProfileResponse } from '../../messages/contracts.js';
import type { TabId } from './NavigationTabs.js';
import { AtsSourcingEngine } from './AtsSourcingEngine.js';

interface JobOverviewProps {
  jobData: ExtractedPageData | null;
  jobPosting: JobPosting | null;
  isExtracting: boolean;
  onExtract: () => void;
  onViewRequirements?: () => void;
  onViewMatch?: () => void;
  onNavigateToTab?: (tab: TabId) => void;
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
  onNavigateToTab,
  error,
}) => {
  const [profile, setProfile] = useState<CandidateProfile | null>(null);
  const [showGateDetails, setShowGateDetails] = useState<boolean>(false);

  useEffect(() => {
    sendToBackground<{ type: 'GET_CANDIDATE_PROFILE' }, GetCandidateProfileResponse>({
      type: 'GET_CANDIDATE_PROFILE',
    })
      .then((res) => {
        if (res.profile) {
          setProfile(res.profile);
        }
      })
      .catch((err) => {
        console.error('Failed to load profile for eligibility verification:', err);
      });
  }, []);

  const eligibility: JobEligibilityReport | null = useMemo(() => {
    if (!jobPosting || !profile) return null;
    return verifyJobEligibility(jobPosting, profile);
  }, [jobPosting, profile]);

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
          {typeof chrome !== 'undefined' && chrome.tabs && (
            <button
              type="button"
              className="btn btn-secondary"
              style={{ marginTop: '8px', fontSize: '11px', padding: '4px 10px', width: 'auto' }}
              onClick={async () => {
                try {
                  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
                  if (tab && tab.id) {
                    await chrome.tabs.reload(tab.id);
                  }
                } catch {
                  // Fallback
                }
              }}
            >
              Refresh page
            </button>
          )}
        </div>
      )}

      {!jobData && !jobPosting && !error && (
        <>
          <div className="empty-state">
            <p className="empty-state-title">No Job Posting Extracted</p>
            <p className="empty-state-text">
              Navigate to any job application or career portal (Greenhouse, Lever, Workday, LinkedIn, etc.)
              and click <strong>Extract Job from Page</strong> to inspect metadata and requirements.
            </p>
            {onNavigateToTab && (
              <button
                type="button"
                className="btn-next-step"
                onClick={() => onNavigateToTab('sourced_feed')}
              >
                Open job search
              </button>
            )}
          </div>
          <AtsSourcingEngine profile={profile} initialExpanded={true} />
        </>
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
                {jobPosting.metadata?.adapter
                  ? `${jobPosting.metadata.adapter.charAt(0).toUpperCase() + jobPosting.metadata.adapter.slice(1)} Application`
                  : 'Direct Application'}
              </span>
              <span className={`badge badge-${jobPosting.workplaceType || 'hybrid'}`}>
                {(jobPosting.workplaceType || 'hybrid').toUpperCase()}
              </span>
            </div>
          </header>

          {/* 5-Gate Eligibility Waterfall Card (SKILL.md Phase 2: Verification Precedes Effort) */}
          {eligibility && (
            <div
              className={`eligibility-card eligibility-${eligibility.verdict.toLowerCase()}`}
              style={{
                margin: '12px 0',
                padding: '12px 14px',
                borderRadius: '8px',
                border:
                  eligibility.verdict === 'BLOCKED'
                    ? '1px solid #ef4444'
                    : eligibility.verdict === 'CONDITIONAL'
                    ? '1px solid #f59e0b'
                    : '1px solid #10b981',
                backgroundColor:
                  eligibility.verdict === 'BLOCKED'
                    ? '#fef2f2'
                    : eligibility.verdict === 'CONDITIONAL'
                    ? '#fffbeb'
                    : '#f0fdf4',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '8px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span
                    style={{
                      fontWeight: 700,
                      fontSize: '11px',
                      textTransform: 'uppercase',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      color: '#ffffff',
                      backgroundColor:
                        eligibility.verdict === 'BLOCKED'
                          ? '#dc2626'
                          : eligibility.verdict === 'CONDITIONAL'
                          ? '#d97706'
                          : '#059669',
                    }}
                  >
                    {eligibility.verdict === 'OPEN' && 'Eligibility: OPEN'}
                    {eligibility.verdict === 'CONDITIONAL' && 'Eligibility: CONDITIONAL'}
                    {eligibility.verdict === 'BLOCKED' && 'Eligibility: BLOCKED'}
                  </span>
                  <span style={{ fontSize: '12px', color: '#374151', fontWeight: 500 }}>
                    {eligibility.verdict === 'OPEN' && 'Passes 5-gate screening: Geography, Auth, Entity, Timezone, Requirements.'}
                    {eligibility.verdict === 'CONDITIONAL' && 'Timezone or hours overlap conditional. Candidate confirmation needed.'}
                    {eligibility.verdict === 'BLOCKED' && `Fatal roadblock on Gate ${eligibility.fatalGate ? eligibility.fatalGate.toUpperCase() : ''}. Zero effort recommended.`}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowGateDetails((prev) => !prev)}
                  style={{
                    fontSize: '11px',
                    color: '#4b5563',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    textDecoration: 'underline',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {showGateDetails ? 'Hide Details' : 'View 5 Gates'}
                </button>
              </div>

              {/* Verbatim employer evidence quote */}
              {eligibility.verbatimEvidence && (
                <div
                  style={{
                    marginTop: '8px',
                    padding: '6px 10px',
                    fontSize: '11px',
                    fontStyle: 'italic',
                    color: eligibility.verdict === 'BLOCKED' ? '#991b1b' : '#92400e',
                    backgroundColor: 'rgba(255, 255, 255, 0.7)',
                    borderLeft: `3px solid ${eligibility.verdict === 'BLOCKED' ? '#dc2626' : '#d97706'}`,
                    borderRadius: '0 4px 4px 0',
                  }}
                >
                  <strong>Verbatim Employer Evidence:</strong> "{eligibility.verbatimEvidence}"
                </div>
              )}

              {/* Expandable 5-gate checklist */}
              {showGateDetails && (
                <div style={{ marginTop: '10px', fontSize: '11px', borderTop: '1px solid rgba(0,0,0,0.08)', paddingTop: '8px' }}>
                  {eligibility.checks.map((check) => (
                    <div
                      key={check.gate}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '6px',
                        marginBottom: '4px',
                        color: check.status === 'passed' ? '#065f46' : check.status === 'conditional' ? '#92400e' : '#991b1b',
                      }}
                    >
                      <span>{check.status === 'passed' ? 'Pass' : check.status === 'conditional' ? 'Review' : 'Fail'}</span>
                      <div>
                        <strong style={{ textTransform: 'capitalize' }}>{check.gate}:</strong>{' '}
                        <span>{check.reason}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

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

          {/* Job sourcing remains available as a secondary view from Find Jobs. */}
          <AtsSourcingEngine profile={profile} initialExpanded={false} />

          {/* Pipeline Forward Progression Card */}
          <div className="pipeline-next-step-card">
            <div className="next-step-info">
              <span className="next-step-title">Prepare your application</span>
              <span className="next-step-desc">
                Review the resume and cover letter before opening the application form.
              </span>
            </div>
            <button
              type="button"
              className="btn-primary btn-next-step"
              onClick={() => {
                if (onNavigateToTab) {
                  onNavigateToTab('tailor_resume');
                } else if (onViewMatch) {
                  onViewMatch();
                }
              }}
            >
              Continue to resume
            </button>
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
