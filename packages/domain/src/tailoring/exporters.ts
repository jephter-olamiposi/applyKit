/**
 * @fileoverview Clean Markdown and Plain Text Exporters for Tailored Documents.
 *
 * Formats tailored resumes and evidence-grounded cover letters into clean Markdown
 * or structured plain text suitable for direct copy-pasting into ATS textareas
 * or saving as local files.
 */

import type { CandidateProfile } from '../candidate/profile.js';
import { getPreferredOrLegalName } from '../candidate/identity.js';
import type { TailoredResume, TailoredCoverLetter } from './tailoring-types.js';

/**
 * Formats location object into a clean geographic string.
 */
function formatLocation(profile: CandidateProfile): string {
  const loc = profile.identity.location;
  if (!loc) return '';
  return [loc.city, loc.stateOrProvince, loc.country].filter(Boolean).join(', ');
}

/**
 * Exports a tailored resume as cleanly formatted Markdown.
 */
export function exportResumeAsMarkdown(
  resume: TailoredResume,
  profile: CandidateProfile
): string {
  const lines: string[] = [];

  // 1. Candidate Header
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

  // 2. Executive Summary
  lines.push('## Professional Summary');
  lines.push(resume.tailoredSummary);
  lines.push('');

  // 3. Technical Skills
  lines.push('## Technical Skills');
  if (resume.skills.matchedRequired.length > 0) {
    lines.push(`- **Core Competencies:** ${resume.skills.matchedRequired.join(', ')}`);
  }
  if (resume.skills.matchedPreferred.length > 0) {
    lines.push(`- **Preferred Qualifications:** ${resume.skills.matchedPreferred.join(', ')}`);
  }
  if (resume.skills.additionalSkills.length > 0) {
    lines.push(`- **Additional Proficiencies:** ${resume.skills.additionalSkills.join(', ')}`);
  }
  lines.push('');

  // 4. Professional Experience
  lines.push('## Professional Experience');
  for (const exp of resume.experiences) {
    const dates = `${exp.startDate} – ${exp.isCurrent ? 'Present' : exp.endDate || 'N/A'}`;
    lines.push(`### ${exp.title} | ${exp.company}`);
    lines.push(`*${dates}*`);
    for (const h of exp.rankedHighlights) {
      lines.push(`- ${h.text}`);
    }
    lines.push('');
  }

  // 5. Projects
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

  // 6. Education
  if (profile.education.length > 0) {
    lines.push('## Education');
    for (const edu of profile.education) {
      const year = edu.endDate ? ` (${edu.endDate.slice(0, 4)})` : '';
      lines.push(`- **${edu.degree} in ${edu.fieldOfStudy}** – ${edu.institution}${year}`);
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

  lines.push('TECHNICAL SKILLS');
  lines.push('----------------------------------------');
  if (resume.skills.matchedRequired.length > 0) {
    lines.push(`Core Competencies: ${resume.skills.matchedRequired.join(', ')}`);
  }
  if (resume.skills.matchedPreferred.length > 0) {
    lines.push(`Preferred Qualifications: ${resume.skills.matchedPreferred.join(', ')}`);
  }
  if (resume.skills.additionalSkills.length > 0) {
    lines.push(`Additional Skills: ${resume.skills.additionalSkills.join(', ')}`);
  }
  lines.push('');

  lines.push('PROFESSIONAL EXPERIENCE');
  lines.push('----------------------------------------');
  for (const exp of resume.experiences) {
    const dates = `${exp.startDate} - ${exp.isCurrent ? 'Present' : exp.endDate || 'N/A'}`;
    lines.push(`${exp.title.toUpperCase()} | ${exp.company}`);
    lines.push(dates);
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
      lines.push(`* ${edu.degree} in ${edu.fieldOfStudy} - ${edu.institution}${year}`);
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
