/**
 * @fileoverview Provider API key configuration and token tracking component adhering to API Key Isolation (ADR-0002).
 */

import React, { useState, useEffect, useCallback } from 'react';
import type { AIProviderName, TokenUsage } from '@applykit/domain';
import type {
  ApiKeysStatus,
  GetTokenMetricsResponse,
  ResetTokenMetricsResponse,
  GetStorageUsageRequest,
  GetStorageUsageResponse,
  PurgeAllDataRequest,
  PurgeAllDataResponse,
  ExportBackupRequest,
  ExportBackupResponse,
} from '../../messages/contracts.js';
import type { StorageUsageSummary } from '../../storage/purge-engine.js';
import { sendToBackground } from '../../messages/bridge.js';

interface ApiSettingsProps {
  keysStatus: ApiKeysStatus;
  onSaveKey: (provider: AIProviderName, apiKey: string) => Promise<boolean>;
  onRerunOnboarding?: () => void;
}

const PROVIDERS: { id: AIProviderName; label: string; desc: string }[] = [
  { id: 'openai', label: 'OpenAI', desc: 'GPT-4o, GPT-4o-mini' },
  { id: 'anthropic', label: 'Anthropic', desc: 'Claude 3.5 Sonnet, Claude 3 Haiku' },
  { id: 'gemini', label: 'Google Gemini', desc: 'Gemini 1.5 Pro, Flash' },
  { id: 'openrouter', label: 'OpenRouter', desc: 'Multi-provider unified API router' },
];

/**
 * Settings UI for configuring external provider keys and monitoring token consumption.
 * Raw keys are forwarded directly to the background service worker and never cached in the UI.
 */
export const ApiSettings: React.FC<ApiSettingsProps> = ({
  keysStatus,
  onSaveKey,
  onRerunOnboarding,
}) => {
  const [selectedProvider, setSelectedProvider] = useState<AIProviderName>('openai');
  const [keyValue, setKeyValue] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const [metrics, setMetrics] = useState<Record<AIProviderName, TokenUsage> | null>(null);
  const [resettingMetrics, setResettingMetrics] = useState(false);

  // Storage usage and Right to Erasure states
  const [storageUsage, setStorageUsage] = useState<StorageUsageSummary | null>(null);
  const [showPurgeConfirm, setShowPurgeConfirm] = useState(false);
  const [isPurging, setIsPurging] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [pacingMode, setPacingMode] = useState<'natural' | 'fast' | 'instant'>('natural');

  const loadStorageUsage = useCallback(async () => {
    try {
      const res = await sendToBackground<
        GetStorageUsageRequest,
        GetStorageUsageResponse
      >({ type: 'GET_STORAGE_USAGE' });
      if (res && res.usage) {
        setStorageUsage(res.usage);
      }
    } catch {
      // Graceful fallback
    }
  }, []);

  const loadMetrics = useCallback(async () => {
    try {
      const res = await sendToBackground<
        { type: 'GET_TOKEN_METRICS' },
        GetTokenMetricsResponse
      >({ type: 'GET_TOKEN_METRICS' });

      if (res && res.metrics) {
        setMetrics(res.metrics);
      }
    } catch {
      // Metrics empty on first load
    }
  }, []);

  useEffect(() => {
    loadMetrics();
    loadStorageUsage();
  }, [loadMetrics, loadStorageUsage]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyValue.trim()) return;

    setIsSaving(true);
    setStatusMessage(null);

    try {
      const success = await onSaveKey(selectedProvider, keyValue.trim());
      if (success) {
        setStatusMessage(`Successfully stored API key for ${selectedProvider}.`);
        setKeyValue('');
      } else {
        setStatusMessage(`Failed to update key for ${selectedProvider}.`);
      }
    } catch (err) {
      setStatusMessage(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetMetrics = async () => {
    setResettingMetrics(true);
    try {
      await sendToBackground<
        { type: 'RESET_TOKEN_METRICS' },
        ResetTokenMetricsResponse
      >({ type: 'RESET_TOKEN_METRICS' });
      await loadMetrics();
    } catch {
      // Ignore
    } finally {
      setResettingMetrics(false);
    }
  };

  const handleExportBackup = async () => {
    setIsExporting(true);
    try {
      const res = await sendToBackground<ExportBackupRequest, ExportBackupResponse>({
        type: 'EXPORT_BACKUP',
      });
      if (res && res.jsonString) {
        const blob = new Blob([res.jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `applykit-backup-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setStatusMessage('Successfully exported complete local data archive.');
      }
    } catch (err) {
      setStatusMessage('Export error: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsExporting(false);
    }
  };

  const handlePurgeAllData = async () => {
    setIsPurging(true);
    try {
      const res = await sendToBackground<PurgeAllDataRequest, PurgeAllDataResponse>({
        type: 'PURGE_ALL_DATA',
      });
      if (res && res.success) {
        setShowPurgeConfirm(false);
        setStatusMessage('All local candidate data and credentials have been permanently erased.');
        await loadStorageUsage();
        await loadMetrics();
      }
    } catch (err) {
      setStatusMessage('Purge error: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsPurging(false);
    }
  };

  const totalTokensAllProviders = metrics
    ? Object.values(metrics).reduce((acc, curr) => acc + (curr?.totalTokens || 0), 0)
    : 0;

  return (
    <div className="api-settings-container">
      <div className="security-banner">
        <h3 className="security-banner-title">Credential Isolation Guarantee (ADR-0002)</h3>
        <p className="security-banner-text">
          API keys are strictly isolated inside the Extension Service Worker background context.
          Webpages and content scripts have zero access to your credentials.
        </p>
      </div>

      <div className="provider-status-list">
        <h4 className="section-title">Configured Providers</h4>
        {PROVIDERS.map((provider) => {
          const isConfigured = keysStatus[provider.id];
          const providerUsage = metrics?.[provider.id];

          return (
            <div key={provider.id} className="provider-status-row">
              <div>
                <p className="provider-name">{provider.label}</p>
                <p className="provider-desc">{provider.desc}</p>
                {providerUsage && providerUsage.totalTokens > 0 && (
                  <p style={{ fontSize: '11px', color: '#64748b', margin: '2px 0 0 0' }}>
                    {providerUsage.totalTokens.toLocaleString()} tokens used ({providerUsage.promptTokens.toLocaleString()} in / {providerUsage.completionTokens.toLocaleString()} out)
                  </p>
                )}
              </div>
              <span
                className={`badge ${isConfigured ? 'badge-success' : 'badge-neutral'}`}
              >
                {isConfigured ? 'Configured' : 'Missing Key'}
              </span>
            </div>
          );
        })}
      </div>

      {/* Token Consumption Tracker */}
      <div
        className="token-metrics-card"
        style={{
          background: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: '8px',
          padding: '12px',
          margin: '16px 0',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h4 style={{ fontSize: '13px', fontWeight: 600, margin: 0 }}>Cumulative Token Consumption</h4>
            <div style={{ fontSize: '18px', fontWeight: 700, color: '#1e293b', marginTop: '4px' }}>
              {totalTokensAllProviders.toLocaleString()} Tokens
            </div>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={handleResetMetrics}
            disabled={resettingMetrics || totalTokensAllProviders === 0}
            style={{ fontSize: '11px', padding: '3px 8px' }}
          >
            {resettingMetrics ? 'Resetting...' : 'Reset Counters'}
          </button>
        </div>
      </div>

      <form onSubmit={handleSave} className="api-key-form">
        <h4 className="section-title">Add or Update Provider Key</h4>

        <div className="form-group">
          <label htmlFor="provider-select" className="form-label">
            Select Provider
          </label>
          <select
            id="provider-select"
            className="form-select"
            value={selectedProvider}
            onChange={(e) => setSelectedProvider(e.target.value as AIProviderName)}
          >
            {PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label htmlFor="api-key-input" className="form-label">
            API Secret Key
          </label>
          <input
            id="api-key-input"
            type="password"
            className="form-input"
            placeholder="Paste your API key here"
            value={keyValue}
            onChange={(e) => setKeyValue(e.target.value)}
            autoComplete="off"
            required
          />
        </div>

        <button
          type="submit"
          className="btn-primary"
          disabled={isSaving || !keyValue.trim()}
        >
          {isSaving ? 'Saving...' : 'Save Key to Secure Storage'}
        </button>

        {statusMessage && <p className="form-status-msg">{statusMessage}</p>}
      </form>

      {/* Human Pacing & Anti-Detection Settings */}
      <div className="pacing-settings-card">
        <h4 className="section-title">Human Pacing & Anti-Detection (ADR-0014, ADR-0021)</h4>
        <p className="pacing-description">
          Mimics human typing cadence and adds spatial coordinate jitter to avoid bot-detection heuristics without prototype tampering.
        </p>
        <div className="pacing-mode-selector">
          <label className={`pacing-option ${pacingMode === 'natural' ? 'pacing-active' : ''}`}>
            <input
              type="radio"
              name="pacing_mode"
              value="natural"
              checked={pacingMode === 'natural'}
              onChange={() => setPacingMode('natural')}
            />
            <div>
              <span className="pacing-title">Natural Human Cadence (Recommended)</span>
              <span className="pacing-subtitle">Progressive character typing (20-65ms delay) with spatial click jitter</span>
            </div>
          </label>
          <label className={`pacing-option ${pacingMode === 'fast' ? 'pacing-active' : ''}`}>
            <input
              type="radio"
              name="pacing_mode"
              value="fast"
              checked={pacingMode === 'fast'}
              onChange={() => setPacingMode('fast')}
            />
            <div>
              <span className="pacing-title">Fast Mode</span>
              <span className="pacing-subtitle">Accelerated entry (15ms delay) for rapid form population</span>
            </div>
          </label>
        </div>
      </div>

      {/* Local Storage Audit & Data Sovereignty */}
      {storageUsage && (
        <div className="storage-audit-card">
          <h4 className="section-title">Local-First Storage Audit (ADR-0001)</h4>
          <p className="storage-audit-desc">
            All candidate records, claims, and applications reside 100% locally in your browser:
          </p>
          <div className="storage-metrics-grid">
            <div className="storage-metric-pill">
              <span className="metric-num">{storageUsage.hasProfile ? 'Configured' : 'None'}</span>
              <span className="metric-name">Profile</span>
            </div>
            <div className="storage-metric-pill">
              <span className="metric-num">{storageUsage.evidenceCount}</span>
              <span className="metric-name">Evidence Items</span>
            </div>
            <div className="storage-metric-pill">
              <span className="metric-num">{storageUsage.applicationsCount}</span>
              <span className="metric-name">Applications</span>
            </div>
            <div className="storage-metric-pill">
              <span className="metric-num">{storageUsage.jobsCount}</span>
              <span className="metric-name">Saved Jobs</span>
            </div>
          </div>
        </div>
      )}

      {/* Privacy & Right to Erasure Section */}
      <div className="privacy-erasure-card">
        <h4 className="section-title">Privacy & Right to Erasure (GDPR / CCPA)</h4>
        <p className="privacy-erasure-desc">
          Download your complete data archive or permanently purge all stored data from your local browser.
        </p>
        <div className="privacy-actions-row">
          <button
            type="button"
            className="btn-secondary"
            disabled={isExporting}
            onClick={handleExportBackup}
          >
            {isExporting ? 'Exporting Archive...' : 'Export Complete Archive (JSON)'}
          </button>
          {!showPurgeConfirm ? (
            <button
              type="button"
              className="btn-danger-outline"
              onClick={() => setShowPurgeConfirm(true)}
            >
              Purge All Data (Right to Erasure)
            </button>
          ) : (
            <div className="purge-confirm-box">
              <span className="purge-warning-text">⚠️ Permanently erase all local profiles, evidence, and keys?</span>
              <div className="purge-buttons-group">
                <button
                  type="button"
                  className="btn-danger"
                  disabled={isPurging}
                  onClick={handlePurgeAllData}
                >
                  {isPurging ? 'Erasing Everything...' : 'Confirm Permanent Erasure'}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={isPurging}
                  onClick={() => setShowPurgeConfirm(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Setup & Onboarding Wizard */}
      {onRerunOnboarding && (
        <div className="onboarding-settings-card">
          <h4 className="section-title">Setup & Onboarding Wizard</h4>
          <p className="onboarding-settings-desc">
            Re-run the initial 4-step candidate profile, evidence import, and provider setup wizard.
          </p>
          <button
            type="button"
            className="btn-secondary"
            onClick={onRerunOnboarding}
          >
            Launch Onboarding Wizard 🚀
          </button>
        </div>
      )}
    </div>
  );
};
