# 贡献指南

本项目为DSH Web提供只读Git／SVN审阅，以及需显式确认的已有本地Git分支切换。提交改动前，请阅读[许可证](<LICENSE>)：贡献者保留版权，须拥有提交内容的权利并同意按本项目非商业许可证授权；不会自动授予额外商业再许可权。

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

检查失败和跳过项都要说明。发布验证使用 `npm run test:release` 输出 TAP 与机器摘要，任何失败、取消、跳过或待办均阻断。测试使用临时仓库和合成数据，不读取或修改个人项目。

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

1. 除显式确认的已有本地Git分支切换外，不增加编辑、暂存、提交或其他仓库写操作；保留单次限时确认、写前重新授权及干净工作区检查，禁止强制覆盖、自动stash、联网或自动重试结果未知的写入。
2. 浏览器只能请求Session下已发现的仓库，不能指定任意磁盘路径；目录变化后重新验证权限。
3. 保留无shell命令、输出与时间限制、链接路径检查及选中文件复核。
4. SVN远程访问必须明确同意；不自动连接、续权或扩大范围。
5. 高级只读比较默认开启，刷新仅手动或可见窗口聚焦，不轮询。

## 提交前检查

- 为变化增加成功、失败及取消测试。
- 界面文字同步中英文。文档按读者目的组织，解释必要术语，不写开发轮次日志。
- 不提交依赖目录、构建产物、安装包、私人路径、凭据或敏感截图。
- PR说明变化、测试命令、结果和未验证项；不要把模拟测试称为实机通过。

实际页面检查使用明确选择的测试profile；安装及重启需用户同意。不更改日常配置，不启动替代服务器冒充当前页面。

[安全报告](<SECURITY.md>) · [发布流程](<docs/RELEASING.md>)
