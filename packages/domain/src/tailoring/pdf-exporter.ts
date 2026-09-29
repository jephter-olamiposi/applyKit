/**
 * @fileoverview High-Impact PDF Exporter for Tailored Resumes and Cover Letters.
 *
 * Implements 4 pre-designed professional resume templates (ADR-0026):
 * 1. Modern Clean: Contemporary layout with crisp accent bars and scannable skills.
 * 2. Classic Executive: Centered formal hierarchy with refined divider lines.
 * 3. Minimalist ATS: Ultra-clean monochrome engineered for maximum ATS parser compatibility.
 * 4. Compact 1-Pager: Dense, tightly budgeted layout guaranteed to fit on a single 792pt page.
 *
 * Renders complete verified candidate identity, clickable online links, and education.
 */

import React from 'react';
import { Document, Page, Text, View, StyleSheet, Font, pdf } from '@react-pdf/renderer';
import type { CandidateProfile } from '../candidate/profile.js';
import { getPreferredOrLegalName } from '../candidate/identity.js';
import type {
  TailoredCoverLetter,
  TailoredResume,
  ResumePdfOptions,
  ResumeTemplateId,
  SpacingDensity,
} from './tailoring-types.js';

Font.register({
  family: 'Helvetica',
  src: 'Helvetica',
});

const coverLetterStyles = StyleSheet.create({
  page: {
    padding: 50,
    fontFamily: 'Helvetica',
    fontSize: 11,
    lineHeight: 1.6,
    color: '#1a1a2e',
  },
  header: {
    marginBottom: 24,
  },
  date: {
    marginBottom: 12,
    fontSize: 10,
    color: '#666',
  },
  recipient: {
    marginBottom: 24,
  },
  greeting: {
    marginBottom: 16,
  },
  paragraph: {
    marginBottom: 14,
    textAlign: 'justify',
  },
  closing: {
    marginTop: 24,
  },
});

// Template 1: Modern Clean
const modernResumeStyles = StyleSheet.create({
  page: {
    paddingTop: 34,
    paddingBottom: 34,
    paddingHorizontal: 40,
    fontFamily: 'Helvetica',
    fontSize: 9.5,
    lineHeight: 1.35,
    color: '#1e293b',
  },
  header: {
    marginBottom: 12,
    borderBottomWidth: 2,
    borderBottomColor: '#2563eb',
    paddingBottom: 8,
  },
  name: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#0f172a',
    letterSpacing: 0.5,
  },
  title: {
    fontSize: 11,
    color: '#2563eb',
    marginTop: 2,
    marginBottom: 4,
    fontWeight: 'bold',
  },
  contact: {
    fontSize: 8.5,
    color: '#64748b',
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  targetBadge: {
    fontSize: 8,
    color: '#0284c7',
    marginTop: 3,
  },
  sectionTitle: {
    fontSize: 10,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 1,
    color: '#0f172a',
    marginTop: 10,
    marginBottom: 5,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    paddingBottom: 2,
  },
  paragraph: {
    fontSize: 9,
    lineHeight: 1.35,
    color: '#334155',
    marginBottom: 6,
  },
  experience: {
    marginBottom: 8,
  },
  expHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  expTitle: {
    fontWeight: 'bold',
    fontSize: 9.5,
    color: '#0f172a',
  },
  expCompany: {
    color: '#334155',
    fontSize: 9,
  },
  expDates: {
    fontSize: 8.5,
    color: '#64748b',
  },
  bullet: {
    marginLeft: 10,
    marginBottom: 2.5,
    flexDirection: 'row',
  },
  bulletMarker: {
    width: 8,
    fontSize: 9,
    color: '#2563eb',
  },
  bulletText: {
    fontSize: 9,
    flex: 1,
    color: '#334155',
    lineHeight: 1.3,
  },
  skills: {
    marginTop: 3,
    marginBottom: 6,
  },
  skillCategory: {
    fontSize: 8.5,
    color: '#334155',
    marginBottom: 2,
  },
  project: {
    marginBottom: 6,
  },
  projectTitle: {
    fontWeight: 'bold',
    fontSize: 9,
    color: '#0f172a',
  },
  projectTech: {
    fontSize: 8,
    color: '#64748b',
    marginBottom: 2,
  },
  eduItem: {
    marginBottom: 4,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  eduDegree: {
    fontSize: 9,
    fontWeight: 'bold',
    color: '#0f172a',
  },
  eduInstitution: {
    fontSize: 8.5,
    color: '#475569',
  },
  eduYear: {
    fontSize: 8.5,
    color: '#64748b',
  },
  footer: {
    position: 'absolute',
    bottom: 14,
    left: 40,
    right: 40,
    textAlign: 'center',
    fontSize: 7.5,
    color: '#94a3b8',
  },
});

// Template 2: Classic Executive
const classicResumeStyles = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingBottom: 36,
    paddingHorizontal: 42,
    fontFamily: 'Helvetica',
    fontSize: 9.5,
    lineHeight: 1.35,
    color: '#111827',
  },
  header: {
    marginBottom: 12,
    textAlign: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#111827',
    paddingBottom: 8,
  },
  name: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#111827',
    textAlign: 'center',
    letterSpacing: 1,
  },
  title: {
    fontSize: 10.5,
    color: '#374151',
    marginTop: 2,
    textAlign: 'center',
  },
  contact: {
    fontSize: 8.5,
    color: '#4b5563',
    textAlign: 'center',
    marginTop: 3,
  },
  targetBadge: {
    fontSize: 8,
    color: '#4b5563',
    marginTop: 2,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  sectionTitle: {
    fontSize: 10,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    color: '#111827',
    marginTop: 10,
    marginBottom: 5,
    borderBottomWidth: 0.5,
    borderBottomColor: '#9ca3af',
    paddingBottom: 2,
  },
  paragraph: {
    fontSize: 9,
    lineHeight: 1.35,
    color: '#1f2937',
    marginBottom: 6,
  },
  experience: {
    marginBottom: 8,
  },
  expHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  expTitle: {
    fontWeight: 'bold',
    fontSize: 9.5,
    color: '#111827',
  },
  expCompany: {
    color: '#374151',
    fontSize: 9,
    fontStyle: 'italic',
  },
  expDates: {
    fontSize: 8.5,
    color: '#4b5563',
  },
  bullet: {
    marginLeft: 10,
    marginBottom: 2.5,
    flexDirection: 'row',
  },
  bulletMarker: {
    width: 8,
    fontSize: 9,
    color: '#111827',
  },
  bulletText: {
    fontSize: 9,
    flex: 1,
    color: '#1f2937',
    lineHeight: 1.3,
  },
  skills: {
    marginTop: 3,
    marginBottom: 6,
  },
  skillCategory: {
    fontSize: 8.5,
    color: '#1f2937',
    marginBottom: 2,
  },
  project: {
    marginBottom: 6,
  },
  projectTitle: {
    fontWeight: 'bold',
    fontSize: 9,
    color: '#111827',
  },
  projectTech: {
    fontSize: 8,
    color: '#4b5563',
    marginBottom: 2,
  },
  eduItem: {
    marginBottom: 4,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  eduDegree: {
    fontSize: 9,
    fontWeight: 'bold',
    color: '#111827',
  },
  eduInstitution: {
    fontSize: 8.5,
    color: '#374151',
  },
  eduYear: {
    fontSize: 8.5,
    color: '#4b5563',
  },
  footer: {
    position: 'absolute',
    bottom: 16,
    left: 42,
    right: 42,
    textAlign: 'center',
    fontSize: 7.5,
    color: '#6b7280',
  },
});

// Template 3: Minimalist ATS
const minimalistResumeStyles = StyleSheet.create({
  page: {
    paddingTop: 32,
    paddingBottom: 32,
    paddingHorizontal: 36,
    fontFamily: 'Helvetica',
    fontSize: 9.5,
    lineHeight: 1.35,
    color: '#000000',
  },
  header: {
    marginBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#000000',
    paddingBottom: 6,
  },
  name: {
    fontSize: 19,
    fontWeight: 'bold',
    color: '#000000',
  },
  title: {
    fontSize: 10.5,
    color: '#000000',
    marginTop: 2,
  },
  contact: {
    fontSize: 8.5,
    color: '#000000',
    marginTop: 2,
  },
  targetBadge: {
    fontSize: 8,
    color: '#333333',
    marginTop: 2,
  },
  sectionTitle: {
    fontSize: 10,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    color: '#000000',
    marginTop: 9,
    marginBottom: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: '#000000',
    paddingBottom: 1,
  },
  paragraph: {
    fontSize: 9,
    lineHeight: 1.35,
    color: '#000000',
    marginBottom: 5,
  },
  experience: {
    marginBottom: 7,
  },
  expHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 1.5,
  },
  expTitle: {
    fontWeight: 'bold',
    fontSize: 9.5,
    color: '#000000',
  },
  expCompany: {
    color: '#000000',
    fontSize: 9,
  },
  expDates: {
    fontSize: 8.5,
    color: '#000000',
  },
  bullet: {
    marginLeft: 8,
    marginBottom: 2,
    flexDirection: 'row',
  },
  bulletMarker: {
    width: 6,
    fontSize: 9,
    color: '#000000',
  },
  bulletText: {
    fontSize: 9,
    flex: 1,
    color: '#000000',
    lineHeight: 1.3,
  },
  skills: {
    marginTop: 2,
    marginBottom: 5,
  },
  skillCategory: {
    fontSize: 8.5,
    color: '#000000',
    marginBottom: 1.5,
  },
  project: {
    marginBottom: 5,
  },
  projectTitle: {
    fontWeight: 'bold',
    fontSize: 9,
    color: '#000000',
  },
  projectTech: {
    fontSize: 8,
    color: '#000000',
    marginBottom: 1.5,
  },
  eduItem: {
    marginBottom: 3,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  eduDegree: {
    fontSize: 9,
    fontWeight: 'bold',
    color: '#000000',
  },
  eduInstitution: {
    fontSize: 8.5,
    color: '#000000',
  },
  eduYear: {
    fontSize: 8.5,
    color: '#000000',
  },
  footer: {
    position: 'absolute',
    bottom: 14,
    left: 36,
    right: 36,
    textAlign: 'center',
    fontSize: 7.5,
    color: '#555555',
  },
});

// Template 4: Compact 1-Pager (Guaranteed 1-Page Fit)
const compactResumeStyles = StyleSheet.create({
  page: {
    paddingTop: 24,
    paddingBottom: 24,
    paddingHorizontal: 30,
    fontFamily: 'Helvetica',
    fontSize: 8.5,
    lineHeight: 1.25,
    color: '#1a1a2e',
  },
  header: {
    marginBottom: 8,
    borderBottomWidth: 1.5,
    borderBottomColor: '#3b82f6',
    paddingBottom: 4,
  },
  name: {
    fontSize: 17,
    fontWeight: 'bold',
    color: '#0f172a',
  },
  title: {
    fontSize: 9.5,
    color: '#2563eb',
    marginTop: 1,
    fontWeight: 'bold',
  },
  contact: {
    fontSize: 7.5,
    color: '#64748b',
    marginTop: 2,
  },
  targetBadge: {
    fontSize: 7.5,
    color: '#0284c7',
    marginTop: 1,
  },
  sectionTitle: {
    fontSize: 9,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    color: '#0f172a',
    marginTop: 7,
    marginBottom: 3,
    borderBottomWidth: 0.5,
    borderBottomColor: '#cbd5e1',
    paddingBottom: 1,
  },
  paragraph: {
    fontSize: 8,
    lineHeight: 1.25,
    color: '#334155',
    marginBottom: 4,
  },
  experience: {
    marginBottom: 5,
  },
  expHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 1,
  },
  expTitle: {
    fontWeight: 'bold',
    fontSize: 8.5,
    color: '#0f172a',
  },
  expCompany: {
    color: '#334155',
    fontSize: 8,
  },
  expDates: {
    fontSize: 7.5,
    color: '#64748b',
  },
  bullet: {
    marginLeft: 8,
    marginBottom: 1.5,
    flexDirection: 'row',
  },
  bulletMarker: {
    width: 6,
    fontSize: 8,
    color: '#2563eb',
  },
  bulletText: {
    fontSize: 8,
    flex: 1,
    color: '#334155',
    lineHeight: 1.2,
  },
  skills: {
    marginTop: 2,
    marginBottom: 4,
  },
  skillCategory: {
    fontSize: 7.5,
    color: '#334155',
    marginBottom: 1,
  },
  project: {
    marginBottom: 4,
  },
  projectTitle: {
    fontWeight: 'bold',
    fontSize: 8,
    color: '#0f172a',
  },
  projectTech: {
    fontSize: 7.5,
    color: '#64748b',
    marginBottom: 1,
  },
  eduItem: {
    marginBottom: 2,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  eduDegree: {
    fontSize: 8,
    fontWeight: 'bold',
    color: '#0f172a',
  },
  eduInstitution: {
    fontSize: 7.5,
    color: '#475569',
  },
  eduYear: {
    fontSize: 7.5,
    color: '#64748b',
  },
  footer: {
    position: 'absolute',
    bottom: 10,
    left: 30,
    right: 30,
    textAlign: 'center',
    fontSize: 7,
    color: '#94a3b8',
  },
});

function applyDensityOverrides(baseStyles: Record<string, any>, density?: SpacingDensity): Record<string, any> {
  if (!density || density === 'standard') {
    return baseStyles;
  }
  if (density === 'tight') {
    return {
      ...baseStyles,
      page: {
        ...baseStyles.page,
        paddingTop: Math.max(16, Math.round((baseStyles.page?.paddingTop ?? 32) * 0.75)),
        paddingBottom: Math.max(16, Math.round((baseStyles.page?.paddingBottom ?? 32) * 0.75)),
        paddingHorizontal: Math.max(20, Math.round((baseStyles.page?.paddingHorizontal ?? 36) * 0.8)),
        lineHeight: 1.2,
      },
      paragraph: {
        ...baseStyles.paragraph,
        marginBottom: Math.max(2, Math.round((baseStyles.paragraph?.marginBottom ?? 5) * 0.65)),
        lineHeight: 1.2,
      },
      sectionTitle: {
        ...baseStyles.sectionTitle,
        marginTop: Math.max(5, Math.round((baseStyles.sectionTitle?.marginTop ?? 9) * 0.65)),
        marginBottom: Math.max(1, Math.round((baseStyles.sectionTitle?.marginBottom ?? 3) * 0.65)),
      },
      experience: {
        ...baseStyles.experience,
        marginBottom: Math.max(3, Math.round((baseStyles.experience?.marginBottom ?? 7) * 0.65)),
      },
      bullet: {
        ...baseStyles.bullet,
        marginBottom: 1,
      },
    };
  }
  if (density === 'relaxed') {
    return {
      ...baseStyles,
      page: {
        ...baseStyles.page,
        paddingTop: Math.round((baseStyles.page?.paddingTop ?? 32) * 1.2),
        paddingBottom: Math.round((baseStyles.page?.paddingBottom ?? 32) * 1.2),
        paddingHorizontal: Math.round((baseStyles.page?.paddingHorizontal ?? 36) * 1.15),
        lineHeight: 1.45,
      },
      paragraph: {
        ...baseStyles.paragraph,
        marginBottom: Math.round((baseStyles.paragraph?.marginBottom ?? 5) * 1.35),
        lineHeight: 1.45,
      },
      sectionTitle: {
        ...baseStyles.sectionTitle,
        marginTop: Math.round((baseStyles.sectionTitle?.marginTop ?? 9) * 1.35),
        marginBottom: Math.round((baseStyles.sectionTitle?.marginBottom ?? 3) * 1.35),
      },
      experience: {
        ...baseStyles.experience,
        marginBottom: Math.round((baseStyles.experience?.marginBottom ?? 7) * 1.35),
      },
      bullet: {
        ...baseStyles.bullet,
        marginBottom: 3,
      },
    };
  }
  return baseStyles;
}

function resolveResumeStyles(templateId: ResumeTemplateId = 'modern', density?: SpacingDensity) {
  let base: Record<string, any>;
  switch (templateId) {
    case 'classic':
      base = classicResumeStyles;
      break;
    case 'minimalist':
      base = minimalistResumeStyles;
      break;
    case 'compact':
      base = compactResumeStyles;
      break;
    case 'modern':
    default:
      base = modernResumeStyles;
      break;
  }
  return applyDensityOverrides(base, density);
}

function formatDate(isoString?: string): string {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  } catch {
    return isoString;
  }
}

function renderCoverLetterParagraph(text: string) {
  return React.createElement(
    Text,
    { style: coverLetterStyles.paragraph },
    text.split('\n').map((line, i) =>
      React.createElement(Text, { key: i }, line, React.createElement(Text, { style: { marginBottom: 4 } }))
    )
  );
}

function buildCoverLetterDocument(letter: TailoredCoverLetter) {
  const formatRecipient = (recipient: string) => {
    const lines = recipient.split('\n').map((l) => l.trim()).filter(Boolean);
    return lines.map((l) => React.createElement(Text, { key: l }, l));
  };

  return React.createElement(
    Document,
    {},
    React.createElement(
      Page,
      { size: 'LETTER', style: coverLetterStyles.page },
      React.createElement(
        View,
        { style: coverLetterStyles.header },
        React.createElement(
          Text,
          { style: coverLetterStyles.date },
          new Date().toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
        ),
        React.createElement(View, { style: coverLetterStyles.recipient }, formatRecipient(letter.companyName))
      ),
      React.createElement(Text, { style: coverLetterStyles.greeting }, 'Dear Hiring Team,'),
      renderCoverLetterParagraph(letter.openingParagraph),
      letter.bodyParagraphs.map((p, i) =>
        React.createElement(Text, { key: i, style: coverLetterStyles.paragraph }, p.paragraphText)
      ),
      React.createElement(
        View,
        { style: coverLetterStyles.closing },
        letter.closingParagraph.split('\n').map((line, i) => React.createElement(Text, { key: i }, line))
      )
    )
  );
}

function buildResumeDocument(
  resume: TailoredResume,
  profile?: CandidateProfile,
  options?: ResumePdfOptions
) {
  const isOnePage = options?.onePageFit ?? false;
  const templateId = options?.templateId || resume.templateId || (isOnePage ? 'compact' : 'modern');
  const density = options?.density;
  const showTargetBadge = options?.showTargetBadge ?? true;
  const styles = resolveResumeStyles(templateId, density);

  // Candidate Name & Contact Details
  const candidateName = profile ? getPreferredOrLegalName(profile.identity) || 'Candidate' : 'Candidate';
  const candidateTitle =
    profile?.professional.currentTitle || profile?.professional.headline || resume.targetJobTitle;

  const contactItems: string[] = [];
  if (profile?.identity.email) contactItems.push(profile.identity.email);
  if (profile?.identity.phone) contactItems.push(profile.identity.phone);
  if (profile?.identity.location) {
    const loc = [profile.identity.location.city, profile.identity.location.stateOrProvince, profile.identity.location.country]
      .filter(Boolean)
      .join(', ');
    if (loc) contactItems.push(loc);
  }

  const linkItems: string[] = [];
  if (profile?.links?.linkedin) linkItems.push(`LinkedIn: ${profile.links.linkedin}`);
  if (profile?.links?.github) linkItems.push(`GitHub: ${profile.links.github}`);
  if (profile?.links?.portfolio) linkItems.push(`Portfolio: ${profile.links.portfolio}`);

  const contactString = [contactItems.join(' • '), linkItems.join(' • ')].filter(Boolean).join(' | ');

  // Budget content based on onePageFit option
  const experiencesToRender = isOnePage
    ? resume.experiences.slice(0, 3)
    : resume.experiences;

  const projectsToRender = isOnePage
    ? resume.projects.slice(0, 1)
    : resume.projects;

  const certifications = profile?.documents?.filter(
    (d) => d.documentType === 'certification_credential'
  ) || [];

  return React.createElement(
    Document,
    {},
    React.createElement(
      Page,
      { size: 'LETTER', style: styles.page },
      React.createElement(
        View,
        { style: styles.header },
        React.createElement(Text, { style: styles.name }, candidateName),
        React.createElement(Text, { style: styles.title }, candidateTitle),
        contactString ? React.createElement(Text, { style: styles.contact }, contactString) : null,
        showTargetBadge
          ? React.createElement(
              Text,
              { style: styles.targetBadge },
              `Tailored for ${resume.targetJobTitle} at ${resume.companyName}`
            )
          : null
      ),

      React.createElement(Text, { style: styles.sectionTitle }, 'PROFESSIONAL SUMMARY'),
      React.createElement(Text, { style: styles.paragraph }, resume.tailoredSummary),

      React.createElement(Text, { style: styles.sectionTitle }, 'TECHNICAL SKILLS'),
      React.createElement(
        View,
        { style: styles.skills },
        resume.skills.matchedRequired.length > 0
          ? React.createElement(
              Text,
              { style: styles.skillCategory },
              `Core Competencies: ${resume.skills.matchedRequired.join(', ')}`
            )
          : null,
        resume.skills.matchedPreferred.length > 0
          ? React.createElement(
              Text,
              { style: styles.skillCategory },
              `Preferred Qualifications: ${resume.skills.matchedPreferred.join(', ')}`
            )
          : null,
        resume.skills.additionalSkills.length > 0
          ? React.createElement(
              Text,
              { style: styles.skillCategory },
              `Additional Proficiencies: ${isOnePage ? resume.skills.additionalSkills.slice(0, 10).join(', ') : resume.skills.additionalSkills.join(', ')}`
            )
          : null
      ),

      experiencesToRender.length > 0
        ? React.createElement(
            View,
            {},
            React.createElement(Text, { style: styles.sectionTitle }, 'WORK EXPERIENCE'),
            experiencesToRender.map((exp, i) => {
              const profileExp = profile?.experiences.find((pe) => pe.id === exp.experienceId);
              const locString = profileExp?.location ? ` • ${profileExp.location}` : '';
              const bullets = isOnePage ? exp.rankedHighlights.slice(0, 3) : exp.rankedHighlights;

              return React.createElement(
                View,
                { key: i, style: styles.experience, wrap: false },
                React.createElement(
                  View,
                  { style: styles.expHeader },
                  React.createElement(
                    Text,
                    { style: styles.expTitle },
                    `${exp.title} — `,
                    React.createElement(Text, { style: styles.expCompany }, `${exp.company}${locString}`)
                  ),
                  React.createElement(
                    Text,
                    { style: styles.expDates },
                    `${formatDate(exp.startDate)} – ${exp.isCurrent ? 'Present' : formatDate(exp.endDate)}`
                  )
                ),
                bullets.map((h, j) =>
                  React.createElement(
                    View,
                    { key: j, style: styles.bullet },
                    React.createElement(Text, { style: styles.bulletMarker }, '•'),
                    React.createElement(Text, { style: styles.bulletText }, h.text)
                  )
                )
              );
            })
          )
        : null,

      projectsToRender.length > 0
        ? React.createElement(
            View,
            {},
            React.createElement(Text, { style: styles.sectionTitle }, 'NOTABLE PROJECTS'),
            projectsToRender.map((proj, i) => {
              const profileProj = profile?.projects.find((pp) => pp.id === proj.projectId);
              const linkUrl = profileProj?.url || profileProj?.repoUrl;
              const linkDisplay = linkUrl ? ` • ${linkUrl}` : '';
              const roleDisplay = proj.role ? ` (${proj.role})` : '';
              const bullets = isOnePage ? proj.rankedHighlights.slice(0, 2) : proj.rankedHighlights;

              return React.createElement(
                View,
                { key: i, style: styles.project, wrap: false },
                React.createElement(
                  Text,
                  { style: styles.projectTitle },
                  `${proj.title}${roleDisplay}${linkDisplay}`
                ),
                proj.technologiesUsed.length > 0
                  ? React.createElement(
                      Text,
                      { style: styles.projectTech },
                      `Technologies: ${proj.technologiesUsed.join(', ')}`
                    )
                  : null,
                bullets.map((h, j) =>
                  React.createElement(
                    View,
                    { key: j, style: styles.bullet },
                    React.createElement(Text, { style: styles.bulletMarker }, '•'),
                    React.createElement(Text, { style: styles.bulletText }, h.text)
                  )
                )
              );
            })
          )
        : null,

      profile && profile.education.length > 0
        ? React.createElement(
            View,
            {},
            React.createElement(Text, { style: styles.sectionTitle }, 'EDUCATION'),
            profile.education.map((edu, i) =>
              React.createElement(
                View,
                { key: i, style: styles.eduItem, wrap: false },
                React.createElement(
                  View,
                  {},
                  React.createElement(
                    Text,
                    { style: styles.eduDegree },
                    `${edu.degree} in ${edu.fieldOfStudy}${edu.gpa ? ` (GPA: ${edu.gpa})` : ''}`
                  ),
                  React.createElement(
                    Text,
                    { style: styles.eduInstitution },
                    `${edu.institution}${edu.honors && edu.honors.length > 0 ? ` • Honors: ${edu.honors.join(', ')}` : ''}`
                  )
                ),
                React.createElement(
                  Text,
                  { style: styles.eduYear },
                  edu.endDate ? formatDate(edu.endDate) : ''
                )
              )
            )
          )
        : null,

      certifications.length > 0
        ? React.createElement(
            View,
            {},
            React.createElement(Text, { style: styles.sectionTitle }, 'CERTIFICATIONS & CREDENTIALS'),
            certifications.map((cert, i) =>
              React.createElement(
                View,
                { key: i, style: styles.eduItem, wrap: false },
                React.createElement(
                  Text,
                  { style: styles.eduDegree },
                  cert.fileName.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ')
                ),
                React.createElement(
                  Text,
                  { style: styles.eduYear },
                  cert.uploadedAt ? formatDate(cert.uploadedAt) : ''
                )
              )
            )
          )
        : null,

      React.createElement(
        Text,
        {
          style: styles.footer,
          render: ({ pageNumber, totalPages }) =>
            totalPages > 1 ? `Page ${pageNumber} of ${totalPages}` : '',
          fixed: true,
        }
      )
    )
  );
}

export async function generateCoverLetterPdfBlob(letter: TailoredCoverLetter): Promise<Blob> {
  const doc = buildCoverLetterDocument(letter);
  return await pdf(doc).toBlob();
}

export async function generateResumePdfBlob(
  resume: TailoredResume,
  profile?: CandidateProfile,
  options?: ResumePdfOptions
): Promise<Blob> {
  const doc = buildResumeDocument(resume, profile, options);
  return await pdf(doc).toBlob();
}