# 正式插件源码

这里存放由插件市场单独分发的正式插件。桌面应用不再附带这些插件的归档，也不提供专门的内置安装入口；用户在“插件 → 浏览市场”选择安装。已有安装、授权和插件数据继续保留。

| 目录 | 用途 | 构建入口 |
| --- | --- | --- |
| [excalidraw](./excalidraw/README.md) | 对话侧栏画板、自动保存、引用选区和导出 | `npm run build` |
| [knowledge-work](./knowledge-work/README.md) | 研究、资料整理和写作 | `npm run build` |
| [office-work](./office-work/README.md) | Word、Excel、PPT 文档操作 | `npm run build` |

每个插件有独立清单、许可证、依赖锁和检查命令。新增本仓官方插件放在这里，并在根 `marketplace.json` 写 `localPath: "plugins/<name>"`；插件 ID 保持稳定。教学示例和工程模板继续在 Vykor 主仓库维护，市场示例条目通过外部固定提交收录。插件后端、界面、Skill 和测试随对应插件维护，不放入桌面宿主代码。

## 发布与状态

源码和分发工具均在本仓 [rzx007/vykor-plugins](https://github.com/rzx007/vykor-plugins) 维护。构建把 Git 已跟踪及未忽略的新文件复制到干净临时目录，执行插件构建与检查，再生成归档；忽略的旧 `dist`、依赖和下载缓存不进入快照。公开索引自动记录本仓地址、实际市场 checkout HEAD 和插件路径，不在收录清单预填尚未产生的提交号。

工作区存在未提交改动时，产物由 `dist/build-provenance.json` 标为 PREVIEW，可以本地验证但不能发布。main 分支 CI 核对实际提交和构建凭据后，先发布不可变 Release，再更新市场索引。第三方插件仍可在独立仓库维护并固定提交收录，详见根 [贡献流程](../CONTRIBUTING.md)。

安装仍经过原有权限确认和安装回执。工具权限、操作回执及应用草稿规则不随源码目录或分发方式改变；已有本地安装可从市场明确关联来源后更新，不自动替换。插件运行数据仍属于宿主分配的数据目录，不写回这里。
