# M0 技术验证报告

> 对象：拖拽导入插件（`siyuan-drag-import`）
> 环境：SiYuan 3.8.8（安装版，`D:\Program Files\SiYuan`），Windows，工作空间 `D:\Knowledge2\思源笔记工作空间\知识类`
> 方式：内核行为用**真实 API 打真机**；渲染层行为用**运行中程序的源码级验证**（读 3.8.8 前端产物与 Electron 主进程配置）
> 数据：全部脚本与原始输出在 `drag-drop-import/m0/`，测试只用自建临时笔记本，跑完即删（已核对无残留）

---

## 一、结论摘要

| # | 待验证项 | 结论 | 是否需改设计 |
|---|---|---|---|
| 1 | 文档树能否在捕获阶段可靠接住 drop | **能**。全量扫描无任何常驻的 document/window 捕获拖拽监听；文件树自身的 drop 在**冒泡阶段**且只认内部拖拽类型，外部 `Files` 被直接忽略 | 需要（选择器、必须 preventDefault、需 stopPropagation） |
| 2 | `File.path` / `webkitGetAsEntry` 是否可用 | **路线对调**。`nodeIntegration: true`，官方自己用 `webUtils.getPathForFile()`；`webkitGetAsEntry` 在官方代码里出现 0 次 | 需要（主备互换） |
| 3 | `createDocWithMd` 多级 hpath | **会自动补建父文档**，已存在的父级会被复用 | 需要（可省掉逐层查建） |
| 4 | 同名 hpath 重复创建 | **内核不拦、不去重**，同 hpath 建出两个文档，`getIDsByHPath` 返回 2 个 id | 需要（冲突检测升级为硬需求） |
| 5 | `/api/asset/upload` 同名规则 | 返回 `assets/<原名>-<时间戳>-<id>.<ext>`，中文名保留；**不可预测**，只信 `succMap` | 轻微（明确"只信返回值"） |
| 6 | 500 篇连续创建的性能 | **无退化**：500 篇 16.3 秒，平均 32.6ms/篇，0 错误，分桶均值 33.4→32.6 | 不需要 |
| 7 | 权限限制（是否 Store 版） | **环境已变**：运行中的是安装版（`D:\Program Files\SiYuan`），非 MSIX，无包沙箱 | 需要（去掉 Store 版假设） |

**一句话**：两个重点项都通过，但都带"必须按实测行为改实现"的附加条件——尤其第 4 项（同名不去重）和第 1 项的默认行为，属于"不改就会出 bug"级别。

---

## 二、逐条详情

### 1. 文档树在捕获阶段接住 drop

**验证方法**

1. 对 `resources/stage/build/app/` 下 **全部 5 个 JS chunk** 做 `capture:!0` 全量扫描，筛出 `drop/dragover/dragenter/dragleave` 的捕获阶段监听及其挂载对象。
2. 定位文件树组件的 `dragover` / `drop` / `dragenter` / `dragleave` 实现，读其类型判断与默认行为处理。
3. 定位 `window` 级 `dragover`，检查对外部 `Files` 的处理分支。

**预期**：文件树自身只处理内部拖拽（文档移动），外部文件拖拽无人接管；捕获阶段应先于一切冒泡监听。

**实际**

| 观察点 | 实测 |
|---|---|
| 捕获阶段拖拽监听总量 | 5 处，全部为内部拖拽服务：2 处 `drop`（一处是 `once:true` 的 gutter 拖拽，一处是"钉住文档"列表且只认 `application/siyuan-pinned-document`）、1 处 `dragover`（同上，只认 pinned 类型）、2 处 `dragleave` |
| `document` / `window` 上常驻的捕获 `drop` | **没有**（唯一的 window 捕获 drop 是 `{once:true}`，用完即弃） |
| 文件树 `drop` | 绑定在 `this.element`（树条目容器）上，**冒泡阶段**，无条件 `preventDefault() + stopPropagation()`，随后用内部 MIME 解析 id 列表，外部 `Files` 解析为空数组 |
| 文件树 `dragover` | 仅当 `types` 含 `SIYUAN_DROP_DOCUMENTS / SIYUAN_DROP_FILE / SIYUAN_DROP_DOCUMENT_TAB` 才 `preventDefault()`；`Files` **直接 return，不 preventDefault** |
| 全局 `window` dragover | `types.includes("Files") && target.closest(".sy__file")` 分支只调用提示清理函数，**不 preventDefault** |
| 文件树容器选择器 | 面板 `.sy__file`（26 处引用）；条目容器 `.file-tree__items`（源码里 `pt.querySelector(".file-tree__items")`） |

**结论：通过，且比预期更干净。**

- 事件顺序上，`document` 的捕获监听必然先于树的冒泡监听执行，也不会被同节点上的其他监听抢走（全量扫描证明没有竞争者）。
- **默认行为是真正需要注意的点**：因为思源对外部文件拖拽**不调用 preventDefault**，浏览器会判定"不接受投放"——光标显示禁止态，`drop` 也拿不到。所以我们的 capture `dragover` **必须自己 preventDefault**，否则功能根本不触发。
- 反过来，文件树的 `drop` 是无条件 `preventDefault` 的（不管什么类型），所以"拖文件到树上把窗口导航走"这个风险今天不存在；但**树以外的区域没有这层保护**，全局兜底从"防御性"升级为"必要"。
- 因为树的 drop 处理器会无条件执行 `this.drop([], x, y)`（空 id 列表），我们的 capture `drop` 里应当 `stopPropagation()`，避免触发这段无意义的内部移动逻辑。

**设计调整**

- §3.1：选择器改为 `.sy__file`（命中区）+ `.file-tree__items`（条目容器）+ `[data-node-id]`（目标行）。
- §3.1：capture `dragover` 必须 `preventDefault()`（否则整条链路不成立）——这条要从"实现细节"提到"关键路径"。
- §3.4：capture `drop` 处理完后 `stopPropagation()`，阻断树的空移动逻辑；全局 `preventDefault` 兜底保留。

---

### 2. `File.path` vs `webkitGetAsEntry`

**验证方法**

1. 读 Electron 主进程 `resources/app/electron/main.js` 的 `webPreferences`。
2. 在前端产物里检索 `webUtils.getPathForFile` 与 `webkitGetAsEntry` 的使用情况与用法。
3. 读官方对 `localFileSystem` 的分支判断。

**预期**：桌面端拿得到真实路径；`File.path` 可能已废弃。

**实际**

| 观察点 | 实测 |
|---|---|
| 窗口配置 | `nodeIntegration: true`、`contextIsolation: false`、`webviewTag: true` → **渲染进程可直接 `require()`** |
| 官方取路径方式 | `webUtils.getPathForFile(file)`，共 3 处，均为外部文件拖拽/粘贴场景；分支条件 `!isMobile && config.system.localFileSystem` |
| `webkitGetAsEntry` | **0 次** |
| `File.path` | 官方未使用（无法从源码判定属性是否存在，但官方已不依赖） |

**结论：通过。主备路线需要对调。**

原设计把 `webkitGetAsEntry` 作为主路线、`File.path + fs` 作为加速路线。实测表明应该反过来：

- **主路线**：`require("electron").webUtils.getPathForFile(file)` 拿绝对路径 → Node `fs` 递归遍历。这条路快、能识别空目录、能保留 mtime，且和思源自己处理拖拽的方式完全一致（风险最低）。
- **兜底路线**：`webkitGetAsEntry()` 递归。仅在 `webUtils` 不可用（理论上只可能是移动端/浏览器端，而本插件这两端不做）时启用。

**未能关闭的部分**：真实拖拽时 `getPathForFile` 对**文件夹**的返回值（预期是目录绝对路径，官方代码只用它处理文件）。需一次真机拖拽复核，见第五节。

**设计调整**

- §4.2 主备对调，并写明"以思源官方同类实现为准"。
- §11 的 `fsWalk` 标记为主路径，`entryWalk` 标记为兜底；`SourceNode` 中间结构不变。

---

### 3. `createDocWithMd` 传多级 hpath

**验证方法**：建临时笔记本 → `path: "/L1/L2/L3"` 建一篇 → 等落盘后**直接扫笔记本目录**读 `.sy` 文件（绕开有延迟的 SQL 索引），看磁盘上到底有几个文档、嵌套几层。

**预期**：不确定内核会不会补建中间层，原设计按"不补建"做了逐层查建的防御。

**实际**

```
data/<nb>/<L1-id>.sy
data/<nb>/<L1-id>/<L2-id>.sy
data/<nb>/<L1-id>/<L2-id>/<L3-id>.sy
```

3 个文档，三层嵌套 → **内核自动补建了 L1、L2**。
补充验证：`/项目A/子目录/文档` 之后再建 `/项目A/子目录/文档 (2)` 同样成功 → **已存在的父级被复用，不重复创建、不报错**。

**边界（顺带测出来的）**

| 输入 | 实际行为 |
|---|---|
| `path: "没有斜杠"` | 正常建在根，code 0 |
| `path: "/"` | 建出一个文档，code 0（名字异常） |
| `path: ""` | **建出一个标题为 `.` 的文档**，code 0 ⚠ |
| `path: "/边界/../逃逸"` | **建到了根层的「逃逸」**，层级逃逸 ⚠ |
| `path: "/边界//双斜杠"` | 空段被吃掉，得到「双斜杠」 |

**结论：通过。设计可以显著简化，但必须自己挡住空 path 和 `.`/`..` 段。**

**设计调整**

- §5.4：删掉"每层先查后建"的防御，改为**逐篇直接传完整 hpath**——父级自动补建、已存在自动复用。省掉每篇一次的"查父文档"往返（500 篇省 500+ 次请求）。
- §5.4 保留一条例外：**空壳文件夹**（空目录、或只含图片的目录）仍需显式建一个父文档，因为没有 md 文件可以"带出"这条路径。
- §9 异常矩阵新增：`path` 为空或去段后为空 → **拒绝发送**（否则产生标题为 `.` 的垃圾文档）。
- §5.3 新增：清洗时必须剔除 `.` 与 `..` 段落（实测会被内核当作路径上跳，直接破坏层级还原）。

---

### 4. 同名 hpath 重复创建

**验证方法**：对同一 `path: "/dup/同名"` 连续创建两次，比较返回 id、`getIDsByHPath` 结果，并核对磁盘上 `.sy` 文件数量。

**预期**：可能报错、可能自动加后缀、可能允许重复。

**实际**

| 观察 | 值 |
|---|---|
| 第一次 | `code: 0`，id `...tcts7my` |
| 第二次 | `code: 0`，id `...juazs4r` |
| `getIDsByHPath("/dup/同名")` | 返回 **2 个 id** |
| 磁盘 | 两个独立 `.sy`，同名同 hpath |

同时测出 `getIDsByHPath` 的匹配口径：

| 查询 | 已存在 `/口径/Readme` 时的返回 |
|---|---|
| `/口径/Readme` | 1 个 ✅ |
| `/口径/readme` | **0 个**（区分大小写） |
| `/口径/ Readme ` | **0 个**（不去空格） |
| `/口径/Readme  ` | **0 个** |

**结论：通过（但结论是坏消息，须按坏消息设计）。**

- 内核**完全不做重名去重**，也**不做任何归一化**。原设计里"冲突策略"不是可选项，而是**避免每次重复拖拽都产生双份文档的唯一保障**。
- 因为查询是精确匹配、区分大小写、不去空格，所以：
  - 生成 hpath 时**必须用原始大小写**去查，不能先小写化再查（小写化后查不到，会误判为不冲突）；
  - "大小写不同、空格不同算不算冲突"必须由插件用**同级名字集合**自己判断，不能依赖单次 hpath 查询。

**设计调整**

- §7.1：判定口径改为"取同级子文档名字集合 → 本地做 NFC + 小写化 + trim 比较"，`getIDsByHPath` 只用于**精确复核**而不是主判据。
- §7.1：删掉"用 SQL 预查重名"的写法（原因见第 6 条的索引延迟实测）。
- §7 从"用户体验优化"重新定位为"数据正确性保障"。

---

### 5. `/api/asset/upload` 的同名改名规则

**验证方法**：用同一文件名的 PNG 连续上传三次（两次同内容、一次改一个字节），读 `succMap`，再核对 `data/assets/` 实际产物。

**预期**：同名自动加时间戳/ID。

**实际**

| 场景 | `succMap` 返回值 |
|---|---|
| `probe.png`（第一次） | `assets/probe-20261024154252-wilh39u.png` |
| `probe.png`（同内容再传） | 第一次测试返回**同一个路径**；换一轮测试又生成了**新路径** |
| `same.png`（内容不同） | `assets/same-...-4ug20oy.png` / `...-odn2zvb.png` → 各自独立 |
| `中文图片名.png` | `assets/中文图片名-...-pvwk2s4.png`（中文保留） |

**结论：通过。**

规则是 `<原名去扩展名>-<14 位时间戳>-<7 位 id>.<ext>`，同名不会覆盖，中文名不丢。但"同内容是否复用"**不稳定**（两轮测试结果不同，可能与落盘时序有关），所以：

- **一律以 `succMap` 的返回值为准重写 md 里的链接**，绝不自己拼路径，也不要假设"同样的图会复用同一个 asset"。

**设计调整**

- §6.5 补一句：链接重写只信 `succMap`；"图片去重"不作为 v1 目标。

---

### 6. 500 篇连续创建的性能

**验证方法**：临时笔记本内连续调 500 次 `createDocWithMd`（路径 `/批量/第 N 篇`），每 100 篇记录一次累计均值；结束后立刻查 SQL 文档数，与 500 对比。

**预期**：可能随文档数增长而变慢（如树刷新、索引变重）。

**实际**

| 指标 | 值 |
|---|---|
| 总耗时 | 16 286 ms |
| 平均 | 32.6 ms/篇（≈30.7 篇/秒） |
| 分桶均值（100/200/300/400/500） | 33.4 / 32.8 / 32.4 / 32.5 / 32.6 ms → **完全平坦** |
| 错误数 | 0 |
| `getIDsByHPath`（500 篇后） | 2.3 ms |
| SQL `count(*)`（建完 500 篇立刻查） | **468**（少 32 条） |

**结论：通过。不需要分片、不需要 Worker、不需要限速。**

- 100 篇 ≈ 3.2 秒，500 篇 ≈ 16 秒——进度卡片是必需品（原设计已覆盖）。
- 取消粒度 = 单篇 ≈ 33ms，用户点取消后最多多建一篇，可接受。
- **附带发现**：SQL 索引比写入滞后 0.3–1 秒，500 篇建完后立刻查还缺 32 条。这直接否掉了"用 SQL 做同批次重名预查"的方案（第 4 条的调整依据）。

**设计调整**

- §8.1：进度分母按文件数已正确；补一句"单篇 ~33ms，无需分片"。
- §7.1 / §11：重名预查改用 `getIDsByHPath`（1.5–2.3ms，实时）+ 内存集合；SQL 仅在"打开批次时预取整棵子树"这类容忍延迟的场景使用。

---

### 7. 权限限制（是否 Store 版 / 能否读写任意路径）

**验证方法**：取运行中进程的可执行路径；检查窗口 `webPreferences`；对照既有插件的 petal 写入情况。

**预期**：按项目历史记录，用户是 Store 版，F12 不可用，权限受限。

**实际**

| 观察 | 值 |
|---|---|
| 运行中的内核路径 | `D:\Program Files\SiYuan\resources\kernel\SiYuan-Kernel.exe` → **安装版，不是 MSIX** |
| 包沙箱 | 无（安装版直接跑在用户会话里） |
| 渲染进程 Node 能力 | `nodeIntegration: true` → `fs` / `path` / `os` 可直接用 |
| petal 写入 | 既有插件（`siyuan-latex-paste`）已在此工作空间正常写 petal，证明可写 |
| 读取用户任意路径 | 静态判断可行（受 Windows ACL 约束），**未做真机拖拽实测** |

**结论：通过，但前提变了——项目里"Store 版、无 F12、权限受限"的旧假设要作废。**

- 安装版没有包沙箱，读 `D:\`、`C:\Users\...` 下的文件应当正常；`C:\Program Files`、被占用文件仍可能 `EPERM`，按原异常矩阵处理即可。
- F12 大概率可用（安装版没有 Store 版的限制），但**保留 petal 落盘诊断**仍是更低成本的排障手段（不用用户复述控制台）。

**设计调整**

- §9 异常矩阵：把"Store 版限制"从主要风险降为"其他环境可能遇到"。
- §8.4：日志落盘保留，但可以增加"复制到剪贴板"以便贴给我。

---

## 三、顺带测出来的、影响实现的事实

这几条不在原 7 条里，但会直接影响代码怎么写：

| 事实 | 影响 |
|---|---|
| 删除父文档会**连带删除所有子文档**（删后子的 `getHPathByID` 返回 `tree not found`） | "撤销本次导入"必须严格区分**本次新建的**与**复用的**父文档；删掉一个复用的父文档 = 删掉用户原有内容 |
| `removeDoc` 需要 `notebook + path`，用 id 调会报 `block not found`；**`removeDocByID({id})` 才是正确的按 id 删除** | §11 接口表要改 |
| 标题长度**完全不截断**（300 字原样保留） | 截断必须自己做，否则树上会出现 300 字标题 |
| `<`、`"` 在存储时被转义为 `&lt;`、`&quot;`，但 API 的 hpath 用**原文**（`getHPathByID` 返回原文，`getIDsByHPath` 用原文能查到） | 不要自己 HTML 转义；转义是内核内部行为 |
| 纯空白标题 → 自动变成「未命名文档」 | 清洗后为空时必须自己给名字，不然多个文件会撞成同一个「未命名文档」 |
| 笔记本关闭时 `createDocWithMd` 返回 `code:-1, msg:"查询笔记本失败"` | 导入前用 `lsNotebooks` 的 `closed` 提前拦截，给明确提示 |
| `.sy` 是异步落盘，刚建的文档读文件可能只有半截 JSON | 调试脚本不能拿文件系统当准实时事实源（插件本身走 API，不受影响） |
| `createDocWithMd` **不转换** `$...$` 公式，frontmatter 会变成两条分隔线 + 一段文本 | §6.6 要补"公式"和"frontmatter 必须自己处理"两行 |

---

## 四、设计调整清单（按文档章节）

| 章节 | 调整 | 影响范围 |
|---|---|---|
| §3.1 | 选择器定为 `.sy__file` / `.file-tree__items` / `[data-node-id]`；capture `dragover` 必须 `preventDefault` | `drop/selectors.ts`、`drop/controller.ts` |
| §3.4 | capture `drop` 后 `stopPropagation()`；全局兜底保留 | `controller.ts` |
| §4.2 | 主备对调：`webUtils.getPathForFile` 为主，`webkitGetAsEntry` 为兜底 | `source/fsWalk.ts` 升为主，`entryWalk.ts` 降为兜底 |
| §5.3 | 新增：剔除 `.`/`..` 段；长度截断自做；空名兜底 | `import/planner.ts` 的命名函数 |
| §5.4 | 改为"逐篇直接传完整 hpath"，仅空壳目录显式建父 | `planner.ts` 逻辑量下降约 40%，M2 工时下降 |
| §6.5 | 链接重写只信 `succMap`；不做图片去重 | `markdown/transform.ts` |
| §6.6 | 新增"公式""frontmatter"两行（内核不处理） | `markdown/transform.ts` |
| §7.1 | 冲突判定改为"同级名字集合 + 本地归一化比较"，`getIDsByHPath` 仅做精确复核；弃用 SQL 预查 | 新增 `siblings.ts` 缓存模块，`planner.ts` 冲突逻辑重写 |
| §8.3 | 撤销要区分 created / reused，禁止删除复用父文档 | `executor.ts` 需维护两个 id 集合 |
| §9 | 新增"空 path 拒发"；权限风险降级 | `planner.ts`、异常矩阵 |
| §11 | `removeDoc` → `removeDocByID`；`listDocsByPath` 的 `path` 是**存储路径**不是 hpath | `api.ts` |
| §12 | 7 条已关闭，指向本报告 | — |

**净效果**：M1/M2 的复杂度下降（父文档不用逐层查建），M4 的撤销逻辑复杂度上升（必须记两个集合）。整体工时估计不变或略降。

---

## 五、仍未关闭的 2 个点（需要一次真机拖拽）

这两条**只能**用真实 OS 拖拽验证，我无法在无人操作的情况下模拟（合成的 `DataTransfer` 里 `webkitGetAsEntry()` 恒为 null，`getPathForFile` 也拿不到路径）：

1. `webUtils.getPathForFile()` 对**文件夹**的返回值（预期：目录绝对路径）。
2. 真实拖入时 `dataTransfer.types` 的确切内容、以及从受保护目录（如 `C:\Program Files`）拖文件时的 `EPERM` 表现。

**验证方式**（30 秒，安装版可直接 F12）：

```js
// 1) 打开思源 F12 → Console，粘贴：
document.addEventListener("drop", e => {
  if (![...e.dataTransfer.types].includes("Files")) return;
  const wu = require("electron").webUtils;
  console.log("TARGET:", e.target.closest(".sy__file") ? "tree" : "other");
  console.log("TYPES:", [...e.dataTransfer.types]);
  console.log("ENTRIES:", [...e.dataTransfer.items].map(i => {
    const en = i.webkitGetAsEntry?.();
    return en ? { name: en.name, dir: en.isDirectory } : null;
  }));
  console.log("PATHS:", [...e.dataTransfer.files].map(f => wu.getPathForFile(f)));
}, { capture: true });
// 2) 从资源管理器拖一个文件夹 + 一个 md 到左侧文档树
```

把控制台输出贴回来即可，不需要改任何代码。

---

## 六、证据文件

| 文件 | 内容 |
|---|---|
| `m0/verify-kernel.mjs` / `kernel-report.json` | 第一轮：建文档、重名、上传、删除、100 篇性能、关闭笔记本 |
| `m0/verify-kernel2.mjs` / `kernel-report-2.json` | 第二轮：多级 hpath 的磁盘真相、重复 hpath、命名边界 |
| `m0/verify-kernel3.mjs` / `kernel-report-3.json` | 第三轮：SQL 索引延迟曲线、`.sy` 头部格式、path 容错 |
| `m0/verify-kernel4.mjs` / `kernel-report-4.json` | 第四轮：命名落地值、listDocsByPath、删除连带 |
| `m0/verify-kernel5.mjs` / `kernel-report-5.json` | 第五轮：listDocsByPath 参数、hpath 与转义、实时性 |
| `m0/verify-perf500.mjs` / `perf-500.json` | 500 篇性能曲线 |
| `m0/inspect-*.mjs` | 前端产物源码级扫描（捕获监听、文件树实现、webUtils） |

所有脚本可重复执行；每个脚本都只操作自建笔记本并在 `finally` 中删除。
