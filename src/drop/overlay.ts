import { m } from "../i18n";
import type { DropTarget } from "./controller";

/**
 * 三层视觉：面板描边（固定定位覆盖层）+ 目标行描边 + 顶部横幅。
 * 覆盖层挂在 body 上、pointer-events: none，不往思源的布局 DOM 里插东西，
 * 免得触发它自己的 resize / 观察器。
 */
export class DropOverlay {
  private frame: HTMLDivElement | null = null;
  private textEl: HTMLSpanElement | null = null;
  private hintEl: HTMLSpanElement | null = null;
  private rowEl: HTMLElement | null = null;
  private noteKey = "";
  private visible = false;
  /** 上一次写进样式的矩形：dragover 每秒十几次，位置没变就别重复写（会触发整块重绘） */
  private lastBox = "";

  /**
   * 预热：启动空闲时把覆盖层插进 DOM。
   * 第一次拖进来现建的话，那一次要多付一次样式/布局；面板那么大一块，能感觉到。
   */
  warm(): void {
    const frame = this.ensure();
    if (!frame) {
      return;
    }
    frame.classList.remove("sdi-frame--visible");
    this.visible = false;
  }

  show(panel: HTMLElement, target: DropTarget): void {
    const frame = this.ensure();
    if (!frame) {
      return;
    }
    const rect = panel.getBoundingClientRect();
    const box = `${Math.round(rect.top)}|${Math.round(rect.left)}|${Math.round(rect.width)}|${Math.round(rect.height)}`;
    if (box !== this.lastBox) {
      this.lastBox = box;
      frame.style.top = `${Math.round(rect.top + 1)}px`;
      frame.style.left = `${Math.round(rect.left + 1)}px`;
      frame.style.width = `${Math.max(0, Math.round(rect.width - 2))}px`;
      frame.style.height = `${Math.max(0, Math.round(rect.height - 2))}px`;
    }

    const key = `${target.label}|${target.isNotebookRoot ? "root" : target.parentDocId ?? ""}`;
    if (key !== this.noteKey) {
      this.noteKey = key;
      if (this.textEl) {
        this.textEl.textContent = m().overlay.dropTo(target.label);
      }
      if (this.hintEl) {
        this.hintEl.textContent = target.isNotebookRoot ? m().overlay.root : m().overlay.child;
      }
    }

    this.highlight(target.row);

    if (!this.visible) {
      this.visible = true;
      frame.classList.add("sdi-frame--visible");
    }
  }

  hide(): void {
    if (this.frame) {
      this.frame.classList.remove("sdi-frame--visible");
    }
    this.visible = false;
    this.noteKey = "";
    this.lastBox = "";
    this.highlight(null);
  }

  destroy(): void {
    this.highlight(null);
    this.frame?.remove();
    this.frame = null;
    this.textEl = null;
    this.hintEl = null;
    this.visible = false;
    this.noteKey = "";
    this.lastBox = "";
  }

  private highlight(row: HTMLElement | null): void {
    if (this.rowEl === row) {
      return;
    }
    if (this.rowEl) {
      this.rowEl.classList.remove("sdi-row", "sdi-row--notebook");
    }
    this.rowEl = row;
    if (row) {
      row.classList.add("sdi-row");
      if (row.getAttribute("data-type") === "navigation-root") {
        row.classList.add("sdi-row--notebook");
      }
    }
  }

  private ensure(): HTMLDivElement | null {
    if (this.frame) {
      return this.frame;
    }
    const frame = document.createElement("div");
    frame.className = "sdi-frame";
    const banner = document.createElement("div");
    banner.className = "sdi-banner";
    const text = document.createElement("span");
    text.className = "sdi-banner__text";
    const hint = document.createElement("span");
    hint.className = "sdi-banner__hint";
    banner.append(text, hint);
    frame.append(banner);
    document.body.append(frame);
    this.frame = frame;
    this.textEl = text;
    this.hintEl = hint;
    return frame;
  }
}
