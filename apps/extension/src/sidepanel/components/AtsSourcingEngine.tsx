/**
 * @fileoverview ATS search dork generator and direct endpoint sourcing panel.
 *
 * Implements Phase 1 (sourcing) of the application pipeline (ADR-0043):
 * - Direct ATS queries bypass noisy scrapers, expired reposts, and sponsored boards.
 * - Search dorks are generated from the candidate profile (roles, skills, freshness).
 * - A registry of unauthenticated ATS board endpoints supports zero-overhead probes.
 */

import React, { useState, useMemo, useEffect } from 'react';
import { sendToBackground } from '../../messages/bridge.js';
import type { GetCandidateProfileResponse } from '../../messages/contracts.js';
import type { CandidateProfile, SearchDork, AtsPlatformId } from '@applykit/domain';
import { generateAtsSearchDorks, DIRECT_ATS_REGISTRY, buildDirectAtsApiUrl } from '@applykit/domain';

interface AtsSourcingEngineProps {
  /** Candidate profile used to seed roles and skills; loaded from storage when omitted. */
  profile?: CandidateProfile | null;
  /** Whether the panel starts expanded. */
  initialExpanded?: boolean;
}

/**
 * Interactive direct ATS sourcing console and dork generator.
 */
export const AtsSourcingEngine: React.FC<AtsSourcingEngineProps> = ({
  profile: providedProfile,
  initialExpanded = false,
}) => {
  const [loadedProfile, setLoadedProfile] = useState<CandidateProfile | null>(null);
  useEffect(() => {
    if (providedProfile) return;
    sendToBackground<{ type: 'GET_CANDIDATE_PROFILE' }, GetCandidateProfileResponse>({ type: 'GET_CANDIDATE_PROFILE' })
      .then((res) => {
        if (res?.profile) setLoadedProfile(res.profile);
      })
      .catch(() => undefined);
  }, [providedProfile]);
  const profile = providedProfile ?? loadedProfile;
  const [isExpanded, setIsExpanded] = useState<boolean>(initialExpanded);
  const [freshnessDays, setFreshnessDays] = useState<number>(14);
  const [customRole, setCustomRole] = useState<string>('');
  const [customTech, setCustomTech] = useState<string>('');
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [showDirectEndpoints, setShowDirectEndpoints] = useState<boolean>(false);
  const [testSlug, setTestSlug] = useState<string>('');
  const [selectedPlatform, setSelectedPlatform] = useState<AtsPlatformId>('greenhouse');

  const dorks: readonly SearchDork[] = useMemo(() => {
    const roleFamilies = customRole.trim() ? [customRole.trim()] : undefined;
    const techStack = customTech.trim()
      ? customTech
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;

    return generateAtsSearchDorks(profile, {
      freshnessDays,
      roleFamilies,
      techStack,
    });
  }, [profile, freshnessDays, customRole, customTech]);

  const handleCopyQuery = async (query: string, index: number) => {
    try {
      await navigator.clipboard.writeText(query);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    } catch (err) {
      console.error('Failed to copy query to clipboard:', err);
    }
  };

  const handleOpenSearch = (url: string) => {
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
      chrome.tabs.create({ url });
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  const directApiUrl = useMemo(() => {
    if (!testSlug.trim()) return null;
    return buildDirectAtsApiUrl(selectedPlatform, testSlug.trim());
  }, [selectedPlatform, testSlug]);

  return (
    <section className="ats-card">
      <div
        className="ats-card-head"
        onClick={() => setIsExpanded(!isExpanded)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setIsExpanded(!isExpanded);
          }
        }}
      >
        <div>
          <h3 className="ats-card-title">Search Google for openings</h3>
          <p className="ats-card-sub">
            Ready-made Google searches that find fresh roles on Ashby, Greenhouse, Lever and company sites.
          </p>
        </div>
        <button type="button" className="ats-toggle-link">
          {isExpanded ? 'Hide' : 'Show'}
        </button>
      </div>

      {isExpanded && (
        <div className="ats-body">
          <div className="ats-controls">
            <div className="ats-field">
              <label className="ats-label" htmlFor="sourcing-freshness">
                Posted in the
              </label>
              <select
                id="sourcing-freshness"
                className="ats-select"
                value={freshnessDays}
                onChange={(e) => setFreshnessDays(Number(e.target.value))}
              >
                <option value={7}>Last 7 days</option>
                <option value={14}>Last 14 days</option>
                <option value={30}>Last 30 days</option>
              </select>
            </div>

            <div className="ats-field ats-field-grow">
              <input
                type="text"
                className="ats-input"
                aria-label="Override role"
                placeholder={profile?.professional?.headline || 'Override role, e.g. Staff Backend'}
                value={customRole}
                onChange={(e) => setCustomRole(e.target.value)}
              />
              <input
                type="text"
                className="ats-input ats-input-narrow"
                aria-label="Technology filter"
                placeholder="Tech, e.g. Go, Rust"
                value={customTech}
                onChange={(e) => setCustomTech(e.target.value)}
              />
            </div>
          </div>

          <div className="ats-dork-list">
            {dorks.map((dork, index) => (
              <div className="ats-dork" key={dork.title}>
                <div className="ats-dork-head">
                  <div className="ats-dork-title-group">
                    <span className="ats-dork-category">{dork.category}</span>
                    <strong className="ats-dork-title">{dork.title}</strong>
                  </div>
                  <div className="ats-dork-actions">
                    <button
                      type="button"
                      className="btn-ghost btn-ghost-sm"
                      onClick={() => handleCopyQuery(dork.query, index)}
                      title="Copy search query"
                    >
                      {copiedIndex === index ? 'Copied' : 'Copy'}
                    </button>
                    <button
                      type="button"
                      className="btn-primary-sm"
                      onClick={() => handleOpenSearch(dork.searchUrl)}
                      title="Open this search in a new tab"
                    >
                      Search
                    </button>
                  </div>
                </div>
                <div className="ats-dork-query">{dork.query}</div>
              </div>
            ))}
          </div>

          <div className="ats-endpoints">
            <div
              className="ats-endpoints-head"
              onClick={() => setShowDirectEndpoints(!showDirectEndpoints)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setShowDirectEndpoints(!showDirectEndpoints);
                }
              }}
            >
              <span className="ats-endpoints-title">
                Open a company's job list directly
              </span>
              <span className="ats-endpoints-toggle">
                {showDirectEndpoints ? 'Hide' : 'Show'}
              </span>
            </div>

            {showDirectEndpoints && (
              <div className="ats-probe-wrap">
                <div className="ats-probe">
                  <select
                    className="ats-select"
                    aria-label="ATS platform"
                    value={selectedPlatform}
                    onChange={(e) => setSelectedPlatform(e.target.value as AtsPlatformId)}
                  >
                    {DIRECT_ATS_REGISTRY.map((reg) => (
                      <option key={reg.platform} value={reg.platform}>
                        {reg.platformName}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    className="ats-input"
                    aria-label="Company slug"
                    placeholder="Company name as in its job board link, e.g. stripe"
                    value={testSlug}
                    onChange={(e) => setTestSlug(e.target.value)}
                  />
                  {directApiUrl && (
                    <button
                      type="button"
                      className="btn-primary-sm"
                      onClick={() => handleOpenSearch(directApiUrl)}
                    >
                      Open job list
                    </button>
                  )}
                </div>

                <div className="ats-probe-list">
                  {DIRECT_ATS_REGISTRY.map((item) => (
                    <div className="ats-probe-item" key={item.platform}>
                      <div className="ats-probe-item-head">
                        <strong>{item.platformName}</strong>
                        <span className="ats-probe-notes">{item.notes}</span>
                      </div>
                      <code className="ats-probe-code">{item.endpointTemplate}</code>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
};
