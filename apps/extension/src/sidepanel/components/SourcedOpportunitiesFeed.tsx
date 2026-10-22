/**
 * @fileoverview Live Sourced Opportunities Feed with 5-Gate Qualification & EV Tiering.
 *
 * Implements Stage 1 (Direct Sourcing) of the autonomous application pipeline (ADR-0043):
 * - Direct unauthenticated queries against Greenhouse, Ashby, and Lever APIs bypass middlemen.
 * - On-the-fly 5-gate waterfall qualification flags non-viable roles (e.g. US-only restrictions).
 * - Expected-Value (EV) priority tiering surfaces the highest likelihood opportunities first.
 * - One-click "Open & Stage" opens the job in browser and prepares the copilot for tailoring.
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

  // Custom company board scanner state
  const [showCustomModal, setShowCustomModal] = useState<boolean>(false);
  const [customName, setCustomName] = useState<string>('');
  const [customSlug, setCustomSlug] = useState<string>('');
  const [customPlatform, setCustomPlatform] = useState<'greenhouse' | 'ashby' | 'lever'>('greenhouse');

  // Load cached opportunities from background service worker on mount
  useEffect(() => {
    sendToBackground<
      { type: 'GET_SOURCED_OPPORTUNITIES' },
      GetSourcedOpportunitiesResponse
    >({ type: 'GET_SOURCED_OPPORTUNITIES' })
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
            : `Discovered and screened ${res.opportunities.length} live opportunities.`
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
        // Prepend custom board results and deduplicate
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
      const res = await sendToBackground<
        { type: 'HARVEST_PAGE_LINKS' },
        HarvestPageLinksResponse
      >({ type: 'HARVEST_PAGE_LINKS' });

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

  // Filter opportunities by tier, platform, and in-memory search
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

  // Aggregate tier counts for summary filter badges
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
    <div className="sourced-feed-container" style={{ padding: '4px 0' }}>
      {/* Header and Controls */}
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '8px',
          border: '1px solid #e2e8f0',
          padding: '12px 14px',
          marginBottom: '12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: '#0f172a' }}>
              📡 Live Job Sourcing &amp; Feed
            </h2>
            <p style={{ margin: '2px 0 0', fontSize: '11px', color: '#64748b' }}>
              Direct ATS board queries with instant 5-Gate qualification &amp; EV tiering
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowCustomModal(true)}
            style={{
              fontSize: '11px',
              padding: '4px 8px',
              backgroundColor: '#f1f5f9',
              color: '#334155',
              border: '1px solid #cbd5e1',
              borderRadius: '4px',
              cursor: 'pointer',
              fontWeight: 500,
            }}
          >
            + Add Board
          </button>
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
          <button
            type="button"
            onClick={handleScanWatchlist}
            disabled={isLoading}
            style={{
              flex: 1,
              padding: '7px 12px',
              backgroundColor: isLoading ? '#94a3b8' : '#2563eb',
              color: '#ffffff',
              border: 'none',
              borderRadius: '6px',
              fontSize: '12px',
              fontWeight: 600,
              cursor: isLoading ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
            }}
          >
            {isLoading ? 'Scanning boards...' : 'Scan watchlist'}
          </button>

          <button
            type="button"
            onClick={handleHarvestPageLinks}
            disabled={isHarvesting}
            style={{
              padding: '7px 12px',
              backgroundColor: '#f8fafc',
              color: '#334155',
              border: '1px solid #cbd5e1',
              borderRadius: '6px',
              fontSize: '12px',
              fontWeight: 500,
              cursor: isHarvesting ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
            title="Scan current browser tab for ATS job links"
          >
            {isHarvesting ? 'Harvesting...' : 'Harvest active tab'}
          </button>
        </div>

        {/* Search & Filter Row */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <input
            type="text"
            placeholder="Filter title, company, or keyword..."
            value={keywordQuery}
            onChange={(e) => setKeywordQuery(e.target.value)}
            style={{
              flex: 1,
              padding: '6px 10px',
              fontSize: '12px',
              border: '1px solid #cbd5e1',
              borderRadius: '6px',
              outline: 'none',
            }}
          />
          <select
            value={selectedPlatform}
            onChange={(e) => setSelectedPlatform(e.target.value as any)}
            style={{
              padding: '6px 8px',
              fontSize: '11px',
              border: '1px solid #cbd5e1',
              borderRadius: '6px',
              backgroundColor: '#ffffff',
              color: '#334155',
            }}
          >
            <option value="all">All ATS</option>
            <option value="greenhouse">Greenhouse</option>
            <option value="ashby">Ashby</option>
            <option value="lever">Lever</option>
          </select>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '8px' }}>
          <label style={{ fontSize: '11px', color: '#475569' }}>
            Workplace
            <select
              value={workplacePreference}
              onChange={(e) =>
                setWorkplacePreference(e.target.value as 'remote' | 'hybrid' | 'onsite' | 'any')
              }
              style={{
                marginLeft: '5px',
                padding: '6px 8px',
                fontSize: '11px',
                border: '1px solid #cbd5e1',
                borderRadius: '6px',
                backgroundColor: '#ffffff',
              }}
            >
              <option value="any">Any</option>
              <option value="remote">Remote only</option>
              <option value="hybrid">Hybrid only</option>
              <option value="onsite">Onsite only</option>
            </select>
          </label>
          <label style={{ fontSize: '11px', color: '#475569' }}>
            Employment
            <select
              value={employmentPreference}
              onChange={(e) => setEmploymentPreference(e.target.value as EmploymentPreference)}
              style={{
                marginLeft: '5px',
                padding: '6px 8px',
                fontSize: '11px',
                border: '1px solid #cbd5e1',
                borderRadius: '6px',
                backgroundColor: '#ffffff',
              }}
            >
              <option value="any">Any</option>
              <option value="full_time">Full time</option>
              <option value="part_time">Part time</option>
              <option value="contract">Contract</option>
              <option value="internship">Internship</option>
            </select>
          </label>
          <span style={{ fontSize: '10px', color: '#64748b' }}>This search only</span>
        </div>

        {/* Status / Error feedback */}
        {statusMessage && !errorMessage && (
          <p style={{ margin: '8px 0 0', fontSize: '11px', color: '#059669' }}>
            ✓ {statusMessage}
          </p>
        )}
        {errorMessage && (
          <p style={{ margin: '8px 0 0', fontSize: '11px', color: '#dc2626' }}>
            {errorMessage}
          </p>
        )}
      </div>

      {/* Harvested Active Tab Links Panel */}
      {harvestedLinks.length > 0 && (
        <div
          style={{
            backgroundColor: '#f0fdf4',
            borderRadius: '8px',
            border: '1px solid #bbf7d0',
            padding: '10px 12px',
            marginBottom: '12px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: '#166534' }}>
              Discovered on Active Tab ({harvestedLinks.length})
            </span>
            <button
              type="button"
              onClick={() => setHarvestedLinks([])}
              style={{ background: 'none', border: 'none', fontSize: '11px', color: '#64748b', cursor: 'pointer' }}
            >
              Dismiss
            </button>
          </div>
          <div style={{ maxHeight: '140px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {harvestedLinks.slice(0, 15).map((link, idx) => (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '4px 6px',
                  backgroundColor: '#ffffff',
                  borderRadius: '4px',
                  border: '1px solid #dcfce7',
                }}
              >
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 500,
                    color: '#0f172a',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    maxWidth: '220px',
                  }}
                  title={link.title}
                >
                  {link.title}
                </span>
                <button
                  type="button"
                  onClick={() => handleOpenAndStage(link.url)}
                  style={{
                    fontSize: '10px',
                    padding: '2px 6px',
                    backgroundColor: '#166534',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '3px',
                    cursor: 'pointer',
                  }}
                >
                  Stage
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {harvestError && (
        <div
          style={{
            backgroundColor: '#fef2f2',
            borderRadius: '8px',
            border: '1px solid #fecaca',
            padding: '8px 12px',
            marginBottom: '12px',
            fontSize: '11px',
            color: '#b91c1c',
          }}
        >
          {harvestError}
        </div>
      )}

      {/* EV Priority Tier Badges / Filter Tabs */}
      <div
        style={{
          display: 'flex',
          gap: '4px',
          overflowX: 'auto',
          paddingBottom: '6px',
          marginBottom: '8px',
        }}
      >
        <button
          type="button"
          onClick={() => setSelectedTier('all')}
          style={{
            padding: '4px 8px',
            borderRadius: '12px',
            fontSize: '11px',
            fontWeight: 500,
            cursor: 'pointer',
            border: 'none',
            backgroundColor: selectedTier === 'all' ? '#0f172a' : '#f1f5f9',
            color: selectedTier === 'all' ? '#ffffff' : '#475569',
            whiteSpace: 'nowrap',
          }}
        >
          All ({tierCounts.all})
        </button>

        <button
          type="button"
          onClick={() => setSelectedTier('tier1_high_ev')}
          style={{
            padding: '4px 8px',
            borderRadius: '12px',
            fontSize: '11px',
            fontWeight: 500,
            cursor: 'pointer',
            border: 'none',
            backgroundColor: selectedTier === 'tier1_high_ev' ? '#166534' : '#dcfce7',
            color: selectedTier === 'tier1_high_ev' ? '#ffffff' : '#166534',
            whiteSpace: 'nowrap',
          }}
        >
          ★ Tier 1: High EV ({tierCounts.tier1_high_ev})
        </button>

        <button
          type="button"
          onClick={() => setSelectedTier('tier2_competitive')}
          style={{
            padding: '4px 8px',
            borderRadius: '12px',
            fontSize: '11px',
            fontWeight: 500,
            cursor: 'pointer',
            border: 'none',
            backgroundColor: selectedTier === 'tier2_competitive' ? '#1d4ed8' : '#dbeafe',
            color: selectedTier === 'tier2_competitive' ? '#ffffff' : '#1d4ed8',
            whiteSpace: 'nowrap',
          }}
        >
          Tier 2: Competitive ({tierCounts.tier2_competitive})
        </button>

        <button
          type="button"
          onClick={() => setSelectedTier('tier3_conditional')}
          style={{
            padding: '4px 8px',
            borderRadius: '12px',
            fontSize: '11px',
            fontWeight: 500,
            cursor: 'pointer',
            border: 'none',
            backgroundColor: selectedTier === 'tier3_conditional' ? '#b45309' : '#fef3c7',
            color: selectedTier === 'tier3_conditional' ? '#ffffff' : '#b45309',
            whiteSpace: 'nowrap',
          }}
        >
          Tier 3: Conditional ({tierCounts.tier3_conditional})
        </button>

        <button
          type="button"
          onClick={() => setSelectedTier('tier4_low_or_blocked')}
          style={{
            padding: '4px 8px',
            borderRadius: '12px',
            fontSize: '11px',
            fontWeight: 500,
            cursor: 'pointer',
            border: 'none',
            backgroundColor: selectedTier === 'tier4_low_or_blocked' ? '#475569' : '#f1f5f9',
            color: selectedTier === 'tier4_low_or_blocked' ? '#ffffff' : '#64748b',
            whiteSpace: 'nowrap',
          }}
        >
          Blocked / Low ({tierCounts.tier4_low_or_blocked})
        </button>
      </div>

      {/* Opportunity Cards List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {filteredOpportunities.length === 0 && !isLoading && (
          <div
            style={{
              padding: '24px 16px',
              textAlign: 'center',
              backgroundColor: '#f8fafc',
              borderRadius: '8px',
              border: '1px dashed #cbd5e1',
            }}
          >
            <span style={{ fontSize: '24px' }}>📡</span>
            <p style={{ margin: '8px 0 4px', fontSize: '13px', fontWeight: 600, color: '#334155' }}>
              No opportunities loaded
            </p>
            <p style={{ margin: 0, fontSize: '11px', color: '#64748b' }}>
              Click <strong>&quot;Scan Curated Watchlist&quot;</strong> above to fetch live openings across tech employer boards.
            </p>
          </div>
        )}

        {filteredOpportunities.map((opp) => (
          <div
            key={opp.id}
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '8px',
              border: '1px solid #e2e8f0',
              padding: '12px',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
            }}
          >
            {/* Header: Company & Platform Badge */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a' }}>
                  {opp.employer}
                </span>
                <span
                  style={{
                    fontSize: '9px',
                    textTransform: 'uppercase',
                    padding: '2px 5px',
                    borderRadius: '4px',
                    backgroundColor:
                      opp.sourcePlatform === 'ashby'
                        ? '#ede9fe'
                        : opp.sourcePlatform === 'greenhouse'
                        ? '#dcfce7'
                        : '#fee2e2',
                    color:
                      opp.sourcePlatform === 'ashby'
                        ? '#6d28d9'
                        : opp.sourcePlatform === 'greenhouse'
                        ? '#15803d'
                        : '#b91c1c',
                    fontWeight: 600,
                  }}
                >
                  {opp.sourcePlatform}
                </span>
              </div>

              {opp.matchScore !== undefined && (
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    color: opp.matchScore >= 75 ? '#15803d' : opp.matchScore >= 50 ? '#1d4ed8' : '#64748b',
                  }}
                >
                  {opp.matchScore}% Match
                </span>
              )}
            </div>

            {/* Role Title */}
            <h3 style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: '#1e293b', lineHeight: 1.3 }}>
              {opp.title}
            </h3>

            {/* Location & Compensation */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', fontSize: '11px', color: '#64748b' }}>
              <span>📍 {opp.locationText}</span>
              {opp.compensationText && (
                <span style={{ color: '#059669', fontWeight: 500 }}>
                  💰 {opp.compensationText}
                </span>
              )}
            </div>

            {/* 5-Gate Qualification Verdict Badge & Verbatim Proof */}
            {opp.verdict && (
              <div style={{ marginTop: '2px' }}>
                {opp.verdict === 'OPEN' && (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      fontSize: '10px',
                      fontWeight: 600,
                      color: '#15803d',
                      backgroundColor: '#dcfce7',
                      padding: '2px 6px',
                      borderRadius: '4px',
                    }}
                  >
                    ✓ 5-Gate Pass (Eligible)
                  </span>
                )}
                {opp.verdict === 'CONDITIONAL' && (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      fontSize: '10px',
                      fontWeight: 600,
                      color: '#b45309',
                      backgroundColor: '#fef3c7',
                      padding: '2px 6px',
                      borderRadius: '4px',
                    }}
                  >
                    Conditional review required
                  </span>
                )}
                {opp.verdict === 'BLOCKED' && (
                  <div
                    style={{
                      backgroundColor: '#fef2f2',
                      borderRadius: '4px',
                      border: '1px solid #fecaca',
                      padding: '4px 6px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span style={{ fontSize: '10px', fontWeight: 700, color: '#dc2626' }}>
                        Blocked: {opp.fatalGate ? opp.fatalGate.replace('_', ' ') : 'Ineligible'}
                      </span>
                    </div>
                    {opp.verbatimEvidence && (
                      <p
                        style={{
                          margin: '2px 0 0',
                          fontSize: '10px',
                          color: '#7f1d1d',
                          fontStyle: 'italic',
                          borderLeft: '2px solid #ef4444',
                          paddingLeft: '6px',
                        }}
                      >
                        &quot;{opp.verbatimEvidence}&quot;
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Action Bar */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-end',
                gap: '6px',
                marginTop: '4px',
                paddingTop: '6px',
                borderTop: '1px solid #f1f5f9',
              }}
            >
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(opp.url);
                }}
                style={{
                  padding: '4px 8px',
                  backgroundColor: '#f8fafc',
                  border: '1px solid #cbd5e1',
                  borderRadius: '4px',
                  fontSize: '10px',
                  color: '#475569',
                  cursor: 'pointer',
                  fontWeight: 500,
                }}
              >
                Copy Link
              </button>

              <button
                type="button"
                onClick={() => handleOpenAndStage(opp.url)}
                style={{
                  padding: '4px 10px',
                  backgroundColor: opp.verdict === 'BLOCKED' ? '#64748b' : '#2563eb',
                  border: 'none',
                  borderRadius: '4px',
                  fontSize: '10px',
                  color: '#ffffff',
                  cursor: 'pointer',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                Open and stage
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Add Custom Board Modal */}
      {showCustomModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '16px',
          }}
        >
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '8px',
              padding: '16px',
              width: '100%',
              maxWidth: '320px',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
            }}
          >
            <h3 style={{ margin: '0 0 10px', fontSize: '14px', fontWeight: 600, color: '#0f172a' }}>
              Add Custom Employer Board
            </h3>

            <form onSubmit={handleScanCustomBoard}>
              <div style={{ marginBottom: '8px' }}>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 500, color: '#334155', marginBottom: '2px' }}>
                  Company Name (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. OpenAI, Stripe"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '6px 8px',
                    fontSize: '12px',
                    border: '1px solid #cbd5e1',
                    borderRadius: '4px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div style={{ marginBottom: '8px' }}>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 500, color: '#334155', marginBottom: '2px' }}>
                  ATS Platform
                </label>
                <select
                  value={customPlatform}
                  onChange={(e) => setCustomPlatform(e.target.value as any)}
                  style={{
                    width: '100%',
                    padding: '6px 8px',
                    fontSize: '12px',
                    border: '1px solid #cbd5e1',
                    borderRadius: '4px',
                    backgroundColor: '#ffffff',
                    boxSizing: 'border-box',
                  }}
                >
                  <option value="greenhouse">Greenhouse (boards-api.greenhouse.io)</option>
                  <option value="ashby">Ashby (api.ashbyhq.com)</option>
                  <option value="lever">Lever (api.lever.co)</option>
                </select>
              </div>

              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: 500, color: '#334155', marginBottom: '2px' }}>
                  Company Slug
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. figma, stripe, replit"
                  value={customSlug}
                  onChange={(e) => setCustomSlug(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '6px 8px',
                    fontSize: '12px',
                    border: '1px solid #cbd5e1',
                    borderRadius: '4px',
                    boxSizing: 'border-box',
                  }}
                />
                <span style={{ fontSize: '10px', color: '#64748b' }}>
                  Found in URLs like jobs.ashbyhq.com/<strong>slug</strong> or boards.greenhouse.io/<strong>slug</strong>
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => setShowCustomModal(false)}
                  style={{
                    padding: '6px 12px',
                    backgroundColor: '#f1f5f9',
                    border: '1px solid #cbd5e1',
                    borderRadius: '4px',
                    fontSize: '11px',
                    color: '#475569',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{
                    padding: '6px 12px',
                    backgroundColor: '#2563eb',
                    border: 'none',
                    borderRadius: '4px',
                    fontSize: '11px',
                    fontWeight: 600,
                    color: '#ffffff',
                    cursor: 'pointer',
                  }}
                >
                  Scan Board
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
