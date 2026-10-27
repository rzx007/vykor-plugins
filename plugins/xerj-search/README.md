# XERJ 原生代码与资料检索

`dev.vykor.xerj-search@0.2.1` 复用 XERJ 的原生 MCP 工具，限定当前项目，支持关闭，保留宿主 Grep 和 Read。配置缺失时不启用检索；插件不自动安装、启动或更新 XERJ，也不创建索引、写记忆或发送反馈。

| 插件工具 | 复用的原生能力 |
| --- | --- |
| `XerjSearch` | 符号名使用 `xerj_def`，描述性问题使用 `xerj_code_search` |
| `XerjDefinition` | 显式 `xerj_def`，接受符号或能力描述 |
| `XerjMap` | `xerj_map`，查看项目索引的字段、类型和覆盖情况 |
| `XerjBatchSearch` | `xerj_batch_search`，按原输入位置保留命中、无结果及错误 |

排序、定义选择、匹配窗口与弱匹配判断由 XERJ 完成。插件核验返回路径及片段属于当前项目文件，保留不同定义和窗口；原生行号能消歧时保留对应位置，无法定位到唯一位置时明确返回 `line:null`，随后用 Grep/Read 核对。

0.2.1 修复格式说明被当成源码的问题，分别处理匹配行和定义起点，并新增已核验片段中点 `readLine`。它只提示首次补读的位置：`offset=max(1,readLine-12)`、`limit=25`；引用仍用真实片段行号，未知行号先 Grep。片段足够时无需再次 Read，插件不会自动调用宿主 Read。

新版测量见 [0.2.1 修复重测报告](evaluation/REPORT-021.md)。[0.2 原生接入报告](evaluation/REPORT-NATIVE.md)及 [0.1 基础适配器报告](evaluation/REPORT.md)与原始数据保留；旧自写 multi_match 结果不能作为完整 XERJ 的收益结论。

## 目录、流程与状态

- [tools](tools/README.md)：可信配置、原生 MCP 调用、项目范围及证据核验。
- [skills](skills/README.md)：四种工具的选择和 Grep 回退。
- [scripts](scripts/README.md)：构建、显式语料绑定、真实模型对比。
- [__test__](__test__/README.md)：进程、范围、取消、预算和真实宿主测试。
- [evaluation](evaluation/README.md)：固定题目、原始结果和指标定义。

入口从宿主当前 `cwd` 出发，选择操作者绑定的项目，再启动短期 `xerj mcp` 进程调用指定只读工具；结果经范围和字节限额检查后返回。每次调用结束或取消都会停止该进程。常驻 XERJ 搜索服务及索引由操作者管理；原始文件始终是正式数据。

插件只允许四个上游检索工具，不向模型转发 MCP 的初始化说明或整套工具列表。原生全文片段仍作为外部资料处理。首版返回可本地核对的代码与文本资料；PDF/Office 和神经网络语义模式未作为本轮验收范围。

## 配置与语料绑定

需要 Node >=24 和已校验的 XERJ 可执行文件。本轮使用 v1.0.0-rc.99；不同版本按实际 `tools/list` 检查能力。服务仅在本机监听，数据目录放在待索引目录之外，并禁用反馈。

在宿主分配的 `~/.vykor/plugins/data/dev.vykor.xerj-search/xerj.json` 配置：

```json
{
  "enabled": true,
  "binary": "D:/tools/xerj/xerj.exe",
  "codeHome": "D:/data/xerj-native-code",
  "url": "http://127.0.0.1:9200",
  "timeoutMs": 1500,
  "projects": [{ "root": "D:/code/my-project", "prefix": "my-project", "corpus": "current" }]
}
```

`binary` 与 `codeHome` 都使用当前执行机器的绝对路径，后者对应 XERJ 的 `XERJ_CODE_HOME`。模型不能覆盖程序、参数、地址、索引、corpus 或根目录。`cwd` 必须与配置根目录的实际路径精确匹配，子目录不自动继承权限；每个 worktree 独立绑定。

code search 需要 `codeHome/state/<corpus>.json`。如果使用官方 `xerj corpus add/index`，填写真实 corpus 名称，并将项目 `prefix` 设为该 ledger 的 `index_prefix`（旧 ledger 为 `prefix`），不带通配符；插件核对 ledger 与配置的 URL、前缀一致。

已有 `xerj autoindex` 索引时，可用一次显式管理命令导入成功的 `--json` 输出，不必重建索引：

```sh
node scripts/bind-autoindex.mjs --config /absolute/plugin-data/xerj.json --receipt /absolute/successful-autoindex.json
```

命令检查 receipt 的项目、URL、前缀与完整计数，保留原始索引时间，将其绑定为原生 code search 可读取的 corpus ledger；不更新索引、不刷新旧时间、不覆盖已有 ledger。只导入成功结束的输出；运行失败或中断时不要使用中间日志。此管理脚本不会被注册为模型工具。

服务与索引的启动、增量更新仍按 [XERJ 官方说明](https://github.com/xerj-org/xerj)进行。切换分支后更新索引；native code search 的过期拒绝保持启用。仅接受 HTTP `127.0.0.1` 地址。认证可增加 `"authFile":"D:/data/xerj/admin.key"`；凭据仅用于子进程环境，不进入模型输入或输出。

## 关闭与回退

把配置 `enabled` 改成 `false`，下一次调用就停止原生检索；也可在插件页禁用或从会话取消选择。当前权限策略可能在计划模式或禁网环境阻止工具，助手仍可继续使用 Grep/Read。

原生弱匹配、无可用证据、配置缺失、服务失败或超时返回明确的 Grep 提示，不重复尝试失败服务。批量结果按输入 `position` 单独回退；长查询使回退参数超出预算时，返回 `queryPosition` 引用原输入，不截断搜索条件后冒充完整条件。主动取消会直接中止，不启动回退操作。

普通响应至多 8 KiB，批量至多 16 KiB，原生进程 stdout 至多 1 MiB；单文件核验读取至多 512 KiB。上游 `max_tokens` 按其词边界估算，插件再以 UTF-8 字节控制实际结果大小。

## 检查

```sh
npm ci --ignore-scripts
npm run build
npm test
```

真实宿主验证需要显式指定宿主源码与校验过的 XERJ 程序。在市场仓库根目录运行：

```powershell
node --import file:///D:/code/personal-project/OpenHarness-ts/apps/cli/node_modules/tsx/dist/loader.mjs plugins/xerj-search/__test__/host-smoke.mjs --host-root D:/code/personal-project/OpenHarness-ts --xerj-binary D:/tools/xerj/xerj.exe
```

插件未分发 XERJ 二进制，无新增 Node 第三方依赖。插件代码采用 MIT；单独安装的 XERJ 遵循其 Apache-2.0 许可。运行数据和凭据写在宿主数据目录，不改安装快照。
