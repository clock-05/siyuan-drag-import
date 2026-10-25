/**
 * 测试用的最小 ZIP 打包器。
 * 只需要覆盖我们解析器会遇到的形态：UTF-8/GBK 名字、store/deflate、加密位、路径穿越。
 * 生产代码不依赖它。
 */

import { deflateSync } from "fflate";

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

function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) {
    c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

const encoder = new TextEncoder();

function u8(value, size) {
  const out = new Uint8Array(size);
  let rest = value;
  for (let i = 0; i < size; i += 1) {
    out[i] = rest & 0xff;
    rest = Math.floor(rest / 256);
  }
  return out;
}

function concat(parts) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * entries: [{
 *   name?: string,            // 用 UTF-8 编码
 *   nameBytes?: Uint8Array,   // 直接给原始字节（测 GBK）
 *   data: string | Uint8Array,
 *   utf8Flag?: boolean,       // 默认 true
 *   encrypted?: boolean,
 *   store?: boolean,          // 默认 deflate
 * }]
 */
export function makeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = entry.nameBytes ?? encoder.encode(entry.name);
    const raw = typeof entry.data === "string" ? encoder.encode(entry.data) : entry.data;
    const isDirectory = entry.data === "" && /[/\\]$/.test(entry.name ?? "");
    const method = entry.store || isDirectory ? 0 : 8;
    const payload = method === 8 ? deflateSync(raw) : raw;
    const crc = crc32(raw);
    const flags = (entry.encrypted ? 0x1 : 0) | (entry.utf8Flag === false ? 0 : 0x800);

    const local = concat([
      u8(0x04034b50, 4),
      u8(20, 2),
      u8(flags, 2),
      u8(method, 2),
      u8(0, 2),
      u8(0, 2),
      u8(crc, 4),
      u8(payload.length, 4),
      u8(raw.length, 4),
      u8(nameBytes.length, 2),
      u8(0, 2),
      nameBytes,
      payload,
    ]);

    const central = concat([
      u8(0x02014b50, 4),
      u8(20, 2),
      u8(20, 2),
      u8(flags, 2),
      u8(method, 2),
      u8(0, 2),
      u8(0, 2),
      u8(crc, 4),
      u8(payload.length, 4),
      u8(raw.length, 4),
      u8(nameBytes.length, 2),
      u8(0, 2),
      u8(0, 2),
      u8(0, 2),
      u8(0, 2),
      u8(0, 4),
      u8(offset, 4),
      nameBytes,
    ]);

    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }

  const centralBlock = concat(centrals);
  const eocd = concat([
    u8(0x06054b50, 4),
    u8(0, 2),
    u8(0, 2),
    u8(entries.length, 2),
    u8(entries.length, 2),
    u8(centralBlock.length, 4),
    u8(offset, 4),
    u8(0, 2),
  ]);

  return concat([...locals, centralBlock, eocd]);
}

/** "中文.md" 的 GBK 字节（测试用） */
export const GBK_ZHONGWEN_MD = Uint8Array.from([0xd6, 0xd0, 0xce, 0xc4, 0x2e, 0x6d, 0x64]);
