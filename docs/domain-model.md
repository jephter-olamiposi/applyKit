# ApplyKit Domain Model Specification

The ApplyKit domain model centers on a single immutable invariant: **the candidate's verified profile and linked evidence are the absolute source of truth**. Under no circumstances does the system fabricate, extrapolate, or hallucinate candidate credentials.

---

## 1. Domain Entity Relationship Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CandidateProfile                               │
│                                                                             │
│  - id: ProfileId                                                            │
│  - version: number                                                          │
│  - identity: CandidateIdentity                                              │
│  - professional: ProfessionalProfile                                        │
│  - links: ProfileLinks                                                      │
│  - experiences: WorkExperience[]                                            │
│  - projects: CandidateProject[]                                             │
│  - education: EducationRecord[]                                             │
│  - skills: CandidateSkill[] ──────┐                                         │
│  - documents: DocumentReference[] │                                         │
│  - savedAnswers: SavedAnswer[]    │                                         │
│  - claims: CandidateClaim[] ◄─────┼─────────────────────────┐               │
└───────────────────────────────────┼─────────────────────────┼───────────────┘
                                    │                         │
                                    ▼                         │
                         ┌─────────────────────┐              │
                         │      Evidence       │              │
                         │ - id: EvidenceId    │              │
                         │ - source: Source    │              │
                         │ - textSnippet: str  │              │
                         │ - status: Status    │              │
                         └──────────┬──────────┘              │
                                    │                         │
                                    │ Backs / Supports        │
                                    ▼                         │
                         ┌─────────────────────┐              │
                         │   CandidateClaim    ├──────────────┘
                         │ - id: ClaimId       │
                         │ - statement: str    │
                         │ - confidence: float │
                         └──────────┬──────────┘
                                    │
                                    │ Matches Against
                                    ▼
┌───────────────────────────────────────────────────────┐
│                      JobPosting                       │
│ - id: JobPostingId                                    │
│ - title: string                                       │
│ - companyName: string                                 │
│ - rawDescription: string                              │
│ - requirements: Requirement[]                         │
│   ├── category: RequirementCategory                   │
│   ├── importance: Importance                          │
│   └── matchedEvidenceIds: EvidenceId[]                │
└───────────────────────────┬───────────────────────────┘
                            │ Evaluated During
                            ▼
┌───────────────────────────────────────────────────────┐
│                   ApplicationRecord                   │
│ - id: ApplicationId                                   │
│ - candidateProfileId: ProfileId                       │
│ - jobPostingId: JobPostingId                          │
│ - currentStatus: ApplicationState                     │
│ - statusHistory: StateTransition[]                    │
│ - dryRunLog: DryRunAction[]                           │
│   └── action: BrowserAction (click, fill_text, etc.)  │
└───────────────────────────────────────────────────────┘
```

---

## 2. Core Entity Definitions

### 2.1 Candidate Profile Subsystem

#### `CandidateProfile`
The root aggregate representing all known, verified data for a candidate.
- `id: ProfileId` — Unique UUID wrapper.
- `version: number` — Monotonically increasing schema/revision number.
- `createdAt: string` & `updatedAt: string` — ISO timestamps.
- `identity: CandidateIdentity` — Legal name, preferred name, email, phone, location, work authorization.
- `professional: ProfessionalProfile` — Headline, summary, years of experience, target roles, compensation requirements.
- `links: ProfileLinks` — GitHub, LinkedIn, portfolio website, personal handles.
- `experiences: WorkExperience[]` — Chronological employment history with responsibilities and achievements.
- `projects: CandidateProject[]` — Portfolio and open-source projects with repo links and tech stacks.
- `education: EducationRecord[]` — Formal degrees, institutions, graduation dates, and certifications.
- `skills: CandidateSkill[]` — Categorized technical and soft skills with self-assessed and verified proficiencies.
- `documents: DocumentReference[]` — References to locally stored resumes, cover letters, and transcripts.
- `savedAnswers: SavedAnswer[]` — Canonical answers to standard recurring application questions.
- `claims: CandidateClaim[]` — Structured assertions derived from experience and backed by evidence.

#### `CandidateIdentity`
- `fullName: string`
- `preferredName?: string`
- `email: string`
- `phone: string`
- `location: { city: string; stateOrProvince?: string; country: string; postalCode?: string }`
- `workAuthorization: { usAuthorized: boolean; requiresSponsorship: boolean; currentVisaStatus?: string; euAuthorized?: boolean; ukAuthorized?: boolean }`
- `demographics?: { veteranStatus?: string; disabilityStatus?: string; raceEthnicity?: string; gender?: string }` *(Optional, strictly user-controlled)*

#### `WorkExperience`
- `id: ExperienceId`
- `company: string`
- `title: string`
- `employmentType: 'full_time' | 'part_time' | 'contract' | 'internship' | 'freelance'`
- `location: string`
- `isRemote: boolean`
- `startDate: string` (YYYY-MM)
- `endDate?: string` (YYYY-MM, null if current)
- `isCurrent: boolean`
- `description: string`
- `highlights: string[]` (Bullet points detailing accomplishments with quantitative metrics)
- `technologiesUsed: string[]`
- `evidenceRefs: EvidenceId[]`

---

## 3. Evidence & Claim Subsystem

To prevent AI hallucination, every claim made in an application (or generated for tailored answers) must link back to an `Evidence` node.

#### `Evidence`
- `id: EvidenceId`
- `source: EvidenceSource` (e.g., `resume_bullet`, `git_commit`, `publication`, `project_readme`, `credential`, `manual_input`)
- `description: string` — Human-readable description of what this evidence proves.
- `textSnippet: string` — The exact raw text from the resume or document supporting the evidence.
- `verificationStatus: 'unverified' | 'verified' | 'inferred'`
- `confidenceScore: number` (0.0 to 1.0)
- `createdAt: string`

#### `CandidateClaim`
- `id: ClaimId`
- `statement: string` — E.g., "Led migration of 4 microservices to Kubernetes, reducing latency by 35%".
- `claimType: 'skill_proficiency' | 'years_experience' | 'achievement' | 'leadership' | 'credential'`
- `supportedByEvidenceIds: EvidenceId[]`
- `contestedByEvidenceIds?: EvidenceId[]`
- `confidence: number` (0.0 to 1.0)

---

## 4. Job Posting & Requirement Subsystem

#### `JobPosting`
- `id: JobPostingId`
- `url: string`
- `title: string`
- `companyName: string`
- `location: string`
- `workplaceType: 'remote' | 'hybrid' | 'onsite'`
- `employmentType: 'full_time' | 'part_time' | 'contract' | 'internship'`
- `salaryRange?: { min: number; max: number; currency: string; period: 'hourly' | 'annual' }`
- `rawDescription: string`
- `parsedAt: string`
- `requirements: Requirement[]`
- `metadata: Record<string, string>`

#### `Requirement`
- `id: RequirementId`
- `rawText: string` — Raw phrase extracted from job post.
- `normalizedSkillOrCompetency: string` — Canonical concept (e.g. "TypeScript", "Distributed Systems").
- `category: RequirementCategory` (`technical_skill` | `soft_skill` | `domain_knowledge` | `education_credential` | `certification` | `experience_level` | `legal_authorization` | `language`)
- `importance: Importance` (`required` | `strongly_preferred` | `preferred` | `nice_to_have`)
- `yearsRequired?: number`
- `isRequired: boolean`
- `matchedEvidenceIds: EvidenceId[]`

---

## 5. Form Engine & Browser Action Protocol

The form engine abstracts DOM interactions into a strictly validated, non-executable command protocol.

#### `ApplicationField`
- `id: string`
- `selector: string` — Reliable CSS or XPath selector.
- `fieldType: FieldType` (`text` | `textarea` | `email` | `tel` | `number` | `select` | `radio` | `checkbox` | `multiselect` | `date` | `file_upload` | `hidden` | `unknown`)
- `label: string`
- `placeholder?: string`
- `name?: string`
- `isRequired: boolean`
- `options?: { value: string; label: string }[]`
- `currentValue?: string`
- `confidenceScore: number`
- `inferredMappingKey?: string` (e.g., `identity.email`, `savedAnswer:sponsorship`)

#### `BrowserAction`
- `actionType: 'click' | 'fill_text' | 'select_option' | 'check' | 'uncheck' | 'upload_file' | 'scroll_into_view' | 'wait_for_selector'`
- `selector: string`
- `value?: string`
- `description: string`
- `timeoutMs?: number`
- `requiresUserConfirmation: boolean`

#### `DryRunAction`
- `id: string`
- `action: BrowserAction`
- `currentValue: string`
- `candidateValueUsed: string`
- `confidence: number` (0.0 to 1.0)
- `riskLevel: 'low' | 'medium' | 'high'`
- `userConfirmed: boolean`
- `diffExplanation?: string`

---

## 6. Application State Machine & History

#### `ApplicationState`
The discrete lifecycle states of an application:
1. `idle`: No active job posting or application page detected.
2. `detected_job`: Job posting detected on the active page.
3. `extracting_job`: Parsing job details and normalizing requirements.
4. `matching_profile`: Running gap analysis against candidate evidence.
5. `ready_to_fill`: Form fields identified and mapped to profile values.
6. `dry_run_review`: Dry run plan generated; waiting for candidate review in Side Panel.
7. `executing_actions`: Executing approved non-destructive actions.
8. `awaiting_user_review`: All fields filled; candidate must manually review and click submit.
9. `submitted`: Application submitted by candidate.
10. `rejected`: Candidate application rejected.
11. `failed`: Execution or extraction encountered an unrecoverable error.
12. `archived`: Application closed or archived by candidate.

#### `ApplicationRecord`
- `id: ApplicationId`
- `candidateProfileId: ProfileId`
- `jobPostingId: JobPostingId`
- `currentStatus: ApplicationState`
- `statusHistory: { status: ApplicationState; timestamp: string; reason?: string }[]`
- `matchedRequirementsScore: number`
- `filledFieldsCount: number`
- `dryRunLog: DryRunAction[]`
- `notes?: string`
- `createdAt: string`
- `updatedAt: string`

---

## 7. AI Provider Abstraction & Scoped Contexts

To adhere to privacy-by-design, prompts are scoped to the minimum necessary context rather than exposing the whole candidate profile.

- **`JobExtractionContext`**: Raw HTML or text slice of the job description only. No candidate data sent.
- **`RequirementMatchingContext`**: Specific job requirements paired with candidate skill claims and experience bullet points only.
- **`FieldAnsweringContext`**: Single form field prompt text, field type, and specific candidate saved answers or relevant achievements.
- **`ResumeTailoringContext`**: Job requirements + candidate experience bullets and skills.
