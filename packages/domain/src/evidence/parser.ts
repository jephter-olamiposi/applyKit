/**
 * @fileoverview Deterministic resume and document parsing pipeline.
 *
 * Implements client-side structural parsing for plain-text and Markdown resumes.
 * Extracts candidate identity, professional summary, work history, projects,
 * education, and skills without sending untrusted candidate text to external LLMs.
 */

/**
 * Structured intermediate representation of a parsed resume document.
 */
export interface ParsedResumeDocument {
  /** Original unparsed plain text content of the resume. */
  readonly rawText: string;
  readonly identity: {
    readonly fullName: string;
    readonly email?: string;
    readonly phone?: string;
    readonly location?: string;
    readonly links: {
      readonly linkedin?: string;
      readonly github?: string;
      readonly portfolio?: string;
    };
  };
  readonly summary: string;
  readonly experiences: readonly ParsedExperience[];
  readonly projects: readonly ParsedProject[];
  readonly education: readonly ParsedEducation[];
  readonly skills: readonly string[];
  /** Text that could not be assigned safely to a canonical resume section. */
  readonly unclassifiedText: readonly string[];
  /** Review messages explaining fields that were left blank or kept conservative. */
  readonly reviewWarnings: readonly string[];
}

/**
 * Parsed professional employment record.
 */
export interface ParsedExperience {
  readonly company: string;
  readonly title: string;
  readonly location?: string;
  readonly startDate: string;
  readonly endDate?: string;
  readonly isCurrent: boolean;
  readonly highlights: readonly string[];
  readonly technologiesUsed: readonly string[];
}

/**
 * Parsed technical or portfolio project.
 */
export interface ParsedProject {
  readonly title: string;
  readonly description: string;
  readonly url?: string;
  readonly repoUrl?: string;
  readonly highlights: readonly string[];
  readonly technologiesUsed: readonly string[];
}

/**
 * Parsed academic education record.
 */
export interface ParsedEducation {
  readonly institution: string;
  readonly degree: string;
  readonly fieldOfStudy: string;
  readonly graduationDate?: string;
}

/**
 * Recognized high-level structural sections within a standard resume.
 */
type ResumeSectionType =
  | 'header'
  | 'summary'
  | 'experience'
  | 'projects'
  | 'education'
  | 'skills'
  | 'unknown';

const SECTION_PATTERNS: ReadonlyArray<{ type: ResumeSectionType; regex: RegExp }> = [
  {
    type: 'experience',
    regex: /^(?:#+\s*)?(?:work\s+(?:history|experience)|experience|employment(?:\s+history)?|professional\s+(?:experience|history)|career\s+history|career\s+background)\b/i,
  },
  {
    type: 'projects',
    regex: /^(?:#+\s*)?(?:projects|technical\s+projects|key\s+projects|personal\s+projects|explorations|selected\s+projects)\b/i,
  },
  {
    type: 'education',
    regex: /^(?:#+\s*)?(?:education|academic\s+background|academic\s+history|qualifications|credentials)\b/i,
  },
  {
    type: 'skills',
    regex: /^(?:#+\s*)?(?:technical\s+skills|skills(?:\s+&\s+competencies)?|core\s+competencies|technical\s+expertise|technologies)\b/i,
  },
  {
    type: 'summary',
    regex: /^(?:#+\s*)?(?:summary|professional\s+summary|about(?:\s+me)?|profile|objective|career\s+objective)\b/i,
  },
];

/** Common technical keywords for heuristic detection in bullet highlights. */
const COMMON_TECH_TERMS = [
  'TypeScript', 'JavaScript', 'Python', 'Go', 'Golang', 'Rust', 'Java', 'C\\+\\+', 'C#',
  'React', 'Next\\.js', 'Vue', 'Angular', 'Node\\.js', 'Express', 'NestJS', 'GraphQL', 'REST',
  'PostgreSQL', 'Postgres', 'MySQL', 'MongoDB', 'Redis', 'Cassandra', 'SQLite',
  'AWS', 'Azure', 'GCP', 'Docker', 'Kubernetes', 'Terraform', 'CI/CD', 'Git',
  'Kafka', 'RabbitMQ', 'Tailwind', 'Vite', 'Webpack', 'Vitest', 'Jest',
];

const TECH_REGEX = new RegExp(`\\b(${COMMON_TECH_TERMS.join('|')})\\b`, 'gi');

/**
 * Normalizes calendar month names to two-digit strings.
 */
function normalizeMonth(monthStr: string): string {
  const months: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  };
  const key = monthStr.slice(0, 3).toLowerCase();
  return months[key] ?? '01';
}

/**
 * Parses date ranges such as "Mar 2021 - Present" or "2019 - 2022" into ISO strings.
 */
function parseDateRange(dateText: string): { startDate: string; endDate?: string; isCurrent: boolean } {
  const parts = dateText.split(/\s*(?:-|–|—|\bto\b)\s*/i);

  const startRaw = parts[0]?.trim() || '';
  const endRaw = parts[1]?.trim() || '';

  const parseSingleDate = (raw: string): string => {
    const monthYear = raw.match(/([a-zA-Z]{3,9})\.?\s+(\d{4})/);
    if (monthYear && monthYear[1] && monthYear[2]) {
      return `${monthYear[2]}-${normalizeMonth(monthYear[1])}`;
    }
    const yearOnly = raw.match(/\b(19\d\d|20\d\d)\b/);
    if (yearOnly) {
      return `${yearOnly[1]}-01`;
    }
    return '';
  };

  const startDate = parseSingleDate(startRaw);
  const isCurrent = /present|current|now/i.test(endRaw) || (parts.length === 1 && /present|current/i.test(startRaw));
  const endDate = isCurrent ? undefined : (parseSingleDate(endRaw) || undefined);

  return { startDate, endDate, isCurrent };
}

/**
 * Extracts recognized technology tags from text using predefined keyword matching.
 */
function extractTechnologies(text: string): string[] {
  const matches = text.match(TECH_REGEX);
  if (!matches) return [];
  const normalized = new Set<string>();
  for (const m of matches) {
    // Preserve canonical casing for known technologies
    const lower = m.toLowerCase();
    if (lower === 'typescript') normalized.add('TypeScript');
    else if (lower === 'javascript') normalized.add('JavaScript');
    else if (lower === 'postgresql' || lower === 'postgres') normalized.add('PostgreSQL');
    else if (lower === 'react') normalized.add('React');
    else if (lower === 'node.js') normalized.add('Node.js');
    else if (lower === 'docker') normalized.add('Docker');
    else if (lower === 'aws') normalized.add('AWS');
    else if (lower === 'python') normalized.add('Python');
    else if (lower === 'rust') normalized.add('Rust');
    else normalized.add(m.trim());
  }
  return Array.from(normalized);
}

/**
 * Identifies the structural section for a given heading line.
 */
function identifySectionHeading(line: string): ResumeSectionType | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 80) return null;

  for (const { type, regex } of SECTION_PATTERNS) {
    if (regex.test(trimmed)) {
      return type;
    }
  }
  return null;
}

function splitHeaderLine(line: string): string[] {
  return line
    .replace(/^#+\s*/, '')
    .split(/\s*(?:\||•|·|;|\t)\s*/)
    .map((part) => part.replace(/^(?:name|full\s+name|candidate)\s*:\s*/i, '').trim())
    .filter(Boolean);
}

function looksLikePersonName(value: string): boolean {
  const candidate = value
    .replace(/^(?:name|full\s+name|candidate)\s*:\s*/i, '')
    .replace(/[,:]$/, '')
    .trim();
  const words = candidate.split(/\s+/);
  if (words.length < 2 || words.length > 5 || candidate.length > 80) return false;
  if (/\d|@|https?:\/\/|www\.|\.com\b|linkedin|github/i.test(candidate)) return false;
  if (/^(?:senior|staff|principal|lead|junior|engineer|developer|architect|designer|manager|analyst|consultant|resume|curriculum vitae|summary|experience|education|skills|remote|hybrid|onsite)\b/i.test(candidate)) {
    return false;
  }
  return words.every((word) => /^[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ.'-]*$/.test(word));
}

/**
 * Parses raw plain-text or Markdown resume text into a structured document representation.
 *
 * Invariant: All extraction is deterministic and client-side; no network calls or LLM prompts.
 *
 * @param rawText Unprocessed plain text or Markdown resume string.
 * @returns Parsed resume structure partitioned into canonical sections.
 */
export function parsePlainTextResume(rawText: string): ParsedResumeDocument {
  const lines = rawText.split(/\r?\n/);

  const sections: Record<ResumeSectionType, string[]> = {
    header: [],
    summary: [],
    experience: [],
    projects: [],
    education: [],
    skills: [],
    unknown: [],
  };

  let currentSection: ResumeSectionType = 'header';

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    const detected = identifySectionHeading(trimmed);
    if (detected) {
      currentSection = detected;
      continue;
    }

    sections[currentSection].push(trimmed);
  }

  // Parse Identity from Header and entire document
  const fullText = rawText;
  const emailMatch = fullText.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/);
  const phoneMatch = fullText.match(/(?:\+?\d[\d \t().-]{7,}\d|\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4})/);
  const linkedinMatch = fullText.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[A-Za-z0-9_-]+/i);
  const githubMatch = fullText.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/[A-Za-z0-9_-]+/i);
  const devtoMatch = fullText.match(/(?:https?:\/\/)?(?:www\.)?dev\.to\/[A-Za-z0-9_-]+/i);
  const allUrls = fullText.match(/https?:\/\/[^\s|)]+/g) || [];
  let portfolioUrl: string | undefined;
  for (const u of allUrls) {
    if (!/linkedin\.com|github\.com|docs\.google\.com|export\?/i.test(u)) {
      portfolioUrl = u;
      break;
    }
  }
  if (!portfolioUrl) {
    // Check for custom domain names without protocol, e.g. "tsegen.sh", "developer.dev", "johndoe.io"
    for (const hLine of sections.header) {
      const domainMatch = hLine.match(/\b([a-zA-Z0-9-]+\.(?:sh|dev|io|me|tech|app|co|xyz|net|org))\b/i);
      if (domainMatch && domainMatch[1] && !/github|gitlab|linkedin|gmail/i.test(domainMatch[1])) {
        portfolioUrl = `https://${domainMatch[1]}`;
        break;
      }
    }
  }
  if (!portfolioUrl && devtoMatch) {
    portfolioUrl = devtoMatch[0].startsWith('http') ? devtoMatch[0] : `https://${devtoMatch[0]}`;
  }

  // Prefer an explicit name or a contact-line segment so labels and contact details cannot become the name.
  let fullName = '';
  const headerSegments = sections.header.flatMap(splitHeaderLine);
  for (const segment of headerSegments) {
    if (looksLikePersonName(segment)) {
      fullName = segment;
      break;
    }
  }

  // Extract candidate location: inspect header lines for patterns like "City, Country"
  let candidateLocation: string | undefined;
  for (const hLine of sections.header) {
    const segments = splitHeaderLine(hLine);
    for (const seg of segments) {
      const cleanSeg = seg.trim();
      if (!cleanSeg) continue;
      if (
        cleanSeg.includes('@') ||
        /https?:\/\//i.test(cleanSeg) ||
        /github\.com|linkedin\.com/i.test(cleanSeg) ||
        /\b(?:engineer|developer|architect|designer|manager|lead|senior|junior|intern)\b/i.test(cleanSeg)
      ) {
        continue;
      }
      if (/^[A-Za-z\s.-]+,\s*[A-Za-z\s.-]+(?:,\s*[A-Za-z\s.-]+)?$/.test(cleanSeg)) {
        candidateLocation = cleanSeg;
        break;
      }
    }
    if (candidateLocation) break;
  }

  // Parse Summary
  const summary = sections.summary.join(' ').trim();

  // Parse Experience
  const experiences = parseExperiences(sections.experience);

  // Parse Projects
  const projects = parseProjects(sections.projects);

  // Parse Education
  const education = parseEducation(sections.education);

  // Parse Skills
  const skills = parseSkills(sections.skills, experiences, projects);
  const unclassifiedText = sections.unknown.filter((line) => line.trim().length > 0);
  const reviewWarnings: string[] = [];
  if (!fullName) reviewWarnings.push('Name could not be identified confidently.');
  if (!emailMatch) reviewWarnings.push('Email address could not be identified confidently.');
  if (experiences.some((experience) => !experience.startDate)) {
    reviewWarnings.push('One or more experience dates could not be identified; review them before saving.');
  }
  if (unclassifiedText.length > 0) {
    reviewWarnings.push('Some resume text was not assigned to a section and was preserved for review.');
  }

  return {
    identity: {
      fullName,
      email: emailMatch ? emailMatch[0] : undefined,
      phone: phoneMatch ? phoneMatch[0] : undefined,
      location: candidateLocation,
      links: {
        linkedin: linkedinMatch
          ? (linkedinMatch[0].startsWith('http') ? linkedinMatch[0] : `https://${linkedinMatch[0]}`)
          : undefined,
        github: githubMatch
          ? (githubMatch[0].startsWith('http') ? githubMatch[0] : `https://${githubMatch[0]}`)
          : undefined,
        portfolio: portfolioUrl,
      },
    },
    rawText,
    summary,
    experiences,
    projects,
    education,
    skills,
    unclassifiedText,
    reviewWarnings,
  };
}

/**
 * Detects employer sales marketing blurbs and company profile descriptions in resumes
 * (e.g. "Rocksteady Technology delivers enterprise-grade solutions... Partner with us to accelerate...")
 * to prevent them from being treated as candidate accomplishment highlights.
 */
function isCompanyMarketingBlurb(line: string, companyName?: string): boolean {
  const norm = line.toLowerCase();
  const marketingPhrases = [
    'delivers enterprise-grade',
    'partner with us',
    'digital transformation',
    'creator monetization platform',
    'software company delivering',
    'software company that delivers',
    'leading provider of',
    'is a platform that',
    'is a platform enabling',
    'is a software company',
    'is a software development',
    'is a leading',
    'is a global',
    'is an innovative',
    'helps organizations',
    'empowers businesses',
    'empowers challenger brands',
    'mission is to',
    'full-service digital agency',
    'specialize in web development',
    'delivers solutions across',
  ];

  for (const phrase of marketingPhrases) {
    if (norm.includes(phrase)) return true;
  }

  if (companyName && companyName !== 'Company') {
    const compLower = companyName.toLowerCase();
    if (
      norm.startsWith(`${compLower} is `) ||
      norm.startsWith(`${compLower} delivers `) ||
      norm.startsWith(`${compLower} empowers `) ||
      norm.startsWith(`${compLower} provides `)
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Parses raw text lines from the experience section into distinct work history records.
 */
function parseExperiences(lines: readonly string[]): ParsedExperience[] {
  const results: ParsedExperience[] = [];
  let current: {
    company: string;
    title: string;
    location?: string;
    dateText: string;
    highlights: string[];
  } | null = null;

  const commitCurrent = () => {
    if (current && (current.company || current.title)) {
      const { startDate, endDate, isCurrent } = parseDateRange(current.dateText);
      const allText = `${current.title} ${current.company} ${current.highlights.join(' ')}`;
      const technologiesUsed = extractTechnologies(allText);

      results.push({
        company: current.company || 'Company',
        title: current.title || 'Role',
        location: current.location,
        startDate,
        endDate,
        isCurrent,
        highlights: current.highlights,
        technologiesUsed,
      });
    }
    current = null;
  };

  const isBullet = (l: string) => /^[-*•●–—+]\s+/.test(l);
  const isDateLine = (l: string) => /\b(19\d\d|20\d\d)\b/i.test(l) && /\b(present|current|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d{4})\b/i.test(l);
  const ROLE_KEYWORD_REGEX = /\b(engineer|developer|architect|lead|manager|specialist|director|designer|analyst|consultant|founder|cto|vp|fellow|intern|officer|head)\b/i;

  for (const line of lines) {
    const cleanLine = line.replace(/^#+\s*/, '').trim();

    if (isBullet(line)) {
      const bulletText = line.replace(/^[-*•●–—+]\s+/, '').trim();
      if (current) {
        current.highlights.push(bulletText);
      }
      continue;
    }

    // Check if this line is a date line for an active entry
    if (current && isDateLine(cleanLine) && !current.dateText) {
      current.dateText = cleanLine;

      // In multi-line layouts, headers collected before the date line are title and company
      if (current.highlights.length > 0) {
        const headerLines = [...current.highlights];
        current.highlights = [];

        if (headerLines.length >= 2) {
          const first = headerLines[0]!;
          const second = headerLines[1]!;
          if (ROLE_KEYWORD_REGEX.test(first)) {
            current.title = first;
            current.company = second;
          } else {
            current.company = first;
            current.title = second;
          }
        } else if (headerLines.length === 1) {
          const single = headerLines[0]!;
          if (ROLE_KEYWORD_REGEX.test(single)) {
            current.title = single;
          } else {
            if (current.company && (ROLE_KEYWORD_REGEX.test(current.company) || current.title === 'Professional Experience')) {
              current.title = current.company;
            }
            current.company = single;
          }
        }
      }

      // Check if company string has role or remote location markers
      if (current.company && ROLE_KEYWORD_REGEX.test(current.company) && current.title === 'Professional Experience') {
        current.title = current.company;
        current.company = 'Company';
      }
      if (current.company && /remote/i.test(current.company)) {
        current.location = 'Remote';
        current.company = current.company.replace(/\s*remote\s*/i, '').trim();
      }
      continue;
    }

    // Check if this line is an experience entry header (e.g., "Senior Software Engineer | Acme Corp | 2021 - Present" or "Software Engineer — CoreServe — Rust")
    if (
      !isBullet(line) &&
      (cleanLine.includes('|') ||
        cleanLine.includes(' - ') ||
        cleanLine.includes(' — ') ||
        cleanLine.includes(' – ') ||
        cleanLine.includes(' at ') ||
        cleanLine.includes(' @ '))
    ) {
      commitCurrent();

      let title = '';
      let company = '';
      let dateText = '';
      let location: string | undefined;

      // Extract trailing or parenthesized date range e.g. (2019 - 2023)
      const parenDateMatch = cleanLine.match(/\(([^)]*(?:19\d\d|20\d\d)[^)]*)\)/);
      let lineText = cleanLine;
      if (parenDateMatch && parenDateMatch[1]) {
        dateText = parenDateMatch[1].trim();
        lineText = cleanLine.replace(parenDateMatch[0], '').trim();
      }

      if (lineText.includes('|')) {
        const segments = lineText.split('|').map((s) => s.trim());
        if (segments.length >= 2) {
          // Check if any segment is a date range
          let dateSegmentIndex = -1;
          for (let i = 1; i < segments.length; i++) {
            if (isDateLine(segments[i]!)) {
              dateSegmentIndex = i;
              dateText = segments[i]!;
              break;
            }
          }

          const firstSeg = segments[0] ?? '';
          const atMatchInFirst = firstSeg.match(/^(.*?)\s+(?:at|@)\s+(.*?)$/i);
          const dashSegments = firstSeg.split(/\s+[—–-]\s+/);
          if (dashSegments.length >= 2 && dashSegments[0] && dashSegments[1] && ROLE_KEYWORD_REGEX.test(dashSegments[0])) {
            title = dashSegments[0].trim();
            company = dashSegments[1].trim();
          } else if (atMatchInFirst && atMatchInFirst[1] && atMatchInFirst[2]) {
            // e.g. "Senior Software Engineer @ Rocksteady Technologies | July 2025 - Present"
            title = atMatchInFirst[1].trim();
            company = atMatchInFirst[2].trim();
          } else if (dateSegmentIndex === 1) {
            const isRoleFirst = ROLE_KEYWORD_REGEX.test(firstSeg);
            if (isRoleFirst) {
              title = firstSeg;
              company = 'Company';
            } else {
              company = firstSeg;
              title = 'Software Engineer';
            }
          } else {
            const isFirstRole = ROLE_KEYWORD_REGEX.test(firstSeg);
            const otherSeg = segments[1] ?? 'Company';
            const isOtherRole = ROLE_KEYWORD_REGEX.test(otherSeg);
            if (isOtherRole && !isFirstRole) {
              company = firstSeg;
              title = otherSeg;
            } else {
              title = firstSeg;
              company = otherSeg;
            }
          }

          // Check remaining segments for location
          for (let i = 1; i < segments.length; i++) {
            if (i !== dateSegmentIndex) {
              const seg = segments[i]!;
              if (!location && !seg.includes('@') && !isDateLine(seg) && seg !== company) {
                location = seg;
              }
            }
          }
        }
      } else {
        // e.g. "Software Engineer at Google"
        const atMatch = lineText.match(/^(.*?)\s+(?:at|@)\s+(.*?)$/i);
        if (atMatch && atMatch[1] && atMatch[2]) {
          title = atMatch[1].trim();
          company = atMatch[2].trim();
        } else {
          // e.g. "Software Engineer — CoreServe — Rust" or "Google - Tech Lead" or "Acme Corp - Senior Engineer"
          const dashSegments = lineText.split(/\s+[—–-]\s+/);
          if (dashSegments.length >= 2 && dashSegments[0] && dashSegments[1]) {
            const isRoleFirst = /engineer|developer|architect|lead|manager|specialist|director|designer|analyst|consultant/i.test(dashSegments[0]);
            if (isRoleFirst) {
              title = dashSegments[0].trim();
              company = dashSegments[1].trim();
            } else {
              title = dashSegments[1].trim();
              company = dashSegments[0].trim();
            }
          }
        }
      }

      current = {
        company,
        title,
        location,
        dateText,
        highlights: [],
      };
      continue;
    }

    // Multi-line layouts: if an active entry has no highlights yet, check if this unbulleted line is the complementary role or company
    if (current && current.highlights.length === 0 && !isBullet(line) && cleanLine.length < 60) {
      if (ROLE_KEYWORD_REGEX.test(cleanLine) && current.title === 'Software Engineer') {
        current.title = cleanLine;
        continue;
      }
      if (current.company === 'Company' && !ROLE_KEYWORD_REGEX.test(cleanLine)) {
        current.company = cleanLine;
        continue;
      }
    }

    // Check if an unbulleted line is a brand new role title without delimiters after an active entry already has highlights and dates
    if (current && current.dateText && current.highlights.length > 0 && ROLE_KEYWORD_REGEX.test(cleanLine) && cleanLine.length < 60) {
      commitCurrent();
      current = {
        company: 'Company',
        title: cleanLine,
        dateText: '',
        highlights: [],
      };
      continue;
    }

    // If we have an active entry, check if this line is an employer marketing blurb before treating as highlight
    if (current) {
      if (isCompanyMarketingBlurb(cleanLine, current.company)) {
        continue;
      }
      current.highlights.push(cleanLine);
    } else {
      // Start a fallback entry if orphan line encountered
      current = {
        company: cleanLine,
        title: 'Professional Experience',
        dateText: '',
        highlights: [],
      };
    }
  }

  commitCurrent();
  return results;
}

/**
 * Parses raw text lines from the project section into structured project records.
 */
function parseProjects(lines: readonly string[]): ParsedProject[] {
  const results: ParsedProject[] = [];
  let current: {
    title: string;
    description: string;
    url?: string;
    repoUrl?: string;
    highlights: string[];
  } | null = null;

  const commitCurrent = () => {
    if (current && current.title) {
      const allText = `${current.title} ${current.description} ${current.highlights.join(' ')}`;
      const technologiesUsed = extractTechnologies(allText);

      results.push({
        title: current.title,
        description: current.description || current.highlights[0] || '',
        url: current.url,
        repoUrl: current.repoUrl,
        highlights: current.highlights,
        technologiesUsed,
      });
    }
    current = null;
  };

  const isBullet = (l: string) => /^[-*•●–—+]\s+/.test(l);

  for (const line of lines) {
    const cleanLine = line.replace(/^#+\s*/, '').trim();
    if (!cleanLine) continue;

    // Skip conversational project section introductory/flavor text
    if (/^(?:these\s+are\s+a\s+few\s+projects|selected\s+(?:personal\s+|open[- ]source\s+)?projects|personal\s+projects\s+worked\s+on|a\s+selection\s+of\s+projects)/i.test(cleanLine)) {
      continue;
    }

    if (isBullet(line)) {
      const bulletText = line.replace(/^[-*•●–—+]\s+/, '').trim();
      // Check if this bullet line is a self-contained project entry e.g. "* wsblast (Rust) — Built a high-performance..."
      const projectBulletMatch = bulletText.match(/^([A-Za-z0-9\s._-]+(?:\s*\([^)]+\))?)\s+[—–-]\s+(.*)$/);
      if (projectBulletMatch && projectBulletMatch[1] && projectBulletMatch[2]) {
        commitCurrent();
        const projectTitle = projectBulletMatch[1].trim();
        const projectDesc = projectBulletMatch[2].trim();
        current = {
          title: projectTitle,
          description: projectDesc,
          highlights: [projectDesc],
        };
        continue;
      }

      if (current) {
        current.highlights.push(bulletText);
      }
      continue;
    }

    // Check if line is a standalone URL for the active project
    const lineUrlMatch = cleanLine.match(/^https?:\/\/[^\s)]+/);
    if (lineUrlMatch && current) {
      if (lineUrlMatch[0].includes('github.com')) {
        current.repoUrl = lineUrlMatch[0];
      } else {
        current.url = lineUrlMatch[0];
      }
      continue;
    }

    // New project headline detected
    if (!current || cleanLine.includes('|') || cleanLine.startsWith('**') || /^[\w\s]{2,40}$/.test(cleanLine)) {
      commitCurrent();

      const urlMatch = cleanLine.match(/https?:\/\/[^\s)]+/);
      const repoUrl = urlMatch && urlMatch[0].includes('github.com') ? urlMatch[0] : undefined;
      const liveUrl = urlMatch && !urlMatch[0].includes('github.com') ? urlMatch[0] : undefined;

      const titleSegment = cleanLine.split('|')[0] ?? cleanLine;
      const title = titleSegment.replace(/[*_#]/g, '').trim();

      current = {
        title,
        description: '',
        url: liveUrl,
        repoUrl,
        highlights: [],
      };
      continue;
    }

    if (current) {
      if (!current.description) {
        current.description = cleanLine;
      } else {
        current.highlights.push(cleanLine);
      }
    }
  }

  commitCurrent();
  return results;
}

/**
 * Parses raw text lines from the education section into academic records.
 */
function parseEducation(lines: readonly string[]): ParsedEducation[] {
  const results: ParsedEducation[] = [];
  const DEGREE_REGEX = /\b(bachelor|master|b\.?s\.?|m\.?s\.?|ph\.?d|b\.?a\.?|associate|doctor|diploma)\b/i;
  const isDateOnlyLine = (l: string) => /\b(19\d\d|20\d\d)\b/i.test(l) && !/[a-zA-Z]{5,}/.test(l.replace(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/i, ''));

  let current: {
    institution: string;
    degree: string;
    fieldOfStudy: string;
    graduationDate?: string;
  } | null = null;

  const commitCurrent = () => {
    if (current && (current.institution || current.degree)) {
      results.push({
        institution: current.institution || 'Academic Institution',
        degree: current.degree || 'Degree',
        fieldOfStudy: current.fieldOfStudy || 'General Studies',
        graduationDate: current.graduationDate,
      });
    }
    current = null;
  };

  for (const line of lines) {
    const clean = line.replace(/^[-*•#]\s*/, '').trim();
    if (!clean) continue;

    // Single-line pipe or dash format e.g. "B.S. in Computer Science | Stanford University | 2018"
    if (clean.includes('|') || clean.includes('—') || clean.includes('–')) {
      commitCurrent();

      let institution = '';
      let degree = '';
      let fieldOfStudy = '';
      let graduationDate: string | undefined;

      const dateMatch = clean.match(/\b(19\d\d|20\d\d)\b/);
      if (dateMatch && dateMatch[1]) {
        graduationDate = `${dateMatch[1]}-05`;
      }

      if (clean.includes('|')) {
        const segments = clean.split('|').map((s) => s.trim());
        degree = segments[0] || 'Degree';
        institution = segments[1] || 'University';
        fieldOfStudy = segments[2] || '';
      } else {
        const parts = clean.split(/\s+[—–]\s+/).map((s) => s.trim());
        institution = parts[0] || 'Academic Institution';
        degree = parts[1] || 'Degree';
        if (degree.includes(',')) {
          const sub = degree.split(',').map((s) => s.trim());
          degree = sub[0] || degree;
          fieldOfStudy = sub.slice(1).join(', ') || fieldOfStudy;
        }
      }

      results.push({
        institution: institution || 'Academic Institution',
        degree: degree || 'Degree',
        fieldOfStudy: fieldOfStudy || 'General Studies',
        graduationDate,
      });
      continue;
    }

    // New degree line detected e.g. "B.S. in Computer Science"
    if (DEGREE_REGEX.test(clean)) {
      commitCurrent();

      let fieldOfStudy = '';
      const fieldMatch = clean.match(/(?:in|of)\s+([A-Za-z\s]+)/i);
      if (fieldMatch && fieldMatch[1]) {
        fieldOfStudy = fieldMatch[1].trim();
      }

      current = {
        degree: clean,
        institution: '',
        fieldOfStudy,
      };
      continue;
    }

    // Date-only line e.g. "May 2021"
    if (isDateOnlyLine(clean)) {
      const yearMatch = clean.match(/\b(19\d\d|20\d\d)\b/);
      if (yearMatch && yearMatch[1] && current) {
        current.graduationDate = `${yearMatch[1]}-05`;
      }
      continue;
    }

    // Institution line or honors line
    if (current && !current.institution) {
      current.institution = clean.replace(/\s*honors:.*$/i, '').trim();
    } else if (!current) {
      current = {
        institution: clean,
        degree: 'Degree',
        fieldOfStudy: 'General Studies',
      };
    }
  }

  commitCurrent();
  return results;
}

/**
 * Extracts and consolidates skills from skills section and cross-references them with experiences/projects.
 */
function parseSkills(
  skillLines: readonly string[],
  experiences: readonly ParsedExperience[],
  projects: readonly ParsedProject[]
): string[] {
  const skillSet = new Set<string>();

  for (const line of skillLines) {
    const clean = line.replace(/^[-*•#]\s*/, '').replace(/^[A-Za-z0-9\s&/_-]+:\s*/, '');
    const tokens = clean.split(/[,;|•]/).map((s) => s.trim()).filter((s) => s.length > 1);
    for (const t of tokens) {
      skillSet.add(t);
    }
  }

  // Cross-reference technologies discovered in experiences and projects
  for (const exp of experiences) {
    for (const tech of exp.technologiesUsed) {
      skillSet.add(tech);
    }
  }
  for (const proj of projects) {
    for (const tech of proj.technologiesUsed) {
      skillSet.add(tech);
    }
  }

  return Array.from(skillSet);
}
