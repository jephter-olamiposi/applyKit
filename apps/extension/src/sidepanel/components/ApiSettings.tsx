/**
 * @fileoverview Settings: the optional AI key and the candidate's local data.
 *
 * Keys go straight to the service worker and are never kept in the panel (ADR-0002).
 */

import React, { useState, useEffect, useCallback } from 'react';
import type { AIProviderName, TokenUsage } from '@applykit/domain';
import type {
  ApiKeysStatus,
  SetApiKeyResponse,
  CheckApiKeyRequest,
  CheckApiKeyResponse,
  GetKeyChecksRequest,
  GetKeyChecksResponse,
  GetDraftLogRequest,
  GetDraftLogResponse,
  KeyChecks,
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
  onSaveKey: (provider: AIProviderName, apiKey: string) => Promise<SetApiKeyResponse>;
  onRerunOnboarding?: () => void;
  onPurged?: () => void;
}

const PROVIDERS: { id: AIProviderName; label: string }[] = [
  { id: 'gemini', label: 'Google Gemini' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'anthropic', label: 'Anthropic Claude' },
  { id: 'openrouter', label: 'OpenRouter' },
];

/** Where each provider issues API keys. */
const PROVIDER_KEY_PAGES: Record<AIProviderName, string> = {
  gemini: 'https://aistudio.google.com/app/apikey',
  openai: 'https://platform.openai.com/api-keys',
  anthropic: 'https://console.anthropic.com/settings/keys',
  openrouter: 'https://openrouter.ai/keys',
};

/** What the last check said about a saved key. */
const KeyStatusChip: React.FC<{ check?: KeyChecks[AIProviderName] }> = ({ check }) => {
  if (!check) return <span className="ui-chip">Saved, not checked</span>;
  const when = new Date(check.checkedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const [label, tone] =
    check.status === 'valid'
      ? ['Works', 'ui-chip-good']
      : check.status === 'quota'
        ? ['Out of quota', 'ui-chip-warn']
        : check.status === 'invalid'
          ? ['Rejected', 'ui-chip-bad']
          : ['Not checked', ''];
  return (
    <span className={`ui-chip ${tone}`} title={`${check.message} Checked ${when}.`}>
      {label}
    </span>
  );
};

/**
 * Settings UI for configuring external provider keys and monitoring token consumption.
 * Raw keys are forwarded directly to the background service worker and never cached in the UI.
 */
export const ApiSettings: React.FC<ApiSettingsProps> = ({
  keysStatus,
  onSaveKey,
  onRerunOnboarding,
  onPurged,
}) => {
  const [selectedProvider, setSelectedProvider] = useState<AIProviderName>('gemini');
  const [keyValue, setKeyValue] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [keyMessage, setKeyMessage] = useState<{ text: string; tone: 'good' | 'warn' | 'bad' } | null>(null);
  const [keyChecks, setKeyChecks] = useState<KeyChecks>({});
  const [checkingProvider, setCheckingProvider] = useState<AIProviderName | null>(null);

  const [metrics, setMetrics] = useState<Record<AIProviderName, TokenUsage> | null>(null);
  const [resettingMetrics, setResettingMetrics] = useState(false);

  // Storage usage and Right to Erasure states
  const [storageUsage, setStorageUsage] = useState<StorageUsageSummary | null>(null);
  const [showPurgeConfirm, setShowPurgeConfirm] = useState(false);
  const [isPurging, setIsPurging] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

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

  const loadKeyChecks = useCallback(async () => {
    try {
      const res = await sendToBackground<GetKeyChecksRequest, GetKeyChecksResponse>({ type: 'GET_KEY_CHECKS' });
      if (res?.checks) setKeyChecks(res.checks);
    } catch {
      // No checks yet.
    }
  }, []);

  useEffect(() => {
    loadMetrics();
    loadStorageUsage();
    loadKeyChecks();
  }, [loadMetrics, loadStorageUsage, loadKeyChecks]);

  /** Asks the provider again whether the saved key still works. */
  const handleCheckKey = async (provider: AIProviderName) => {
    setCheckingProvider(provider);
    setKeyMessage(null);
    try {
      const res = await sendToBackground<CheckApiKeyRequest, CheckApiKeyResponse>({ type: 'CHECK_API_KEY', provider });
      setKeyMessage({ text: res.check.message, tone: res.check.status === 'valid' ? 'good' : res.check.status === 'invalid' ? 'bad' : 'warn' });
      await loadKeyChecks();
    } catch (err) {
      setKeyMessage({ text: `Could not check the key: ${err instanceof Error ? err.message : String(err)}`, tone: 'warn' });
    } finally {
      setCheckingProvider(null);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyValue.trim()) return;

    setIsSaving(true);
    setKeyMessage(null);

    try {
      // The service worker checks the key with the provider before saving it.
      const res = await onSaveKey(selectedProvider, keyValue.trim());
      if (!res.success) {
        setKeyMessage({ text: res.error || 'Could not save the key. Check it and try again.', tone: 'bad' });
      } else {
        setKeyValue('');
        const check = res.check;
        if (!check || check.status === 'valid') {
          setKeyMessage({ text: `Key saved. ${check?.message ?? ''}`.trim(), tone: 'good' });
        } else if (check.status === 'quota') {
          setKeyMessage({ text: `Key saved. ${check.message}`, tone: 'warn' });
        } else {
          setKeyMessage({ text: `Key saved, but it could not be checked: ${check.message}`, tone: 'warn' });
        }
      }
      await loadKeyChecks();
    } catch (err) {
      setKeyMessage({ text: `Could not save the key: ${err instanceof Error ? err.message : String(err)}`, tone: 'bad' });
    } finally {
      setIsSaving(false);
    }
  };

  /** Copies recent AI drafts and what the checker said, to share when answers fail. */
  const handleCopyDraftLog = async () => {
    try {
      const res = await sendToBackground<GetDraftLogRequest, GetDraftLogResponse>({ type: 'GET_DRAFT_LOG' });
      await navigator.clipboard.writeText(JSON.stringify(res.log, null, 2));
      setKeyMessage({
        text: res.log.length > 0 ? `Copied the last ${res.log.length} AI drafts. They include lines from your resume.` : 'No AI drafts yet.',
        tone: 'good',
      });
    } catch (err) {
      setKeyMessage({ text: `Could not copy the log: ${err instanceof Error ? err.message : String(err)}`, tone: 'warn' });
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
        setStatusMessage('Backup downloaded.');
      }
    } catch (err) {
      setStatusMessage('Could not create the backup: ' + (err instanceof Error ? err.message : String(err)));
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
        setStatusMessage('All your data has been deleted from this browser.');
        await loadStorageUsage();
        await loadMetrics();
        onPurged?.();
      }
    } catch (err) {
      setStatusMessage('Could not delete everything: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsPurging(false);
    }
  };

  const totalTokensAllProviders = metrics
    ? Object.values(metrics).reduce((acc, curr) => acc + (curr?.totalTokens || 0), 0)
    : 0;

  return (
    <div className="ui-stack">
      {statusMessage && <div className="ui-note" role="status">{statusMessage}</div>}

      <section className="ui-card ui-stack" style={{ gap: 10 }} aria-label="AI provider">
        <div>
          <h3 className="ui-card-title">AI provider (optional)</h3>
          <p className="ui-text">
            ApplyKit works without one. Add a key if you want it to draft answers to open questions and smarter matching.
            Keys are stored encrypted in this browser and only used by the extension, never by web pages.
          </p>
        </div>

        <ul className="ui-list">
          {PROVIDERS.map((provider) => {
            const usage = metrics?.[provider.id];
            return (
              <li key={provider.id} className="ui-spread">
                <span>
                  <span style={{ color: 'var(--text)' }}>{provider.label}</span>
                  {usage && usage.totalTokens > 0 && <span className="ui-subtle"> · {usage.totalTokens.toLocaleString()} tokens used</span>}
                </span>
                {keysStatus[provider.id] ? (
                  <span className="ui-row" style={{ gap: 6 }}>
                    <KeyStatusChip check={keyChecks[provider.id]} />
                    <button
                      type="button"
                      className="ui-link"
                      onClick={() => handleCheckKey(provider.id)}
                      disabled={checkingProvider !== null}
                    >
                      {checkingProvider === provider.id ? 'Checking...' : 'Check'}
                    </button>
                  </span>
                ) : (
                  <span className="ui-chip">No key</span>
                )}
              </li>
            );
          })}
        </ul>

        <form className="ui-stack" style={{ gap: 8 }} onSubmit={handleSave}>
          <label>
            <span className="ui-label">Provider</span>
            <select
              className="ui-select"
              value={selectedProvider}
              onChange={(e) => {
                setSelectedProvider(e.target.value as AIProviderName);
                setKeyValue('');
              }}
            >
              {PROVIDERS.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="ui-label">API key</span>
            <input
              className="ui-input"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="Paste your key"
              value={keyValue}
              onChange={(e) => setKeyValue(e.target.value)}
            />
          </label>
          <div className="ui-spread">
            <a className="ui-link" href={PROVIDER_KEY_PAGES[selectedProvider]} target="_blank" rel="noopener noreferrer">
              Where do I get a {PROVIDERS.find((p) => p.id === selectedProvider)?.label} key?
            </a>
            <button type="submit" className="ui-btn ui-btn-primary" disabled={isSaving || !keyValue.trim()}>
              {isSaving ? 'Checking the key...' : 'Check and save'}
            </button>
          </div>
          {keyMessage && (
            <div className={`ui-note ${keyMessage.tone === 'bad' ? 'ui-note-bad' : keyMessage.tone === 'warn' ? 'ui-note-warn' : 'ui-note-good'}`} role="status">
              {keyMessage.text}
            </div>
          )}
        </form>
        <div className="ui-row" style={{ gap: 14 }}>
          {totalTokensAllProviders > 0 && (
            <button type="button" className="ui-link" onClick={handleResetMetrics} disabled={resettingMetrics}>
              Reset token counts
            </button>
          )}
          <button type="button" className="ui-link" onClick={handleCopyDraftLog}>
            Copy the AI troubleshooting log
          </button>
        </div>
      </section>

      <section className="ui-card ui-stack" style={{ gap: 8 }} aria-label="Your data">
        <h3 className="ui-card-title">Your data</h3>
        <p className="ui-text">
          Everything stays in this browser: your profile, {storageUsage ? `${storageUsage.evidenceCount} resume lines, ` : ''}
          saved jobs and applications. Nothing is sent to ApplyKit.
        </p>
        <div className="ui-row">
          <button type="button" className="ui-btn ui-btn-sm" onClick={handleExportBackup} disabled={isExporting}>
            {isExporting ? 'Exporting...' : 'Download a backup'}
          </button>
          {onRerunOnboarding && (
            <button type="button" className="ui-btn ui-btn-sm" onClick={onRerunOnboarding}>
              Run setup again
            </button>
          )}
        </div>
        {!showPurgeConfirm ? (
          <button type="button" className="ui-link" style={{ alignSelf: 'flex-start', color: 'var(--danger-text)' }} onClick={() => setShowPurgeConfirm(true)}>
            Delete all my data
          </button>
        ) : (
          <div className="ui-note ui-note-bad">
            This permanently deletes your profile, resume, saved answers, applications and API keys from this browser.
            <div className="ui-row" style={{ marginTop: 8 }}>
              <button type="button" className="ui-btn ui-btn-sm" onClick={() => setShowPurgeConfirm(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="ui-btn ui-btn-sm"
                style={{ background: 'var(--danger)', borderColor: 'var(--danger)', color: 'var(--on-accent)' }}
                onClick={handlePurgeAllData}
                disabled={isPurging}
              >
                {isPurging ? 'Deleting...' : 'Yes, delete everything'}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
