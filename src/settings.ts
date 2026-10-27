import { Setting } from "siyuan";
import { m } from "./i18n";
import type { ConflictChoice } from "./import/planner";

export interface Settings {
  uploadImages: boolean;
  /**
   * 拖入文件夹时保留外层那一级：文件夹本身也建成一篇文档（拖 A 得到 A/…，与思源原生导入一致）。
   * 默认 true。关掉就把里面的内容直接放到拖放位置。
   * 注意方向：这里存的是「保留结构」，内核那边要的是「跳过根」（`skipRootFolder`），传参时取反。
   */
  keepFolderStructure: boolean;
  /** 剥掉开头那段 YAML（默认剥；关掉则原样保留） */
  stripFrontmatter: boolean;
  removeDuplicateH1: boolean;
  /** 把 `[[笔记]]` 换成思源块引用（只对本批内能唯一命中的目标生效） */
  convertWikilinks: boolean;
  maxFileMB: number;
  /** 撤销有效期（秒）。默认 30 —— 撤销是短动作，5 分钟只会让卡片一直挂着 */
  undoWindowSeconds: number;
  conflictDefault: ConflictChoice;
}

export const SETTINGS_KEY = "settings";

export const DEFAULT_SETTINGS: Settings = {
  uploadImages: true,
  keepFolderStructure: true,
  stripFrontmatter: true,
  removeDuplicateH1: true,
  convertWikilinks: true,
  maxFileMB: 20,
  undoWindowSeconds: 30,
  conflictDefault: "suffix",
};

const CONFLICT_VALUES: ConflictChoice[] = ["suffix", "skip", "overwrite", "append"];

/** 冲突策略的名字：跟着界面语言走，所以不能在模块级求值 */
function conflictLabel(value: ConflictChoice): string {
  const text = m().settings;
  switch (value) {
    case "skip":
      return text.optionSkip;
    case "overwrite":
      return text.optionOverwrite;
    case "append":
      return text.optionAppend;
    default:
      return text.optionSuffix;
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** 老版本/手改配置兜底，别让一个坏值把导入搞崩 */
export function normalizeSettings(raw: unknown): Settings {
  const input = (raw ?? {}) as Partial<Settings> & {
    undoWindowMinutes?: number;
    /** 1.0.3 及更早的键，方向与 keepFolderStructure 相反（true = 不建外壳文档） */
    skipRootFolder?: boolean;
  };
  const merged: Settings = { ...DEFAULT_SETTINGS, ...input };
  if (!CONFLICT_VALUES.includes(merged.conflictDefault)) {
    merged.conflictDefault = DEFAULT_SETTINGS.conflictDefault;
  }
  merged.maxFileMB = clamp(Number(merged.maxFileMB), 1, 200);

  // 0.6.x 存的是**分钟**（旧默认 5 = 5 分钟）。单位变了却沿用旧值的话，
  // 「5 分钟」会被读成「5 秒」，所以旧键存在、新键不存在时才迁移。
  const legacy = Number(input.undoWindowMinutes);
  if (!("undoWindowSeconds" in input) && Number.isFinite(legacy) && legacy > 0) {
    merged.undoWindowSeconds = legacy * 60;
  }
  delete (merged as any).undoWindowMinutes;
  merged.undoWindowSeconds = clamp(Number(merged.undoWindowSeconds), 10, 300);

  // 1.0.3 存的键叫 skipRootFolder，方向相反（true = 不建外壳文档）。
  // 名字换了、方向也换了 → 旧值必须取反迁移，否则老用户的结构会静默翻转。
  if (!("keepFolderStructure" in input) && typeof input.skipRootFolder === "boolean") {
    merged.keepFolderStructure = !input.skipRootFolder;
  }
  delete (merged as any).skipRootFolder;

  merged.uploadImages = merged.uploadImages !== false;
  merged.keepFolderStructure = merged.keepFolderStructure !== false;
  merged.stripFrontmatter = merged.stripFrontmatter !== false;
  merged.removeDuplicateH1 = merged.removeDuplicateH1 !== false;
  merged.convertWikilinks = merged.convertWikilinks !== false;
  return merged;
}

/** 控件都按「读当前值」的方式建，恢复默认时才能就地刷新 */
function checkbox(
  read: () => boolean,
  onChange: (value: boolean) => void,
  track: (sync: () => void) => void,
): HTMLElement {
  const input = document.createElement("input");
  input.type = "checkbox";
  input.className = "b3-switch fn__flex-center";
  input.checked = read();
  track(() => {
    input.checked = read();
  });
  input.addEventListener("change", () => onChange(input.checked));
  return input;
}

function numberInput(
  read: () => number,
  min: number,
  max: number,
  onChange: (value: number) => void,
  track: (sync: () => void) => void,
): HTMLElement {
  const input = document.createElement("input");
  input.type = "number";
  input.className = "b3-text-field fn__flex-center fn__size200";
  input.min = String(min);
  input.max = String(max);
  input.value = String(read());
  track(() => {
    input.value = String(read());
  });
  input.addEventListener("change", () => {
    const next = clamp(Number(input.value), min, max);
    input.value = String(next);
    onChange(next);
  });
  return input;
}

export function createSettingPanel(settings: Settings, onChange: () => void): Setting {
  const panel = new Setting({
    confirmCallback: () => onChange(),
  });
  const text = m().settings;

  /** 每个控件注册一个「把界面同步成 settings 当前值」的回调，给「恢复默认」用 */
  const syncers: Array<() => void> = [];
  const track = (sync: () => void) => {
    syncers.push(sync);
  };

  panel.addItem({
    title: text.conflictDefault,
    description: text.conflictDefaultDesc,
    createActionElement: () => {
      const select = document.createElement("select");
      select.className = "b3-select fn__flex-center fn__size200";
      for (const value of CONFLICT_VALUES) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = conflictLabel(value);
        option.selected = value === settings.conflictDefault;
        select.append(option);
      }
      track(() => {
        select.value = settings.conflictDefault;
      });
      select.addEventListener("change", () => {
        settings.conflictDefault = select.value as ConflictChoice;
      });
      return select;
    },
  });

  panel.addItem({
    title: text.undoWindow,
    description: text.undoWindowDesc,
    createActionElement: () =>
      numberInput(
        () => settings.undoWindowSeconds,
        10,
        300,
        (value) => {
          settings.undoWindowSeconds = value;
        },
        track,
      ),
  });

  panel.addItem({
    title: text.maxSize,
    description: text.maxSizeDesc,
    createActionElement: () =>
      numberInput(
        () => settings.maxFileMB,
        1,
        200,
        (value) => {
          settings.maxFileMB = value;
        },
        track,
      ),
  });

  panel.addItem({
    title: text.keepFolderStructure,
    description: text.keepFolderStructureDesc,
    createActionElement: () =>
      checkbox(
        () => settings.keepFolderStructure,
        (value) => {
          settings.keepFolderStructure = value;
        },
        track,
      ),
  });

  panel.addItem({
    title: text.stripFrontmatter,
    description: text.stripFrontmatterDesc,
    createActionElement: () =>
      checkbox(
        () => settings.stripFrontmatter,
        (value) => {
          settings.stripFrontmatter = value;
        },
        track,
      ),
  });

  panel.addItem({
    title: text.removeH1,
    description: text.removeH1Desc,
    createActionElement: () =>
      checkbox(
        () => settings.removeDuplicateH1,
        (value) => {
          settings.removeDuplicateH1 = value;
        },
        track,
      ),
  });

  panel.addItem({
    title: text.uploadImages,
    description: text.uploadImagesDesc,
    createActionElement: () =>
      checkbox(
        () => settings.uploadImages,
        (value) => {
          settings.uploadImages = value;
        },
        track,
      ),
  });

  panel.addItem({
    title: text.wikilinks,
    description: text.wikilinksDesc,
    createActionElement: () =>
      checkbox(
        () => settings.convertWikilinks,
        (value) => {
          settings.convertWikilinks = value;
        },
        track,
      ),
  });

  panel.addItem({
    title: text.reset,
    description: text.resetDesc,
    createActionElement: () => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "b3-button b3-button--outline fn__size200";
      button.textContent = text.resetLabel;
      button.addEventListener("click", () => {
        Object.assign(settings, DEFAULT_SETTINGS);
        // 就地刷新每个控件：思源的设置面板不会因为我们改了对象而重绘
        for (const sync of syncers) {
          sync();
        }
        onChange();
        button.textContent = text.resetDone;
        window.setTimeout(() => {
          button.textContent = text.resetLabel;
        }, 1500);
      });
      return button;
    },
  });

  return panel;
}
