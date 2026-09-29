# 架构与维护边界

## 文件分工

- `index.mjs`：Host 插件入口、会话目录解析、仓库授权缓存、RPC 与带认证的静态资源路由。
- `vcs.mjs`：Git/SVN 只读命令适配、仓库发现、文件安全边界、UTF-8/GBK/UTF-16 解码。保留 `detectRepository` 兼容接口供测试和现有调用方使用。
- `src/client.jsx`：单项目选择、文件列表、比较模式、请求状态和错误恢复。
- `src/editor.js`：Monaco 差异视图与 Worker 生命周期。
- `src/editor-loader.mjs`：资源 HTTP/MIME 检查与加载。
- `src/TextComparison.jsx`、`src/text-comparison.mjs`：高级编辑器失败时的只读基础比较。
- `src/repositories.mjs`：项目选择、分组、扫描合并与并发控制。
- `src/locales.json`：界面中英文；`locale/`：插件元信息。
- `test/`：临时 Git/SVN 仓库、Host 协议、客户端构建产物与算法测试。

## 协议

自有认证 RPC 通道 `/vcs-rpc`，端点为 `vcs/repositories`、`vcs/status`、`vcs/compare`。浏览器只提交 sessionId、已发现的 repositoryId 和变更 ID，不允许直接指定任意文件系统根目录。

项目发现由 Host 强制限制为当前目标目录及一级子目录；适配器仍支持显式深度参数供测试。Git 和 SVN 独立识别；会话目录处于仓库内部时也识别所属仓库。只有选中项目读取状态和差异。

当前资源走 `/vcs-assets/` 固定精确路由，调用 DSH Connection 的认证检查。旧 `/api/vcs-assets/` 注册保留兼容，但客户端不依赖它。RPC 注册显式传入插件上下文，避免 Connection getter 上下文导致 webServer 注入错误。

## 历史读取边界（开发中）

- Git 历史 RPC 复用 Session 仓库授权，提交及父提交绑定的变更 ID 不能作为任意工作区路径使用。
- 历史内容从对象库读取，不 checkout；符号链接仅显示目标文本，子模块仅显示对象引用。
- Git 子进程设置 `GIT_NO_REPLACE_OBJECTS=1`，避免 replace refs 改写指定 SHA 的内容；真实替换对象回归已覆盖。
- 设置 `GIT_NO_LAZY_FETCH=1` 并以空 `GIT_ALLOW_PROTOCOL` 禁止传输协议，防止缺失对象触发隐式远程获取；缺失对象应报错，不自动补齐。部分克隆的真实缺失对象专项回归仍待补充。

## 后续优先项

1. 在实际 DSH 登录浏览器验证模块、Worker、主题和页面刷新。
2. 状态/比较的 AbortSignal 贯穿底层命令（目前命令有超时，但取消不会立即终止全部底层工作）。
3. 授权缓存过期后自动重扫一次；目前需要手动重新扫描。
4. 编码手动覆盖，解决无 BOM UTF-8/GBK 自动检测歧义。

不要在整理提交材料时顺手重写这些运行时行为；应单独改动、回归和发布。
