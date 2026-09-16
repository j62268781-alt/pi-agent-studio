# modules · 功能模块

本目录收纳扩展的**功能模块**。每个子目录是一个自包含的功能域，只通过 `extension.ts` 注册的
命令 / 视图 / 面板对外暴露；模块之间允许单向引用（如 `settings` 引用 `models` 的配置读写），
不允许反向依赖。

`src/` 根只保留**基础设施**：`extension.ts`（入口）、`bridge/`（编辑器桥服务器）、`pi.ts`
（pi 进程与桥启动封装）、`i18n.ts`、`constants.ts`、`_resolve.ts`、`ui-mode.ts`、
`session-status-registry.ts`（桥接上报的会话状态源）、`webview-columns.ts`、`ui/`（设计 token 读取）。

## 模块索引

| 模块 | 职责 | 状态 |
| --- | --- | --- |
| [`chat/`](chat/) | **聊天界面**。`chat-sidebar.ts` 侧栏视图（`pi-agent-studio.chatSidebar`）、`chat-panel.ts` 编辑器面板、`chat-session.ts` 会话宿主（RPC 子进程 + 全部 webview 消息）、`chat-webview.ts` webview HTML、`chat-tracker.ts` 面板追踪、`rpc-trace.ts`、`add-to-chat.ts`（选区/文件加入会话）、`builtin-commands.ts`（`/new` `/session` 等内置命令） | ✅ 在用（默认 sidebar） |
| [`settings/`](settings/) | **设置面板**（编辑器区 WebviewPanel）。`settings-panel.ts` 宿主 + 数据 CRUD、`settings-config.ts`（pi 的 settings.json 读写）、`settings-webview.ts`、`settings-dist.html`（pi-settings 构建产物） | ✅ 在用 |
| [`models/`](models/) | **模型配置域**：`models-config.ts`（models.json 读写）、`auth-config.ts`（API keys）、`oauth-flow.ts`（OAuth 流程控制器） | ✅ 在用（设置面板 Models 页的数据源） |
| [`agents/`](agents/) | **Agents 配置域**：`agents-config.ts`（user/project 作用域的 agent 定义读写） | ✅ 在用 |
| [`prompts/`](prompts/) | **Prompt 模板配置域**：`prompts-config.ts` | ✅ 在用 |
| [`skills/`](skills/) | **Skills 配置域**：`skills-config.ts`（SKILL.md 读写） | ✅ 在用 |
| [`mcp/`](mcp/) | **MCP 配置域**：`mcp-config.ts`（读写 `~/.agents/mcp.json` / `<project>/.mcp.json`，指向外部 pi-mcp-adapter） | ✅ 在用 |
| [`gitCommit/`](gitCommit/) | **Git 提交信息**：`commitMessageGenerator.ts`（用 pi 从暂存变更生成提交信息，14 种语言）、`gitUtils.ts` | ✅ 在用（SCM 按钮） |
| [`sessions/`](sessions/) | **会话侧栏**（G 页 W1–W4 待按设计重建）。`sessions-sidebar.ts` / `sessions-sidebar-html.ts` —— 未注册；终端相关代码已剥离 | 🚧 休眠 |
| `packages.ts` | **Pi 包市场逻辑**（包搜索/安装，G 页 W4 侧栏的数据源） | 🚧 未接线 |
| `upgrade.ts` | **pi 二进制升级**（检测版本、下载安装） | ✅ 在用（命令 + 状态栏） |

## 约定

- 新功能模块一律建在 `src/modules/<名>/` 下；`src/` 根只保留入口与基础设施。
- 跨模块引用用相对路径（`../models/...`）；引用根基础设施用 `../../i18n.ts` 这类两层路径。
- webview 构建产物（`*-dist.html`）由 `pi-chat` / `pi-settings` 的 `copy-dist` 脚本写入本目录
  对应模块内，已被 `.gitignore` 忽略。
