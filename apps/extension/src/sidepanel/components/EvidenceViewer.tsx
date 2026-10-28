/**
 * @fileoverview The lines from the candidate's resume that ApplyKit is allowed to quote.
 *
 * Every resume bullet, cover letter sentence, and form answer ApplyKit writes must trace
 * back to one of these lines (ADR-0004). Showing them, grouped by where they came from,
 * lets the candidate see exactly what ApplyKit knows and spot anything it misread. To
 * change them, the candidate replaces their resume from the profile card above.
 */

import React, { useState, useEffect, useMemo } from 'react';
import type { Evidence } from '@applykit/domain';
import { sendToBackground } from '../../messages/bridge.js';
import type { GetEvidenceGraphResponse } from '../../messages/contracts.js';

/** Where a line came from, for grouping: the employer, school, or project named on it. */
function sourceLabel(evidence: Evidence): string {
  const meta = evidence.source.metadata ?? {};
  const role = [meta['title'], meta['company']].filter(Boolean).join(', ');
  return role || meta['institution'] || 'Other';
}

/**
 * Lists the stored resume lines grouped by role or project.
 */
export const EvidenceViewer: React.FC = () => {
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  useEffect(() => {
    sendToBackground<{ type: 'GET_EVIDENCE_GRAPH' }, GetEvidenceGraphResponse>({ type: 'GET_EVIDENCE_GRAPH' })
      .then((res) => {
        if (!res.success) return;
        // A one-line project is stored both as its description and as its bullet, which
        // showed every such line twice. Show each line once per role or project.
        const seen = new Set<string>();
        const unique = res.evidence.filter((item) => {
          if (item.source.metadata?.['scope'] === 'role_overview') return false;
          const key = `${sourceLabel(item)}|${item.textSnippet.replace(/\s+/g, ' ').trim().toLowerCase()}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        setEvidence(unique);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  const groups = useMemo(() => {
    const term = query.trim().toLowerCase();
    const map = new Map<string, Evidence[]>();
    for (const item of evidence) {
      if (term && !item.textSnippet.toLowerCase().includes(term)) continue;
      const key = sourceLabel(item);
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    return [...map.entries()];
  }, [evidence, query]);

  if (loading) return <p className="ui-subtle">Loading...</p>;
  if (evidence.length === 0) {
    return <p className="ui-subtle">Nothing yet. Add your resume above and its lines will show up here.</p>;
  }

  return (
    <div className="ui-stack" style={{ gap: 10 }}>
      <p className="ui-subtle">
        ApplyKit only writes things it can trace to one of these {evidence.length} lines. If one looks wrong, fix it in your
        resume and replace it above.
      </p>
      {evidence.length > 12 && (
        <input
          type="search"
          className="ui-input"
          placeholder="Search your lines"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      {groups.map(([label, items]) => (
        <div key={label}>
          <p className="ui-label" style={{ color: 'var(--text)', fontWeight: 600 }}>
            {label}
          </p>
          <ul className="ui-list">
            {items.map((item) => (
              <li key={item.id} className="ui-text" style={{ padding: '5px 0' }}>
                {item.textSnippet}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {groups.length === 0 && <p className="ui-subtle">No lines match.</p>}
    </div>
  );
};
