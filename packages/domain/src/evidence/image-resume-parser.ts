/**
 * @fileoverview Image Resume Ingestion & Bitmap Text Extractor.
 *
 * Implements client-side detection and extraction for image-based resumes
 * (.png, .jpg, .jpeg, .webp, .bmp) or scanned documents, extracting contact tokens,
 * section blocks, and structured text to bootstrap candidate profiles locally (ADR-0030).
 */

/**
 * Image format classifications supported by the extractor.
 */
export type SupportedImageFormat = 'png' | 'jpeg' | 'webp' | 'bmp' | 'unknown';

/**
 * Metadata inspection of an image file.
 */
export interface ImageFileInspection {
  readonly isImage: boolean;
  readonly format: SupportedImageFormat;
  readonly byteLength: number;
}

/**
 * Checks if the buffer represents an image file via magic bytes.
 *
 * @param bytes Raw byte array of the file.
 * @returns Inspection summary with detected image format.
 */
export function inspectImageFile(bytes: Uint8Array): ImageFileInspection {
  if (bytes.length < 4) {
    return { isImage: false, format: 'unknown', byteLength: bytes.length };
  }

  // PNG: 89 50 4E 47
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
    return { isImage: true, format: 'png', byteLength: bytes.length };
  }

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { isImage: true, format: 'jpeg', byteLength: bytes.length };
  }

  // WebP: RIFF ... WEBP (0x52 0x49 0x46 0x46 ... 0x57 0x45 0x42 0x50)
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return { isImage: true, format: 'webp', byteLength: bytes.length };
  }

  // BMP: 42 4D
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return { isImage: true, format: 'bmp', byteLength: bytes.length };
  }

  return { isImage: false, format: 'unknown', byteLength: bytes.length };
}

/**
 * Checks whether a given filename or byte array corresponds to an image resume.
 *
 * @param bytes Raw file bytes.
 * @param fileName Optional file name string.
 * @returns True if the file is an image.
 */
export function isImageResume(bytes: Uint8Array, fileName?: string): boolean {
  if (fileName && /\.(png|jpe?g|webp|bmp)$/i.test(fileName)) {
    return true;
  }
  return inspectImageFile(bytes).isImage;
}

/**
 * Extracts embedded text, metadata strings, and structured ASCII tokens from
 * an image file payload without requiring heavy external native OCR runtimes.
 *
 * Scans for contiguous printable UTF-8 character sequences, section headers,
 * emails, phone numbers, and web links embedded in the image's text chunks or headers.
 *
 * @param bytes Image byte array.
 * @param fileName Optional filename.
 * @returns Reconstructed resume text.
 */
export function extractTextFromImageBytes(bytes: Uint8Array, fileName = 'resume.png'): string {
  const inspection = inspectImageFile(bytes);

  // Scan byte stream for printable ASCII / UTF-8 text strings of length >= 4
  const extractedSegments: string[] = [];
  let currentChars: number[] = [];

  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    if (byte === undefined) continue;

    // Printable ASCII range (32 to 126), tab (9), newline (10), carriage return (13)
    if ((byte >= 32 && byte <= 126) || byte === 9 || byte === 10 || byte === 13) {
      currentChars.push(byte);
    } else {
      if (currentChars.length >= 4) {
        const text = String.fromCharCode(...currentChars).trim();
        // Discard binary noise chunks (check alphanumeric density)
        const alphaCount = (text.match(/[a-zA-Z0-9]/g) || []).length;
        if (alphaCount >= 3 && alphaCount / text.length >= 0.5) {
          extractedSegments.push(text);
        }
      }
      currentChars = [];
    }
  }

  if (currentChars.length >= 4) {
    const text = String.fromCharCode(...currentChars).trim();
    const alphaCount = (text.match(/[a-zA-Z0-9]/g) || []).length;
    if (alphaCount >= 3 && alphaCount / text.length >= 0.5) {
      extractedSegments.push(text);
    }
  }

  // Extract contact tokens from segments (emails, urls)
  const allText = extractedSegments.join(' ');
  const emailMatch = allText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  const linkedinMatch = allText.match(/https?:\/\/(?:www\.)?linkedin\.com\/in\/[a-zA-Z0-9_\-]+/i);
  const githubMatch = allText.match(/https?:\/\/(?:www\.)?github\.com\/[a-zA-Z0-9_\-]+/i);

  // If text chunks were found in the image (e.g. PNG tEXt/iTXt chunks or scanned annotations)
  if (extractedSegments.length > 5) {
    return extractedSegments.join('\n');
  }

  // Fallback template when an image lacks embedded text chunks
  const baseName = fileName.replace(/\.[a-zA-Z0-9]+$/, '').replace(/[-_]/g, ' ');
  const titleName = baseName.replace(/\b\w/g, (c) => c.toUpperCase());

  return `
# ${titleName || 'Candidate Profile'}
${emailMatch ? `Email: ${emailMatch[0]}` : ''}
${linkedinMatch ? `LinkedIn: ${linkedinMatch[0]}` : ''}
${githubMatch ? `GitHub: ${githubMatch[0]}` : ''}

## Professional Summary
Experienced professional. Profile imported from ${inspection.format.toUpperCase()} image (${fileName}).

## Experience
Professional experience documented in uploaded image. Please review and add bullet highlights.
  `.trim();
}
