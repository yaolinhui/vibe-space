# Vibe Space 宣传文案（真实、真诚版）

## 1. Reddit 英文版（适合 r/ClaudeAI、r/coding、r/javascript）

**标题**：I built a browser dashboard to manage multiple Claude Code sessions without drowning in terminal tabs

**正文**：

Hey everyone,

I’ve been using Claude Code (and similar AI CLI agents) for a while, and one thing kept bugging me: they’re single-session tools. If you maintain more than one project, you end up with a wall of terminal windows, constant context switching, and no easy way to queue tasks.

So I built **Vibe Space** — a small open-source dashboard that runs in your browser and lets you:

- See multiple project terminals in one grid
- Queue tasks per project and auto-dispatch them when the agent is idle
- Watch status (idle / busy / waiting for input) without switching windows
- Attach files/images to tasks
- Run it as a PWA if you want

It’s not trying to be a full orchestration platform. It’s just a practical workspace for people who juggle several AI-assisted projects at once.

**Tech stack**: Node.js, Express, WebSocket, node-pty, xterm.js.

**Honest caveats**:
- Cost tracking is in the UI but still basic.
- Task templates exist, but bulk import is not fully polished yet.
- It’s community-driven, not affiliated with Anthropic or any AI provider.

If that sounds useful, the repo is at https://github.com/yaolinhui/vibe-space. MIT licensed. Issues and PRs welcome.

Would love feedback from anyone else managing multiple agent sessions.

---

## 2. V2EX 中文版

**标题**：写了个小工具，把多个 Claude Code / AI 终端会话放到一个浏览器窗口里管

**正文**：

最近一直在用 Claude Code 这类 AI 命令行工具写代码，但有个痛点：一个项目就得开一个终端，切来切去很烦，任务也没法排队执行。

所以做了 **Vibe Space**，一个开源的浏览器工作台：

- 一个窗口里同时看多个项目的 AI 终端
- 每个项目有自己的任务队列，AI 空闲时自动发下一个任务
- 实时显示每个会话是空闲、忙碌还是在等用户确认
- 支持给任务附加图片、日志、代码文件
- 可以当 PWA 安装到桌面
- 支持多主题和中英文界面

它不是一个完整的 DevOps 平台，只是想解决“多个 AI 会话不好管”这个具体痛点。

技术栈：Node.js + Express + WebSocket + node-pty + xterm.js。

**实话实说的局限**：
- 成本统计 UI 有了，但功能还比较基础
- 任务模板有，批量导入还没做完
- 目前主要按 Claude Code 优化，但命令可以自定义

仓库：https://github.com/yaolinhui/vibe-space
MIT 开源，欢迎提 issue 和 PR。

有同样多项目管理需求的朋友可以试试，也欢迎吐槽。

---

## 3. X / Twitter 短版

Tired of juggling terminal tabs for every AI coding session?

Vibe Space is a small open-source dashboard that puts multiple Claude Code (or any agent CLI) sessions in one browser window — with per-project task queues and auto-dispatch.

Not a platform. Just a workspace.

https://github.com/yaolinhui/vibe-space

#ClaudeCode #AIcoding #opensource #vibecoding

---

## 4. 产品一句话描述（可用于简介、签名、README 补充）

Vibe Space 是一个浏览器端的 AI 多会话工作台，让你在一个窗口里管理多个项目的 Claude Code / AI 终端，按队列分发任务，减少反复切换窗口的麻烦。

---

## 使用建议

- Reddit 版可以发到 r/ClaudeAI、r/coding、r/webdev、r/SideProject。
- V2EX 版适合发到「分享创造」节点。
- 发布前建议截一张实际运行图，比文字更有说服力。
- 如果社区有人问“和 tmux/screen 有什么区别”，可以回答：tmux 管理终端，Vibe Space 管理的是终端里的 AI 任务队列和状态。
