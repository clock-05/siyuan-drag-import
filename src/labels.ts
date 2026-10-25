/**
 * 文件类型的展示口径：一律说「附件 + 后缀名」。
 * 「1 个附件」等于没说；「1 个 PDF」又和图片分成两套说法。
 * 统一成 `已上传 2 个附件（.png、.pdf）`，图片和文件走同一句话。
 */

import { m } from "./i18n";

/** 没有扩展名的文件（README、Makefile…） */
function extLabel(ext: string): string {
  return ext ? ext.toLowerCase() : m().common.noExt;
}

/** `{".pdf":2,".png":1}` → `（.pdf、.png）`；超过 limit 种就省略 */
export function summarizeExts(kinds: Record<string, number>, limit = 3): string {
  const merged = new Map<string, number>();
  for (const [ext, count] of Object.entries(kinds)) {
    if (!count) {
      continue;
    }
    const label = extLabel(ext);
    merged.set(label, (merged.get(label) ?? 0) + count);
  }
  if (merged.size === 0) {
    return "";
  }
  const text = m().common;
  const sorted = [...merged.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([label]) => label);
  const shown =
    sorted.length > limit
      ? `${sorted.slice(0, limit).join(text.listSep)}${text.listMore}`
      : sorted.join(text.listSep);
  return text.extList(shown);
}
