/**
 * @fileoverview Pure Node.js script to generate valid 16x16, 48x48, and 128x128 PNG icons for Chrome Web Store.
 *
 * Generates PNG binaries compliant with the W3C PNG specification without external binary dependencies.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

// W3C CRC32 table
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function createChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);

  const crcBuf = Buffer.alloc(4);
  const toHash = Buffer.concat([typeBuf, data]);
  crcBuf.writeUInt32BE(crc32(toHash), 0);

  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgbaBuffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk: 13 bytes
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8 bits per channel
  ihdr[9] = 6; // RGBA color type
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const ihdrChunk = createChunk('IHDR', ihdr);

  // Scanlines with filter byte 0 (None) per row
  const rowBytes = width * 4;
  const scanlines = Buffer.alloc((rowBytes + 1) * height);
  for (let y = 0; y < height; y++) {
    scanlines[y * (rowBytes + 1)] = 0; // Filter None
    rgbaBuffer.copy(
      scanlines,
      y * (rowBytes + 1) + 1,
      y * rowBytes,
      (y + 1) * rowBytes
    );
  }

  const compressedData = zlib.deflateSync(scanlines, { level: 9 });
  const idatChunk = createChunk('IDAT', compressedData);
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

/**
 * Renders ApplyKit branding pixels for an icon of given size.
 */
function renderIconPixels(size) {
  const buf = Buffer.alloc(size * size * 4);

  const setPixel = (x, y, r, g, b, a = 255) => {
    if (x < 0 || x >= size || y < 0 || y >= size) return;
    const idx = (y * size + x) * 4;
    // Simple alpha blend
    if (a === 255) {
      buf[idx] = r;
      buf[idx + 1] = g;
      buf[idx + 2] = b;
      buf[idx + 3] = 255;
    } else {
      const srcA = a / 255;
      const dstA = buf[idx + 3] / 255;
      const outA = srcA + dstA * (1 - srcA);
      if (outA > 0) {
        buf[idx] = Math.round((r * srcA + buf[idx] * dstA * (1 - srcA)) / outA);
        buf[idx + 1] = Math.round((g * srcA + buf[idx + 1] * dstA * (1 - srcA)) / outA);
        buf[idx + 2] = Math.round((b * srcA + buf[idx + 2] * dstA * (1 - srcA)) / outA);
        buf[idx + 3] = Math.round(outA * 255);
      }
    }
  };

  const pad = Math.max(1, Math.round(size * 0.06));
  const innerW = size - pad * 2;
  const radius = Math.round(innerW * 0.24);

  // 1. Draw rounded squircle background
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (x >= pad && x < size - pad && y >= pad && y < size - pad) {
        const dx = Math.max(0, Math.max(pad + radius - x, x - (size - pad - radius - 1)));
        const dy = Math.max(0, Math.max(pad + radius - y, y - (size - pad - radius - 1)));
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist <= radius) {
          // Gradient between #3b82f6 and #1d4ed8
          const t = (x + y) / (size * 2);
          const r = Math.round(59 * (1 - t) + 29 * t);
          const g = Math.round(130 * (1 - t) + 78 * t);
          const b = Math.round(246 * (1 - t) + 216 * t);

          // Anti-aliasing at the edge
          const alpha = dist > radius - 1 ? Math.round((radius - dist) * 255) : 255;
          setPixel(x, y, r, g, b, alpha);
        }
      }
    }
  }

  // 2. White document card
  const docL = Math.round(size * 0.28);
  const docR = Math.round(size * 0.72);
  const docT = Math.round(size * 0.26);
  const docB = Math.round(size * 0.78);
  const docCorner = Math.max(1, Math.round(size * 0.06));

  for (let y = docT; y <= docB; y++) {
    for (let x = docL; x <= docR; x++) {
      const dx = Math.max(0, Math.max(docL + docCorner - x, x - (docR - docCorner)));
      const dy = Math.max(0, Math.max(docT + docCorner - y, y - (docB - docCorner)));
      if (Math.sqrt(dx * dx + dy * dy) <= docCorner) {
        setPixel(x, y, 255, 255, 255, 255);
      }
    }
  }

  // 3. Document clip
  const clipL = Math.round(size * 0.42);
  const clipR = Math.round(size * 0.58);
  const clipT = Math.round(size * 0.20);
  const clipB = Math.round(size * 0.30);
  for (let y = clipT; y <= clipB; y++) {
    for (let x = clipL; x <= clipR; x++) {
      setPixel(x, y, 29, 78, 216, 255);
    }
  }

  // 4. Content lines (for sizes >= 32)
  if (size >= 32) {
    const lineL = Math.round(size * 0.36);
    const lineR1 = Math.round(size * 0.64);
    const lineR2 = Math.round(size * 0.54);
    const lineH = Math.max(1, Math.round(size * 0.04));

    const y1 = Math.round(size * 0.42);
    const y2 = Math.round(size * 0.52);

    for (let y = y1; y < y1 + lineH; y++) {
      for (let x = lineL; x <= lineR1; x++) {
        setPixel(x, y, 147, 197, 253, 255);
      }
    }
    for (let y = y2; y < y2 + lineH; y++) {
      for (let x = lineL; x <= lineR2; x++) {
        setPixel(x, y, 147, 197, 253, 255);
      }
    }
  }

  // 5. Emerald Verification Badge (Circle)
  const badgeCx = Math.round(size * 0.68);
  const badgeCy = Math.round(size * 0.68);
  const badgeRadius = Math.round(size * 0.16);

  for (let y = badgeCy - badgeRadius; y <= badgeCy + badgeRadius; y++) {
    for (let x = badgeCx - badgeRadius; x <= badgeCx + badgeRadius; x++) {
      const d = Math.sqrt((x - badgeCx) ** 2 + (y - badgeCy) ** 2);
      if (d <= badgeRadius) {
        setPixel(x, y, 16, 185, 129, 255);
      }
    }
  }

  // 6. Checkmark
  const markPoints = [
    [-0.4, 0.0],
    [-0.1, 0.3],
    [0.4, -0.3],
  ];
  // Simple checkmark rendering
  const ckX1 = Math.round(badgeCx - badgeRadius * 0.4);
  const ckY1 = Math.round(badgeCy);
  const ckX2 = Math.round(badgeCx - badgeRadius * 0.1);
  const ckY2 = Math.round(badgeCy + badgeRadius * 0.35);
  const ckX3 = Math.round(badgeCx + badgeRadius * 0.45);
  const ckY3 = Math.round(badgeCy - badgeRadius * 0.3);

  const drawLine = (x0, y0, x1, y1) => {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2;
    for (let i = 0; i <= steps; i++) {
      const x = Math.round(x0 + (x1 - x0) * (i / steps));
      const y = Math.round(y0 + (y1 - y0) * (i / steps));
      setPixel(x, y, 255, 255, 255, 255);
      if (size >= 48) {
        setPixel(x + 1, y, 255, 255, 255, 255);
        setPixel(x, y + 1, 255, 255, 255, 255);
      }
    }
  };

  drawLine(ckX1, ckY1, ckX2, ckY2);
  drawLine(ckX2, ckY2, ckX3, ckY3);

  return buf;
}

const SIZES = [16, 48, 128];
const TARGET_DIRS = [
  path.join(ROOT_DIR, 'apps/extension/public/icons'),
  path.join(ROOT_DIR, 'apps/extension/icons'),
];

for (const dir of TARGET_DIRS) {
  fs.mkdirSync(dir, { recursive: true });
}

for (const size of SIZES) {
  const rgba = renderIconPixels(size);
  const pngBuf = encodePng(size, size, rgba);

  for (const dir of TARGET_DIRS) {
    const filePath = path.join(dir, `icon-${size}.png`);
    fs.writeFileSync(filePath, pngBuf);
    console.log(`Generated ${filePath} (${pngBuf.length} bytes)`);
  }
}

console.log('Icon generation complete.');
