# 架构与模块边界

本文供开发者定位代码。使用者从[项目说明](<../README.md>)开始；技术词见[术语表](<GLOSSARY.md>)。下面的“复验”表示每次读取重新确认目录与授权，“有界”表示限制数量、字节、时间或并发，不是无限读取。

## 依赖方向

浏览器视图 → 认证RPC → Session／仓库授权 → 默认只读适配器 → 有界本地命令或已同意HTTPS。0.6.0增加独立的确认式本地分支切换链，不改变历史引用导航的只读语义。视图不能直接读取文件系统；解析和展示模型不负责发起网络或授予权限。

## 宿主与本地读取

- [宿主入口](<../index.mjs>)负责DSH注册、固定资源路由、请求字段白名单、Session目录解析、发现授权、并发准入及读取后复验。适配器分发与授权流程分开。
- [仓库适配器](<../vcs.mjs>)负责发现、Git／SVN本地状态、对象读取及比较语义；公开导出保持兼容。[本地命令](<../local-command.mjs>)集中环境防护、无shell进程、合并输出预算、取消和15秒默认超时，不与远程DAV传输混用。
- [历史解析](<../git-history.mjs>)负责Git输出协议及分页／搜索参数；[路径边界](<../repository-path.mjs>)负责词法包含、现存链接和真实祖先校验；[文本解码](<../text-content.mjs>)负责有界字节解码。
- [图片准备](<../image-preview.mjs>)与浏览器解码共同把关格式和尺寸，不绕过路径或选中ID验证。

## 确认式本地 Git 分支切换（0.6.0）

独立界面经 `vcs/branches` 读取已有本地分支，`vcs/branch-switch-prepare` 预览服务器快照，再用 `vcs/branch-switch-confirm` 提交一次性 token；不接受客户端提供的仓库路径或替代快照。协调器绑定 Session／cwd／发现授权／仓库，默认 60 秒过期、最多 32 个 token，确认即消费；按仓库排斥插件内读写冲突，读取完成前不开始写入。模块为[分支适配器](<https://github.com/f-e-n-g-0531/dsh-vcs/blob/main/branch-switch.mjs>)、[确认协调器](<https://github.com/f-e-n-g-0531/dsh-vcs/blob/main/branch-switch-host.mjs>)与[独立界面](<https://github.com/f-e-n-g-0531/dsh-vcs/blob/main/src/BranchSwitcher.jsx>)。

适配器仅切换已有 `refs/heads`，执行前重验固定当前／目标提交和配置、Index、工作区。拒绝任何脏状态（含未跟踪／被忽略内容）、冲突、attributes、过滤器／命令 hooks、稀疏／部分克隆、assume-unchanged／skip-worktree、符号链接／硬链接／gitlink、Git元数据symlink／hardlink或alternates、进行中操作及锁；不支持 linked／分离／符号链接 gitdir、`core.worktree`、detached／unborn HEAD 或与目标分支同名的 tag。实际命令使用 `git switch --no-guess --no-overwrite-ignore --no-recurse-submodules`，禁 hooks 和外部 attributes，不创建分支、不 stash、不 force、不联网。写入开始后失败记为结果未知，不自动重试或回滚；前端要求刷新核对。仓库级互斥不覆盖外部 Git 进程，不保证系统级原子性。

## SVN HTTPS组合

[固定工厂](<../src/svn-https-host.mjs>)组合[共享Host](<../src/svn-host.mjs>)、[严格RPC](<../src/svn-rpc.mjs>)、[运行时](<../src/svn-runtime.mjs>)与有界DAV／TLS传输。生产工厂不接受请求实现、CLI、认证缓存或自定义CA注入。

本地身份解析复用发现授权。用户先审阅提议并明确勾选同意，才生成绑定Session、cwd、root、UUID和scope的短期能力。运行时逐步骤复验；撤销、过期、Session变化及插件卸载使能力失效。日志固定本地工作副本修订，不隐式读远端HEAD。功能及认证限制见[SVN结论](<SVN-RUNTIME-SCOPE.md>)。

## 前端组合

- [客户端入口](<../src/client.jsx>)负责DSH页面注册、工作区选择与交互状态；[RPC适配器](<../src/client-rpc.mjs>)仅转换认证响应，保留错误码和取消信号。[状态调度器](<../src/status-limiter.mjs>)跨请求代次限制两项并发，取消在途请求直到结束才释放槽；[列表键盘处理](<../src/file-list-keyboard.mjs>)只管理焦点和目录开合，不自动选择文件。
- 工作区／历史／Stash／内容搜索使用单一 `reviewView` 状态互斥切换，工作区比较、编辑器与快捷键共用 `reviewActive` 门禁；进入只读辅助视图统一取消工作区比较并清空旧选择，避免新增视图时漏更新依赖。
- [内容搜索](<../src/GrepPanel.jsx>)按 Session／repositoryId 重新挂载请求所有者，切换时取消旧查询。搜索结果绑定固定 snapshot，打开文件不跟随移动的 HEAD，返回保留查询结果。
- 历史面板组合提交详情、目录、文件历史、Blame 和比较视图；[历史窗口模型](<../src/history-window.mjs>)和[文件历史分页](<../src/history-pages.mjs>)有界显示最多 200 条。[导航位置](<../src/review-location.mjs>)只保存有界的提交／父提交／文件／行和视图选项，不保存正文或授权。
- [历史审阅视图](<../src/HistoryViewer.jsx>)负责展示；[生命周期Hook](<../src/useHistoryEditor.mjs>)管理编辑器与样式资源；[编辑器任务](<../src/history-editor.mjs>)处理异步加载和释放。
- [Monaco入口](<../src/editor.js>)负责只读模型、Worker与主题；[加载器](<../src/editor-loader.mjs>)负责HTTP／MIME诊断。基础比较是手动选项或失败回退，不是默认审阅。

## 安全和容量契约

- 发现默认检查Session目录及一级子目录；定向扫描仍限于Session内。发现的包含仓库可能大于Session目录。
- 授权最多32个Session、约5分钟；每次请求重新解析cwd，拒绝旧扫描覆盖新状态。过期需手动重新发现。
- 历史读取绑定不可变OID和选中ID；Git禁止replace refs、lazy fetch、提示及外部diff／textconv。只读浏览不checkout、不自动获取对象；实际分支切换仅走上述独立确认链。
- [操作预算](<../src/operation-budget.mjs>)通过异步上下文为本地 RPC 提供统一截止时间；[本地命令](<../local-command.mjs>)共享剩余预算，取消或超时清理进程树，直到 close 与清理结束才释放请求容量。不是即时终止承诺。
- 文本每侧2MiB；历史UTF8分段最大16MiB、每片64KiB。历史图最多200节点／1000关系／32泳道，不等于完整无限图。
- 刷新仅手动或可见window聚焦，无周期刷新。资源路由是固定认证白名单，URL不能成为任意磁盘路径。

## 构建与验证

[构建目标](<../build.mjs>)分别产出客户端、编辑器、Worker和SVN Host；Host bundle保留宿主入口外部依赖。新增运行时文件必须同步打包白名单与[包闭包检查](<../scripts/verify-package.mjs>)。

测试分为纯协议／模型、真实临时Git／SVN仓库、Host授权和隔离Chrome／真实Apache TLS链。测试辅助模块只服务fixture，不进入生产包。隔离安装和浏览器证据不等于当前DSH实机验收；见[实机结论](<LIVE-ACCEPTANCE.md>)。
