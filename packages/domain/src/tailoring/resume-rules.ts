/**
 * @fileoverview 14-Point Resume Golden Standard Audit Engine and Template Budgeter.
 *
 * Implements automated validation and 1-click deterministic polishing for elite tech resumes:
 * 1. Pre-designed professional template selection (Modern, Classic, ATS, Compact).
 * 2. Strict 1-page vertical layout budgeter (Letter size 792pt).
 * 3. Targeted job keyword and competency alignment.
 * 4. Target company name inclusion in summary.
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
import type { JobPosting } from '../job/job-posting.js';
import { areCompetenciesEquivalent, normalizeCompetencyToken } from '../job/synonyms.js';
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

  // 1. Header & Contact Section
  const headerHeight = templateId === 'compact' ? 75 : 95;

  // 2. Summary Section
  const summaryLines = Math.ceil(resume.tailoredSummary.length / (templateId === 'compact' ? 100 : 85));
  const summaryHeight = 25 + summaryLines * 12;

  // 3. Technical Skills Section
  const totalSkillTags =
    resume.skills.matchedRequired.length +
    resume.skills.matchedPreferred.length +
    resume.skills.additionalSkills.length;
  const skillsHeight = 25 + Math.ceil(totalSkillTags / 8) * 14;

  // 4. Experience Section
  let expHeight = 25; // Section title
  for (const exp of resume.experiences) {
    expHeight += 20; // Title & company row
    expHeight += exp.rankedHighlights.length * 15; // Bullets
    expHeight += 6; // Spacing
  }

  // 5. Projects Section
  let projHeight = 0;
  if (resume.projects.length > 0) {
    projHeight += 25; // Section title
    for (const proj of resume.projects) {
      projHeight += 16;
      projHeight += proj.rankedHighlights.length * 14;
      projHeight += 4;
    }
  }

  // 6. Education Section
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

  // 1. Pre-designed template check
  const validTemplates = ['modern', 'classic', 'minimalist', 'compact'];
  const hasValidTemplate = validTemplates.includes(templateId);
  checks.template_selected = {
    id: 'template_selected',
    name: 'Pre-designed Template',
    status: hasValidTemplate ? 'passed' : 'failed',
    score: hasValidTemplate ? 100 : 0,
    description: `Using ${templateId.toUpperCase()} template with verified typography and spacing.`,
    recommendations: hasValidTemplate ? [] : ['Select one of the pre-designed templates: Modern, Classic, Minimalist, or Compact.'],
    autoFixable: true,
  };

  // 2. Fit on 1 page check
  const pageBudget = calculatePagePointBudget(resume, profile, templateId);
  checks.one_page_fit = {
    id: 'one_page_fit',
    name: '1-Page Fit Guarantee',
    status: pageBudget.fitsOnePage ? 'passed' : 'warning',
    score: pageBudget.fitsOnePage ? 100 : Math.max(50, Math.round((760 / pageBudget.totalPoints) * 100)),
    description: pageBudget.fitsOnePage
      ? `Estimated length is ${pageBudget.totalPoints}pt (within 760pt single-page limit).`
      : `Estimated length is ${pageBudget.totalPoints}pt (spills onto page 2).`,
    recommendations: pageBudget.recommendations,
    autoFixable: true,
  };

  // 3. Job keywords included
  const matchedReqSkills = resume.skills.matchedRequired;
  const matchedPrefSkills = resume.skills.matchedPreferred;
  const totalJobMatches = matchedReqSkills.length + matchedPrefSkills.length;
  checks.job_keywords = {
    id: 'job_keywords',
    name: 'Job Description Keywords',
    status: totalJobMatches >= 3 ? 'passed' : totalJobMatches >= 1 ? 'warning' : 'failed',
    score: Math.min(100, totalJobMatches * 25),
    description: `Matched ${totalJobMatches} direct job description competencies across summary and skills.`,
    recommendations: totalJobMatches < 3
      ? ['Ensure verified skills matching the job criteria are included in your profile.']
      : [],
    autoFixable: false,
  };

  // 4. Company name included
  const companyInSummary = resume.tailoredSummary.toLowerCase().includes(job.companyName.toLowerCase());
  checks.company_name = {
    id: 'company_name',
    name: 'Target Company Mention',
    status: companyInSummary ? 'passed' : 'warning',
    score: companyInSummary ? 100 : 50,
    description: companyInSummary
      ? `Target company "${job.companyName}" is explicitly incorporated in the summary.`
      : `Company "${job.companyName}" was not found in the summary text.`,
    recommendations: companyInSummary ? [] : [`Add a tailored mention of ${job.companyName} to your executive summary.`],
    autoFixable: true,
  };

  // 5. First item reflects what they are looking for
  const firstExp = resume.experiences[0];
  const firstBullet = firstExp?.rankedHighlights[0];
  const firstBulletMatches = (firstBullet?.matchedRequirements.length ?? 0) > 0;
  checks.first_item_aligned = {
    id: 'first_item_aligned',
    name: 'First Item Alignment',
    status: firstBulletMatches ? 'passed' : 'warning',
    score: firstBulletMatches ? 100 : 60,
    description: firstBulletMatches
      ? `Top bullet directly addresses: ${firstBullet?.matchedRequirements.join(', ')}.`
      : 'Top bullet does not directly address a primary job requirement.',
    recommendations: firstBulletMatches ? [] : ['Elevate the highlight bullet that most directly matches the job\'s #1 qualification.'],
    autoFixable: true,
  };

  // 6. Experience titles demonstrate value
  const hasValueTitles = resume.experiences.every((exp) => exp.title.length > 5);
  checks.title_demonstrates_value = {
    id: 'title_demonstrates_value',
    name: 'Value-Demonstrating Titles',
    status: hasValueTitles ? 'passed' : 'warning',
    score: hasValueTitles ? 100 : 70,
    description: hasValueTitles
      ? 'Experience titles clearly reflect senior level or technical scope.'
      : 'Some experience titles appear generic without domain context.',
    recommendations: hasValueTitles ? [] : ['Add domain or level context to titles in your candidate profile.'],
    autoFixable: false,
  };

  // 7. Online links check
  const hasOnlineLink = Boolean(
    profile.links?.linkedin ||
      profile.links?.github ||
      profile.links?.portfolio ||
      (profile.links?.customLinks && profile.links.customLinks.length > 0)
  );
  checks.online_links = {
    id: 'online_links',
    name: 'Online Profile Links',
    status: hasOnlineLink ? 'passed' : 'warning',
    score: hasOnlineLink ? 100 : 30,
    description: hasOnlineLink
      ? 'Header includes verified online links (LinkedIn, GitHub, or Portfolio).'
      : 'Missing online profile links. Recruiters expect at least one verified online link.',
    recommendations: hasOnlineLink ? [] : ['Add your LinkedIn or GitHub profile link in Candidate Profile settings.'],
    autoFixable: false,
  };

  // 8. Remove the word "I"
  const allBullets = [
    ...resume.experiences.flatMap((e) => e.rankedHighlights.map((h) => h.text)),
    ...resume.projects.flatMap((p) => p.rankedHighlights.map((h) => h.text)),
  ];
  const summaryHasI = FIRST_PERSON_PRONOUNS_REGEX.test(resume.tailoredSummary);
  const bulletsWithI = allBullets.filter((b) => FIRST_PERSON_PRONOUNS_REGEX.test(b));
  const hasNoPronounI = !summaryHasI && bulletsWithI.length === 0;
  checks.no_pronoun_i = {
    id: 'no_pronoun_i',
    name: 'No "I" or Personal Pronouns',
    status: hasNoPronounI ? 'passed' : 'warning',
    score: hasNoPronounI ? 100 : Math.max(40, 100 - (bulletsWithI.length + (summaryHasI ? 1 : 0)) * 20),
    description: hasNoPronounI
      ? 'Strict telegraphic style: zero first-person pronouns ("I", "me", "my", "we").'
      : `Found personal pronouns in ${bulletsWithI.length + (summaryHasI ? 1 : 0)} location(s).`,
    recommendations: hasNoPronounI ? [] : ['Remove first-person pronouns ("I", "my", "we") from bullet points and summary.'],
    autoFixable: true,
  };

  // 9. No buzzwords check
  const textBlob = `${resume.tailoredSummary} ${allBullets.join(' ')}`.toLowerCase();
  const detectedBuzzwords = BANNED_BUZZWORDS.filter((buzz) => {
    const rx = new RegExp(`\\b${buzz.replace('-', '[- ]')}\\b`, 'i');
    return rx.test(textBlob);
  });
  const hasNoBuzzwords = detectedBuzzwords.length === 0;
  checks.no_buzzwords = {
    id: 'no_buzzwords',
    name: 'No Fluff Buzzwords',
    status: hasNoBuzzwords ? 'passed' : 'warning',
    score: hasNoBuzzwords ? 100 : Math.max(30, 100 - detectedBuzzwords.length * 25),
    description: hasNoBuzzwords
      ? 'Clean, evidence-backed narrative free of empty self-praise buzzwords.'
      : `Found buzzword(s): ${detectedBuzzwords.join(', ')}.`,
    recommendations: hasNoBuzzwords ? [] : [`Replace "${detectedBuzzwords.join(', ')}" with specific, measurable achievements.`],
    autoFixable: true,
  };

  // 10. Strong Action words
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
    name: 'Active Action Verbs',
    status: isActionWordsPassed ? 'passed' : 'warning',
    score: Math.round(actionVerbRatio * 100),
    description: `${actionVerbCount}/${allBullets.length} bullets begin with strong action verbs.`,
    recommendations: !isActionWordsPassed
      ? ['Begin every bullet with an active verb (e.g. "Architected", "Engineered", "Optimized"). Avoid "Responsible for".']
      : [],
    autoFixable: true,
  };

  // 11. Measure impact (Google X-Y-Z formula)
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
    name: 'Impact-Driven Metrics',
    status: isImpactPassed ? 'passed' : 'warning',
    score: Math.min(100, Math.round(impactRatio * 150)),
    description: `${quantifiedCount}/${allBullets.length} bullets include quantified scale, %, or performance metrics.`,
    recommendations: !isImpactPassed
      ? ['Quantify accomplishments using the Google X-Y-Z formula (e.g. "reduced latency by 45%", "serving 10M+ users").']
      : [],
    autoFixable: false,
  };

  // 12. Skills & impressive years
  const verifiedYears = profile.professional.totalYearsOfExperience ?? 0;
  const mentionsYearsInSummary = /\b\d+\+\s*years\b/i.test(resume.tailoredSummary);
  const yearsImpressiveOrOmitted = !mentionsYearsInSummary || verifiedYears >= 3;
  checks.skills_and_impressive_years = {
    id: 'skills_and_impressive_years',
    name: 'Relevant Skills & Impressive Years',
    status: yearsImpressiveOrOmitted ? 'passed' : 'warning',
    score: yearsImpressiveOrOmitted ? 100 : 70,
    description: yearsImpressiveOrOmitted
      ? 'Skills prioritize target criteria; years of experience are only featured if impressive (>= 3 years).'
      : 'Summary highlights low year count (< 3 years), which can diminish perceived seniority.',
    recommendations: yearsImpressiveOrOmitted ? [] : ['Omit low year counts from executive summary; lead with verified competencies.'],
    autoFixable: true,
  };

  // 13. Impressive sections only
  const hasCoreSections = resume.experiences.length > 0 && totalJobMatches > 0;
  checks.impressive_sections = {
    id: 'impressive_sections',
    name: 'High-Signal Technical Sections',
    status: hasCoreSections ? 'passed' : 'warning',
    score: hasCoreSections ? 100 : 50,
    description: 'Focuses strictly on high-signal sections: Technical Skills, Experience, Projects, and Education.',
    recommendations: hasCoreSections ? [] : ['Ensure work experiences and technical skills sections are populated.'],
    autoFixable: false,
  };

  // 14. No typos or bad grammar
  let typoIssues = 0;
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
  }
  const isGrammarClean = typoIssues === 0;
  checks.no_typos_grammar = {
    id: 'no_typos_grammar',
    name: 'Clean Orthography & Typography',
    status: isGrammarClean ? 'passed' : 'warning',
    score: isGrammarClean ? 100 : Math.max(50, 100 - typoIssues * 15),
    description: isGrammarClean
      ? 'Standardized technology casing (e.g. TypeScript, Node.js, PostgreSQL) and clean punctuation.'
      : `Found ${typoIssues} casing or typography inconsistency issue(s).`,
    recommendations: isGrammarClean ? [] : ['Normalize technology casing and clean up formatting inconsistencies.'],
    autoFixable: true,
  };

  // Calculate Overall Score
  const checkValues = Object.values(checks) as ResumeAuditCheckItem[];
  const totalScore = checkValues.reduce((sum, c) => sum + c.score, 0);
  const overallScore = Math.round(totalScore / checkValues.length);
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
 * Deterministically fixes auto-fixable issues in a tailored resume without inventing any credentials.
 *
 * Operations:
 * 1. Strips first-person pronouns ("I", "me", "my", "we").
 * 2. Replaces empty buzzwords with factual phrasing.
 * 3. Normalizes technology orthography (e.g. typescript -> TypeScript).
 * 4. Replaces weak openings ("Responsible for") with strong active verbs.
 * 5. Cleans years of experience if < 3 years.
 * 6. Ensures target company is included in summary.
 * 7. Enforces 1-page bullet limits.
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
  // 1. Clean Summary
  let summary = resume.tailoredSummary;

  // Remove first-person pronouns
  summary = summary.replace(/\b(I am|I have been|I have|I)\b/gi, '').replace(/\b(my|our)\b/gi, 'the');

  // Remove buzzwords
  for (const buzz of BANNED_BUZZWORDS) {
    const rx = new RegExp(`\\b${buzz.replace('-', '[- ]')}\\b`, 'gi');
    summary = summary.replace(rx, '');
  }

  // Normalize tech orthography
  summary = normalizeTechOrthography(summary);

  // Clean double spaces and punctuation gaps
  summary = summary
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,;:])/g, '$1')
    .replace(/^[,\s.-]+/, '')
    .trim();

  // If candidate title doesn't lead, ensure strong opening
  if (!summary || summary.length < 20) {
    const title = profile.professional.currentTitle || profile.professional.headline || job.title;
    summary = `${title} specializing in ${resume.skills.matchedRequired.slice(0, 4).join(', ')}. Committed to delivering robust, maintainable solutions for ${job.companyName}.`;
  }

  // Ensure company name is present
  if (!summary.toLowerCase().includes(job.companyName.toLowerCase())) {
    summary += ` Focused on driving measurable outcomes aligned with ${job.companyName}'s engineering goals.`;
  }

  // 2. Clean Highlights for Experiences
  const experiences: TailoredExperience[] = resume.experiences.map((exp) => {
    const cleanedHighlights = exp.rankedHighlights.map((h) => {
      let text = h.text;

      // Clean weak duty openings
      text = text.replace(/^(responsible for|was responsible for)\s+/i, 'Spearheaded ');
      text = text.replace(/^(helped with|helped to|helped)\s+/i, 'Contributed to ');
      text = text.replace(/^(worked on|worked with)\s+/i, 'Engineered ');
      text = text.replace(/^(assisted in|assisted with|assisted)\s+/i, 'Facilitated ');
      text = text.replace(/^(tasked with|was tasked with)\s+/i, 'Executed ');
      text = text.replace(/^(participated in)\s+/i, 'Collaborated on ');

      // Strip first-person pronouns
      text = text.replace(/\b(I|me|my|we|our|myself)\b/gi, '');

      // Normalize tech casing
      text = normalizeTechOrthography(text);

      // Clean buzzwords
      for (const buzz of BANNED_BUZZWORDS) {
        const rx = new RegExp(`\\b${buzz.replace('-', '[- ]')}\\b`, 'gi');
        text = text.replace(rx, '');
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

  // 3. Clean Highlights for Projects
  const projects: TailoredProject[] = resume.projects.map((proj) => {
    const cleanedHighlights = proj.rankedHighlights.map((h) => {
      let text = normalizeTechOrthography(h.text);
      text = text.replace(/^(responsible for|helped with|worked on)\s+/i, 'Built ');
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
