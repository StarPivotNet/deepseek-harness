# OC2DSH

把 [OpenCode Zen](https://opencode.ai/zen) 上**当前可用的免费模型**注册成 [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness) 的原生 `dsh-llm` adapter。

- 模型选择器显示名：**OpenCode Zen**
- 协议：按 `api.json` 记录的 `provider.npm` 逐模型推导——
  `@ai-sdk/openai` 走 OpenAI **Responses**（`POST {zen}/v1/responses`），
  `@ai-sdk/anthropic` 走 Anthropic **Messages**（`POST {zen}/v1/messages`），
  `@ai-sdk/google` 走 Google **Generative AI**（`POST {zen}/v1/models/<id>:…`），
  其余走 OpenAI-compatible **Chat Completions**（`POST {zen}/v1/chat/completions`）
- 目录：与 `fetch_zen_free.py` 相同——`models.opencode.ai/api.json` 中 cost 为 0/0 的模型，与 `zen/v1/models` 在线列表取交集。
  推理档位和上下文/输出上限同样来自 `api.json` 记录，不硬写任何模型
- 刷新时机：**插件加载时拉一次**（打开选择器不再重拉）
- 请求指纹：每次调用都带 OpenCode 原样指纹——sidecar 出站 UA
  （`opencode/<版本> ai-sdk/provider-utils/<版本> runtime/node.js/<主版本>`）+ 格式正确的 `x-opencode-*` 头（见 `src/adapter/ids.ts`）；
  SDK 遥测头（`X-Stainless-*`）、默认 `Accept`、`anthropic-beta`/浏览器标记、
  多余亲和头全部抹掉，上游 waterfall 头只放行官方集合
- 韧性：零内容即时拒 403（`FreeTierError`/`RegionError`）会自动换新 request id
  重发——通道 verdict 按请求波动，而宿主不重试 AUTH 码。正常回答全程直播
  （TTFT 不受影响），只短暂按住不可见的零 usage 前缀
- 若多次仍 403，说明匿名通道对你出口关闭：IP 配额 UTC 午夜重置；出口尽量用
  模型所在地区的非机房 IP；或配真 key
- 默认推理强度：**`off`**（按各模型的目录档位 clamp）

没有子进程、没有 sidecar。adapter 通过 `@earendil-works/pi-ai` 直连 Zen。

## 安装

```bash
pnpm install
pnpm build
```

把构建结果装进 DSH。`cordis.patch.yml` 会插入一条 host 插件行：

```yaml
- insert:
    - id: oc2dsh
      name: OC2DSH
      config: {}
```

重启 DSH 后，模型选择器应出现 **OpenCode Zen / …**，以及加载时拉到的免费模型列表。

## 配置

| 字段 | 默认 | 含义 |
| --- | --- | --- |
| `providerId` | `oc2dsh` | 注册到 `dsh-llm` 的路由名 |
| `zenBaseUrl` | `https://opencode.ai/zen` | 不含 `/v1` 的 origin |
| `apiKey` | `OPENCODE_API_KEY` 或 `public` | Zen 凭证 |
| `defaultReasoningEffort` | `off` | 未指定时发送的推理强度 |

## 开发

```bash
pnpm test
pnpm typecheck
pnpm build
```

## License

MIT
