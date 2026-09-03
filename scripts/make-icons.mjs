import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Draws the app icon and writes it as PNG at the sizes an installed web app
 * needs. Run with `node scripts/make-icons.mjs` when the mark changes.
 *
 * Hand rolled rather than pulled from a design tool or an icon library,
 * because the icon has to be self hosted and reproducible, and pulling in an
 * image pipeline to draw two rounded rectangles is not a trade worth making.
 */

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'web', 'public');

const COBALT = [0x22, 0x58, 0xd8];
const PAPER = [0xff, 0xff, 0xff];

/** Signed distance to a rounded rectangle, negative inside. */
function roundedRect(x, y, cx, cy, halfW, halfH, radius) {
  const dx = Math.abs(x - cx) - (halfW - radius);
  const dy = Math.abs(y - cy) - (halfH - radius);
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return outside + Math.min(Math.max(dx, dy), 0) - radius;
}

/**
 * Two overlapping speech bubbles: a conversation, which is the whole product.
 * Antialiased by sampling the distance field rather than by supersampling, so
 * the edges stay clean at 32px as well as at 512.
 */
function shade(x, y, size) {
  const u = (x + 0.5) / size;
  const v = (y + 0.5) / size;

  const plate = roundedRect(u, v, 0.5, 0.5, 0.5, 0.5, 0.235);
  if (plate > 0) return null;

  const back = roundedRect(u, v, 0.585, 0.425, 0.245, 0.195, 0.085);
  const front = roundedRect(u, v, 0.415, 0.565, 0.245, 0.195, 0.085);
  // The cut keeps a gap of ground between the two bubbles so they read as two.
  const cut = roundedRect(u, v, 0.415, 0.565, 0.285, 0.235, 0.11);

  const shape = Math.min(front, Math.max(back, -cut));
  const feather = 1.1 / size;
  const coverage = 1 - smoothstep(-feather, feather, shape);

  return mix(COBALT, PAPER, coverage);
}

function smoothstep(edge0, edge1, x) {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

function render(size, { opaque = false } = {}) {
  // One filter byte per row, then RGBA.
  const raw = Buffer.alloc(size * (1 + size * 4));

  for (let y = 0; y < size; y++) {
    const row = y * (1 + size * 4);
    raw[row] = 0;

    for (let x = 0; x < size; x++) {
      const at = row + 1 + x * 4;
      const colour = shade(x, y, size);

      if (colour === null) {
        // A maskable icon is cropped by the platform, so it cannot be
        // transparent at the corners.
        if (opaque) {
          raw[at] = COBALT[0];
          raw[at + 1] = COBALT[1];
          raw[at + 2] = COBALT[2];
          raw[at + 3] = 0xff;
        }
        continue;
      }

      raw[at] = colour[0];
      raw[at + 1] = colour[1];
      raw[at + 2] = colour[2];
      raw[at + 3] = 0xff;
    }
  }

  return png(size, raw);
}

function png(size, raw) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

mkdirSync(OUT, { recursive: true });

const written = [
  ['icon-192.png', render(192)],
  ['icon-512.png', render(512)],
  ['icon-maskable-512.png', render(512, { opaque: true })],
  ['favicon-32.png', render(32)],
  ['apple-touch-icon.png', render(180, { opaque: true })],
];

for (const [name, data] of written) {
  writeFileSync(join(OUT, name), data);
  console.log(`${name}  ${data.length} bytes`);
}
