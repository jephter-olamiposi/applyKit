/**
 * @fileoverview ATS Search Engine Dorks & Direct Endpoint Sourcing Component.
 *
 * Implements Phase 1 (Sourcing) of the autonomous job application pipeline (ADR-0043, SKILL.md):
 * - Direct ATS queries bypass noisy third-party scrapers, expired reposts, and sponsored middleman boards.
 * - Dynamic generation of targeted Google search dorks from candidate profile (roles, skills, freshness).
 * - Direct unauthenticated ATS board endpoints registry for zero-overhead company probes.
 */

import React, { useState, useMemo } from 'react';
import type { CandidateProfile, SearchDork, AtsPlatformId } from '@applykit/domain';
import { generateAtsSearchDorks, DIRECT_ATS_REGISTRY, buildDirectAtsApiUrl } from '@applykit/domain';

interface AtsSourcingEngineProps {
  /** Verified candidate profile aggregate used to seed roles and skills. */
  profile: CandidateProfile | null;
  /** Whether the component is embedded in a compact card or expanded. */
  initialExpanded?: boolean;
}

/**
 * Interactive direct ATS sourcing console and dork generator.
 */
export const AtsSourcingEngine: React.FC<AtsSourcingEngineProps> = ({
  profile,
  initialExpanded = false,
}) => {
  const [isExpanded, setIsExpanded] = useState<boolean>(initialExpanded);
  const [freshnessDays, setFreshnessDays] = useState<number>(14);
  const [customRole, setCustomRole] = useState<string>('');
  const [customTech, setCustomTech] = useState<string>('');
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [showDirectEndpoints, setShowDirectEndpoints] = useState<boolean>(false);
  const [testSlug, setTestSlug] = useState<string>('');
  const [selectedPlatform, setSelectedPlatform] = useState<AtsPlatformId>('greenhouse');

  const dorks: readonly SearchDork[] = useMemo(() => {
    const roleFamilies = customRole.trim()
      ? [customRole.trim()]
      : undefined;
    const techStack = customTech.trim()
      ? customTech.split(',').map((s) => s.trim()).filter(Boolean)
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
    <div
      className="sourcing-engine-card"
      style={{
        borderRadius: '8px',
        border: '1px solid #e2e8f0',
        backgroundColor: '#f8fafc',
        padding: '12px 14px',
        margin: '12px 0',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
        }}
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: '#0f172a' }}>
              Search job boards
            </h3>
            <p style={{ margin: 0, fontSize: '11px', color: '#64748b' }}>
              Target unindexed &amp; worldwide remote roles directly on Ashby, Greenhouse, Lever
            </p>
          </div>
        </div>
        <button
          type="button"
          style={{
            background: 'none',
            border: 'none',
            color: '#2563eb',
            fontSize: '12px',
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          {isExpanded ? 'Collapse ▲' : 'Open Sourcing Tools ▼'}
        </button>
      </div>

      {isExpanded && (
        <div style={{ marginTop: '12px', borderTop: '1px solid #e2e8f0', paddingTop: '10px' }}>
          {/* Controls: Freshness & Query overrides */}
          <div
            style={{
              display: 'flex',
              gap: '10px',
              flexWrap: 'wrap',
              marginBottom: '10px',
              alignItems: 'center',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <label htmlFor="sourcing-freshness" style={{ fontSize: '11px', fontWeight: 500, color: '#334155' }}>
                Posting Freshness:
              </label>
              <select
                id="sourcing-freshness"
                value={freshnessDays}
                onChange={(e) => setFreshnessDays(Number(e.target.value))}
                style={{
                  fontSize: '11px',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  border: '1px solid #cbd5e1',
                  backgroundColor: '#ffffff',
                }}
              >
                <option value={7}>Last 7 days</option>
                <option value={14}>Last 14 days (Recommended)</option>
                <option value={30}>Last 30 days</option>
              </select>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flex: 1, minWidth: '160px' }}>
              <input
                type="text"
                placeholder={profile?.professional?.headline || 'Override Role (e.g. Staff Backend)'}
                value={customRole}
                onChange={(e) => setCustomRole(e.target.value)}
                style={{
                  fontSize: '11px',
                  padding: '3px 8px',
                  borderRadius: '4px',
                  border: '1px solid #cbd5e1',
                  flex: 1,
                }}
              />
              <input
                type="text"
                placeholder="Tech (e.g. Go, Rust)"
                value={customTech}
                onChange={(e) => setCustomTech(e.target.value)}
                style={{
                  fontSize: '11px',
                  padding: '3px 8px',
                  borderRadius: '4px',
                  border: '1px solid #cbd5e1',
                  width: '110px',
                }}
              />
            </div>
          </div>

          {/* Dorks List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {dorks.map((dork, index) => (
              <div
                key={dork.title}
                style={{
                  padding: '8px 10px',
                  backgroundColor: '#ffffff',
                  borderRadius: '6px',
                  border: '1px solid #e2e8f0',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span
                      style={{
                        fontSize: '10px',
                        textTransform: 'uppercase',
                        fontWeight: 700,
                        padding: '1px 5px',
                        borderRadius: '3px',
                        backgroundColor: '#e0e7ff',
                        color: '#4338ca',
                      }}
                    >
                      {dork.category}
                    </span>
                    <strong style={{ fontSize: '12px', color: '#1e293b' }}>{dork.title}</strong>
                  </div>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      type="button"
                      onClick={() => handleCopyQuery(dork.query, index)}
                      style={{
                        padding: '2px 6px',
                        fontSize: '10px',
                        borderRadius: '3px',
                        border: '1px solid #cbd5e1',
                        backgroundColor: '#f8fafc',
                        cursor: 'pointer',
                        color: '#334155',
                      }}
                      title="Copy search query string"
                    >
                      {copiedIndex === index ? '✓ Copied' : 'Copy'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleOpenSearch(dork.searchUrl)}
                      style={{
                        padding: '2px 8px',
                        fontSize: '10px',
                        borderRadius: '3px',
                        border: '1px solid #2563eb',
                        backgroundColor: '#2563eb',
                        color: '#ffffff',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                      title="Search directly on Google in a new tab"
                    >
                      Search ↗
                    </button>
                  </div>
                </div>
                <div
                  style={{
                    fontSize: '10px',
                    fontFamily: 'monospace',
                    color: '#475569',
                    backgroundColor: '#f1f5f9',
                    padding: '4px 6px',
                    borderRadius: '4px',
                    overflowX: 'auto',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {dork.query}
                </div>
              </div>
            ))}
          </div>

          {/* Direct ATS Endpoints Drawer */}
          <div style={{ marginTop: '12px', borderTop: '1px dashed #cbd5e1', paddingTop: '8px' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                cursor: 'pointer',
              }}
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
              <span style={{ fontSize: '11px', fontWeight: 600, color: '#334155' }}>
                ATS board probes ({DIRECT_ATS_REGISTRY.length} platforms)
              </span>
              <span style={{ fontSize: '10px', color: '#2563eb' }}>
                {showDirectEndpoints ? 'Hide Endpoints ▲' : 'Show Endpoints ▼'}
              </span>
            </div>

            {showDirectEndpoints && (
              <div style={{ marginTop: '8px' }}>
                {/* Quick Probe Tester */}
                <div
                  style={{
                    display: 'flex',
                    gap: '6px',
                    alignItems: 'center',
                    marginBottom: '8px',
                    padding: '6px 8px',
                    backgroundColor: '#e2e8f0',
                    borderRadius: '4px',
                  }}
                >
                  <select
                    value={selectedPlatform}
                    onChange={(e) => setSelectedPlatform(e.target.value as AtsPlatformId)}
                    style={{ fontSize: '11px', padding: '2px 4px', borderRadius: '3px' }}
                  >
                    {DIRECT_ATS_REGISTRY.map((reg) => (
                      <option key={reg.platform} value={reg.platform}>
                        {reg.platformName}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    placeholder="Company slug (e.g. stripe)"
                    value={testSlug}
                    onChange={(e) => setTestSlug(e.target.value)}
                    style={{ fontSize: '11px', padding: '2px 6px', borderRadius: '3px', border: '1px solid #cbd5e1', flex: 1 }}
                  />
                  {directApiUrl && (
                    <button
                      type="button"
                      onClick={() => handleOpenSearch(directApiUrl)}
                      style={{
                        padding: '2px 6px',
                        fontSize: '10px',
                        borderRadius: '3px',
                        backgroundColor: '#0f172a',
                        color: '#ffffff',
                        cursor: 'pointer',
                      }}
                    >
                      Probe API ↗
                    </button>
                  )}
                </div>

                <div style={{ maxHeight: '160px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {DIRECT_ATS_REGISTRY.map((item) => (
                    <div
                      key={item.platform}
                      style={{
                        fontSize: '10px',
                        padding: '4px 6px',
                        backgroundColor: '#ffffff',
                        border: '1px solid #e2e8f0',
                        borderRadius: '3px',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <strong>{item.platformName}</strong>
                        <span style={{ color: '#64748b' }}>{item.notes}</span>
                      </div>
                      <code style={{ fontSize: '9px', color: '#0369a1', wordBreak: 'break-all' }}>
                        {item.endpointTemplate}
                      </code>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
