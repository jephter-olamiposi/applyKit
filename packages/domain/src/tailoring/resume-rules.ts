/**
 * @fileoverview 14-Point Resume Golden Standard Audit Engine and Template Budgeter.
 *
 * Implements automated validation and 1-click deterministic polishing for elite tech resumes:
 * 1. Pre-designed professional template selection (Modern, Classic, ATS, Compact).
 * 2. Strict 1-page vertical layout budgeter (Letter size 792pt).
 * 3. Targeted job keyword and competency alignment.
 * 4. Summary states the candidate's role, relevant skills, and one concrete result.
 * 5. First-item alignment with primary job requirement.
 * 6. Value-demonstrating experience titles.
 * 7. Candidate online profile links (LinkedIn, GitHub, Portfolio).
 * 8. Strict elimination of first-person pronouns ("I", "me", "my", "we").
 * 9. Elimination of self-praise buzzwords ("results-driven", "rockstar", "guru").
 * 10. Strong past-tense action verbs leading accomplishment bullets.
 * 11. Quantifiable impact measurement (Google X-Y-Z formula metrics: %, $, scale).
 * 12. Prioritized core skills and impressive years threshold (>= 3 years).
 * 13. Curated high-signal technical sections only.
 * 14. Tech orthography spelling and typography linting.
 *
 * Invariant (ADR-0004): Auto-fixing never fabricates credentials, metrics, or employers.
 */

import type { CandidateProfile } from '../candidate/profile.js';
import type { WorkExperience } from '../candidate/experience.js';
import type { JobPosting } from '../job/job-posting.js';
import type {
  TailoredResume,
  ResumeTemplateId,
  ResumeAuditCheckId,
  ResumeAuditCheckItem,
  ResumeQualityAuditReport,
  TailoredExperience,
  TailoredProject,
} from './tailoring-types.js';

/**
 * Banned corporate fluff and self-praise buzzwords.
 */
export const BANNED_BUZZWORDS: readonly string[] = [
  'results-driven',
  'result-driven',
  'passionate',
  'rockstar',
  'ninja',
  'guru',
  'detail-oriented',
  'exceptional',
  'thought leader',
  'seasoned professional',
  'seasoned',
  'hardworking',
  'hard-working',
  'go-getter',
  'team player',
  'visionary',
  'dynamic',
  'self-starter',
  'synergy',
  'game changer',
  'game-changer',
  'out of the box',
  'best of breed',
  'world-class',
];

/** "dynamic" used about a person or workplace, not a technical "dynamic X". */
export const FLUFF_DYNAMIC =
  /\bdynamic(?=\s*(?:[,.;]|$|\s+(?:and|team|teams|environment|professional|individual|leader|engineer|developer|self-starter|fast-paced|culture|personality|person)\b))/i;

/**
 * Pattern for one buzzword. Shared by the check and the auto-fix so the fix never
 * deletes a word the check would not flag (it used to turn "dynamic codec negotiation"
 * into "codec negotiation").
 */
function buzzwordPattern(buzz: string, flags: string): RegExp {
  if (buzz === 'dynamic') return new RegExp(FLUFF_DYNAMIC.source, flags);
  return new RegExp(`\\b${buzz.replace('-', '[- ]')}\\b`, flags);
}

/**
 * Standard past-tense active verbs demonstrating engineering accomplishment.
 */
export const STRONG_ACTION_VERBS: ReadonlySet<string> = new Set([
  'accelerated',
  'achieved',
  'administered',
  'analyzed',
  'architected',
  'audited',
  'automated',
  'benchmarked',
  'built',
  'centralized',
  'championed',
  'co-authored',
  'coded',
  'collaborated',
  'configured',
  'consolidated',
  'constructed',
  'containerized',
  'contributed',
  'converted',
  'coordinated',
  'created',
  'debugged',
  'decreased',
  'delivered',
  'deployed',
  'designed',
  'developed',
  'devised',
  'diagnosed',
  'directed',
  'documented',
  'doubled',
  'drafted',
  'eliminated',
  'enabled',
  'enforced',
  'engineered',
  'enhanced',
  'established',
  'evaluated',
  'executed',
  'expanded',
  'expedited',
  'facilitated',
  'factored',
  'fixed',
  'formulated',
  'founded',
  'generated',
  'guided',
  'halted',
  'handled',
  'harmonized',
  'headed',
  'identified',
  'implemented',
  'improved',
  'increased',
  'initiated',
  'inspected',
  'installed',
  'instituted',
  'integrated',
  'introduced',
  'invented',
  'investigated',
  'isolated',
  'launched',
  'led',
  'leveraged',
  'lowered',
  'maintained',
  'managed',
  'mapped',
  'maximized',
  'mentored',
  'merged',
  'migrated',
  'minimized',
  'modeled',
  'modernized',
  'monitored',
  'negotiated',
  'obtained',
  'operated',
  'optimized',
  'orchestrated',
  'organized',
  'overhauled',
  'oversaw',
  'partnered',
  'performed',
  'pioneered',
  'planned',
  'prepared',
  'produced',
  'programmed',
  'promoted',
  'prototyped',
  'published',
  're-architected',
  're-engineered',
  'rebuilt',
  'reconciled',
  'redesigned',
  'reduced',
  'refactored',
  'reformed',
  'regulated',
  'reinforced',
  'remediated',
  'reorganized',
  'replaced',
  'resolved',
  'restructured',
  'revamped',
  'reviewed',
  'revised',
  'revitalized',
  'saved',
  'scaled',
  'scheduled',
  'secured',
  'selected',
  'separated',
  'simplified',
  'slashed',
  'solved',
  'spearheaded',
  'specialized',
  'standardized',
  'streamlined',
  'strengthened',
  'structured',
  'superseded',
  'supervised',
  'supported',
  'surpassed',
  'synthesized',
  'systematized',
  'tabulated',
  'tested',
  'tracked',
  'trained',
  'transformed',
  'transitioned',
  'translated',
  'triaged',
  'troubleshot',
  'unified',
  'updated',
  'upgraded',
  'utilized',
  'validated',
  'verified',
  'yielded',
]);

/**
 * Passive or weak duty openings that diminish candidate impact.
 */
export const WEAK_DUTY_PATTERNS: readonly RegExp[] = [
  /^(responsible for|was responsible for)\b/i,
  /^(helped with|helped to|helped)\b/i,
  /^(worked on|worked with)\b/i,
  /^(assisted in|assisted with|assisted)\b/i,
  /^(tasked with|was tasked with)\b/i,
  /^(participated in|aided in)\b/i,
  /^(duties included|in charge of)\b/i,
];

/**
 * First-person pronouns forbidden in telegraphic resume style.
 */
export const FIRST_PERSON_PRONOUNS_REGEX = /\b(I|me|my|we|our|myself|ourselves)\b/i;

/**
 * Standard technology orthography dictionary correcting lowercase or malformed casings.
 */
export const TECH_ORTHOGRAPHY_MAP: Readonly<Record<string, string>> = {
  typescript: 'TypeScript',
  javascript: 'JavaScript',
  nodejs: 'Node.js',
  'node.js': 'Node.js',
  postgres: 'PostgreSQL',
  postgresql: 'PostgreSQL',
  graphql: 'GraphQL',
  aws: 'AWS',
  gcp: 'GCP',
  k8s: 'Kubernetes',
  kubernetes: 'Kubernetes',
  docker: 'Docker',
  react: 'React',
  reactjs: 'React',
  nextjs: 'Next.js',
  'next.js': 'Next.js',
  vue: 'Vue.js',
  vuejs: 'Vue.js',
  'vue.js': 'Vue.js',
  mongodb: 'MongoDB',
  redis: 'Redis',
  sql: 'SQL',
  nosql: 'NoSQL',
  api: 'API',
  apis: 'APIs',
  rest: 'REST',
  restful: 'RESTful',
  'ci/cd': 'CI/CD',
  cicd: 'CI/CD',
  github: 'GitHub',
  gitlab: 'GitLab',
  linux: 'Linux',
  html: 'HTML',
  css: 'CSS',
};

/**
 * Regex matching quantified metrics in accomplishment bullets (percentages, currency, multipliers, scale).
 */
export const QUANTIFIED_METRIC_REGEX = /\b(\d+[%kKmMbB]?|\$\d+|\d+\+|\d+x|\d+\s*(?:ms|sec|hours|days|GB|TB|users|clients|req\/s))\b/i;

/**
 * Estimates vertical points for a tailored resume to ensure it fits on a single Letter page (792 pt).
 *
 * @param resume Tailored resume aggregate.
 * @param profile Candidate profile.
 * @param templateId Selected visual layout template.
 * @returns Point budget estimation and single-page fit status.
 */
export function calculatePagePointBudget(
  resume: TailoredResume,
  profile: CandidateProfile,
  templateId: ResumeTemplateId = 'modern'
): { totalPoints: number; fitsOnePage: boolean; recommendations: string[] } {
  // Page Budget Constants for US Letter (8.5 x 11 in = 612 x 792 pt)
  const maxAvailablePoints = 760; // 792 pt minus top/bottom margins
  const recommendations: string[] = [];

  // Header & Contact Section
  const headerHeight = templateId === 'compact' ? 75 : 95;

  // Summary Section
  const summaryLines = Math.ceil(resume.tailoredSummary.length / (templateId === 'compact' ? 100 : 85));
  const summaryHeight = 25 + summaryLines * 12;

  // Technical Skills Section
  const totalSkillTags =
    resume.skills.matchedRequired.length +
    resume.skills.matchedPreferred.length +
    resume.skills.additionalSkills.length;
  const skillsHeight = 25 + Math.ceil(totalSkillTags / 8) * 14;

  // Experience Section
  let expHeight = 25; // Section title
  for (const exp of resume.experiences) {
    expHeight += 20; // Title & company row
    expHeight += exp.rankedHighlights.length * 15; // Bullets
    expHeight += 6; // Spacing
  }

  // Projects Section
  let projHeight = 0;
  if (resume.projects.length > 0) {
    projHeight += 25; // Section title
    for (const proj of resume.projects) {
      projHeight += 16;
      projHeight += proj.rankedHighlights.length * 14;
      projHeight += 4;
    }
  }

  // Education Section
  let eduHeight = 0;
  if (profile.education.length > 0) {
    eduHeight += 25; // Section title
    eduHeight += profile.education.length * 16;
  }

  const totalPoints = headerHeight + summaryHeight + skillsHeight + expHeight + projHeight + eduHeight;
  const fitsOnePage = totalPoints <= maxAvailablePoints;

  if (!fitsOnePage) {
    const excess = totalPoints - maxAvailablePoints;
    if (resume.experiences.some((e) => e.rankedHighlights.length > 3)) {
      recommendations.push(
        `Reduce bullet points on earlier experiences from 4 to 2-3 to save ~${Math.min(excess, 45)} points.`
      );
    }
    if (resume.projects.length > 1) {
      recommendations.push(
        `Feature only the top 1 most relevant project to save ~${Math.min(excess, 50)} points.`
      );
    }
    if (summaryLines > 3) {
      recommendations.push('Shorten professional summary to 2-3 concise lines.');
    }
  }

  return {
    totalPoints,
    fitsOnePage,
    recommendations,
  };
}

/**
 * Normalizes technology keywords within text according to industry standard orthography.
 *
 * @param text Arbitrary text content.
 * @returns Text with normalized technology spelling and casing.
 */
export function normalizeTechOrthography(text: string): string {
  let result = text;

  for (const [lower, proper] of Object.entries(TECH_ORTHOGRAPHY_MAP)) {
    // Avoid double replacing if already proper casing
    if (proper === lower) continue;
    const regex = new RegExp(`\\b${lower}\\b`, 'gi');
    result = result.replace(regex, proper);
  }

  return result;
}

/**
 * Calculates tenure in years from the merged span of all work experiences.
 *
 * Overlapping or concurrent roles are counted once; summing per-role durations
 * would overstate tenure for candidates who held two jobs at the same time.
 *
 * @param experiences Candidate work history.
 * @returns Whole years of continuous experience, or 0 when no dates are usable.
 */
export function calculateVerifiedExperienceYears(experiences: readonly WorkExperience[]): number {
  const intervals: Array<[number, number]> = [];

  for (const exp of experiences) {
    const start = Date.parse(exp.startDate);
    const end = exp.endDate ? Date.parse(exp.endDate) : Date.now();
    if (Number.isNaN(start) || Number.isNaN(end) || end < start) continue;
    intervals.push([start, end]);
  }

  if (intervals.length === 0) return 0;

  intervals.sort((a, b) => a[0] - b[0]);
  let totalMs = 0;
  let [currentStart, currentEnd] = intervals[0] as [number, number];

  for (const [start, end] of intervals.slice(1)) {
    if (start <= currentEnd) {
      currentEnd = Math.max(currentEnd, end);
    } else {
      totalMs += currentEnd - currentStart;
      currentStart = start;
      currentEnd = end;
    }
  }
  totalMs += currentEnd - currentStart;

  return Math.max(0, Math.floor(totalMs / (365.25 * 24 * 60 * 60 * 1000)));
}

/**
 * Audits a tailored resume against all 14 criteria of the Resume Golden Standard.
 *
 * @param resume Tailored resume aggregate.
 * @param profile Candidate profile source.
 * @param job Target job posting.
 * @param templateId Selected design template.
 * @returns Comprehensive quality audit report.
 */
export function auditResumeQuality(
  resume: TailoredResume,
  profile: CandidateProfile,
  job: JobPosting,
  templateId: ResumeTemplateId = 'modern'
): ResumeQualityAuditReport {
  const checks: Partial<Record<ResumeAuditCheckId, ResumeAuditCheckItem>> = {};

  // Pre-designed template check
  const validTemplates = ['modern', 'classic', 'minimalist', 'compact'];
  const hasValidTemplate = validTemplates.includes(templateId);
  checks.template_selected = {
    id: 'template_selected',
    name: 'Uses a ready-made template',
    status: hasValidTemplate ? 'passed' : 'failed',
    score: hasValidTemplate ? 100 : 0,
    description: `Using ${templateId.toUpperCase()} template with verified typography and spacing.`,
    recommendations: hasValidTemplate ? [] : ['Select one of the pre-designed templates: Modern, Classic, Minimalist, or Compact.'],
    autoFixable: true,
  };

  // Fit on 1 page check
  const pageBudget = calculatePagePointBudget(resume, profile, templateId);
  checks.one_page_fit = {
    id: 'one_page_fit',
    name: 'Fits on one page',
    status: pageBudget.fitsOnePage ? 'passed' : 'warning',
    score: pageBudget.fitsOnePage ? 100 : Math.max(50, Math.round((760 / pageBudget.totalPoints) * 100)),
    description: pageBudget.fitsOnePage
      ? `Estimated length is ${pageBudget.totalPoints}pt (within 760pt single-page limit).`
      : `Estimated length is ${pageBudget.totalPoints}pt (spills onto page 2).`,
    recommendations: pageBudget.recommendations,
    autoFixable: true,
  };

  // Job keywords included
  const matchedReqSkills = resume.skills.matchedRequired;
  const matchedPrefSkills = resume.skills.matchedPreferred;
  const totalJobMatches = matchedReqSkills.length + matchedPrefSkills.length;
  checks.job_keywords = {
    id: 'job_keywords',
    name: 'Uses words from the job description',
    status: totalJobMatches >= 3 ? 'passed' : totalJobMatches >= 1 ? 'warning' : 'failed',
    score: Math.min(100, totalJobMatches * 25),
    description: `Matched ${totalJobMatches} direct job description competencies across summary and skills.`,
    recommendations: totalJobMatches < 3
      ? ['Ensure verified skills matching the job criteria are included in your profile.']
      : [],
    autoFixable: false,
  };

  // The cheat sheet's "include the company name you are applying to": the summary's
  // closing line names it when the candidate keeps that option on.
  const companyNamed = Boolean(job.companyName) && resume.tailoredSummary.toLowerCase().includes(job.companyName.toLowerCase());
  checks.company_named = {
    id: 'company_named',
    name: 'Names the company you are applying to',
    status: companyNamed ? 'passed' : 'warning',
    score: companyNamed ? 100 : 60,
    description: companyNamed
      ? `The summary names ${job.companyName}.`
      : `The summary does not name ${job.companyName || 'the company'}.`,
    recommendations: companyNamed ? [] : [`Turn on "Name ${job.companyName || 'the company'} in my summary".`],
    autoFixable: false,
  };

  // Summary targets this posting's requirements
  const summaryLower = resume.tailoredSummary.toLowerCase();
  const summarySkill = [...matchedReqSkills, ...matchedPrefSkills].find(
    (skill) => skill.length > 1 && summaryLower.includes(skill.toLowerCase())
  );
  checks.summary_targeting = {
    id: 'summary_targeting',
    name: 'Summary names what the job asks for',
    status: summarySkill ? 'passed' : 'warning',
    score: summarySkill ? 100 : 50,
    description: summarySkill
      ? `Summary leads with "${summarySkill}", a competency this posting asks for.`
      : 'Summary does not name a competency from this posting.',
    recommendations: summarySkill
      ? []
      : ['Name one or two skills from the posting that the candidate genuinely has.'],
    autoFixable: true,
  };

  // First item reflects what they are looking for
  const firstExp = resume.experiences[0];
  const firstBullet = firstExp?.rankedHighlights[0];
  const firstBulletMatches = (firstBullet?.matchedRequirements.length ?? 0) > 0;
  checks.first_item_aligned = {
    id: 'first_item_aligned',
    name: 'First line shows what they are looking for',
    status: firstBulletMatches ? 'passed' : 'warning',
    score: firstBulletMatches ? 100 : 60,
    description: firstBulletMatches
      ? `Top bullet directly addresses: ${firstBullet?.matchedRequirements.join(', ')}.`
      : 'Top bullet does not directly address a primary job requirement.',
    recommendations: firstBulletMatches ? [] : ['Elevate the highlight bullet that most directly matches the job\'s #1 qualification.'],
    autoFixable: true,
  };

  // Experience titles demonstrate value
  const hasValueTitles = resume.experiences.every((exp) => exp.title.length > 5);
  checks.title_demonstrates_value = {
    id: 'title_demonstrates_value',
    name: 'Job titles show your value',
    status: hasValueTitles ? 'passed' : 'warning',
    score: hasValueTitles ? 100 : 70,
    description: hasValueTitles
      ? 'Experience titles clearly reflect senior level or technical scope.'
      : 'Some experience titles appear generic without domain context.',
    recommendations: hasValueTitles ? [] : ['Add domain or level context to titles in your candidate profile.'],
    autoFixable: false,
  };

  // Online links check
  const hasOnlineLink = Boolean(
    profile.links?.linkedin ||
      profile.links?.github ||
      profile.links?.portfolio ||
      (profile.links?.customLinks && profile.links.customLinks.length > 0)
  );
  checks.online_links = {
    id: 'online_links',
    name: 'Has an online link',
    status: hasOnlineLink ? 'passed' : 'warning',
    score: hasOnlineLink ? 100 : 30,
    description: hasOnlineLink
      ? 'Header includes verified online links (LinkedIn, GitHub, or Portfolio).'
      : 'Missing online profile links. Recruiters expect at least one verified online link.',
    recommendations: hasOnlineLink ? [] : ['Add your LinkedIn or GitHub profile link in Candidate Profile settings.'],
    autoFixable: false,
  };

  // Remove the word "I"
  const allBullets = [
    ...resume.experiences.flatMap((e) => e.rankedHighlights.map((h) => h.text)),
    ...resume.projects.flatMap((p) => p.rankedHighlights.map((h) => h.text)),
  ];
  const summaryHasI = FIRST_PERSON_PRONOUNS_REGEX.test(resume.tailoredSummary);
  const bulletsWithI = allBullets.filter((b) => FIRST_PERSON_PRONOUNS_REGEX.test(b));
  const hasNoPronounI = !summaryHasI && bulletsWithI.length === 0;
  checks.no_pronoun_i = {
    id: 'no_pronoun_i',
    name: 'No "I"',
    status: hasNoPronounI ? 'passed' : 'warning',
    score: hasNoPronounI ? 100 : Math.max(40, 100 - (bulletsWithI.length + (summaryHasI ? 1 : 0)) * 20),
    description: hasNoPronounI
      ? 'Strict telegraphic style: zero first-person pronouns ("I", "me", "my", "we").'
      : `Found personal pronouns in ${bulletsWithI.length + (summaryHasI ? 1 : 0)} location(s).`,
    recommendations: hasNoPronounI ? [] : ['Remove first-person pronouns ("I", "my", "we") from bullet points and summary.'],
    autoFixable: true,
  };

  // No buzzwords check
  const textBlob = `${resume.tailoredSummary} ${allBullets.join(' ')}`.toLowerCase();
  const detectedBuzzwords = BANNED_BUZZWORDS.filter((buzz) => {
    // "dynamic" is fluff about a person ("dynamic engineer") but a plain technical word
    // in "dynamic codec negotiation" or "dynamic pricing", which must not be flagged.
    return buzzwordPattern(buzz, 'i').test(textBlob);
  });
  const hasNoBuzzwords = detectedBuzzwords.length === 0;
  checks.no_buzzwords = {
    id: 'no_buzzwords',
    name: 'No buzzwords about how great you are',
    status: hasNoBuzzwords ? 'passed' : 'warning',
    score: hasNoBuzzwords ? 100 : Math.max(30, 100 - detectedBuzzwords.length * 25),
    description: hasNoBuzzwords
      ? 'Clean, evidence-backed narrative free of empty self-praise buzzwords.'
      : `Found buzzword(s): ${detectedBuzzwords.join(', ')}.`,
    recommendations: hasNoBuzzwords ? [] : [`Replace "${detectedBuzzwords.join(', ')}" with specific, measurable achievements.`],
    autoFixable: true,
  };

  // Strong Action words
  let actionVerbCount = 0;
  let weakOpeningCount = 0;
  for (const bullet of allBullets) {
    const trimmed = bullet.trim();
    const firstWord = trimmed.split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, '') || '';
    if (STRONG_ACTION_VERBS.has(firstWord)) {
      actionVerbCount++;
    }
    if (WEAK_DUTY_PATTERNS.some((p) => p.test(trimmed))) {
      weakOpeningCount++;
    }
  }
  const actionVerbRatio = allBullets.length > 0 ? actionVerbCount / allBullets.length : 1;
  const isActionWordsPassed = actionVerbRatio >= 0.7 && weakOpeningCount === 0;
  checks.action_words = {
    id: 'action_words',
    name: 'Lines start with action words',
    status: isActionWordsPassed ? 'passed' : 'warning',
    score: Math.round(actionVerbRatio * 100),
    description: `${actionVerbCount}/${allBullets.length} bullets begin with strong action verbs.`,
    recommendations: !isActionWordsPassed
      ? ['Begin every bullet with a plain past-tense verb (e.g. "Built", "Led", "Reduced"). Avoid "Responsible for".']
      : [],
    autoFixable: true,
  };

  // Measure impact (Google X-Y-Z formula)
  let quantifiedCount = 0;
  for (const bullet of allBullets) {
    if (QUANTIFIED_METRIC_REGEX.test(bullet)) {
      quantifiedCount++;
    }
  }
  const impactRatio = allBullets.length > 0 ? quantifiedCount / allBullets.length : 0;
  const isImpactPassed = impactRatio >= 0.5;
  checks.impact_measured = {
    id: 'impact_measured',
    name: 'Shows impact, not just duties',
    status: isImpactPassed ? 'passed' : 'warning',
    score: Math.min(100, Math.round(impactRatio * 150)),
    description: `${quantifiedCount}/${allBullets.length} bullets include quantified scale, %, or performance metrics.`,
    recommendations: !isImpactPassed
      ? ['Quantify accomplishments using the Google X-Y-Z formula (e.g. "reduced latency by 45%", "serving 10M+ users").']
      : [],
    autoFixable: false,
  };

  // Skills & impressive years
  const verifiedYears = calculateVerifiedExperienceYears(profile.experiences);
  const mentionsYearsInSummary = /\b\d+\+?\s*years\b/i.test(resume.tailoredSummary);
  const yearsImpressiveOrOmitted = !mentionsYearsInSummary || verifiedYears >= 3;
  checks.skills_and_impressive_years = {
    id: 'skills_and_impressive_years',
    name: 'Skills match what they want',
    status: yearsImpressiveOrOmitted ? 'passed' : 'warning',
    score: yearsImpressiveOrOmitted ? 100 : 70,
    description: yearsImpressiveOrOmitted
      ? 'Skills prioritize target criteria; years of experience are only featured if impressive (>= 3 years).'
      : 'Summary highlights low year count (< 3 years), which can diminish perceived seniority.',
    recommendations: yearsImpressiveOrOmitted ? [] : ['Omit low year counts from executive summary; lead with verified competencies.'],
    autoFixable: true,
  };

  // Impressive sections only
  const hasCoreSections = resume.experiences.length > 0 && totalJobMatches > 0;
  checks.impressive_sections = {
    id: 'impressive_sections',
    name: 'Only strong sections',
    status: hasCoreSections ? 'passed' : 'warning',
    score: hasCoreSections ? 100 : 50,
    description: 'Focuses strictly on high-signal sections: Technical Skills, Experience, Projects, and Education.',
    recommendations: hasCoreSections ? [] : ['Ensure work experiences and technical skills sections are populated.'],
    autoFixable: false,
  };

  // No typos or bad grammar
  let typoIssues = 0;
  const typoNotes: string[] = [];
  for (const bullet of allBullets) {
    // Check tech casing
    for (const [lower, proper] of Object.entries(TECH_ORTHOGRAPHY_MAP)) {
      if (lower !== proper.toLowerCase()) continue;
      const rx = new RegExp(`\\b${lower}\\b`, 'g');
      if (rx.test(bullet) && !bullet.includes(proper)) {
        typoIssues++;
      }
    }
    // Check double spaces
    if (/\s{2,}/.test(bullet)) {
      typoIssues++;
    }
    const repeated = findRepeatedPhrase(bullet);
    if (repeated) {
      typoIssues++;
      typoNotes.push(`"${repeated}" appears twice in one bullet. Check for a copy-paste slip.`);
    }
  }
  const isGrammarClean = typoIssues === 0;
  checks.no_typos_grammar = {
    id: 'no_typos_grammar',
    name: 'No typos or grammar slips',
    status: isGrammarClean ? 'passed' : 'warning',
    score: isGrammarClean ? 100 : Math.max(50, 100 - typoIssues * 15),
    description: isGrammarClean
      ? 'Standardized technology casing (e.g. TypeScript, Node.js, PostgreSQL) and clean punctuation.'
      : `Found ${typoIssues} casing or typography inconsistency issue(s).`,
    recommendations: isGrammarClean ? [] : [...typoNotes, 'Normalize technology casing and clean up formatting inconsistencies.'],
    autoFixable: true,
  };

  // Honesty checks. Style checks above can all pass on a resume that says "Company" where
  // the employer should be, so these two gate readiness on their own.
  const placeholderPattern = /^(?:company|role|degree|university|academic institution|general studies|n\/a|tbd)$/i;
  const placeholderIssues: string[] = [];
  for (const exp of resume.experiences) {
    if (!exp.title.trim() || placeholderPattern.test(exp.title.trim())) placeholderIssues.push('A role is missing its job title.');
    if (!exp.company.trim() || placeholderPattern.test(exp.company.trim())) placeholderIssues.push(`"${exp.title || 'A role'}" is missing the employer name.`);
    if (!exp.startDate) placeholderIssues.push(`"${exp.title || 'A role'}" is missing dates.`);
  }
  for (const edu of profile.education) {
    for (const value of [edu.degree, edu.fieldOfStudy, edu.institution]) {
      if (value && placeholderPattern.test(value.trim())) placeholderIssues.push(`Education has a placeholder value: "${value}".`);
    }
  }
  checks.no_placeholders = {
    id: 'no_placeholders',
    name: 'No missing or placeholder details',
    status: placeholderIssues.length === 0 ? 'passed' : 'failed',
    score: placeholderIssues.length === 0 ? 100 : 0,
    description:
      placeholderIssues.length === 0
        ? 'Every role has a title, employer, and dates.'
        : `${placeholderIssues.length} detail${placeholderIssues.length === 1 ? ' is' : 's are'} missing. Fill them in your profile before sending.`,
    recommendations: [...new Set(placeholderIssues)],
    autoFixable: false,
  };

  // Auto-fix rewrites openings ("responsible for building" -> "Built") and casing, so a
  // bullet traces back when it shares most of its content words with one the candidate wrote.
  const contentWords = (text: string) =>
    new Set(text.toLowerCase().replace(/[^a-z0-9.+#%$ ]/g, ' ').split(/\s+/).filter((word) => word.length > 2));
  const profileBulletWords = [...profile.experiences.flatMap((exp) => exp.highlights), ...profile.projects.flatMap((project) => project.highlights)].map(contentWords);
  const tracesToProfile = (text: string) => {
    const words = contentWords(text);
    if (words.size === 0) return true;
    return profileBulletWords.some((source) => {
      let shared = 0;
      for (const word of words) if (source.has(word)) shared++;
      return shared / words.size >= 0.6;
    });
  };
  const profileSkills = new Set(profile.skills.map((skill) => skill.name.trim().toLowerCase()));
  const untraceable: string[] = [];
  for (const item of [...resume.experiences, ...resume.projects]) {
    for (const highlight of item.rankedHighlights) {
      if (!highlight.sourceEvidenceId && !tracesToProfile(highlight.text)) {
        untraceable.push(`Bullet not found in your resume: "${highlight.text.slice(0, 60)}"`);
      }
    }
  }
  const listedSkills = [
    ...resume.skills.matchedRequired,
    ...resume.skills.matchedPreferred,
    ...resume.skills.additionalSkills,
    ...(resume.skills.domainCategories ?? []).flatMap((group) => group.skills),
  ];
  for (const skill of new Set(listedSkills)) {
    if (!profileSkills.has(skill.trim().toLowerCase())) untraceable.push(`Skill not in your profile: ${skill}`);
  }
  checks.facts_traceable = {
    id: 'facts_traceable',
    name: 'Everything comes from your resume',
    status: untraceable.length === 0 ? 'passed' : 'failed',
    score: untraceable.length === 0 ? 100 : 0,
    description:
      untraceable.length === 0
        ? 'Every bullet and skill traces back to something you wrote.'
        : `${untraceable.length} item${untraceable.length === 1 ? '' : 's'} could not be traced to your resume.`,
    recommendations: untraceable.slice(0, 5),
    autoFixable: false,
  };

  // Calculate Overall Score
  const checkValues = Object.values(checks) as ResumeAuditCheckItem[];
  const totalScore = checkValues.reduce((sum, c) => sum + c.score, 0);
  const honestyFailed = checks.no_placeholders.status === 'failed' || checks.facts_traceable.status === 'failed';
  // A resume with a missing employer or an untraceable claim is not ready however well it
  // scores on style, so the overall score is capped below the "ready" range.
  const overallScore = Math.min(honestyFailed ? 59 : 100, Math.round(totalScore / checkValues.length));
  const passedCount = checkValues.filter((c) => c.status === 'passed').length;
  const isReady = checkValues.every((c) => c.status !== 'failed');

  return {
    overallScore,
    isReady,
    passedCount,
    totalCount: checkValues.length,
    checks: checks as Record<ResumeAuditCheckId, ResumeAuditCheckItem>,
    auditedAt: new Date().toISOString(),
  };
}

/**
 * Past-tense forms for common "responsible for <verb>ing" duty phrasing.
 *
 * The rewrite only changes grammar: the claim itself already belongs to the
 * candidate's verified profile, so no new scope or impact is introduced.
 */
const DUTY_GERUND_TO_PAST: Readonly<Record<string, string>> = {
  analyzing: 'Analyzed',
  architecting: 'Architected',
  automating: 'Automated',
  building: 'Built',
  configuring: 'Configured',
  coordinating: 'Coordinated',
  creating: 'Created',
  delivering: 'Delivered',
  deploying: 'Deployed',
  designing: 'Designed',
  developing: 'Developed',
  documenting: 'Documented',
  fixing: 'Fixed',
  implementing: 'Implemented',
  improving: 'Improved',
  integrating: 'Integrated',
  investigating: 'Investigated',
  leading: 'Led',
  maintaining: 'Maintained',
  managing: 'Managed',
  mentoring: 'Mentored',
  migrating: 'Migrated',
  monitoring: 'Monitored',
  operating: 'Operated',
  optimizing: 'Optimized',
  owning: 'Owned',
  refactoring: 'Refactored',
  running: 'Ran',
  scaling: 'Scaled',
  shipping: 'Shipped',
  supporting: 'Supported',
  testing: 'Tested',
  troubleshooting: 'Troubleshot',
  writing: 'Wrote',
};

/**
 * Rewrites duty-style openings into plain past-tense statements.
 *
 * Returns the input unchanged when no faithful rewrite exists, because inventing
 * scope or ownership would violate the no-fabrication invariant.
 */
function rewriteDutyOpening(text: string): string {
  const match = text.match(
    /^(?:was\s+)?(responsible\s+for|helped(?:\s+(?:with|to))?|worked\s+(?:on|with)|assisted(?:\s+(?:in|with))?|participated\s+in|tasked\s+with|involved\s+in)\s+(.+)$/i
  );
  if (!match) return text;

  const phrase = (match[1] ?? '').toLowerCase();
  const rest = (match[2] ?? '').trim();
  if (rest.length === 0) return text;

  if (phrase.startsWith('responsible') || phrase.startsWith('tasked')) {
    const gerund = rest.match(/^([a-z]+ing)\b(.*)$/i);
    const past = gerund ? DUTY_GERUND_TO_PAST[(gerund[1] ?? '').toLowerCase()] : undefined;
    if (gerund && past) {
      return `${past}${gerund[2] ?? ''}`.trim();
    }
    return `Owned ${rest}`;
  }

  if (phrase.startsWith('worked') || phrase.startsWith('participated')) {
    return `Contributed to ${rest}`;
  }

  return `Supported ${rest}`;
}

/**
 * Deterministically fixes auto-fixable issues in a tailored resume without inventing any credentials.
 *
 * Operations:
 * 1. Strips first-person pronouns ("I", "me", "my", "we").
 * 2. Replaces empty buzzwords with factual phrasing.
 * 3. Normalizes technology orthography (e.g. typescript -> TypeScript).
 * 4. Rewrites duty-style openings with plain past-tense verbs.
 * 5. Replaces an unusable summary with one built from profile facts.
 * 6. Enforces 1-page bullet limits.
 *
 * @param resume Tailored resume aggregate.
 * @param profile Candidate profile source.
 * @param job Target job posting.
 * @returns Polished tailored resume.
 */
export function autoFixResumeQualityIssues(
  resume: TailoredResume,
  profile: CandidateProfile,
  job: JobPosting
): TailoredResume {
  // Clean executive summary
  let summary = resume.tailoredSummary;

  // Remove first-person pronouns
  summary = summary.replace(/\b(I am|I have been|I have|I)\b/gi, '').replace(/\b(my|our)\b/gi, 'the');

  // Remove buzzwords
  for (const buzz of BANNED_BUZZWORDS) {
    summary = summary.replace(buzzwordPattern(buzz, 'gi'), '');
  }

  // Normalize tech orthography
  summary = normalizeTechOrthography(summary);

  // Clean double spaces and punctuation gaps
  summary = summary
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,;:])/g, '$1')
    .replace(/^[,\s.-]+/, '')
    .trim();

  // If the summary is unusable, rebuild it from profile facts only.
  if (!summary || summary.length < 20) {
    const title = profile.professional.currentTitle || profile.professional.headline || resume.experiences[0]?.title || 'Engineer';
    const coreSkills = resume.skills.matchedRequired.slice(0, 3);
    const stack = coreSkills.length > 1 ? `${coreSkills.slice(0, -1).join(', ')} and ${coreSkills[coreSkills.length - 1]}` : coreSkills[0] ?? '';
    const years = Math.floor(calculateVerifiedExperienceYears(profile.experiences));
    summary = `${title}${years >= 2 ? ` with ${years} years of experience` : ''}${stack ? `, working mostly in ${stack}` : ''}.`;
  }

  // Clean highlights for experiences
  const experiences: TailoredExperience[] = resume.experiences.map((exp) => {
    const cleanedHighlights = exp.rankedHighlights.map((h) => {
      let text = h.text;

      // Rewrite duty-style openings into plain past-tense statements
      text = rewriteDutyOpening(text);

      // Strip first-person pronouns
      text = text.replace(/\b(I|me|my|we|our|myself)\b/gi, '');

      // Normalize tech casing
      text = normalizeTechOrthography(text);

      // Clean buzzwords
      for (const buzz of BANNED_BUZZWORDS) {
        text = text.replace(buzzwordPattern(buzz, 'gi'), '');
      }

      // Ensure first character is capitalized
      text = text.replace(/\s{2,}/g, ' ').replace(/\s+([.,;:])/g, '$1').trim();
      if (text.length > 0) {
        text = text.charAt(0).toUpperCase() + text.slice(1);
      }
      if (text.length > 0 && !text.endsWith('.')) {
        text += '.';
      }

      return {
        ...h,
        text,
      };
    });

    return {
      ...exp,
      rankedHighlights: cleanedHighlights,
    };
  });

  // Clean highlights for projects
  const projects: TailoredProject[] = resume.projects.map((proj) => {
    const cleanedHighlights = proj.rankedHighlights.map((h) => {
      let text = normalizeTechOrthography(h.text);
      text = rewriteDutyOpening(text);
      text = text.replace(/\s{2,}/g, ' ').trim();
      if (text.length > 0) {
        text = text.charAt(0).toUpperCase() + text.slice(1);
      }
      if (text.length > 0 && !text.endsWith('.')) {
        text += '.';
      }
      return {
        ...h,
        text,
      };
    });

    return {
      ...proj,
      technologiesUsed: proj.technologiesUsed.map((t) => TECH_ORTHOGRAPHY_MAP[t.toLowerCase()] || t),
      rankedHighlights: cleanedHighlights,
    };
  });

  const polishedResume: TailoredResume = {
    ...resume,
    tailoredSummary: summary,
    experiences,
    projects,
  };

  const newAudit = auditResumeQuality(polishedResume, profile, job, resume.templateId || 'modern');

  return {
    ...polishedResume,
    qualityAudit: newAudit,
  };
}

/**
 * Finds a phrase of three or more words that occurs twice in one bullet, the usual sign
 * of a copy-paste slip ("an admin dashboard for managing an admin dashboardproducts").
 * Words glued to the repeat ("dashboardproducts") still count, since that is the slip.
 */
export function findRepeatedPhrase(text: string): string | undefined {
  const words = text.toLowerCase().match(/[a-z0-9][a-z0-9'-]*/g) ?? [];
  for (let size = 4; size >= 3; size -= 1) {
    const seen = new Map<string, number>();
    for (let i = 0; i + size <= words.length; i += 1) {
      const gram = words.slice(i, i + size).join(' ');
      if (gram.split(' ').filter((word) => word.length > 3).length < 2) continue;
      const first = seen.get(gram);
      if (first !== undefined && i >= first + size) return gram;
      if (first === undefined) seen.set(gram, i);
    }
    // Catch the glued form: the last word of the repeat fused with the next word.
    for (let i = 0; i + size <= words.length; i += 1) {
      const head = words.slice(i, i + size - 1).join(' ');
      const tail = words[i + size - 1]!;
      for (let j = i + size; j + size - 1 <= words.length; j += 1) {
        const candidateHead = words.slice(j, j + size - 1).join(' ');
        const glued = words[j + size - 1];
        if (candidateHead === head && glued && glued !== tail && glued.startsWith(tail) && head.split(' ').some((w) => w.length > 3)) {
          return `${head} ${tail}`;
        }
      }
    }
  }
  return undefined;
}

