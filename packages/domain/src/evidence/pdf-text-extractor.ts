/**
 * @fileoverview Client-side vector and digital PDF text extraction engine.
 *
 * Implements local-first, zero-telemetry text extraction from PDF resumes:
 * 1. Stream Decompression: Deflate/zlib decompression via standard Web Streams DecompressionStream.
 * 2. CMap Font Decoding: Translates embedded custom font glyphs (beginbfchar / beginbfrange) to Unicode.
 * 3. Text Operator Interpreter: Parses BT...ET blocks, TJ arrays, and Tj tokens while tracking vertical
 *    displacements (Tm, Td, T*) to preserve line breaks, headers, and section hierarchies.
 * 4. Zero Remote Dependencies: Runs entirely inside browser service worker, sidepanel, and content scripts.
 */

import type { CandidateProfile } from '../candidate/profile.js';
import type { Evidence } from './evidence.js';
import type { ParsedResumeDocument } from './parser.js';
import { parsePlainTextResume } from './parser.js';
import { createProfileFromParsedResume } from './decomposer.js';
import { isImageResume, extractTextFromImageBytes } from './image-resume-parser.js';
import type { ProfileId } from '../types/ids.js';

/**
 * Result of client-side resume ingestion and profile bootstrapping.
 */
export interface BootstrappedResumeResult {
  /** Raw extracted text from the uploaded document. */
  readonly rawText: string;
  /** Intermediate structured resume document with partitioned sections. */
  readonly parsed: ParsedResumeDocument;
  /** Validated, fully populated candidate profile aggregate. */
  readonly profile: CandidateProfile;
  /** Atomic evidence nodes decomposed with complete source provenance. */
  readonly evidence: readonly Evidence[];
}

/**
 * Parses embedded CMap font streams to build a code point to Unicode mapping.
 *
 * Fontkit and modern PDF exporters frequently subset embedded fonts, re-indexing
 * glyphs into arbitrary 1-byte or 2-byte indices described in /ToUnicode CMaps.
 */
export function parseCMapStream(cmapText: string): Map<number, string> {
  const map = new Map<number, string>();

  // Parse single character mappings: <srcHex> <destHex>
  const bfcharRegex = /beginbfchar([\s\S]*?)endbfchar/g;
  let bfcharMatch: RegExpExecArray | null;
  while ((bfcharMatch = bfcharRegex.exec(cmapText)) !== null) {
    const lines = (bfcharMatch[1] ?? '').trim().split(/\r?\n/);
    for (const line of lines) {
      const parts = line.match(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/);
      if (parts && parts[1] && parts[2]) {
        const src = parseInt(parts[1], 16);
        const dest = parseInt(parts[2], 16);
        map.set(src, String.fromCodePoint(dest));
      }
    }
  }

  // Parse contiguous character ranges: <startHex> <endHex> <destStartHex>
  const bfrangeRegex = /beginbfrange([\s\S]*?)endbfrange/g;
  let bfrangeMatch: RegExpExecArray | null;
  while ((bfrangeMatch = bfrangeRegex.exec(cmapText)) !== null) {
    const lines = (bfrangeMatch[1] ?? '').trim().split(/\r?\n/);
    for (const line of lines) {
      const parts = line.match(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/);
      if (parts && parts[1] && parts[2] && parts[3]) {
        const start = parseInt(parts[1], 16);
        const end = parseInt(parts[2], 16);
        let dest = parseInt(parts[3], 16);
        for (let code = start; code <= end; code++, dest++) {
          map.set(code, String.fromCodePoint(dest));
        }
      }
    }
  }

  return map;
}

/**
 * Decodes a hex string token `<4d6f7267616e>` into Unicode characters,
 * checking against available font CMaps or falling back to standard ASCII/UTF-8.
 */
function decodeHexString(hex: string, cmap: Map<number, string>): string {
  let result = '';

  // If CMap is present, evaluate whether glyph keys are 4-character (2-byte) or 2-character (1-byte)
  if (cmap.size > 0) {
    let i = 0;
    while (i < hex.length) {
      if (i + 4 <= hex.length) {
        const code4 = parseInt(hex.slice(i, i + 4), 16);
        if (cmap.has(code4)) {
          result += cmap.get(code4);
          i += 4;
          continue;
        }
      }
      if (i + 2 <= hex.length) {
        const code2 = parseInt(hex.slice(i, i + 2), 16);
        if (cmap.has(code2)) {
          result += cmap.get(code2);
          i += 2;
          continue;
        }
        if (code2 >= 32 && code2 <= 126) {
          result += String.fromCharCode(code2);
        } else if (code2 === 10 || code2 === 13 || code2 === 9) {
          result += ' ';
        }
        i += 2;
        continue;
      }
      i++;
    }
    return result;
  }

  // Standard 1-byte character codes
  for (let i = 0; i < hex.length; i += 2) {
    const code = parseInt(hex.slice(i, i + 2), 16);
    if (code >= 32 && code <= 126) {
      result += String.fromCharCode(code);
    } else if (code === 10 || code === 13 || code === 9) {
      result += ' ';
    }
  }
  return result;
}

/**
 * Decodes PDF literal text strings `(Hello\nWorld)` handling standard escape codes.
 */
function decodeLiteralString(raw: string): string {
  let result = '';
  let i = 0;
  while (i < raw.length) {
    if (raw[i] === '\\' && i + 1 < raw.length) {
      const next = raw[i + 1];
      switch (next) {
        case 'n':
          result += '\n';
          i += 2;
          break;
        case 'r':
          result += '\r';
          i += 2;
          break;
        case 't':
          result += '\t';
          i += 2;
          break;
        case 'b':
          result += '\b';
          i += 2;
          break;
        case 'f':
          result += '\f';
          i += 2;
          break;
        case '\\':
          result += '\\';
          i += 2;
          break;
        case '(':
          result += '(';
          i += 2;
          break;
        case ')':
          result += ')';
          i += 2;
          break;
        default:
          // Check for 3-digit octal escape e.g. \040
          if (next && /[0-7]/.test(next) && i + 3 < raw.length && /[0-7]{2}/.test(raw.slice(i + 2, i + 4))) {
            const octal = parseInt(raw.slice(i + 1, i + 4), 8);
            result += String.fromCharCode(octal);
            i += 4;
          } else {
            result += next ?? '';
            i += 2;
          }
          break;
      }
    } else {
      result += raw[i];
      i++;
    }
  }
  return result;
}

/**
 * Decompresses raw FlateDecode stream bytes using standard Web Streams API.
 */
export async function decompressFlateStream(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream !== 'undefined') {
    try {
      const ds = new DecompressionStream('deflate');
      const writer = ds.writable.getWriter();
      const reader = ds.readable.getReader();

      const readPromise = (async () => {
        const chunks: Uint8Array[] = [];
        let totalLength = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            chunks.push(value);
            totalLength += value.length;
          }
        }
        const combined = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
          combined.set(chunk, offset);
          offset += chunk.length;
        }
        return combined;
      })();

      await writer.write(bytes as any);
      await writer.close();

      return await readPromise;
    } catch {
      // Fallback: try raw deflate
      try {
        const dsRaw = new DecompressionStream('deflate-raw');
        const writer = dsRaw.writable.getWriter();
        const reader = dsRaw.readable.getReader();

        const readPromise = (async () => {
          const chunks: Uint8Array[] = [];
          let totalLength = 0;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              chunks.push(value);
              totalLength += value.length;
            }
          }
          const combined = new Uint8Array(totalLength);
          let offset = 0;
          for (const chunk of chunks) {
            combined.set(chunk, offset);
            offset += chunk.length;
          }
          return combined;
        })();

        await writer.write(bytes as any);
        await writer.close();

        return await readPromise;
      } catch {
        return bytes;
      }
    }
  }
  return bytes;
}

/**
 * Extracts human-readable plain text from a raw PDF binary buffer.
 *
 * Decodes all content streams, resolves embedded font CMaps, and preserves
 * structural whitespace and section breaks based on text displacement matrices.
 *
 * @param pdfBytes Raw PDF document binary data.
 * @returns Clean, multi-line extracted text with sections intact.
 */
export async function extractTextFromPdfBytes(pdfBytes: Uint8Array): Promise<string> {
  const contentStreams: string[] = [];
  const cmaps: Array<Map<number, string>> = [];

  // Binary search for 'stream' and 'endstream' to maintain byte-exact stream boundaries
  let pos = 0;
  while (pos < pdfBytes.length - 6) {
    if (
      pdfBytes[pos] === 115 && // s
      pdfBytes[pos + 1] === 116 && // t
      pdfBytes[pos + 2] === 114 && // r
      pdfBytes[pos + 3] === 101 && // e
      pdfBytes[pos + 4] === 97 && // a
      pdfBytes[pos + 5] === 109 // m
    ) {
      // Look back for preceding object dictionary
      const dictStart = Math.max(0, pos - 500);
      let dictText = '';
      for (let d = dictStart; d < pos; d++) {
        dictText += String.fromCharCode(pdfBytes[d]!);
      }
      const isFlate = dictText.includes('/FlateDecode');

      // Skip the end-of-line marker right after 'stream' (\r\n or \n)
      let streamStart = pos + 6;
      if (pdfBytes[streamStart] === 13 && pdfBytes[streamStart + 1] === 10) {
        streamStart += 2;
      } else if (pdfBytes[streamStart] === 10) {
        streamStart += 1;
      }

      // Find 'endstream'
      let streamEnd = streamStart;
      while (streamEnd < pdfBytes.length - 9) {
        if (
          pdfBytes[streamEnd] === 101 && // e
          pdfBytes[streamEnd + 1] === 110 && // n
          pdfBytes[streamEnd + 2] === 100 && // d
          pdfBytes[streamEnd + 3] === 115 && // s
          pdfBytes[streamEnd + 4] === 116 && // t
          pdfBytes[streamEnd + 5] === 114 && // r
          pdfBytes[streamEnd + 6] === 101 && // e
          pdfBytes[streamEnd + 7] === 97 && // a
          pdfBytes[streamEnd + 8] === 109 // m
        ) {
          break;
        }
        streamEnd++;
      }

      if (streamEnd >= pdfBytes.length - 9) break;

      // Trim trailing newline before 'endstream'
      let realEnd = streamEnd;
      if (realEnd > streamStart && pdfBytes[realEnd - 1] === 10) {
        realEnd--;
        if (realEnd > streamStart && pdfBytes[realEnd - 1] === 13) {
          realEnd--;
        }
      }

      const streamBytes = pdfBytes.subarray(streamStart, realEnd);
      let decodedBytes = streamBytes;
      if (isFlate) {
        decodedBytes = (await decompressFlateStream(streamBytes)) as any;
      }

      let streamText = '';
      const chunkSize = 16384;
      for (let k = 0; k < decodedBytes.length; k += chunkSize) {
        const slice = decodedBytes.subarray(k, Math.min(k + chunkSize, decodedBytes.length));
        streamText += String.fromCharCode(...slice);
      }

      if (streamText.includes('begincmap') || streamText.includes('beginbfchar')) {
        cmaps.push(parseCMapStream(streamText));
      } else if (streamText.includes('BT') && streamText.includes('ET')) {
        contentStreams.push(streamText);
      }

      pos = streamEnd + 9;
      continue;
    }
    pos++;
  }

  // Merge CMaps across font resources
  const mergedCMap = new Map<number, string>();
  for (const cmap of cmaps) {
    for (const [code, char] of cmap.entries()) {
      mergedCMap.set(code, char);
    }
  }

  const lines: string[] = [];
  let currentLine = '';

  for (const streamContent of contentStreams) {
    const btRegex = /BT([\s\S]*?)ET/g;
    let btMatch: RegExpExecArray | null;

    while ((btMatch = btRegex.exec(streamContent)) !== null) {
      const block = btMatch[1] ?? '';
      // Tokenize PDF text operators
      const ops = block.split(/(?<=[A-Za-z*\'\"])\s+/);

      for (const op of ops) {
        const trimmed = op.trim();
        if (!trimmed) continue;

        // Vertical displacement operators signify new lines or paragraph breaks
        if (
          /[-0-9.]+\s+[-0-9.]+\s+(?:Td|TD)/.test(trimmed) ||
          /[-0-9.]+\s+[-0-9.]+\s+[-0-9.]+\s+[-0-9.]+\s+[-0-9.]+\s+[-0-9.]+\s+Tm/.test(trimmed) ||
          trimmed === 'T*'
        ) {
          if (currentLine.trim()) {
            lines.push(currentLine.trim());
            currentLine = '';
          }
        }

        // TJ array operator: [ (<hex> | (str) | number)+ ] TJ
        const tjMatch = trimmed.match(/^\[([\s\S]*?)\]\s*TJ$/);
        if (tjMatch && tjMatch[1]) {
          const inner = tjMatch[1];
          const tokenRegex = /<([0-9a-fA-F]+)>|\(([^)]*)\)|(-?\d+(?:\.\d+)?)/g;
          let tok: RegExpExecArray | null;
          while ((tok = tokenRegex.exec(inner)) !== null) {
            if (tok[1]) {
              currentLine += decodeHexString(tok[1], mergedCMap);
            } else if (tok[2]) {
              currentLine += decodeLiteralString(tok[2]);
            } else if (tok[3]) {
              const num = parseFloat(tok[3]);
              // Negative displacement in PDF TJ indicates word separation kerning
              if (num < -120) {
                if (!currentLine.endsWith(' ')) {
                  currentLine += ' ';
                }
              }
            }
          }
        }

        // Tj single text operator
        const tjSingle = trimmed.match(/^(?:<([0-9a-fA-F]+)>|\(([^)]*)\))\s*Tj$/);
        if (tjSingle) {
          if (tjSingle[1]) {
            currentLine += decodeHexString(tjSingle[1], mergedCMap);
          } else if (tjSingle[2]) {
            currentLine += decodeLiteralString(tjSingle[2]);
          }
        }
      }

      if (currentLine.trim()) {
        lines.push(currentLine.trim());
        currentLine = '';
      }
    }
  }

  // Fallback: If structured operator parsing extracted minimal text, perform token-level extraction
  if (lines.length < 3) {
    for (const streamContent of contentStreams) {
      const literalMatches = streamContent.matchAll(/\(([^)]+)\)\s*Tj/g);
      for (const lm of literalMatches) {
        if (lm[1] && lm[1].trim()) {
          lines.push(decodeLiteralString(lm[1].trim()));
        }
      }
    }
  }

  // Normalize lines: consolidate multiple consecutive blank lines
  const cleaned: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    cleaned.push(trimmed);
  }

  return cleaned.join('\n');
}

/**
 * Unified entry point to parse a resume document from binary or text input,
 * construct a structured CandidateProfile aggregate, and generate atomic Evidence nodes.
 *
 * Supports PDF (.pdf), Markdown (.md), Plain Text (.txt), and JSON (.json) files.
 *
 * @param buffer Raw file bytes or UTF-8 text string.
 * @param fileName Optional file name used to assist format determination.
 * @param existingId Optional profile ID to preserve if updating an existing record.
 * @returns Bootstrapped resume result with full provenance.
 */
export async function bootstrapProfileFromResume(
  buffer: Uint8Array | ArrayBuffer | string,
  fileName?: string,
  existingId?: ProfileId
): Promise<BootstrappedResumeResult> {
  let rawText = '';

  if (typeof buffer === 'string') {
    rawText = buffer;
  } else {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const isPdf =
      (fileName && /\.pdf$/i.test(fileName)) ||
      (bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46); // %PDF

    const isImage = isImageResume(bytes, fileName);

    if (isPdf) {
      rawText = await extractTextFromPdfBytes(bytes);
    } else if (isImage) {
      rawText = extractTextFromImageBytes(bytes, fileName);
    } else {
      rawText = new TextDecoder('utf-8').decode(bytes);
    }
  }

  // Check if content is ApplyKit JSON backup
  if (rawText.trim().startsWith('{') && rawText.includes('"identity"') && rawText.includes('"experiences"')) {
    try {
      const parsedJson = JSON.parse(rawText);
      if (parsedJson.identity && parsedJson.experiences) {
        const profile = parsedJson as CandidateProfile;
        return {
          rawText,
          parsed: {
            rawText,
            identity: {
              fullName: `${profile.identity.legalFirstName} ${profile.identity.legalLastName}`.trim(),
              email: profile.identity.email,
              phone: profile.identity.phone,
              location: profile.identity.location.city,
              links: {
                linkedin: profile.links.linkedin,
                github: profile.links.github,
                portfolio: profile.links.portfolio,
              },
            },
            summary: profile.professional.summary,
            experiences: profile.experiences.map((e) => ({
              company: e.company,
              title: e.title,
              location: e.location,
              startDate: e.startDate,
              endDate: e.endDate,
              isCurrent: e.isCurrent,
              highlights: e.highlights,
              technologiesUsed: e.technologiesUsed,
            })),
            projects: profile.projects.map((p) => ({
              title: p.title,
              description: p.description,
              url: p.url,
              repoUrl: p.repoUrl,
              highlights: p.highlights,
              technologiesUsed: p.technologiesUsed,
            })),
            education: profile.education.map((ed) => ({
              institution: ed.institution,
              degree: ed.degree,
              fieldOfStudy: ed.fieldOfStudy,
              graduationDate: ed.endDate,
            })),
            skills: profile.skills.map((s) => s.name),
          },
          profile,
          evidence: [],
        };
      }
    } catch {
      // Fall through to text parsing
    }
  }

  const parsed = parsePlainTextResume(rawText);
  const { profile, evidence } = createProfileFromParsedResume(parsed, existingId);

  return {
    rawText,
    parsed,
    profile,
    evidence,
  };
}
