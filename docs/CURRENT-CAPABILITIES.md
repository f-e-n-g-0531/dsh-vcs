# 当前能力与验证入口

本表区分页面可用功能与保留的底层实现，并提供代码和测试入口。版本变化看[变更记录](<../CHANGELOG.md>)，实际页面验证看[实机记录](<LIVE-ACCEPTANCE.md>)。

| 能力 | 实现 | 验证入口 | 主要边界 |
| --- | --- | --- | --- |
| Git／SVN 工作区与属性比较 | [适配器](<../vcs.mjs>)、[宿主](<../index.mjs>) | [真实仓库回归](<../test/vcs.test.mjs>)、[选择一致性](<../test/operation-consistency.test.mjs>) | 只读；普通／大文件独立上限；变化要求刷新，不承诺原子快照 |
| 请求取消与整操作预算 | [预算](<../src/operation-budget.mjs>)、[命令](<../local-command.mjs>) | [预算测试](<../test/operation-budget.test.mjs>)、[命令测试](<../test/local-command.test.mjs>) | 默认 15 秒共享截止时间；等待进程清理，不承诺即时结束 |
| 历史、提交图、引用与 A/B | [历史页](<../src/HistoryPanel.jsx>) | [历史窗口](<../test/history-window.test.mjs>)、[浏览器聚合](<../scripts/monaco-fixture.mjs>) | 固定提交快照，有界窗口；远程跟踪引用只是本地缓存，不 fetch |
| 文件历史、Blame 与返回 | [导航位置](<../src/review-location.mjs>)、[文件分页](<../src/history-pages.mjs>) | [返回闭环](<../scripts/review-context-browser.jsx>)、[原有返回](<../scripts/history-back-navigation-browser.jsx>) | 有界导航，不自动追踪复制／合并／歧义来源 |
| 内容搜索及命中行定位 | [搜索页](<../src/GrepPanel.jsx>)、[分页](<../src/content-search.mjs>) | [固定快照跳转](<../scripts/search-navigation-browser.jsx>) | 固定查询开始时的 HEAD；每页最多 100 条／1 MiB 结果，扫描最多 64 个文件／16 MiB；超过 16 MiB 的文件跳过并提示，不含二进制或未提交改动；空页可能还有下一页 |
| 大仓库文件与目录 | [定点读取及缓存](<../src/historical-access.mjs>)、[目录页](<../src/HistoricalTree.jsx>) | [历史读取](<../test/historical-access.test.mjs>)、[目录交互](<../scripts/history-tree-pages-browser.jsx>) | 单目录最多 10 万项／16MiB 输出；每页最多 100；旧整树 API 上限不变 |
| 大文件与结构化能力 | [预览能力](<../src/preview-capabilities.mjs>)、[前端适配](<../src/preview-actions.mjs>) | [能力测试](<../test/preview-capabilities.test.mjs>)、[完整比较](<../test/large-compare.test.mjs>) | 普通每侧 2MiB，显式完整比较每侧 8MiB，历史分段 16MiB；不承诺无限文件 |
| SVN HTTPS 历史 | [生产组合](<../src/svn-https-host.mjs>)、[运行时](<../src/svn-runtime.mjs>) | [TLS 授权链](<../test/svn-dav-chain-tls.test.mjs>) | 需明示同意、系统信任、逐步授权；支持匿名 HTTPS、宿主配置的 Basic，以及 Windows 上符合条件的 TortoiseSVN 登录状态，见[使用指南](<SVN-RUNTIME-SCOPE.md>) |
| 工作区分支切换／插件内更新 | 当前开发源码已移除 UI 与公开 RPC | [移除断言](<../test/updates.test.mjs>) | 历史引用导航仍只读；外部 Git 客户端及 DSH 插件管理器管理相应操作 |
| 编辑器资源与性能 | [编辑器](<../src/editor.js>)、[采样工具](<../scripts/performance-baseline.mjs>) | [资源循环](<../scripts/performance-browser.jsx>)、[统计测试](<../test/performance-baseline.test.mjs>) | 环境／规模／内容一致才能比较；基线不是通用性能承诺 |
| 图片并排／overlay／swipe | [叠加范围](<IMAGE-OVERLAY-SCOPE.md>)、[图片组件](<../src/ImageComparison.jsx>) | [浏览器回归](<../scripts/image-ui-browser.jsx>) | 原始像素左上对齐、共同缩放，不拉伸等宽；Fit／实际大小／25–200%；PNG／JPEG／静态 WebP 限制不变，不写像素 |
| HEAD Reflog 与 Stash | [Reflog 模型](<../src/reflog.mjs>)、[Stash 面板](<../src/StashPanel.jsx>) | [Reflog 测试](<../test/reflog.test.mjs>) | 最近 200 项 HEAD 移动记录与固定提交详情；可查看已有 Stash 和差异，不创建、恢复、应用、弹出或删除 |

### 保留的底层操作实现

当前页面不提供下表所列操作的入口，但保留底层实现与协议。独立组件通过测试不代表正式页面开放相应操作。

| 能力 | 实现与验证入口 | 主要边界 |
| --- | --- | --- |
| 整文件暂存／取消暂存 | [stage](<STAGE-USER-INTEGRATION.md>)、[unstage](<UNSTAGE-INTEGRATION-RESULTS.md>)；[界面接入](<../src/client.jsx>) | 既有普通修改文件，整文件拒绝选中 MM／增删改名／冲突；只更新选中文件 Index，不写工作文件；stage 绑定捕获字节 |
| 完整变更块暂存／恢复块取消暂存 | [stage](<PARTIAL-STAGE-USER.md>)、[unstage](<PARTIAL-UNSTAGE-USER.md>) | 受限 MM；精确 UTF-8 模型，每端 256KiB／4000 行／20 万 LCS 格；不近似写入、不丢弃工作修改 |
| 块内逐行 stage／unstage | [逐行模型与界面](<LINE-SELECTION-USER.md>) | 每条删除／插入独立，不自动配对；输入及候选 256KiB／4000 行，最多 8000 操作；拒绝合并物理行边界的组合，不补换行 |
| commit、最近消息读取／复用 | [提交范围](<COMMIT-USER-SCOPE.md>)、[消息复用策略](<RECENT-MESSAGE-REUSE-POLICY.md>) | 完整 Index、显式身份与消息；仅已出生 loose 本地分支及既有 reflog 等严格子集；不自动 stage／push，复用不等于 amend |
| amend 当前提交 | [amend 范围](<AMEND-USER-SCOPE.md>) | 独立历史替换确认；保留原 author 与有序 parents，可 same-tree 改消息；不自动 stage／push／force |
| 当前 HEAD 创建分支 | [创建范围](<BRANCH-CREATE-USER-SCOPE.md>) | 固定当前 HEAD、安全短名；不覆盖、不自动 checkout，不接受任意起点 |
| 当前 HEAD 创建 annotated／lightweight tag | [附注标签](<TAG-CREATE-USER-SCOPE.md>)、[轻量标签](<LIGHTWEIGHT-TAG-USER-SCOPE.md>) | 独立表单与令牌；annotated 显式 tagger／消息，lightweight 直接指向 commit；不覆盖、不签名、不 push／checkout |
| 分支删除只读评估 | [评估界面](<BRANCH-DELETE-ASSESSMENT-UI.md>) | 查看 tip 与已合并证明；无删除确认入口或授权，不执行删除；未合并／不完整历史／超限拒绝 |

写操作保留严格仓库／配置／路径校验：特殊 Index、attributes／filters／hooks、签名、packed refs、linked／shared worktree 等按各入口范围保守拒绝，不宣称通用 Git 兼容。计划与预览只读，确认后可追加对象；取消／失败可能残留不可达对象或写入已生效，不自动重试、删除对象或 GC 回滚。共享 pending／unknown 门禁不是外部 Git 进程的全局锁；结果未知先显式刷新并核对 HEAD、refs、Index 和工作文件。

不提供远端 fetch／pull／push、合并、变基、冲突解决或实际分支删除。历史设计差距与阶段性证据见[对齐清单](<FORK-PARITY.md>)和[增量记录](<FORK-PARITY-VERIFICATION.md>)。

旧计划和旧版验收保留在原文件，用于追溯历史，不应据其中“未实现”直接建立重复研发项。当前宿主支持声明和实机限制见[兼容性](<COMPATIBILITY.md>)及[实机记录](<LIVE-ACCEPTANCE.md>)。
