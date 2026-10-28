/**
 * @fileoverview Checks that an AI key works before ApplyKit relies on it.
 *
 * A wrong key used to be saved without complaint, and the candidate only found out when
 * a draft failed later with a vague error. Each provider has a free, read-only endpoint
 * (listing models, or describing the key) that answers 200 for a good key and 401/400/403
 * for a bad one, without spending tokens. The key goes in a header, never in the URL.
 */

import type { AIProviderName } from '@applykit/domain';

export type KeyCheckStatus =
  /** The provider accepted the key. */
  | 'valid'
  /** The provider rejected the key; it should not be saved. */
  | 'invalid'
  /** The key is real but the account is out of quota or credit right now. */
  | 'quota'
  /** The provider could not be reached or answered with a server error. */
  | 'unreachable';

export interface KeyCheckResult {
  readonly status: KeyCheckStatus;
  /** One plain sentence for the candidate. */
  readonly message: string;
}

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

const LABELS: Record<AIProviderName, string> = {
  gemini: 'Google Gemini',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  openrouter: 'OpenRouter',
};

/** The cheapest request that proves a key works, per provider. */
function probe(provider: AIProviderName, apiKey: string): { url: string; headers: Record<string, string> } {
  switch (provider) {
    case 'gemini':
      return { url: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', headers: { 'x-goog-api-key': apiKey } };
    case 'openai':
      return { url: 'https://api.openai.com/v1/models', headers: { Authorization: `Bearer ${apiKey}` } };
    case 'anthropic':
      return {
        url: 'https://api.anthropic.com/v1/models?limit=1',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          // Service worker requests carry an extension Origin; the key stays in the worker.
          'anthropic-dangerous-direct-browser-access': 'true',
        },
      };
    case 'openrouter':
      return { url: 'https://openrouter.ai/api/v1/key', headers: { Authorization: `Bearer ${apiKey}` } };
  }
}

/** The provider's own error text, when it sent one, trimmed for display. */
async function providerReason(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string; status?: string } | string; message?: string };
    const raw = typeof body.error === 'string' ? body.error : body.error?.message ?? body.message ?? '';
    return raw.replace(/\s+/g, ' ').trim().slice(0, 160);
  } catch {
    return '';
  }
}

/**
 * Asks the provider whether `apiKey` works.
 *
 * @param provider Which provider the key is for.
 * @param apiKey The key, already trimmed.
 * @param fetchFn Injected for tests; defaults to the global fetch.
 * @param timeoutMs How long to wait before calling the provider unreachable.
 */
export async function checkApiKey(
  provider: AIProviderName,
  apiKey: string,
  fetchFn: FetchFn = (url, init) => globalThis.fetch(url, init),
  timeoutMs = 10_000
): Promise<KeyCheckResult> {
  const label = LABELS[provider];
  if (!apiKey.trim()) return { status: 'invalid', message: 'Paste a key first.' };
  if (/\s/.test(apiKey.trim())) return { status: 'invalid', message: 'The key has a space in it. Copy it again without extra text.' };

  const { url, headers } = probe(provider, apiKey.trim());
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetchFn(url, { method: 'GET', headers, signal: controller.signal });
  } catch {
    return { status: 'unreachable', message: `Could not reach ${label} to check the key. Check your connection.` };
  } finally {
    clearTimeout(timer);
  }

  if (res.ok) return { status: 'valid', message: `${label} accepted the key.` };

  const reason = await providerReason(res);
  if (res.status === 429 || res.status === 402) {
    return { status: 'quota', message: `The key works, but ${label} says the account is out of quota or credit${reason ? ` (${reason})` : ''}.` };
  }
  if (res.status === 400 || res.status === 401 || res.status === 403) {
    // Gemini answers 400 API_KEY_INVALID for a wrong key and 403 when the key is real
    // but the Generative Language API is not enabled for it.
    const notEnabled = provider === 'gemini' && res.status === 403;
    return {
      status: 'invalid',
      message: notEnabled
        ? `${label} rejected the key: the Gemini API is not enabled for it. Make a key in Google AI Studio.`
        : `${label} rejected the key. Check you copied all of it, and that it is a ${label} key.`,
    };
  }
  return { status: 'unreachable', message: `${label} did not answer properly (error ${res.status}). Try again in a minute.` };
}
