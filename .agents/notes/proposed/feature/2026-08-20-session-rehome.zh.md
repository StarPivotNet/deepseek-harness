# Agent Note: Session rehome and the No Repo workspace

Status: proposed

[English](2026-08-20-session-rehome.md) | 中文

## Problem

Web 对话在创建时通过不可变的 `SessionHeader.cwd` 绑定工作区。用户还不知道请求属于哪个项目时，必须先选工作区才能发送。agent 推断出目录后，同一条对话不能改侧边栏分组或执行根：`attachSession` 拒绝 cwd 不匹配，JSONL 身份是出生 cwd，AGENTS.md / skill / LSP 仍读 header。Cursor 的 Agents Window 用 No Repo 分组和同一条聊天上的 `move_agent_to_root` 解决对应起步。

[Workspace UI 产品流](../../archived/feature/2026-07-25-workspace-ui-product-flow.md) 把跨工作区移动会话和 Ungrouped 收编留在该流程之外。Git worktree overlay 已经把执行根和成员关系拆开，但只用于同仓库分支隔离，并且从不更新侧边栏账本。

## Proposal

出生 cwd 继续作为持久化身份。当前家记为一条仅日志的 `workspace/home { path }` 事件。工具 cwd 和 Web 列表 `cwd` 跟随有效家。成员关系跟随最后一条 `workspace/home`，否则 header cwd。

### 有效家

`sessionWorkingDirectory` 按日志时间折叠最后一条 `workspace/home` 或 `git/worktree`，否则使用 `SessionHeader.cwd`。改挂之后再出现的 `git/worktree` 仍在新项目内隔离分支。再晚的 `workspace/home` 覆盖先前的 worktree overlay。

### 成员关系

`attachSession` 用会话的成员家（最后一条 `workspace/home`，否则 header cwd）校验工作区路径。注册表会话路径索引存储该家，而不是出生 cwd。首次引导仍只按 header cwd 分组。已初始化标记写入后，已记账冷会话会 inspect `workspace/home`，因此改挂后的会话不必打开也能留在目标工作区。`git/worktree` 仍是同仓库 overlay，不改变成员关系。

### Host `session.rehome`

`session.rehome({ sessionId, path })` 是唯一变更路径。它：

1. 规范化 `path`；缺失或非目录失败为 `workspace-invalid-path`。
2. 拒绝规范 No Repo 目录（`session-rehome-no-repo`）。
3. 拒绝子 agent 拥有的会话（`agent-busy`）。
4. 对已存在目录调用 `workspace.create(path)`（幂等）。
5. 若成员家（最后一条 `workspace/home`，否则 header cwd）已等于该路径且工作区已记账，则成功且不追加事件。匹配的 `git/worktree` overlay 不算这次无操作。
6. 否则追加 `workspace/home`，从先前工作区账本 detach，attach 到目标。

Host `session.create` 在没有 `workspaceId`/`cwd` 时使用 No Repo 目录并在那里 attach。`host.describe.cwd` 报告同一默认值，使 UI 默认项目与落地目录一致。

### No Repo 工作区

工作区注册表启动时（Web 组合）确保 `$DSH_HOME/no-repo` 作为目录存在，并在该规范路径未被拥有时以标题 `No Repo` 调用 `create`。若另一标题已拥有该路径，路径身份获胜。

Web 未显式指定工作区的 New Session 指向该工作区。当前会话已挂到 No Repo 时，常驻 composer 不再 inert。

### 插件

`@wuxie/dsh-session-rehome` 注册 `move_agent_to_root({ rootPath })`，通过 host API（或同一组合中的进程内注册表）调用 `session.rehome`。策略：从 No Repo 唯一命中已注册工作区则直接执行；已在真项目上，或多个命中，则先 `ask_user_question`。它不 mkdir。

### 必须读取有效家的消费者

- `dsh-sandbox-policy` 的 `sessionWorkingDirectory`（已是 bash/fs 的工具 cwd 所有者）
- `dsh-agent-instructions`
- `dsh-tool-skill` 目录 cwd
- `dsh-tool-lsp` 会话 cwd
- Host `session.list` / `host/session-added` 的 `cwd` 字段（客户端分组键随之移动）
- 客户端列表 upsert 必须替换 `cwd`，而不是只填空

Git checkout 继续使用所属工作区的主路径作为仓库根；改挂后即新家的工作区。

## Alternatives considered

**改写 `SessionHeader.cwd` 并移动 JSONL 文件。** 否决：header 身份是持久化和投影缓存键；改写会与活动追加和 HMR 接管竞态。

**把 `git/worktree` 复用为项目搬家事件。** 否决：该 overlay 表示成员工作区的隔离检出。项目搬家必须改变成员关系。

**只从 cwd 派生分组、不做显式账本移动。** 否决：成员关系是显式账本外加匹配的家；引导之后仅有 cwd 的会话仍是 Ungrouped。

**交接摘要进入新会话。** 被已接受的产品合同否决：必须是同一条对话搬家。

**只做插件侧边栏标签。** 否决：工具和 AGENTS.md 会停在旧根。

## Acceptance criteria

- No Repo 目录存在、已注册，并且是省略项目时的创建目标。
- Web 可以在该工作区发送第一条提示，无需点击选择器。
- `session.rehome` 在当前回合移动账本和有效家；bash/fs/AGENTS.md/skills/LSP 跟随。
- 改挂到 No Repo 以及改挂子 agent 会话失败。
- 插件在离开真项目或目标含糊时询问；从 No Repo 唯一命中已注册工作区时不询问。
- JSONL 留在出生 cwd 下。

## Risks

- 工作区注册表启动时 inspect 已记账冷日志会增加 I/O；单个 inspect 失败时回退到 header cwd，而不是中止启动。
- 客户端列表先前把 `cwd` 当作不可变的只填空字段；替换它是分组所依赖的行为变化。
- 本交付中 session-query 的同 cwd 授权仍使用出生 cwd，因此改挂后的会话不能列出在新目录出生的同伴。推迟，而不是悄悄扩大查询范围。
