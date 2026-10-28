/**
 * @fileoverview Dynamic Resume Section and Bullet Selector.
 *
 * Reorders candidate experiences, projects, and skills to highlight relevance to a target
 * job posting without factual exaggeration. Ranks individual accomplishment bullets
 * with direct links to verified evidence nodes in the CandidateProfile and EvidenceGraph (ADR-0004).
 */

import { evidencedStack } from './evidenced-stack.js';
import { extractTechnologies } from '../evidence/parser.js';
import type { JobPosting } from '../job/job-posting.js';
import type { CandidateProfile } from '../candidate/profile.js';
import type { WorkExperience } from '../candidate/experience.js';
import type { CandidateProject } from '../candidate/project.js';
import type { EvidenceGraph } from '../evidence/evidence-graph.js';
import type { EvidenceId } from '../types/ids.js';
import { areCompetenciesEquivalent, normalizeCompetencyToken, findCompetencyPhrases, getCompetencySynonyms } from '../job/synonyms.js';
import type { Requirement } from '../job/requirement.js';
import type { WritingStyleProfile } from '../ai/writing-style.js';
import { applyWritingQualityPassSync } from '../ai/human-answer-pipeline.js';
import type { SkillCategory } from '../candidate/skill.js';
import { categorizeSkill } from '../candidate/skill.js';
import type {
  TailoredResume,
  TailoredExperience,
  TailoredProject,
  TailoredHighlight,
  TailoredSkillsGroup,
  TailoredSkillCategory,
  ResumeTemplateId,
} from './tailoring-types.js';
import {
  auditResumeQuality,
  calculateVerifiedExperienceYears,
  QUANTIFIED_METRIC_REGEX,
  STRONG_ACTION_VERBS,
  normalizeTechOrthography,
} from './resume-rules.js';

/**
 * Configuration options for the resume tailoring pipeline.
 */
export interface ResumeTailoringOptions {
  /** Maximum number of experiences to include (defaults to all or 3 in 1-page mode). */
  readonly maxExperiences?: number;
  /** Maximum number of projects to include (defaults to 3 or 1 in 1-page mode). */
  readonly maxProjects?: number;
  /** Maximum number of bullet highlights per item (defaults to 4). */
  readonly maxBulletsPerItem?: number;
  /** Constrain content budgeting strictly to ensure single-page fit. */
  readonly onePageFit?: boolean;
  /** Selected pre-designed template for layout budgeting. */
  readonly templateId?: ResumeTemplateId;
  /** Candidate's writing style for natural human voice. */
  readonly writingStyle?: WritingStyleProfile;
  /** End the summary with a line naming the company applied to. Defaults to true. */
  readonly mentionCompany?: boolean;
}

/**
 * Checks if a block of text mentions or demonstrates a given competency token.
 */
function textMentionsCompetency(text: string, competency: string): boolean {
  const normText = normalizeCompetencyToken(text);
  const normComp = normalizeCompetencyToken(competency);
  if (!normText || !normComp) {
    return false;
  }
  return normText.includes(normComp) || areCompetenciesEquivalent(normText, normComp);
}

/**
 * The technologies and domains a requirement names, expanded with synonyms. A sentence
 * such as "Experience with Kafka or another message queue" yields kafka, rabbitmq, nats,
 * and so on, so bullets that show any of them count toward the requirement.
 */
function requirementTerms(req: Requirement): ReadonlySet<string> {
  const terms = new Set<string>();
  const phrases = findCompetencyPhrases(`${req.normalizedSkillOrCompetency} ${req.rawText}`);
  const seeds = phrases.length > 0 ? phrases : [normalizeCompetencyToken(req.normalizedSkillOrCompetency)];
  for (const seed of seeds) {
    if (!seed) continue;
    for (const synonym of getCompetencySynonyms(seed)) terms.add(synonym);
  }
  return terms;
}

/** Whole-word test of any term against text. */
function mentionsAny(text: string, terms: ReadonlySet<string>): boolean {
  const haystack = ` ${normalizeCompetencyToken(text)} `;
  for (const term of terms) {
    if (term && haystack.includes(` ${term} `)) return true;
  }
  return false;
}

/** True when a skill is one of the things a requirement asks for. */
function skillSatisfiesRequirement(skillName: string, req: Requirement, terms: ReadonlySet<string>): boolean {
  if (areCompetenciesEquivalent(skillName, req.normalizedSkillOrCompetency)) return true;
  const token = normalizeCompetencyToken(skillName);
  for (const term of terms) {
    if (areCompetenciesEquivalent(token, term)) return true;
  }
  return false;
}

/** Industry wording used in the summary, keyed by the synonym cluster that detects it. */
const DOMAIN_LABELS: ReadonlyArray<{ seed: string; label: string }> = [
  { seed: 'fintech', label: 'payments' },
  { seed: 'healthtech', label: 'healthcare' },
  { seed: 'ecommerce', label: 'e-commerce' },
];

/** Joins ["a", "b", "c"] as "a, b and c". */
function joinNatural(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** Sorts roles newest first: current roles, then by start date. Recruiters read resumes this way. */
function byRecency(a: { isCurrent: boolean; startDate: string }, b: { isCurrent: boolean; startDate: string }): number {
  if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
  return (b.startDate || '').localeCompare(a.startDate || '');
}

/**
 * Resolves the source EvidenceId for a given bullet from the evidence graph or experience refs.
 */
function resolveBulletEvidenceId(
  bulletText: string,
  bulletIndex: number,
  item: WorkExperience | CandidateProject,
  graph?: EvidenceGraph
): EvidenceId | undefined {
  if (graph) {
    for (const [id, evidence] of graph.evidenceMap.entries()) {
      if (evidence.textSnippet === bulletText) {
        return id;
      }
      if (
        evidence.source.sourceId === item.id &&
        evidence.source.metadata?.bulletIndex === String(bulletIndex)
      ) {
        return id;
      }
    }
  }

  if (item.evidenceRefs && item.evidenceRefs.length > bulletIndex) {
    return item.evidenceRefs[bulletIndex];
  }

  return undefined;
}

/**
 * Converts a raw profile bullet into a sentence suitable for a summary.
 *
 * Duty-style openings ("Responsible for ...") are dropped because they read as a job
 * description rather than an accomplishment; such bullets are better placed in the
 * experience section where their context is visible.
 */
function toSummaryAchievement(text: string): string | undefined {
  const trimmed = text.trim().replace(/\.$/, '');
  if (trimmed.length === 0) return undefined;
  if (/^(responsible for|was responsible for|helped|worked on|assisted|participated|tasked with)\b/i.test(trimmed)) {
    return undefined;
  }
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}.`;
}

/**
 * Tailors candidate resume sections and accomplishment bullets against target job criteria.
 *
 * Grounding Invariant (ADR-0004):
 * - Never invents qualifications, technologies, or achievements.
 * - Only reorders and ranks existing, verified experiences and projects.
 * - Categorizes skills strictly from the candidate's existing verified skill pool.
 *
 * @param job Target job posting.
 * @param profile Candidate profile aggregate.
 * @param graph Optional evidence graph for deep provenance linking.
 * @param options Tailoring configuration options.
 * @returns Complete tailored resume structure.
 */
export function tailorCandidateResume(
  job: JobPosting,
  profile: CandidateProfile,
  graph?: EvidenceGraph,
  options?: ResumeTailoringOptions
): TailoredResume {
  const isOnePage = options?.onePageFit ?? false;
  const maxBullets = options?.maxBulletsPerItem ?? (isOnePage ? 3 : 4);
  const maxProjects = options?.maxProjects ?? (isOnePage ? 1 : 3);
  const maxExperiences = options?.maxExperiences ?? (isOnePage ? Math.min(3, profile.experiences.length) : profile.experiences.length);

  // Partition skills by job requirement alignment
  const matchedRequiredSet = new Set<string>();
  const matchedPreferredSet = new Set<string>();
  const matchedAllSet = new Set<string>();

  const termsByRequirement = new Map(job.requirements.map((req) => [req.id, requirementTerms(req)] as const));
  // Words from the posting's own description ("ledger", "payouts") that also describe a
  // domain, so bullets about that kind of work rank higher even when no bullet names a
  // listed requirement.
  const descriptionTerms = new Set<string>();
  for (const phrase of findCompetencyPhrases(job.rawDescription || '')) {
    for (const synonym of getCompetencySynonyms(phrase)) descriptionTerms.add(synonym);
  }

  for (const skill of profile.skills) {
    let matched = false;
    for (const req of job.requirements) {
      if (skillSatisfiesRequirement(skill.name, req, termsByRequirement.get(req.id) ?? new Set())) {
        matched = true;
        matchedAllSet.add(skill.name);
        if (req.importance === 'required' || req.importance === 'strongly_preferred') {
          matchedRequiredSet.add(skill.name);
        } else {
          matchedPreferredSet.add(skill.name);
        }
        break;
      }
    }
    if (!matched) {
      // Check if skill appears in job description text
      if (textMentionsCompetency(job.rawDescription, skill.name)) {
        matchedPreferredSet.add(skill.name);
        matchedAllSet.add(skill.name);
      }
    }
  }

  const additionalSkills = profile.skills
    .map((s) => s.name)
    .filter((name) => !matchedAllSet.has(name));

  // Dynamically group candidate skills into standard domain buckets
  const categoryDefinitions: Array<{ label: string; matches: (cat: SkillCategory) => boolean }> = [
    { label: 'Languages', matches: (cat) => cat === 'language' },
    { label: 'Frameworks', matches: (cat) => cat === 'framework' || cat === 'library' },
    { label: 'Databases', matches: (cat) => cat === 'database' },
    { label: 'Cloud & DevOps', matches: (cat) => cat === 'cloud_infrastructure' || cat === 'devops_tool' },
    { label: 'Systems & APIs', matches: (cat) => cat === 'architecture_pattern' },
    { label: 'Other', matches: (cat) => cat === 'domain_expertise' || cat === 'testing_qa' || cat === 'methodology' || cat === 'soft_skill' },
  ];

  const domainCategories: TailoredSkillCategory[] = [];
  const allocatedSkillNames = new Set<string>();

  for (const def of categoryDefinitions) {
    const bucketSkills = profile.skills.filter((s) => {
      const cat = s.category || categorizeSkill(s.name);
      return def.matches(cat);
    });

    if (bucketSkills.length > 0) {
      // Sort: required first, then preferred, then remainder
      const sorted = [...bucketSkills].sort((a, b) => {
        const scoreA = matchedRequiredSet.has(a.name) ? 2 : (matchedPreferredSet.has(a.name) ? 1 : 0);
        const scoreB = matchedRequiredSet.has(b.name) ? 2 : (matchedPreferredSet.has(b.name) ? 1 : 0);
        return scoreB - scoreA;
      });

      const names = sorted.map((s) => s.name);
      for (const n of names) allocatedSkillNames.add(n);

      domainCategories.push({
        category: def.label,
        skills: names,
      });
    }
  }

  const unallocated = profile.skills.filter((s) => !allocatedSkillNames.has(s.name)).map((s) => s.name);
  if (unallocated.length > 0) {
    const other = domainCategories.find((c) => c.category === 'Other');
    if (other) {
      domainCategories[domainCategories.indexOf(other)] = { category: 'Other', skills: [...other.skills, ...unallocated] };
    } else {
      domainCategories.push({ category: 'Other', skills: unallocated });
    }
  }

  const tailoredSkills: TailoredSkillsGroup = {
    matchedRequired: Array.from(matchedRequiredSet),
    matchedPreferred: Array.from(matchedPreferredSet),
    additionalSkills,
    domainCategories,
  };

  // Rank and filter work experiences based on requirement overlap
  const tailoredExperiences: TailoredExperience[] = [];

  for (const exp of profile.experiences) {
    let expScore = 0;
    const rankedBullets: Array<{
      highlight: TailoredHighlight;
      relevanceScore: number;
    }> = [];

    // Evaluate each highlight bullet against requirements
    for (const [index, bullet] of exp.highlights.entries()) {
      const matchedReqs: string[] = [];
      let bulletScore = 0;

      for (const req of job.requirements) {
        const terms = termsByRequirement.get(req.id) ?? new Set<string>();
        if (textMentionsCompetency(bullet, req.normalizedSkillOrCompetency) || mentionsAny(bullet, terms)) {
          matchedReqs.push(req.normalizedSkillOrCompetency);
          bulletScore += req.importance === 'required' || req.importance === 'strongly_preferred' ? 10 : 5;
        }
      }
      if (mentionsAny(bullet, descriptionTerms)) {
        bulletScore += 6;
      }

      // Boost bullets with quantified metrics (+8 points for proven impact)
      if (QUANTIFIED_METRIC_REGEX.test(bullet)) {
        bulletScore += 8;
      }

      // Boost bullets starting with strong action verbs (+5 points)
      const firstWord = bullet.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, '') || '';
      if (STRONG_ACTION_VERBS.has(firstWord)) {
        bulletScore += 5;
      }

      const evidenceId = resolveBulletEvidenceId(bullet, index, exp, graph);

      rankedBullets.push({
        highlight: {
          text: bullet,
          matchedRequirements: matchedReqs,
          sourceEvidenceId: evidenceId,
          confidenceScore: evidenceId ? 0.95 : 0.85,
        },
        relevanceScore: bulletScore,
      });

      expScore += bulletScore;
    }

    // Match technologies used
    for (const tech of exp.technologiesUsed) {
      for (const req of job.requirements) {
        if (skillSatisfiesRequirement(tech, req, termsByRequirement.get(req.id) ?? new Set())) {
          expScore += req.importance === 'required' || req.importance === 'strongly_preferred' ? 8 : 4;
          break;
        }
      }
    }

    // Sort bullets: highest relevance first, preserve relative order for ties
    rankedBullets.sort((a, b) => b.relevanceScore - a.relevanceScore);
    const selectedHighlights = rankedBullets.slice(0, maxBullets).map((b) => b.highlight);

    const maxPossibleExpScore = Math.max(1, job.requirements.length * 15);
    const normalizedExpScore = Math.min(100, Math.round((expScore / maxPossibleExpScore) * 100));

    tailoredExperiences.push({
      experienceId: exp.id,
      company: exp.company,
      title: exp.title,
      startDate: exp.startDate,
      endDate: exp.endDate,
      isCurrent: exp.isCurrent,
      relevanceScore: normalizedExpScore,
      rankedHighlights: selectedHighlights,
    });
  }

  // Roles stay newest first. Reordering jobs by relevance makes a resume look like it is
  // hiding something; relevance is expressed by which bullets lead each role instead.
  // When space is limited, the least relevant older roles are the ones dropped.
  tailoredExperiences.sort(byRecency);
  const keptIds = new Set(
    [...tailoredExperiences]
      .sort((a, b) => b.relevanceScore - a.relevanceScore || byRecency(a, b))
      .slice(0, maxExperiences)
      .map((exp) => exp.experienceId)
  );
  const finalExperiences = tailoredExperiences.filter((exp) => keptIds.has(exp.experienceId));

  // Rank and filter candidate projects based on requirement overlap
  const tailoredProjects: TailoredProject[] = [];

  for (const proj of profile.projects) {
    let projScore = 0;
    const rankedBullets: Array<{
      highlight: TailoredHighlight;
      relevanceScore: number;
    }> = [];

    for (const [index, bullet] of proj.highlights.entries()) {
      const matchedReqs: string[] = [];
      let bulletScore = 0;

      for (const req of job.requirements) {
        const terms = termsByRequirement.get(req.id) ?? new Set<string>();
        if (textMentionsCompetency(bullet, req.normalizedSkillOrCompetency) || mentionsAny(bullet, terms)) {
          matchedReqs.push(req.normalizedSkillOrCompetency);
          bulletScore += req.importance === 'required' || req.importance === 'strongly_preferred' ? 10 : 5;
        }
      }

      const evidenceId = resolveBulletEvidenceId(bullet, index, proj, graph);

      rankedBullets.push({
        highlight: {
          text: bullet,
          matchedRequirements: matchedReqs,
          sourceEvidenceId: evidenceId,
          confidenceScore: evidenceId ? 0.95 : 0.85,
        },
        relevanceScore: bulletScore,
      });

      projScore += bulletScore;
    }

    if (mentionsAny(`${proj.title} ${proj.description}`, descriptionTerms)) projScore += 4;
    for (const tech of proj.technologiesUsed) {
      for (const req of job.requirements) {
        if (skillSatisfiesRequirement(tech, req, termsByRequirement.get(req.id) ?? new Set())) {
          projScore += req.importance === 'required' || req.importance === 'strongly_preferred' ? 8 : 4;
          break;
        }
      }
    }

    rankedBullets.sort((a, b) => b.relevanceScore - a.relevanceScore);
    const selectedHighlights = rankedBullets.slice(0, maxBullets).map((b) => b.highlight);

    const maxPossibleProjScore = Math.max(1, job.requirements.length * 15);
    const normalizedProjScore = Math.min(100, Math.round((projScore / maxPossibleProjScore) * 100));

    tailoredProjects.push({
      projectId: proj.id,
      title: proj.title,
      role: proj.role,
      relevanceScore: normalizedProjScore,
      technologiesUsed: proj.technologiesUsed,
      rankedHighlights: selectedHighlights,
    });
  }

  // Sort projects descending by relevanceScore
  tailoredProjects.sort((a, b) => b.relevanceScore - a.relevanceScore);
  const finalProjects = tailoredProjects.slice(0, maxProjects);

  const tailoredSummary = composeSummary(profile, tailoredSkills, finalExperiences, job, options?.mentionCompany ?? true);

  const finalSummary = options?.writingStyle
    ? applyWritingQualityPassSync(tailoredSummary, options.writingStyle).cleanedText
    : tailoredSummary;

  const selectedTemplate = options?.templateId || 'modern';
  const preliminaryResume: TailoredResume = {
    targetJobTitle: job.title,
    companyName: job.companyName,
    tailoredSummary: finalSummary,
    skills: tailoredSkills,
    experiences: finalExperiences,
    projects: finalProjects,
    templateId: selectedTemplate,
    createdAt: new Date().toISOString(),
  };

  const qualityAudit = auditResumeQuality(preliminaryResume, profile, job, selectedTemplate);

  return {
    ...preliminaryResume,
    qualityAudit,
  };
}

/**
 * Kinds of system the posting asks for ("Distributed Systems") that one of
 * the candidate's own bullets spells out, every word in the same bullet ("Engineered a
 * distributed multiplayer system"). A skills-list entry alone does not count, and loose
 * synonyms do not either, because the summary states these as the candidate's work.
 */
function evidencedConcepts(profile: CandidateProfile, asked: readonly string[], limit: number): string[] {
  const bullets = profile.experiences
    .flatMap((exp) => exp.highlights)
    .concat(profile.projects.flatMap((project) => [...project.highlights, project.description]))
    .map((text) => new Set(normalizeCompetencyToken(text).split(' ').filter(Boolean).map((word) => word.slice(0, 5))));
  const out: string[] = [];
  for (const skill of asked) {
    if (out.length >= limit) break;
    if (extractTechnologies(skill).length > 0) continue;
    const words = normalizeCompetencyToken(skill).split(' ').filter((word) => word.length > 2);
    if (words.length === 0 || words.length > 3) continue;
    if (bullets.some((stems) => words.every((word) => stems.has(word.slice(0, 5))))) out.push(skill.toLowerCase());
  }
  return out;
}

/** Past-tense opening verbs a resume bullet starts with ("Built", "Designed"). */
const PAST_VERB = /^(?:[A-Z][a-z]+ed|Built|Led|Wrote|Ran|Made|Drove|Won|Grew|Cut|Shipped|Set|Took|Brought|Rebuilt|Held|Kept|Sold|Taught|Spun|Stood|Overhauled)\b/;


/** "at CoreServe", or "as a freelancer" for freelance and self-employed work. */
function whereDone(company: string | undefined): string {
  if (!company) return '';
  return /freelanc|self[- ]employed|independent|contract(or)?$/i.test(company) ? ' as a freelancer' : ` at ${company}`;
}

/**
 * Turns one of the candidate's bullets into a summary clause: its own verb and object,
 * minus a trailing tool list (the first sentence already names the stack) and any second
 * clause after a semicolon. Only removes words; never adds any.
 */
function bulletClause(text: string): { verb: string; rest: string } | undefined {
  let line = text.trim().replace(/[.;]+$/, '');
  if (!PAST_VERB.test(line)) return undefined;
  line = line.split(/;\s+/)[0]!;
  const tool = line.search(/,?\s+(?:using|with|in|on)\s+(?:[A-Z][\w.+#-]*)(?:,\s*[A-Z][\w.+#-]*)*(?:,?\s+and\s+[A-Z][\w.+#-]*)?\s*$/);
  if (tool > 45) line = line.slice(0, tool);
  // Long lines are cut at a phrase boundary ("..., and automate order confirmation") so
  // the summary stays readable; dropping a trailing phrase never adds a claim.
  if (line.length > 110) {
    const head = line.slice(0, 110);
    const comma = head.lastIndexOf(', ');
    const and = head.search(/ and (?=[a-z])(?![\s\S]* and [a-z])/);
    const cut = comma > 50 ? comma : and > 50 ? and : -1;
    if (cut > 0) line = line.slice(0, cut);
  }
  const [verb, ...rest] = line.split(' ');
  return verb && rest.length > 2 ? { verb, rest: rest.join(' ') } : undefined;
}

/**
 * Writes the summary the way a person would, in up to four short sentences:
 * 1. Role, years, the kind of systems, and the stack the posting asks for.
 * 2. Their strongest line for this job, in their own words, with where they did it.
 * 3. A second line with a number, when the first had none.
 * 4. Optionally, the company they are applying to.
 *
 * Every fact comes from the profile. Sentence 2 used to open "At CoreServe, engineered
 * ...", a fragment with no subject that read as machine-written; now the verb leads and
 * the employer follows ("Most recently designed ... at CoreServe.").
 */
function composeSummary(
  profile: CandidateProfile,
  skills: TailoredSkillsGroup,
  experiences: readonly TailoredExperience[],
  job: Pick<JobPosting, 'companyName' | 'rawDescription'>,
  mentionCompany: boolean
): string {
  const latest = experiences[0];
  const role = (profile.professional.currentTitle || latest?.title || profile.professional.headline || '').trim();
  const years = Math.floor(
    Math.max(calculateVerifiedExperienceYears(profile.experiences), profile.professional.totalYearsOfExperience ?? 0)
  );

  const allWork = profile.experiences
    .flatMap((exp) => [exp.title, ...exp.highlights, ...exp.technologiesUsed])
    .concat(profile.projects.flatMap((project) => [project.title, project.description]))
    .join(' \n ');
  const domains = DOMAIN_LABELS.filter(({ seed }) => mentionsAny(allWork, getCompetencySynonyms(seed))).map(({ label }) => label);

  // Only technologies the candidate's jobs show, led by the ones this posting asks for.
  const stack = evidencedStack(profile, [...skills.matchedRequired, ...skills.matchedPreferred], 3);

  // A kind of system the posting asks for and the candidate's bullets show joins the list
  // ("payments, e-commerce and distributed systems"), so the summary speaks to this job.
  const concepts = evidencedConcepts(
    profile,
    [...skills.matchedRequired, ...skills.matchedPreferred].filter((skill) => /\bsystems?$/i.test(skill.trim())),
    1
  );
  const systemKinds = [...domains.slice(0, 2), ...concepts.map((concept) => concept.replace(/\s*systems?$/, ''))].filter(
    (kind, index, all) => kind && all.indexOf(kind) === index
  );
  const work = systemKinds.length > 0 ? `${joinNatural(systemKinds)} systems` : 'software';
  const stackPhrase = stack.length > 0 ? ` in ${joinNatural(stack)}` : '';
  const opener = role || 'Software Engineer';
  const sentences = [
    years >= 2
      ? `${opener} with ${years} years of experience building ${work}${stackPhrase}.`
      : `${opener} building ${work}${stackPhrase}.`,
  ];

  // Each role's first ranked bullet is its best match for this job; across the three most
  // recent roles take the strongest, breaking ties toward a measurable result.
  // Words that carry meaning in the posting ("payments", "clusters", "ledger"), so a line
  // about the same kind of work beats one that only shares a tool.
  const postingWords = new Set(
    (job.rawDescription ?? '')
      .toLowerCase()
      .match(/[a-z][a-z-]{5,}/g)
      ?.map((word) => word.slice(0, 6)) ?? []
  );
  const overlap = (text: string) => {
    const words = new Set((text.toLowerCase().match(/[a-z][a-z-]{5,}/g) ?? []).map((word) => word.slice(0, 6)));
    let shared = 0;
    for (const word of words) if (postingWords.has(word)) shared += 1;
    return Math.min(1.5, shared / 4);
  };
  // The industry the posting is in (a bank, a health company): a line from the same
  // industry is the one a recruiter there wants to read first.
  const postingDomains = DOMAIN_LABELS.filter(({ seed }) => mentionsAny(`${job.rawDescription ?? ''}`, getCompetencySynonyms(seed)));
  const domainBonus = (text: string) =>
    postingDomains.some(({ seed }) => mentionsAny(text, getCompetencySynonyms(seed))) ? 1.5 : 0;
  const candidates = experiences
    .slice(0, 4)
    .flatMap((exp, index) => exp.rankedHighlights.slice(0, 2).map((top, rank) => ({ exp, index, rank, top })))
    .map(({ exp, index, rank, top }) => ({
      exp,
      index,
      text: top.text,
      hasNumber: QUANTIFIED_METRIC_REGEX.test(top.text),
      score:
        top.matchedRequirements.length +
        (QUANTIFIED_METRIC_REGEX.test(top.text) ? 0.5 : 0) +
        overlap(top.text) +
        domainBonus(top.text) -
        rank * 0.25 -
        index * 0.1,
    }))
    .filter((item) => toSummaryAchievement(item.text) !== undefined);
  const ranked = [...candidates].sort((a, b) => b.score - a.score);
  const pick = ranked[0];

  if (pick) {
    const clause = bulletClause(pick.text);
    if (!clause) {
      sentences.push(toSummaryAchievement(pick.text)!);
    } else {
      // Two results from two employers in one plain sentence reads like a person wrote it;
      // a lone "At X, engineered ..." fragment did not. Prefer a second line with a number.
      const others = ranked.filter((item) => item !== pick && item.exp.company !== pick.exp.company);
      // A second line only when it is about as relevant, or has a number to show.
      const second = others.find((item) => item.hasNumber) ?? others.find((item) => item.score >= pick.score - 0.5);
      const secondClause = second ? bulletClause(second.text) : undefined;
      const first = `${clause.verb} ${clause.rest}${whereDone(pick.exp.company)}`;
      const combined = secondClause
        ? `${first}, and ${secondClause.verb.toLowerCase()} ${secondClause.rest}${whereDone(second!.exp.company)}.`
        : '';
      sentences.push(combined && combined.length <= 200 ? combined : `${first}.`);
    }
  }

  // The cheat sheet's "include the company name": one plain line of intent, no praise.
  if (mentionCompany && job.companyName && !/^company$/i.test(job.companyName)) {
    sentences.push(`Looking to bring this work to ${job.companyName}.`);
  }

  return normalizeTechOrthography(sentences.join(' '));
}
