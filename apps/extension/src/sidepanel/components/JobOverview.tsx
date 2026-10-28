/**
 * @fileoverview The Job tab: read the posting on the current page and show how well it fits.
 *
 * One button reads the page. The result is a short job card (title, company, where, pay)
 * followed by the fit check, so the candidate sees in one place whether this job is worth
 * their time and what to do next.
 */

import React, { useState } from 'react';
import type { JobPosting } from '@applykit/domain';
import type { ExtractedPageData } from '../../messages/contracts.js';
import type { TabId } from './NavigationTabs.js';
import { MatchAnalysis } from './MatchAnalysis.js';

interface JobOverviewProps {
  jobData: ExtractedPageData | null;
  jobPosting: JobPosting | null;
  isExtracting: boolean;
  onExtract: () => void;
  onNavigateToTab: (tab: TabId) => void;
  error?: string | null;
}

const WORKPLACE_LABELS: Record<string, string> = {
  remote: 'Remote',
  hybrid: 'Hybrid',
  onsite: 'On-site',
};

const EMPLOYMENT_LABELS: Record<string, string> = {
  full_time: 'Full-time',
  part_time: 'Part-time',
  contract: 'Contract',
  internship: 'Internship',
  temporary: 'Temporary',
};

function formatSalary(salary: NonNullable<JobPosting['salaryRange']>): string {
  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: salary.currency,
    maximumFractionDigits: 0,
  });
  const range = salary.min === salary.max ? formatter.format(salary.min) : `${formatter.format(salary.min)} to ${formatter.format(salary.max)}`;
  return `${range} ${salary.period === 'hourly' ? 'an hour' : 'a year'}`;
}

/**
 * Renders the read-page action, the job card, and the fit check.
 */
export const JobOverview: React.FC<JobOverviewProps> = ({
  jobData,
  jobPosting,
  isExtracting,
  onExtract,
  onNavigateToTab,
  error,
}) => {
  const [showDescription, setShowDescription] = useState(false);

  const readButton = (
    <button type="button" className={`ui-btn ${jobPosting ? '' : 'ui-btn-primary ui-btn-block'}`} onClick={onExtract} disabled={isExtracting}>
      {isExtracting ? 'Reading the page...' : jobPosting ? 'Read this page again' : 'Read the job on this page'}
    </button>
  );

  return (
    <div className="ui-stack">
      {!jobPosting && (
        <section className="ui-card ui-stack" style={{ gap: 10 }}>
          <div>
            <h2 className="ui-card-title">Open a job posting, then read it here</h2>
            <p className="ui-text">
              Works on Greenhouse, Lever, Ashby, Workday, Recruitee and most company career pages. ApplyKit reads the
              page in your browser and nothing is sent anywhere.
            </p>
          </div>
          {readButton}
          <button type="button" className="ui-link" style={{ alignSelf: 'flex-start' }} onClick={() => onNavigateToTab('sourced_feed')}>
            No job open? Find one
          </button>
        </section>
      )}

      {error && (
        <div className="ui-note ui-note-bad" role="alert">
          <strong style={{ fontWeight: 600 }}>Couldn't read this page.</strong> {error}
          {typeof chrome !== 'undefined' && chrome.tabs && (
            <div style={{ marginTop: 6 }}>
              <button
                type="button"
                className="ui-link"
                onClick={async () => {
                  try {
                    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
                    if (tab?.id) await chrome.tabs.reload(tab.id);
                  } catch {
                    // The tab may have closed; the user can reload it themselves.
                  }
                }}
              >
                Reload the page and try again
              </button>
            </div>
          )}
        </div>
      )}

      {jobPosting && (
        <section className="ui-card ui-stack" style={{ gap: 10 }} aria-label="Job">
          <div>
            <h2 className="ui-title">{jobPosting.title}</h2>
            <p className="ui-text">{jobPosting.companyName}</p>
          </div>
          <dl className="ui-facts">
            <dt>Where</dt>
            <dd>
              {[WORKPLACE_LABELS[jobPosting.workplaceType] ?? '', jobPosting.location]
                .filter((part, index, all) => part && !(index === 0 && all[1]?.toLowerCase().startsWith(part.toLowerCase())))
                .join(' · ') || 'Not listed'}
            </dd>
            <dt>Type</dt>
            <dd>{EMPLOYMENT_LABELS[jobPosting.employmentType] ?? jobPosting.employmentType.replace(/_/g, ' ')}</dd>
            <dt>Pay</dt>
            <dd>{jobPosting.salaryRange ? formatSalary(jobPosting.salaryRange) : 'Not listed'}</dd>
          </dl>
          {jobPosting.rawDescription && (
            <div>
              <button type="button" className="ui-link" onClick={() => setShowDescription((v) => !v)}>
                {showDescription ? 'Hide the job description' : 'Show the job description'}
              </button>
              {showDescription && <div className="ui-pre" style={{ marginTop: 8 }}>{jobPosting.rawDescription}</div>}
            </div>
          )}
          <div>{readButton}</div>
        </section>
      )}

      {jobPosting && <MatchAnalysis jobPosting={jobPosting} onNavigateToTab={onNavigateToTab} />}

      {!jobPosting && jobData && (
        <section className="ui-card">
          <h2 className="ui-card-title">{jobData.h1[0] || jobData.title || 'This page'}</h2>
          <p className="ui-subtle" style={{ marginBottom: 8 }}>
            This page doesn't look like a job posting, so here is the text we found.
          </p>
          <div className="ui-pre">{jobData.cleanBodyText.slice(0, 1200)}</div>
        </section>
      )}
    </div>
  );
};
