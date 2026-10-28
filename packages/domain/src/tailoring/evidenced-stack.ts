/**
 * @fileoverview Which technologies a candidate can honestly say they work in.
 *
 * A summary line like "building payments systems in Rust and PostgreSQL" is a claim about
 * the candidate's jobs, so a technology only qualifies when a role's own text or stack
 * names it. Listing Go under "Skills" does not let ApplyKit write "mostly in Go" for a
 * candidate whose jobs are all in Rust. Concepts ("Distributed Systems", "System Design")
 * are not technologies and never complete the phrase "mostly in ...".
 */

import type { CandidateProfile } from '../candidate/profile.js';
import type { WorkExperience } from '../candidate/experience.js';
import { getCompetencySynonyms, normalizeCompetencyToken } from '../job/synonyms.js';

/** Skill categories that name a technology a person "works in". */
const TECHNOLOGY_CATEGORIES: ReadonlySet<string> = new Set(['language', 'framework', 'library', 'database', 'cloud_infrastructure', 'devops_tool']);

function roleMentions(exp: WorkExperience, skillName: string): boolean {
  const haystack = ` ${normalizeCompetencyToken([exp.title, ...exp.technologiesUsed, ...exp.highlights].join(' \n '))} `;
  return [...getCompetencySynonyms(skillName)].some((term) => term.length > 0 && haystack.includes(` ${term} `));
}

/**
 * Technologies the candidate's roles actually show, most relevant first.
 *
 * @param preferred Names to put first when evidenced (for example, the ones a job asks for).
 * @param limit Maximum number of names to return.
 */
export function evidencedStack(profile: CandidateProfile, preferred: readonly string[] = [], limit = 3): string[] {
  const experiences = profile.experiences ?? [];
  const technologies = profile.skills.filter((skill) => TECHNOLOGY_CATEGORIES.has(skill.category));
  const roleCount = new Map<string, number>();
  for (const skill of technologies) {
    const count = experiences.filter((exp) => roleMentions(exp, skill.name)).length;
    if (count > 0) roleCount.set(skill.name, count);
  }

  const byName = (name: string) =>
    technologies.find((skill) => normalizeCompetencyToken(skill.name) === normalizeCompetencyToken(name))?.name;
  const ordered: string[] = [];
  for (const name of preferred) {
    const canonical = byName(name);
    if (canonical && roleCount.has(canonical) && !ordered.includes(canonical)) ordered.push(canonical);
  }
  const rest = [...roleCount.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  for (const name of rest) if (!ordered.includes(name)) ordered.push(name);
  return ordered.slice(0, limit);
}

/**
 * How to introduce a role in a sentence. "Freelance" is a way of working, not an
 * employer, so "At Freelance, I built..." becomes "As a freelancer, I built...".
 */
export function roleLeadIn(company: string | undefined): string {
  const name = (company ?? '').trim();
  if (!name) return '';
  if (/^(freelance|freelancer|self[\s-]?employed|independent( contractor)?|contract(or)?|consultant|various clients|multiple clients)$/i.test(name)) {
    return 'As a freelancer, ';
  }
  return `At ${name}, `;
}
