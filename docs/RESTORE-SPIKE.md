# 「还原式撤销」可行性验证（2026-10-25，SiYuan 3.8.8）

> 目标：覆盖 / 追加之后，撤销能把文档**还原成导入前逐字一致的样子**。
> 需要先确认「快照能不能无损写回」。脚本见 `research/restore-spike.mjs` ~ `restore-spike4.mjs`，
> 全部在临时笔记本里跑，跑完即删。

## 结论

| 路线 | 结果 |
|---|---|
| `/api/block/getBlockKramdown` → `/api/block/updateBlock` | ✅ **可用**：正文逐字一致、DOM 逐字一致（含块 id）、子文档保留 |
| `/api/export/exportMdContent` → `/api/block/updateBlock` | ❌ **不可用**：frontmatter 会变成正文 |

## 实验一：两条快照路线对比

样本文档含二级标题、加粗斜体行内代码、链接、行内公式、嵌套列表、有序列表、引用、代码块、表格、分隔线、末段。

- **kramdown 快照**：`getBlockKramdown` 返回的文本里带思源的属性块
  （`{: id="2026…" updated="2026…"}`）。写回后导出对比，只有「文档标题不同」造成的差异
  （因为两篇文档名字不同），DOM 结构完全一致。
- **exportMdContent 快照**：返回内容开头是 YAML frontmatter，第 7 行是把文档标题生成的 `# 标题`。
  写回后 frontmatter 的两条 `---` 变成分隔线、`title: …` `date: …` 变成**两行普通正文**，
  文档内容被污染（见下）。

```
B 正文 不一致：
  行 9   原始 "## 二级标题"      →  还原 "---"
  行 11  原始 "正文一段，含…"    →  还原 "title: 保真度样本  "
  行 12  原始 ""                →  还原 "date: 2026-10-25T19:26:27+08:00  "
```

## 实验二：同一篇文档上往返（收敛变量）

排除「文档标题不同」的干扰后：

- 正文逐字一致：**true**
- DOM 逐字一致（含 `data-node-id`）：**true**
- 块 id 全部保留：**true**（属性块里的 `{: id=…}` 被内核原样认下）

块 id 保留这一条比预期好：**文档里已有的块引用（`((id "…"))`）不会因为还原而断掉。**

## 实验三：追加后还原

`appendBlock` 追加一段 → 用 kramdown 快照 `updateBlock` 写回：

- 追加段完全消失
- 与导入前逐字一致：**true**

## 实验四：子文档

`updateBlock` 写回父文档后，按 id 精确复查（SQL + `getHPathByID` + `getDoc`）：
子文档仍在、路径不变、可正常打开。与之前 M3 的结论一致。

> 第一版脚本用全库 `select … from blocks where type='d'` 查子文档，只回 64 条且都是真实笔记本里的文档，
> 误报了一次「子文档没了」。换成按 id 查就正常了 —— 别再用全库 SQL 做局部断言。

## 对实现的要求

1. 快照一律用 **`getBlockKramdown`**，不要用 `exportMdContent`。
2. 快照在**覆盖 / 追加之前**取，只存在内存里（插件重载即失效，撤销按钮也会随之消失，不存在「有按钮没快照」）。
3. 写回统一走 `updateBlock { id, dataType: "markdown", data: <kramdown> }` —— 与现有覆盖实现同一条路。
4. 内存上限：kramdown 比原文长（带属性块）。按 500 篇 × 20KB 估算约 10MB，需要设一个总量上限
   （建议 50MB），超出的那几篇不登记撤销快照，并在卡片上说明。
