import { openTab, Plugin, showMessage } from "siyuan";
import { completeTarget, DropController } from "./drop/controller";
import type { DropTarget } from "./drop/controller";
import { lsNotebooks } from "./import/api";
import { runPlan } from "./import/executor";
import type { ExecResult, FailureItem } from "./import/executor";
import { resolvePlan, scanPlan } from "./import/planner";
import type { ConflictChoice, PlanItem } from "./import/planner";
import { rollbackBatch, undoImport } from "./import/undo";
import { detectLanguage, m, setLanguage } from "./i18n";
import { nodeFs, nodePath, nodeRequire } from "./platform";
import { AppLogger } from "./logger";
import type { LogBatch } from "./logger";
import { analyzeSources, pendingReadHint } from "./source/analyze";
import type { RejectedSource } from "./source/analyze";
import { createSettingPanel, DEFAULT_SETTINGS, normalizeSettings, SETTINGS_KEY } from "./settings";
import type { Settings } from "./settings";
import { ConflictCard } from "./ui/conflict";
import { SerialQueue } from "./util/serialQueue";
import { ResultCard } from "./ui/result";

/** 让浏览器先把刚插进 DOM 的东西画出来，再继续跑同步任务 */
function paintFirst(): Promise<void> {
  return new Promise((resolve) => {
    const raf = (globalThis as any).requestAnimationFrame;
    if (typeof raf === "function") {
      raf(() => setTimeout(resolve, 0));
      return;
    }
    setTimeout(resolve, 0);
  });
}

/**
 * 篇数超过这个才值得为「查同名」铺一张卡片。
 * 查重是 8 路并发（见 planner），几十篇就是毫秒级；铺了反而闪一下。
 */
const CHECKING_HINT_MIN = 100;

/**
 * 同名条目超过这个数、又选了「加后缀」时补一张卡片。
 * 加后缀要为每篇找一个没被占用的「名称 (2)」，串行一次内核往返一篇：
 * 500 篇接近 1 秒，这期间没有任何反馈的话看起来就是卡住了。
 */
const RENAME_HINT_MIN = 50;

module.exports = class DragImport extends Plugin {
  private logger: AppLogger | null = null;
  private controller: DropController | null = null;
  private card = new ResultCard();
  private conflict = new ConflictCard();
  private settings: Settings = { ...DEFAULT_SETTINGS };
  /** 所有会写库的流程都从这里排队：一次只跑一个（见 SerialQueue 的注释） */
  private readonly queue = new SerialQueue();
  /** 已卸载 / 重载：正在跑的批次要立刻停手，别再建文档、别再弹卡片 */
  private disposed = false;
  /** 插件加载完成的时刻：日志里记「这次拖入距加载多久」，用来分辨冷启动 */
  private loadedAt = Date.now();

  async onload() {
    this.disposed = false;
    this.loadedAt = Date.now();

    // 语言先定：下面所有文案（含设置面板）都跟着它走
    setLanguage(detectLanguage());

    // 设置先读，后面的行为都依赖它
    try {
      this.settings = normalizeSettings(await this.loadData(SETTINGS_KEY));
    } catch (error) {
      console.error("[drag-import] 读取设置失败，用默认值", error);
    }

    // 每一步独立 try/catch：一处抛错不能把后面的注册全带走
    const steps: string[] = [];
    const attempt = (name: string, run: () => void) => {
      try {
        run();
        steps.push(`${name}: ok`);
      } catch (error: any) {
        steps.push(`${name}: FAIL ${String(error?.message ?? error)}`);
        console.error(`[drag-import] 初始化 ${name} 失败`, error);
      }
    };

    // 日志最先：后面每一步都要往里写
    attempt("logger", () => {
      this.logger = new AppLogger();
      this.logger.init();
    });
    attempt("drop", () => {
      this.controller = new DropController((files, target) => this.importFiles(files, target));
      this.controller.start();
    });
    attempt("settings", () => {
      // 交给基类存：字段名必须叫 setting，Plugin.openSetting() 读的就是它。
      // 顶栏「插件」菜单和集市「已下载」里的齿轮都走 openSetting()，
      // 所以不用再自己 addTopBar 挂一个齿轮（0.6.3 起去掉）。
      this.setting = createSettingPanel(this.settings, () => {
        void this.saveSettings();
      });
    });

    this.logger?.event("lifecycle", "onload", {
      steps,
      logging: this.logger?.status ?? "",
    });
    this.logger?.flush();

    if (!this.controller) {
      showMessage(m().flow.loadFailed);
    }

    // 第一次拖入不该为「首次 require / 首次解 GBK / 首次建覆盖层」买单：
    // 这些都是一次性的固定开销，挪到启动空闲时先付掉
    this.warmUp();
  }

  /**
   * 启动后空闲时的预热。只碰纯本地资源，失败也不影响任何功能；
   * 目的是让「刚打开思源第一次拖入」不再比后面几次更慢。
   */
  private warmUp(): void {
    const run = () => {
      if (this.disposed) {
        return;
      }
      try {
        nodeFs();
        nodePath();
        nodeRequire("electron");
        // GBK 解码器首次构造要加载编码表，第一次拖 GBK 文件时会卡一下
        new TextDecoder("gbk");
        this.controller?.warm();
      } catch (error) {
        console.error("[drag-import] 预热失败（不影响功能）", error);
      }
    };
    const idle = (globalThis as any).requestIdleCallback;
    if (typeof idle === "function") {
      idle(run, { timeout: 2000 });
      return;
    }
    window.setTimeout(run, 800);
  }

  onunload() {
    this.disposed = true;
    this.controller?.stop();
    this.controller = null;
    // 卸载了就别再开始新的批次（在跑的那个会看到 disposed 自己停）
    this.queue.stop();
    // 冲突卡片没决断就卸载：按「取消」处理，不能偷偷建文档
    this.conflict.destroy();
    this.card.destroy();
    this.logger?.event("lifecycle", "onunload");
    this.logger?.flush();
  }

  /**
   * 批次排队串行跑：两批并行会各自查重、互相看不见对方正在建的文档，
   * 同名判断直接失效（可能撞出两篇同名），卡片和撤销入口也会互相顶掉。
   */
  private async importFiles(files: File[], target: DropTarget): Promise<void> {
    if (this.disposed) {
      return;
    }
    if (this.queue.busy) {
      showMessage(m().flow.queued(files.length), 3000);
    }
    try {
      await this.queue.push(() => this.runImport(files, target));
    } catch (error) {
      // 一批炸了不能把后面的堵死：队列自己会继续，这里只负责告诉用户
      console.error("[drag-import] 批次异常", error);
      showMessage(m().flow.importFailed(String((error as Error)?.message ?? error)));
    }
  }

  private async runImport(files: File[], rawTarget: DropTarget): Promise<void> {
    const batch = this.logger?.batch() ?? null;
    const started = Date.now();
    const skipped: RejectedSource[] = [];

    try {
      batch?.event("import", "start", {
        count: files.length,
        target: rawTarget.label,
        sinceLoad: Date.now() - this.loadedAt,
      });

      // DOM 里拿不到笔记本 id 时，用文档 id 反查
      const target = await completeTarget(rawTarget);
      if (!target) {
        this.fail(m().flow.noTarget, batch, started);
        return;
      }

      const notebooks = await lsNotebooks();
      const notebook = notebooks.find((item) => item.id === target.notebook);
      if (!notebook) {
        throw new Error(m().flow.notebookGone);
      }
      // 关闭的笔记本 createDocWithMd 只会回「查询笔记本失败」，提前拦掉给明确提示
      if (notebook.closed) {
        throw new Error(m().flow.notebookClosed(notebook.name));
      }

      // 解压与遍历文件夹是同步的：大包会卡住渲染进程几百毫秒到几秒。
      // 先铺一张「正在读取…」并让出一帧，让它真的画出来（同一 tick 里插 DOM 是画不出来的）。
      const hint = pendingReadHint(files);
      if (hint) {
        this.card.showReading(files.map((file) => file.name).join(m().common.listSep).slice(0, 40), hint);
        await paintFirst();
      }

      const analyzeStarted = Date.now();
      const analysis = analyzeSources(files, batch, {
        // 设置里存的是「保留结构」，analyze 要的是「跳过根」，方向相反
        skipRootFolder: !this.settings.keepTopFolder,
      });
      const analyzeMs = Date.now() - analyzeStarted;
      skipped.push(...analysis.rejected);
      batch?.event("analyze", "done", {
        ms: analyzeMs,
        md: analysis.md.length,
        skipped: skipped.length,
      });

      if (this.disposed) {
        return;
      }

      if (analysis.md.length === 0) {
        batch?.event("import", "nothing", { skipped: skipped.length });
        this.card.show({
          ok: [],
          failed: [],
          skipped,
          ms: Date.now() - started,
          logPath: this.logger?.filePath ?? "",
        });
        return;
      }

      // 多选几百个单独 md 时，前面没有「解压/读取」卡片，查重这段也得给个交代
      if (analysis.md.length >= CHECKING_HINT_MIN && !this.disposed) {
        this.card.showReading(m().card.count(analysis.md.length), "check");
        await paintFirst();
      }

      // 先扫一遍：有同名就停下来问，别先建一半再问
      const planStarted = Date.now();
      const plan = await scanPlan(analysis.md, target, batch);
      const planMs = Date.now() - planStarted;
      const conflicts = plan.entries.filter((entry) => entry.existingId);
      batch?.event("plan", "done", { ms: planMs, entries: plan.entries.length, conflicts: conflicts.length });
      let choices: Map<string, ConflictChoice> | undefined;

      // 查重期间插件被卸载：别再弹一张没人能点的冲突卡片
      if (this.disposed) {
        return;
      }

      if (conflicts.length > 0) {
        batch?.event("plan", "conflict-prompt", { count: conflicts.length });
        const answer = await this.conflict.ask(
          conflicts.map((entry) => ({ name: entry.name, hpath: entry.hpath })),
          target.label,
          { defaultChoice: this.settings.conflictDefault },
        );
        if (!answer) {
          batch?.event("import", "cancelled", { conflicts: conflicts.length, ms: Date.now() - started });
          if (this.disposed) {
            return;
          }
          this.card.show({
            ok: [],
            failed: [],
            skipped: [],
            ms: Date.now() - started,
            logPath: this.logger?.filePath ?? "",
            cancelled: true,
          });
          return;
        }
        choices = answer;
      }

      const willRename =
        conflicts.length >= RENAME_HINT_MIN &&
        conflicts.some((entry) => (choices?.get(entry.hpath) ?? this.settings.conflictDefault) === "suffix");
      if (willRename && !this.disposed) {
        this.card.showReading(m().card.count(conflicts.length), "rename");
        await paintFirst();
      }

      const resolveStarted = Date.now();
      const resolved = await resolvePlan(plan, {
        choices,
        fallback: this.settings.conflictDefault,
        batch,
      });
      const resolveMs = Date.now() - resolveStarted;
      batch?.event("plan", "resolved", { ms: resolveMs, items: resolved.items.length });
      skipped.push(...resolved.skipped.map((item) => ({ ...item, kind: "other" as const })));

      if (this.disposed) {
        return;
      }

      if (resolved.items.length === 0) {
        batch?.event("import", "nothing", { skipped: skipped.length });
        this.card.show({
          ok: [],
          failed: plan.rejected,
          skipped,
          ms: Date.now() - started,
          logPath: this.logger?.filePath ?? "",
        });
        return;
      }

      // 文件夹/压缩包动辄几十上百篇，先给「收到了」的反馈，跑完换结果
      const stopRequested = { value: false };
      this.card.showProgress(resolved.items.length, m().card.progressTarget(target.label), () => {
        stopRequested.value = true;
      });

      const execStarted = Date.now();
      const result = await runPlan(
        resolved.items,
        target.notebook,
        batch,
        (done, total, name) => this.card.updateProgress(done, total, name),
        () => stopRequested.value || this.disposed,
        {
          uploadImages: this.settings.uploadImages,
          stripFrontmatter: this.settings.stripFrontmatter,
          removeDuplicateH1: this.settings.removeDuplicateH1,
          convertWikilinks: this.settings.convertWikilinks,
          maxBytes: this.settings.maxFileMB * 1024 * 1024,
        },
      );
      const execMs = Date.now() - execStarted;
      const failed = [...result.failed, ...plan.rejected];
      // 能撤销的：本批新建的（删除）+ 覆盖/追加且拿到了快照的（还原）
      const createdCount = result.ok.filter((item) => item.mode === "create").length;
      const restoredCount = result.ok.filter((item) => item.mode !== "create" && item.before).length;
      // 能重试的：只有「再试一次可能成功」的失败（文件超限这种重试多少次都一样）
      const retryItems = result.failed.flatMap((item) => (item.retryable && item.item ? [item.item] : []));

      if (this.disposed) {
        return;
      }

      // 「取消」= 撤销：本次导入的内容一点不留。
      // 用户拖错了、或者发现导到一半不对时，期望的是回到拖进来之前，
      // 而不是「留下一半让我自己收拾」。所以这里立刻把已建的全撤掉。
      if (result.cancelled) {
        await this.rollbackCancelled(plan, result, target.notebook, batch);
        return;
      }

      this.card.show(
        {
          ok: result.ok,
          failed,
          skipped,
          ms: Date.now() - started,
          logPath: this.logger?.filePath ?? "",
          assets: result.assets,
          undoOff: result.snapshotOverflow,
          links: result.links,
        },
        {
          onOpenFirst: (id) => this.openDoc(id),
          ...(createdCount + restoredCount > 0 && !result.snapshotOverflow
            ? { onUndo: () => this.undoImport(plan, result, target.notebook, batch) }
            : {}),
          ...(retryItems.length > 0
            ? { onRetry: () => this.retryImport(retryItems, target.notebook, batch) }
            : {}),
          undoWindowMs: this.settings.undoWindowSeconds * 1000,
        },
      );

      batch?.event("import", result.cancelled ? "cancelled-done" : "done", {
        ok: result.ok.length,
        overwritten: result.ok.filter((item) => item.mode === "overwrite").length,
        failed: failed.length,
        skipped: skipped.length,
        ms: Date.now() - started,
        // 分段耗时：卡在哪一段（本机分析 / 查重 / 加后缀 / 建文档）一眼能看出来
        analyzeMs,
        planMs: planMs + resolveMs,
        executeMs: execMs,
        sinceLoad: Date.now() - this.loadedAt,
      });
    } catch (error: any) {
      const message = String(error?.message ?? error);
      batch?.event("import", "abort", { err: message, ms: Date.now() - started });
      this.fail(message, batch, started, skipped);
    } finally {
      // 这一批结束了：日志立即落盘，别等 250ms 的定时器
      this.logger?.flush();
    }
  }

  /**
   * 撤销本批：新建的删掉、覆盖/追加的写回导入前快照（见 import/undo.ts）
   */
  private async undoImport(
    plan: { autoDirs: string[] },
    result: ExecResult,
    notebook: string,
    batch: LogBatch | null,
  ): Promise<string> {
    const created = result.ok
      .filter((item) => item.mode === "create")
      .map((item) => ({ id: item.id, hpath: item.hpath }));
    const restored = result.ok
      .filter((item) => item.mode !== "create" && item.before)
      .map((item) => ({ id: item.id, before: item.before as string }));

    const outcome = await undoImport({ notebook, created, restored, autoDirs: plan.autoDirs });
    batch?.event("undo", "done", { ...outcome });

    const text = m().flow;
    const parts: string[] = [];
    if (outcome.removed > 0) parts.push(text.undoRemoved(outcome.removed));
    if (outcome.restored > 0) parts.push(text.undoRestored(outcome.restored));
    if (parts.length === 0) parts.push(text.undoNothing);
    if (outcome.failed > 0) parts.push(text.undoFailed(outcome.failed));
    return parts.join(" · ");
  }

  /**
   * 取消导入 = 把这一批已经写进去的全撤掉。
   *
   * 语义上和「撤销」一致（回到拖进来之前）：
   * - 新建的文档删掉
   * - 覆盖 / 追加的写回导入前的原文快照
   *
   * 撤不回来的（没拿到快照的覆盖、内核拒绝删除）如实报在卡片上，
   * 免得用户以为「什么都没留下」，实际有几篇正文已经被改了。
   */
  private async rollbackCancelled(
    plan: { autoDirs: string[] },
    result: ExecResult,
    notebook: string,
    batch: LogBatch | null,
  ): Promise<void> {
    const targets = result.ok.map((item) => ({
      id: item.id,
      hpath: item.hpath,
      name: item.name,
      mode: item.mode,
      before: item.before,
    }));

    const info = await rollbackBatch({ notebook, targets, autoDirs: plan.autoDirs });
    batch?.event("undo", "cancel-rollback", { ...info });

    if (this.disposed) {
      return;
    }

    // 撤不回来的文档要点名：用户得知道是哪几篇正文还留着被改过的样子
    const problems: FailureItem[] = [
      ...info.unrestoredNames.map((name) => ({ name, reason: m().card.cancelledUnrestoredHint })),
      ...info.failedTargets.map((name) => ({ name, reason: m().card.cancelledRollbackFailedHint })),
    ];

    this.card.show({
      ok: [],
      failed: [],
      skipped: [],
      problems,
      ms: 0,
      logPath: this.logger?.filePath ?? "",
      cancelled: true,
      rolledBack: {
        removed: info.removed,
        restored: info.restored,
        failed: info.failed,
        unrestored: info.unrestored,
      },
    });
  }

  /**
   * 重试也要排队：否则重试跑着的时候再拖一批，两批又会并行
   * （查重互相看不见对方正在建的文档 → 可能撞出重复文档）。
   */
  private async retryImport(items: PlanItem[], notebook: string, batch: LogBatch | null): Promise<void> {
    if (this.disposed) {
      return;
    }
    if (this.queue.busy) {
      showMessage(m().flow.queued(items.length), 3000);
    }
    try {
      await this.queue.push(() => this.runRetry(items, notebook, batch));
    } catch (error) {
      console.error("[drag-import] 重试批次异常", error);
      showMessage(m().flow.importFailed(String((error as Error)?.message ?? error)));
    }
  }

  /**
   * 只重跑失败的那几篇：hpath / 冲突策略都是第一次定好的，不用再查重。
   * 跑完显示一张新的结果卡片（旧卡片的撤销窗口随之结束）。
   */
  private async runRetry(items: PlanItem[], notebook: string, batch: LogBatch | null): Promise<void> {
    const started = Date.now();
    const stopRequested = { value: false };

    this.card.showProgress(items.length, m().card.progressRetry, () => {
      stopRequested.value = true;
    });

    const result = await runPlan(
      items,
      notebook,
      batch,
      (done, total, name) => this.card.updateProgress(done, total, name),
      () => stopRequested.value || this.disposed,
      {
        uploadImages: this.settings.uploadImages,
        stripFrontmatter: this.settings.stripFrontmatter,
        removeDuplicateH1: this.settings.removeDuplicateH1,
        convertWikilinks: this.settings.convertWikilinks,
        maxBytes: this.settings.maxFileMB * 1024 * 1024,
      },
    );

    const createdCount = result.ok.filter((item) => item.mode === "create").length;
    const restoredCount = result.ok.filter((item) => item.mode !== "create" && item.before).length;
    const retryItems = result.failed.flatMap((item) => (item.retryable && item.item ? [item.item] : []));

    if (this.disposed) {
      return;
    }

    // 取消 = 撤销：重试批次也一样，撤掉这次重试已经建好的部分
    if (result.cancelled) {
      // 重试时目录都建好了，回滚只删这批新建的文档（autoDirs 传空）
      await this.rollbackCancelled({ autoDirs: [] }, result, notebook, batch);
      return;
    }

    this.card.show(
      {
        ok: result.ok,
        failed: result.failed,
        skipped: [],
        ms: Date.now() - started,
        logPath: this.logger?.filePath ?? "",
        assets: result.assets,
        undoOff: result.snapshotOverflow,
        links: result.links,
      },
      {
        onOpenFirst: (id) => this.openDoc(id),
        // 重试时目录都建好了，撤销只删这批新建的文档
        ...(createdCount + restoredCount > 0 && !result.snapshotOverflow
          ? { onUndo: () => this.undoImport({ autoDirs: [] }, result, notebook, batch) }
          : {}),
        ...(retryItems.length > 0
          ? { onRetry: () => this.retryImport(retryItems, notebook, batch) }
          : {}),
        undoWindowMs: this.settings.undoWindowSeconds * 1000,
      },
    );

    batch?.event("import", "retry-done", {
      ok: result.ok.length,
      failed: result.failed.length,
      ms: Date.now() - started,
    });
    this.logger?.flush();
  }

  private fail(
    message: string,
    batch: LogBatch | null,
    started: number,
    skipped: RejectedSource[] = [],
  ): void {
    showMessage(m().flow.warning(message), 6000, "error");
    if (this.disposed) {
      return;
    }
    this.card.show({
      ok: [],
      failed: [{ name: m().flow.notFinished, reason: message }],
      skipped,
      ms: Date.now() - started,
      logPath: this.logger?.filePath ?? "",
    });
  }

  private async saveSettings(): Promise<void> {
    try {
      await this.saveData(SETTINGS_KEY, this.settings);
      this.logger?.event("settings", "saved", { ...this.settings });
    } catch (error) {
      console.error("[drag-import] 保存设置失败", error);
      showMessage(m().flow.settingsSaveFailed);
    }
  }

  private openDoc(id: string): void {
    try {
      if (typeof openTab === "function") {
        openTab({ app: this.app, doc: { id } });
        return;
      }
      const fallback = window.openTab;
      if (typeof fallback === "function") {
        fallback({ app: this.app, doc: { id } });
        return;
      }
    } catch (error) {
      console.error("[drag-import] 打开文档失败", error);
    }
    showMessage(m().flow.openDocFailed);
  }
};
