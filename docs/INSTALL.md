# 安装、升级与回滚

需要 Node.js 22+，DSH Web 0.1.7-rc.2 或 0.2.0-rc.2，以及 PATH 中可用的 Git／SVN。先阅读[非商业许可证](<../LICENSE>)。

## 先确认安装位置

profile是DSH配置与插件环境，不是Session。下面以web为例：请使用当前运行DSH的实际profile，避免装到另一个环境。宿主插件命令通过pnpm执行，需要能找到pnpm；可先查看dsh plugin --help。

## 安装正式包

	dsh plugin --profile web add @feng0531/dsh-vcs@0.3.70

也可以从[正式发布页](https://github.com/f-e-n-g-0531/dsh-vcs/releases/latest)下载 tgz 与 SHA256SUMS.txt，核对 SHA-256 后执行：

	dsh plugin --profile web add "<tgz 的绝对路径>"

Windows 用 Get-FileHash 检查 SHA-256；Linux 用 sha256sum。安装包自带启用补丁，不需要额外的 enable-vcs 包。

安装修改所选 profile。**安装后由你自行重启 DSH，再刷新原来的 Web 页面**。命令成功不代表页面已经加载新版。

## 升级

1. 备份目标 profile 配置和锁文件，保留上一版 tgz。
2. 使用上述命令安装指定的新版本。
3. 重启后检查 VCS 入口、文件比较、历史和 Session 切换；确认工作区与聊天仍正常。

如果以前安装的是旧包 `@local/dsh-vcs`，先备份配置，再移除旧包，不同时保留新旧实例：

	dsh plugin --profile web remove @local/dsh-vcs

使用不同 profile 时，将命令中的 web 替换成实际 profile 名称。可先查看当前 DSH 的 plugin --help。

## 回滚

重新安装保留的上一版 tgz，再自行重启。如果配置损坏，保存现场后只恢复本次修改，不整目录覆盖其他插件和工作区设置。

## 从源码构建（开发者）

	npm ci --include=dev
	npm run check
	npm run verify:package
	npm run test:install
	npm pack

安装生成的 tgz，不推荐把开发目录链接到日常 profile。Git URL 安装依赖构建脚本和宿主包管理器策略，不是推荐安装方式。

`npm run test:install -- <local-tarball.tgz>` 可验证可信的本地候选包；只修改临时目录，不更新日常 DSH。它不是恶意包沙箱，也不代替实际页面验证。
