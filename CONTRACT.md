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

`source.repository` 支持独立的公开 GitHub 仓库，格式严格为 `https://github.com/OWNER/REPO`。仅接受 `github.com` 的 HTTPS 地址，不接受 `.git` 后缀、尾斜线、认证信息、显式端口、查询参数、片段、其他 Git 协议或本地路径。`source.commit` 为实际检出的完整 40 位小写十六进制提交号。`source.path` 是仓库内真实存在的目录，`.` 表示仓库根目录；不允许路径回溯或通过目录链接跳出检出目录。构建缓存按仓库与提交共同区分，每次构建重新创建临时检出并核对提交。

插件仍须声明实际许可证并附带非空 LICENSE 文件。原有路径、组件入口、5000 个文件、100 MiB 压缩大小和 250 MiB 解压总量限制保持不变。PR 仅在无密钥、token 只读的构建任务中执行第三方源码并验证产物；PR 不发布，合并 main 后才由市场发布工作流推送 Release 与 Pages 索引。
