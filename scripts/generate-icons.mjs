/**
 * Generates placeholder PWA icons (solid teal tile with a simple pull-up bar glyph).
 * Replace public/icons/*.png with real artwork when available: `npm run icons` regenerates them.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(OUT, { recursive: true });

const BG = [15, 118, 110];
const FG = [236, 253, 245];

function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, { inset }) {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  const r = size * 0.5;
  const pad = size * inset;
  const barY = size * 0.3;
  const barH = Math.max(2, size * 0.055);
  const postW = Math.max(2, size * 0.055);
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 3 + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < size; x++) {
      let color = BG;
      // rounded-square background mask (transparent-free: keep BG everywhere for maskable)
      const inCircle = Math.hypot(x - r, y - r) < r * 0.99;
      if (!inCircle && inset > 0.12) color = BG;
      const inBar = y >= barY && y <= barY + barH && x >= pad && x <= size - pad;
      const inPostL = x >= pad && x <= pad + postW && y >= barY && y <= size - pad;
      const inPostR = x >= size - pad - postW && x <= size - pad && y >= barY && y <= size - pad;
      const inBody =
        Math.abs(x - r) < size * 0.03 && y > barY + barH * 2 && y < size - pad - size * 0.08;
      const inHead = Math.hypot(x - r, y - (barY + barH * 3.2)) < size * 0.075;
      if (inBar || inPostL || inPostR || inBody || inHead) color = FG;
      const o = rowStart + 1 + x * 3;
      raw[o] = color[0];
      raw[o + 1] = color[1];
      raw[o + 2] = color[2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const targets = [
  ['icon-192.png', 192, 0.18],
  ['icon-512.png', 512, 0.18],
  ['icon-maskable-512.png', 512, 0.27],
  ['apple-touch-icon.png', 180, 0.18],
];
for (const [name, size, inset] of targets) {
  writeFileSync(resolve(OUT, name), png(size, { inset }));
  console.log('wrote', name, size);
}
