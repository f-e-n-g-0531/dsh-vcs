# DSH VCS

在 DeepSeek Harness（DSH）Web 中查看 Git / SVN 文件变更和提交历史，**默认只读预览**。

你可以查看工作区差异、浏览提交历史、追溯文件来源。插件不切换工作区分支，不执行暂存、提交或远端同步。

正式版本以 [GitHub Releases](https://github.com/f-e-n-g-0531/dsh-vcs/releases/latest) 和 npm 为准。

- npm 包：`@feng0531/dsh-vcs` · [下载正式版](https://github.com/f-e-n-g-0531/dsh-vcs/releases/latest) · [更新记录](https://github.com/f-e-n-g-0531/dsh-vcs/blob/main/CHANGELOG.md)
- 当前源码自 0.8.5 起采用 [MIT License](<LICENSE>)，允许商业使用、修改和分发，须保留版权及许可声明；第三方材料仍适用各自许可证。已发布旧版本的许可条款以对应发行包为准。

## 能做什么

| 场景 | 功能 |
| --- | --- |
| 查看工作区变更 | Git 全部变更；SVN 本地基线与工作副本、属性差异 |
| 阅读代码差异 | 默认 Monaco 只读 Diff，支持并排／行内、换行、忽略行尾空白、上一处／下一处差异 |
| 浏览 Git 历史 | 查看提交图、详情与目录；从「内容搜索 → 提交历史」按说明、作者、路径和提交者日期筛选 |
| 比较历史版本 | 比较提交与选定的父提交，或在「版本比较」页签选择两个本地提交 |
| 追溯代码来源 | 查看文件历史、跟随唯一的重命名来源；按行查看最后改动对应的提交（Blame） |
| 搜索文件正文 | 从「内容搜索 → 文件正文」搜索查询开始时的 HEAD，不含未提交改动；点击结果跳到命中行 |
| 查看图片和大文件 | 静态图片可并排、叠加或滑动比较；较大的历史 UTF-8 文件可分段阅读 |
| 查看历史辅助记录 | 只读查看最近 200 条 HEAD 移动记录（Reflog），以及已有的 Git 暂存快照（Stash）及其差异；不恢复或应用 |
| 浏览 SVN 历史 | 明确同意连接后，查看 HTTPS 仓库日志、修订差异和文件历史 |

提供中英文界面。编辑器加载失败时会显示基础文本比较；它不是完整的 Monaco 替代品。

## 安装

先核对 [DSH 与 Node.js 兼容列表](https://github.com/f-e-n-g-0531/dsh-vcs/blob/main/docs/COMPATIBILITY.md)，并确认宿主能通过 PATH 找到 Git 或 SVN（只使用 Git 时不需要 SVN）。

使用 npm 安装正式版：

```sh
dsh plugin --profile web add "@feng0531/dsh-vcs@latest"
```

`web` 是示例 profile（DSH 的配置和插件环境，不是 Session）。请换成运行中的 DSH 所用的 profile；命令依赖 `pnpm`。安装会修改该 profile，升级前请备份配置。

安装后自行重启 DSH，再刷新原来的 Web 页面。也可从 [GitHub 正式发布页](https://github.com/f-e-n-g-0531/dsh-vcs/releases/latest) 下载并校验安装包；具体步骤、升级和回滚见[安装指南](https://github.com/f-e-n-g-0531/dsh-vcs/blob/main/docs/INSTALL.md)。

## 开始使用

1. 在 DSH 中选择一个 Session，确认它的工作目录在项目内。
2. 打开 VCS 页面，发现仓库，再从顶部下拉框选择仓库。
3. 点击文件查看差异，或进入历史视图浏览提交。
4. 外部工具修改项目后，点击「刷新」重新发现仓库并更新变更。可见窗口重新获得焦点时也会刷新，没有定时轮询。

默认发现当前目录、一级子目录以及包含当前目录的上级仓库，不递归深入。更深的独立项目应使用工作目录指向该项目的 Session。

**注意：Session 位于仓库子目录时，发现后的查看范围可以覆盖整个仓库。**

### 左右两侧比较的是什么

| 模式 | 左侧 | 右侧 |
| --- | --- | --- |
| Git 全部 | 最近提交（HEAD） | 当前工作区 |
| SVN 本地变更 | 本地基线（BASE） | 当前工作副本 |

新增文件可能使用空白左侧。冲突文件只供查看，不提供三方合并或冲突解决。

### 历史引用与工作区分支

历史页选择分支、标签或远程跟踪引用只改变阅读起点，不切换工作区或连接远端。要切换分支，请在外部 Git 客户端完成后刷新仓库。

### SVN 远程历史需要单独同意

本地 SVN 比较不联网。打开远程历史前，须审阅服务器和路径并明确同意；授权约 5 分钟后过期。历史读取以本地工作副本修订为上界，不自动获取服务器最新修订。支持匿名 HTTPS 和显式授权的 HTTPS Basic；Windows 宿主也可按条件使用 TortoiseSVN 登录状态。配置、复制来源查看与 401 排查见 [SVN 远程历史指南](https://github.com/f-e-n-g-0531/dsh-vcs/blob/main/docs/SVN-RUNTIME-SCOPE.md)。

## 使用限制

- 普通文本比较每侧最多 **2 MiB**。Git 超限时可手动加载完整文本，每侧最多 **8 MiB、10 万行**；SVN 不支持完整大文件比较。较大的历史 UTF-8 文件可[分段阅读](https://github.com/f-e-n-g-0531/dsh-vcs/blob/main/docs/LARGE-FILE-SCOPE.md)，最多 **16 MiB**，不等同于完整差异比较。
- 图片支持 PNG、基线／渐进 JPEG 和简单静态 WebP，不支持动画。文本支持 UTF-8、GBK 和带 BOM 的 UTF-16，具体支持范围随查看模式而异。
- Git 冲突可按阶段查看内容，不能合并或解决冲突；子模块只显示提交指针和状态，不打开子模块文件。搜索、历史、重命名追溯等有容量或范围限制，详见[能力清单](https://github.com/f-e-n-g-0531/dsh-vcs/blob/main/docs/CURRENT-CAPABILITIES.md)。

## 常见问题

- **找不到仓库**：确认 Session 工作目录和宿主 PATH 中的 Git／SVN；对于更深的独立项目，将 Session 工作目录指向项目后再发现。
- **提示重新发现**：目录改变或授权过期后，点击「刷新」。
- **高级编辑器加载失败**：确认安装了完整的正式包，重启 DSH 后刷新原页面；仍失败时可使用基础文本比较。
- **SVN 历史连接失败**：确认服务器使用受信任的 HTTPS；认证失败请按 [SVN 指南](https://github.com/f-e-n-g-0531/dsh-vcs/blob/main/docs/SVN-RUNTIME-SCOPE.md#https-basic-认证)检查使用的登录方式。

## 开发与更多资料

[文档导航](https://github.com/f-e-n-g-0531/dsh-vcs/blob/main/docs/README.md) · [贡献指南](https://github.com/f-e-n-g-0531/dsh-vcs/blob/main/CONTRIBUTING.md) · [安全说明](https://github.com/f-e-n-g-0531/dsh-vcs/blob/main/SECURITY.md) · [维护者发布流程](https://github.com/f-e-n-g-0531/dsh-vcs/blob/main/docs/RELEASING.md)

界面设计参考 [Fork](https://fork.dev/)，不代表与 Fork 官方有关联或获得背书。
