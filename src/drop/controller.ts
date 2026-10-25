import { m } from "../i18n";
import { showMessage } from "siyuan";
import { getBlockInfo } from "../import/api";
import { DropOverlay } from "./overlay";
import {
  isFileDrag,
  isNotebookRow,
  panelOf,
  rowOf,
  rowText,
  scrollHostOf,
  sectionAtY,
  sectionNotebookId,
  sectionNotebookName,
  sectionOfRow,
} from "./selectors";

export interface DropTarget {
  /** 笔记本 id；DOM 里一时拿不到时留空，drop 时再用 blockInfo 兜底 */
  notebook: string;
  /** 命中的文档 id（作为父级）。落在笔记本行 / 空白处时为空 */
  parentDocId?: string;
  /** 横幅上显示的名字 */
  label: string;
  isNotebookRoot: boolean;
  row: HTMLElement | null;
}

type DropHandler = (files: File[], target: DropTarget) => Promise<void> | void;

/** 松手位置 → 目标层级。纯 DOM 同步判断，悬浮阶段每秒几十次也不怕 */
function resolveTarget(node: EventTarget | null, clientY: number): DropTarget | null {
  const panel = panelOf(node);
  if (!panel) {
    return null;
  }

  const row = rowOf(node, panel);
  if (row) {
    const isNotebook = isNotebookRow(row);
    const section = sectionOfRow(row);
    const nodeId = row.getAttribute("data-node-id") ?? "";
    return {
      notebook: section ? sectionNotebookId(section) : isNotebook ? nodeId : "",
      parentDocId: isNotebook ? undefined : nodeId || undefined,
      label: rowText(row) || (isNotebook ? m().flow.defaultNotebook : m().flow.defaultDoc),
      isNotebookRoot: isNotebook,
      row,
    };
  }

  // 面板空白：按纵坐标归到所在的笔记本段，落根级
  const section = sectionAtY(panel, clientY);
  if (!section) {
    return null;
  }
  return {
    notebook: sectionNotebookId(section),
    label: sectionNotebookName(section) || m().flow.defaultNotebook,
    isNotebookRoot: true,
    row: null,
  };
}

/** 请求帧：jsdom / 老旧环境没有 rAF，退回定时器，别让滚动逻辑整个失效 */
function nextFrame(callback: () => void): number {
  const raf = (globalThis as any).requestAnimationFrame;
  if (typeof raf === "function") {
    return raf(callback);
  }
  return setTimeout(callback, 16) as unknown as number;
}

function cancelFrame(id: number): void {
  const caf = (globalThis as any).cancelAnimationFrame;
  if (typeof caf === "function") {
    caf(id);
    return;
  }
  clearTimeout(id);
}

/** 拖到上下边缘多近开始滚 */
const EDGE_ZONE = 56;
/** 一帧最多滚多少像素：60fps 下约 1080px/s，够快但不至于甩飞 */
const EDGE_MAX_SPEED = 18;

/** 拖到文档行但 DOM 没带出笔记本 id 时，用文档 id 反查（探针确认 box 字段就是笔记本 id） */
export async function completeTarget(target: DropTarget): Promise<DropTarget | null> {
  if (target.notebook) {
    return target;
  }
  if (!target.parentDocId) {
    return null;
  }
  const info = await getBlockInfo(target.parentDocId);
  if (!info?.box) {
    return null;
  }
  return { ...target, notebook: info.box };
}

export class DropController {
  private ac: AbortController | null = null;
  private readonly overlay = new DropOverlay();
  private depth = 0;
  private leaveTimer: number | null = null;
  private target: DropTarget | null = null;
  /** 文档树里真正能滚的元素（第一次拖进来时找一次，之后复用） */
  private scrollHost: HTMLElement | null = null;
  /** 当前边缘滚动的速度（px/帧），0 表示不动 */
  private edgeSpeed = 0;
  private edgeFrame: number | null = null;
  private lastPoint: { x: number; y: number } | null = null;
  private edgePanel: HTMLElement | null = null;

  constructor(private readonly onDrop: DropHandler) {}

  start(): void {
    if (this.ac) {
      return;
    }
    const ac = new AbortController();
    this.ac = ac;
    const options: AddEventListenerOptions = { capture: true, signal: ac.signal };
    document.addEventListener("dragenter", this.handleDragEnter, options);
    document.addEventListener("dragover", this.handleDragOver, options);
    document.addEventListener("dragleave", this.handleDragLeave, options);
    document.addEventListener("drop", this.handleDrop, options);
    document.addEventListener("keydown", this.handleKeyDown, options);
  }

  /** 启动空闲时预热：覆盖层的 DOM 先建好，第一次拖拽少一次布局 */
  warm(): void {
    this.overlay.warm();
  }

  stop(): void {
    this.ac?.abort();
    this.ac = null;
    this.overlay.destroy();
    this.reset();
  }

  private handleDragEnter = (event: DragEvent): void => {
    if (!isFileDrag(event)) {
      return;
    }
    const panel = panelOf(event.target);
    if (!panel) {
      this.reset();
      return;
    }
    this.depth += 1;
    this.cancelHide();
    this.lastPoint = { x: event.clientX, y: event.clientY };
    this.edgePanel = panel;
    const target = resolveTarget(event.target, event.clientY);
    if (!target) {
      return;
    }
    this.target = target;
    // 先读后写：updateEdgeScroll 要读 rect / scrollTop，overlay.show 要写样式；
    // 顺序反过来就是「写→读」，浏览器会被迫在每次 dragover 同步重算一次布局
    this.updateEdgeScroll(panel, event.clientY);
    this.overlay.show(panel, target);
  };

  private handleDragOver = (event: DragEvent): void => {
    if (!isFileDrag(event)) {
      return;
    }
    const panel = panelOf(event.target);
    if (!panel) {
      // 文档树以外一律不接管：编辑器里的拖图、拖文字保持原生行为
      return;
    }
    // 思源对外部文件 dragover 不 preventDefault，不补这一行光标是禁止态、drop 根本不触发
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "copy";
    }
    const target = resolveTarget(event.target, event.clientY);
    if (!target) {
      return;
    }
    this.target = target;
    this.lastPoint = { x: event.clientX, y: event.clientY };
    this.edgePanel = panel;
    // 同 dragenter：把「读布局」放在「写样式」前面
    this.updateEdgeScroll(panel, event.clientY);
    this.overlay.show(panel, target);
  };

  private handleDragLeave = (event: DragEvent): void => {
    if (!isFileDrag(event)) {
      return;
    }
    if (this.depth > 0) {
      this.depth -= 1;
    }
    if (this.depth <= 0) {
      this.scheduleHide();
    }
  };

  private handleDrop = (event: DragEvent): void => {
    if (!isFileDrag(event)) {
      return;
    }
    // 事件对象在异步里会失效，File 列表必须同步抓出来
    const files = Array.from(event.dataTransfer?.files ?? []);
    const panel = panelOf(event.target);

    if (!panel) {
      // 树以外不接管。但编辑器里的 drop 必须放行——那是思源自己的「拖图入正文」，
      // 我们一 preventDefault 就把原生插图打死了；编辑器之外才做兜底，
      // 防止 Electron 把整个窗口导航到 file://。
      if (!(event.target instanceof Element) || !event.target.closest(".protyle")) {
        event.preventDefault();
      }
      this.reset();
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const target = resolveTarget(event.target, event.clientY) ?? this.target;
    this.reset();

    if (!target || files.length === 0) {
      return;
    }

    // 这里**不要**拦「上一批还没完」：排队由 index.ts 的 importFiles 负责，
    // 在这一层拦掉的话，第二批连队列都进不去（0.7.3 实测：用户看到「请稍候」然后永远没动静）。
    Promise.resolve(this.onDrop(files, target))
      .catch((error) => {
        console.error("[drag-import] 导入流程异常", error);
        showMessage(m().flow.importFailed(String((error as Error)?.message ?? error)));
      });
  };

  private handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      this.reset();
    }
  };

  /**
   * 拖到文档树上下边缘时自动滚。
   * dragover 每秒只来十几次，用它算速度、用 rAF 持续滚，
   * 否则滚动会一顿一顿的。
   */
  private updateEdgeScroll(panel: HTMLElement, clientY: number): void {
    const host = this.ensureScrollHost(panel);
    if (!host) {
      this.setEdgeSpeed(0);
      return;
    }
    const rect = host.getBoundingClientRect();
    // 指针不在滚动容器的高度范围内（比如停在面板标题栏）就别滚
    if (rect.height === 0 || clientY < rect.top || clientY > rect.bottom) {
      this.setEdgeSpeed(0);
      return;
    }

    const fromTop = clientY - rect.top;
    const fromBottom = rect.bottom - clientY;
    let speed = 0;
    if (fromTop < EDGE_ZONE) {
      speed = -Math.ceil(((EDGE_ZONE - fromTop) / EDGE_ZONE) * EDGE_MAX_SPEED);
    } else if (fromBottom < EDGE_ZONE) {
      speed = Math.ceil(((EDGE_ZONE - fromBottom) / EDGE_ZONE) * EDGE_MAX_SPEED);
    }
    // 已经到头就别空转（先判掉，省得 rAF 一直空跑）
    if (speed < 0 && host.scrollTop <= 0) {
      speed = 0;
    }
    if (speed > 0 && host.scrollTop + host.clientHeight >= host.scrollHeight - 1) {
      speed = 0;
    }
    this.setEdgeSpeed(speed);
  }

  private ensureScrollHost(panel: HTMLElement): HTMLElement | null {
    if (this.scrollHost && panel.contains(this.scrollHost)) {
      return this.scrollHost;
    }
    this.scrollHost = scrollHostOf(panel);
    return this.scrollHost;
  }

  private setEdgeSpeed(speed: number): void {
    this.edgeSpeed = speed;
    if (speed === 0) {
      this.stopEdgeLoop();
      return;
    }
    if (this.edgeFrame === null) {
      this.edgeFrame = nextFrame(this.stepEdge);
    }
  }

  private stepEdge = (): void => {
    this.edgeFrame = null;
    const host = this.scrollHost;
    if (!host || this.edgeSpeed === 0) {
      return;
    }
    const before = host.scrollTop;
    host.scrollTop = before + this.edgeSpeed;
    if (host.scrollTop === before) {
      // 滚不动了（到顶/到底），停下等下一次 dragover 重新判断
      this.edgeSpeed = 0;
      return;
    }
    // 滚动之后指针下面的行换了，但此时不会有 dragover：自己重算一次高亮
    if (this.edgePanel && this.lastPoint) {
      const target = resolveTarget(this.edgePanel, this.lastPoint.y);
      if (target && (target.row !== this.target?.row || target.label !== this.target?.label)) {
        this.target = target;
        this.overlay.show(this.edgePanel, target);
      }
    }
    this.edgeFrame = nextFrame(this.stepEdge);
  };

  private stopEdgeScroll(): void {
    this.edgeSpeed = 0;
    this.stopEdgeLoop();
  }

  private stopEdgeLoop(): void {
    if (this.edgeFrame !== null) {
      cancelFrame(this.edgeFrame);
      this.edgeFrame = null;
    }
  }

  private scheduleHide = (): void => {
    this.cancelHide();
    // 子元素间穿梭会连续触发 dragleave，60ms 延迟消除闪烁
    this.leaveTimer = window.setTimeout(() => {
      this.leaveTimer = null;
      this.target = null;
      this.overlay.hide();
      this.stopEdgeScroll();
      this.lastPoint = null;
      this.edgePanel = null;
    }, 60);
  };

  private cancelHide(): void {
    if (this.leaveTimer !== null) {
      window.clearTimeout(this.leaveTimer);
      this.leaveTimer = null;
    }
  }

  private reset(): void {
    this.cancelHide();
    this.depth = 0;
    this.target = null;
    this.overlay.hide();
    this.stopEdgeScroll();
    this.lastPoint = null;
    this.edgePanel = null;
  }
}
