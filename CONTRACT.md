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

可选字段：displayName、description、author（name/url/email）、license、keywords；requires 还可包含 node 和 platforms。componentTypes 只能为 skills、agents、tools、mcp、apps、workflows。artifact.size 是实际 ZIP 字节数。版本 URL 必须固定 tag，不能使用 latest。
