/**
 * @vitest-environment happy-dom
 */

import { describe, expect, it } from 'vitest';
import { isJobOrApplicationPage, shouldShowApplyHub } from '../content/page-context.js';

describe('job page context detection', () => {
  it('does not show the in-page assistant on ordinary chat pages', () => {
    const doc = document.implementation.createHTMLDocument('ChatGPT');
    doc.title = 'ChatGPT';
    doc.body.innerHTML = '<main><h1>Conversation</h1><p>Help me write a job application.</p></main>';

    expect(isJobOrApplicationPage(doc, 'https://chatgpt.com/c/123')).toBe(false);
  });

  it('does not show the assistant when ordinary page content mentions job applications', () => {
    const doc = document.implementation.createHTMLDocument('ChatGPT');
    doc.body.innerHTML = `
      <main>
        <h1>Conversation</h1>
        <p>Help me improve my job application and resume.</p>
      </main>
    `;

    expect(isJobOrApplicationPage(doc, 'https://chatgpt.com/')).toBe(false);
  });

  it('shows the assistant on job URLs', () => {
    const doc = document.implementation.createHTMLDocument('Backend Engineer');
    doc.title = 'Backend Engineer';

    expect(isJobOrApplicationPage(doc, 'https://example.com/careers/backend-engineer')).toBe(true);
  });

  it('shows the assistant on generic application forms with document fields', () => {
    const doc = document.implementation.createHTMLDocument('Application');
    doc.body.innerHTML = '<form><label>Resume upload</label><input type="file" /></form>';

    expect(isJobOrApplicationPage(doc, 'https://example.com/apply')).toBe(true);
  });

  it('shows the assistant on a generic job page with job details and an apply action', () => {
    const doc = document.implementation.createHTMLDocument('Senior Backend Engineer');
    doc.body.innerHTML = `
      <main>
        <h1>Senior Backend Engineer</h1>
        <p>Location: Remote</p>
        <h2>Responsibilities</h2>
        <p>Design reliable backend services.</p>
        <h2>Requirements</h2>
        <p>Required skills include TypeScript.</p>
        <button>Apply Now</button>
      </main>
    `;

    expect(isJobOrApplicationPage(doc, 'https://example.com/jobs/backend')).toBe(true);
  });
});

describe('the "Fill this form" bar shows only on application forms', () => {
  const page = (html: string) => {
    const doc = document.implementation.createHTMLDocument('Job');
    doc.body.innerHTML = html;
    return doc;
  };

  it('hides on a job listing or posting with no form', () => {
    const doc = page('<h1>Backend Engineer</h1><p>Responsibilities. Requirements. Apply now.</p><a href="/apply">Apply</a>');
    expect(shouldShowApplyHub(doc, 'https://boards.greenhouse.io/monzo/jobs/1')).toBe(false);
  });

  it('hides on a job search page with only search and filter fields', () => {
    const doc = page('<form role="search"><input type="search" name="q"><select name="location"><option>Remote</option></select></form>');
    expect(shouldShowApplyHub(doc, 'https://example.com/jobs/search')).toBe(false);
  });

  it('hides on a careers-site login', () => {
    const doc = page('<form><label for="e">Email</label><input id="e" type="email"><label for="n">Name</label><input id="n"><input type="password"></form>');
    expect(shouldShowApplyHub(doc, 'https://careers.example.com/login')).toBe(false);
  });

  it('shows on a form with a resume upload', () => {
    const doc = page('<form><label for="r">Resume/CV</label><input id="r" type="file"><input name="email" type="email"></form>');
    expect(shouldShowApplyHub(doc, 'https://jobs.lever.co/acme/123/apply')).toBe(true);
  });

  it('shows on a name, email and application question form', () => {
    const doc = page(`<form>
      <label for="f">First Name</label><input id="f">
      <label for="m">Email</label><input id="m" type="email">
      <label for="l">LinkedIn Profile</label><input id="l">
    </form>`);
    expect(shouldShowApplyHub(doc, 'https://boards.greenhouse.io/monzo/jobs/1')).toBe(true);
  });

  it('hides on a newsletter or contact form, even on a careers page', () => {
    const doc = page('<form><label for="n">Name</label><input id="n"><label for="e">Email</label><input id="e" type="email"><textarea name="message"></textarea></form>');
    expect(shouldShowApplyHub(doc, 'https://example.com/careers/')).toBe(false);
  });
});

describe('Workday application steps', () => {
  it('shows on the My Information step, which has no resume or email field', () => {
    const doc = document.implementation.createHTMLDocument('Workday');
    doc.body.innerHTML = `<div data-automation-id="applyFlowPage">
      <label for="a">First Name</label><input id="a"><label for="b">Last Name</label><input id="b">
      <label for="c">Address Line 1</label><input id="c"></div>`;
    expect(shouldShowApplyHub(doc, 'https://acme.wd5.myworkdayjobs.com/en-US/careers/job/x/apply')).toBe(true);
  });
});

describe('company name on a generic job page', () => {
  it('reads it from a "<role> at <company>" title', async () => {
    const { GenericJobSiteAdapter } = await import('../content/adapters/generic-adapter.js');
    const doc = document.implementation.createHTMLDocument('Job Application for Software Engineer at PlanetScale');
    doc.title = 'Job Application for Software Engineer at PlanetScale';
    doc.body.innerHTML = '<h1>Software Engineer</h1><p>Remote</p>';
    const job = new GenericJobSiteAdapter().extract(doc, new URL('https://apply.example.com/jobs/1'));
    expect(job.companyName).toBe('PlanetScale');
  });
});
