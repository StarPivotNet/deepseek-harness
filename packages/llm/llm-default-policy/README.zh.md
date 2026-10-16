# @deepseek-ai/dsh-llm-default-policy

[English](README.md) | 中文

产品级默认重试预算与流空闲超时，供省略自身取值的提供方路由使用。`LlmDefaultPolicyConfig` 提供 `ctx.llmDefaultPolicy`。DeepSeek 与 pi-ai 适配器读取同一服务，而不是各自再发明一套默认值。

插件配置默认值为有限重试五次、关闭无限重试、以及五分钟流空闲间隔。实时 volatile Config 即 Settings 中的 `llm-default-policy` 分节；Web「通用设置」行写入该分节，更改会在下一次调用 `current()` 时可见。

- `ctx.llmDefaultPolicy.current()` 返回一份独立的 `{ maxRetries, unlimited, streamIdleTimeoutMs }` 记录。
- `resolveProviderRetryPolicy(config, defaults, path)` 解析提供方自有的 `retryPolicy`；提供方省略时使用产品级默认值。无限对应 always 模式，否则 normal 模式使用 `maxRetries`。
- `resolveStreamIdleTimeoutMs(configured, defaults)` 返回提供方间隔；提供方省略时使用产品级默认值。

提供方一旦设置 `retryPolicy` 或 `streamIdleTimeoutMs`，就沿用该精确值。默认服务从不改写显式提供方字段。

## 模型体验

通过适配器应用到省略字段上的重试预算与空闲间隔间接影响。每次重试都是一次新的提供方请求；空闲间隔只约束一次未完成的提供方读取。

#### KV Cache 影响

更改默认值只影响之后仍省略自身策略或空闲间隔的适配器注册。进行中的请求仍沿用开始时捕获的服务策略。

## 已知限制与暂缓事项

- 该服务只拥有一项进程级默认值；按提供方覆盖仍写在各适配器自己的配置上。
