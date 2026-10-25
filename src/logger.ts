import { nodeFs, nodePath, workspaceDir } from "./platform";

const PLUGIN = "siyuan-drag-import";
/** 只留最近 20 个批次文件（设计 §8.4） */
const MAX_LOG_FILES = 20;
/**
 * 攒够多少行落盘一次。
 * 一次 appendFileSync 在 Windows 上约 0.5ms，500 篇的批次会产生 ~1500 条事件，
 * 逐条写光打开/关闭文件就要 700ms（实测），比建文档本身还慢。
 */
const FLUSH_LINES = 40;
/** 不够 40 行时最多等这么久，别让日志迟迟不落盘 */
const FLUSH_MS = 250;

/** mmdd-HHmm，本地时间；同一分钟内多批会写进同一个文件，靠 batch 字段区分 */
function stamp(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}`;
}

function isoNow(): string {
  return new Date().toISOString();
}

/**
 * 落盘诊断。Store 版没有 F12，日志是唯一能拿到的现场；
 * 任何一步失败都不能把插件拖死，所以这里全部吞异常并降级到控制台。
 */
export class AppLogger {
  private fs: any = null;
  private path: any = null;
  private dir = "";
  private file = "";
  private buffer: string[] = [];
  private flushTimer: number | null = null;
  ready = false;
  problem = "";

  init(): void {
    try {
      this.fs = nodeFs();
      this.path = nodePath();
      if (!this.fs || !this.path) {
        this.problem = "fs/path unavailable";
        return;
      }
      const ws = workspaceDir();
      if (!ws) {
        this.problem = "workspaceDir unavailable";
        return;
      }
      this.dir = this.path.join(ws, "data", "storage", "petal", PLUGIN, "logs");
      this.fs.mkdirSync(this.dir, { recursive: true });
      this.file = this.path.join(this.dir, `${stamp()}.jsonl`);
      this.ready = true;
      this.prune();
    } catch (error: any) {
      this.problem = String(error?.message ?? error);
      console.error("[drag-import] 日志初始化失败", error);
    }
  }

  get filePath(): string {
    return this.file;
  }

  get status(): string {
    return this.ready ? `logging → ${this.file}` : `logging off (${this.problem})`;
  }

  /** 非批次事件（onload / onunload / 初始化失败这类） */
  event(phase: string, action: string, payload: Record<string, unknown> = {}): void {
    this.append(JSON.stringify({ ts: isoNow(), batch: "-", phase, action, ...payload }));
  }

  batch(): LogBatch {
    return new LogBatch(this);
  }

  /** @internal 先攒着，见 FLUSH_LINES 的注释 */
  append(line: string): void {
    console.log(`[drag-import] ${line}`);
    if (!this.ready) {
      return;
    }
    this.buffer.push(line);
    if (this.buffer.length >= FLUSH_LINES) {
      this.flush();
      return;
    }
    if (this.flushTimer === null) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        this.flush();
      }, FLUSH_MS) as unknown as number;
    }
  }

  /**
   * 把缓冲区写进日志文件。批次结束、onload / onunload 都会主动调一次，
   * 情况不对时最多丢最后 250ms 的日志，换来的是导入速度不被日志拖住。
   */
  flush(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.buffer.length === 0) {
      return;
    }
    const text = `${this.buffer.join("\n")}\n`;
    this.buffer.length = 0;
    if (!this.ready) {
      return;
    }
    try {
      this.fs.appendFileSync(this.file, text, "utf-8");
    } catch (error) {
      this.ready = false;
      this.problem = `write failed: ${String((error as any)?.message ?? error)}`;
      console.error("[drag-import] 日志写入失败，已降级为仅控制台", error);
    }
  }

  private prune(): void {
    try {
      const files = (this.fs.readdirSync(this.dir) as string[])
        .filter((name) => name.endsWith(".jsonl"))
        .map((name) => {
          const full = this.path.join(this.dir, name);
          return { full, mtime: this.fs.statSync(full).mtimeMs as number };
        })
        .sort((a, b) => b.mtime - a.mtime);
      for (const item of files.slice(MAX_LOG_FILES)) {
        this.fs.unlinkSync(item.full);
      }
    } catch (error) {
      console.error("[drag-import] 清理旧日志失败", error);
    }
  }
}

/**
 * 一次拖入 = 一个批次。**只在内存里留 id**：卡片只显示日志文件路径，
 * 整份 JSONL 不再攒第二份（大批次下那是几百 KB 的无用字符串）。
 */
export class LogBatch {
  readonly id: string;

  constructor(private readonly owner: AppLogger) {
    this.id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  }

  event(phase: string, action: string, payload: Record<string, unknown> = {}): void {
    this.owner.append(JSON.stringify({ ts: isoNow(), batch: this.id, phase, action, ...payload }));
  }
}
