import { describe, it, expect } from 'vitest';
import { extractSalaryFromDescription } from '../job/salary-extractor.js';

describe('Deterministic Salary & Compensation Benchmark Extractor', () => {
  it('extracts standard USD annual range with benefits and equity', () => {
    const text = `
      About the Role:
      Senior Distributed Systems Engineer
      Compensation: $140,000 - $180,000 per year.
      We offer competitive equity, 401(k) match, and health insurance.
    `;

    const result = extractSalaryFromDescription(text);
    expect(result).not.toBeNull();
    expect(result?.currency).toBe('USD');
    expect(result?.minAmount).toBe(140000);
    expect(result?.maxAmount).toBe(180000);
    expect(result?.period).toBe('year');
    expect(result?.equityMentioned).toBe(true);
    expect(result?.benefits).toContain('401(k) Matching');
    expect(result?.benefits).toContain('Health, Dental & Vision');
    expect(result?.formattedDisplay).toBe('$140,000 – $180,000 / yr');
  });

  it('extracts UK GBP salary range with "k" notation', () => {
    const text = `
      Canonical is hiring a Systems Engineer.
      Salary: £85k - £110k per annum + unlimited PTO.
    `;

    const result = extractSalaryFromDescription(text);
    expect(result).not.toBeNull();
    expect(result?.currency).toBe('GBP');
    expect(result?.minAmount).toBe(85000);
    expect(result?.maxAmount).toBe(110000);
    expect(result?.period).toBe('year');
    expect(result?.benefits).toContain('Unlimited PTO');
    expect(result?.formattedDisplay).toBe('£85,000 – £110,000 / yr');
  });

  it('extracts hourly rate contracts', () => {
    const text = `
      Contract DevOps Engineer.
      Rate: $75 - $95 / hour. Remote.
    `;

    const result = extractSalaryFromDescription(text);
    expect(result).not.toBeNull();
    expect(result?.currency).toBe('USD');
    expect(result?.minAmount).toBe(75);
    expect(result?.maxAmount).toBe(95);
    expect(result?.period).toBe('hour');
    expect(result?.formattedDisplay).toBe('$75 – $95 / hr');
  });

  it('detects equity-only mentions when no explicit numbers are given', () => {
    const text = `
      Early-stage founding engineer position.
      Generous stock options and performance bonus included.
    `;

    const result = extractSalaryFromDescription(text);
    expect(result).not.toBeNull();
    expect(result?.equityMentioned).toBe(true);
    expect(result?.formattedDisplay).toBe('Competitive Base + Equity');
    expect(result?.benefits).toContain('Annual Performance Bonus');
  });

  it('returns null gracefully on descriptions without compensation data', () => {
    const text = `
      We are looking for an engineer with strong Go skills and passion for Linux.
    `;

    const result = extractSalaryFromDescription(text);
    expect(result).toBeNull();
  });
});
