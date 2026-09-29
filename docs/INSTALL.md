# 安装、升级与回滚

本项目以 GitHub 发布附件中的预构建 tgz 分发。不要把开发目录链接到日常工作的 DSH profile。

## npm 安装（确认版本已上架后）

```sh
# 旧包用户先备份配置，再移除旧包
dsh plugin --profile web remove @local/dsh-vcs
dsh plugin --profile web add @feng0531/dsh-vcs@0.3.22
```

不要同时保留新旧包；安装后由用户重启。回滚时先移除 @feng0531/dsh-vcs，再安装旧版 tgz。

## 验证已有候选包

在源码检出目录运行 `npm run test:install -- <local-tarball.tgz>` 可直接验证指定的本地候选文件，不重新打包。脚本打印所测文件的 SHA-256，在临时目录中仅安装生产依赖，并以桩宿主验证入口注册；不会更新日常 DSH profile，也不代表真实 GUI 验收。安装时禁用生命周期脚本，并要求安装后的包名和版本与检出一致；验证阶段仍会导入插件代码，因此这不是恶意包沙箱，仅对可信的本项目候选包执行。旧版本包应在对应版本检出中验证。省略参数仍按原流程先打包再验证。

## 安装前

- 确认 Node.js >=22、DSH Web 接口兼容、Git/SVN 可执行文件可用。
- 阅读非商业许可证；商业项目使用须另行授权。
- 从同一 GitHub Release 获取 tgz 与 SHA256SUMS.txt，核对 SHA-256。Windows 可用 Get-FileHash，Linux 可用 sha256sum -c SHA256SUMS.txt。
- 备份目标 profile 的 package.json、锁文件和 cordis.patch.yml；保留上一个已验证 tgz。备份不应提交到公开仓库。

## 安装/升级

```sh
dsh plugin --profile web add <absolute-tgz>
```

将占位符换为真实绝对路径并在需要时加引号。此包带有启用补丁：安装同时添加一个 local-dsh-vcs 实例，不需要额外 enable-vcs 包。先在独立测试 profile 验证，再更新日常 profile。安装命令成功不等于宿主已经加载。

用户自行重启 DSH，再刷新原 Web 地址；不要自动重启或另开服务器代替现有 GUI。确认工作区、聊天、VCS 列表、编辑器资源均正常。

## 回滚

用同一 add 命令重新安装保留的上一版本 tgz，随后由用户重启。若 profile 配置损坏，先保存现场，再只恢复本次变动的配置；不要整目录覆盖导致其他插件或工作区设置丢失。卸载/禁用请先查看所用 DSH 版本的 plugin --help 和 profile 配置，不猜测跨版本命令。

## 构建来源安装

源码检出执行 npm ci、npm run check、npm run verify:package、npm run test:install 后 npm pack；安装生成的固定 tgz。Git URL 安装依赖 prepare 和宿主包管理器脚本策略，未单独验收，不作为推荐正式安装路径。
