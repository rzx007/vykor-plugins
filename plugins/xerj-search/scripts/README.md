# 检查与评测脚本

`build.mjs` 检查插件版本与四个只读工具入口，不下载或执行 XERJ。

`bind-autoindex.mjs --config <xerj.json> --receipt <成功的 autoindex JSON>` 显式导入已有项目索引的绑定，核对范围和完整计数，保留原时间，以独占创建方式写入 `codeHome/state`，不覆盖已有 corpus；不重建索引、不产生模型调用。用户已有官方 corpus ledger 时无需导入。

`agent-ab.mjs` 使用显式指定的 Vykor 宿主源码、本机语料和现有模型配置，比较带或不带 XERJ 的小样本任务。默认只检查准备条件；显式 `--run` 才调用模型。评测产物由 `--output` 指定，不写入用户安装记录。具体参数以脚本帮助及评测 README 为准。

运行参数为 `--host-root <宿主源码>`、`--corpus <语料目录>`、`--service-url http://127.0.0.1:<端口>`、`--prefix <索引前缀>`、`--plugin-config <已绑定原生corpus的xerj.json>`、`--output <原始报告.json>`，可选 `--tasks <题集.json>`。先不加 `--run`，固定相邻 `.selection.json` 中的题目、提示词、配置摘要与预算；再以同一参数加 `--run`。需要模型配置与服务均可用，真实调用会使用现有供应商的 API。

默认最多八个任务、每任务六次模型 HTTP、每次输出上限 1024 Token，禁用自动重试。脚本拒绝覆盖已有模型报告；`--run --resume` 仅在选择和配置一致时继续未启动任务，不重跑已有结果。原始 provider usage 与引擎 attempt 状态分别记录，本地预算阻断不当作未知模型账单。结果阅读时区分预算耗尽、输出截断、路径提及和实际定位质量。

正式代码与检查逻辑放在此目录；固定检索题、评分及无需模型的评测放在 `evaluation/`。运行环境、搜索服务、索引和凭据由操作者准备，插件不自动下载。
