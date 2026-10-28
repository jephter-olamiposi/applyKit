/**
 * @fileoverview Evidence-Grounded Cover Letter Generator.
 *
 * Builds short, plain cover letters from the candidate's own resume (ADR-0004). Every
 * achievement and metric cited is a resume bullet linked to its Evidence record.
 */

import { evidencedStack, roleLeadIn } from './evidenced-stack.js';
import type { JobPosting } from '../job/job-posting.js';
import type { CandidateProfile } from '../candidate/profile.js';
import type { EvidenceGraph } from '../evidence/evidence-graph.js';
import type { EvidenceId, ClaimId } from '../types/ids.js';
import { areCompetenciesEquivalent, normalizeCompetencyToken, findCompetencyPhrases, getCompetencySynonyms } from '../job/synonyms.js';
import { calculateVerifiedExperienceYears } from './resume-rules.js';
import { getPreferredOrLegalName } from '../candidate/identity.js';
import type { WritingStyleProfile } from '../ai/writing-style.js';
import { applyWritingQualityPassSync } from '../ai/human-answer-pipeline.js';
import type { CandidateCultureAlignment } from '../job/company-culture.js';
import type {
  TailoredCoverLetter,
  CoverLetterParagraph,
  AccomplishmentCitation,
} from './tailoring-types.js';

/**
 * Options for configuring cover letter generation.
 */
export interface CoverLetterOptions {
  /** Specific hiring manager or team name (defaults to 'Hiring Team'). */
  readonly recipient?: string;
  /** Tone customization preference. */
  readonly tone?: 'technical' | 'conversational' | 'executive';
  /** Candidate's writing style for natural human voice. */
  readonly writingStyle?: WritingStyleProfile;
  /** Optional cultural and mission alignment analysis to weave into narrative. */
  readonly cultureAlignment?: CandidateCultureAlignment;
}

/** Past-tense verbs that can follow "I" directly when a resume bullet is quoted in prose. */
const IRREGULAR_PAST = new Set([
  'built', 'led', 'ran', 'wrote', 'cut', 'made', 'drove', 'grew', 'took', 'set', 'brought', 'taught', 'won',
  'kept', 'sent', 'spent', 'began', 'became', 'chose', 'found', 'gave', 'held', 'met', 'paid', 'sold', 'told',
  'oversaw', 'rebuilt', 'rewrote', 'shipped', 'saw', 'put', 'split', 'shut',
]);

/** True when the first word reads as a past-tense action ("Built", "Designed", "Cut"). */
function startsWithPastTense(text: string): boolean {
  const first = text.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, '') ?? '';
  return IRREGULAR_PAST.has(first) || (/ed$/.test(first) && first.length > 3);
}

/**
 * Turns a telegraphic resume bullet into a first-person clause. "Built a ledger" becomes
 * "I built a ledger"; a bullet that does not start with a past-tense verb is quoted as its
 * own sentence rather than forced into broken grammar.
 */
function bulletAsSentence(bullet: string, company: string | undefined): string {
  const clean = bullet.trim().replace(/[.;]+$/, '');
  if (!clean) return '';
  const where = roleLeadIn(company);
  if (startsWithPastTense(clean)) {
    return `${where}I ${clean.charAt(0).toLowerCase()}${clean.slice(1)}.`;
  }
  return where ? `${where.replace(/, $/, ':')} ${clean}.` : `${clean.charAt(0).toUpperCase()}${clean.slice(1)}.`;
}

/** "Northwind Payments" -> "Northwind Payments'" and "Acme" -> "Acme's". */
export function possessive(name: string): string {
  const trimmed = name.trim();
  return /s$/i.test(trimmed) ? `${trimmed}'` : `${trimmed}'s`;
}

/** Joins ["a", "b", "c"] as "a, b and c". */
function joinNatural(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

const DOMAIN_LABELS: ReadonlyArray<{ seed: string; label: string }> = [
  { seed: 'fintech', label: 'payments' },
  { seed: 'healthtech', label: 'healthcare' },
  { seed: 'ecommerce', label: 'e-commerce' },
];

/** Whole-word test of any synonym of the seed against the text. */
function mentionsDomain(text: string, seed: string): boolean {
  const haystack = ` ${normalizeCompetencyToken(text)} `;
  for (const term of getCompetencySynonyms(seed)) {
    if (term && haystack.includes(` ${term} `)) return true;
  }
  return false;
}

/**
 * Picks the candidate's bullets that best fit the posting, each tied to its role and its
 * evidence node. Bullets naming a requirement or the posting's domain rank first; a
 * measurable result breaks ties.
 */
function selectTopVerifiableAccomplishments(
  job: JobPosting,
  profile: CandidateProfile,
  graph: EvidenceGraph,
  limit = 2
): Array<AccomplishmentCitation & { company?: string }> {
  // One term set per requirement and per domain the posting mentions, so a bullet scores
  // by how many distinct asks it answers rather than how many synonyms it happens to use.
  const termSets = (phrases: readonly string[]) =>
    phrases.map((phrase) => getCompetencySynonyms(phrase)).filter((set) => set.size > 0);
  const requirementTermSets = job.requirements
    .filter((req) => req.category !== 'experience_level')
    .map((req) => new Set(termSets(findCompetencyPhrases(`${req.normalizedSkillOrCompetency} ${req.rawText}`)).flatMap((set) => [...set])));
  const descriptionTermSets = termSets(findCompetencyPhrases(job.rawDescription || ''));
  const hits = (text: string, sets: ReadonlyArray<ReadonlySet<string>>) => {
    const haystack = ` ${normalizeCompetencyToken(text)} `;
    return sets.filter((set) => [...set].some((term) => term && haystack.includes(` ${term} `))).length;
  };

  const jobDomainText = `${job.title} ${job.companyName ?? ''} ${job.rawDescription || ''}`;
  const jobDomains = DOMAIN_LABELS.filter(({ seed }) => mentionsDomain(jobDomainText, seed)).map(({ seed }) => seed);

  const evidenceBySnippet = new Map<string, EvidenceId>();
  for (const [id, evidence] of graph.evidenceMap.entries()) {
    evidenceBySnippet.set(evidence.textSnippet.trim(), id);
  }

  const scored: Array<{ citation: AccomplishmentCitation & { company?: string }; score: number; order: number }> = [];
  let order = 0;
  const experiences = [...profile.experiences].sort((a, b) =>
    a.isCurrent !== b.isCurrent ? (a.isCurrent ? -1 : 1) : (b.startDate || '').localeCompare(a.startDate || '')
  );
  for (const exp of experiences) {
    for (const [index, bullet] of exp.highlights.entries()) {
      const evidenceId = evidenceBySnippet.get(bullet.trim()) ?? exp.evidenceRefs?.[index];
      let claimId: ClaimId | undefined;
      if (evidenceId) {
        claimId = graph.claims.find((claim) => claim.supportedByEvidenceIds.includes(evidenceId))?.id;
      }
      const score =
        hits(bullet, requirementTermSets) * 10 +
        hits(bullet, descriptionTermSets) * 6 +
        // A bank should hear about payments work first, a health company about health work.
        jobDomains.filter((seed) => mentionsDomain(bullet, seed)).length * 12 +
        (/\b(\d+[%kKmMbB]?|\$\d+|\d+\+)\b/.test(bullet) ? 5 : 0) +
        (startsWithPastTense(bullet) ? 2 : 0);
      scored.push({
        citation: { claimText: bullet, evidenceId, claimId, sourceSnippet: bullet, company: exp.company || undefined },
        score,
        order: order++,
      });
    }
  }

  scored.sort((a, b) => b.score - a.score || a.order - b.order);
  return scored.slice(0, limit).map((entry) => entry.citation);
}

/**
 * Writes a short cover letter that sounds like the candidate, not a template.
 *
 * Shape: one line on the role and who the candidate is, two concrete results quoted from
 * the resume, and a plain close. Three rules keep it honest and human:
 * - Every claim is either a fact from the profile (title, years from dated roles, stack)
 *   or a resume bullet quoted with its evidence id.
 * - Nothing about the employer is asserted beyond what the posting itself says.
 * - No stock phrases ("I am writing to express my strong interest", "Furthermore",
 *   "verified background") and no em dashes; see STOCK_LETTER_PHRASES.
 *
 * @param job Target job posting.
 * @param profile Candidate profile aggregate.
 * @param graph Evidence graph containing verified candidate claims and snippets.
 * @param options Generation configuration options.
 * @returns Complete tailored cover letter structure.
 */
export function generateGroundedCoverLetter(
  job: JobPosting,
  profile: CandidateProfile,
  graph: EvidenceGraph,
  options?: CoverLetterOptions
): TailoredCoverLetter {
  const candidateName = getPreferredOrLegalName(profile.identity) || '';
  // Page readers fall back to "Unknown Company" when a site hides the employer; a letter
  // must never address that placeholder, so it is treated as no company at all.
  const company = /^\s*(unknown company)?\s*$/i.test(job.companyName ?? '') ? '' : job.companyName.trim();
  const recipient = options?.recipient || (company ? `${company} team` : 'Hiring team');
  const years = Math.floor(calculateVerifiedExperienceYears(profile.experiences));
  const writingStyle = options?.writingStyle;

  // Technologies the posting asks for come first, but only ones the candidate's jobs show:
  // a skills-list entry alone does not support "mostly in Go".
  const asked: string[] = [];
  for (const skill of profile.skills) {
    for (const req of job.requirements) {
      const phrases = findCompetencyPhrases(`${req.normalizedSkillOrCompetency} ${req.rawText}`);
      if (
        areCompetenciesEquivalent(skill.name, req.normalizedSkillOrCompetency) ||
        phrases.some((phrase) => areCompetenciesEquivalent(skill.name, phrase))
      ) {
        if (!asked.includes(skill.name)) asked.push(skill.name);
        break;
      }
    }
  }
  const stack = evidencedStack(profile, asked, 3);

  const latest = [...profile.experiences].sort((a, b) =>
    a.isCurrent !== b.isCurrent ? (a.isCurrent ? -1 : 1) : (b.startDate || '').localeCompare(a.startDate || '')
  )[0];
  const role = (profile.professional.currentTitle || latest?.title || profile.professional.headline || '').trim();
  const workText = profile.experiences.flatMap((exp) => [exp.title, ...exp.highlights]).join(' \n ');
  const jobText = `${job.title} ${job.rawDescription || ''}`;
  const sharedDomains = DOMAIN_LABELS.filter(({ seed }) => mentionsDomain(workText, seed) && mentionsDomain(jobText, seed)).map(
    ({ label }) => label
  );
  const candidateDomains = DOMAIN_LABELS.filter(({ seed }) => mentionsDomain(workText, seed)).map(({ label }) => label);

  // Opening: the role, who is applying, and the one honest reason it fits.
  const intro: string[] = [company ? `I'd like to apply for the ${job.title} role at ${company}.` : `I'd like to apply for the ${job.title} role.`];
  const who = role ? (/^[aeiou]/i.test(role) ? `I'm an ${role.toLowerCase()}` : `I'm a ${role.toLowerCase()}`) : `I'm an engineer`;
  const domainsPhrase = candidateDomains.length > 0 ? ` building ${joinNatural(candidateDomains.slice(0, 2))} systems` : '';
  const stackPhrase = stack.length > 0 ? `, mostly in ${joinNatural(stack.slice(0, 3))}` : '';
  intro.push(years >= 2 ? `${who} and I've spent the last ${years} years${domainsPhrase}${stackPhrase}.` : `${who}${domainsPhrase}${stackPhrase}.`);
  if (sharedDomains.length > 0) {
    intro.push(`${sharedDomains[0]!.charAt(0).toUpperCase()}${sharedDomains[0]!.slice(1)} is the work I know best, which is why this role stood out.`);
  }
  let openingParagraph = intro.join(' ');

  // Body: two results quoted from the resume, each with its evidence link.
  const topAccomplishments = selectTopVerifiableAccomplishments(job, profile, graph, 2);
  const bodyParagraphs: CoverLetterParagraph[] = [];
  if (topAccomplishments.length > 0) {
    const sentences: string[] = [];
    let lastCompany: string | undefined;
    for (const citation of topAccomplishments) {
      const company = citation.company && citation.company !== lastCompany ? citation.company : undefined;
      const sentence = bulletAsSentence(citation.claimText, company);
      if (sentence) sentences.push(sentence);
      lastCompany = citation.company ?? lastCompany;
    }
    if (sentences.length > 1 && !sentences[1]!.startsWith('At ')) {
      sentences[1] = sentences[1]!.replace(/^I /, 'I also ');
    }
    bodyParagraphs.push({
      type: 'body',
      theme: 'What I have done',
      paragraphText: sentences.join(' '),
      citedAccomplishments: topAccomplishments.map(({ company: _company, ...citation }) => citation),
    });
  } else if (stack.length > 0) {
    bodyParagraphs.push({
      type: 'body',
      theme: 'What I work with',
      paragraphText: `Most of my day-to-day work is in ${joinNatural(stack.slice(0, 3))}.`,
      citedAccomplishments: [],
    });
  }

  if (options?.cultureAlignment?.whyUsPitch) {
    bodyParagraphs.push({
      type: 'body',
      theme: 'Why this company',
      paragraphText: options.cultureAlignment.whyUsPitch,
      citedAccomplishments: options.cultureAlignment.matches.map((m, idx) => ({
        evidenceId: `ev_culture_${idx}` as unknown as EvidenceId,
        claimId: `clm_culture_${idx}` as unknown as ClaimId,
        claimText: m.candidateEvidenceSnippet,
        sourceTitle: m.companyValue,
        sourceSnippet: m.candidateEvidenceSnippet,
      })),
    });
  }

  let closingParagraph = `I'd be glad to walk through any of this in more detail. Thanks for reading.\n\nBest,\n${candidateName}`.trimEnd();

  if (writingStyle) {
    openingParagraph = applyWritingQualityPassSync(openingParagraph, writingStyle).cleanedText || openingParagraph;
    for (let i = 0; i < bodyParagraphs.length; i++) {
      const paragraph = bodyParagraphs[i]!;
      const cleaned = applyWritingQualityPassSync(paragraph.paragraphText, writingStyle).cleanedText;
      if (cleaned) bodyParagraphs[i] = { ...paragraph, paragraphText: cleaned };
    }
  }

  const greeting = `Dear ${recipient},`;
  const fullText = [
    greeting,
    '',
    openingParagraph,
    '',
    ...bodyParagraphs.flatMap((p) => [p.paragraphText, '']),
    closingParagraph,
  ].join('\n');

  const allCitations: AccomplishmentCitation[] = bodyParagraphs.flatMap((p) => p.citedAccomplishments);

  return {
    targetJobTitle: job.title,
    companyName: job.companyName,
    candidateName,
    greeting,
    openingParagraph,
    bodyParagraphs,
    closingParagraph,
    fullText,
    allCitations,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Rebuilds a letter's paragraphs from text the candidate edited by hand, so the PDF and
 * Word downloads contain their edits rather than the original draft.
 *
 * The first "Dear ..." line becomes the greeting, the last block that starts with a
 * sign-off ("Best,", "Thanks,", "Sincerely,") becomes the closing, the first remaining
 * block is the opening, and the rest are body paragraphs. Citations are kept only for
 * paragraphs whose text still contains the cited bullet.
 */
export function withEditedLetterText(letter: TailoredCoverLetter, editedText: string): TailoredCoverLetter {
  const blocks = editedText
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);
  if (blocks.length === 0) return { ...letter, fullText: editedText };

  let greeting = letter.greeting;
  if (/^dear\b/i.test(blocks[0]!)) {
    const [first, ...rest] = blocks[0]!.split('\n');
    greeting = first!.trim();
    if (rest.join('\n').trim()) blocks[0] = rest.join('\n').trim();
    else blocks.shift();
  }

  let closingIndex = -1;
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (/^(best|thanks|thank you|sincerely|regards|kind regards|warm regards|cheers)\b[^\n]*,?/i.test(blocks[i]!)) {
      closingIndex = i;
      break;
    }
  }
  const closingBlocks = closingIndex >= 0 ? blocks.splice(closingIndex) : [];
  // A short courtesy line right before the sign-off ("Thanks for reading.") belongs to the closing.
  if (closingBlocks.length > 0 && blocks.length > 1 && blocks[blocks.length - 1]!.length < 120) {
    closingBlocks.unshift(blocks.pop()!);
  }

  const openingParagraph = blocks.shift() ?? '';
  const bodyParagraphs: CoverLetterParagraph[] = blocks.map((text, index) => {
    const original = letter.bodyParagraphs[index];
    const cited = (original?.citedAccomplishments ?? []).filter((c) =>
      text.toLowerCase().includes(c.claimText.trim().replace(/[.;]+$/, '').slice(1, 40).toLowerCase())
    );
    return { type: 'body', theme: original?.theme ?? 'Body', paragraphText: text, citedAccomplishments: cited };
  });

  return {
    ...letter,
    greeting,
    openingParagraph,
    bodyParagraphs,
    closingParagraph: closingBlocks.join('\n\n') || letter.closingParagraph,
    fullText: editedText,
    allCitations: bodyParagraphs.flatMap((p) => p.citedAccomplishments),
  };
}
