/**
 * @vitest-environment happy-dom
 */

import { describe, expect, it } from 'vitest';
import { isJobOrApplicationPage } from '../content/page-context.js';

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
