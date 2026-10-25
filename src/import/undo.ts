import { getIDsByHPath, removeDoc, updateDocMarkdown } from "./api";

export interface UndoResult {
  /** 实际发起的删除目标数（顶层目录按 1 个算） */
  targets: number;
  /** 删掉的文档数（本批新建） */
  removed: number;
  /** 写回快照成功的文档数（本批覆盖 / 追加） */
  restored: number;
  failed: number;
  docs: number;
}

export interface RestoreTarget {
  id: string;
  /** 导入前的原文（kramdown），撤销时原样写回 */
  before: string;
}

/**
 * 撤销本批导入。两类事分开做：
 *
 *   1. **新建** → 删掉。只删两处：本批新建的顶层目录（删父会连带子文档，一次搞定）、
 *      以及不在这些目录下的新建文档。复用的父文档一个都不碰（M0：删父会连带删子文档）。
 *   2. **覆盖 / 追加** → 把导入前的快照写回去（`updateBlock`），文档 id 与子文档都保留。
 *
 * 语义统一成「回到我拖进来之前」，不区分「你导入后有没有改过」（见 docs/RESTORE-SPIKE.md）。
 */
export async function undoImport(options: {
  notebook: string;
  created: { id: string; hpath: string }[];
  restored?: RestoreTarget[];
  autoDirs: string[];
}): Promise<UndoResult> {
  const { notebook, created, autoDirs } = options;
  const restored = options.restored ?? [];

  const under = (hpath: string, dir: string) => hpath === dir || hpath.startsWith(`${dir}/`);

  // 本批新建的目录可能有多层，删最上面那层就够（删父会连带子文档）
  const dirs = [...autoDirs].sort((a, b) => a.split("/").length - b.split("/").length);
  const topDirs = dirs.filter((dir) => !dirs.some((other) => other !== dir && dir.startsWith(`${other}/`)));

  let targets = 0;
  let removed = 0;
  let failed = 0;

  for (const dir of topDirs) {
    let ids: string[];
    try {
      ids = await getIDsByHPath(notebook, dir);
    } catch {
      // 查不到就跳过：宁可少删
      continue;
    }
    if (ids.length === 0) {
      continue;
    }
    // 删这一层目录 = 删掉它下面本批新建的所有文档，所以篇数按「它下面有几篇」算。
    // 早先是把目录当 1 篇，卡片上就出现「已删除 1 篇」，其实删了 50 篇。
    const count = created.filter((doc) => under(doc.hpath, dir)).length;
    for (let index = 0; index < ids.length; index += 1) {
      // 内核不去重，同一路径偶尔有多个 id：只有第一个带整层的篇数，其余按 1 算
      const weight = index === 0 ? count : 1;
      targets += 1;
      try {
        await removeDoc(ids[index]);
        removed += weight;
      } catch {
        failed += weight;
      }
    }
  }

  // 不在任何新建目录下的：一篇一篇删
  for (const doc of created) {
    if (topDirs.some((dir) => under(doc.hpath, dir))) {
      continue;
    }
    targets += 1;
    try {
      await removeDoc(doc.id);
      removed += 1;
    } catch {
      failed += 1;
    }
  }

  let done = 0;
  for (const doc of restored) {
    try {
      await updateDocMarkdown(doc.id, doc.before);
      done += 1;
    } catch {
      failed += 1;
    }
  }

  return { targets, removed, restored: done, failed, docs: created.length };
}
