# 显影：把一次情绪变成可触摸的粒子雕塑

用文字、声音或画面表达此刻，让表达逐渐显形成可以互动的粒子雕塑，并选择留下或让它散去。

## 当前状态

这是一个以学习架构和开发为优先的个人项目。工作区初始化与首次 GitHub 私有仓库同步已完成，下一步是第一个网页任务。尚无网页、粒子渲染或 AI 接口实现，也没有用户体验验证。

- 本地目录：`D:\显影`
- GitHub：<https://github.com/ngacaocam26-sketch/xianying>（私有，需有权限的账号登录）
- 首版目标：以三个实际开发日为时间盒，先完成一条小而完整的体验；不把计划写成已完成。

## 文档入口

| 文件 | 用途 |
| --- | --- |
| [PRODUCT](docs/PRODUCT.md) | 产品目标、完整愿景和首版建议范围 |
| [ARCHITECTURE](docs/ARCHITECTURE.md) | 数据流、模块职责和决策记录 |
| [DEV_LOG](docs/DEV_LOG.md) | 当前任务、验收证据、开发日志和下一步 |
| [AGENTS](AGENTS.md) | 供 CLI 助手读取的协作约定 |

## 从命令行开始

在 VS Code 中打开此目录，再打开内置 PowerShell 终端，或在独立 PowerShell 中运行：

```powershell
Set-Location -LiteralPath 'D:\显影'
git status
codex.cmd
```

`codex.cmd` 启动 Codex CLI；如提示登录，按终端提示完成。Windows 使用 `.cmd` 入口，避免某些 PowerShell 执行策略阻止同名 `.ps1`。CLI 是否能发起对话需在真实交互会话中确认。

第一个提示可以是：

> 先读 AGENTS.md 和 docs/DEV_LOG.md。只带我完成任务 T01；先解释 HTML、CSS、JavaScript 各自的职责和文件关系，再让我逐步编写。不要直接生成整个项目。每次给一个可运行、可验收的小步骤。

目前还没有 `package.json`，不能运行 `npm run dev`。第一个网页先用浏览器打开本地 `index.html`；需要模块和开发服务器时再引入工具。

## 每次开发的固定节奏

1. 开始：运行 `git status`，查看 DEV_LOG 中当前任务。
2. 开发：只完成一个小目标，运行并亲自验收。
3. 记录：补充实际结果、遇到的问题与下一步；不替本人编造“已理解”。
4. 保存：查看差异，选择文件，创建本地提交，再推送。

以一次文档更新为例：

```powershell
git status
git diff
git add README.md docs/ AGENTS.md .gitignore
git diff --cached
git commit -m "docs: update development notes"
git push
```

代码任务应把本次相关代码文件也加入 `git add`。若提示没有可提交内容，无需创建空提交。

保存文件只改变本地文件；`commit` 创建本地版本；`push` 才上传已提交版本。建议每个可验收任务提交一次，开发结束前推送；当前不配置自动提交或定时推送。刷新 GitHub 提交页，确认最新提交与本地 `git log -1 --oneline` 一致。

只有自己在这一台电脑工作时，不必每次机械地拉取；若从其他设备或网页修改过仓库，先确认工作区干净，再 `git pull --ff-only`。若报错，先查看原因，不强制推送。

## GitHub 登录与首次连接排查

```powershell
gh auth status
git remote -v
git branch --show-current
```

如果 GitHub CLI 确实提示需要重新登录，运行 `gh auth login --hostname github.com --git-protocol https --web`，在浏览器完成；不要把令牌写进文档。若推送认证失败，可运行 `gh auth setup-git` 配置凭据助手后重试。

当前 Git 提交身份沿用电脑已有设置；初始化不会修改全局用户名、邮箱或已有登录配置。创建新远程仓库只需一次，日常无需重复 `git init` 或创建仓库。

## 项目资料与密钥

不要提交真实的私人情绪记录、录音、照片或 API 密钥。`.gitignore` 已为 `.env`、依赖、构建产物、`private/` 和 `recordings/` 等目录预留忽略规则。示例使用虚构数据；未来需要环境变量时只提交无密钥的 `.env.example`。私有仓库也应遵守这个约定。

## 参考

- [Codex CLI 官方文档](https://learn.chatgpt.com/docs/codex/cli)
- [AGENTS.md 官方文档](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
- [把本地项目推送到 GitHub](https://docs.github.com/en/migrations/importing-source-code/using-the-command-line-to-import-source-code/adding-locally-hosted-code-to-github)
