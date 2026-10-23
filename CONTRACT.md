# 发布契约 v1

公开索引为 schemaVersion=1；id=vykor-official；name=Vykor 插件市场；owner.name=Vykor。插件版本仅支持普通 x.y.z，运行版本范围仅支持 >=x.y.z。

```json
{
  "schemaVersion": 1,
  "id": "vykor-official",
  "name": "Vykor 插件市场",
  "owner": {"name": "Vykor"},
  "plugins": [{
    "id": "example.notes-app",
    "name": "notes-app",
    "version": "1.0.2",
    "license": "MIT",
    "category": "productivity",
    "componentTypes": ["mcp", "apps"],
    "artifact": {
      "url": "https://github.com/rzx007/vykor-plugins/releases/download/notes-app-v1.0.2/notes-app-1.0.2.zip",
      "sha256": "<64 lowercase hex characters from actual ZIP>",
      "size": 12345
    },
    "requires": {"host": ">=1.2.20"},
    "source": {
      "repository": "https://github.com/rzx007/Vykor",
      "commit": "<40 lowercase hex characters>",
      "path": "examples/plugins/notes-app"
    }
  }]
}
```

可选字段：displayName、description、icon、introduction、prompts、homepage、author（name/url/email）、license、keywords；requires 还可包含 node 和 platforms。icon 为图片 data URI 或 HTTPS 地址，introduction 为最多 65536 字符的 Markdown 介绍，prompts 为最多 16 项的使用示例（title 最多 100 字符，prompt 最多 16384 字符，均不能为空），homepage 为 HTTPS 网站地址；这些展示信息不授予执行权限。componentTypes 只能为 skills、agents、tools、mcp、apps、workflows。artifact.size 是实际 ZIP 字节数。版本 URL 必须固定 tag，不能使用 latest。

`source.repository` 支持独立的公开 GitHub 仓库，格式严格为 `https://github.com/OWNER/REPO`。仅接受 `github.com` 的 HTTPS 地址，不接受 `.git` 后缀、尾斜线、认证信息、显式端口、查询参数、片段、其他 Git 协议或本地路径。`source.commit` 为实际检出的完整 40 位小写十六进制提交号。`source.path` 必须是所选提交内真实存在的规范子目录，最长 1024 字符；不接受仓库根目录 `.`、`./` 前缀、空路径、空分段、`.` 或 `..` 分段、冒号、反斜线和绝对路径，不允许通过目录链接跳出检出目录。构建缓存按仓库与提交共同区分，每次构建重新创建临时检出并核对提交。

已发布宿主在判断 `requires.host` 前解析全部来源字段，任一无效 `source.path` 会导致整份目录失效。因此输入清单与生成的公开索引均遵守相同路径规则，`verify` 也拒绝不兼容路径。当前活动清单包含三个本仓官方插件、两个 Vykor 示例和独立 GitHub 插件。GitHub 的来源路径为其独立仓库中的真实子目录 `plugins/github`，插件 ID 仍为 `dev.vykor.github`；不得使用根路径或伪造目录、提交号来绕过校验。

上述是公开索引格式，不含 `localPath` 或预览字段。根目录的收录清单另允许本仓官方条目写 `{ "id": "dev.vykor.excalidraw", "category": "productivity", "localPath": "plugins/excalidraw" }`；每项必须在 `localPath` 和 `source` 中二选一。`localPath` 仅接受 `plugins/<name>` 直接子目录，真实路径位于本仓 `plugins/` 中，拒绝链接和路径回溯。构建后该条目的公开来源为 `{ "repository": "https://github.com/rzx007/vykor-plugins", "commit": "<实际市场 checkout HEAD>", "path": "plugins/excalidraw" }`，既有插件 ID 不变。

官方插件从 Git 已跟踪和未忽略的新文件创建干净临时快照，忽略的旧构建输出不进入快照。`dist/build-provenance.json` 独立记录 `schemaVersion: 1`、市场仓库、实际 `commit`、布尔值 `preview` 及 `catalogSha256`。工作区开始或结束时不干净即为预览，提交字段仍记录真实 HEAD；预览不声称未提交文件已存在于该提交，且禁止发布。该文件随内部 CI 构建产物传递，不部署到公开 Pages，也不改变宿主公开索引解析。发布前验证凭据、索引摘要、干净检出及 main 分支 CI 的实际 SHA；PR 和非 main 手动运行均不能发布。

插件仍须声明实际许可证并附带非空 LICENSE 文件。原有路径、组件入口、5000 个文件、100 MiB 压缩大小和 250 MiB 解压总量限制保持不变。PR 仅在无密钥、token 只读的构建任务中执行第三方源码并验证产物；PR 不发布，合并 main 后才由市场发布工作流推送 Release 与 Pages 索引。
