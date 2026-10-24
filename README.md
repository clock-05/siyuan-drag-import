# 拖拽导入（siyuan-drag-import）

思源笔记插件：从 Windows 资源管理器把 `md` 文件、文件夹、压缩包**直接拖到文档树**完成导入，层级原样还原，无需走「设置 → 导入」弹窗。

## 状态

| 阶段 | 内容 | 状态 |
|---|---|---|
| 设计 | 功能设计 + 三态交互原型 | ✅ 已完成 |
| M0 | 7 项技术验证（内核行为 + 渲染层源码） | ✅ 已完成 |
| M1 | 单个 md 拖入 → 建文档 → 结果卡片 | 待开始，任务见 [`docs/M1-PLAN.md`](docs/M1-PLAN.md) |

技术验证结论与设计修正见 [`docs/M0-VERIFY.md`](docs/M0-VERIFY.md)；功能设计见 [`docs/DESIGN.md`](docs/DESIGN.md)。
**开新会话做 M1 时，先读 [`docs/M1-PLAN.md`](docs/M1-PLAN.md) 第 0 节的启动提示词。**

## 目录

```
docs/            设计与验证文档
  DESIGN.md        功能设计（v0.2，已按 M0 结论修订）
  M0-VERIFY.md     7 项验证的方法、实测结果、设计影响
  M1-PLAN.md       M1 任务分解 + 新会话启动提示词
  prototype.html   三态交互原型（浏览器直接打开）
research/m0/     M0 验证脚本与原始输出
```

## 关于 research/m0

这些脚本会**在你正在运行的思源上打真实 API**（默认 `127.0.0.1:6806`）。它们只操作自建的临时笔记本，并在 `finally` 里删除，不会碰既有数据。

- 脚本里的工作空间路径是写死的（`D:/Knowledge2/...`），换机器需要改。
- 直接跑：`node research/m0/verify-kernel.mjs`（会生成 `kernel-report.json`）

## 硬性约定（与 latex-paste 一致）

- `index.css` 必须存在，即使没有样式
- `plugin.json` 的语言键用 BCP 47 格式 `zh-CN`
- 诊断信息落盘到 `data/storage/petal/siyuan-drag-import/`，不让用户复述控制台
- 发版推 `v*.*.*` tag，CI 打包 `dist/` 为 `package.zip`
