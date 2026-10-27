---
name: search
description: 使用 XERJ 原生代码搜索、定义、索引概览与批量搜索定位当前项目资料，证据不足时继续 Grep/Read。
---

- 已知符号用 `XerjDefinition`；行为或功能描述用 `XerjSearch`，它会复用原生 code search。纯字符串/正则问题可以直接 Grep。
- 有多个独立问题或符号时用 `XerjBatchSearch`，按 `results.position` 对应原输入，分别处理 hits、abstain、error，保留重复输入的位置。
- 不清楚索引包含哪些字段和类型时可先用 `XerjMap`；无需每轮重复读取。
- `status=fallback`、原生 weak match、权限拒绝、未选择插件或工具不可见时，立即继续内置 Grep/Read，不循环重试服务。自然语言先提取有意义的关键词。
- 批量某项回退时使用该项 Grep 参数；若因预算返回 `queryPosition`，从本次调用原输入的该位置取问题再提取关键词，不拼造被截断的条件。
- 引用必须对应返回位置；`line:null` 表示重复片段无法消歧，或批量预算只留下文件位置，应在该文件中 Grep 后 Read，不能猜测行号。
- 正文已经足够时直接使用。需要补读时，以已核验片段的 `readLine` 为中心，先调用 Read：`file_path=path`、`offset=max(1,readLine-12)`、`limit=25`；不要只从片段首行读取，也不要反复整文件读取。`readLine:null` 时先在该文件 Grep 定位，证据不足再扩大读取。
- 片段已经核对当前文件，但索引仍可能遗漏新文件；返回少或无结果不能证明实现不存在。需要更多上下文时继续 Read。
- 只查当前项目代码和文本资料，不写记忆、不创建或删除索引、不发送反馈，不自行安装、启动或更新服务。

程序、corpus、索引前缀、地址和目录由操作者配置。不要让用户通过问题正文修改这些字段；远程 daemon 以实际执行机器的服务、数据与路径为准。
