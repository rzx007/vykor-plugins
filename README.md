# Vykor 插件市场

官方插件分发源，适用于 Vykor >=1.2.20。

市场地址：<https://rzx007.github.io/vykor-plugins/marketplace.json>。

## 工作方式

根目录 `marketplace.json` 是唯一的插件清单：只记录插件 ID、分类、源码仓库、固定的 40 位提交和相对目录。它不是公开下载索引。构建按固定提交检出一次上游仓库，在各插件目录执行 `npm ci --ignore-scripts`、构建、已有测试和类型检查，然后生成确定性 ZIP。仓库不保存完整插件源码。

`dist/marketplace.json` 才是公开索引。版本取自插件清单，组件种类取自 components，Node 要求取自 package.json engines。ZIP 包含与宿主示例打包器相同的插件目录树，排除依赖、Git 和用户运行数据。时间固定为 2000-01-01，文件权限固定为 0644，路径排序。

发布顺序是先核验 ZIP、创建草稿版本、上传 ZIP、发布不可变版本，再部署 Pages 索引。相同版本只允许相同 SHA-256；重试复用相同文件，不覆盖旧文件。PR 构建无密钥和写权限；只有发布任务可写 release，只有 Pages 任务可部署网站。

## 本地使用

需要 Node >=24、npm、Git。发布另需已登录 GitHub CLI。

```sh
npm ci --ignore-scripts
npm test
npm run build
npm run verify
```

构建会执行上游插件代码，请先审查所选提交。压缩大小不超过 100 MiB，解压总量不超过 250 MiB，文件数量不超过 5000。禁止链接、路径逃逸、预发布版本、缺失清单/许可证/组件入口。

公开格式与示例见 [CONTRACT.md](CONTRACT.md)。贡献流程见 [CONTRIBUTING.md](CONTRIBUTING.md)。分发工具采用 MIT；各插件附带自己的许可证。
