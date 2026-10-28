/**
 * @fileoverview Clean Markdown and Plain Text Exporters for Tailored Documents.
 *
 * Formats tailored resumes and evidence-grounded cover letters into clean Markdown
 * or structured plain text suitable for direct copy-pasting into ATS textareas
 * or saving as local files.
 */

import type { CandidateProfile } from '../candidate/profile.js';
import { getPreferredOrLegalName } from '../candidate/identity.js';
import { formatDegree, joinPresent, formatDateSpan, formatPlace } from './display-format.js';
import type { TailoredResume, TailoredCoverLetter } from './tailoring-types.js';

/**
 * Formats location object into a clean geographic string.
 */
function formatLocation(profile: CandidateProfile): string {
  const loc = profile.identity.location;
  if (!loc) return '';
  return formatPlace([loc.city, loc.stateOrProvince, loc.country]);
}

/**
 * Exports a tailored resume as cleanly formatted Markdown.
 */
export function exportResumeAsMarkdown(
  resume: TailoredResume,
  profile: CandidateProfile
): string {
  const lines: string[] = [];

  const name = getPreferredOrLegalName(profile.identity) || 'Candidate';
  lines.push(`# ${name}`);

  const contactParts: string[] = [];
  if (profile.identity.email) contactParts.push(profile.identity.email);
  if (profile.identity.phone) contactParts.push(profile.identity.phone);
  const locStr = formatLocation(profile);
  if (locStr) contactParts.push(locStr);
  if (contactParts.length > 0) {
    lines.push(contactParts.join(' | '));
  }

  const linkParts: string[] = [];
  if (profile.links?.linkedin) linkParts.push(`[LinkedIn](${profile.links.linkedin})`);
  if (profile.links?.github) linkParts.push(`[GitHub](${profile.links.github})`);
  if (profile.links?.portfolio) linkParts.push(`[Portfolio](${profile.links.portfolio})`);
  if (linkParts.length > 0) {
    lines.push(linkParts.join(' | '));
  }

  lines.push('');

  lines.push('## Professional Summary');
  lines.push(resume.tailoredSummary);
  lines.push('');

  lines.push('## Skills');
  for (const group of skillGroups(resume)) {
    lines.push(`- **${group.category}:** ${group.skills.join(', ')}`);
  }
  lines.push('');

  lines.push('## Professional Experience');
  for (const exp of resume.experiences) {
    const dates = formatDateSpan(exp.startDate, exp.endDate, exp.isCurrent);
    lines.push(`### ${joinPresent([exp.title, exp.company], ' | ')}`);
    if (dates) lines.push(`*${dates}*`);
    for (const h of exp.rankedHighlights) {
      lines.push(`- ${h.text}`);
    }
    lines.push('');
  }

  if (resume.projects.length > 0) {
    lines.push('## Notable Projects');
    for (const proj of resume.projects) {
      const roleStr = proj.role ? ` (${proj.role})` : '';
      lines.push(`### ${proj.title}${roleStr}`);
      if (proj.technologiesUsed.length > 0) {
        lines.push(`*Technologies:* ${proj.technologiesUsed.join(', ')}`);
      }
      for (const h of proj.rankedHighlights) {
        lines.push(`- ${h.text}`);
      }
      lines.push('');
    }
  }

  if (profile.education.length > 0) {
    lines.push('## Education');
    for (const edu of profile.education) {
      const year = edu.endDate ? ` (${edu.endDate.slice(0, 4)})` : '';
      lines.push(`- **${formatDegree(edu)}**${edu.institution ? ` – ${edu.institution}` : ''}${year}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Exports a tailored resume as plain text formatted for legacy ATS text input fields.
 */
export function exportResumeAsPlainText(
  resume: TailoredResume,
  profile: CandidateProfile
): string {
  const lines: string[] = [];

  const name = getPreferredOrLegalName(profile.identity) || 'Candidate';
  lines.push(name.toUpperCase());

  const contactParts: string[] = [];
  if (profile.identity.email) contactParts.push(profile.identity.email);
  if (profile.identity.phone) contactParts.push(profile.identity.phone);
  const locStr = formatLocation(profile);
  if (locStr) contactParts.push(locStr);
  if (contactParts.length > 0) lines.push(contactParts.join(' | '));

  const linkParts: string[] = [];
  if (profile.links?.linkedin) linkParts.push(profile.links.linkedin);
  if (profile.links?.github) linkParts.push(profile.links.github);
  if (profile.links?.portfolio) linkParts.push(profile.links.portfolio);
  if (linkParts.length > 0) lines.push(linkParts.join(' | '));

  lines.push('');
  lines.push('PROFESSIONAL SUMMARY');
  lines.push('----------------------------------------');
  lines.push(resume.tailoredSummary);
  lines.push('');

  lines.push('SKILLS');
  lines.push('----------------------------------------');
  for (const group of skillGroups(resume)) {
    lines.push(`${group.category}: ${group.skills.join(', ')}`);
  }
  lines.push('');

  lines.push('PROFESSIONAL EXPERIENCE');
  lines.push('----------------------------------------');
  for (const exp of resume.experiences) {
    const dates = formatDateSpan(exp.startDate, exp.endDate, exp.isCurrent);
    lines.push(joinPresent([exp.title.toUpperCase(), exp.company], ' | '));
    if (dates) lines.push(dates);
    for (const h of exp.rankedHighlights) {
      lines.push(`* ${h.text}`);
    }
    lines.push('');
  }

  if (resume.projects.length > 0) {
    lines.push('NOTABLE PROJECTS');
    lines.push('----------------------------------------');
    for (const proj of resume.projects) {
      lines.push(proj.title.toUpperCase() + (proj.role ? ` (${proj.role})` : ''));
      if (proj.technologiesUsed.length > 0) {
        lines.push(`Technologies: ${proj.technologiesUsed.join(', ')}`);
      }
      for (const h of proj.rankedHighlights) {
        lines.push(`* ${h.text}`);
      }
      lines.push('');
    }
  }

  if (profile.education.length > 0) {
    lines.push('EDUCATION');
    lines.push('----------------------------------------');
    for (const edu of profile.education) {
      const year = edu.endDate ? ` (${edu.endDate.slice(0, 4)})` : '';
      lines.push(`* ${formatDegree(edu)}${edu.institution ? ` - ${edu.institution}` : ''}${year}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Exports a tailored cover letter as cleanly formatted Markdown.
 */
export function exportCoverLetterAsMarkdown(
  coverLetter: TailoredCoverLetter,
  profile: CandidateProfile
): string {
  const lines: string[] = [];

  const name = getPreferredOrLegalName(profile.identity) || coverLetter.candidateName;
  lines.push(`# ${name}`);

  const contactParts: string[] = [];
  if (profile.identity.email) contactParts.push(profile.identity.email);
  if (profile.identity.phone) contactParts.push(profile.identity.phone);
  const locStr = formatLocation(profile);
  if (locStr) contactParts.push(locStr);
  if (contactParts.length > 0) lines.push(contactParts.join(' | '));

  lines.push('');
  lines.push(`**Date:** ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`);
  lines.push(`**Application for:** ${coverLetter.targetJobTitle} at ${coverLetter.companyName}`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(coverLetter.fullText);

  return lines.join('\n');
}

/**
 * Exports a tailored cover letter as standard plain text suitable for email or ATS submission.
 */
export function exportCoverLetterAsPlainText(
  coverLetter: TailoredCoverLetter,
  profile: CandidateProfile
): string {
  const lines: string[] = [];

  const name = getPreferredOrLegalName(profile.identity) || coverLetter.candidateName;
  lines.push(name);

  const contactParts: string[] = [];
  if (profile.identity.email) contactParts.push(profile.identity.email);
  if (profile.identity.phone) contactParts.push(profile.identity.phone);
  const locStr = formatLocation(profile);
  if (locStr) contactParts.push(locStr);
  if (contactParts.length > 0) lines.push(contactParts.join(' | '));

  lines.push('');
  lines.push(new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }));
  lines.push('');
  lines.push(`Application: ${coverLetter.targetJobTitle} - ${coverLetter.companyName}`);
  lines.push('');
  lines.push(coverLetter.fullText);

  return lines.join('\n');
}

/**
 * Skill lines for text exports: grouped by kind when categories exist, otherwise a single
 * "Skills" line. Job-posting terms such as "Preferred Qualifications" never appear on the
 * candidate's own resume.
 */
function skillGroups(resume: TailoredResume): ReadonlyArray<{ category: string; skills: readonly string[] }> {
  const groups = resume.skills.domainCategories?.filter((group) => group.skills.length > 0) ?? [];
  if (groups.length > 0) return groups;
  const all = [...resume.skills.matchedRequired, ...resume.skills.matchedPreferred, ...resume.skills.additionalSkills];
  return all.length > 0 ? [{ category: 'Skills', skills: all }] : [];
}
