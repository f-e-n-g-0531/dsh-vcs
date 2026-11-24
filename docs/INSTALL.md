# 安装、升级与回滚

先核对[兼容性](<COMPATIBILITY.md>)：DSH 与 Node.js 要满足对应版本要求，且宿主的 PATH 中须有项目所需的 Git 或 SVN。

## 先确认安装位置

profile 是 DSH 的配置和插件环境，不是 Session。`web` 是示例，请换成运行中的 DSH 所用的 profile。终端需要能找到 `pnpm`；用 `dsh plugin --help` 确认命令格式。

## 安装正式包

用 `npm view @feng0531/dsh-vcs version` 查询 npm 最新版，或用 `npm view @feng0531/dsh-vcs versions` 查看可用版本，然后安装：

```sh
dsh plugin --profile web add "@feng0531/dsh-vcs@<npm 上的确切版本>"
```

GitHub 与 npm 的可用版本可能不同。也可从 [GitHub 正式发布页](https://github.com/f-e-n-g-0531/dsh-vcs/releases/latest) 下载 `.tgz` 和 `SHA256SUMS.txt`，核对 SHA-256 后运行：

```sh
dsh plugin --profile web add "<tgz 的绝对路径>"
```

Windows 可用 `Get-FileHash -Algorithm SHA256`，Linux 可在下载目录执行 `sha256sum --check SHA256SUMS.txt`。正式包已包含启用补丁，无需额外安装 enable-vcs。

安装修改所选 profile。**安装后由你自行重启 DSH，再刷新原来的 Web 页面**。命令成功不代表页面已经加载新版。

## 升级

1. 备份目标 profile 配置和锁文件，保留上一版 tgz。
2. 使用上述命令安装指定的新版本。
3. 重启后检查 VCS 入口、文件比较、历史和 Session 切换；确认工作区与聊天仍正常。

如果 DSH `0.2.3-alpha.2` 报旧版插件 `0.9.2` 不兼容，先确认 profile 并备份配置，然后卸载旧版，安装[兼容性列表](<COMPATIBILITY.md>)中的已发布版本，不要用版本豁免启用旧包。

如果以前安装的是旧包 `@local/dsh-vcs`，先备份配置，再移除旧包，不同时保留新旧实例：

```sh
dsh plugin --profile web remove @local/dsh-vcs
```

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
