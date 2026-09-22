/**
 * @fileoverview Integration tests for ATS site adapters and requirement normalization engine.
 *
 * Verifies extraction accuracy against real-world ATS fixtures (Greenhouse, Lever, Workday, Schema.org JSON-LD),
 * ensuring the deterministic requirement normalizer partitions required vs preferred qualifications
 * without hallucinations.
 *
 * @vitest-environment happy-dom
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  JsonLdJobSiteAdapter,
  GreenhouseJobSiteAdapter,
  LeverJobSiteAdapter,
  WorkdayJobSiteAdapter,
  GenericJobSiteAdapter,
  findMatchingAdapter,
  extractStructuredJob,
} from '../content/adapters/index.js';
import {
  classifyRequirementCategory,
  extractYearsRequired,
  extractCompetencyKey,
  normalizeRequirementsList,
  extractStructuredSections,
} from '../content/normalizer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadFixture(filename: string): Document {
  const filePath = resolve(__dirname, 'fixtures', filename);
  const html = readFileSync(filePath, 'utf-8');
  const parser = new DOMParser();
  return parser.parseFromString(html, 'text/html');
}

describe('ATS Job Site Adapters & Normalization Suite', () => {
  describe('GreenhouseJobSiteAdapter', () => {
    const adapter = new GreenhouseJobSiteAdapter();

    it('matches greenhouse.io URLs and Greenhouse DOM selectors', () => {
      const doc = loadFixture('greenhouse-sample.html');
      const ghUrl = new URL('https://boards.greenhouse.io/examplehealth/jobs/12345');
      const unrelatedUrl = new URL('https://randomblog.com/post');

      expect(adapter.matches(ghUrl, doc)).toBe(true);
      expect(adapter.matches(unrelatedUrl, doc)).toBe(true); // matches via DOM selectors (.app-title)
      expect(adapter.matches(unrelatedUrl, new DOMParser().parseFromString('<div>Empty</div>', 'text/html'))).toBe(false);
    });

    it('extracts complete structured job from Greenhouse fixture', () => {
      const doc = loadFixture('greenhouse-sample.html');
      const url = new URL('https://boards.greenhouse.io/examplehealth/jobs/12345');
      const job = adapter.extract(doc, url);

      expect(job.title).toBe('Senior Rust Systems Engineer');
      expect(job.companyName).toBe('Example Health');
      expect(job.location).toBe('San Francisco, CA / Remote');
      expect(job.workplaceType).toBe('remote');
      expect(job.employmentType).toBe('full_time');
      expect(job.metadata.adapter).toBe('greenhouse');

      // Verify requirement partitioning (5 required, 3 preferred)
      const required = job.requirements.filter((r) => r.isRequired);
      const preferred = job.requirements.filter((r) => !r.isRequired);
      expect(required.length).toBe(5);
      expect(preferred.length).toBe(3);

      // Verify experience level and year detection
      const expReq = required.find((r) => r.category === 'experience_level');
      expect(expReq).toBeDefined();
      expect(expReq?.yearsRequired).toBe(5);

      // Verify domain knowledge detection
      const hipaaReq = preferred.find((r) => r.rawText.includes('HIPAA'));
      expect(hipaaReq?.category).toBe('domain_knowledge');
      expect(hipaaReq?.importance).toBe('preferred');

      // Verify soft skills detection
      const commReq = required.find((r) => r.rawText.includes('communication'));
      expect(commReq?.category).toBe('soft_skill');
    });
  });

  describe('LeverJobSiteAdapter', () => {
    const adapter = new LeverJobSiteAdapter();

    it('matches lever.co URLs and Lever DOM selectors', () => {
      const doc = loadFixture('lever-sample.html');
      const leverUrl = new URL('https://jobs.lever.co/acme/82103810-1234');
      const unrelatedUrl = new URL('https://randomblog.com/post');

      expect(adapter.matches(leverUrl, doc)).toBe(true);
      expect(adapter.matches(unrelatedUrl, doc)).toBe(true); // matches via DOM selectors (.posting-headline)
      expect(adapter.matches(unrelatedUrl, new DOMParser().parseFromString('<div>Empty</div>', 'text/html'))).toBe(false);
    });

    it('extracts complete structured job from Lever fixture', () => {
      const doc = loadFixture('lever-sample.html');
      const url = new URL('https://jobs.lever.co/acme/82103810-1234');
      const job = adapter.extract(doc, url);

      expect(job.title).toBe('Staff Platform Engineer');
      expect(job.companyName).toBe('Acme');
      expect(job.location).toBe('New York, NY');
      expect(job.workplaceType).toBe('hybrid');
      expect(job.employmentType).toBe('full_time');
      expect(job.metadata.adapter).toBe('lever');

      // Verify requirement partitioning (4 required, 2 nice-to-have)
      const required = job.requirements.filter((r) => r.isRequired);
      const preferred = job.requirements.filter((r) => !r.isRequired);
      expect(required.length).toBe(4);
      expect(preferred.length).toBe(2);

      const eightYears = required.find((r) => r.yearsRequired === 8);
      expect(eightYears).toBeDefined();
      expect(eightYears?.category).toBe('experience_level');

      const ebpf = preferred.find((r) => r.rawText.includes('eBPF'));
      expect(ebpf?.importance).toBe('preferred');
    });
  });

  describe('WorkdayJobSiteAdapter', () => {
    const adapter = new WorkdayJobSiteAdapter();

    it('matches myworkdayjobs.com URLs and Workday data-automation-id DOM selectors', () => {
      const doc = loadFixture('workday-sample.html');
      const workdayUrl = new URL('https://globalfintech.myworkdayjobs.com/en-US/careers/job/JR-10492');
      const unrelatedUrl = new URL('https://randomblog.com/post');

      expect(adapter.matches(workdayUrl, doc)).toBe(true);
      expect(adapter.matches(unrelatedUrl, doc)).toBe(true);
      expect(adapter.matches(unrelatedUrl, new DOMParser().parseFromString('<div>Empty</div>', 'text/html'))).toBe(false);
    });

    it('extracts complete structured job from Workday fixture', () => {
      const doc = loadFixture('workday-sample.html');
      const url = new URL('https://globalfintech.myworkdayjobs.com/en-US/careers/job/JR-10492');
      const job = adapter.extract(doc, url);

      expect(job.title).toBe('Principal Backend Architect');
      expect(job.companyName).toBe('Globalfintech');
      expect(job.location).toBe('London, UK');
      expect(job.workplaceType).toBe('onsite');
      expect(job.employmentType).toBe('full_time');
      expect(job.metadata.adapter).toBe('workday');

      // Verify requirement partitioning (3 basic qualifications, 2 preferred)
      const required = job.requirements.filter((r) => r.isRequired);
      const preferred = job.requirements.filter((r) => !r.isRequired);
      expect(required.length).toBe(3);
      expect(preferred.length).toBe(2);

      const tenYears = required.find((r) => r.yearsRequired === 10);
      expect(tenYears).toBeDefined();

      const swiftReq = preferred.find((r) => r.rawText.includes('SWIFT'));
      expect(swiftReq?.category).toBe('domain_knowledge');
      expect(swiftReq?.importance).toBe('preferred');
    });
  });

  describe('JsonLdJobSiteAdapter', () => {
    const adapter = new JsonLdJobSiteAdapter();

    it('matches documents containing Schema.org JobPosting JSON-LD', () => {
      const doc = loadFixture('jsonld-sample.html');
      const url = new URL('https://stripe.com/jobs/listing/12345');
      const nonJsonLdDoc = new DOMParser().parseFromString('<html><body>No JSON-LD</body></html>', 'text/html');

      expect(adapter.matches(url, doc)).toBe(true);
      expect(adapter.matches(url, nonJsonLdDoc)).toBe(false);
    });

    it('extracts structured salary, location, and requirements from Schema.org data', () => {
      const doc = loadFixture('jsonld-sample.html');
      const url = new URL('https://stripe.com/jobs/listing/12345');
      const job = adapter.extract(doc, url);

      expect(job.title).toBe('Senior Frontend Engineer, Dashboard');
      expect(job.companyName).toBe('Stripe');
      expect(job.location).toBe('Seattle, WA, US');
      expect(job.employmentType).toBe('full_time');
      expect(job.salaryRange).toEqual({
        min: 185000,
        max: 245000,
        currency: 'USD',
        period: 'annual',
      });

      const required = job.requirements.filter((r) => r.isRequired);
      const preferred = job.requirements.filter((r) => !r.isRequired);
      expect(required.length).toBe(2);
      expect(preferred.length).toBe(1);

      const fiveYears = required.find((r) => r.yearsRequired === 5);
      expect(fiveYears).toBeDefined();

      const analyticsReq = preferred.find((r) => r.rawText.includes('analytics'));
      expect(analyticsReq?.importance).toBe('preferred');
    });
  });

  describe('GenericJobSiteAdapter & Adapter Selection Hierarchy', () => {
    it('always matches as universal fallback adapter', () => {
      const generic = new GenericJobSiteAdapter();
      const doc = new DOMParser().parseFromString('<html><head><title>Company - Engineer</title></head><body><h1>Staff Engineer</h1><p>Requirements:<ul><li>5+ years Python</li></ul></p></body></html>', 'text/html');
      const url = new URL('https://careers.example.com/jobs/1');

      expect(generic.matches(url, doc)).toBe(true);

      const job = generic.extract(doc, url);
      expect(job.title).toBe('Staff Engineer');
      expect(job.companyName).toBe('Example');
      expect(job.requirements.length).toBeGreaterThan(0);
    });

    it('prioritizes JSON-LD (priority 100) over vendor ATS (priority 90)', () => {
      // Create a document that has both JSON-LD and Greenhouse markup
      const html = `
        <html>
          <head>
            <script type="application/ld+json">
              { "@context": "https://schema.org", "@type": "JobPosting", "title": "JSON-LD Title", "hiringOrganization": { "@type": "Organization", "name": "Priority Company" } }
            </script>
          </head>
          <body>
            <h1 class="app-title">Greenhouse Title</h1>
          </body>
        </html>
      `;
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const url = new URL('https://boards.greenhouse.io/priority/job/1');

      const selected = findMatchingAdapter(url, doc);
      expect(selected.priority).toBe(100);
      expect(selected.id).toBe('jsonld');

      const job = extractStructuredJob(doc, url.href);
      expect(job.title).toBe('JSON-LD Title');
      expect(job.companyName).toBe('Priority Company');
    });

    it('falls back gracefully to GenericJobSiteAdapter when no ATS or JSON-LD is detected', () => {
      const html = '<html><head><title>Simple Job</title></head><body><h1>Developer</h1></body></html>';
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const url = new URL('https://randomcompany.com/job');

      const selected = findMatchingAdapter(url, doc);
      expect(selected.priority).toBe(10);
      expect(selected.id).toBe('generic');
    });

    it('rejects invalid or missing document URLs instead of fabricating one', () => {
      const doc = new DOMParser().parseFromString('<html><body><h1>Fallback Title</h1></body></html>', 'text/html');

      expect(() => extractStructuredJob(doc, 'not-a-valid-url')).toThrow(/not a valid URL/);

      const savedWindow = globalThis.window;
      (globalThis as unknown as { window: unknown }).window = undefined;
      try {
        expect(() => extractStructuredJob(doc)).toThrow(/without a document URL/);
      } finally {
        (globalThis as unknown as { window: unknown }).window = savedWindow;
      }
    });
  });

  describe('Requirement Normalizer Utilities', () => {
    describe('classifyRequirementCategory', () => {
      it('classifies experience level requirements', () => {
        expect(classifyRequirementCategory('5+ years of software experience')).toBe('experience_level');
        expect(classifyRequirementCategory('At least 3 years in distributed systems')).toBe('experience_level');
      });

      it('classifies education credentials', () => {
        expect(classifyRequirementCategory('Bachelor of Science in Computer Science or equivalent')).toBe('education_credential');
        expect(classifyRequirementCategory('Master degree preferred')).toBe('education_credential');
      });

      it('classifies legal work authorization', () => {
        expect(classifyRequirementCategory('Must be authorized to work in the US without sponsorship')).toBe('legal_authorization');
        expect(classifyRequirementCategory('Active Top Secret security clearance required')).toBe('legal_authorization');
      });

      it('classifies industry certifications', () => {
        expect(classifyRequirementCategory('AWS Certified Solutions Architect')).toBe('certification');
        expect(classifyRequirementCategory('CISSP or CKA certification preferred')).toBe('certification');
      });

      it('classifies soft skills and communication', () => {
        expect(classifyRequirementCategory('Excellent written and verbal communication skills')).toBe('soft_skill');
        expect(classifyRequirementCategory('Proven track record mentoring junior engineers')).toBe('soft_skill');
      });

      it('classifies domain knowledge', () => {
        expect(classifyRequirementCategory('Familiarity with HIPAA and clinical compliance regulations')).toBe('domain_knowledge');
        expect(classifyRequirementCategory('Experience with high-frequency FinTech payment settlement engines')).toBe('domain_knowledge');
      });

      it('defaults to technical skill for technical competencies', () => {
        expect(classifyRequirementCategory('Deep expertise in Rust and memory safety paradigms')).toBe('technical_skill');
      });
    });

    describe('extractYearsRequired', () => {
      it('extracts integer numbers preceding years patterns', () => {
        expect(extractYearsRequired('Minimum 7+ years of experience')).toBe(7);
        expect(extractYearsRequired('At least 3 years in backend engineering')).toBe(3);
        expect(extractYearsRequired('Proficient in TypeScript and Node.js')).toBeUndefined();
      });
    });

    describe('extractCompetencyKey', () => {
      it('strips verbose boilerplates to return focused skill anchors', () => {
        expect(extractCompetencyKey('Minimum 5 years of experience with PostgreSQL databases')).toBe('PostgreSQL databases');
        expect(extractCompetencyKey('Strong proficiency with Kubernetes and Docker in production')).toBe('Kubernetes');
        expect(extractCompetencyKey('Must have experience in distributed message queues')).toBe('distributed message queues');
      });
    });

    describe('normalizeRequirementsList', () => {
      it('creates valid Requirement models with appropriate importance flags', () => {
        const raw = [
          '5+ years of Rust experience.',
          'Experience in healthcare HIPAA compliance (nice to have).',
          'Must have active US work authorization.',
        ];

        const normalized = normalizeRequirementsList(raw);
        expect(normalized.length).toBe(3);

        expect(normalized[0]?.category).toBe('experience_level');
        expect(normalized[0]?.isRequired).toBe(true);

        expect(normalized[1]?.category).toBe('domain_knowledge');
        expect(normalized[1]?.importance).toBe('preferred');
        expect(normalized[1]?.isRequired).toBe(false);

        expect(normalized[2]?.category).toBe('legal_authorization');
        expect(normalized[2]?.isRequired).toBe(true);
      });
    });

    describe('extractStructuredSections', () => {
      it('separates responsibilities from requirements and marks nice-to-have sections as preferred', () => {
        const html = `
          <div>
            <h3>Responsibilities</h3>
            <ul>
              <li>Design backend services in Rust.</li>
              <li>Collaborate with product teams.</li>
            </ul>
            <h3>Requirements</h3>
            <ul>
              <li>5+ years software engineering experience.</li>
            </ul>
            <h3>Bonus / Nice to Have</h3>
            <ul>
              <li>Experience with Kafka streaming.</li>
            </ul>
          </div>
        `;
        const container = new DOMParser().parseFromString(html, 'text/html').body;
        const sections = extractStructuredSections(container);

        expect(sections.responsibilities.length).toBe(2);
        expect(sections.responsibilities[0]).toContain('Design backend services in Rust.');

        expect(sections.requirements.length).toBe(2);
        const req5yr = sections.requirements.find((r) => r.yearsRequired === 5);
        expect(req5yr?.isRequired).toBe(true);

        const kafkaReq = sections.requirements.find((r) => r.rawText.includes('Kafka'));
        expect(kafkaReq?.importance).toBe('preferred');
        expect(kafkaReq?.isRequired).toBe(false);
      });
    });
  });
});
