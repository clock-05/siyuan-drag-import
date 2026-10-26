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
  /** 撤销失败的目标（文档名或目录路径）：告诉用户哪几篇没撤掉 */
  failedTargets: string[];
}

export interface RestoreTarget {
  id: string;
  /** 导入前的原文（kramdown），撤销时原样写回 */
  before: string;
  /** 文档名，撤销失败时用来告诉用户是哪一篇 */
  name?: string;
}

/**
 * 回滚的完整结果。
 * 和 UndoResult 分开是因为多了一个「撤不回来」的口子：
 * 覆盖 / 追加时没拿到快照（超出快照预算，或取 kramdown 失败），
 * 那几篇的正文已经被改过了，却写不回原文。装作还原了就是在骗人，所以单独报出来。
 */
export interface RollbackInfo {
  /** 删掉的文档数 */
  removed: number;
  /** 写回快照还原的文档数 */
  restored: number;
  /** 回滚本身失败的文档数（删不掉 / 写不回） */
  failed: number;
  /** 覆盖或追加过、但没有快照所以还原不了的文档数 */
  unrestored: number;
  /** 撤不回来的文档名 */
  unrestoredNames: string[];
  /** 撤销失败的目标 */
  failedTargets: string[];
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
  const failedTargets: string[] = [];

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
        failedTargets.push(dir);
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
      failedTargets.push(doc.hpath);
    }
  }

  let done = 0;
  for (const doc of restored) {
    try {
      await updateDocMarkdown(doc.id, doc.before);
      done += 1;
    } catch {
      failed += 1;
      failedTargets.push(doc.name ?? doc.id);
    }
  }

  return { targets, removed, restored: done, failed, docs: created.length, failedTargets };
}

/** 一条已经写进库的记录（回滚只需要这些字段） */
export interface RollbackTarget {
  id: string;
  hpath: string;
  name: string;
  mode: "create" | "overwrite" | "append";
  /** 覆盖 / 追加前的原文快照；没有就还原不了 */
  before?: string;
}
/**
 * 把一批已经写进去的东西整体撤回去。
 *
 * 取消导入走的就是这条路：用户点「取消」的语义是「这次导入没发生过」，
 * 不是「导入到一半停下」。所以新建的删掉、覆盖 / 追加的写回导入前的原文。
 *
 * 撤不回来的有两种，都如实报出去：
 * - 覆盖 / 追加时没拿到快照（超出快照预算，或取 kramdown 失败）→ 正文已经改过了
 * - 删除 / 写回本身失败（内核报错）
 */
export async function rollbackBatch(options: {
  notebook: string;
  targets: RollbackTarget[];
  /** 本批新建的顶层目录：删它一次就够，删父会连带子文档 */
  autoDirs: string[];
}): Promise<RollbackInfo> {
  const created = options.targets
    .filter((item) => item.mode === "create")
    .map((item) => ({ id: item.id, hpath: item.hpath }));
  const restored = options.targets
    .filter((item) => item.mode !== "create" && item.before)
    .map((item) => ({ id: item.id, before: item.before as string, name: item.name }));
  // 覆盖 / 追加过、但没拿到快照的：正文已经改过了，撤不回来
  const unrestoredNames = options.targets
    .filter((item) => item.mode !== "create" && !item.before)
    .map((item) => item.name);

  const outcome = await undoImport({
    notebook: options.notebook,
    created,
    restored,
    autoDirs: options.autoDirs,
  });

  return {
    removed: outcome.removed,
    restored: outcome.restored,
    failed: outcome.failed,
    unrestored: unrestoredNames.length,
    unrestoredNames,
    failedTargets: outcome.failedTargets,
  };
}
