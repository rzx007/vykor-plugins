# 仓库检索评测

这套脚本比较 Xerj 插件与 `rg + 文件读取` 在固定题集上的检索表现，回答三个具体问题：前 5 个不同文件有没有人工确认的相关文件、有没有真正读到预先标记的证据行、返回多少字节以及需要多长时间。

它不调用模型，不测量真实 Token、费用或任务完成率。这些字段明确写为 `null`，不能把检索字节变化换算成模型节省比例。

## 文件与入口

| 文件 | 用途 |
| --- | --- |
| [tasks.json](./tasks.json) | 事先固定的 16 道题、人工答案、证据行和基线正则 |
| [evaluate.mjs](./evaluate.mjs) | 命令行入口，调用真实插件，执行重复评测和降级演练，写出 JSON 与 Markdown |
| [batch.mjs](./batch.mjs) | 同一题集分四题一组，显式调用 Map 与 Batch，记录文件、证据、错误与未知行号；不调用模型 |
| [analyze-misses.mjs](./analyze-misses.mjs) | 校验原题和冻结语料，离线重读原结果，分析片段位置与读取窗口的关系；不重新搜索、不调用模型 |
| [retrieval.mjs](./retrieval.mjs) | 启动 `rg`、读取证据窗口、核验证据、评分及汇总 |
| [__test__/](./__test__/README.md) | 本目录的行为测试 |

运行前需要 Node.js 24 及可从 PATH 调用的 `rg`。本脚本不会安装或启动 Xerj，也不会上传仓库。正常插件组使用已配置、已建立索引的本地服务。`--root` 指向被索引的实际语料目录，必须精确匹配插件配置中的项目根目录。

在 `vykor-plugins` 仓库根目录运行，例如：

```powershell
node plugins/xerj-search/evaluation/evaluate.mjs `
  --root C:/path/to/corpus `
  --config-dir C:/path/to/plugin-data `
  --source-root D:/code/personal-project/OpenHarness-ts `
  --output plugins/xerj-search/evaluation/results/retrieval.json `
  --runs 3
```

`--config-dir` 是含 `xerj.json` 的插件数据目录，不是配置文件路径。配置格式由插件负责；一个可用示例：

```json
{
  "enabled": true,
  "binary": "C:/path/to/xerj.exe",
  "codeHome": "C:/path/to/native-code-home",
  "url": "http://127.0.0.1:19271",
  "projects": [{"root": "C:/path/to/corpus", "prefix": "eval", "corpus": "current"}],
  "timeoutMs": 1500
}
```

`--source-root` 可选，用于语料副本另有来源仓库时记录真实 Git 提交与是否存在本地修改。脚本不会把临时目录的父仓库提交误写为语料提交。`--output` 必须放在本评测目录内；脚本同时生成同名 `.md`。每次会覆盖指定结果，保留历史时换一个输出文件名。

## 题目是如何固定的

题集来自 OpenHarness-ts 提交 `2ae6a425d72b70bc6229ac77c96ff350e7f91c3e` 的实际工作区。先人工阅读实现与目录说明，确定查询和相关文件，再运行两组检索；没有根据输出选题或删掉难题。四类各 4 题：确切符号、英文功能描述、中文需求、文档定位，共 18 个人工证据锚点。

每个答案记录相对路径、行号、该行必须包含的文字以及相关理由。开始与结束时重新读取这些文件核验锚点，并记录文件 SHA-256；证据失效或评测中发生变化时，脚本拒绝生成混合状态结论。仓库更新后应先人工复核并另建题集版本，不能按某种方法的检索结果补答案。当前相关文件清单是人工核验的答案集合，未声称穷尽所有可能相关的文件。

插件根 `.gitattributes` 对题集和原始结果关闭 Git 换行转换，保留记录所引用的原始字节摘要，避免 Windows 与 Linux 检出时改变证据文件的 SHA-256。

基线正则也预先写在题集中，由人工为每道题挑选 1–2 个关键词或模式。这让词面检索获得人工帮助，不能代表模型自主构造搜索词的水平；报告必须保留这项说明。

## 固定预算与处理过程

两种方法每题最多 2 次检索操作，合计至多 5 秒，保留检索输出至多 32KiB。基线执行最多 2 次真正的 `rg --json`，插件调用一次 `searchRepository`，需要降级时再执行一次 `rg`。生产插件自身还有 8KiB 回包限制；共同上限不代表两组实际返回一样多的文字。

基线依次执行预写模式，先命中较早模式的文件排前；同一模式收集完后按命中行数降序，再按路径排序。原生插件使用 `limit=5`，保留上游不同位置的命中；评分层再按前5个不同文件处理。`rg` 使用参数数组和 `shell: false` 启动，模式始终是参数，不拼接 shell 命令；两组扫描的语料应保持相同。

0.2重测的基线协议为 `rg-parallel-no-config-v2`：移除旧脚本额外的 `--sort path`，以接近宿主Grep的默认并行搜索，随后仍执行上述确定性排序；增加 `--no-config` 避免外部rg配置干扰。保留题集、正则、5秒和字节预算。旧排序协议在本机出现大量超时和回退演练失败，原始无效结果保存在 `results/retrieval-native.json`，修正后的独立重测保存在 `results/retrieval-native-parallel.json`。不能把两种协议的耗时变化全归于插件升级。

随后两组都实际读取前 5 个不同文件，每个文件读取前后 12 行，最多 4KiB。0.2.1 优先使用已核验片段范围内的 `readLine` 中点提示，没有提示时沿用命中行；没有任何行号时从文件开头读取。旧版结果仍属于其原先的命中首行协议。拒绝路径回溯和目录链接跳出语料，跳过二进制及大于 512KiB 的文件。`searchBytes` 记录保留的检索回包，`readBytes` 记录这些后续正文；插件回包已经包含的正文若再次读取，仍分别计数，不假设模型会自动去重。

“文件命中”表示前 5 个不同文件里至少有一个人工答案；“证据命中”进一步要求实际读取窗口在事先标记的那一行包含人工确认的文字。文件召回率的分母是本题人工标记的不同文件数。它们只是检索级指标，不代表模型理解或任务完成。

报告保留逐题命中、正文窗口、耗时、回包与读取字节、截断和错误。汇总包含中位数与 P95 延迟、分类命中和平均字节。检索耗时包含插件调用或 `rg` 子进程启动，正文读取另行计时；重复运行在两组间交替先后顺序，仍可能受到文件和索引缓存影响，未声称是严格冷启动测试。两种 JSON 回包的格式开销不同，比较字节时必须同时查看命中率与截断情况。

## 原生重测结果与补充实验

当前 [0.2.1 修复重测](REPORT-021.md) 只修格式、定位和读取提示，复用原索引，不改查询和预算。主结果为 `results/retrieval-native-021.json`，读取协议为 `verified-readLine-v1`；另有固定原生回包的新旧代码对照及默认短超时的批量失败记录。没有新增模型 API 调用。

0.2 的结论见 [原生检索重测报告](REPORT-NATIVE.md)。主检索数据是 `results/retrieval-native-parallel.json`；真实模型数据使用修正权限后的 `results/agent-ab-native-corrected.json`。无效初次结果及重跑原因均保留，见 [结果清单](results/README.md)。

后续 [逐题漏检分析](MISSES-NATIVE.md) 将五道文件漏检与六道读取证据失败分开，确认原生回包已有的证据被固定首行读取口径漏算，并记录适配、语言和配置问题。离线中点读取控制不更改旧成绩，也没有新增模型收益测量。

`batch.mjs` 沿用本目录题集与评分，将原顺序每四题分组，先执行一次 Map，再执行四次 Batch。预算为每题五条、原生共享 2,000 词预算、插件 16 KiB；超时取显式配置。输出必须是本目录内的新文件，不覆盖已有结果，运行前后核验证据文件。示例：

```powershell
node evaluation/batch.mjs --root C:/path/to/corpus --config-dir C:/path/to/plugin-data --output evaluation/results/new-batch.json
```

本轮最终批量控制使用 5 秒配置，主检索和模型仍使用 1.5 秒配置。共享预算可能只留下文件位置，未知行号按原评分从文件开头读取，不假装命中证据。批量控制是无模型的单次查询，不能将其耗时或调用数变化换算成模型 Token 收益。

## 降级如何验证

每次评测额外创建临时 `enabled: false` 配置，调用真实生产插件，取它返回的 `fallback.input.pattern`，交给真实 `rg` 子进程执行，再读取人工答案的源码。报告记录这条完整路径；演练没有读到证据时结果不通过。这里验证的是插件提示到本地 `rg` 的可执行性，不能声称已经通过 Vykor 宿主调用内置 `Grep` 工具。宿主注册与实际调用由宿主集成验收覆盖。

全部正常查询都降级时，报告的 `xerjEvidence` 为 `none-all-plugin-calls-fell-back-or-failed`，这次运行不能用于证明 Xerj 的效果。没有可用服务时仍可验证基线和降级；应如实保留这个结论。

## 检查与新增代码

```powershell
node --test plugins/xerj-search/evaluation/__test__/*.test.mjs
```

评测状态只存在本次运行和输出 JSON 中；生产配置和索引由插件及服务管理。新增检索执行或评分逻辑放在 `retrieval.mjs`，命令行与报告逻辑放在 `evaluate.mjs`，相应测试放在同层 `__test__/`。本目录不修改生产插件、插件清单或市场根配置。
