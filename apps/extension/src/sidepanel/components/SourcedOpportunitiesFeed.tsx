/**
 * @fileoverview Live sourced opportunities feed with 5-gate qualification and EV tiering.
 *
 * Implements Stage 1 (direct sourcing) of the application pipeline (ADR-0043):
 * - Direct unauthenticated queries against Greenhouse, Ashby, and Lever APIs bypass middlemen.
 * - On-the-fly 5-gate waterfall qualification flags non-viable roles (e.g. US-only restrictions).
 * - Expected-value tiering surfaces the highest-likelihood opportunities first.
 * - "Open and stage" opens the posting and prepares the copilot for tailoring.
 */

import React, { useState, useEffect, useMemo } from 'react';
import type {
  CandidateProfile,
  EmploymentPreference,
  SourcedOpportunity,
  OpportunityTier,
  SourcedPlatformId,
} from '@applykit/domain';
import { sendToBackground } from '../../messages/bridge.js';
import type {
  CandidateProfileSummary,
  FetchAtsJobsResponse,
  GetSourcedOpportunitiesResponse,
  HarvestPageLinksResponse,
} from '../../messages/contracts.js';
import type { TabId } from './NavigationTabs.js';

interface SourcedOpportunitiesFeedProps {
  /** Candidate profile used to compute fit scores and 5-gate eligibility. */
  profile?: CandidateProfile | CandidateProfileSummary | null;
  /** Callback to navigate between side panel tabs (e.g. to Job Overview). */
  onNavigateToTab?: (tab: TabId) => void;
}

/**
 * Interactive feed for live job sourcing, ATS board harvesting, and EV-tier filtering.
 */
export const SourcedOpportunitiesFeed: React.FC<SourcedOpportunitiesFeedProps> = ({
  profile,
  onNavigateToTab,
}) => {
  const [opportunities, setOpportunities] = useState<SourcedOpportunity[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedTier, setSelectedTier] = useState<'all' | OpportunityTier>('all');
  const [keywordQuery, setKeywordQuery] = useState<string>('');
  const [selectedPlatform, setSelectedPlatform] = useState<'all' | SourcedPlatformId>('all');
  const [workplacePreference, setWorkplacePreference] = useState<
    'remote' | 'hybrid' | 'onsite' | 'any'
  >(
    profile && 'professional' in profile && profile.professional.workplacePreference !== 'flexible'
      ? profile.professional.workplacePreference
      : 'any'
  );
  const [employmentPreference, setEmploymentPreference] = useState<EmploymentPreference>(
    profile && 'professional' in profile ? profile.professional.employmentPreference || 'any' : 'any'
  );
  const [harvestedLinks, setHarvestedLinks] = useState<Array<{ url: string; title: string }>>([]);
  const [isHarvesting, setIsHarvesting] = useState<boolean>(false);
  const [harvestError, setHarvestError] = useState<string | null>(null);

  const [showCustomModal, setShowCustomModal] = useState<boolean>(false);
  const [customName, setCustomName] = useState<string>('');
  const [customSlug, setCustomSlug] = useState<string>('');
  const [customPlatform, setCustomPlatform] = useState<'greenhouse' | 'ashby' | 'lever'>('greenhouse');

  useEffect(() => {
    sendToBackground<{ type: 'GET_SOURCED_OPPORTUNITIES' }, GetSourcedOpportunitiesResponse>({
      type: 'GET_SOURCED_OPPORTUNITIES',
    })
      .then((res) => {
        if (res.opportunities && res.opportunities.length > 0) {
          setOpportunities(res.opportunities);
        }
      })
      .catch((err) => {
        console.error('Failed to load cached sourced opportunities:', err);
      });
  }, []);

  /**
   * Scans curated tech employer boards via background unauthenticated API fetch.
   */
  const handleScanWatchlist = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    setStatusMessage('Scanning direct ATS boards (Greenhouse, Ashby, Lever)...');
    try {
      const res = await sendToBackground<
        {
          type: 'FETCH_ATS_JOBS';
          keyword?: string;
          workplacePreference?: 'remote' | 'hybrid' | 'onsite' | 'any';
          employmentPreference?: EmploymentPreference;
        },
        FetchAtsJobsResponse
      >({
        type: 'FETCH_ATS_JOBS',
        keyword: keywordQuery.trim() || undefined,
        ...(workplacePreference !== 'any' ? { workplacePreference } : {}),
        ...(employmentPreference !== 'any' ? { employmentPreference } : {}),
      });

      if (res.success) {
        setOpportunities(res.opportunities);
        const failedSources = res.sourceStatuses?.filter((source) => source.status === 'failed') || [];
        setStatusMessage(
          failedSources.length > 0
            ? `Found ${res.opportunities.length} opportunities. ${failedSources.length} source(s) could not be scanned.`
            : `Found ${res.opportunities.length} live opportunities.`
        );
      } else {
        setErrorMessage(res.error || 'Failed to scan employer boards.');
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Scans a candidate-specified company ATS board.
   */
  const handleScanCustomBoard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customSlug.trim()) return;

    setIsLoading(true);
    setShowCustomModal(false);
    setErrorMessage(null);
    setStatusMessage(`Scanning board for ${customName.trim() || customSlug}...`);

    try {
      const res = await sendToBackground<
        {
          type: 'FETCH_ATS_JOBS';
          slugs: readonly { name: string; slug: string; platform: 'greenhouse' | 'ashby' | 'lever' }[];
          keyword?: string;
          workplacePreference?: 'remote' | 'hybrid' | 'onsite' | 'any';
          employmentPreference?: EmploymentPreference;
        },
        FetchAtsJobsResponse
      >({
        type: 'FETCH_ATS_JOBS',
        slugs: [
          {
            name: customName.trim() || customSlug.trim(),
            slug: customSlug.trim(),
            platform: customPlatform,
          },
        ],
        keyword: keywordQuery.trim() || undefined,
        ...(workplacePreference !== 'any' ? { workplacePreference } : {}),
        ...(employmentPreference !== 'any' ? { employmentPreference } : {}),
      });

      if (res.success) {
        setOpportunities((prev) => {
          const existingIds = new Set(res.opportunities.map((o) => o.id));
          return [...res.opportunities, ...prev.filter((p) => !existingIds.has(p.id))];
        });
        setStatusMessage(`Found ${res.opportunities.length} postings from ${customName || customSlug}.`);
      } else {
        setErrorMessage(res.error || 'Failed to fetch custom company board.');
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Harvests candidate job posting links directly from the active webpage DOM.
   */
  const handleHarvestPageLinks = async () => {
    setIsHarvesting(true);
    setHarvestError(null);
    try {
      const res = await sendToBackground<{ type: 'HARVEST_PAGE_LINKS' }, HarvestPageLinksResponse>({
        type: 'HARVEST_PAGE_LINKS',
      });

      if (res.success) {
        setHarvestedLinks(res.links);
        if (res.links.length === 0) {
          setHarvestError('No supported ATS job links or career URLs found on this active tab.');
        }
      } else {
        setHarvestError(res.error || 'Failed to harvest links from active tab.');
      }
    } catch (err) {
      setHarvestError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsHarvesting(false);
    }
  };

  /**
   * Opens the targeted job in a browser tab and navigates the sidepanel to the staging overview.
   */
  const handleOpenAndStage = (url: string) => {
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
      chrome.tabs.create({ url, active: true }, () => {
        if (onNavigateToTab) {
          onNavigateToTab('overview');
        }
      });
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
      if (onNavigateToTab) {
        onNavigateToTab('overview');
      }
    }
  };

  const filteredOpportunities = useMemo(() => {
    return opportunities.filter((opp) => {
      if (selectedTier !== 'all' && opp.tier !== selectedTier) {
        return false;
      }
      if (selectedPlatform !== 'all' && opp.sourcePlatform !== selectedPlatform) {
        return false;
      }
      if (workplacePreference !== 'any' && opp.workplaceType && opp.workplaceType !== workplacePreference) {
        return false;
      }
      if (employmentPreference !== 'any' && opp.employmentType && opp.employmentType !== employmentPreference) {
        return false;
      }
      if (keywordQuery.trim()) {
        const query = keywordQuery.toLowerCase();
        const matchesTitle = opp.title.toLowerCase().includes(query);
        const matchesEmployer = opp.employer.toLowerCase().includes(query);
        const matchesLocation = opp.locationText.toLowerCase().includes(query);
        if (!matchesTitle && !matchesEmployer && !matchesLocation) {
          return false;
        }
      }
      return true;
    });
  }, [
    opportunities,
    selectedTier,
    selectedPlatform,
    workplacePreference,
    employmentPreference,
    keywordQuery,
  ]);

  const tierCounts = useMemo(() => {
    const counts = {
      all: opportunities.length,
      tier1_high_ev: 0,
      tier2_competitive: 0,
      tier3_conditional: 0,
      tier4_low_or_blocked: 0,
    };
    for (const opp of opportunities) {
      if (opp.tier && opp.tier in counts) {
        counts[opp.tier]++;
      }
    }
    return counts;
  }, [opportunities]);

  return (
    <div className="feed-container">
      <section className="feed-header">
        <div className="feed-header-top">
          <div>
            <h2 className="feed-title">Job search</h2>
            <p className="feed-subtitle">
              Direct queries to employer ATS boards, screened against your eligibility and
              preferences.
            </p>
          </div>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setShowCustomModal(true)}
          >
            Add board
          </button>
        </div>

        <div className="feed-actions">
          <button
            type="button"
            className="btn-primary-sm"
            onClick={handleScanWatchlist}
            disabled={isLoading}
          >
            {isLoading ? 'Scanning boards...' : 'Scan watchlist'}
          </button>

          <button
            type="button"
            className="btn-ghost"
            onClick={handleHarvestPageLinks}
            disabled={isHarvesting}
            title="Scan the current browser tab for ATS job links"
          >
            {isHarvesting ? 'Harvesting...' : 'Harvest active tab'}
          </button>
        </div>

        <div className="feed-search-row">
          <input
            type="text"
            className="feed-search-input"
            aria-label="Filter opportunities"
            placeholder="Filter by title, company, or keyword"
            value={keywordQuery}
            onChange={(e) => setKeywordQuery(e.target.value)}
          />
          <select
            className="feed-select"
            aria-label="Filter by ATS platform"
            value={selectedPlatform}
            onChange={(e) => setSelectedPlatform(e.target.value as 'all' | SourcedPlatformId)}
          >
            <option value="all">All ATS</option>
            <option value="greenhouse">Greenhouse</option>
            <option value="ashby">Ashby</option>
            <option value="lever">Lever</option>
          </select>
        </div>

        <div className="feed-filter-row">
          <label className="feed-filter-label">
            Workplace
            <select
              className="feed-select"
              value={workplacePreference}
              onChange={(e) =>
                setWorkplacePreference(e.target.value as 'remote' | 'hybrid' | 'onsite' | 'any')
              }
            >
              <option value="any">Any</option>
              <option value="remote">Remote only</option>
              <option value="hybrid">Hybrid only</option>
              <option value="onsite">Onsite only</option>
            </select>
          </label>
          <label className="feed-filter-label">
            Employment
            <select
              className="feed-select"
              value={employmentPreference}
              onChange={(e) => setEmploymentPreference(e.target.value as EmploymentPreference)}
            >
              <option value="any">Any</option>
              <option value="full_time">Full time</option>
              <option value="part_time">Part time</option>
              <option value="contract">Contract</option>
              <option value="internship">Internship</option>
            </select>
          </label>
          <span className="feed-filter-note">Applies to this search only</span>
        </div>

        {statusMessage && !errorMessage && <p className="feed-status">{statusMessage}</p>}
        {errorMessage && <p className="feed-error-text">{errorMessage}</p>}
      </section>

      {harvestedLinks.length > 0 && (
        <section className="feed-harvest-panel">
          <div className="feed-harvest-head">
            <span className="feed-harvest-title">
              Links found on this tab ({harvestedLinks.length})
            </span>
            <button type="button" className="feed-link-btn" onClick={() => setHarvestedLinks([])}>
              Dismiss
            </button>
          </div>
          <div className="feed-harvest-list">
            {harvestedLinks.slice(0, 15).map((link, idx) => (
              <div className="feed-harvest-item" key={`${link.url}-${idx}`}>
                <span className="feed-harvest-link" title={link.title}>
                  {link.title}
                </span>
                <button
                  type="button"
                  className="btn-ghost btn-ghost-sm"
                  onClick={() => handleOpenAndStage(link.url)}
                >
                  Stage
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {harvestError && <p className="feed-error-banner">{harvestError}</p>}

      <div className="feed-tiers">
        <button
          type="button"
          className={`tier-pill ${selectedTier === 'all' ? 'tier-pill-active' : ''}`}
          onClick={() => setSelectedTier('all')}
        >
          All ({tierCounts.all})
        </button>
        <button
          type="button"
          className={`tier-pill tier-pill-1 ${selectedTier === 'tier1_high_ev' ? 'tier-pill-active' : ''}`}
          onClick={() => setSelectedTier('tier1_high_ev')}
        >
          Tier 1: High EV ({tierCounts.tier1_high_ev})
        </button>
        <button
          type="button"
          className={`tier-pill tier-pill-2 ${selectedTier === 'tier2_competitive' ? 'tier-pill-active' : ''}`}
          onClick={() => setSelectedTier('tier2_competitive')}
        >
          Tier 2: Competitive ({tierCounts.tier2_competitive})
        </button>
        <button
          type="button"
          className={`tier-pill tier-pill-3 ${selectedTier === 'tier3_conditional' ? 'tier-pill-active' : ''}`}
          onClick={() => setSelectedTier('tier3_conditional')}
        >
          Tier 3: Conditional ({tierCounts.tier3_conditional})
        </button>
        <button
          type="button"
          className={`tier-pill tier-pill-4 ${selectedTier === 'tier4_low_or_blocked' ? 'tier-pill-active' : ''}`}
          onClick={() => setSelectedTier('tier4_low_or_blocked')}
        >
          Blocked / Low ({tierCounts.tier4_low_or_blocked})
        </button>
      </div>

      <div className="feed-list">
        {filteredOpportunities.length === 0 && !isLoading && (
          <div className="feed-empty">
            <p className="feed-empty-title">No opportunities loaded</p>
            <p className="feed-empty-text">
              Select <strong>Scan watchlist</strong> to fetch live openings from employer boards.
            </p>
          </div>
        )}

        {filteredOpportunities.map((opp) => (
          <article className="opp-card" key={opp.id}>
            <div className="opp-head">
              <div className="opp-employer-group">
                <span className="opp-employer">{opp.employer}</span>
                <span className={`opp-platform opp-platform-${opp.sourcePlatform}`}>
                  {opp.sourcePlatform}
                </span>
              </div>

              {opp.matchScore !== undefined && (
                <span className="opp-match">{opp.matchScore}% match</span>
              )}
            </div>

            <h3 className="opp-title">{opp.title}</h3>

            <div className="opp-meta">
              <span>{opp.locationText}</span>
              {opp.compensationText && (
                <span className="opp-compensation">{opp.compensationText}</span>
              )}
            </div>

            {opp.verdict && (
              <div className="opp-verdict">
                {opp.verdict === 'OPEN' && (
                  <span className="verdict-pill verdict-open">Passes all eligibility gates</span>
                )}
                {opp.verdict === 'CONDITIONAL' && (
                  <span className="verdict-pill verdict-conditional">Needs manual review</span>
                )}
                {opp.verdict === 'BLOCKED' && (
                  <div className="verdict-blocked">
                    <span className="verdict-blocked-title">
                      Blocked: {opp.fatalGate ? opp.fatalGate.replace('_', ' ') : 'ineligible'}
                    </span>
                    {opp.verbatimEvidence && (
                      <p className="verdict-evidence">&quot;{opp.verbatimEvidence}&quot;</p>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="opp-actions">
              <button
                type="button"
                className="btn-ghost btn-ghost-sm"
                onClick={() => {
                  void navigator.clipboard.writeText(opp.url);
                }}
              >
                Copy link
              </button>
              <button
                type="button"
                className={`btn-primary-sm ${opp.verdict === 'BLOCKED' ? 'btn-primary-sm-muted' : ''}`}
                onClick={() => handleOpenAndStage(opp.url)}
              >
                Open and stage
              </button>
            </div>
          </article>
        ))}
      </div>

      {showCustomModal && (
        <div className="app-modal-overlay" role="dialog" aria-modal="true" aria-label="Add employer board">
          <div className="app-modal">
            <h3 className="app-modal-title">Add employer board</h3>

            <form onSubmit={handleScanCustomBoard}>
              <div className="app-modal-field">
                <label className="app-modal-label" htmlFor="custom-board-name">
                  Company name (optional)
                </label>
                <input
                  id="custom-board-name"
                  type="text"
                  className="app-modal-input"
                  placeholder="OpenAI, Stripe"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                />
              </div>

              <div className="app-modal-field">
                <label className="app-modal-label" htmlFor="custom-board-platform">
                  ATS platform
                </label>
                <select
                  id="custom-board-platform"
                  className="app-modal-input"
                  value={customPlatform}
                  onChange={(e) =>
                    setCustomPlatform(e.target.value as 'greenhouse' | 'ashby' | 'lever')
                  }
                >
                  <option value="greenhouse">Greenhouse (boards-api.greenhouse.io)</option>
                  <option value="ashby">Ashby (api.ashbyhq.com)</option>
                  <option value="lever">Lever (api.lever.co)</option>
                </select>
              </div>

              <div className="app-modal-field">
                <label className="app-modal-label" htmlFor="custom-board-slug">
                  Company slug
                </label>
                <input
                  id="custom-board-slug"
                  type="text"
                  required
                  className="app-modal-input"
                  placeholder="figma, stripe, replit"
                  value={customSlug}
                  onChange={(e) => setCustomSlug(e.target.value)}
                />
                <span className="app-modal-hint">
                  The slug appears in URLs such as jobs.ashbyhq.com/slug or
                  boards.greenhouse.io/slug.
                </span>
              </div>

              <div className="app-modal-actions">
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => setShowCustomModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary-sm">
                  Scan board
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
