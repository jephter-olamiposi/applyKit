/**
 * @fileoverview Structured JSON Output Validator and Sanitizer.
 *
 * Enforces schema compliance and strips markdown artifacts from LLM completions.
 * Mitigates model formatting quirks (fenced blocks, preamble commentary, trailing commas)
 * ensuring safe programmatic consumption by the extension runtime.
 */

/**
 * Result of attempting to parse and validate a model completion into structured JSON.
 */
export interface JsonValidationResult<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: string;
  readonly rawSnippet?: string;
}

/**
 * Strips markdown code block wrappers, preamble text, and trailing commas from raw LLM output.
 *
 * @param rawText Unprocessed text completion from an AI model.
 * @returns Cleaned JSON string ready for native JSON.parse.
 */
export function cleanJsonText(rawText: string): string {
  if (!rawText) return '';

  let text = rawText.trim();

  // Strip Markdown fenced code blocks (```json ... ``` or ``` ...)
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch && fenceMatch[1]) {
    text = fenceMatch[1].trim();
  }

  // If text contains conversational preamble or trailing explanation, isolate the JSON container
  const firstBrace = text.indexOf('{');
  const firstBracket = text.indexOf('[');
  let startIndex = -1;

  if (firstBrace !== -1 && firstBracket !== -1) {
    startIndex = Math.min(firstBrace, firstBracket);
  } else if (firstBrace !== -1) {
    startIndex = firstBrace;
  } else if (firstBracket !== -1) {
    startIndex = firstBracket;
  }

  if (startIndex > 0) {
    const isObject = text[startIndex] === '{';
    const lastIndex = isObject ? text.lastIndexOf('}') : text.lastIndexOf(']');
    if (lastIndex > startIndex) {
      text = text.slice(startIndex, lastIndex + 1).trim();
    }
  }

  // Repair trailing commas in arrays and objects (common LLM JSON syntax defect)
  text = text.replace(/,\s*([}\]])/g, '$1');

  return text;
}

/**
 * Parses raw LLM text into a typed JSON object, optionally running a schema validation guard.
 *
 * @param rawText The raw text output produced by an AI model.
 * @param validator Optional type-guard function verifying expected object structure.
 * @returns Parsed and validated typed result or descriptive error details.
 */
export function parseAndValidateJsonResponse<T>(
  rawText: string,
  validator?: (obj: unknown) => boolean
): JsonValidationResult<T> {
  const cleaned = cleanJsonText(rawText);

  if (!cleaned) {
    return {
      success: false,
      error: 'Empty response received from AI model.',
    };
  }

  try {
    const parsed = JSON.parse(cleaned);

    if (validator && !validator(parsed)) {
      return {
        success: false,
        error: 'JSON parsed successfully but failed schema validation requirements.',
        rawSnippet: cleaned.slice(0, 200),
      };
    }

    return {
      success: true,
      data: parsed as T,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? `JSON parsing failed: ${err.message}` : 'JSON parsing failed.',
      rawSnippet: cleaned.slice(0, 200),
    };
  }
}
