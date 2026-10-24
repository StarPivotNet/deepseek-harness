# 来源与署名 / Origin and attribution

本组织内置包的实现来自 **[YuJunZhiXue/dsh-purge](https://github.com/YuJunZhiXue/dsh-purge)**，原作者 **小杨**，并包含 **JeffKeeping** 分支截至 **1.4.2** 的适配和修改。原始 MIT 许可证及版权行在 [LICENSE](LICENSE) 中原样保留。

This organization-builtin package derives from [YuJunZhiXue/dsh-purge](https://github.com/YuJunZhiXue/dsh-purge) by 小杨, incorporating the JeffKeeping fork through version 1.4.2. The original MIT copyright and license remain in `LICENSE`.

## 当前维护 / Current maintenance

- 组织维护仓库：`StarPivotNet/deepseek-harness`。
- 包目录：`packages/bundle/purge`。
- JavaScript 运行时代码：`runtime/`；原始资源与浏览器代码保持在生成目录之外。
- 原分支的说明存档见 [UPSTREAM.md](UPSTREAM.md)，其历史内容不是当前组织组合的配置承诺。
- `1.4.0` 对 [Minglink/dsh-infinite-gen-5](https://github.com/Minglink/dsh-infinite-gen-5) 的借鉴说明保留在此；没有复制其逆向引擎、worker 协议、Ghidra / x64dbg 适配层或其代码文本。

| 本包实现 | 参考的 IG5 做法 |
| --- | --- |
| `lib/runtime/json-safe.js` 严格 JSON 输出 | `source/json_output.js` 的字段投影与诊断 |
| `lib/runtime/host-lease.js` 文件身份与写入守卫 | `source/attachment_lease.js` 的 owner + nonce 思路 |
| `lib/runtime/tool-gate.js` 审批与审计 | `index.js` 的 `installApprovalGate` |
| `lib/runtime/revision.js` 状态修订号 | `expected_revision` / CAS 前置校验模式 |

## 不包含的内容 / Omitted content

- 原插件明文提示词源不作为独立文件分发；包内保留原密封资源及解封实现。
- 原上游自更新器不随组织包提供。上游链接仅用于署名和许可追溯，不是更新地址。
- 组织版默认加载并自动应用宿主补丁；保留手动应用、恢复和卸载操作。卸载不删除组织仓库自带的代码。

## 上游的商用禁止条款 / Upstream non-commercial term

上游明确声明：本项目免费、非盈利，禁止任何主体用于商业售卖、付费倒卖或黑灰产牟利。本组织包保留该声明，不因其成为内置包而放宽。

The upstream project forbids commercial sale, paid resale, and profit from gray- or black-market use. This package carries that notice unchanged.

二次开发或再分发时，请同时保留原作者署名、上游仓库链接、MIT 许可证全文以及这条非商用声明。
