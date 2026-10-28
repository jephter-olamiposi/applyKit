/**
 * Determines whether the active page is a job posting or application form.
 *
 * The in-page assistant is intentionally absent from ordinary websites and
 * general-purpose tools such as chat applications.
 */
export function isJobOrApplicationPage(doc: Document, urlString: string): boolean {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    return false;
  }

  const pathAndHost = `${url.hostname}${url.pathname}`.toLowerCase();
  if (/(?:greenhouse|lever|ashbyhq|myworkdayjobs|smartrecruiters|recruitee|jobvite)\./i.test(url.hostname)) {
    return true;
  }

  if (/(?:\/jobs?\/|\/careers?\/|\/openings?\/|\/vacanc(?:y|ies)\/|\/positions?\/|\/apply(?:\/|$))/i.test(pathAndHost)) {
    return true;
  }

  const jobPostingSchema = Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))
    .some((script) => /"@type"\s*:\s*"JobPosting"/i.test(script.textContent || ''));
  if (jobPostingSchema) return true;

  if (doc.querySelector('form input[type="file"], [data-automation-id*="application" i]')) {
    return true;
  }

  const pageText = (doc.body.textContent || '').replace(/\s+/g, ' ');
  const hasJobDetails = /\b(?:responsibilities|qualifications|required skills|requirements|salary range|location)\b/i.test(pageText);
  const hasApplicationAction = /\b(?:apply now|apply for this job|submit application|upload resume)\b/i.test(pageText);
  const hasJobHeading = /\b(?:engineer|developer|designer|manager|analyst|intern|specialist|director|coordinator)\b/i.test(
    doc.querySelector('h1')?.textContent || ''
  );

  return hasJobHeading && hasJobDetails && hasApplicationAction;
}

/** Words in a field's name, label, or placeholder that only an application form asks for. */
const APPLICATION_FIELD_WORDS =
  /\b(resume|résumé|cv|cover letter|linkedin|portfolio|work authori[sz]ation|right to work|sponsorship|visa|notice period|salary expectation|desired salary|why do you want|years of experience)\b/i;

/** Words that name the person filling the form. */
const NAME_FIELD_WORDS = /\b(first[\s_-]?name|last[\s_-]?name|full[\s_-]?name|given[\s_-]?name|family[\s_-]?name|surname|your name|name)\b/i;

/** A field's own text plus its label, for matching. */
function describeField(doc: Document, field: Element): string {
  const parts = ['name', 'id', 'placeholder', 'aria-label', 'autocomplete', 'accept'].map((attr) => field.getAttribute(attr) || '');
  const id = field.getAttribute('id');
  if (id) {
    try {
      parts.push(doc.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent || '');
    } catch {
      // An id that cannot be escaped simply has no label lookup.
    }
  }
  parts.push(field.closest('label')?.textContent || '');
  // Greenhouse, Lever and Ashby put the question text in the field's wrapper.
  parts.push((field.closest('.field, .application-question, .form-group, [class*="field"], [class*="question"]')?.textContent || '').slice(0, 200));
  return parts.join(' ').replace(/[_-]+/g, ' ');
}

/**
 * True when the page shows a job application form the candidate could be filling now:
 * a resume upload, or a name and email with at least one application-only question.
 * Job listings, search pages, login screens, and newsletter or contact forms do not count.
 *
 * Cheap enough to run every couple of seconds: it reads attributes and labels only and
 * stops looking once it has its answer.
 */
export function hasApplicationForm(doc: Document, urlString = ''): boolean {
  const fields = Array.from(doc.querySelectorAll('input, textarea, select')).slice(0, 80).filter((field) => {
    const type = (field.getAttribute('type') || '').toLowerCase();
    if (['hidden', 'submit', 'button', 'reset', 'image', 'search'].includes(type)) return false;
    if (field.closest('[hidden], [aria-hidden="true"], [role="search"]')) return false;
    return true;
  });
  if (fields.length < 2) return false;

  const hasPassword = fields.some((field) => field.getAttribute('type') === 'password');
  const fileInputs = fields.filter((field) => field.getAttribute('type') === 'file');
  const descriptions = fields.map((field) => describeField(doc, field));

  const resumeUpload = fileInputs.some((field) => /\b(resume|résumé|cv|cover)\b/i.test(describeField(doc, field)));
  if (resumeUpload && !hasPassword) return true;

  const hasEmail = fields.some((field, i) => field.getAttribute('type') === 'email' || /\be ?mail\b/i.test(descriptions[i]!));
  const hasName = descriptions.some((text) => NAME_FIELD_WORDS.test(text));
  const hasApplicationQuestion = descriptions.some((text) => APPLICATION_FIELD_WORDS.test(text)) || fileInputs.length > 0;
  // Sign-up and login screens ask for a name, email and password, never a resume.
  if (hasPassword) return false;
  // On an ATS host a name plus a few fields is the application itself (Workday's
  // "My Information" step has no resume field and often no email).
  let atsHost = false;
  try {
    atsHost = /(?:myworkdayjobs|greenhouse|lever|ashbyhq|smartrecruiters|recruitee|jobvite|workable|icims|taleo|bamboohr)\./i.test(new URL(urlString).hostname);
  } catch {
    atsHost = false;
  }
  if (atsHost && hasName && fields.length >= 3) return true;
  return hasEmail && hasName && hasApplicationQuestion && fields.length >= 3;
}

/**
 * Whether to show the in-page "Fill this form" bar: only while the candidate is on a
 * job application form, not on every job listing or careers page they browse.
 */
export function shouldShowApplyHub(doc: Document, urlString: string): boolean {
  return hasApplicationForm(doc, urlString) && isJobOrApplicationPage(doc, urlString);
}
