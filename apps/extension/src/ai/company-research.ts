/**
 * @fileoverview Finds out what a hiring company does, so answers to "why us" questions can
 * name something specific instead of a line that fits any company.
 *
 * Two sources, both read in the service worker:
 * 1. The company's own website (home and about pages), when its address can be found from
 *    the posting. Only the title, description and headings are kept.
 * 2. A Google Search through Gemini, when a Gemini key is saved. Gemini is asked for short
 *    facts it found in sources, and the sources are kept so the candidate can check them.
 *
 * Only the company name, role title and the company's own web address leave the
 * browser. Nothing about the candidate does. Everything found is untrusted web text: it is
 * cut into short lines, stripped of markup, and later fenced as data in the prompt.
 * Results are cached per company for two weeks.
 */

import type { JobPosting } from '@applykit/domain';

export interface CompanySource {
  readonly title: string;
  readonly url: string;
}

export interface CompanyBrief {
  readonly company: string;
  /** Short factual lines, at most {@link MAX_FACTS}. */
  readonly facts: readonly string[];
  readonly sources: readonly CompanySource[];
  readonly fetchedAt: string;
  /** Which sources produced facts. */
  readonly via: ReadonlyArray<'website' | 'web_search'>;
}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export interface CompanyResearchDeps {
  readonly fetchFn?: FetchFn;
  /** The saved Gemini key, or null when none is saved. */
  readonly geminiKey?: string | null;
  readonly storage?: Pick<chrome.storage.StorageArea, 'get' | 'set'>;
  readonly now?: () => Date;
}

const CACHE_KEY = 'applykit_company_research';
const CACHE_DAYS = 14;
const MAX_FACTS = 10;
const MAX_FACT_LENGTH = 240;

/** Hosts that belong to an ATS or job board, never the company's own site. */
const JOB_BOARD_HOST =
  /(greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|workable\.com|smartrecruiters\.com|recruitee\.com|bamboohr\.com|jobvite\.com|icims\.com|teamtailor\.com|breezy\.hr|linkedin\.com|indeed\.com|glassdoor\.|wellfound\.com|angel\.co|google\.com|youtube\.com|twitter\.com|x\.com|facebook\.com|instagram\.com|github\.com|medium\.com)$/i;

/** Letters and digits only, for comparing names written different ways. */
function compact(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Turns HTML entities and tags into plain text. */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;|&rsquo;|&lsquo;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/&[a-z]+;|&#\d+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A short, clean, single-line fact, or undefined when the text is not usable. */
export function cleanFact(raw: string): string | undefined {
  const text = raw
    .replace(/^[\s\-*•\d.)]+/, '')
    .replace(/\*\*/g, '')
    .replace(/\[\d+(?:,\s*\d+)*\]/g, '')
    .replace(/[—–]/g, ',')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length < 15) return undefined;
  // Web text that talks to the reader or the model is not a fact about the company.
  if (/\b(ignore (all|previous)|you are an? |as an ai|instruction|prompt|click here|cookie|sign up|subscribe|log ?in)\b/i.test(text)) return undefined;
  return text.length > MAX_FACT_LENGTH ? `${text.slice(0, MAX_FACT_LENGTH - 1).replace(/\s+\S*$/, '')}.` : text;
}

/**
 * Candidate addresses for the company's own site: the posting's address when it is not
 * a job board, then links in the posting whose host carries the company name.
 */
export function companySiteCandidates(job: Pick<JobPosting, 'url' | 'companyName' | 'rawDescription'>): string[] {
  const name = compact(job.companyName);
  const out: string[] = [];
  const add = (url: string) => {
    try {
      const parsed = new URL(url);
      if (!/^https?:$/.test(parsed.protocol) || JOB_BOARD_HOST.test(parsed.hostname)) return;
      const origin = `${parsed.protocol}//${parsed.hostname}`;
      if (!out.includes(origin)) out.push(origin);
    } catch {
      // Not a URL.
    }
  };
  if (job.url) add(job.url);
  for (const match of (job.rawDescription ?? '').matchAll(/https?:\/\/[^\s"'<>)]+/g)) {
    try {
      const host = new URL(match[0]).hostname.replace(/^www\./, '');
      if (name.length >= 3 && compact(host.split('.')[0] ?? '').includes(name.slice(0, Math.min(name.length, 8)))) add(match[0]);
    } catch {
      // Ignore.
    }
  }
  return out.slice(0, 2);
}

async function fetchWithTimeout(fetchFn: FetchFn, url: string, init: RequestInit, ms: number): Promise<Response | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetchFn(url, { ...init, signal: controller.signal });
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/** Facts from the company's own pages: title, meta description, and main headings. */
async function factsFromWebsite(
  job: Pick<JobPosting, 'url' | 'companyName' | 'rawDescription'>,
  fetchFn: FetchFn
): Promise<{ facts: string[]; sources: CompanySource[] }> {
  const facts: string[] = [];
  const sources: CompanySource[] = [];
  const name = compact(job.companyName);
  for (const origin of companySiteCandidates(job)) {
    for (const path of ['/', '/about']) {
      const res = await fetchWithTimeout(fetchFn, `${origin}${path}`, { credentials: 'omit', redirect: 'follow' }, 6000);
      if (!res || !res.ok || !(res.headers.get('content-type') ?? '').includes('html')) continue;
      const html = (await res.text()).slice(0, 400_000);
      const title = htmlToText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '');
      // A site whose title does not name the company is probably not its site.
      if (path === '/' && name.length >= 3 && !compact(title + html.slice(0, 20_000)).includes(name)) break;
      const meta =
        html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
        html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
        '';
      const headings = [...html.matchAll(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/gi)].map((m) => htmlToText(m[1] ?? '')).slice(0, 6);
      const found = [htmlToText(meta), ...headings].map((line) => cleanFact(line)).filter((line): line is string => Boolean(line));
      if (found.length > 0) {
        facts.push(...found);
        sources.push({ title: title || origin, url: `${origin}${path}` });
      }
    }
    if (facts.length > 0) break;
  }
  return { facts, sources };
}

interface GeminiSearchResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    groundingMetadata?: { groundingChunks?: Array<{ web?: { uri?: string; title?: string } }> };
  }>;
}

/** Facts from a Google Search, run by Gemini with search grounding. */
async function factsFromWebSearch(
  job: Pick<JobPosting, 'title' | 'companyName' | 'url'>,
  geminiKey: string,
  fetchFn: FetchFn
): Promise<{ facts: string[]; sources: CompanySource[] }> {
  const prompt = `Search the web for the company "${job.companyName}", which is hiring a "${job.title}"${job.url ? ` (job page: ${job.url})` : ''}.
Write 6 to 10 short facts about this company that you found in sources: what it builds or sells, who its customers are, any scale or numbers it states publicly, its mission or values in its own words, technology it uses, and news from the last 12 months.
One fact per line, each line starting with "- ". Plain sentences, no opinions, no praise, no advice. If you cannot find a fact, leave it out.`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 900 },
  };
  for (const model of ['gemini-flash-latest', 'gemini-flash-lite-latest']) {
    const res = await fetchWithTimeout(
      fetchFn,
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey }, body: JSON.stringify(body) },
      25_000
    );
    if (!res || !res.ok) continue;
    const data = (await res.json().catch(() => ({}))) as GeminiSearchResponse;
    const candidate = data.candidates?.[0];
    const text = candidate?.content?.parts?.map((part) => part.text ?? '').join('\n') ?? '';
    const facts = text
      .split('\n')
      .filter((line) => /^\s*[-*•]/.test(line))
      .map((line) => cleanFact(line))
      .filter((line): line is string => Boolean(line));
    const sources = (candidate?.groundingMetadata?.groundingChunks ?? [])
      .map((chunk) => ({ title: (chunk.web?.title ?? '').slice(0, 120), url: chunk.web?.uri ?? '' }))
      .filter((source) => /^https:\/\//.test(source.url))
      .slice(0, 6);
    if (facts.length > 0) return { facts, sources };
  }
  return { facts: [], sources: [] };
}

/**
 * Looks up the hiring company, using the cache when it is fresh. Never throws: a failed
 * lookup returns an empty brief and the answer falls back to the posting alone.
 */
export async function researchCompany(
  job: Pick<JobPosting, 'title' | 'companyName' | 'url' | 'rawDescription'>,
  deps: CompanyResearchDeps = {}
): Promise<CompanyBrief> {
  const fetchFn = deps.fetchFn ?? ((url, init) => globalThis.fetch(url, init));
  const storage = deps.storage ?? (typeof chrome !== 'undefined' ? chrome.storage?.local : undefined);
  const now = deps.now?.() ?? new Date();
  const key = compact(job.companyName);
  const empty: CompanyBrief = { company: job.companyName, facts: [], sources: [], fetchedAt: now.toISOString(), via: [] };
  if (!key) return empty;

  try {
    const cached = ((await storage?.get(CACHE_KEY))?.[CACHE_KEY] ?? {}) as Record<string, CompanyBrief>;
    const hit = cached[key];
    if (hit && hit.facts.length > 0 && now.getTime() - new Date(hit.fetchedAt).getTime() < CACHE_DAYS * 86_400_000) return hit;
  } catch {
    // No cache; look it up.
  }

  const [site, search] = await Promise.all([
    factsFromWebsite(job, fetchFn).catch(() => ({ facts: [], sources: [] })),
    deps.geminiKey ? factsFromWebSearch(job, deps.geminiKey, fetchFn).catch(() => ({ facts: [], sources: [] })) : Promise.resolve({ facts: [], sources: [] }),
  ]);

  const seen = new Set<string>();
  const facts = [...search.facts, ...site.facts].filter((fact) => {
    const k = fact.toLowerCase().slice(0, 60);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const brief: CompanyBrief = {
    company: job.companyName,
    facts: facts.slice(0, MAX_FACTS),
    sources: [...search.sources, ...site.sources].slice(0, 8),
    fetchedAt: now.toISOString(),
    via: [...(site.facts.length > 0 ? (['website'] as const) : []), ...(search.facts.length > 0 ? (['web_search'] as const) : [])],
  };

  if (brief.facts.length > 0) {
    try {
      const cached = ((await storage?.get(CACHE_KEY))?.[CACHE_KEY] ?? {}) as Record<string, CompanyBrief>;
      const entries = Object.entries({ ...cached, [key]: brief })
        .sort((a, b) => b[1].fetchedAt.localeCompare(a[1].fetchedAt))
        .slice(0, 40);
      await storage?.set({ [CACHE_KEY]: Object.fromEntries(entries) });
    } catch {
      // Caching is an optimization.
    }
  }
  return brief;
}
