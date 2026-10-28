# Agent Note: 复用已校验 Session artifact 并串行化历史迁移

Status: implemented

[English](2026-09-06-session-json-traversal-and-migration-reuse.md) | 中文

## 问题

大型历史 Session 读取会反复为同一事件树创建快照，消耗大量 CPU。一次 15.42 秒的运行时 profile 中，ensure-current 工作占 7.91 秒，其中 JSON 快照占 6.89 秒；垃圾回收占 1.44 秒。在后继 generation 可见之前，重叠读取还可能重复迁移工作。这些同步操作会延迟 Node 事件循环上的其他请求。

## 决策

[JSON 遍历](../../../../packages/util/values/README.zh.md)使用容器游标与当前祖先集合，避免为每个子项分配待处理任务，同时保留无损 JSON 接纳规则与独立副本。[Session-format artifact](../../../../packages/session/session-format/README.zh.md) 仅在本模块已为完整 artifact 创建独立副本、深度冻结并完成全部校验后复用对象身份；私有弱引用注册表识别这些结果。

[JSONL 持久化](../../../../packages/session/session-persistence-jsonl/README.zh.md)在单个后端实例内串行执行完整历史迁移，并在一个 worker 线程中执行 catalog 迁移与校验。迁移的三次 catalog 计算复用该线程，并在 `finally` 中终止线程后才释放准入。取消与后端卸载都会等待线程退出。等待的读取保留独立取消信号，并在完成后重新选择最高 generation，包括执行者取消或失败的情况。稳定的物理源快照、指纹检查与发布仍由宿主执行。

这优化了[已发布格式迁移](../architecture/2026-08-31-released-session-format-migrations.zh.md)的执行成本，并补充[大型 Session 恢复流水线](../../archived/architecture/2026-08-05-large-session-jsonl-restore-pipeline.md)。这两项决策继续保持有效：不可变 generation 发布与针对所有权的恢复校验仍各自拥有独立的决策依据。

## 考虑过的替代方案

**信任外部冻结的输入。** 外层对象冻结既不能证明子项深度不可变，也不能证明 JSON 与坐标校验成功。只有本模块产生且已校验的 artifact 才能复用。

**使用稍后的文件 stat 缓存已解码数据。** 读取与 stat 之间的追加可能把旧的解码字节关联到较新的 revision。复用必须保留实际解码快照的 revision；本次改动不增加这种缓存捷径。

**放宽 JSON 或持久化数据语义。** 接纳循环、稀疏数组、无效属性或改变事件内容，会把性能修复变成数据策略变更。遍历保留校验、独立副本和安全自有属性写入。

**共享某次读取的结果或取消。** 某次读取失败不得使独立读取失败。等待完成后重新打开所选 generation，可避免共享调用者拥有的取消信号；当前 generation 的解码工作仍然保留。

**全部计算留在宿主或为每次读取创建 worker。** 仅优化遍历仍会在事件循环上留下数秒同步 catalog 工作。迁移拥有的单个 worker 将这些计算移出请求处理线程；后端级准入限制 worker 数量及并行完整日志的内存竞争。因此，独立历史 Session 也会依次等待。

## 影响

合成测量中，快照遍历从 222 ms 降至 142 ms，校验从 115 ms 降至 64 ms。对已校验格式 artifact 重复创建快照从 626 ms 降至 0.004 ms。这些是独立微基准，不是端到端请求延迟保证。另一项 29 MB 迁移计算对比从 21.949 秒降至 12.413 秒，输出 SHA 哈希一致。

一次 29 MB worker 迁移与校验测量耗时约 16 秒，记录到的宿主心跳最大延迟为 0.685 秒。已解析输入的结构化克隆仍造成约 0.4–0.7 秒宿主停顿：worker 移走了主要的多秒 catalog 计算，并未消除全部事件循环延迟。这些测量均不保证首次打开更快；worker 启动、传输、宿主解码与发布仍有时间成本。完整日志内存仍与输入大小成正比，串行化仅协调单个后端实例。

定向测试覆盖深层遍历与 JSON 拒绝、独立且不可变的 artifact、不受信任冻结 artifact 的拒绝，以及并发迁移成功、执行者取消、等待者取消和执行者失败。Worker 测试覆盖宿主心跳推进、独立等待取消、活动任务取消、卸载、重新准入前线程退出，以及 worker 故障恢复。构建产物入口测试覆盖从无关工作目录以普通 Node 执行。迁移测试保留前任字节与当前 generation 发布语义。本修复不改变模型可见事件或存储数据格式。
