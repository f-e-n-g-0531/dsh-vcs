# 架构与模块边界

## 依赖方向

浏览器视图 → 认证RPC → Session／仓库授权 → 只读适配器 → 有界本地命令或已同意HTTPS。视图不能直接读取文件系统；解析和展示模型不负责发起网络或授予权限。

## 宿主与本地读取

- [宿主入口](<../index.mjs>)负责DSH注册、固定资源路由、请求字段白名单、Session目录解析、发现授权、并发准入及读取后复验。适配器分发与授权流程分开。
- [仓库适配器](<../vcs.mjs>)负责发现、Git／SVN本地状态、对象读取及比较语义；公开导出保持兼容。
- [历史解析](<../git-history.mjs>)负责Git输出协议及分页／搜索参数；[路径边界](<../repository-path.mjs>)负责词法包含、现存链接和真实祖先校验；[文本解码](<../text-content.mjs>)负责有界字节解码。
- [图片准备](<../image-preview.mjs>)与浏览器解码共同把关格式和尺寸，不绕过路径或选中ID验证。

## SVN HTTPS组合

[固定工厂](<../src/svn-https-host.mjs>)组合[共享Host](<../src/svn-host.mjs>)、[严格RPC](<../src/svn-rpc.mjs>)、[运行时](<../src/svn-runtime.mjs>)与有界DAV／TLS传输。生产工厂不接受请求实现、CLI、认证缓存或自定义CA注入。

本地身份解析复用发现授权。用户先审阅提议并明确勾选同意，才生成绑定Session、cwd、root、UUID和scope的短期能力。运行时逐步骤复验；撤销、过期、Session变化及插件卸载使能力失效。日志固定本地工作副本修订，不隐式读远端HEAD。功能及认证限制见[SVN结论](<SVN-RUNTIME-SCOPE.md>)。

## 前端组合

- [客户端入口](<../src/client.jsx>)负责DSH页面注册、工作区选择与交互状态；[RPC适配器](<../src/client-rpc.mjs>)仅转换认证响应，保留错误码和取消信号。
- 历史面板组合提交详情、目录、文件历史、Blame和比较视图；[历史窗口模型](<../src/history-window.mjs>)独立维护最多200行的加载窗口。
- [历史审阅视图](<../src/HistoryViewer.jsx>)负责展示；[生命周期Hook](<../src/useHistoryEditor.mjs>)管理编辑器与样式资源；[编辑器任务](<../src/history-editor.mjs>)处理异步加载和释放。
- [Monaco入口](<../src/editor.js>)负责只读模型、Worker与主题；[加载器](<../src/editor-loader.mjs>)负责HTTP／MIME诊断。基础比较是手动选项或失败回退，不是默认审阅。

## 安全和容量契约

- 发现默认检查Session目录及一级子目录；定向扫描仍限于Session内。发现的包含仓库可能大于Session目录。
- 授权最多32个Session、约5分钟；每次请求重新解析cwd，拒绝旧扫描覆盖新状态。过期需手动重新发现。
- 历史绑定不可变OID和选中ID；Git禁止replace refs、lazy fetch、提示及外部diff／textconv。不checkout、不自动获取对象。
- 本地子进程无shell、有限输出和超时。历史／SVN取消传递到底层；工作区状态／比较取消仍不保证立即终止子进程，不能在重构中冒称已解决。
- 文本每侧2MiB；历史UTF8分段最大16MiB、每片64KiB。历史图最多200节点／1000关系／32泳道，不等于完整无限图。
- 刷新仅手动或可见window聚焦，无周期刷新。资源路由是固定认证白名单，URL不能成为任意磁盘路径。

## 构建与验证

[构建目标](<../build.mjs>)分别产出客户端、编辑器、Worker和SVN Host；Host bundle保留宿主入口外部依赖。新增运行时文件必须同步打包白名单与[包闭包检查](<../scripts/verify-package.mjs>)。

测试分为纯协议／模型、真实临时Git／SVN仓库、Host授权和隔离Chrome／真实Apache TLS链。测试辅助模块只服务fixture，不进入生产包。隔离安装和浏览器证据不等于当前DSH实机验收；见[实机结论](<LIVE-ACCEPTANCE.md>)。
