/**
 * Taxonomy of authentic source origins from which evidence may be extracted.
 */
export type EvidenceSourceType =
  | 'resume_bullet'
  | 'git_commit'
  | 'git_repository'
  | 'publication'
  | 'project_readme'
  | 'third_party_credential'
  | 'diploma'
  | 'performance_review'
  | 'manual_input';

/**
 * Concrete provenance metadata identifying where an evidence snippet originated.
 */
export interface EvidenceSource {
  readonly type: EvidenceSourceType;
  /** Unique reference within the source system (e.g. documentId, commit SHA, URL). */
  readonly sourceId: string;
  /** Direct link to the source artifact or webpage if applicable. */
  readonly uri?: string;
  /** Timestamp when the source artifact was created or verified. */
  readonly timestamp?: string;
  readonly metadata?: Readonly<Record<string, string>>;
}
