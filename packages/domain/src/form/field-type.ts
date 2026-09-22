/**
 * Categorization of HTML form elements and interaction types.
 */
export type FieldType =
  | 'text'
  | 'textarea'
  | 'email'
  | 'tel'
  | 'number'
  | 'select'
  | 'radio'
  | 'checkbox'
  | 'multiselect'
  | 'date'
  | 'file_upload'
  | 'hidden'
  | 'unknown';

/**
 * Checks whether the field accepts arbitrary textual character input.
 */
export function isTextualField(type: FieldType): boolean {
  return (
    type === 'text' ||
    type === 'textarea' ||
    type === 'email' ||
    type === 'tel' ||
    type === 'number'
  );
}

/**
 * Checks whether the field presents discrete options (dropdowns, radio buttons, checkboxes).
 */
export function isChoiceField(type: FieldType): boolean {
  return (
    type === 'select' ||
    type === 'radio' ||
    type === 'checkbox' ||
    type === 'multiselect'
  );
}
