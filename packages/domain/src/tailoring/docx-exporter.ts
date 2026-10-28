/**
 * @fileoverview Publication-Grade Microsoft Word (.docx) Exporter for Tailored Resumes and Cover Letters.
 *
 * Implements high-fidelity, ATS-optimized Word document generation following ADR-0043 and SKILL.md.
 * Output documents are structured with native OpenXML paragraphs, right-aligned tab stops, domain skill
 * groupings, and native bullet lists. Because .docx files store structured text runs rather than vector
 * bounding boxes, they achieve near-100% parse rates across enterprise ATS platforms (Workday, Taleo,
 * Greenhouse, Lever, iCIMS, SmartRecruiters) while completely eliminating text collision artifacts.
 */

import {
  Document,
  Paragraph,
  TextRun,
  Packer,
  TabStopType,
  TabStopPosition,
  Tab,
  BorderStyle,
  AlignmentType,
  convertInchesToTwip,
} from 'docx';
import type { CandidateProfile } from '../candidate/profile.js';
import { getPreferredOrLegalName } from '../candidate/identity.js';
import { formatDegree, joinPresent, formatMonthYear, formatDateSpan, formatPlace } from './display-format.js';
import type {
  TailoredResume,
  TailoredCoverLetter,
  ResumeDocxOptions,
  ResumeTemplateId,
} from './tailoring-types.js';

/**
 * Styling theme configuration defining fonts, font sizes, colors, and line spacing for a DOCX template.
 * Sizes are specified in half-points (e.g. 20 = 10pt, 24 = 12pt, 40 = 20pt) per OpenXML specs.
 */
interface DocxThemeConfig {
  readonly font: string;
  readonly nameSize: number;
  readonly titleSize: number;
  readonly headingSize: number;
  readonly bodySize: number;
  readonly metaSize: number;
  readonly primaryColor: string;
  readonly accentColor: string;
  readonly textDark: string;
  readonly textMuted: string;
  readonly centerHeader: boolean;
  readonly sectionDividerBorder: boolean;
  readonly margins: {
    readonly top: number;
    readonly bottom: number;
    readonly left: number;
    readonly right: number;
  };
}

/**
 * Modern Clean theme: Crisp Calibri typography with deep navy accent bar.
 */
const modernTheme: DocxThemeConfig = {
  font: 'Calibri',
  nameSize: 40, // 20pt
  titleSize: 22, // 11pt
  headingSize: 21, // 10.5pt
  bodySize: 20, // 10pt
  metaSize: 18, // 9pt
  primaryColor: '0F172A',
  accentColor: '2563EB',
  textDark: '1E293B',
  textMuted: '64748B',
  centerHeader: false,
  sectionDividerBorder: true,
  margins: {
    top: convertInchesToTwip(0.65),
    bottom: convertInchesToTwip(0.65),
    left: convertInchesToTwip(0.75),
    right: convertInchesToTwip(0.75),
  },
};

/**
 * Classic Executive theme: Formal Times New Roman typography with centered header.
 */
const classicTheme: DocxThemeConfig = {
  font: 'Times New Roman',
  nameSize: 40,
  titleSize: 22,
  headingSize: 21,
  bodySize: 20,
  metaSize: 18,
  primaryColor: '111827',
  accentColor: '374151',
  textDark: '1F2937',
  textMuted: '4B5563',
  centerHeader: true,
  sectionDividerBorder: true,
  margins: {
    top: convertInchesToTwip(0.75),
    bottom: convertInchesToTwip(0.75),
    left: convertInchesToTwip(0.8),
    right: convertInchesToTwip(0.8),
  },
};

/**
 * Minimalist ATS theme: Ultra-clean Arial typography in pure monochrome with zero shading.
 */
const minimalistTheme: DocxThemeConfig = {
  font: 'Arial',
  nameSize: 38, // 19pt
  titleSize: 21,
  headingSize: 20,
  bodySize: 19, // 9.5pt
  metaSize: 17, // 8.5pt
  primaryColor: '000000',
  accentColor: '000000',
  textDark: '000000',
  textMuted: '333333',
  centerHeader: false,
  sectionDividerBorder: true,
  margins: {
    top: convertInchesToTwip(0.6),
    bottom: convertInchesToTwip(0.6),
    left: convertInchesToTwip(0.7),
    right: convertInchesToTwip(0.7),
  },
};

/**
 * Compact 1-Pager theme: Budgeted spacing and 9.5pt Calibri body text to enforce single-page limits.
 */
const compactTheme: DocxThemeConfig = {
  font: 'Calibri',
  nameSize: 34, // 17pt
  titleSize: 19, // 9.5pt
  headingSize: 18, // 9pt
  bodySize: 18, // 9pt
  metaSize: 16, // 8pt
  primaryColor: '0F172A',
  accentColor: '2563EB',
  textDark: '1E293B',
  textMuted: '64748B',
  centerHeader: false,
  sectionDividerBorder: true,
  margins: {
    top: convertInchesToTwip(0.45),
    bottom: convertInchesToTwip(0.45),
    left: convertInchesToTwip(0.55),
    right: convertInchesToTwip(0.55),
  },
};

/**
 * Resolves the theme configuration for the requested template identifier.
 */
function resolveDocxTheme(templateId?: ResumeTemplateId): DocxThemeConfig {
  switch (templateId) {
    case 'classic':
      return classicTheme;
    case 'minimalist':
      return minimalistTheme;
    case 'compact':
      return compactTheme;
    case 'modern':
    default:
      return modernTheme;
  }
}

/**
 * Formats an ISO 8601 date string into a clean "Mon YYYY" format for resume milestones.
 */
function formatDate(isoString?: string): string {
  return formatMonthYear(isoString);
}

/**
 * The candidate's name for a filename. A full preferred name ("Jeff Olaifa") wins; a
 * one-word preferred name ("Jephter") would drop the surname, so legal first and last
 * name are used instead.
 */
function filenameStem(profile?: CandidateProfile | null): string {
  if (!profile) return '';
  const clean = (part?: string) => (part ?? '').normalize('NFKD').replace(/[^\w\s-]+/g, '').trim().replace(/\s+/g, '_');
  const preferred = clean(profile.identity.preferredName);
  if (preferred.includes('_')) return preferred;
  return [clean(profile.identity.legalFirstName), clean(profile.identity.legalLastName)].filter(Boolean).join('_');
}

/**
 * Resume filename per the pipeline spec: the candidate's name and nothing else
 * ("Jephter_Olaifa_Resume.pdf"). The job goes in the folder name; see
 * {@link getApplicationFolderName}.
 */
export function getStandardResumeFilename(
  profile?: CandidateProfile | null,
  format: 'docx' | 'pdf' | 'md' | 'txt' = 'docx'
): string {
  const stem = filenameStem(profile);
  return `${stem ? `${stem}_` : ''}Resume.${format}`;
}

/**
 * Folder for one application's files, relative to Downloads: "ApplyKit/Monzo - Senior
 * Backend Engineer". Every tailored resume shares the same filename by design, so the
 * folder is what keeps one job's files from overwriting another's.
 */
export function getApplicationFolderName(companyName?: string, jobTitle?: string): string {
  const clean = (text?: string) =>
    (text ?? '').normalize('NFKD').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60).replace(/[. ]+$/, '');
  const company = /^unknown company$/i.test((companyName ?? '').trim()) ? '' : clean(companyName);
  const label = [company, clean(jobTitle)].filter(Boolean).join(' - ');
  return label ? `ApplyKit/${label}` : 'ApplyKit';
}

/**
 * Builds a styled section heading paragraph with optional bottom border divider.
 */
function createSectionHeading(title: string, theme: DocxThemeConfig): Paragraph {
  return new Paragraph({
    spacing: { before: 180, after: 70 },
    border: theme.sectionDividerBorder
      ? {
          bottom: {
            color: theme.accentColor,
            space: 3,
            style: BorderStyle.SINGLE,
            size: 6,
          },
        }
      : undefined,
    children: [
      new TextRun({
        text: title.toUpperCase(),
        bold: true,
        size: theme.headingSize,
        font: theme.font,
        color: theme.primaryColor,
      }),
    ],
  });
}

/**
 * Assembles an OpenXML Document representing a tailored candidate resume.
 */
function buildResumeDocxDocument(
  resume: TailoredResume,
  profile?: CandidateProfile,
  options?: ResumeDocxOptions
): Document {
  const isOnePage = options?.onePageFit ?? false;
  const templateId = options?.templateId || resume.templateId || (isOnePage ? 'compact' : 'modern');
  const theme = resolveDocxTheme(templateId);

  const candidateName = profile ? getPreferredOrLegalName(profile.identity) || 'Candidate' : 'Candidate';
  const candidateTitle =
    profile?.professional.currentTitle || profile?.professional.headline || resume.targetJobTitle;

  // Assemble Contact details
  const contactItems: string[] = [];
  if (profile?.identity.email) contactItems.push(profile.identity.email);
  if (profile?.identity.phone) contactItems.push(profile.identity.phone);
  if (profile?.identity.location) {
    const loc = formatPlace([profile.identity.location.city, profile.identity.location.stateOrProvince, profile.identity.location.country]);
    if (loc) contactItems.push(loc);
  }

  const cleanUrl = (url: string) => url.replace(/^https?:\/\/(?:www\.)?/, '').replace(/\/$/, '');
  const linkItems: string[] = [];
  if (profile?.links?.linkedin) linkItems.push(cleanUrl(profile.links.linkedin));
  if (profile?.links?.github) linkItems.push(cleanUrl(profile.links.github));
  if (profile?.links?.portfolio) linkItems.push(cleanUrl(profile.links.portfolio));

  const contactString = [...contactItems, ...linkItems].join(' • ');

  const children: Paragraph[] = [];

  // 1. Header Section
  children.push(
    new Paragraph({
      alignment: theme.centerHeader ? AlignmentType.CENTER : AlignmentType.LEFT,
      spacing: { before: 0, after: 40 },
      children: [
        new TextRun({
          text: candidateName,
          bold: true,
          size: theme.nameSize,
          font: theme.font,
          color: theme.primaryColor,
        }),
      ],
    })
  );

  children.push(
    new Paragraph({
      alignment: theme.centerHeader ? AlignmentType.CENTER : AlignmentType.LEFT,
      spacing: { before: 0, after: 50 },
      children: [
        new TextRun({
          text: candidateTitle,
          bold: true,
          size: theme.titleSize,
          font: theme.font,
          color: theme.accentColor,
        }),
      ],
    })
  );

  if (contactString) {
    children.push(
      new Paragraph({
        alignment: theme.centerHeader ? AlignmentType.CENTER : AlignmentType.LEFT,
        spacing: { before: 0, after: 40 },
        children: [
          new TextRun({
            text: contactString,
            size: theme.metaSize,
            font: theme.font,
            color: theme.textMuted,
          }),
        ],
      })
    );
  }

  // 2. Professional Summary
  children.push(createSectionHeading('Professional Summary', theme));
  children.push(
    new Paragraph({
      spacing: { before: 40, after: 100 },
      children: [
        new TextRun({
          text: resume.tailoredSummary,
          size: theme.bodySize,
          font: theme.font,
          color: theme.textDark,
        }),
      ],
    })
  );

  // 3. Technical Skills
  children.push(createSectionHeading('Technical Skills', theme));
  if (resume.skills.domainCategories && resume.skills.domainCategories.length > 0) {
    for (const cat of resume.skills.domainCategories) {
      children.push(
        new Paragraph({
          spacing: { before: 20, after: 40 },
          children: [
            new TextRun({
              text: `${cat.category}: `,
              bold: true,
              size: theme.bodySize,
              font: theme.font,
              color: theme.primaryColor,
            }),
            new TextRun({
              text: cat.skills.join(', '),
              size: theme.bodySize,
              font: theme.font,
              color: theme.textDark,
            }),
          ],
        })
      );
    }
  } else {
    if (resume.skills.matchedRequired.length > 0) {
      children.push(
        new Paragraph({
          spacing: { before: 20, after: 30 },
          children: [
            new TextRun({
              text: 'Core Competencies: ',
              bold: true,
              size: theme.bodySize,
              font: theme.font,
              color: theme.primaryColor,
            }),
            new TextRun({
              text: resume.skills.matchedRequired.join(', '),
              size: theme.bodySize,
              font: theme.font,
              color: theme.textDark,
            }),
          ],
        })
      );
    }
    if (resume.skills.matchedPreferred.length > 0) {
      children.push(
        new Paragraph({
          spacing: { before: 20, after: 30 },
          children: [
            new TextRun({
              text: 'Preferred Qualifications: ',
              bold: true,
              size: theme.bodySize,
              font: theme.font,
              color: theme.primaryColor,
            }),
            new TextRun({
              text: resume.skills.matchedPreferred.join(', '),
              size: theme.bodySize,
              font: theme.font,
              color: theme.textDark,
            }),
          ],
        })
      );
    }
    if (resume.skills.additionalSkills.length > 0) {
      const skillsToRender = isOnePage
        ? resume.skills.additionalSkills.slice(0, 10).join(', ')
        : resume.skills.additionalSkills.join(', ');
      children.push(
        new Paragraph({
          spacing: { before: 20, after: 40 },
          children: [
            new TextRun({
              text: 'Additional Proficiencies: ',
              bold: true,
              size: theme.bodySize,
              font: theme.font,
              color: theme.primaryColor,
            }),
            new TextRun({
              text: skillsToRender,
              size: theme.bodySize,
              font: theme.font,
              color: theme.textDark,
            }),
          ],
        })
      );
    }
  }

  // 4. Work Experience
  const experiencesToRender = isOnePage ? resume.experiences.slice(0, 3) : resume.experiences;
  if (experiencesToRender.length > 0) {
    children.push(createSectionHeading('Work Experience', theme));

    for (const exp of experiencesToRender) {
      const profileExp = profile?.experiences.find((pe) => pe.id === exp.experienceId);
      const dateRange = formatDateSpan(exp.startDate, exp.endDate, exp.isCurrent);
      const bullets = isOnePage ? exp.rankedHighlights.slice(0, 3) : exp.rankedHighlights;

      // Experience Heading with Right-Aligned Tab Stop
      children.push(
        new Paragraph({
          tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
          spacing: { before: 80, after: 30 },
          children: [
            new TextRun({
              text: exp.title,
              bold: true,
              size: theme.headingSize,
              font: theme.font,
              color: theme.primaryColor,
            }),
            new TextRun({
              text: joinPresent([exp.company, profileExp?.location]) ? ` | ${joinPresent([exp.company, profileExp?.location], ' | ')}` : '',
              size: theme.bodySize,
              font: theme.font,
              color: theme.textDark,
            }),
            new TextRun({ children: [new Tab()] }),
            new TextRun({
              text: dateRange,
              size: theme.metaSize,
              font: theme.font,
              color: theme.textMuted,
            }),
          ],
        })
      );

      // Accomplishment Highlights
      for (const highlight of bullets) {
        children.push(
          new Paragraph({
            bullet: { level: 0 },
            spacing: { before: 15, after: 25 },
            children: [
              new TextRun({
                text: highlight.text,
                size: theme.bodySize,
                font: theme.font,
                color: theme.textDark,
              }),
            ],
          })
        );
      }
    }
  }

  // 5. Notable Projects
  const projectsToRender = isOnePage ? resume.projects.slice(0, 1) : resume.projects;
  if (projectsToRender.length > 0) {
    children.push(createSectionHeading('Notable Projects', theme));

    for (const proj of projectsToRender) {
      const profileProj = profile?.projects.find((pp) => pp.id === proj.projectId);
      const linkUrl = profileProj?.url || profileProj?.repoUrl;
      const linkDisplay = linkUrl ? ` • ${cleanUrl(linkUrl)}` : '';
      const roleDisplay = proj.role ? ` (${proj.role})` : '';
      const bullets = isOnePage ? proj.rankedHighlights.slice(0, 2) : proj.rankedHighlights;

      children.push(
        new Paragraph({
          spacing: { before: 70, after: 20 },
          children: [
            new TextRun({
              text: `${proj.title}${roleDisplay}${linkDisplay}`,
              bold: true,
              size: theme.headingSize,
              font: theme.font,
              color: theme.primaryColor,
            }),
          ],
        })
      );

      if (proj.technologiesUsed.length > 0) {
        children.push(
          new Paragraph({
            spacing: { before: 0, after: 30 },
            children: [
              new TextRun({
                text: `Technologies: ${proj.technologiesUsed.join(', ')}`,
                size: theme.metaSize,
                font: theme.font,
                color: theme.textMuted,
              }),
            ],
          })
        );
      }

      for (const highlight of bullets) {
        children.push(
          new Paragraph({
            bullet: { level: 0 },
            spacing: { before: 15, after: 25 },
            children: [
              new TextRun({
                text: highlight.text,
                size: theme.bodySize,
                font: theme.font,
                color: theme.textDark,
              }),
            ],
          })
        );
      }
    }
  }

  // 6. Education
  if (profile && profile.education.length > 0) {
    children.push(createSectionHeading('Education', theme));

    for (const edu of profile.education) {
      const dateString = edu.endDate ? edu.endDate.slice(0, 4) : '';
      const honorsString = edu.honors && edu.honors.length > 0 ? ` • Honors: ${edu.honors.join(', ')}` : '';

      children.push(
        new Paragraph({
          tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
          spacing: { before: 60, after: 20 },
          children: [
            new TextRun({
              text: `${formatDegree(edu)}${edu.gpa ? ` (GPA: ${edu.gpa})` : ''}`,
              bold: true,
              size: theme.bodySize,
              font: theme.font,
              color: theme.primaryColor,
            }),
            new TextRun({ children: [new Tab()] }),
            new TextRun({
              text: dateString,
              size: theme.metaSize,
              font: theme.font,
              color: theme.textMuted,
            }),
          ],
        })
      );

      children.push(
        new Paragraph({
          spacing: { before: 0, after: 50 },
          children: [
            new TextRun({
              text: `${edu.institution}${honorsString}`,
              size: theme.metaSize,
              font: theme.font,
              color: theme.textDark,
            }),
          ],
        })
      );
    }
  }

  // 7. Certifications
  const certifications = profile?.documents?.filter(
    (d) => d.documentType === 'certification_credential'
  ) || [];

  if (certifications.length > 0) {
    children.push(createSectionHeading('Certifications & Credentials', theme));

    for (const cert of certifications) {
      const dateString = cert.uploadedAt ? formatDate(cert.uploadedAt) : '';
      const certName = cert.fileName.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');

      children.push(
        new Paragraph({
          tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
          spacing: { before: 40, after: 30 },
          children: [
            new TextRun({
              text: certName,
              bold: true,
              size: theme.bodySize,
              font: theme.font,
              color: theme.primaryColor,
            }),
            new TextRun({ children: [new Tab()] }),
            new TextRun({
              text: dateString,
              size: theme.metaSize,
              font: theme.font,
              color: theme.textMuted,
            }),
          ],
        })
      );
    }
  }

  return new Document({
    sections: [
      {
        properties: {
          page: {
            margin: theme.margins,
          },
        },
        children,
      },
    ],
  });
}

/**
 * Assembles an OpenXML Document representing a tailored cover letter.
 */
function buildCoverLetterDocxDocument(letter: TailoredCoverLetter, profile?: CandidateProfile): Document {
  const theme = modernTheme;
  const candidateName = profile ? getPreferredOrLegalName(profile.identity) || letter.candidateName : letter.candidateName;

  const children: Paragraph[] = [];

  // Header
  children.push(
    new Paragraph({
      spacing: { before: 0, after: 30 },
      children: [
        new TextRun({
          text: candidateName,
          bold: true,
          size: 36,
          font: theme.font,
          color: theme.primaryColor,
        }),
      ],
    })
  );

  const contactItems: string[] = [];
  if (profile?.identity.email) contactItems.push(profile.identity.email);
  if (profile?.identity.phone) contactItems.push(profile.identity.phone);
  if (profile?.identity.location) {
    const loc = formatPlace([profile.identity.location.city, profile.identity.location.country]);
    if (loc) contactItems.push(loc);
  }

  if (contactItems.length > 0) {
    children.push(
      new Paragraph({
        spacing: { before: 0, after: 120 },
        children: [
          new TextRun({
            text: contactItems.join(' • '),
            size: theme.metaSize,
            font: theme.font,
            color: theme.textMuted,
          }),
        ],
      })
    );
  }

  // Date
  children.push(
    new Paragraph({
      spacing: { before: 0, after: 80 },
      children: [
        new TextRun({
          text: new Date().toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }),
          size: theme.metaSize,
          font: theme.font,
          color: theme.textMuted,
        }),
      ],
    })
  );

  // Recipient
  children.push(
    new Paragraph({
      spacing: { before: 0, after: 120 },
      children: [
        new TextRun({
          text: `Hiring Team\n${letter.companyName}`,
          bold: true,
          size: theme.bodySize,
          font: theme.font,
          color: theme.primaryColor,
        }),
      ],
    })
  );

  // Salutation
  children.push(
    new Paragraph({
      spacing: { before: 0, after: 90 },
      children: [
        new TextRun({
          text: letter.greeting || 'Dear Hiring Team,',
          bold: true,
          size: theme.bodySize,
          font: theme.font,
          color: theme.primaryColor,
        }),
      ],
    })
  );

  // Opening Paragraph
  children.push(
    new Paragraph({
      spacing: { before: 0, after: 90 },
      children: [
        new TextRun({
          text: letter.openingParagraph,
          size: theme.bodySize,
          font: theme.font,
          color: theme.textDark,
        }),
      ],
    })
  );

  // Body Paragraphs
  for (const bodyP of letter.bodyParagraphs) {
    children.push(
      new Paragraph({
        spacing: { before: 0, after: 90 },
        children: [
          new TextRun({
            text: bodyP.paragraphText,
            size: theme.bodySize,
            font: theme.font,
            color: theme.textDark,
          }),
        ],
      })
    );
  }

  // Closing Paragraph
  children.push(
    new Paragraph({
      spacing: { before: 0, after: 140 },
      // Word ignores "\n" inside a run, so the sign-off used to run on one line:
      // "Thanks for reading. Best, Jephter". Each line gets its own break instead.
      children: letter.closingParagraph.split('\n').map(
        (line, index) =>
          new TextRun({
            text: line,
            break: index > 0 ? 1 : 0,
            size: theme.bodySize,
            font: theme.font,
            color: theme.textDark,
          })
      ),
    })
  );

  return new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(0.8),
              bottom: convertInchesToTwip(0.8),
              left: convertInchesToTwip(0.9),
              right: convertInchesToTwip(0.9),
            },
          },
        },
        children,
      },
    ],
  });
}

/**
 * Generates a standard Microsoft Word (.docx) document as a Blob for a tailored candidate resume.
 *
 * @param resume The tailored resume aggregate.
 * @param profile Candidate profile providing contact info, links, and education.
 * @param options Styling and layout options.
 * @returns Promise resolving to a binary DOCX Blob.
 */
export async function generateResumeDocxBlob(
  resume: TailoredResume,
  profile?: CandidateProfile,
  options?: ResumeDocxOptions
): Promise<Blob> {
  const doc = buildResumeDocxDocument(resume, profile, options);
  return await Packer.toBlob(doc);
}

/**
 * Generates a standard Microsoft Word (.docx) document as a Blob for an evidence-grounded cover letter.
 *
 * @param letter The tailored cover letter aggregate.
 * @param profile Optional candidate profile providing contact info.
 * @returns Promise resolving to a binary DOCX Blob.
 */
export async function generateCoverLetterDocxBlob(
  letter: TailoredCoverLetter,
  profile?: CandidateProfile
): Promise<Blob> {
  const doc = buildCoverLetterDocxDocument(letter, profile);
  return await Packer.toBlob(doc);
}

/**
 * Cover letter filename in the same shape as the resume's ("Jephter_Olaifa_Cover_Letter.pdf").
 */
export function getStandardCoverLetterFilename(
  profile?: CandidateProfile | null,
  extension: 'docx' | 'pdf' | 'txt' = 'docx'
): string {
  return `${filenameStem(profile) || 'Candidate'}_Cover_Letter.${extension}`;
}
