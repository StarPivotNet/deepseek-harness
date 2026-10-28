---
description: "内置 Grok Code 预设：Grok 工作策略、think-act 任务队列、计划模式、subagent 与 AgentTeams 派活，以及随包逆向技能库。"
kind: "package-bundle"
---

# `@deepseek-ai/dsh-grok-code`

[English](README.md) | 中文

## Summary

选 `grok-code` 预设，会话就跑在 Grok Code 组合上：Grok 人设、标准模式工具集加 workflow 与 Ralph、带显式进入工具的计划模式、按轮任务队列，以及一个随包 27 个技能的技能目录（其中 124 个逆向方法）。预设由本包在启动时向 agent-preset 注册表声明，因此凡是选中本 bundle 的 profile，模式下拉里都有它。不需要单独安装，也不扫目录。

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

在新会话的模式下拉里选 **Grok Code**，或显式点名：

```sh
dsh --profile web --agent-preset grok-code
```

会话只有在没产出任何消息或工具调用之前才能切到本预设；之后组合在该会话生命周期内固定。删掉 `$DSH_HOME/.agent-presets/grok-code` 不影响本预设——组合随本包走。

预设的技能通过 `skill` 工具加载。其中 `agi-reverse` 是网关技能：它按用户指明的产物类型，指向 `presets/grok-code/skills/agi-reverse/library/` 下的方法文件，模型去读那个文件，而不是用 `re-*` 名字调 `skill`。

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>实现细节——点击展开</summary>

`@deepseek-ai/dsh-grok-code` 是 base bundle 组合里的一行（`packages/bundle/base/cordis.patch.yml`），每个 profile 都会挂到它。该行解析到本包的入口 `src/index.ts`，它用 Loader 自己的 YAML 方言（`entryListSchema`，所以 `!!js` 作为数据保留）读 `presets/grok-code/agent.cordis.yml`，把相对行名改写成指向本包内的 file URL，把 `skill-filesystem` 行的技能目录换成随包的那份，再把结果交给 `agentPresets.register()`。

运行时没有声明注入：注册表可能在本行之后才组装，所以它按 400 毫秒轮询 `ctx.get('agentPresets')`，最多 45 秒，服务始终不出现就记一条警告。它自己的注册通过 `ctx.effect` 释放，重载时声明随插件一起摘掉。

为什么走注册表而不是目录发现：本版本的模式下拉只认注册表声明。`$DSH_HOME/.agent-presets` 下的目录只提供组合文件，永远不会自己变成可选模式——这也是手工装同一个预设时还得改 profile patch 的原因。

### 源码索引

| 文件 | 作用 |
|---|---|
| [`src/index.ts`](src/index.ts) | 包入口：读组合、声明预设、拥有技能目录 |
| [`presets/grok-code/agent.cordis.yml`](presets/grok-code/agent.cordis.yml) | 预设组合 |
| [`presets/grok-code/preset.yml`](presets/grok-code/preset.yml) | 显示名与描述 |
| [`presets/grok-code/skills/`](presets/grok-code/skills) | 随包技能 |
| [`tests/grok-code.spec.ts`](tests/grok-code.spec.ts) | 组合、行解析与声明检查 |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Agent presets](../../preset/agent-presets/README.zh.md)——注册表、名册，以及一条声明如何到达下拉。
- [Red-team bundle](../redteam/README.zh.md)——另一个从 bundle 出厂自带预设的包，启动时声明的形状相同。
- [Tool skeleton](../../core/tools/README.zh.md)——本组合选中的工具。

-----

<a id="model-experience"></a>
## Model Experience

### Grok Code 组合

#### What the model sees

人设是 Grok 框架：工作策略、目标完成、工具调用、记忆写入每会话的认知台账、后台任务、改代码规则、校验规则、项目指令、判断、并行工作、技能、沟通、格式，以及思维链。任务队列是 `todo_write`；跨轮工作走已配置的目标工具。工具是标准集加 `subagent`、`subagent_fork`、`workflow`、`ralph`、`enter_plan_mode`、`exit_plan_mode` 与 `calculator`。技能是 `presets/grok-code/skills` 下 27 个目录，只广告名字和描述。

#### Token effect

人设是主要的固定开销，而且很大：它把工作策略和校验契约直接写在提示词里，而不是做成技能按需加载。技能目录每条一行，不含正文。每个技能正文都是按需的工具结果；`agi-reverse` 的方法文件用文件工具读取，从不作为目录条目。压缩比标准预设更早更狠（阈值比 0.82、保留比 0.42），超过 120000 字符的工具结果会被裁成头尾。

#### KV Cache effect

组合固定时稳定，因为人设文本与工具 schema 不随轮次变化，预设也从不把工作区状态写进提示词。前置快照（todo、台账、笔记）随轮次追加文本，只有内容真的变了才中断缓存复用。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **组合里点到的工具与插件本 bundle 不带**——`codegraph_*`、`read_page`、`x_search`、`agent_teams_*`、`super_goals_*` 与 `set_subagent_reasoning_effort` 来自市场插件。没有它们的 profile 会挂载本预设但缺少这些名字，而描述它们的人设文本仍留在提示词里。
- **VMProtect 导出目录是 46MB 的二进制块**——`presets/grok-code/skills/agi-reverse/library/re-vmp/catalog/` 随包带了解包器要读的 Windows DLL 导出转储（`catalog.json`、`catalog_32.json` 与两份 `ntdll`）。`vmp3104.py doctor` 会把四个文件都报 `ok`，但 `pefile`、`capstone`、`unicorn` 要另外装，doctor 会逐个点名缺哪个模块。
- **技能带有上游署名**——`agi-reverse` 注明 rev-skills by dslsdzc，CC BY 4.0；`minecraft-build` 随包带 GPLv3 的 SDK 与查看器，但缺其 `LICENSE` 文件。
- **未随包带上游预设自带的测试套件**——它断言的 `x-compaction-at` 值 header 插件已不再发送，收进来只会多一套永远红、又不测本包任何东西的用例。

<a id="dev-note"></a>
### Dev Note

<details>
<summary>维护者工作说明——点击展开</summary>

组合是上游 `dsh-grok-agi` 预设的副本，带四处本地修正：workflow provider 用 `workflow-ptc`，因为本仓库不依赖 `dsh-workflow-worker-thread`；`official-file-prompt-shadow` 关闭，因为它会清空文件工具的提示段；`tool-web` 保留 `fetch: true`；`{{cwd}}` 模板被删掉，因为没有插件注册该提示变量，而插值遇到未注册名字会抛错。从上游重新同步时保留这几处修正。

</details>
