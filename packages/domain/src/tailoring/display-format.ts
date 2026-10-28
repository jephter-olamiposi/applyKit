/**
 * @fileoverview Text formatting shared by the resume renderers (PDF, DOCX, Markdown, plain text).
 *
 * Parsed resumes often leave a field empty when the source did not state it. These helpers
 * join only the parts that exist, so an export never prints a placeholder or a dangling
 * separator in place of a fact the candidate did not provide.
 */

/** Minimal education shape needed to render a degree line. */
export interface DegreeParts {
  readonly degree: string;
  readonly fieldOfStudy: string;
}

/**
 * Renders "B.Sc. in Computer Science", "Bachelor of Science in Mathematics", or just the
 * degree or subject when only one is known. Avoids "B.S. in CS in CS" when the degree
 * text already names the subject.
 */
export function formatDegree(edu: DegreeParts): string {
  const degree = edu.degree.trim();
  const field = edu.fieldOfStudy.trim();
  if (!degree) return field;
  if (!field || degree.toLowerCase().includes(field.toLowerCase())) return degree;
  return `${degree} in ${field}`;
}

/** Joins the non-empty parts with a bullet separator. */
export function joinPresent(parts: ReadonlyArray<string | undefined>, separator = ' • '): string {
  return parts.map((part) => (part ?? '').trim()).filter(Boolean).join(separator);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Renders "2023-01" as "Jan 2023" and "2023" as "2023". Unknown input is returned as is. */
export function formatMonthYear(value?: string): string {
  if (!value) return '';
  const match = value.match(/^(\d{4})(?:-(\d{2}))?/);
  if (!match) return value;
  const month = match[2] ? MONTHS[Number(match[2]) - 1] : undefined;
  return month ? `${month} ${match[1]}` : match[1]!;
}

/** Renders a role's date span, e.g. "Jan 2023 – Present". Returns '' when no start date is known. */
export function formatDateSpan(start?: string, end?: string, isCurrent?: boolean): string {
  const from = formatMonthYear(start);
  if (!from) return '';
  const to = isCurrent ? 'Present' : formatMonthYear(end);
  return to ? `${from} – ${to}` : from;
}

/**
 * A place for a resume header: "Lagos, Nigeria" from city "lagos", state "lagos",
 * country "Nigeria". Repeated parts are dropped (a city that is also its state), and a
 * part typed all in lowercase is capitalized, since a header reading "lagos, lagos" is
 * the first thing a recruiter sees. Parts already capitalized are left as written.
 */
export function formatPlace(parts: ReadonlyArray<string | undefined>): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of parts) {
    const part = (raw ?? '').replace(/\s+/g, ' ').trim();
    if (!part) continue;
    const key = part.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(part === part.toLowerCase() ? part.replace(/(^|[\s-])(\p{L})/gu, (_m, lead: string, ch: string) => lead + ch.toUpperCase()) : part);
  }
  return out.join(', ');
}
