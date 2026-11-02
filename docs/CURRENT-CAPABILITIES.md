# 当前能力与验证入口

此表依据当前 0.6.0实现整理；0.5.0 的既有读取与发布能力保留。默认只读预览，新增明确确认式本地 Git 分支切换这一写操作例外。它区分代码能力与验证入口，不表示候选已正式发布，也不把隔离测试等同于当前 DSH 页面验收。0.5.0 的既有验证状态见[该版记录](<releases/0.5.0.md>)，不能据此声称新分支切换已通过发布或实机验收。

| 能力 | 实现 | 验证入口 | 主要边界 |
| --- | --- | --- | --- |
| Git／SVN 工作区与属性比较 | [适配器](<../vcs.mjs>)、[宿主](<../index.mjs>) | [真实仓库回归](<../test/vcs.test.mjs>)、[选择一致性](<../test/operation-consistency.test.mjs>) | 只读；普通／大文件独立上限；变化要求刷新，不承诺原子快照 |
| 请求取消与整操作预算 | [预算](<../src/operation-budget.mjs>)、[命令](<../local-command.mjs>) | [预算测试](<../test/operation-budget.test.mjs>)、[命令测试](<../test/local-command.test.mjs>) | 默认 15 秒共享截止时间；等待进程清理，不承诺即时结束 |
| 历史、提交图、引用与 A/B | [历史页](<../src/HistoryPanel.jsx>) | [历史窗口](<../test/history-window.test.mjs>)、[浏览器聚合](<../scripts/monaco-fixture.mjs>) | 固定提交快照，有界窗口；远程跟踪引用只是本地缓存，不 fetch |
| 文件历史、Blame 与返回 | [导航位置](<../src/review-location.mjs>)、[文件分页](<../src/history-pages.mjs>) | [返回闭环](<../scripts/review-context-browser.jsx>)、[原有返回](<../scripts/history-back-navigation-browser.jsx>) | 有界导航，不自动追踪复制／合并／歧义来源 |
| 内容搜索及命中行定位 | [搜索页](<../src/GrepPanel.jsx>) | [固定快照跳转](<../scripts/search-navigation-browser.jsx>) | Git 固定提交，保留查询；不搜索任意磁盘或远端 |
| 大仓库文件与目录 | [定点读取及缓存](<../src/historical-access.mjs>)、[目录页](<../src/HistoricalTree.jsx>) | [历史读取](<../test/historical-access.test.mjs>)、[目录交互](<../scripts/history-tree-pages-browser.jsx>) | 单目录最多 10 万项／16MiB 输出；每页最多 100；旧整树 API 上限不变 |
| 大文件与结构化能力 | [预览能力](<../src/preview-capabilities.mjs>)、[前端适配](<../src/preview-actions.mjs>) | [能力测试](<../test/preview-capabilities.test.mjs>)、[完整比较](<../test/large-compare.test.mjs>) | 普通每侧 2MiB，显式完整比较每侧 8MiB，历史分段 16MiB；不承诺无限文件 |
| SVN HTTPS 历史 | [生产组合](<../src/svn-https-host.mjs>)、[运行时](<../src/svn-runtime.mjs>) | [TLS 授权链](<../test/svn-dav-chain-tls.test.mjs>) | 显式同意、系统信任、无额外认证；逐步骤授权；不复用磁盘凭据 |
| 已有本地 Git 分支切换（0.6.0） | [适配器](<https://github.com/f-e-n-g-0531/dsh-vcs/blob/main/branch-switch.mjs>)、[一次性确认](<https://github.com/f-e-n-g-0531/dsh-vcs/blob/main/branch-switch-host.mjs>) | [适配器用例](<https://github.com/f-e-n-g-0531/dsh-vcs/blob/main/test/branch-switch.test.mjs>)、[Host 用例](<https://github.com/f-e-n-g-0531/dsh-vcs/blob/main/test/branch-switch-host.test.mjs>)、[浏览器用例](<https://github.com/f-e-n-g-0531/dsh-vcs/blob/main/scripts/branch-switch-browser.jsx>)；具体结果以对应测试及同标签发布运行报告为准 | 独立预览和明确确认，约60秒一次性token；仅干净普通仓库，含ignored也拒绝；不支持filters／命令hooks、attributes、sparse／partial、特殊Index flags、链接／子模块或进行中操作；无stage／commit／stash／force／网络；写后失败可能结果未知，手动刷新核对，不盲重试 |
| 编辑器资源与性能 | [编辑器](<../src/editor.js>)、[采样工具](<../scripts/performance-baseline.mjs>) | [资源循环](<../scripts/performance-browser.jsx>)、[统计测试](<../test/performance-baseline.test.mjs>) | 环境／规模／内容一致才能比较；基线不是通用性能承诺 |
| 候选包与发布证据 | [预检](<../scripts/release-preflight.mjs>)、[发布工作流](<../.github/workflows/release.yml>) | [证据负例](<../test/release-evidence.test.mjs>)、[CLI 验证](<../test/release-preflight-cli.test.mjs>) | 同标签／SHA／run attempt；四包一致；渠道显式；缺证据阻断 |

旧计划和旧版验收保留在原文件，用于追溯历史，不应据其中“未实现”直接建立重复研发项。当前宿主支持声明和实机限制见[兼容性](<COMPATIBILITY.md>)及[实机记录](<LIVE-ACCEPTANCE.md>)。
