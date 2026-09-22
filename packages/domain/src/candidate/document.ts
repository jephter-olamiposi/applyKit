import type { DocumentId } from '../types/ids.js';

/**
 * Functional taxonomy of candidate documents.
 */
export type DocumentType =
  | 'resume'
  | 'cover_letter'
  | 'transcript'
  | 'portfolio_pdf'
  | 'certification_credential'
  | 'other';

/**
 * Reference to an uploaded or locally persisted document.
 * Files are stored locally in IndexedDB or private extension storage; only text extracts
 * are indexed for matching.
 */
export interface DocumentReference {
  readonly id: DocumentId;
  readonly fileName: string;
  readonly documentType: DocumentType;
  /** Storage key in local IndexedDB or sandboxed storage. */
  readonly storageKey: string;
  readonly mimeType: string;
  readonly byteSize: number;
  /** SHA-256 hash ensuring tamper-evident file integrity across sessions. */
  readonly sha256Checksum: string;
  readonly uploadedAt: string;
  /** Extracted plain text content for local parsing, search, and evidence linking. */
  readonly extractedText?: string;
  /** Flag identifying the default resume for automated tailoring. */
  readonly isPrimaryResume?: boolean;
}
