/**
 * @fileoverview Deterministic resume and document parsing pipeline.
 *
 * Implements client-side structural parsing for plain-text and Markdown resumes.
 * Extracts candidate identity, professional summary, work history, projects,
 * education, and skills without sending untrusted candidate text to external LLMs.
 */

import { findPlaces, isEmptyPlaceSet } from '../job/geo-regions.js';

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

/**
 * Technologies recognized in experience and project text, keyed by canonical spelling.
 *
 * Each pattern is anchored on word boundaries and written so that a longer name is never
 * credited as a shorter one: "React Native" must not produce "React", and the English
 * verb "go" must not produce the Go language. Inventing a skill the candidate never
 * listed would break the evidence-backed claims invariant.
 */
const TECHNOLOGY_PATTERNS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: 'TypeScript', pattern: /\btypescript\b/i },
  { name: 'JavaScript', pattern: /\bjavascript\b/i },
  { name: 'Python', pattern: /\bpython\b/i },
  { name: 'Go', pattern: /\bGo\b(?![-\s](?:to|live|ahead|back|through|over|out|beyond)\b)|\b[Gg]olang\b/ },
  { name: 'Rust', pattern: /\bRust\b/ },
  { name: 'Java', pattern: /\bJava\b(?!\s*Script)/ },
  { name: 'Kotlin', pattern: /\bkotlin\b/i },
  { name: 'Swift', pattern: /\bSwift\b/ },
  { name: 'Dart', pattern: /\bDart\b/ },
  { name: 'Flutter', pattern: /\bflutter\b/i },
  { name: 'C++', pattern: /(?:^|[^\w])C\+\+(?!\w)/ },
  { name: 'C#', pattern: /(?:^|[^\w])C#(?!\w)/ },
  { name: 'PHP', pattern: /\bPHP\b/ },
  { name: 'Ruby', pattern: /\bRuby\b/ },
  { name: 'React Native', pattern: /\breact[\s-]native\b/i },
  { name: 'React', pattern: /\breact(?:\.js|js)?\b(?![\s-]native)/i },
  { name: 'Next.js', pattern: /\bnext\.js\b|\bnextjs\b/i },
  { name: 'Vue', pattern: /\bvue(?:\.js)?\b/i },
  { name: 'Angular', pattern: /\bangular\b/i },
  { name: 'Node.js', pattern: /\bnode(?:\.js|js)\b/i },
  { name: 'Express', pattern: /\bExpress(?:\.js)?\b/ },
  { name: 'NestJS', pattern: /\bnest(?:js|\.js)\b/i },
  { name: 'Django', pattern: /\bdjango\b/i },
  { name: 'FastAPI', pattern: /\bfastapi\b/i },
  { name: 'Spring', pattern: /\bSpring(?: Boot)?\b/ },
  { name: 'Laravel', pattern: /\blaravel\b/i },
  { name: 'Tauri', pattern: /\btauri\b/i },
  { name: 'Electron', pattern: /\bElectron\b/ },
  { name: 'GraphQL', pattern: /\bgraphql\b/i },
  { name: 'gRPC', pattern: /\bgrpc\b/i },
  { name: 'REST', pattern: /\bREST(?:ful)?\b/ },
  { name: 'WebSockets', pattern: /\bweb\s?sockets?\b/i },
  { name: 'PostgreSQL', pattern: /\bpostgres(?:ql)?\b/i },
  { name: 'MySQL', pattern: /\bmysql\b/i },
  { name: 'MongoDB', pattern: /\bmongo(?:db)?\b/i },
  { name: 'Redis', pattern: /\bredis\b/i },
  { name: 'Cassandra', pattern: /\bcassandra\b/i },
  { name: 'SQLite', pattern: /\bsqlite\b/i },
  { name: 'Elasticsearch', pattern: /\belasticsearch\b/i },
  { name: 'AWS', pattern: /\bAWS\b|\bamazon web services\b/i },
  { name: 'Azure', pattern: /\bazure\b/i },
  { name: 'GCP', pattern: /\bGCP\b|\bgoogle cloud\b/i },
  { name: 'Docker', pattern: /\bdocker\b/i },
  { name: 'Kubernetes', pattern: /\bkubernetes\b|\bk8s\b/i },
  { name: 'Terraform', pattern: /\bterraform\b/i },
  { name: 'CI/CD', pattern: /\bCI\/CD\b/i },
  { name: 'Git', pattern: /\bGit\b/ },
  { name: 'Kafka', pattern: /\bkafka\b/i },
  { name: 'RabbitMQ', pattern: /\brabbitmq\b/i },
  { name: 'NATS', pattern: /\bNATS\b/ },
  { name: 'Tailwind', pattern: /\btailwind\b/i },
  { name: 'Vite', pattern: /\bVite\b/ },
  { name: 'Webpack', pattern: /\bwebpack\b/i },
  { name: 'Vitest', pattern: /\bvitest\b/i },
  { name: 'Jest', pattern: /\bJest\b/ },
  { name: 'Heroku', pattern: /\bheroku\b/i },
  { name: 'Linux', pattern: /\blinux\b/i },
];

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
export function extractTechnologies(text: string): string[] {
  return TECHNOLOGY_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(({ name }) => name);
}

/**
 * Identifies the structural section for a given heading line.
 */
function identifySectionHeading(line: string): ResumeSectionType | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 80) return null;
  // Headings start with a capital (or "#") and do not end a sentence. Without this, the
  // tail of a wrapped bullet ("projects.") switched the parser into the Projects section.
  if (/^[a-z]/.test(trimmed) || /\.$/.test(trimmed)) return null;

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
  const lines = joinWrappedBulletLines(rawText.split(/\r?\n/));

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

  if (companyName) {
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


const MONTH_PATTERN = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
const DATE_RANGE_REGEX = new RegExp(
  `(?:${MONTH_PATTERN}\\s+)?(?:19|20)\\d\\d\\s*(?:[-–—]|to)\\s*(?:(?:${MONTH_PATTERN}\\s+)?(?:19|20)\\d\\d|present|current|now)`,
  'i'
);

/** True when a header segment holds nothing but a date or date range. */
function isPureDateText(text: string): boolean {
  const residue = text
    .replace(new RegExp(MONTH_PATTERN, 'gi'), '')
    .replace(/(?:19|20)\d\d|present|current|now|to|[-–—\s,./()]/gi, '');
  return /(?:19|20)\d\d/.test(text) && residue.length === 0;
}

const ROLE_TITLE_REGEX = /\b(engineer|developer|programmer|architect|lead|manager|specialist|director|designer|analyst|consultant|founder|co-founder|cto|ceo|vp|fellow|intern|officer|head|scientist|administrator|technician|associate|assistant|coordinator|researcher|contractor|freelancer|sre|devops)\b/i;

const LOCATION_HINT_REGEX = /^(?:remote|hybrid|on[- ]?site|onsite|worldwide|anywhere)\b|\b(?:remote|hybrid)$/i;

/**
 * Splits an experience heading into role, employer, and location without inventing any
 * of them. Resumes write the same facts in many orders ("Title, Company (City)",
 * "Company | Title", "Title at Company", "Title - Company - Remote"), so each piece is
 * classified by its content rather than its position. A piece that cannot be classified
 * is left empty for the candidate to review instead of being filled with a placeholder.
 */
export function parseRoleHeader(segments: readonly string[]): {
  title: string;
  company: string;
  location?: string;
  dateText?: string;
  /** A stack tag on the heading ("Software Engineer — CoreServe — Rust"). */
  stack?: string;
} {
  const pieces: string[] = [];
  let location: string | undefined;
  let dateText: string | undefined;

  for (const raw of segments) {
    let text = raw.trim();
    const range = text.match(DATE_RANGE_REGEX);
    if (range) {
      dateText = dateText ?? range[0].trim();
      text = `${text.slice(0, range.index)} ${text.slice((range.index ?? 0) + range[0].length)}`.replace(/[\s•·,|—–-]+$/, '').trim();
    }
    const paren = text.match(/\(([^)]+)\)\s*$/);
    if (paren && paren[1]) {
      if (/\b(19|20)\d\d\b/.test(paren[1])) {
        dateText = dateText ?? paren[1].trim();
      } else if (!location) {
        location = paren[1].trim();
      }
      text = text.slice(0, paren.index).trim();
    }
    const atMatch = text.match(/^(.*?)\s+(?:at|@)\s+(.+)$/i);
    if (atMatch && atMatch[1] && atMatch[2] && ROLE_TITLE_REGEX.test(atMatch[1])) {
      pieces.push(atMatch[1].trim(), atMatch[2].trim());
      continue;
    }
    for (const dashPart of text.split(/\s+[—–-]\s+|\s*[•·]\s*/)) {
      const part = dashPart.trim();
      if (!part) continue;
      const comma = part.match(/^(.+?),\s+(.+)$/);
      if (comma && comma[1] && comma[2] && ROLE_TITLE_REGEX.test(comma[1]) && !ROLE_TITLE_REGEX.test(comma[2])) {
        pieces.push(comma[1].trim(), comma[2].trim());
      } else {
        pieces.push(part);
      }
    }
  }

  let title = '';
  let company = '';
  let stack: string | undefined;
  for (const piece of pieces) {
    if (/\b(19|20)\d\d\b/.test(piece) || /\b(present|current)\b/i.test(piece) && piece.length < 30) {
      dateText = dateText ?? piece;
      continue;
    }
    if (LOCATION_HINT_REGEX.test(piece)) {
      location = location ?? piece;
      continue;
    }
    if (!title && ROLE_TITLE_REGEX.test(piece)) {
      title = piece;
      continue;
    }
    if (!company) {
      company = piece;
      continue;
    }
    if (!title) {
      title = piece;
      continue;
    }
    // A third segment is either the stack ("Rust", "Go, Kafka") or a place. Anything
    // that is neither is dropped: a capitalized word is not evidence of a location.
    if (isStackTag(piece)) {
      stack = stack ? `${stack}, ${piece}` : piece;
    } else if (!location && looksLikePlace(piece)) {
      location = piece;
    }
  }

  return { title, company, location, dateText, ...(stack ? { stack } : {}) };
}

/** True when every comma/slash/"and" separated part of `text` is a known technology. */
function isStackTag(text: string): boolean {
  const parts = text.split(/\s*(?:,|\/|&|\+|\band\b)\s*/i).filter(Boolean);
  return parts.length > 0 && parts.every((part) => extractTechnologies(part).length > 0 && part.length <= 30);
}

/** True for text that names a real place ("Lagos", "Remote (UK)", "Portland, OR"). */
function looksLikePlace(text: string): boolean {
  if (LOCATION_HINT_REGEX.test(text)) return true;
  return !isEmptyPlaceSet(findPlaces(text));
}

/** Bullet markers used across resume layouts. */
const BULLET_LINE = /^\s*[-*•●▪◦–—+]\s+/;

/**
 * Rejoins bullets that a PDF wrapped across several lines.
 *
 * Text pulled out of a PDF keeps the visual line breaks, so one bullet becomes
 * "Engineered a ... using Rust," / "Axum, Tokio, SQLx, and PostgreSQL." and each piece
 * looked like its own accomplishment (and the last wrap of a role could be mistaken for
 * the next employer's name). A line is a continuation when it follows bullet text that
 * has not ended its sentence, and is not itself a bullet, heading, date line, or role
 * heading. A line after a full stop is never joined, so real paragraphs stay apart.
 */
export function joinWrappedBulletLines(lines: readonly string[]): string[] {
  const out: string[] = [];
  let inBullet = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      out.push(raw);
      inBullet = false;
      continue;
    }
    const previous = out[out.length - 1]?.trimEnd() ?? '';
    const isContinuation =
      inBullet &&
      !BULLET_LINE.test(line) &&
      !identifySectionHeading(line) &&
      !isPureDateText(line) &&
      !DATE_RANGE_REGEX.test(line) &&
      !/\s[—–|]\s/.test(line) &&
      !/[.!?]["')\]]?$/.test(previous) &&
      // A short Title Case line after a bullet is usually the next employer or role
      // ("Andela"), not the rest of a sentence. Wrapped text starts lowercase, follows a
      // comma or a joining word, or runs long.
      (/^[a-z0-9(]/.test(line) ||
        /[,;:-]$/.test(previous) ||
        /\b(and|or|of|the|to|for|with|in|on|at|by|a|an|from|into|across|using|via)$/i.test(previous) ||
        line.length > 45);
    if (isContinuation) {
      // "lock-" + "free" stays "lock-free"; anything else gets a space.
      out[out.length - 1] = previous.endsWith('-') ? `${previous}${line}` : `${previous} ${line}`;
      continue;
    }
    out.push(raw);
    inBullet = BULLET_LINE.test(line);
  }
  return out;
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
    /** True when the newest highlight came from an unbulleted line, which may be the next employer's name. */
    plainTail?: boolean;
    /** Stack tag from the heading, counted as technologies used in this role. */
    stack?: string;
  } | null = null;

  const commitCurrent = () => {
    if (current && (current.company || current.title)) {
      const { startDate, endDate, isCurrent } = parseDateRange(current.dateText);
      const allText = `${current.title} ${current.company} ${current.stack ?? ''} ${current.highlights.join(' ')}`;
      const technologiesUsed = extractTechnologies(allText);

      results.push({
        company: current.company,
        title: current.title,
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
        current.plainTail = false;
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
            if (current.company && (ROLE_KEYWORD_REGEX.test(current.company) || !current.title)) {
              current.title = current.company;
            }
            current.company = single;
          }
        }
      }

      if (current.company && ROLE_KEYWORD_REGEX.test(current.company) && !current.title) {
        const reparsed = parseRoleHeader([current.company]);
        current.title = reparsed.title;
        current.company = reparsed.company;
        current.location = current.location ?? reparsed.location;
      }
      if (current.company && /\bremote\b/i.test(current.company)) {
        current.location = 'Remote';
        current.company = current.company.replace(/[\s,(-]*\bremote\b[)\s]*/i, '').trim();
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

      const segments = lineText.split(/\s*\|\s*/).map((segment) => segment.trim()).filter(Boolean);
      const headerSegments: string[] = [];
      for (const segment of segments) {
        if (!dateText && isPureDateText(segment)) {
          dateText = segment;
        } else {
          headerSegments.push(segment);
        }
      }
      const parsedHeader = parseRoleHeader(headerSegments);
      title = parsedHeader.title;
      company = parsedHeader.company;
      location = parsedHeader.location;
      if (!dateText && parsedHeader.dateText) dateText = parsedHeader.dateText;

      current = {
        company,
        title,
        location,
        dateText,
        highlights: [],
        ...(parsedHeader.stack ? { stack: parsedHeader.stack } : {}),
      };
      continue;
    }

    // Multi-line layouts: if an active entry has no highlights yet, check if this unbulleted line is the complementary role or company
    if (current && current.highlights.length === 0 && !isBullet(line) && cleanLine.length < 60) {
      if (ROLE_KEYWORD_REGEX.test(cleanLine) && !current.title) {
        current.title = cleanLine;
        continue;
      }
      if (!current.company && !ROLE_KEYWORD_REGEX.test(cleanLine)) {
        current.company = cleanLine;
        continue;
      }
    }

    // Check if an unbulleted line is a brand new role title without delimiters after an active entry already has highlights and dates
    if (current && current.dateText && current.highlights.length > 0 && ROLE_KEYWORD_REGEX.test(cleanLine) && cleanLine.length < 60) {
      // "Andela" on its own line followed by "Backend Developer" is the next employer, not
      // an accomplishment of the previous role.
      let nextCompany = '';
      const tail = current.highlights[current.highlights.length - 1] ?? '';
      if (current.plainTail && tail.length <= 40 && tail.split(/\s+/).length <= 4 && !/[.;:]$/.test(tail)) {
        nextCompany = tail;
        current.highlights.pop();
      }
      commitCurrent();
      current = {
        company: nextCompany,
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
      current.plainTail = true;
    } else {
      // Start a fallback entry if orphan line encountered
      current = {
        company: cleanLine,
        title: '',
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

    // "StatusHD - React Native app for ..." is a complete project entry on one line.
    const inlineProject = cleanLine.match(/^([^|:]{2,50}?)\s+[—–-]\s+(.{8,})$/) ?? cleanLine.match(/^([^|:]{2,40}?):\s+(.{8,})$/);
    if (inlineProject && inlineProject[1] && inlineProject[2] && !/^https?:/i.test(inlineProject[1])) {
      commitCurrent();
      const description = inlineProject[2].trim();
      current = {
        title: inlineProject[1].replace(/[*_#]/g, '').trim(),
        description,
        highlights: [description],
      };
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

const DEGREE_REGEX = /\b(bachelor(?:'s)?|master(?:'s)?|b\.?\s?s\.?c?|m\.?\s?s\.?c?|b\.?\s?tech|m\.?\s?tech|b\.?\s?eng|m\.?\s?eng|b\.?\s?a|m\.?\s?a|mba|ph\.?\s?d|hnd|ond|nd|nce|associate(?:'s)?|doctor(?:ate)?|diploma|certificate|bootcamp|llb|mbbs|b\.?\s?ed)\b\.?/i;
const INSTITUTION_REGEX = /\b(university|college|institute|polytechnic|school|academy|lautech|unilag|mit|bootcamp)\b/i;

/**
 * Classifies the parts of a single education line ("B.Tech Computer Science, LAUTECH, 2025",
 * "BSc in Physics | University of Lagos | 2019") by content. Unknown parts stay empty; the
 * resume must never show a degree, school, or subject the candidate did not write.
 */
function classifyEducationLine(text: string): ParsedEducation | null {
  const yearMatch = text.match(/\b(19\d\d|20\d\d)\b(?!.*\b(19\d\d|20\d\d)\b)/);
  const graduationDate = yearMatch && yearMatch[1] ? `${yearMatch[1]}-05` : undefined;
  const parts = text
    .split(/\s*(?:\||,|\s[—–-]\s)\s*/)
    .map((part) => part.replace(/\(?\b(?:19|20)\d\d\b\)?(?:\s*[-–—]\s*(?:(?:19|20)\d\d|present))?/gi, '').trim())
    .filter((part) => part.length > 0 && !/^(?:expected|graduated|class of)$/i.test(part));

  let degree = '';
  let fieldOfStudy = '';
  let institution = '';
  let lastAssigned: 'degree' | 'field' | 'institution' | null = null;
  for (const part of parts) {
    if (!degree && DEGREE_REGEX.test(part)) {
      lastAssigned = 'degree';
      const split = part.match(/^(.+?)\s+in\s+(.+)$/i);
      if (/^(?:bachelor|master|doctor|associate)/i.test(part) && !(split && split[1] && split[2])) {
        degree = part;
      } else if (split && split[1] && split[2]) {
        degree = split[1].trim();
        fieldOfStudy = split[2].trim();
      } else {
        const degreeMatch = part.match(DEGREE_REGEX);
        const rest = degreeMatch ? part.slice((degreeMatch.index ?? 0) + degreeMatch[0].length).trim() : '';
        degree = degreeMatch && rest && !INSTITUTION_REGEX.test(rest) ? part.slice(0, (degreeMatch.index ?? 0) + degreeMatch[0].length).trim() : part;
        if (degreeMatch && rest && !INSTITUTION_REGEX.test(rest)) fieldOfStudy = rest.replace(/^(?:in|of)\s+/i, '');
      }
      continue;
    }
    const looksLikeInstitution = INSTITUTION_REGEX.test(part) || /^[A-Z]{3,10}$/.test(part);
    if (!institution && looksLikeInstitution) {
      institution = part;
      lastAssigned = 'institution';
    } else if (lastAssigned === 'institution' && !looksLikeInstitution && part.split(/\s+/).length <= 3) {
      // "University of California, Berkeley": the campus belongs to the school name.
      institution = `${institution}, ${part}`;
    } else if (degree && !fieldOfStudy) {
      fieldOfStudy = part;
      lastAssigned = 'field';
    } else if (!institution) {
      institution = part;
      lastAssigned = 'institution';
    }
  }

  if (!degree && !institution) return null;
  return { institution, degree, fieldOfStudy, graduationDate };
}

/**
 * Parses raw text lines from the education section into academic records.
 */
function parseEducation(lines: readonly string[]): ParsedEducation[] {
  type MutableEducation = { -readonly [K in keyof ParsedEducation]: ParsedEducation[K] };
  const results: ParsedEducation[] = [];
  let current: MutableEducation | null = null;

  const commitCurrent = () => {
    if (current && (current.institution || current.degree)) results.push(current);
    current = null;
  };

  for (const line of lines) {
    const clean = line.replace(/^[-*•#]\s*/, '').trim();
    if (!clean) continue;

    const isDateOnly = /^(?:[A-Za-z]+\.?\s+)?(?:19|20)\d\d(?:\s*[-–—]\s*(?:(?:[A-Za-z]+\.?\s+)?(?:19|20)\d\d|present))?$/i.test(clean);
    if (isDateOnly) {
      const years = clean.match(/(?:19|20)\d\d/g);
      if (current && years) current.graduationDate = `${years[years.length - 1]}-05`;
      continue;
    }

    if (/^(?:gpa|cgpa|grade|honou?rs|relevant coursework|coursework)\b/i.test(clean)) continue;

    const hasDelimiter = /\||,|\s[—–-]\s/.test(clean);
    if (hasDelimiter || DEGREE_REGEX.test(clean)) {
      const parsed = classifyEducationLine(clean);
      if (!parsed) continue;
      if (current && !current.institution && !parsed.degree && parsed.institution) {
        current.institution = parsed.institution;
        current.graduationDate = current.graduationDate ?? parsed.graduationDate;
        continue;
      }
      if (current && !current.degree && parsed.degree && !parsed.institution) {
        current.degree = parsed.degree;
        current.fieldOfStudy = parsed.fieldOfStudy;
        current.graduationDate = current.graduationDate ?? parsed.graduationDate;
        continue;
      }
      commitCurrent();
      current = { ...parsed };
      continue;
    }

    if (current && !current.institution) {
      current.institution = clean;
    } else if (current && !current.degree && DEGREE_REGEX.test(clean)) {
      current.degree = clean;
    } else {
      commitCurrent();
      current = { institution: clean, degree: '', fieldOfStudy: '' };
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
  // Keyed case-insensitively so "Postgres", "postgresql" and "PostgreSQL" collapse to the
  // first spelling the candidate used.
  const skills = new Map<string, string>();
  const add = (skill: string) => {
    const trimmed = skill.trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase().replace(/^postgres$/, 'postgresql').replace(/^golang$/, 'go');
    if (!skills.has(key)) skills.set(key, trimmed);
  };

  for (const line of skillLines) {
    const clean = line.replace(/^[-*•#]\s*/, '').replace(/^[A-Za-z0-9\s&/_-]+:\s*/, '');
    for (const token of clean.split(/[,;|•]/)) add(token);
  }
  for (const exp of experiences) exp.technologiesUsed.forEach(add);
  for (const proj of projects) proj.technologiesUsed.forEach(add);

  return Array.from(skills.values());
}
