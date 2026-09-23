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
    regex: /^(?:#+\s*)?(?:work\s+(?:history|experience)|experience|employment(?:\s+history)?|professional\s+(?:experience|history))\b/i,
  },
  {
    type: 'projects',
    regex: /^(?:#+\s*)?(?:projects|technical\s+projects|key\s+projects|personal\s+projects)\b/i,
  },
  {
    type: 'education',
    regex: /^(?:#+\s*)?(?:education|academic\s+background|qualifications|credentials)\b/i,
  },
  {
    type: 'skills',
    regex: /^(?:#+\s*)?(?:technical\s+skills|skills(?:\s+&\s+competencies)?|core\s+competencies|technologies)\b/i,
  },
  {
    type: 'summary',
    regex: /^(?:#+\s*)?(?:summary|professional\s+summary|about(?:\s+me)?|profile|objective)\b/i,
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
  const parts = dateText.split(/\s*(?:-|–|—|to)\s*/i);
  const now = new Date().toISOString().slice(0, 7);

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

  const startDate = parseSingleDate(startRaw) || now;
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
  const phoneMatch = fullText.match(/(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/);
  const linkedinMatch = fullText.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[A-Za-z0-9_-]+/i);
  const githubMatch = fullText.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/[A-Za-z0-9_-]+/i);
  const devtoMatch = fullText.match(/(?:https?:\/\/)?(?:www\.)?dev\.to\/[A-Za-z0-9_-]+/i);
  const allUrls = fullText.match(/https?:\/\/[^\s|)]+/g) || [];
  let portfolioUrl: string | undefined;
  for (const u of allUrls) {
    if (!/linkedin\.com|github\.com/i.test(u)) {
      portfolioUrl = u;
      break;
    }
  }
  if (!portfolioUrl && devtoMatch) {
    portfolioUrl = devtoMatch[0].startsWith('http') ? devtoMatch[0] : `https://${devtoMatch[0]}`;
  }

  // Extract name: first non-empty header line that is not an email, phone, or link
  let fullName = '';
  for (const hLine of sections.header) {
    const clean = hLine.replace(/^#+\s*/, '').trim();
    if (clean && !clean.includes('@') && !clean.includes('http') && !clean.includes('.com') && !/^\+?\d/.test(clean)) {
      fullName = clean;
      break;
    }
  }

  // Extract candidate location: inspect header lines for patterns like "City, Country"
  let candidateLocation: string | undefined;
  for (const hLine of sections.header) {
    const segments = hLine.split(/[|•·;]|\s+-\s+/);
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
      if (/^[A-Za-z\s.-]+,\s*[A-Za-z\s.-]+$/.test(cleanSeg)) {
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
    summary,
    experiences,
    projects,
    education,
    skills,
  };
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

  const isBullet = (l: string) => /^[-*•–—+]\s+/.test(l);
  const isDateLine = (l: string) => /\b(19\d\d|20\d\d)\b/i.test(l) && /\b(present|current|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d{4})\b/i.test(l);

  for (const line of lines) {
    const cleanLine = line.replace(/^#+\s*/, '').trim();

    if (isBullet(line)) {
      const bulletText = line.replace(/^[-*•–—+]\s+/, '').trim();
      if (current) {
        current.highlights.push(bulletText);
      }
      continue;
    }

    // Check if this line is just a date line for the active entry (e.g. "Feb 2026 – Aug 2026")
    if (current && isDateLine(cleanLine) && !current.dateText) {
      current.dateText = cleanLine;
      continue;
    }

    // Check if this line is an experience entry header (e.g., "Senior Software Engineer | Acme Corp | 2021 - Present" or "Software Engineer — CoreServe — Rust")
    if (
      cleanLine.includes('|') ||
      cleanLine.includes(' - ') ||
      cleanLine.includes(' — ') ||
      cleanLine.includes(' – ') ||
      cleanLine.includes(' at ') ||
      cleanLine.includes(' @ ')
    ) {
      commitCurrent();

      let title = '';
      let company = '';
      let dateText = '';
      let location: string | undefined;

      // Extract trailing or parenthesized date range e.g. (2019 - 2023)
      const parenDateMatch = cleanLine.match(/\(([^)]*(?:19\d\d|20\d\d)[^)]*)\)$/);
      let lineText = cleanLine;
      if (parenDateMatch && parenDateMatch[1]) {
        dateText = parenDateMatch[1].trim();
        lineText = cleanLine.replace(/\s*\([^)]+\)$/, '').trim();
      }

      if (lineText.includes('|')) {
        const segments = lineText.split('|').map((s) => s.trim());
        if (segments.length >= 2) {
          title = segments[0] ?? '';
          company = segments[1] ?? '';
          for (let i = 2; i < segments.length; i++) {
            const seg = segments[i] ?? '';
            if (isDateLine(seg)) {
              dateText = seg;
            } else if (!location) {
              location = seg;
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

    // If we have an active entry, treat unbulleted paragraph lines as highlights
    if (current) {
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

  const isBullet = (l: string) => /^[-*•–—+]\s+/.test(l);

  for (const line of lines) {
    const cleanLine = line.replace(/^#+\s*/, '').trim();

    if (isBullet(line)) {
      const bulletText = line.replace(/^[-*•–—+]\s+/, '').trim();
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

  for (const line of lines) {
    const clean = line.replace(/^[-*•#]\s*/, '').trim();
    if (!clean) continue;

    // e.g. "B.S. in Computer Science | Stanford University | 2018"
    let institution = '';
    let degree = '';
    let fieldOfStudy = '';
    let graduationDate: string | undefined;

    const dateMatch = clean.match(/\b(19\d\d|20\d\d)\b/);
    if (dateMatch) {
      graduationDate = `${dateMatch[1]}-05`;
    }

    if (clean.includes('|')) {
      const segments = clean.split('|').map((s) => s.trim());
      degree = segments[0] || 'Degree';
      institution = segments[1] || 'University';
      fieldOfStudy = segments[2] || '';
    } else if (clean.includes('—') || clean.includes('–')) {
      const parts = clean.split(/\s+[—–]\s+/).map((s) => s.trim());
      institution = parts[0] || 'Academic Institution';
      degree = parts[1] || 'Degree';
      if (degree.includes(',')) {
        const sub = degree.split(',').map((s) => s.trim());
        degree = sub[0] || degree;
        fieldOfStudy = sub.slice(1).join(', ') || fieldOfStudy;
      }
    } else {
      const degreeMatch = clean.match(/(bachelor|master|b\.?s\.?|m\.?s\.?|ph\.?d|b\.?a\.?|associate)\b.*?(?:in|of)\s+([A-Za-z\s]+)/i);
      if (degreeMatch && degreeMatch[2]) {
        degree = degreeMatch[0].trim();
        fieldOfStudy = degreeMatch[2].trim();
      } else {
        degree = clean;
      }
      institution = (clean.split(',')[0] ?? clean).trim();
    }

    results.push({
      institution: institution || 'Academic Institution',
      degree: degree || 'Degree',
      fieldOfStudy: fieldOfStudy || 'General Studies',
      graduationDate,
    });
  }

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
