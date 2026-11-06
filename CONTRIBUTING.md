# 贡献指南

本项目为DSH Web提供默认只读Git／SVN审阅，以及需显式确认的受限本地Git写入口：已有分支切换、整文件／完整块／逐行暂存与取消暂存、commit／amend、从当前HEAD创建分支和两类标签。分支删除仅只读评估。0.8.0为计划发布，源码接入不代表发布门禁或日常GUI验收通过。提交改动前，请阅读[许可证](<LICENSE>)：贡献者保留版权，须拥有提交内容的权利并同意按本项目非商业许可证授权；不会自动授予额外商业再许可权。

## 准备开发环境

需要 Node.js 22+、Git、SVN、svnadmin 和 OpenSSL。先运行 `npm run test:preflight` 确认实际工具版本；OpenSSL 可通过 `OPENSSL_BIN` 指定现有可执行文件，不会自动安装工具。在项目根目录执行：

```sh
npm ci --include=dev
npm run check
npm run verify:package
npm run test:install
```

- `check`：构建并运行自动测试。
- `verify:package`：检查安装包文件是否完整，是否包含不该发布的文件。
- `test:install`：在临时目录安装实际包，检查入口注册；不是实际DSH页面验证。

检查失败、取消、跳过和待办都要说明；未运行或尚待完成的发布门禁标为PENDING，不将历史专项通过写成当前全绿。发布验证使用 `npm run test:release` 输出 TAP 与机器摘要，任何失败、取消、跳过或待办均阻断。测试使用临时仓库和合成数据，不读取或修改个人项目。

## 浏览器与性能验证

- `CHROME_BIN` 指向已安装 Chrome／Chromium，再运行 `npm run test:browser`；使用临时浏览器配置和仅监听回环地址的合成页面，不替换当前 DSH 服务。此入口验证 React／Monaco 主夹具；完整 SVN／可信键盘 CI 仍使用[浏览器工作流](<.github/workflows/layout.yml>)。
- `npm run test:performance -- --large-bytes 65536` 生成 10,002 文件、10 次 warm 的小规模采样；省略该参数默认使用 4MiB 正文。结果写入 `test-results/performance/baseline.json`，记录环境、内容指纹、读取量及 p50／p95。
- `npm run test:performance -- --baseline <上一份报告> --max-ratio 1.2 --strict` 显式启用相对预算。只比较相同环境与内容规模，不把不同机器或小文件数据当作通用性能承诺。

## 从哪里修改

| 模块 | 用途 |
| --- | --- |
| [宿主入口](<index.mjs>) | 获取Session目录、授权请求、注册资源 |
| [仓库适配器](<vcs.mjs>) | 发现仓库、查询本地变更、读取历史和比较内容 |
| [客户端](<src/client.jsx>) | 仓库选择、文件列表、比较与状态 |
| [编辑器](<src/editor.js>) | Monaco只读编辑器及资源释放 |
| [构建](<build.mjs>) | 生成安装包需要的前端与宿主资源 |

详细分工见[架构](<docs/ARCHITECTURE.md>)，术语见[词汇表](<docs/GLOSSARY.md>)。

## 不应改变的行为

1. 默认只读，不增加正文编辑、远端fetch／pull／push、stash／merge／rebase／冲突解决、force或SVN写操作。已有分支切换仍要求干净工作区；整文件stage／unstage拒绝选中MM，块／行仅按精确计划稳定ID合成受限同mode普通UTF-8候选，冻结选择，不接收客户端偏移／正文。所有Index入口复验固定HEAD／完整Index／工作字节并使用index.lock，不改工作文件，不覆盖其他暂存。commit使用完整Index和显式身份／消息；amend独立确认历史替换，保留原author与有序parents。新分支与unsigned annotated／lightweight tag仅从当前HEAD创建，不覆盖、不自动切换。分支删除仅评估，不授予删除能力。保留各入口严格配置与仓库子集、限时单次token、操作种类隔离及授权复验。对象只追加，未知结果不自动重试、回滚、删对象／ref或GC；显式刷新核对真实状态。所有写入口共享仓库pending／unknown与writer门禁，但不能约束外部Git，不保证跨Index／ref全局原子性。
2. 浏览器只能请求Session下已发现的仓库，不能指定任意磁盘路径；目录变化后重新验证权限。
3. 保留无shell命令、输出与时间限制、链接路径检查及选中文件复核。
4. SVN远程访问必须明确同意；不自动连接、续权或扩大范围。
5. 高级只读比较默认开启，刷新仅手动或可见窗口聚焦，不轮询。

## 提交前检查

- 为变化增加成功、失败及取消测试。
- 界面文字同步中英文。文档按读者目的组织，解释必要术语，不写开发轮次日志。
- 不提交依赖目录、构建产物、安装包、私人路径、凭据或敏感截图。
- PR说明变化、测试命令、结果和未验证项；不要把模拟测试称为实机通过。

实际页面检查使用明确选择的测试profile；安装及重启需用户同意。本次0.8.0收口不安装、升级或重启日常DSH／profile，不更改日常配置，不启动替代服务器冒充当前页面。

[安全报告](<SECURITY.md>) · [发布流程](<docs/RELEASING.md>)
