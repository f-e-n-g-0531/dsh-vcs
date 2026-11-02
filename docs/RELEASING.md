# 维护者发布流程

本文用于维护项目。使用者请阅读[README](<../README.md>)和[安装指南](https://github.com/f-e-n-g-0531/dsh-vcs/blob/main/docs/INSTALL.md)。

## 发布内容

每次改动完成并验证通过后，按授权渠道完成正式发布，不停留在本地修改或只推标签。默认 `both` 联合 npm／GitHub；明确仅 GitHub 的版本使用 `github-only`，不接触 npm token、registry 或 latest。渠道例外写入该版本说明，不能据 GitHub 版本号推断 npm 可用版本。版本使用 `vX.Y.Z`：X 为大版本，Y 为小版本／新增功能，Z 为 BUG 修复；递增前一位时后面的位归零。失败门禁必须先修复，不能为了发布跳过验证。发布不自动安装或重启宿主。

每个新版本必须有独立的中文发布说明，放在 `docs/releases/版本号.md`。按“本版变化、安装、限制、验证”组织，不把自动提交列表、开发轮次或内部恢复记录当作用户说明。没有新增功能时明确写出，不夸大改动。

更新包版本和锁文件，在变更记录中填写同一版本。核查许可证、第三方声明及公开文件，排除凭据和私人数据。

## 1. 本地检查

需要 Node.js 22+、Git、SVN、svnadmin、OpenSSL。在干净检出中执行：

	npm ci --include=dev
	npm run build
	npm run test:release
	npm run verify:package
	npm run test:install

测试失败或跳过须调查；隔离安装只检查包和宿主注册，不是用户实际 DSH 验收。

新增宿主兼容声明时，还需对精确宿主执行隔离检查：

```sh
npm run test:host-compat -- "<installed @deepseek-ai/dsh/package.json>"
```

参数是已安装 DSH 包的清单文件，不是运行时目录。桌面 ASAR 构建使用对应 Electron 的 `ELECTRON_RUN_AS_NODE=1` 执行脚本；若 ui-slots 是 shell 内建种子、未提供 Node 包，可额外传入从同一精确版本包解出的 ui-slots 清单绝对路径。脚本核对种子版本，不静默替换为 mock。宿主测试不启动 profile、监听端口或安装插件；记录实际测试的宿主版本，不能用一个宿主的结果声称整个版本矩阵本次均通过。

## 2. 固定版本并验证

1. 提交并推送版本修改，创建新标签 `vX.Y.Z`；不移动已有标签。
2. 等待标签 CI 的 Windows／Ubuntu × Node 22／24 全部成功。
3. 手动在同一标签运行 **Browser layout checks**，等待成功。
4. 在同一标签运行 **Controlled host compatibility**，提供受控离线宿主工件 run ID 和四个精确版本的 SHA-256。每个版本必须有自己的真实合同结果。
5. 发布预检自动下载四份候选包与浏览器／宿主证据，绑定完整 tag ref、提交 SHA、run ID 和 attempt；核对内嵌版本、零跳过测试摘要及四包字节一致。缺失或失败均阻断。

分支检查不能代替同标签检查。失败后先定位；需要修改源码或测试时使用新的版本和标签。

### 浏览器／宿主证据绑定实际候选包

浏览器与宿主合同任务不重新构建插件：先以 `npm ci --include=dev --ignore-scripts` 安装测试依赖，再由[发布预检脚本](<https://github.com/f-e-n-g-0531/dsh-vcs/blob/main/scripts/release-preflight.mjs>)的 `select-ci` 选定同标签、同提交的成功 CI run／attempt，下载全部四矩阵候选；`consume` 校验版本、测试零失败／取消／跳过／待办及四包字节一致后，将候选包里的发行文件作为本次测试输入。

消费过程生成 `consumed-candidate.json` 收据，记录候选归档 SHA-256、CI run／attempt 和归档位置。生成 Chrome 或宿主成功报告前，再核对原归档及每个已消费发行文件的实际字节；变化即失败，不能用重新构建的文件替代。报告中的 `candidateSha256`、`ciRun`、`ciAttempt` 必须与最终发布预检选中的四份 CI 候选一致，同时仍核对各自的完整 tag ref、提交 SHA 和证据任务 run／attempt。仅“同一提交测试通过”而没有这条字节关联，不足以放行；CI 重跑后也必须重新取得对应候选的浏览器与四版本宿主证据。

## 受控宿主准备与离线合同

[宿主工件工作流](<https://github.com/f-e-n-g-0531/dsh-vcs/blob/main/.github/workflows/host-fixtures.yml>)仅允许默认分支手动执行，在 GitHub 托管的 Ubuntu runner 上为四个精确版本分别准备真实宿主：`0.1.7-rc.2`、`0.2.0-rc.2`、`0.2.1-rc.2`、`0.2.1-rc.5`。这是明确授权的**在线准备阶段**，不是离线安装，也不使用日常 DSH 的配置或依赖目录。

工作流通过[准备脚本](<https://github.com/f-e-n-g-0531/dsh-vcs/blob/main/scripts/prepare-host-fixture.mjs>)固定同版本的官方 DSH 与 ui-slots 包，仅从 `https://registry.npmjs.org` 解析依赖。先生成锁文件并校验精确版本、下载地址及 SHA-512 integrity，再按锁文件安装；两次 npm 操作均禁用安装脚本。工件同时保存锁文件及准备记录，包括锁文件 SHA-256、准备源码 SHA、run ID 和 attempt。不启动宿主，不安装插件，不接触运行中的 profile。

准备完成后，在待发布标签运行[宿主兼容工作流](<https://github.com/f-e-n-g-0531/dsh-vcs/blob/main/.github/workflows/host-compat.yml>)，提供成功准备任务的 `fixture_run` 和四个版本各自 `host.tar.gz` 的 SHA-256 映射 `fixture_hashes`。工作流只接受本仓库默认分支的受控准备工作流结果，拒绝其他工作流、fork／PR 以及不匹配的摘要；验证归档路径后提取真实依赖树。**宿主合同使用已准备的离线依赖树**，不再在线安装宿主、不启动 profile，也不能用 mock 或一个版本的结果冒充四版本通过。工作流下载证据及安装插件项目的测试依赖仍需要网络，不表示整项 CI 在断网环境运行。

若维护者已有完整可信依赖树，也可本地生成相同宿主归档：

```sh
node scripts/release-host-fixture.mjs pack <含node_modules和package-lock.json的根目录> <精确版本> <新的输出目录>
```

归档来源必须包含完整依赖与锁文件；根目录内合法依赖链接可物化为普通文件，指向根目录外的链接或外部依赖 store 会被拒绝，须先将依赖完整准备在根目录内。归档本身不得保留链接或越界项。本地生成归档不绕过发布工作流的受控来源检查；四版本工件或真实合同不完整时发布仍会阻断。

## 3. 按渠道发布

在 Actions 从 main 运行 **Publish GitHub and npm**，输入已验证的标签。

工作流检出该标签，验证同标签证据，直接使用已验证的候选 tgz，不重新生成另一份包。`both` 先上传 npm，再验证公开 npm 元数据与实际下载字节，最后公开 GitHub Release；`github-only` 跳过全部 npm 步骤，仅上传已验证候选及 SHA-256 校验文件。

仅 `both` 渠道需配置 `NPM_AUTOMATION_TOKEN`，具有该包发布权限并符合 npm 2FA 策略；`github-only` 无需该凭据。凭据只用于上传步骤；不要写进源码、发布说明或聊天。

## 4. 发布后核验

- `both`：npm 版本与 latest 正确，实际 tarball 可下载；`github-only` 不修改或要求 npm。
- GitHub Release 非草稿、非预发布，附件可下载。
- 本次授权渠道的实际包与四候选的字节大小和 SHA-256 一致。下载 tgz 与 `SHA256SUMS.txt` 到同一目录；校验文件使用包文件名，不包含 runner 的 `verified/` 前缀，可在下载目录直接执行 `sha256sum --check SHA256SUMS.txt`。
- 补记最终结论，但不修改已发布标签或替换工件。

npm 与 GitHub 不是原子发布。若 npm 已接受上传但公开下载暂时 404，**不要再次上传**；先只读确认公开包。确认相同后恢复原失败任务，工作流会核对已有 npm integrity 并跳过上传。不匹配则停止；已有 GitHub Release 不覆盖。

## 实机验证与安装边界

自动浏览器测试不等于当前 DSH 实机通过。发布说明须如实写出未确认项；用户明确授权在此边界下发布时，不伪造实机结论。

发布不安装、不升级、不重启运行中的 DSH。用户选择安装后，在原 Web 页面检查入口、仓库发现、差异、历史以及 Session 切换；由用户自行重启。维护者不能启动替代服务器冒充当前页面。
