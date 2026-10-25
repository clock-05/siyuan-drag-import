# 上架清单

面向作者的交付步骤。代码侧已经准备好：中英 README、LICENSE、`package.zip` 构建、GitHub Actions 打包与测试、`plugin.json` 双语字段。

## 需要你本人做的三件事

1. **确认 GitHub 仓库地址**。`plugin.json` 里现在写的是
   `https://github.com/clock-05/siyuan-drag-import`。如果你的 GitHub 用户名不是 `clock-05`，
   把 `plugin.json` 的 `url`、`author` 改成实际值（集市按 `owner/repo` 收录，写错会检查失败）。
   README 首屏的预览图用的是 `raw.githubusercontent.com` 绝对地址，同样要跟着换：

   ```bash
   grep -rl "clock-05/siyuan-drag-import" README.md README.zh-CN.md \
     | xargs sed -i "s#clock-05/siyuan-drag-import#<你的用户名>/siyuan-drag-import#g"
   ```
2. **建仓库并推送**（仓库必须公开、默认分支 `main`、仓库名必须叫 `siyuan-drag-import`）：

   ```bash
   # 在 GitHub 上新建空仓库 siyuan-drag-import（不要勾选 README / .gitignore）
   git remote add origin https://github.com/<你的用户名>/siyuan-drag-import.git
   git push -u origin main
   ```

3. **预览图（已就位）**。`preview.png` 是 1024×768 / 269 KiB，由 `docs/preview.html` 渲染而来
   （按真实卡片样式重绘的示意图，不含真实笔记内容）。要改文案或配色就改那个 HTML，然后：

   ```bash
   edge --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
        --window-size=1024,768 --screenshot=preview@2x.png docs/preview.html
   # 再下采样到 1024×768 并压到 512 KiB 以内，覆盖根目录 preview.png
   ```

   `plugin.json` 已声明 `"preview": "preview.png"`，`package.zip` 里也会带上。

## 第一次发版

```bash
git tag v1.0.0
git push origin v1.0.0
```

推 tag 后 `.github/workflows/release.yml` 会自动：构建 → 跑离线测试 → 校验 tag 与
`plugin.json` 版本一致 → 打包 `package.zip`（`index.js`、`index.css`、`plugin.json`、
`icon.png`、`README*.md`、`LICENSE`、有则 `preview.png`）→ 建 Release 并附上 `package.zip`。

版本号规则：`plugin.json` / `package.json` / tag 必须一致；后续更新只需递增版本 + 发新 Release，
**不用**再提交集市 PR。

## 提交到集市

1. Fork [siyuan-note/bazaar](https://github.com/siyuan-note/bazaar)（先与 main 同步）。
2. 在仓库根目录的 `plugins.txt` **末尾加一行**（一行一个，不要逗号和空行）：

   ```
   <你的用户名>/siyuan-drag-import
   ```

3. 向 `main` 提 PR，说明这是新插件。PR Check 会自动校验 Release、`package.zip`、`package.json`
   字段等；检查不过就按提示改，**不要**再开新 PR（定时任务会重跑检查）。
4. 合并后几分钟内集市索引更新；思源里重启一次即可看到。

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

## 版本与分支约定

- 默认分支 `main`；发版用 tag `v<version>`。
- 插件包名、仓库名、`plugin.json.name` 三者绑定，**上架后不能再改名**。
- 卸载/重装自测：从 Release 下载 `package.zip`，解压到
  `<工作空间>/data/plugins/siyuan-drag-import/`，重启思源，确认设置面板与拖拽都正常。
