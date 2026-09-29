import { describe, it, expect } from 'vitest';
import {
  inspectImageFile,
  isImageResume,
  extractTextFromImageBytes,
} from '../evidence/image-resume-parser.js';
import { bootstrapProfileFromResume } from '../evidence/pdf-text-extractor.js';

describe('Image Resume Ingestion & Bitmap Text Extractor', () => {
  it('identifies PNG and JPEG magic bytes accurately', () => {
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const textBytes = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]);

    expect(inspectImageFile(pngBytes).format).toBe('png');
    expect(inspectImageFile(jpegBytes).format).toBe('jpeg');
    expect(inspectImageFile(textBytes).isImage).toBe(false);
  });

  it('detects image files by extension or signature', () => {
    const emptyBytes = new Uint8Array(10);
    expect(isImageResume(emptyBytes, 'resume-scan.png')).toBe(true);
    expect(isImageResume(emptyBytes, 'resume.jpeg')).toBe(true);
    expect(isImageResume(emptyBytes, 'resume.pdf')).toBe(false);
  });

  it('extracts embedded text segments, emails, and contact details from image bytes', () => {
    // Construct synthetic image bytes with embedded text chunk
    const header = [0x89, 0x50, 0x4e, 0x47];
    const text = 'Morgan Reed morgan.reed@example.com Senior Systems Engineer';
    const textBytes = Array.from(new TextEncoder().encode(text));
    const combined = new Uint8Array([...header, 0x00, 0x00, ...textBytes, 0x00]);

    const extracted = extractTextFromImageBytes(combined, 'morgan-resume.png');
    expect(extracted).toContain('morgan.reed@example.com');
  });

  it('bootstraps candidate profile aggregate seamlessly from image upload', async () => {
    const header = [0x89, 0x50, 0x4e, 0x47];
    const text = `
      Alex Morgan
      Email: alex.morgan@example.com
      
      ## Professional Summary
      Distributed systems engineer with 5 years experience.
      
      ## Experience
      Senior Infrastructure Architect at Acme Cloud
      2020 - Present
      - Engineered distributed systems with Go and Linux.
    `;
    const textBytes = Array.from(new TextEncoder().encode(text));
    const combined = new Uint8Array([...header, ...textBytes]);

    const result = await bootstrapProfileFromResume(combined, 'alex-resume.png');
    expect(result.profile).toBeDefined();
    expect(result.rawText).toContain('alex.morgan@example.com');
  });
});
