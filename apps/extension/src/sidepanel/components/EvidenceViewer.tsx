/**
 * @fileoverview Evidence Graph & Claim Verification Inspector for Side Panel UI.
 *
 * Implements candidate review interface for evidence provenance (ADR-0004):
 * - Direct resume/document ingestion and atomic decomposition.
 * - Zero-hallucination grounding audit metrics display.
 * - Interactive claim inspection with citations to underlying evidence snippets.
 */

import React, { useState, useEffect, useCallback } from 'react';
import type {
  Evidence,
  CandidateClaim,
  GroundingAuditReport,
  ClaimType,
} from '@applykit/domain';
import { sendToBackground } from '../../messages/bridge.js';
import type {
  GetEvidenceGraphResponse,
  IngestResumeResponse,
} from '../../messages/contracts.js';

interface EvidenceViewerProps {
  onProfileUpdated: () => void;
}

const SAMPLE_RESUME_FIXTURE = `# Alex Rivera
alex.rivera@example.com | (555) 345-6789 | Austin, TX
https://linkedin.com/in/alexrivera | https://github.com/alexrivera | https://alexrivera.io

## Summary
Backend Platform Engineer with 6 years of experience building distributed microservices with Go, TypeScript, and Kafka.

## Work Experience
### Senior Backend Engineer | CloudScale Inc | Jan 2021 - Present | Austin, TX
- Scaled event-driven ingestion pipeline with Go and Kafka handling 100,000 events/sec.
- Optimized PostgreSQL database indexes and connection pooling, reducing query response times by 55%.
- Mentored 3 junior software engineers and established architectural RFC review standards.

### Software Engineer | DataCorp | Jun 2018 - Dec 2020 | Remote
- Implemented microservices using TypeScript, Node.js, and Docker.
- Automated deployment workflows using GitHub Actions and AWS Terraform.

## Projects
### EventStream | High Throughput Messaging Client
https://github.com/alexrivera/eventstream
- Developed open-source Go client library for distributed message queues.
- Achieved sub-millisecond dispatch latency under heavy concurrency workloads.

## Education
B.S. in Computer Science | University of Texas at Austin | 2018

## Technical Skills
Languages: Go, TypeScript, Python, SQL
Technologies: Kafka, Docker, Kubernetes, PostgreSQL, AWS, Redis, Git
`;

export const EvidenceViewer: React.FC<EvidenceViewerProps> = ({ onProfileUpdated }) => {
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [claims, setClaims] = useState<CandidateClaim[]>([]);
  const [auditReport, setAuditReport] = useState<GroundingAuditReport | null>(null);
  const [loading, setLoading] = useState(true);

  // Ingestion state
  const [showIngest, setShowIngest] = useState(false);
  const [resumeText, setResumeText] = useState('');
  const [isIngesting, setIsIngesting] = useState(false);
  const [ingestStatus, setIngestStatus] = useState<string | null>(null);
  const [ingestError, setIngestError] = useState<string | null>(null);

  // Filter & interaction state
  const [activeFilter, setActiveFilter] = useState<'all' | ClaimType>('all');
  const [expandedClaimId, setExpandedClaimId] = useState<string | null>(null);

  const loadGraph = useCallback(async () => {
    try {
      setLoading(true);
      const res = await sendToBackground<
        { type: 'GET_EVIDENCE_GRAPH' },
        GetEvidenceGraphResponse
      >({ type: 'GET_EVIDENCE_GRAPH' });

      if (res.success) {
        setEvidence(res.evidence);
        setClaims(res.claims);
        setAuditReport(res.auditReport || null);
      }
    } catch {
      // Graph empty on first run
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadGraph();
  }, [loadGraph]);

  const handleIngest = async () => {
    if (!resumeText.trim()) {
      setIngestError('Please paste resume text or click "Load Sample" first.');
      return;
    }

    setIsIngesting(true);
    setIngestStatus(null);
    setIngestError(null);

    try {
      const res = await sendToBackground<
        { type: 'INGEST_RESUME_TEXT'; rawText: string },
        IngestResumeResponse
      >({
        type: 'INGEST_RESUME_TEXT',
        rawText: resumeText,
      });

      if (res.success) {
        setIngestStatus(
          `Successfully ingested ${res.evidenceCount ?? 0} atomic evidence nodes and derived ${res.claimsCount ?? 0} verified claims!`
        );
        setShowIngest(false);
        setResumeText('');
        onProfileUpdated();
        await loadGraph();
      } else {
        setIngestError(res.error || 'Failed to ingest resume document.');
      }
    } catch (err) {
      setIngestError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsIngesting(false);
    }
  };

  const handleLoadSample = () => {
    setResumeText(SAMPLE_RESUME_FIXTURE);
    setIngestError(null);
  };

  const filteredClaims = activeFilter === 'all'
    ? claims
    : claims.filter((c) => c.claimType === activeFilter);

  // Helper map for evidence lookup
  const evidenceLookup = new Map<string, Evidence>();
  for (const ev of evidence) {
    evidenceLookup.set(ev.id, ev);
  }

  return (
    <div className="tab-panel evidence-viewer">
      <div className="section-header-row">
        <div>
          <h2 className="section-title">Evidence & Claims Graph</h2>
          <p className="section-description">
            Zero-hallucination verification engine. Every claim must cite verified evidence.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => {
            setShowIngest(!showIngest);
            setIngestStatus(null);
            setIngestError(null);
          }}
        >
          {showIngest ? 'Close Ingestion' : '+ Ingest Resume'}
        </button>
      </div>

      {ingestStatus && (
        <div className="alert alert-success" style={{ marginBottom: '12px' }}>
          {ingestStatus}
        </div>
      )}

      {/* Collapsible Resume Ingest Form */}
      {showIngest && (
        <div className="ingest-box" style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '16px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: 600, margin: '0 0 8px 0' }}>Ingest Candidate Document / Resume</h3>
          <p style={{ fontSize: '12px', color: '#64748b', margin: '0 0 8px 0' }}>
            Paste markdown or plain text. Ingestion runs 100% locally in your browser.
          </p>

          <textarea
            className="form-textarea"
            rows={8}
            placeholder="Paste raw resume or document text here..."
            value={resumeText}
            onChange={(e) => setResumeText(e.target.value)}
            disabled={isIngesting}
            style={{ fontFamily: 'monospace', fontSize: '12px', width: '100%', boxSizing: 'border-box' }}
          />

          {ingestError && (
            <div className="alert alert-error" style={{ marginTop: '8px' }}>
              {ingestError}
            </div>
          )}

          <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={handleIngest}
              disabled={isIngesting || !resumeText.trim()}
            >
              {isIngesting ? 'Parsing & Ingesting...' : 'Parse & Ingest Evidence'}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleLoadSample}
              disabled={isIngesting}
            >
              Load Sample Resume
            </button>
          </div>
        </div>
      )}

      {/* Grounding Audit Summary Card */}
      {auditReport && (
        <div
          className="audit-card"
          style={{
            background: auditReport.isPristine ? '#f0fdf4' : '#fffbeb',
            border: `1px solid ${auditReport.isPristine ? '#bbf7d0' : '#fef08a'}`,
            borderRadius: '8px',
            padding: '12px',
            marginBottom: '16px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <span style={{ fontSize: '12px', fontWeight: 600, color: auditReport.isPristine ? '#166534' : '#854d0e' }}>
                GROUNDING INTEGRITY AUDIT
              </span>
              <div style={{ fontSize: '20px', fontWeight: 700, color: auditReport.isPristine ? '#15803d' : '#a16207' }}>
                {(auditReport.groundingScore * 100).toFixed(0)}% Substantiated
              </div>
            </div>
            <span
              className={`badge ${auditReport.isPristine ? 'badge-required' : 'badge-preferred'}`}
              style={{ padding: '4px 8px', fontSize: '11px' }}
            >
              {auditReport.isPristine ? 'Pristine Grounding' : 'Audit Warnings'}
            </span>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: '8px',
              marginTop: '12px',
              paddingTop: '10px',
              borderTop: '1px solid rgba(0,0,0,0.06)',
              textAlign: 'center',
            }}
          >
            <div>
              <div style={{ fontSize: '16px', fontWeight: 700 }}>{auditReport.totalClaims}</div>
              <div style={{ fontSize: '10px', color: '#64748b' }}>Total Claims</div>
            </div>
            <div>
              <div style={{ fontSize: '16px', fontWeight: 700, color: '#16a34a' }}>
                {auditReport.substantiatedClaimsCount}
              </div>
              <div style={{ fontSize: '10px', color: '#64748b' }}>Substantiated</div>
            </div>
            <div>
              <div style={{ fontSize: '16px', fontWeight: 700 }}>{auditReport.totalEvidenceNodes}</div>
              <div style={{ fontSize: '10px', color: '#64748b' }}>Evidence Nodes</div>
            </div>
            <div>
              <div
                style={{
                  fontSize: '16px',
                  fontWeight: 700,
                  color: auditReport.unbackedClaims.length > 0 ? '#dc2626' : '#64748b',
                }}
              >
                {auditReport.unbackedClaims.length}
              </div>
              <div style={{ fontSize: '10px', color: '#64748b' }}>Unbacked Gaps</div>
            </div>
          </div>

          {auditReport.warnings.length > 0 && (
            <div style={{ marginTop: '10px', fontSize: '11px', color: '#b45309' }}>
              {auditReport.warnings.map((w, idx) => (
                <div key={idx}>&bull; {w}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Filter Chips */}
      {claims.length > 0 && (
        <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '8px', marginBottom: '12px' }}>
          {(
            [
              { id: 'all', label: `All (${claims.length})` },
              { id: 'skill_proficiency', label: 'Skills' },
              { id: 'achievement', label: 'Achievements' },
              { id: 'credential', label: 'Credentials' },
              { id: 'leadership', label: 'Leadership' },
            ] as const
          ).map((filter) => (
            <button
              key={filter.id}
              type="button"
              onClick={() => setActiveFilter(filter.id)}
              style={{
                fontSize: '11px',
                padding: '4px 10px',
                borderRadius: '14px',
                border: activeFilter === filter.id ? '1px solid #2563eb' : '1px solid #cbd5e1',
                background: activeFilter === filter.id ? '#eff6ff' : '#ffffff',
                color: activeFilter === filter.id ? '#1d4ed8' : '#475569',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                fontWeight: activeFilter === filter.id ? 600 : 400,
              }}
            >
              {filter.label}
            </button>
          ))}
        </div>
      )}

      {/* Claim Cards List */}
      {loading ? (
        <p className="empty-state">Loading evidence graph...</p>
      ) : claims.length === 0 ? (
        <div className="empty-state-card" style={{ textAlign: 'center', padding: '24px 12px', background: '#f8fafc', borderRadius: '8px' }}>
          <p style={{ margin: '0 0 12px 0', color: '#64748b' }}>
            No verified evidence nodes or claims loaded yet.
          </p>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => setShowIngest(true)}
          >
            + Ingest Resume Document
          </button>
        </div>
      ) : (
        <div className="claims-list" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {filteredClaims.map((claim) => {
            const isExpanded = expandedClaimId === claim.id;
            const isSubstantiated = claim.supportedByEvidenceIds.length > 0 && claim.confidence >= 0.7;

            return (
              <div
                key={claim.id}
                className="claim-card"
                style={{
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  padding: '12px',
                  background: '#ffffff',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                  <span
                    style={{
                      fontSize: '10px',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      fontWeight: 600,
                      color: '#64748b',
                      background: '#f1f5f9',
                      padding: '2px 6px',
                      borderRadius: '4px',
                    }}
                  >
                    {claim.claimType.replace('_', ' ')}
                  </span>
                  <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                    <span
                      style={{
                        fontSize: '11px',
                        fontWeight: 600,
                        color: claim.confidence >= 0.85 ? '#16a34a' : '#d97706',
                      }}
                    >
                      {(claim.confidence * 100).toFixed(0)}% Conf.
                    </span>
                    <span
                      style={{
                        fontSize: '10px',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        background: isSubstantiated ? '#dcfce7' : '#fee2e2',
                        color: isSubstantiated ? '#166534' : '#991b1b',
                        fontWeight: 600,
                      }}
                    >
                      {isSubstantiated ? 'Verified' : 'Unbacked'}
                    </span>
                  </div>
                </div>

                <p style={{ fontSize: '13px', margin: '8px 0 6px 0', color: '#1e293b', lineHeight: 1.4 }}>
                  {claim.statement}
                </p>

                {claim.tags.length > 0 && (
                  <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '8px' }}>
                    {claim.tags.map((t, idx) => (
                      <span
                        key={idx}
                        style={{
                          fontSize: '10px',
                          background: '#f8fafc',
                          color: '#475569',
                          border: '1px solid #e2e8f0',
                          padding: '1px 6px',
                          borderRadius: '4px',
                        }}
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}

                {/* Supporting Evidence Toggle */}
                {claim.supportedByEvidenceIds.length > 0 && (
                  <div style={{ marginTop: '6px', paddingTop: '6px', borderTop: '1px solid #f1f5f9' }}>
                    <button
                      type="button"
                      onClick={() => setExpandedClaimId(isExpanded ? null : claim.id)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#2563eb',
                        fontSize: '11px',
                        cursor: 'pointer',
                        padding: 0,
                        fontWeight: 500,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                    >
                      <span>{isExpanded ? '▾ Hide' : '▸ View'} Supporting Evidence ({claim.supportedByEvidenceIds.length})</span>
                    </button>

                    {isExpanded && (
                      <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {claim.supportedByEvidenceIds.map((evId) => {
                          const ev = evidenceLookup.get(evId);
                          if (!ev) return null;
                          return (
                            <div
                              key={ev.id}
                              style={{
                                background: '#f8fafc',
                                borderLeft: '3px solid #3b82f6',
                                padding: '6px 10px',
                                borderRadius: '0 4px 4px 0',
                                fontSize: '11px',
                                color: '#334155',
                              }}
                            >
                              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                                <span style={{ fontWeight: 600, color: '#1e293b' }}>
                                  {ev.source.metadata?.company || ev.source.metadata?.institution || ev.source.type}
                                </span>
                                <span style={{ fontSize: '10px', color: '#94a3b8' }}>
                                  {ev.source.type}
                                </span>
                              </div>
                              <div style={{ fontStyle: 'italic', lineHeight: 1.35 }}>
                                &ldquo;{ev.textSnippet}&rdquo;
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
