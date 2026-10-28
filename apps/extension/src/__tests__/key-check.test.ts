/**
 * @fileoverview The key check run before a key is saved.
 */

import { describe, it, expect, vi } from 'vitest';
import { checkApiKey } from '../ai/key-check.js';

const reply = (status: number, body: object = {}) => vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));

describe('checkApiKey', () => {
  it('accepts a key the provider accepts, sending it in a header and not the URL', async () => {
    const fetchFn = reply(200, { models: [] });
    const result = await checkApiKey('gemini', 'AIza-good', fetchFn);
    expect(result.status).toBe('valid');
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).not.toContain('AIza-good');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('AIza-good');
  });

  it('rejects a key the provider rejects', async () => {
    expect((await checkApiKey('gemini', 'bad', reply(400, { error: { message: 'API key not valid.', status: 'INVALID_ARGUMENT' } }))).status).toBe('invalid');
    expect((await checkApiKey('openai', 'sk-bad', reply(401))).status).toBe('invalid');
    expect((await checkApiKey('anthropic', 'sk-ant-bad', reply(401))).status).toBe('invalid');
  });

  it('explains a Gemini key without the API enabled', async () => {
    const result = await checkApiKey('gemini', 'AIza-restricted', reply(403));
    expect(result.status).toBe('invalid');
    expect(result.message).toMatch(/not enabled/);
  });

  it('keeps a real key that is out of quota', async () => {
    const result = await checkApiKey('openai', 'sk-real', reply(429, { error: { message: 'You exceeded your current quota.' } }));
    expect(result.status).toBe('quota');
    expect(result.message).toMatch(/exceeded your current quota/);
  });

  it('says so when the provider cannot be reached', async () => {
    const result = await checkApiKey('openrouter', 'sk-or', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    expect(result.status).toBe('unreachable');
  });

  it('catches a pasted key with spaces in it before calling anyone', async () => {
    const fetchFn = reply(200);
    expect((await checkApiKey('gemini', 'AIza abc', fetchFn)).status).toBe('invalid');
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
