# 评测结果

主结论见 [0.2 原生检索报告](../REPORT-NATIVE.md)，入口与指标定义见 [评测说明](../README.md)。所有结果沿用 `tasks.json` 的 16 题；模型每类仅取第一题。

| 文件 | 用途与有效性 |
| --- | --- |
| `retrieval-native-021.json` / `.md` | 0.2.1 有效主重测：原16题各三次，生产补读提示、相同预算；48次原生检索，无新增模型调用 |
| `ablation-native-021.json` | 同11页原生回包分别走0.2.0和0.2.1生产代码，区分解析/定位与读取策略，零搜索请求 |
| `validation-native-021.json` | 核对原题和证据摘要、全部96条评分、范围/字节/补读提示，以及批量超时 |
| `host-smoke-021.json` / `runtime-native-021.json` | 0.2.1真实宿主、Read提示消费、预算、51项测试及服务停止记录 |
| `batch-native-021.json` | 默认1.5秒的Map与批量控制，一批超时并逐项回退，`valid:false`，不用于宣称批量收益 |
| `retrieval-native-parallel.json` / `.md` | 0.2 有效主检索：每题三次，修正为宿主默认并行 rg，48 次真实原生检索；元数据文字更正有单独记录，未改评分 |
| `agent-ab-native-corrected.json` / `.selection.json` | 0.2 有效模型对比：四题两组，44 次有效 HTTP；保留六条未受影响结果，仅重跑两条被旧权限规则误拒绝的任务 |
| `batch-native-verified.json` | 最终 Map + Batch 控制：同 16 题分四组，5 秒配置，`valid:true`；无模型调用 |
| `runtime-native.json` | 复用索引、原生四项真实调用、搜索服务资源样本、测试与服务停止状态 |
| `validation-native.json` | 再核对 96 条检索评分、16 条批量评分、18 个证据摘要与全部有效原始 API usage，记录最终合计 |
| [diagnosis-native/](diagnosis-native/README.md) | 后续逐题根因调查与离线读取对照，保留适配原型、索引、查询改写的正负结果；不替代旧成绩 |
| `retrieval-native.json` / `.md` | 无效初次原生检索：额外 `--sort path` 导致基线大量超时、降级演练失败，不作为收益证据 |
| `agent-ab-native.json` / `.selection.json` | 初次原生模型原始记录：43 次 HTTP，其中两条实验组任务被旧权限规则影响；保留全部消耗，不用混合汇总 |
| `batch-native.json` | 原始 1.5 秒配置控制：两批超时、八项错误，保留失败 |
| `batch-native-5s.json` | 仅增至 5 秒后的控制，发现三项原生引用缺正文和行号 |
| `batch-native-final.json` | 减少批量正文、保留定位后的中间控制，仍有三项缺引用 |
| `batch-native-citations.json` | 恢复原生 citation 后的中间控制，仍拒绝三项无行号引用 |
| `batch-native-script-invalid.json` | 复现脚本初次传错宿主上下文导致全部回退，未实际查询 XERJ；修正后另存最终结果 |
| `retrieval.json` / `.md` | 历史 0.1 自写 `_search` 适配器检索，不代表原生能力 |
| `agent-ab.json` / `.selection.json` | 历史 0.1 真实模型结果，不与 0.2 混算 |
| `runtime.json` | 首轮二进制校验、冻结语料、完整建索引成本及服务停止状态 |

本轮实际共发生 53 次模型 HTTP：初次 43，加两条受影响任务重跑 10。有效比较保留 44，另九次仍是实际已发生的消耗，排除理由和来源 SHA 写在更正报告。最终八次有效任务中五次预算耗尽，不能将路径提及或进度文本当成最终回答。

结果限定于这次冻结语料、版本与配置，不能代替未来版本验收。检索和批量的模型指标为 `null`，真实模型 Token 只来自 A/B 的原始 API usage；费用不推算。检索脚本会覆盖指定文件，保留历史时使用新名字；批量和模型脚本拒绝覆盖已有输出。
