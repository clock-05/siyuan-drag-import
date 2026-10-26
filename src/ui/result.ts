import type { FailureItem, SuccessItem } from "../import/executor";
import type { AssetKinds, AssetStats } from "../import/assets";
import { m } from "../i18n";
import { summarizeExts } from "../labels";
import { nodeFs, nodePath, nodeRequire } from "../platform";
import type { RejectedSource } from "../source/analyze";

export interface Summary {
  ok: SuccessItem[];
  failed: FailureItem[];
  skipped: RejectedSource[];
  ms: number;
  /** 日志文件路径；日志没启用时为空串，卡片据此不显示「打开日志」 */
  logPath: string;
  /** 用户在冲突卡片上点了取消：一篇都没建 */
  cancelled?: boolean;
  /** 图片与附件（pdf/docx/zip…）的上传结果 */
  assets?: AssetStats;
  /** 快照超过内存上限：本批不提供撤销 */
  undoOff?: boolean;
  /** 本批转成思源块引用的 `[[双链]]` 处数（0 就不显示） */
  links?: number;
  /**
   * 取消导入后的回滚结果。
   * 取消 = 撤销：整批不留痕迹，这个字段说明撤回了什么、什么没撤回来。
   */
  rolledBack?: RollbackSummary;
  /** 取消后仍需要用户处理的问题（撤不回来的文档） */
  problems?: FailureItem[];
}

/** 取消导入后的回滚结果（给卡片显示用） */
export interface RollbackSummary {
  /** 删掉的文档数 */
  removed: number;
  /** 写回快照还原的文档数 */
  restored: number;
  /** 回滚失败的文档数 */
  failed: number;
  /** 覆盖/追加过、但没有快照所以还原不了的文档数 */
  unrestored: number;
}

export interface ShowOptions {
  onOpenFirst?: (id: string) => void;
  /** 撤销：返回一句现成的话（「已删除 3 篇 · 已还原 2 篇」），直接显示在按钮上 */
  onUndo?: () => Promise<string>;
  /** 撤销有效期，默认 30 秒 */
  undoWindowMs?: number;
  /** 完整卡片收缩成一行的时间，默认 4 秒；0 表示不收缩（测试用） */
  collapseMs?: number;
  /** 零结果卡片（成功 0）到点直接消失的时间，默认 5 秒（测试用） */
  nothingMs?: number;
  /** 重试失败项：跑完会显示一张新的结果卡片 */
  onRetry?: () => Promise<void>;
}

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

const MAX_ROWS = 5;
const DEFAULT_UNDO_WINDOW = 30 * 1000;
const CONFIRM_WINDOW = 3000;
/** 完整卡片停留多久后收缩成一行 */
const COLLAPSE_AFTER = 4000;
/** 一篇都没进来：没有撤销入口、没有明细可看，留够读完一句提示就走 */
const NOTHING_AFTER = 5000;
/** 撤销成功后再留一会儿，让人看见结果 */
const DISMISS_AFTER_UNDO = 3000;

function formatMs(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  // 30 秒的窗口显示「0:28」太绕，直接写秒
  if (total < 60) {
    return `${total}s`;
  }
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * 在资源管理器里定位日志文件。
 * 之前是「把整份 JSONL 摊在卡片里」——大文件夹动辄上万行，卡片会被撑爆还卡。
 * 返回 false 就退回复制路径（测试环境、非桌面端都会走到这一步）。
 */
function revealLog(file: string): boolean {
  if (!file) {
    return false;
  }
  const fs = nodeFs();
  if (!fs?.existsSync || !fs.existsSync(file)) {
    return false;
  }
  const shell = nodeRequire<any>("electron")?.shell;
  if (!shell) {
    return false;
  }
  try {
    if (typeof shell.showItemInFolder === "function") {
      shell.showItemInFolder(file);
      return true;
    }
    const dir = nodePath()?.dirname?.(file);
    if (dir && typeof shell.openPath === "function") {
      void shell.openPath(dir);
      return true;
    }
  } catch (error) {
    console.error("[drag-import] 打开日志所在目录失败", error);
  }
  return false;
}

/** 剪贴板可能不存在（jsdom / 无焦点），拿不到就当失败 */
function copyText(text: string): boolean {
  try {
    const clipboard = (navigator as any)?.clipboard;
    if (!clipboard || typeof clipboard.writeText !== "function") {
      return false;
    }
    void clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * 零结果卡片的文字：**能只有标题就只给标题**。
 * 下面每一类都只有一句（或零句），因为这类卡片只活 5 秒，长解释读不完也没人记；
 * 唯一的例外是「标题说不了下一步该怎么做」——那才补一句，且控制在一行内。
 *
 * 判断一律看 `code`（结构化原因码），不看 `reason` 文本——那是给人看的，会跟着语言变。
 */
function describeUnsupported(skipped: RejectedSource[]): { title: string; hint: string } {
  const text = m().unsupported;
  // 冲突时全选了「跳过」：文件类型没问题，说「格式不支持」会把人引到错的方向
  if (skipped.length > 0 && skipped.every((item) => item.code === "same-name")) {
    return {
      title: skipped.length > 1 ? text.skipAllMany(skipped.length) : text.skipAllOne,
      hint: "",
    };
  }
  const kinds = new Set(skipped.map((item) => item.kind ?? "other"));
  if (kinds.size === 1) {
    const only = [...kinds][0];
    if (only === "folder") {
      return { title: text.foldersUnreadable, hint: "" };
    }
    if (only === "archive") {
      if (skipped.every((item) => item.code === "export-package")) {
        return { title: text.exportPackage, hint: text.exportPackageHint };
      }
      if (skipped.every((item) => item.code === "archive-no-md")) {
        return { title: text.archiveNoMd, hint: "" };
      }
      return { title: text.archiveUnsupported, hint: text.archiveUnsupportedHint };
    }
    if (only === "image") {
      return { title: text.imageAlone, hint: text.imageAloneHint };
    }
    if (only === "empty") {
      return { title: text.emptyFolder, hint: "" };
    }
  }
  return { title: text.nothing, hint: "" };
}

type CountField = "uploaded" | "missing" | "failed";

/** `{".pdf":{uploaded:1,...}}` + `uploaded` → `{".pdf":1}`，0 的不带进去 */
function collect(kinds: AssetKinds, field: CountField): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [ext, counter] of Object.entries(kinds)) {
    if (counter[field] > 0) {
      out[ext] = counter[field];
    }
  }
  return out;
}

/**
 * 附件说明：图片和文件统一说成「附件」，括号里列后缀——
 * 「已上传 2 个附件（.png、.pdf）」「1 个附件找不到（.pdf）」。
 */
function describeAssets(stats: AssetStats): string {
  const parts: string[] = [];
  const kinds = stats.kinds ?? {};

  const text = m();
  const sep = text.common.sentenceSep;

  const uploaded = stats.images.uploaded + stats.files.uploaded;
  if (uploaded > 0) {
    parts.push(text.asset.uploaded(uploaded, summarizeExts(collect(kinds, "uploaded"))));
  }

  const missing = stats.images.missing + stats.files.missing;
  if (missing > 0) {
    parts.push(text.asset.missing(missing, summarizeExts(collect(kinds, "missing"))));
  }

  const failed = stats.images.failed + stats.files.failed;
  if (failed > 0) {
    parts.push(text.asset.failed(failed, summarizeExts(collect(kinds, "failed"))));
  }

  if (parts.length === 0) {
    return "";
  }

  const problems = missing + failed;
  if (problems === 0) {
    return parts.join(sep);
  }
  return `${parts.join(sep)}${text.asset.keepRaw}`;
}

/**
 * 右下角结果卡片。挂在 body 上而不是文档树里，
 * 免得被思源的布局重排带走；关闭即整块移除，不留空壳。
 *
 * 寿命分两段：完整卡片 4 秒 → 收缩成一行小条 → 小条再待 8 秒退场。
 * 原因是「看结果」只要几秒、「撤销」要等 30 秒，一件事的两种寿命不该用同一个形态承载：
 * 卡片一直常驻会挡视线，直接消失又等于把撤销入口删了。
 */
export class ResultCard {
  private el: HTMLDivElement | null = null;
  private fullEl: HTMLElement | null = null;
  private miniEl: HTMLElement | null = null;
  private miniTextEl: HTMLElement | null = null;
  private miniUndoEl: HTMLElement | null = null;
  private ticker: number | null = null;
  private confirmTimer: number | null = null;
  private collapseTimer: number | null = null;
  private dismissTimer: number | null = null;
  /** 这张卡片的收缩延迟（测试会传小值） */
  private collapseMs = COLLAPSE_AFTER;
  /** 零结果卡片的停留时间（测试会传小值） */
  private nothingMs = NOTHING_AFTER;
  private mode: "full" | "mini" = "full";
  /** 撤销截止时间戳；0 表示这张卡片没有撤销窗口 */
  private undoDeadline = 0;
  /** 没有失败项 = 没有事等人处理，收缩后可以自己收掉 */
  private clean = true;
  /** 一篇都没进来：不收缩，直接到点消失 */
  private noResult = false;
  /** 点页面别处就让开（捕获阶段监听 pointerdown，比 click 稳） */
  private outsideHandler: ((event: Event) => void) | null = null;
  /** 被外部点击打断时，把「确认撤销？」的中间态复位，免得展开后一下点实 */
  private resetConfirm: (() => void) | null = null;
  /** 进度卡片开始的时间戳（0 = 不在导入中），用来估剩余时间 */
  private progressStartedAt = 0;

  /** 解压 / 遍历文件夹 / 查同名阶段：还不知道进度，先给个不确定的，别让人以为没反应 */
  showReading(label: string, stage: "unzip" | "folder" | "check" | "rename" = "unzip"): void {
    this.destroy();
    const text = m().card;
    const hints = {
      unzip: text.hintUnzip,
      folder: text.hintFolder,
      check: text.hintCheck,
      rename: text.hintRename,
    };
    const hint = hints[stage];
    const el = document.createElement("div");
    el.className = "sdi-card sdi-card--busy";
    el.innerHTML = `
      <div class="sdi-card__head">
        <span class="sdi-card__title">${esc(
          stage === "check" ? text.checking : stage === "rename" ? text.renaming : text.reading,
        )}</span>
      </div>
      <div class="sdi-card__counts"><span class="sdi-card__progress">${esc(hint)}</span><em>${esc(label)}</em></div>
      <div class="sdi-card__bar sdi-card__bar--busy"><i></i></div>
    `;
    document.body.append(el);
    this.el = el;
  }

  /**
   * 导入进行中的占位卡片。M2 的文件夹动辄几十上百篇（约 33ms/篇），
   * 松手后先给「我收到了」，跑完同一位置换成结果。
   */
  showProgress(total: number, targetLabel: string, onCancel?: () => void): void {
    this.destroy();
    this.progressStartedAt = Date.now();
    const text = m().card;
    const el = document.createElement("div");
    el.className = "sdi-card sdi-card--busy";
    el.innerHTML = `
      <div class="sdi-card__head">
        <span class="sdi-card__title">${esc(text.progressTitle(total))}</span>
      </div>
      <div class="sdi-card__counts">
        <span class="sdi-card__progress">0 / ${total}</span>
        <em>${esc(targetLabel)}</em>
      </div>
      <div class="sdi-card__bar"><i style="width: 0%"></i></div>
      ${
        onCancel
          ? `<div class="sdi-card__foot"><button class="sdi-card__btn" type="button" data-act="cancel">${esc(
              m().common.cancelAndUndo,
            )}</button></div>`
          : ""
      }
    `;
    const cancelButton = el.querySelector<HTMLButtonElement>('[data-act="cancel"]');
    cancelButton?.addEventListener("click", () => {
      if (cancelButton.disabled) {
        return;
      }
      cancelButton.disabled = true;
      cancelButton.textContent = m().card.cancelling;
      onCancel?.();
    });
    document.body.append(el);
    this.el = el;
  }

  /** 每建完一篇更新一次；卡片已被结果顶掉时静默忽略 */
  updateProgress(done: number, total: number, currentName: string): void {
    if (!this.el || !this.el.classList.contains("sdi-card--busy")) {
      return;
    }
    const count = this.el.querySelector<HTMLElement>(".sdi-card__progress");
    if (count) {
      count.textContent = `${done} / ${total}${this.etaText(done, total)}`;
    }
    const name = this.el.querySelector<HTMLElement>(".sdi-card__counts em");
    if (name) {
      name.textContent = currentName;
      name.title = currentName;
    }
    const bar = this.el.querySelector<HTMLElement>(".sdi-card__bar i");
    if (bar) {
      bar.style.width = `${total > 0 ? Math.round((done / total) * 100) : 0}%`;
    }
  }

  /**
   * 剩余时间：按「已用时间 ÷ 已完成」外推，取整到 5 秒（逐秒跳会很吵）。
   * 前 5 篇不给（样本太少，估出来乱跳），剩余不到 5 秒也不给（马上就完了）。
   */
  private etaText(done: number, total: number): string {
    if (done < 5 || done >= total || this.progressStartedAt === 0) {
      return "";
    }
    const avg = (Date.now() - this.progressStartedAt) / done;
    const remain = Math.round((avg * (total - done)) / 5000) * 5;
    return remain >= 5 ? m().card.eta(remain) : "";
  }

  show(summary: Summary, options: ShowOptions = {}): void {
    this.destroy();

    const cancelled = Boolean(summary.cancelled);
    const rolledBack = summary.rolledBack;
    const okCount = summary.ok.length;
    const failCount = summary.failed.length;
    const skipCount = summary.skipped.length;
    // 取消后撤不回来的文档：正文还留着被改过的样子，得让用户知道是哪几篇
    const problems = summary.problems ?? [];
    const problemCount = problems.length;
    const overwritten = summary.ok.filter((item) => item.mode === "overwrite").length;
    const appended = summary.ok.filter((item) => item.mode === "append").length;
    const createdCount = summary.ok.filter((item) => item.mode === "create").length;
    const nothingImported = !cancelled && okCount === 0 && failCount === 0;
    // 一篇都没产出（取消 / 全跳过 / 全是不支持的类型）：这类卡片不收缩。
    // 导入中途取消不一样：它报告的是一次撤销动作的结果（删了几篇、还原了几篇），
    // 要让人看清，所以照常收缩成小条；只有冲突卡片那次「取消」（压根没开始导）算零结果。
    const noResult = okCount === 0 && failCount === 0 && problemCount === 0 && !rolledBack;
    const text = m();
    const cardText = text.card;
    const unsupported = nothingImported ? describeUnsupported(summary.skipped) : null;
    const title = cancelled
      ? cardText.titleCancelled
      : nothingImported
        ? unsupported!.title
        : okCount > 0
          ? cardText.titleDone
          : cardText.titleFailed;
    // 取消 = 撤销：说明撤回了什么，而不是「已导入 N 篇」
    const hint = cancelled
      ? rolledBack && (rolledBack.removed > 0 || rolledBack.restored > 0)
        ? cardText.cancelledRolledBack(rolledBack.removed, rolledBack.restored)
        : "" // 标题「已取消导入」已经把话说完了
      : unsupported?.hint ?? "";

    const rows: string[] = [];
    for (const item of cancelled ? [] : summary.failed.slice(0, MAX_ROWS)) {
      rows.push(
        `<li><span title="${esc(item.name)}">${esc(item.name)}</span><span title="${esc(item.reason)}">${esc(
          item.reason,
        )}</span></li>`,
      );
    }
    for (const item of cancelled ? [] : summary.skipped.slice(0, MAX_ROWS)) {
      rows.push(
        `<li><span title="${esc(item.name)}">${esc(item.name)}</span><span title="${esc(item.reason)}">${esc(
          item.reason,
        )}</span></li>`,
      );
    }
    // 取消后撤不回来的：要让用户知道哪些文档还留着被改过的正文
    for (const item of problems.slice(0, MAX_ROWS)) {
      rows.push(
        `<li><span title="${esc(item.name)}">${esc(item.name)}</span><span title="${esc(item.reason)}">${esc(
          item.reason,
        )}</span></li>`,
      );
    }
    const hiddenCount = Math.max(0, failCount - MAX_ROWS) + Math.max(0, skipCount - MAX_ROWS);

    const detailText = cardText.okDetail(overwritten, appended);
    const counts = [
      `<b class="${okCount > 0 ? "sdi-ok" : ""}">${esc(cardText.okCount(okCount))}${
        detailText ? `<span class="sdi-muted">${esc(detailText)}</span>` : ""
      }</b>`,
      esc(cardText.skipCount(skipCount)),
      `<b class="${failCount > 0 ? "sdi-bad" : ""}">${esc(cardText.failCount(failCount))}</b>`,
    ].join(" · ");

    const assetNote = summary.assets ? describeAssets(summary.assets) : "";
    // 能撤销的：本批新建（删除）+ 覆盖/追加且拿到了快照的（还原）
    const restoredCount = summary.ok.filter((item) => item.mode !== "create" && Boolean(item.before)).length;
    // 取消导入也要能撤销：「拖错了、点了取消」时已经建好一批，
    // 不给撤销就只能手动删。冲突卡片点取消的那次 createdCount 是 0，天然不会出现在这里。
    const canUndo =
      Boolean(options.onUndo) && (createdCount > 0 || restoredCount > 0) && !summary.undoOff;
    const undoAction = [
      createdCount > 0 ? text.flow.undoRemoved(createdCount) : "",
      restoredCount > 0 ? text.flow.undoRestored(restoredCount) : "",
    ]
      .filter(Boolean)
      .join(" · ");
    const undoNote = summary.undoOff ? cardText.undoOverflow : "";
    // 只有「再试一次可能成功」的失败才给重试：「文件超过 20MB」这种点几次都一样
    const retryableCount = summary.failed.filter((item) => item.retryable).length;
    const canRetry = Boolean(options.onRetry) && retryableCount > 0 && !cancelled;

    // 收缩后那一行：只留「成功 / 失败」这种一眼扫完的数，撤销倒计时单独一列
    const miniParts = [cardText.okCount(okCount)];
    if (skipCount > 0) {
      miniParts.push(cardText.skipCount(skipCount));
    }
    if (failCount > 0) {
      miniParts.push(cardText.failCount(failCount));
    }
    // 取消回滚：收缩后那行写「已撤销」，「成功 0」是噪音
    const miniText = cancelled ? cardText.cancelledMini : miniParts.join(" · ");

    const el = document.createElement("div");
    el.className = "sdi-card";
    if (failCount > 0 || problemCount > 0) {
      el.classList.add("sdi-card--has-fail");
    }
    el.innerHTML = `
      <div class="sdi-card__full">
        <div class="sdi-card__head">
          <span class="sdi-card__title">${esc(title)}</span>
          <button class="sdi-card__close" type="button" aria-label="${esc(text.common.close)}">×</button>
        </div>
        ${
          // 一篇都没进来（或用户取消）时，「成功 0 · 跳过 1 · 失败 0」是纯噪音，标题已经说完了
          nothingImported || (cancelled && okCount === 0)
            ? ""
            : `<div class="sdi-card__counts">${counts}<em>${formatMs(summary.ms)}</em></div>`
        }
        ${hint ? `<div class="sdi-card__hint">${esc(hint)}</div>` : ""}
        ${assetNote ? `<div class="sdi-card__note">${esc(assetNote)}</div>` : ""}
        ${summary.links ? `<div class="sdi-card__note">${esc(cardText.links(summary.links))}</div>` : ""}
        ${undoNote ? `<div class="sdi-card__note">${esc(undoNote)}</div>` : ""}
        ${rows.length > 0 ? `<ul class="sdi-card__list">${rows.join("")}</ul>` : ""}
        ${hiddenCount > 0 ? `<div class="sdi-card__more">${esc(cardText.moreHidden(hiddenCount))}</div>` : ""}
        <div class="sdi-card__log" hidden></div>
        <div class="sdi-card__foot">
          ${
            okCount > 0
              ? `<button class="sdi-card__btn sdi-card__btn--primary" type="button" data-act="open">${esc(
                  cardText.openFirst,
                )}</button>`
              : ""
          }
          ${
            canRetry
              ? `<button class="sdi-card__btn" type="button" data-act="retry">${esc(cardText.retry(retryableCount))}</button>`
              : ""
          }
          ${
            canUndo
              ? `<button class="sdi-card__btn sdi-card__btn--danger" type="button" data-act="undo">${esc(
                  cardText.undo(formatCountdown(options.undoWindowMs ?? DEFAULT_UNDO_WINDOW)),
                )}</button>`
              : ""
          }
          ${
            summary.logPath
              ? `<button class="sdi-card__btn" type="button" data-act="log" title="${esc(summary.logPath)}">${esc(
                  text.common.openLog,
                )}</button>`
              : ""
          }
        </div>
      </div>
      <div class="sdi-card__mini" hidden>
        <button class="sdi-card__mini-main" type="button" title="${esc(cardText.miniExpand)}">
          <span class="sdi-card__mini-dot${failCount > 0 || problemCount > 0 ? " is-bad" : ""}"></span>
          <span class="sdi-card__mini-text">${esc(miniText)}</span>
          ${canUndo ? `<span class="sdi-card__mini-undo"></span>` : ""}
        </button>
        <button class="sdi-card__mini-close" type="button" aria-label="${esc(text.common.close)}">×</button>
      </div>
    `;

    this.fullEl = el.querySelector<HTMLElement>(".sdi-card__full");
    this.miniEl = el.querySelector<HTMLElement>(".sdi-card__mini");
    this.miniTextEl = el.querySelector<HTMLElement>(".sdi-card__mini-text");
    this.miniUndoEl = el.querySelector<HTMLElement>(".sdi-card__mini-undo");
    this.mode = "full";
    // 有撤不回来的文档 = 还有事等人处理，卡片不能自己走
    this.clean = failCount === 0 && problemCount === 0;
    this.undoDeadline = canUndo ? Date.now() + (options.undoWindowMs ?? DEFAULT_UNDO_WINDOW) : 0;

    // 只放路径，不放内容：内容在文件里，点按钮直接定位到它
    const logBox = el.querySelector<HTMLDivElement>(".sdi-card__log");
    if (logBox) {
      logBox.textContent = summary.logPath;
    }

    el.querySelector(".sdi-card__close")?.addEventListener("click", () => this.destroy());

    el.querySelector('[data-act="open"]')?.addEventListener("click", () => {
      const first = summary.ok[0];
      if (first && options.onOpenFirst) {
        options.onOpenFirst(first.id);
        // 视线已经跟着新文档走了，卡片让开（跟「点别处收缩」同一个道理）
        if (this.mode === "full") {
          this.collapse();
        }
      }
    });

    el.querySelector('[data-act="retry"]')?.addEventListener("click", async (event) => {
      const button = event.currentTarget as HTMLButtonElement;
      if (button.disabled) {
        return;
      }
      // 先锁住按钮：重试要跑几秒，连点会排进好几批
      button.disabled = true;
      button.textContent = m().card.retrying;
      try {
        await options.onRetry?.();
      } catch (error) {
        console.error("[drag-import] 重试失败", error);
        button.disabled = false;
        button.textContent = m().card.retry(retryableCount);
      }
    });

    const logButton = el.querySelector<HTMLButtonElement>('[data-act="log"]');
    logButton?.addEventListener("click", () => {
      if (revealLog(summary.logPath)) {
        logButton.textContent = m().card.logOpened;
        return;
      }
      // 打不开就把路径亮出来，顺手复制一份
      if (logBox) {
        logBox.hidden = false;
      }
      if (copyText(summary.logPath)) {
        logButton.textContent = m().card.pathCopied;
      }
    });

    if (canUndo) {
      this.wireUndo(el, options, undoAction);
    }

    // 收缩态交互：点主体展开、点 × 关掉；鼠标停在卡片上的这段时间不催它收缩
    const collapseMs = options.collapseMs ?? COLLAPSE_AFTER;
    this.collapseMs = collapseMs;
    this.nothingMs = options.nothingMs ?? NOTHING_AFTER;
    el.querySelector(".sdi-card__mini-main")?.addEventListener("click", () => this.expand());
    el.querySelector(".sdi-card__mini-close")?.addEventListener("click", () => this.destroy());
    el.addEventListener("pointerenter", () => {
      // 零结果卡片的计时就是**退场**计时，没有别的退出路径：
      // 一 hover 就取消的话，鼠标停在卡片上 = 永远不走（0.7.1 真机实测的 bug）
      if (!noResult) {
        this.cancelCollapse();
      }
    });
    el.addEventListener("pointerleave", () => {
      if (this.mode === "full" && !noResult) {
        this.scheduleCollapse(this.waitMs());
      }
    });

    document.body.append(el);
    this.el = el;
    this.noResult = noResult;

    // 点页面别处就收缩：捕获阶段监听，思源里有些元素会拦冒泡的 click
    this.outsideHandler = (event: Event) => {
      const target = event.target as Node | null;
      if (!this.el || !target || this.el.contains(target)) {
        return;
      }
      this.onOutsideClick();
    };
    document.addEventListener("pointerdown", this.outsideHandler, true);

    if (collapseMs > 0) {
      this.scheduleCollapse(this.waitMs());
    }
  }

  /** 这张卡片到点该等多久：零结果等 5 秒，其余等收缩延迟 */
  private waitMs(): number {
    return this.noResult ? this.nothingMs : this.collapseMs;
  }

  /** 点了卡片以外的地方：没待办就直接收掉，有的话缩成小条 */
  private onOutsideClick(): void {
    if (!this.el || this.mode !== "full") {
      return;
    }
    if (!this.hasPending()) {
      this.destroy();
      return;
    }
    this.resetConfirm?.();
    this.collapse();
  }

  /** 到点直接退场（不经过收缩态） */
  private scheduleDismiss(delay: number): void {
    if (this.dismissTimer !== null) {
      window.clearTimeout(this.dismissTimer);
    }
    this.dismissTimer = window.setTimeout(() => {
      this.dismissTimer = null;
      this.destroy();
    }, delay);
  }

  /** 到点收缩；正在被鼠标看着的时候由 pointerenter 取消 */
  private scheduleCollapse(delay: number): void {
    this.cancelCollapse();
    this.collapseTimer = window.setTimeout(() => {
      this.collapseTimer = null;
      this.collapse();
    }, delay);
  }

  private cancelCollapse(): void {
    if (this.collapseTimer !== null) {
      window.clearTimeout(this.collapseTimer);
      this.collapseTimer = null;
    }
  }

  /** 还有没有「等人处理的事」：能撤销，或者有失败项 */
  private hasPending(): boolean {
    return this.undoDeadline > Date.now() || !this.clean;
  }

  private collapse(): void {
    if (!this.el || !this.fullEl || !this.miniEl) {
      return;
    }
    // 零结果卡片不经过小条：条上只有「成功 0」，也没有撤销入口，
    // 多挂 8 秒纯粹是挡住右下角（用户反馈的「跳过后卡片还残余」）
    if (this.noResult) {
      this.destroy();
      return;
    }
    this.mode = "mini";
    this.el.classList.add("sdi-card--mini");
    this.fullEl.hidden = true;
    this.miniEl.hidden = false;

    // 撤销窗口过了、又没有失败项：小条也没有动作可做了，再待一会儿就退场。
    // 不能收缩时立刻销毁 —— 没有待办不等于没有内容（覆盖 / 追加也可能没有撤销窗口），
    // 那样用户根本看不到结果（0.6.5 的 bug）。
    if (!this.hasPending()) {
      this.scheduleDismiss(this.collapseMs * 2);
    }
  }

  private expand(): void {
    if (!this.el || !this.fullEl || !this.miniEl) {
      return;
    }
    // 点开就是在看，别再按小条的钟点抽走它
    if (this.dismissTimer !== null) {
      window.clearTimeout(this.dismissTimer);
      this.dismissTimer = null;
    }
    this.mode = "full";
    this.el.classList.remove("sdi-card--mini");
    this.fullEl.hidden = false;
    this.miniEl.hidden = true;
    this.scheduleCollapse(this.waitMs());
  }

  destroy(): void {
    this.clearTimers();
    if (this.outsideHandler) {
      document.removeEventListener("pointerdown", this.outsideHandler, true);
      this.outsideHandler = null;
    }
    this.resetConfirm = null;
    this.el?.remove();
    this.el = null;
    this.fullEl = null;
    this.miniEl = null;
    this.miniTextEl = null;
    this.miniUndoEl = null;
    this.mode = "full";
    this.undoDeadline = 0;
    this.clean = true;
    this.noResult = false;
    this.progressStartedAt = 0;
  }

  private clearTimers(): void {
    this.cancelCollapse();
    if (this.dismissTimer !== null) {
      window.clearTimeout(this.dismissTimer);
      this.dismissTimer = null;
    }
    if (this.ticker !== null) {
      window.clearInterval(this.ticker);
      this.ticker = null;
    }
    if (this.confirmTimer !== null) {
      window.clearTimeout(this.confirmTimer);
      this.confirmTimer = null;
    }
  }

  /**
   * 撤销：两步确认（防手滑删库），默认 30 秒内有效，到点置灰。
   * 新建的删除、覆盖/追加的写回快照 —— 语义是「回到拖进来之前」。
   */
  private wireUndo(el: HTMLDivElement, options: ShowOptions, undoAction: string): void {
    const button = el.querySelector<HTMLButtonElement>('[data-act="undo"]');
    if (!button) {
      return;
    }

    const windowMs = options.undoWindowMs ?? DEFAULT_UNDO_WINDOW;
    const deadline = Date.now() + windowMs;
    this.undoDeadline = deadline;
    let confirming = false;
    let done = false;

    const render = () => {
      if (done) {
        return;
      }
      const left = deadline - Date.now();
      if (left <= 0) {
        this.undoDeadline = 0;
        button.disabled = true;
        button.textContent = m().card.undoExpired;
        button.classList.remove("sdi-card__btn--danger");
        // 小条上的倒计时跟着一起消失（这一列没了，小条只剩结果摘要）
        if (this.miniUndoEl) {
          this.miniUndoEl.remove();
          this.miniUndoEl = null;
        }
        if (this.ticker !== null) {
          window.clearInterval(this.ticker);
          this.ticker = null;
        }
        // 收缩态 + 没有失败项：这会儿它真的没事可做了，直接收掉。
        // 展开态不动它 —— 人正看着，忽然消失比挡视线更糟。
        if (this.mode === "mini" && this.clean) {
          this.destroy();
        }
        return;
      }
      button.textContent = confirming
        ? m().card.undoConfirm(undoAction)
        : m().card.undo(formatCountdown(left));
      if (this.miniUndoEl) {
        this.miniUndoEl.textContent = m().card.miniUndo(formatCountdown(left));
      }
    };

    this.ticker = window.setInterval(render, 1000);
    render();

    // 点页面别处把卡片收起时顺手复位：否则展开后按钮还停在「确认删除」，
    // 手一快点一下就真删了
    this.resetConfirm = () => {
      if (!confirming) {
        return;
      }
      confirming = false;
      button.classList.remove("is-confirming");
      if (this.confirmTimer !== null) {
        window.clearTimeout(this.confirmTimer);
        this.confirmTimer = null;
      }
      render();
    };

    button.addEventListener("click", async () => {
      if (button.disabled || done) {
        return;
      }
      if (!confirming) {
        confirming = true;
        button.classList.add("is-confirming");
        render();
        this.confirmTimer = window.setTimeout(() => {
          confirming = false;
          button.classList.remove("is-confirming");
          render();
        }, CONFIRM_WINDOW);
        return;
      }

      confirming = false;
      done = true;
      button.disabled = true;
      button.textContent = m().card.undoRunning;
      // 先停掉倒计时与确认窗；下面的 3 秒退场计时不能再被 clearTimers 收走
      this.clearTimers();

      try {
        const text = (await options.onUndo?.()) || m().flow.undoNothing;
        button.textContent = text;
        button.classList.remove("sdi-card__btn--danger");
        // 撤销完就没什么可等的了：3 秒后整张卡片退场（收缩态也一样）
        this.undoDeadline = 0;
        // 文档已经删回去了，「打开第一篇」指向的东西不存在了
        const openButton = el.querySelector<HTMLButtonElement>('[data-act="open"]');
        if (openButton) {
          openButton.disabled = true;
        }
        if (this.miniTextEl) {
          this.miniTextEl.textContent = text;
        }
        if (this.miniUndoEl) {
          this.miniUndoEl.textContent = "";
        }
        this.dismissTimer = window.setTimeout(() => {
          this.dismissTimer = null;
          // 期间可能又拖了一批，别把新卡片一起关掉
          if (this.el === el) {
            this.destroy();
          }
        }, DISMISS_AFTER_UNDO);
      } catch (error) {
        button.textContent = m().card.undoFailed;
        console.error("[drag-import] 撤销失败", error);
        this.scheduleCollapse(this.collapseMs);
      }
    });
  }
}
