# 改文案与发版指南

插件已经上架（集市 PR #2403 已合并，`plugins.txt` 里是 `clock-05/siyuan-drag-import`）。
之后只做两件事：**改文案** 和 **发新版本**。

## 一、改文案

### 集市卡片上的简介

改 **`plugin.json`** 的 `description`，两个语言都要改：

```json
"description": {
  "default": "英文简介（英文用户看到的就是这句）",
  "zh-CN": "中文简介"
}
```

`displayName`（插件名）也在同一个文件里。

### 详细说明（README）

| 文件 | 谁看 |
| --- | --- |
| `README.md` | 英文用户，集市里点「详细说明」看到的就是它 |
| `README.zh-CN.md` | 中文用户 |

`plugin.json` 的 `readme` 字段已经把语言映射到这两个文件，一般不用动。

### 界面里的文案（拖拽横幅、卡片、按钮、报错）

**不是改 README**，要改 `src/i18n/messages.zh.ts` 和 `messages.en.ts`。
英文表由 `typeof zh` 约束，漏翻或多翻会直接编译报错。
`test/i18n-coverage.mjs` 会扫 `src`（除 `src/i18n/`）出现中文字面量就失败 —— 所以别在别处硬写中文。

### 预览图

`preview.png` 由 `docs/preview.html` 渲染而来，改文案或配色就改那个 HTML：

```bash
edge --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
     --window-size=1024,768 --screenshot=preview@2x.png docs/preview.html
# 再下采样到 1024×768 并压到 512 KiB 以内，覆盖根目录 preview.png
```

集市要求 1024×768、≤512 KiB；`plugin.json` 声明了 `preview` 就必须打进包里。

## 二、发新版本（改完文案一定要走这步）

**关键点：集市展示的简介读的是 Release 包里的 `plugin.json`，不是仓库文件。**
只改文件不重新发布，集市上看到的还是老文案。

### 一条命令

```bash
npm run release -- 1.0.2
```

它会依次：改 `package.json` + `plugin.json` 的版本号 → 构建并检查 dist 结构 →
提交 → 打 `v1.0.2` tag → 推分支和 tag。

想先看它要做什么而不真的发：

```bash
npm run release -- 1.0.2 --dry-run
```

### 或者手动来

```bash
# 1. 改版本号（package.json 与 plugin.json 两处必须一样）
# 2. 构建
npm run build
# 3. 提交
git add -A && git commit -m "release: 1.0.2"
# 4. 打 tag 并推送
git tag -a v1.0.2 -m "1.0.2"
git push origin main && git push origin v1.0.2
```

### 之后

1. 看 CI：<https://github.com/clock-05/siyuan-drag-import/actions>
   Release 工作流会校验 tag 与 `plugin.json` 版本一致、跑离线测试、打包 `package.zip`、建 Release。
2. 校验 Release 里的 `package.zip`：解压后**根目录直接是** `index.js` / `index.css` / `plugin.json` /
   `README*.md` / `LICENSE` / `icon.png` / `preview.png`，不能多套一层目录。
3. **不用再提交集市 PR** —— 集市自动取最新 Release。等几分钟索引更新，重启一次思源即可。

## 版本与分支约定

- 默认分支 `main`；发版用 tag `v<version>`。
- `package.json` / `plugin.json` / tag 三处版本号必须一致（CI 会拦）。
- 插件包名、仓库名、`plugin.json.name` 三者绑定，**上架后不能再改名**。
- 后续更新不用再提集市 PR：递增版本 + 发新 Release 即可。

## 发版前自检

- [ ] `plugin.json` 的 `name` == 仓库名 == `siyuan-drag-import`
- [ ] `url` 指向真实仓库，`author` 是作者名
- [ ] `version` 与 tag 一致（CI 会拦）
- [ ] `displayName` / `description` / `readme` 都有 `default`（英文）和 `zh-CN`
- [ ] `index.css` 存在（集市硬性要求）
- [ ] `icon.png` 160×160、≤64 KiB
- [ ] `preview.png` 1024×768、≤512 KiB（有的话 `plugin.json` 必须声明 `preview`）
- [ ] Release 里 `package.zip` 可下载，解压后根目录直接是 `index.js` / `plugin.json`（不能多套一层）
- [ ] `minAppVersion` 不高于你实际测试过的版本（当前 3.1.0，实际完整测试在 3.8.8）
- [ ] README 里没有失效链接（`LICENSE`、`docs/*` 都已随仓库提交）
- [ ] 界面文案改动同步改了 `messages.zh.ts` 和 `messages.en.ts`

## 卸载/重装自测

从 Release 下载 `package.zip`，解压到
`<工作空间>/data/plugins/siyuan-drag-import/`，重启思源，确认设置面板与拖拽都正常。
