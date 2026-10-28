import { describe, it, expect } from 'vitest';
import { findRepeatedPhrase } from '../tailoring/resume-rules.js';

describe('findRepeatedPhrase', () => {
  it('flags the copy-paste slip from a real resume', () => {
    expect(
      findRepeatedPhrase('Built a fashion e-commerce website in React, including the customer-facing storefront and an admin dashboard for managing an admin dashboardproducts, orders, and inventory.')
    ).toBe('an admin dashboard');
  });
  it('leaves ordinary bullets alone', () => {
    expect(findRepeatedPhrase('Designed transaction-safe wallet, billing, settlement, and payout workflows with automated reconciliation.')).toBeUndefined();
    expect(findRepeatedPhrase('Built billing workers and billing reports for the billing team.')).toBeUndefined();
  });
});

describe('"dynamic" as a buzzword', () => {
  it('flags it about a person, not in a technical phrase', async () => {
    const { FLUFF_DYNAMIC } = await import('../tailoring/resume-rules.js');
    expect(FLUFF_DYNAMIC.test('a dynamic engineer who ships')).toBe(true);
    expect(FLUFF_DYNAMIC.test('dynamic and results-driven')).toBe(true);
    expect(FLUFF_DYNAMIC.test('implemented dynamic codec negotiation')).toBe(false);
    expect(FLUFF_DYNAMIC.test('dynamic pricing for rides')).toBe(false);
  });
});

describe('resume header place', () => {
  it('drops a repeated city and capitalizes lowercase parts', async () => {
    const { formatPlace } = await import('../tailoring/display-format.js');
    expect(formatPlace(['lagos', 'lagos', 'Nigeria'])).toBe('Lagos, Nigeria');
    expect(formatPlace(['San Francisco', 'CA', 'United States'])).toBe('San Francisco, CA, United States');
    expect(formatPlace(['port harcourt', 'rivers', ''])).toBe('Port Harcourt, Rivers');
  });
});
