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
