# M1 任务分解

> 目标：**单个 md 拖到文档树 → 建出文档 → 结果卡片**，跑通一条完整的竖切。
> 前置：`docs/DESIGN.md`（v0.2）、`docs/M0-VERIFY.md`（已完成的 7 项验证）

---

## 0. 新会话启动提示词

在新工作空间开对话时，把下面这段整体粘进去：

```
我在做思源笔记插件 siyuan-drag-import（拖拽导入），当前阶段 M1。

先读这三个文件，别急着写代码：
1. docs/M1-PLAN.md —— 本次任务清单与验收标准
2. docs/DESIGN.md —— 功能设计 v0.2（已按 M0 实测修订）
3. docs/M0-VERIFY.md —— 7 项技术验证结论
（工作区记忆 .workbuddy/memory/MEMORY.md 里也存了关键结论）

硬约束：下面这些都是我在真机上验过的，不要重新验证，也别按"常识"改：
- 取路径用 require("electron").webUtils.getPathForFile(file)，
  不要用 File.path，也不要用 webkitGetAsEntry
- document 捕获阶段监听，命中判定用 closest(".sy__file")；
  必须自己 preventDefault（思源对外部文件 dragover 不 preventDefault），
  处理完 drop 要 stopPropagation
- createDocWithMd 传完整 hpath，父文档会自动补建、已存在会复用，不要逐层查建
- 内核不去重：建之前必须 getIDsByHPath 精确查，冲突自己加 " (2)"
- 构建脚本不能用 fs.cpSync（D 盘上会让 node 直接崩，exit 127），
  参考 latex-paste 的手写递归复制

环境：SiYuan 3.8.8 安装版（D:\Program Files\SiYuan），
工作区 D:\Knowledge2\思源笔记工作空间\知识类，API 127.0.0.1:6806（无需 token）。
构建产物要同步到 <工作区>/data/plugins/siyuan-drag-import/。

要求：
- 按 M1-PLAN 里 T0 → T7 的顺序做，每完成一项告诉我改了什么、怎么验证
- 拿不准的 API 行为先在真机上打一次再写代码（可以建临时笔记本，用完必须删）
- 结束后把「怎么安装、怎么测」写进 README
- 最后把我需要手动做的验证单独列出来

先给我 5 行以内的计划确认，再动手。
```

---

## 1. 本阶段做什么

| 做 | 不做（留给后面） |
|---|---|
| 单文件 / 多选 md 拖入 | 文件夹递归（M2） |
| 文档树三层投放提示 | 压缩包（M3） |
| UTF-8 / GBK 读取 | 图片与附件上传（M4） |
| frontmatter 剥离、重复 H1 去除 | 冲突的追加/跳过/覆盖策略（M4，M1 只做自动改名） |
| 目标笔记本与父层级判定 | 撤销、设置面板（M4） |
| 同名自动改名 | 进度条（M3 一起做，M1 只要结果卡片） |
| 结果卡片（成功/跳过/失败 + 打开第一篇） | 集市物料、i18n 完整化（M5） |
| petal 落盘诊断 | |

拖到文件夹、压缩包时，**识别出来并明确提示"暂不支持"**，不要静默无视。

---

## 2. 交付结构

```
siyuan-drag-import/
├─ plugin.json          name / displayName(zh-CN) / minAppVersion 3.1.0
├─ package.json         scripts: build / dev / typecheck
├─ tsconfig.json
├─ index.css            必须存在（集市硬性要求）
├─ src/
│  ├─ index.ts          注册监听、卸载清理
│  ├─ drop/
│  │  ├─ selectors.ts   .sy__file / .file-tree__items / [data-node-id]
│  │  └─ controller.ts  事件状态机、命中判定、拖拽视觉
│  ├─ source/analyze.ts DataTransfer → 候选清单（file / dir / archive / other）
│  ├─ import/
│  │  ├─ naming.ts      清洗、截断、NFC、空名兜底
│  │  ├─ markdown.ts    编码判定、frontmatter、重复 H1
│  │  ├─ planner.ts     目标层级、冲突决策
│  │  ├─ executor.ts    逐篇建文档、结果累积
│  │  └─ api.ts         内核 API 薄封装（超时/错误归一）
│  ├─ ui/
│  │  ├─ overlay.ts     面板描边 + 顶部横幅 + 目标行高亮
│  │  └─ result.ts      结果卡片
│  └─ logger.ts         petal 落盘
└─ scripts/build.mjs    esbuild + 手写递归复制（不许用 fs.cpSync）
```

---

## 3. 任务分解

### T0 脚手架（先能加载，再谈功能）

- `plugin.json`：`name: siyuan-drag-import`、`displayName.zh-CN: 拖拽导入`、`minAppVersion: 3.1.0`
- `scripts/build.mjs`：esbuild 打包 `src/index.ts` → `dist/index.js`，复制 `plugin.json` / `index.css` / `icon.png`，再同步到 `<工作区>/data/plugins/siyuan-drag-import/`
- `index.ts` 里 `onload` 打一行日志，`onunload` 清干净

**验收**：`npm run build` 成功 → 思源里启用插件 → petal 目录出现日志文件，控制台无红字。

> ⚠ 继承的坑：`fs.cpSync` 在 D 盘会让 node 进程直接崩（exit 127，无报错）。直接用 latex-paste `scripts/build.mjs` 里的手写递归复制。

### T1 诊断通道

- `logger.ts`：写 `data/storage/petal/siyuan-drag-import/logs/mmdd-HHmm.jsonl`
- `onload` 每一步独立 try/catch，失败也写盘

**验收**：故意让某一步抛错，日志里能看到，而不是整个插件静默失效。

### T2 拖拽命中与视觉

- `document` 捕获阶段：`dragenter / dragover / dragleave / drop`
- 命中判定：`e.target.closest(".sy__file")` 且 `[...e.dataTransfer.types].includes("Files")`
- `dragover` 必须 `preventDefault()`
- 深度计数 + 60ms 延迟消除闪烁
- 视觉：面板 2px 主色内描边 + 4% 底色；当前行描边；顶部横幅「释放以导入到「xxx」」

**验收**：从资源管理器拖任意文件到文档树 → 有描边和横幅；拖到编辑器 → 完全无反应（保持原生插图）；拖出窗口 → 高亮在 60ms 内消失。

### T3 来源识别

- `webUtils.getPathForFile(file)` 拿路径 → `fs.stat` 判类型
- 目录 / `.zip` / `.rar` / 非 md → 归入"不支持"，拖入后给明确提示
- 多选 md 全部收下

**验收**：拖 1 个 md / 3 个 md / 1 个文件夹 / 1 个 png，分别得到正确分类。

### T4 读取与转换

- `ArrayBuffer` → 有 BOM 去 BOM；`TextDecoder("utf-8", {fatal:true})` 失败则 `TextDecoder("gbk")`
- frontmatter：成对 `---` 之间剥离（M1 只剥，不写属性）
- 首行唯一 `# H1` 且与文件名相似 → 去掉
- 长标题按 120 字符截断（内核不截断）

**验收**：UTF-8 正常；GBK 中文不乱码；带 frontmatter 的正文无 YAML；重复标题不出现两次。

### T5 命名与冲突

- 清洗：去扩展名 → NFC → 剔除 `.`/`..` 段 → 非法字符 → 去首尾空白与结尾点 → 空名兜底 → 截断
- 目标：命中的文档节点（作为父）→ 命中的笔记本 → 当前笔记本；关闭的笔记本直接提示
- 冲突：`getIDsByHPath(notebook, 原始大小写 hpath)` 精确查 → 命中则 `名称 (2)`、`(3)` 递增；本批次也记进内存集合

**验收**：同一个 md 连拖两次 → 得到 `笔记` 和 `笔记 (2)`；名字里带 `..` 不会跑到上层；300 字标题被截断。

### T6 建文档

- `createDocWithMd({notebook, path, markdown})`
- path 为空 → 直接拒绝（否则建出标题为 `.` 的垃圾文档）
- 单篇失败不影响后续，失败原因归类

**验收**：文档出现在树干正确位置；正文与源文件一致。

### T7 结果卡片

- 右下角卡片：`成功 N · 跳过 N · 失败 N`，失败项列文件名 + 原因（最多 5 条）
- 「打开第一篇」→ `openTab`
- 「查看日志」→ 弹出本批次日志
- 卡片关闭后不残留 DOM

**验收**：三种结果都能在卡片上对上数；点打开第一篇跳到正确文档。

### T8 M0 遗留的真机复核（顺手做掉）

拖一个**文件夹**，记录 `getPathForFile` 的返回值；从 `C:\Program Files` 拖一个文件，记录 `EPERM` 表现。结论补进 `docs/M0-VERIFY.md` 第五节。

---

## 4. 完成定义

- [ ] T0–T7 全部验收通过，`npm run build` 与 `tsc --noEmit` 干净
- [ ] 拖入 → 结果卡片 → 打开文档，全链路不需要第二次点击
- [ ] 插件禁用/启用后，监听器不重复绑定（`onunload` 用 `AbortController` 统一摘）
- [ ] 日志文件存在且能定位到本次批次
- [ ] README 补上「安装与自测」两节
- [ ] 没有为 M2/M3 提前埋抽象（先直白实现，重复了再抽）

---

## 5. 已知风险

| 风险 | 应对 |
|---|---|
| `webUtils` 在插件沙箱里取不到 | T3 加打印，确认 `require("electron").webUtils` 是否可用；不行就退回 `webkitGetAsEntry`（设计已留兜底） |
| 拖拽时 `drop` 拿到空 `files` | 事件对象在异步回调里失效，必须在同步阶段先 `Array.from(files)` 存下来 |
| 大量文件（>200）时 IPC 排队 | M1 不优化，M3 做进度条时再一起处理 |
| 结果卡片与思源原生弹层层级冲突 | 卡片 `z-index` 挂在 `body` 下，不进文档树 DOM |

---

## 6. 完成情况（2026-10-24）

T0–T7 已实现，`tsc --noEmit` 干净；自动验证 84 项断言全通过（23 单测 + 17 卡片 + 18 真机链路 + 26 冒烟）。
真实 OS 拖拽仍需人工验收，清单见 README「手动」一节。

| 项 | 落点 | 备注 |
|---|---|---|
| T0 | `scripts/build.mjs`、`plugin.json`、`index.css`、`scripts/make-icon.mjs` | 图标用纯代码生成（无图形库），构建产物自动同步工作区 |
| T1 | `src/logger.ts` | 路径 `<工作区>/data/storage/petal/siyuan-drag-import/logs/mmdd-HHmm.jsonl`；每批带 `batch` 字段；卡片「查看日志」直接读内存副本 |
| T2 | `src/drop/{selectors,controller,overlay}.ts` | `document` capture + 深度计数 + 60ms 延迟；覆盖层挂 `body`，`pointer-events:none`，不插思源布局 DOM |
| T3 | `src/source/analyze.ts` | `window.require("electron").webUtils` + `fs.statSync` 判目录；拿不到路径时退回 File 对象 |
| T4 | `src/import/markdown.ts` | BOM → UTF-8(fatal) → GBK；frontmatter 只剥开头成对块并吃掉其后的空行；H1 相似判定容忍 8 字差 |
| T5 | `src/import/{naming,planner}.ts` | 内存 Set（NFC+trim+小写）+ `getIDsByHPath` 原始大小写精确复核；最多试 99 次 |
| T6 | `src/import/executor.ts` | 逐篇 `createDocWithMd`；单篇 20 MB 上限；失败原因归类（EACCES/ENOENT/ENOSPC/EBUSY） |
| T7 | `src/ui/result.ts` | 失败项在前、跳过在后，各最多 5 条；「打开第一篇」走 `openTab`；**全是不支持时切独立状态**（标题 + 引导语，不显示 0/1/0 计数与置灰按钮，真机反馈后补） |

### 对设计的一处修正（需确认）

设计 §3.1 写「文档树之外的文件 drop 一律 `preventDefault()`」。实现里改成：**编辑器 `.protyle` 内的 drop 放行**，只对树和编辑器之外的区域做兜底。

原因：capture 阶段一旦在编辑器里 `preventDefault()`，思源自己的「拖图入正文」就被打死，和 T2 验收「拖到编辑器保持原生插图」直接冲突；而窗口导航风险只在没人处理的区域才成立。

### 仍未关闭

- T8（M0 遗留的真机复核）：`getPathForFile` 对文件夹的返回值、`C:\Program Files` 拖入的 EPERM 表现，需要一次真实拖拽。实现里已按「拿不到路径也降级可用」写了容错。
- T1 的「故意让某一步抛错」验收：冒烟测试里已用 `steps` 覆盖失败路径的日志格式，但没在真机上真造一次错。

