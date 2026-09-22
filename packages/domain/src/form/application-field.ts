import type { FieldId } from '../types/ids.js';
import type { FieldType } from './field-type.js';

/**
 * An individual option within a select, radio group, or multi-select field.
 */
export interface SelectOption {
  readonly value: string;
  readonly label: string;
}

/**
 * Normalized representation of an input element detected within an application form.
 */
export interface ApplicationField {
  readonly id: FieldId;
  /** Robust CSS or XPath selector targeting this element in the host page DOM. */
  readonly selector: string;
  readonly fieldType: FieldType;
  readonly label: string;
  readonly placeholder?: string;
  readonly name?: string;
  readonly isRequired: boolean;
  /** Available choices for select dropdowns, radio buttons, or checkbox options. */
  readonly options?: readonly SelectOption[];
  /** Current DOM value read at time of inspection. */
  readonly currentValue?: string;
  /** Heuristic mapping confidence score between 0.0 and 1.0. */
  readonly confidenceScore: number;
  /** Suggested candidate profile path (e.g. 'identity.email', 'identity.phone'). */
  readonly inferredMappingKey?: string;
  readonly helpText?: string;
  readonly validationPattern?: string;
  /** Flag identifying fields suspected of being anti-bot honeypots (hidden inputs with enticing labels). */
  readonly isHoneypotSuspect?: boolean;
}
