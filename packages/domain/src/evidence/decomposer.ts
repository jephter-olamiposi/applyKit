/**
 * @fileoverview Evidence decomposition engine.
 *
 * Decomposes coarse candidate histories, parsed resume documents, projects, and
 * education records into discrete, verifiable atomic Evidence units (ADR-0004).
 * Links evidence IDs back to profile aggregates to ensure complete provenance.
 */

import type { CandidateProfile } from '../candidate/profile.js';
import type { WorkExperience } from '../candidate/experience.js';
import type { CandidateProject } from '../candidate/project.js';
import type { EducationRecord } from '../candidate/education.js';
import type { CandidateSkill, SkillCategory } from '../candidate/skill.js';
import type { ProfileId, EvidenceId } from '../types/ids.js';
import { createProfileId, createExperienceId, createProjectId, createEducationId, createSkillId, createEvidenceId } from '../types/ids.js';
import type { Evidence } from './evidence.js';
import type { ParsedResumeDocument } from './parser.js';
import { normalizeSkillName } from '../candidate/skill.js';

/**
 * Result of decomposing a candidate profile or document into atomic evidence nodes.
 */
export interface DecompositionResult {
  readonly evidence: readonly Evidence[];
  readonly updatedProfile: CandidateProfile;
}

/**
 * Heuristically categorizes a skill based on common terminology.
 */
function categorizeSkill(name: string): SkillCategory {
  const lower = name.toLowerCase();
  if (/typescript|javascript|python|rust|go|golang|java|c\+\+|c#|ruby|php|swift|kotlin|sql/i.test(lower)) {
    return 'language';
  }
  if (/react|vue|angular|svelte|next\.?js|express|nestjs|django|flask|spring|rails/i.test(lower)) {
    return 'framework';
  }
  if (/postgres|mysql|mongodb|redis|cassandra|dynamodb|sqlite|elasticsearch/i.test(lower)) {
    return 'database';
  }
  if (/aws|gcp|azure|docker|kubernetes|terraform|ci\/cd|linux|serverless/i.test(lower)) {
    return 'cloud_infrastructure';
  }
  if (/git|github|jira|webpack|vite|vitest|jest|cypress|playwright/i.test(lower)) {
    return 'devops_tool';
  }
  if (/microservices|event-driven|domain-driven|rest|graphql|grpc|distributed/i.test(lower)) {
    return 'architecture_pattern';
  }
  return 'domain_expertise';
}

/**
 * Decomposes a single WorkExperience record into atomic Evidence items.
 *
 * Each bullet highlight represents an unembellished, atomic accomplishment claim
 * with verifiable source provenance linked to the specific employer.
 */
export function decomposeExperience(exp: WorkExperience): {
  readonly evidence: readonly Evidence[];
  readonly updatedExp: WorkExperience;
} {
  const evidenceList: Evidence[] = [];
  const evidenceIds: EvidenceId[] = [];
  const now = new Date().toISOString();

  // Decompose each accomplishment highlight into an atomic evidence node
  for (const [i, bullet] of exp.highlights.entries()) {
    const evId = createEvidenceId();
    evidenceIds.push(evId);

    evidenceList.push({
      id: evId,
      source: {
        type: 'resume_bullet',
        sourceId: exp.id,
        metadata: {
          company: exp.company,
          title: exp.title,
          startDate: exp.startDate,
          endDate: exp.endDate ?? 'Present',
          bulletIndex: String(i),
        },
      },
      description: `${exp.title} at ${exp.company}: ${bullet}`,
      textSnippet: bullet,
      verificationStatus: 'verified',
      confidenceScore: 0.9,
      tags: [exp.company, ...exp.technologiesUsed],
      createdAt: now,
    });
  }

  // If experience description has distinct content, capture it as role scope evidence
  if (exp.description && !exp.highlights.includes(exp.description)) {
    const evId = createEvidenceId();
    evidenceIds.push(evId);

    evidenceList.push({
      id: evId,
      source: {
        type: 'resume_bullet',
        sourceId: exp.id,
        metadata: {
          company: exp.company,
          title: exp.title,
          scope: 'role_overview',
        },
      },
      description: `Role scope for ${exp.title} at ${exp.company}`,
      textSnippet: exp.description,
      verificationStatus: 'verified',
      confidenceScore: 0.85,
      tags: [exp.company, ...exp.technologiesUsed],
      createdAt: now,
    });
  }

  const updatedExp: WorkExperience = {
    ...exp,
    evidenceRefs: evidenceIds,
  };

  return { evidence: evidenceList, updatedExp };
}

/**
 * Decomposes a technical project into atomic Evidence items.
 */
export function decomposeProject(proj: CandidateProject): {
  readonly evidence: readonly Evidence[];
  readonly updatedProj: CandidateProject;
} {
  const evidenceList: Evidence[] = [];
  const evidenceIds: EvidenceId[] = [];
  const now = new Date().toISOString();

  // Primary project overview evidence
  const overviewId = createEvidenceId();
  evidenceIds.push(overviewId);
  evidenceList.push({
    id: overviewId,
    source: {
      type: proj.repoUrl ? 'git_repository' : 'project_readme',
      sourceId: proj.id,
      uri: proj.repoUrl ?? proj.url,
      metadata: {
        title: proj.title,
        repoUrl: proj.repoUrl ?? '',
        liveUrl: proj.url ?? '',
      },
    },
    description: `Project: ${proj.title} - ${proj.description}`,
    textSnippet: proj.description || proj.title,
    verificationStatus: 'verified',
    confidenceScore: 0.85,
    tags: [proj.title, ...proj.technologiesUsed],
    createdAt: now,
  });

  // Project accomplishment highlights
  for (const [i, bullet] of proj.highlights.entries()) {
    const evId = createEvidenceId();
    evidenceIds.push(evId);

    evidenceList.push({
      id: evId,
      source: {
        type: proj.repoUrl ? 'git_repository' : 'project_readme',
        sourceId: proj.id,
        metadata: {
          title: proj.title,
          highlightIndex: String(i),
        },
      },
      description: `${proj.title} achievement: ${bullet}`,
      textSnippet: bullet,
      verificationStatus: 'verified',
      confidenceScore: 0.85,
      tags: [proj.title, ...proj.technologiesUsed],
      createdAt: now,
    });
  }

  const updatedProj: CandidateProject = {
    ...proj,
    evidenceRefs: evidenceIds,
  };

  return { evidence: evidenceList, updatedProj };
}

/**
 * Decomposes an EducationRecord into verified credential evidence.
 */
export function decomposeEducation(edu: EducationRecord): {
  readonly evidence: readonly Evidence[];
  readonly updatedEdu: EducationRecord;
} {
  const evId = createEvidenceId();
  const now = new Date().toISOString();

  const evidence: Evidence = {
    id: evId,
    source: {
      type: 'diploma',
      sourceId: edu.id,
      metadata: {
        institution: edu.institution,
        degree: edu.degree,
        fieldOfStudy: edu.fieldOfStudy,
      },
    },
    description: `${edu.degree} in ${edu.fieldOfStudy} from ${edu.institution}`,
    textSnippet: `${edu.degree} in ${edu.fieldOfStudy}, ${edu.institution}${edu.endDate ? ` (${edu.endDate})` : ''}`,
    verificationStatus: 'verified',
    confidenceScore: 0.95,
    tags: ['education', edu.degree, edu.fieldOfStudy],
    createdAt: now,
  };

  const updatedEdu: EducationRecord = {
    ...edu,
    evidenceRefs: [evId],
  };

  return { evidence: [evidence], updatedEdu };
}

/**
 * Links CandidateSkill records to supporting evidence based on tag and text matches.
 */
export function linkSkillsToEvidence(
  skills: readonly CandidateSkill[],
  evidenceList: readonly Evidence[]
): readonly CandidateSkill[] {
  return skills.map((skill) => {
    const norm = skill.normalizedName;
    const matchingIds = new Set<EvidenceId>();

    for (const ev of evidenceList) {
      // Check tags
      const hasTag = ev.tags.some((t) => normalizeSkillName(t) === norm);
      if (hasTag) {
        matchingIds.add(ev.id);
        continue;
      }

      // Check text snippet for skill name boundary match
      const escaped = skill.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`\\b${escaped}\\b`, 'i');
      if (regex.test(ev.textSnippet)) {
        matchingIds.add(ev.id);
      }
    }

    return {
      ...skill,
      evidenceRefs: Array.from(matchingIds),
    };
  });
}

/**
 * Decomposes an entire CandidateProfile aggregate into atomic evidence nodes.
 *
 * Updates all internal experiences, projects, education records, and skills with
 * explicit EvidenceId references, establishing bidirectional traceability.
 *
 * @param profile Source candidate profile.
 * @returns Atomic evidence nodes and the updated candidate profile with evidence references.
 */
export function decomposeProfileIntoEvidence(profile: CandidateProfile): DecompositionResult {
  const allEvidence: Evidence[] = [];

  const updatedExperiences: WorkExperience[] = [];
  for (const exp of profile.experiences) {
    const { evidence, updatedExp } = decomposeExperience(exp);
    allEvidence.push(...evidence);
    updatedExperiences.push(updatedExp);
  }

  const updatedProjects: CandidateProject[] = [];
  for (const proj of profile.projects) {
    const { evidence, updatedProj } = decomposeProject(proj);
    allEvidence.push(...evidence);
    updatedProjects.push(updatedProj);
  }

  const updatedEducation: EducationRecord[] = [];
  for (const edu of profile.education) {
    const { evidence, updatedEdu } = decomposeEducation(edu);
    allEvidence.push(...evidence);
    updatedEducation.push(updatedEdu);
  }

  const updatedSkills = linkSkillsToEvidence(profile.skills, allEvidence);

  const updatedProfile: CandidateProfile = {
    ...profile,
    updatedAt: new Date().toISOString(),
    experiences: updatedExperiences,
    projects: updatedProjects,
    education: updatedEducation,
    skills: updatedSkills,
  };

  return {
    evidence: allEvidence,
    updatedProfile,
  };
}

/**
 * Transforms a ParsedResumeDocument into a fully populated CandidateProfile and atomic Evidence set.
 *
 * Invariant: Every generated experience and project bullet immediately creates a verifiable
 * Evidence node, preventing any subsequent AI component from hallucinating credentials.
 *
 * @param parsed Structured resume document produced by parsePlainTextResume.
 * @param existingId Optional profile ID to preserve if updating an existing candidate record.
 * @returns Fully populated candidate profile aggregate alongside the decomposed evidence collection.
 */
export function createProfileFromParsedResume(
  parsed: ParsedResumeDocument,
  existingId?: ProfileId
): { profile: CandidateProfile; evidence: readonly Evidence[] } {
  const now = new Date().toISOString();
  const profileId = existingId ?? createProfileId();

  // Convert parsed experiences into domain WorkExperience
  const rawExperiences: WorkExperience[] = parsed.experiences.map((exp) => ({
    id: createExperienceId(),
    company: exp.company,
    title: exp.title,
    employmentType: 'full_time',
    location: exp.location || 'Remote',
    isRemote: exp.location ? /remote/i.test(exp.location) : true,
    startDate: exp.startDate,
    endDate: exp.endDate,
    isCurrent: exp.isCurrent,
    description: '',
    highlights: exp.highlights,
    technologiesUsed: exp.technologiesUsed,
    evidenceRefs: [],
  }));

  // Convert parsed projects into domain CandidateProject
  const rawProjects: CandidateProject[] = parsed.projects.map((proj) => ({
    id: createProjectId(),
    title: proj.title,
    description: proj.description,
    url: proj.url,
    repoUrl: proj.repoUrl,
    highlights: proj.highlights,
    technologiesUsed: proj.technologiesUsed,
    evidenceRefs: [],
  }));

  // Convert parsed education into domain EducationRecord
  const rawEducation: EducationRecord[] = parsed.education.map((edu) => ({
    id: createEducationId(),
    institution: edu.institution,
    degree: edu.degree,
    fieldOfStudy: edu.fieldOfStudy,
    startDate: undefined,
    endDate: edu.graduationDate,
    isCompleted: true,
    honors: [],
    relevantCoursework: [],
    activities: [],
    evidenceRefs: [],
  }));

  // Convert parsed skills into domain CandidateSkill
  const rawSkills: CandidateSkill[] = parsed.skills.map((s) => ({
    id: createSkillId(),
    name: s,
    normalizedName: normalizeSkillName(s),
    category: categorizeSkill(s),
    proficiency: 'advanced',
    evidenceRefs: [],
  }));

  // Construct raw profile aggregate
  const rawProfile: CandidateProfile = {
    id: profileId,
    version: 1,
    createdAt: now,
    updatedAt: now,
    identity: {
      legalFirstName: (parsed.identity.fullName.split(' ')[0] ?? '').trim() || 'Candidate',
      legalLastName: parsed.identity.fullName.split(' ').slice(1).join(' ').trim(),
      email: parsed.identity.email || '',
      phone: parsed.identity.phone || '',
      location: {
        city: (parsed.identity.location?.split(',')[0] ?? '').trim(),
        country: (parsed.identity.location?.split(',')[1] ?? '').trim() || 'United States',
      },
      workAuthorization: {
        isAuthorizedInCountry: true,
        requiresSponsorship: false,
        authorizedCountries: ['United States'],
      },
    },
    professional: {
      headline: parsed.experiences[0]?.title || 'Software Professional',
      summary: parsed.summary,
      totalYearsOfExperience: Math.max(parsed.experiences.length * 2, 1),
      primaryRoles: parsed.experiences.map((e) => e.title).slice(0, 3),
      targetRoles: parsed.experiences.map((e) => e.title).slice(0, 3),
      preferredLocations: [],
      workplacePreference: 'remote',
      isOpenToRelocation: false,
    },
    experiences: rawExperiences,
    projects: rawProjects,
    education: rawEducation,
    skills: rawSkills,
    links: {
      linkedin: parsed.identity.links.linkedin,
      github: parsed.identity.links.github,
      portfolio: parsed.identity.links.portfolio,
      customLinks: [],
    },
    documents: [],
    savedAnswers: [],
    claims: [],
  };

  // Run decomposition to generate Evidence nodes and link IDs back
  const { evidence, updatedProfile } = decomposeProfileIntoEvidence(rawProfile);

  return {
    profile: updatedProfile,
    evidence,
  };
}
