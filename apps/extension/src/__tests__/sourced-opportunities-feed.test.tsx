/**
 * @fileoverview Unit and interaction tests for SourcedOpportunitiesFeed component.
 *
 * @vitest-environment happy-dom
 */

import React, { act } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import type { SourcedOpportunity, CandidateProfile } from '@applykit/domain';
import { SourcedOpportunitiesFeed } from '../sidepanel/components/SourcedOpportunitiesFeed.js';
import * as bridge from '../messages/bridge.js';

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

vi.mock('../messages/bridge.js', () => ({
  sendToBackground: vi.fn(),
}));

const mockedSend = vi.mocked(bridge.sendToBackground);

describe('SourcedOpportunitiesFeed', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    vi.clearAllMocks();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  const mockOpportunities: SourcedOpportunity[] = [
    {
      id: 'ashby_monad_1',
      employer: 'Monad Labs',
      title: 'Senior Distributed Systems Engineer',
      url: 'https://jobs.ashbyhq.com/monad/role-1',
      locationText: 'Remote (Worldwide)',
      compensationText: '$180,000 - $240,000 USD',
      sourcePlatform: 'ashby',
      verdict: 'OPEN',
      matchScore: 90,
      tier: 'tier1_high_ev',
    },
    {
      id: 'greenhouse_stripe_2',
      employer: 'Stripe',
      title: 'Infrastructure Security Engineer',
      url: 'https://boards.greenhouse.io/stripe/jobs/2',
      locationText: 'Seattle, WA (US Only)',
      sourcePlatform: 'greenhouse',
      verdict: 'BLOCKED',
      fatalGate: 'geography',
      verbatimEvidence: 'Candidates must be physically located and authorized to work within the United States.',
      matchScore: 40,
      tier: 'tier4_low_or_blocked',
    },
  ];

  it('renders cached opportunities returned from background service worker', async () => {
    mockedSend.mockResolvedValueOnce({
      type: 'GET_SOURCED_OPPORTUNITIES_RESULT',
      success: true,
      opportunities: mockOpportunities,
    } as any);

    await act(async () => {
      root.render(<SourcedOpportunitiesFeed profile={null} />);
    });

    expect(mockedSend).toHaveBeenCalledWith({ type: 'GET_SOURCED_OPPORTUNITIES' });
    expect(container.textContent).toContain('Monad Labs');
    expect(container.textContent).toContain('Senior Distributed Systems Engineer');
    expect(container.textContent).toContain('Stripe');
    expect(container.textContent).toContain('5-Gate Pass (Eligible)');
    expect(container.textContent).toContain('Blocked: geography');
    expect(container.textContent).toContain('Candidates must be physically located');
  });

  it('triggers ATS watchlist scan when clicking Scan Curated Watchlist', async () => {
    mockedSend
      .mockResolvedValueOnce({
        type: 'GET_SOURCED_OPPORTUNITIES_RESULT',
        success: true,
        opportunities: [],
      } as any)
      .mockResolvedValueOnce({
        type: 'FETCH_ATS_JOBS_RESULT',
        success: true,
        opportunities: mockOpportunities,
        scannedCount: 15,
      } as any);

    await act(async () => {
      root.render(<SourcedOpportunitiesFeed profile={null} />);
    });

    const scanBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Scan watchlist')
    );
    expect(scanBtn).toBeDefined();

    await act(async () => {
      scanBtn!.click();
    });

    expect(mockedSend).toHaveBeenCalledWith({
      type: 'FETCH_ATS_JOBS',
      keyword: undefined,
    });
    expect(container.textContent).toContain('Discovered and screened 2 live opportunities.');
    expect(container.textContent).toContain('Monad Labs');
  });

  it('filters visible opportunities by EV priority tier', async () => {
    mockedSend.mockResolvedValueOnce({
      type: 'GET_SOURCED_OPPORTUNITIES_RESULT',
      success: true,
      opportunities: mockOpportunities,
    } as any);

    await act(async () => {
      root.render(<SourcedOpportunitiesFeed profile={null} />);
    });

    // Check both appear in All
    expect(container.textContent).toContain('Monad Labs');
    expect(container.textContent).toContain('Stripe');

    // Click Tier 1 button
    const tier1Btn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Tier 1: High EV')
    );
    expect(tier1Btn).toBeDefined();

    await act(async () => {
      tier1Btn!.click();
    });

    // Should only contain Monad Labs
    expect(container.textContent).toContain('Monad Labs');
    expect(container.textContent).not.toContain('Stripe');

    // Click Blocked button
    const blockedBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Blocked / Low')
    );
    expect(blockedBtn).toBeDefined();

    await act(async () => {
      blockedBtn!.click();
    });

    // Should only contain Stripe
    expect(container.textContent).not.toContain('Monad Labs');
    expect(container.textContent).toContain('Stripe');
  });

  it('harvests active browser tab links when clicking Harvest Active Tab', async () => {
    mockedSend
      .mockResolvedValueOnce({
        type: 'GET_SOURCED_OPPORTUNITIES_RESULT',
        success: true,
        opportunities: [],
      } as any)
      .mockResolvedValueOnce({
        type: 'HARVEST_PAGE_LINKS_RESULT',
        success: true,
        links: [
          { url: 'https://jobs.ashbyhq.com/openai/swe-1', title: 'Senior Software Engineer' },
        ],
      } as any);

    await act(async () => {
      root.render(<SourcedOpportunitiesFeed profile={null} />);
    });

    const harvestBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Harvest active tab')
    );
    expect(harvestBtn).toBeDefined();

    await act(async () => {
      harvestBtn!.click();
    });

    expect(mockedSend).toHaveBeenCalledWith({ type: 'HARVEST_PAGE_LINKS' });
    expect(container.textContent).toContain('Discovered on Active Tab (1)');
    expect(container.textContent).toContain('Senior Software Engineer');
  });

  it('calls onNavigateToTab when Open & Stage is clicked', async () => {
    mockedSend.mockResolvedValueOnce({
      type: 'GET_SOURCED_OPPORTUNITIES_RESULT',
      success: true,
      opportunities: mockOpportunities,
    } as any);

    const onNavigate = vi.fn();
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    await act(async () => {
      root.render(<SourcedOpportunitiesFeed profile={null} onNavigateToTab={onNavigate} />);
    });

    const stageBtns = Array.from(container.querySelectorAll('button')).filter((b) =>
      b.textContent?.includes('Open and stage')
    );
    expect(stageBtns.length).toBeGreaterThan(0);

    await act(async () => {
      stageBtns[0]!.click();
    });

    expect(openSpy).toHaveBeenCalledWith('https://jobs.ashbyhq.com/monad/role-1', '_blank', 'noopener,noreferrer');
    expect(onNavigate).toHaveBeenCalledWith('overview');

    openSpy.mockRestore();
  });
});
