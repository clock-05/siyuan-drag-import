import { m } from "../i18n";
import type { ConflictChoice } from "../import/planner";

export interface ConflictEntry {
  name: string;
  hpath: string;
}

const MAX_ROWS = 5;

/** 策略名字跟着界面语言走，所以不能在模块级求值 */
function choiceLabel(value: ConflictChoice): string {
  const text = m().conflict;
  switch (value) {
    case "skip":
      return text.choiceSkip;
    case "overwrite":
      return text.choiceOverwrite;
    case "append":
      return text.choiceAppend;
    default:
      return text.choiceSuffix;
  }
}

const CHOICES: ConflictChoice[] = ["skip", "suffix", "overwrite", "append"];

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

/**
 * 同名冲突卡片：逐条选，或一键全部。
 * 关闭 / 取消 = 本次导入不执行（已经建出来一半再问就晚了）。
 */
export class ConflictCard {
  private el: HTMLDivElement | null = null;
  private finish: ((value: Map<string, ConflictChoice> | null) => void) | null = null;
  private choices = new Map<string, ConflictChoice>();

  ask(
    entries: ConflictEntry[],
    targetLabel: string,
    options: { defaultChoice?: ConflictChoice } = {},
  ): Promise<Map<string, ConflictChoice> | null> {
    this.destroy();
    const text = m().conflict;
    const fallback = options.defaultChoice ?? "suffix";
    this.choices = new Map(entries.map((entry) => [entry.hpath, fallback]));

    const shown = entries.slice(0, MAX_ROWS);
    const rest = entries.length - shown.length;
    // 只有一条时「全部跳过 / 全部覆盖」是纯噪音，逐条那四个按钮就够了
    const multiple = entries.length > 1;

    const rows = shown
      .map(
        (entry) => `
        <li class="sdi-conflict__row" data-hpath="${esc(entry.hpath)}">
          <span class="sdi-conflict__name" title="${esc(entry.hpath)}">${esc(entry.name)}</span>
          <span class="sdi-conflict__ops">
            ${CHOICES
              .map(
                (choice) =>
                  `<button type="button" class="sdi-conflict__op" data-choice="${choice}">${choiceLabel(choice)}</button>`,
              )
              .join("")}
          </span>
        </li>`,
      )
      .join("");

    const el = document.createElement("div");
    el.className = "sdi-card sdi-conflict";
    el.innerHTML = `
      <div class="sdi-card__head">
        <span class="sdi-card__title">${
          multiple ? text.titleMany(entries.length) : text.titleOne
        }</span>
        <button class="sdi-card__close" type="button" aria-label="${esc(m().common.cancelImport)}">×</button>
      </div>
      <div class="sdi-card__counts">${esc(
        multiple ? text.targetMany(targetLabel) : text.targetOne(targetLabel),
      )}</div>
      <ul class="sdi-conflict__list">${rows}</ul>
      ${rest > 0 ? `<div class="sdi-conflict__more">${esc(text.more(rest))}</div>` : ""}
      <div class="sdi-conflict__warn" hidden>${esc(text.warn)}</div>
      ${
        multiple
          ? `<div class="sdi-conflict__bulk">
        <button type="button" class="sdi-card__btn" data-all="skip">${esc(text.allSkip)}</button>
        <button type="button" class="sdi-card__btn" data-all="suffix">${esc(text.allSuffix)}</button>
        <button type="button" class="sdi-card__btn" data-all="overwrite">${esc(text.allOverwrite)}</button>
        <button type="button" class="sdi-card__btn" data-all="append">${esc(text.allAppend)}</button>
      </div>`
          : ""
      }
      <div class="sdi-card__foot">
        <button type="button" class="sdi-card__btn" data-act="cancel">${esc(m().common.cancelImport)}</button>
        <button type="button" class="sdi-card__btn sdi-card__btn--primary" data-act="go">${esc(text.go)}</button>
      </div>
    `;

    for (const row of Array.from(el.querySelectorAll<HTMLElement>(".sdi-conflict__row"))) {
      row.addEventListener("click", (event) => {
        const button = (event.target as HTMLElement).closest<HTMLElement>("[data-choice]");
        if (!button) {
          return;
        }
        const hpath = row.dataset.hpath ?? "";
        const choice = button.dataset.choice as ConflictChoice;
        this.choices.set(hpath, choice);
        this.paintRow(row, choice);
        this.paintWarn();
      });
    }

    for (const button of Array.from(el.querySelectorAll<HTMLElement>("[data-all]"))) {
      button.addEventListener("click", () => {
        const choice = button.dataset.all as ConflictChoice;
        for (const hpath of this.choices.keys()) {
          this.choices.set(hpath, choice);
        }
        this.paintAll(choice);
        this.paintWarn();
      });
    }

    el.querySelector(".sdi-card__close")?.addEventListener("click", () => this.destroy());
    el.querySelector('[data-act="cancel"]')?.addEventListener("click", () => this.destroy());
    el.querySelector('[data-act="go"]')?.addEventListener("click", () => this.confirm());

    document.body.append(el);
    this.el = el;
    this.paintAll(fallback);
    this.paintWarn();

    return new Promise((resolve) => {
      this.finish = resolve;
    });
  }

  /** 关闭即取消：返回 null，调用方不得创建任何文档 */
  destroy(): void {
    const finish = this.finish;
    this.finish = null;
    this.el?.remove();
    this.el = null;
    this.choices.clear();
    finish?.(null);
  }

  private confirm(): void {
    const finish = this.finish;
    this.finish = null;
    const answer = new Map(this.choices);
    this.el?.remove();
    this.el = null;
    finish?.(answer);
  }

  private paintRow(row: HTMLElement, choice: ConflictChoice): void {
    for (const button of Array.from(row.querySelectorAll<HTMLElement>("[data-choice]"))) {
      button.classList.toggle("is-active", button.dataset.choice === choice);
    }
  }

  private paintAll(choice: ConflictChoice): void {
    for (const row of Array.from(this.el?.querySelectorAll<HTMLElement>(".sdi-conflict__row") ?? [])) {
      this.paintRow(row, choice);
    }
  }

  private paintWarn(): void {
    const warn = this.el?.querySelector<HTMLElement>(".sdi-conflict__warn");
    if (!warn) {
      return;
    }
    const values = Array.from(this.choices.values());
    warn.hidden = !values.includes("overwrite") && !values.includes("append");
  }
}
