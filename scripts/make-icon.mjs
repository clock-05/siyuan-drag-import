/**
 * 生成插件图标（160×160 PNG）。
 * 不引任何图形库：4 倍超采样手绘 + 手写 PNG 编码，免得为一张图多装几个依赖。
 * 用法：node scripts/make-icon.mjs
 */

import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SIZE = 160;
const SS = 4;
const W = SIZE * SS;

/** 圆角矩形内部 */
function inRoundRect(x, y, left, top, right, bottom, radius) {
  if (x < left || x > right || y < top || y > bottom) {
    return false;
  }
  const cx = Math.min(Math.max(x, left + radius), right - radius);
  const cy = Math.min(Math.max(y, top + radius), bottom - radius);
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}

/** 点到线段距离 */
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  const x = ax + t * dx;
  const y = ay + t * dy;
  return Math.hypot(px - x, py - y);
}

function inTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const s = (ax - cx) * (py - cy) - (ay - cy) * (px - cx);
  const t = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
  if (s < 0 !== t < 0 && s !== 0 && t !== 0) {
    return false;
  }
  const d = (cx - bx) * (py - by) - (cy - by) * (px - bx);
  return d === 0 || d < 0 === s + t <= 0;
}

function glyph(x, y) {
  const stroke = 5;
  // 托盘：左右竖臂 + 底部横条，用胶囊拼，转角自然圆
  if (distToSegment(x, y, 42, 98, 42, 128) <= stroke) return true;
  if (distToSegment(x, y, 118, 98, 118, 128) <= stroke) return true;
  if (distToSegment(x, y, 42, 128, 118, 128) <= stroke) return true;
  // 箭杆
  if (distToSegment(x, y, 80, 40, 80, 82) <= 5.5) return true;
  // 箭头
  if (inTriangle(x, y, 58, 78, 102, 78, 80, 112)) return true;
  return false;
}

const rgba = Buffer.alloc(SIZE * SIZE * 4);

for (let py = 0; py < SIZE; py += 1) {
  for (let px = 0; px < SIZE; px += 1) {
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 0;
    for (let sy = 0; sy < SS; sy += 1) {
      for (let sx = 0; sx < SS; sx += 1) {
        const x = (px * SS + sx + 0.5) / SS;
        const y = (py * SS + sy + 0.5) / SS;
        if (!inRoundRect(x, y, 0, 0, SIZE, SIZE, 34)) {
          continue;
        }
        if (glyph(x, y)) {
          r += 255;
          g += 255;
          b += 255;
        } else {
          const t = y / SIZE;
          r += Math.round(76 + (42 - 76) * t);
          g += Math.round(134 + (91 - 134) * t);
          b += Math.round(255 + (215 - 255) * t);
        }
        a += 255;
      }
    }
    const samples = SS * SS;
    const index = (py * SIZE + px) * 4;
    const alpha = a / samples;
    if (alpha > 0) {
      // 颜色按实际覆盖率平均，避免边缘发灰
      const cover = a / 255;
      rgba[index] = Math.round(r / cover);
      rgba[index + 1] = Math.round(g / cover);
      rgba[index + 2] = Math.round(b / cover);
    }
    rgba[index + 3] = Math.round(alpha);
  }
}

/* ---------- PNG 编码 ---------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) {
    c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y += 1) {
  raw[y * (SIZE * 4 + 1)] = 0;
  rgba.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
writeFileSync(join(root, "icon.png"), png);
console.log(`icon.png 已生成：${SIZE}×${SIZE}，${(png.length / 1024).toFixed(1)} KB`);
