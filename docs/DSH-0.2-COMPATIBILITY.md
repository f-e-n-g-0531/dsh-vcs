# DSH 0.2.0-rc.2兼容性检查（历史记录）

> 本文记录0.3.36发布前的检查，不是当前待办。当前环境要求见[兼容性指南](<COMPATIBILITY.md>)；0.3.36已发布，原候选状态只作为历史保留。

## 已确认

- 0.3.35 的 peerDependencies 精确要求 @deepseek-ai/dsh 0.1.7-rc.2；0.2.0-rc.2 会被拒绝，即便 peer optional=true。
- 已安装 dsh-app-boot 的 evaluatePluginCompatibility 使用 semver.satisfies(runtimeVersion, requirement, {includePrerelease:true})；没有根据 optional 忽略检查。
- 新宿主 dsh-client-connection 的 HostConnectionService.register(owner,channel,handler) 实现仍在：通过 owner.effect 注册 owner.webServer 路由，路由先 admit，再桥接 RPC。
- RPC 桥接仍依次传 endpoint、payload、signal，新增/保留的第四个 peer 参数不影响插件当前前三参数签名。
- 但 register 在宿主类型中是 private；公开 API 是 connection.rpc.handle(channel,handler)。旧版插件显式传 owner 是为避免嵌套 getter 丢失插件上下文，不能无测试切换。
- 新宿主声明仍提供 connection.fetch.register、connection.admit、sessionPersistence.stat(id,options)、客户端 useSessions、retainedBy 与 layout.selectPanel。仅存在接口不等于运行时兼容。

## 已完成验证与候选

- 第 187–190 轮真实 Cordis/Connection 隔离测试：注册、401/403、资源、RPC envelope、Session cwd、插件单独卸载/重载通过。
- 真实 SlotRegistry 客户端注册/卸载通过；使用测试 React、外壳及 locale，不是实际页面渲染。
- 保留受测的 owner 显式注册；它仍属私有 API 风险，因此只精确支持已声明版本，不推断未来版本兼容。
- 0.3.36 候选 peer 已改为 `0.1.7-rc.2 || 0.2.0-rc.2`。新宿主真实 evaluatePluginCompatibility 已确认接受这两个版本，拒绝测试中的其他版本和旧 0.3.35 声明，未设置豁免。
- 205/205、本地包/安装、四平台标签 CI、同标签 Chrome、四平台 tarball 相同摘要均通过。详见[候选核验](<CANDIDATE-0.3.36.md>)。

## 候选阶段尚未完成的事项

以下保留当时状态；后续正式发布见[最终记录](<RELEASE-0.3.36.md>)，不代表现在仍未发布。

- 在真实宿主加载固定候选后验证页面版本、Session 选择和 M1–M4 操作；当前没有授权浏览器工具或用户验收结果。
- 当前只完成候选构建与测试，没有正式发布 0.3.36、改动当前 profile 或自动重启。旧安装不会自动解除拒载。
- 正式发布需真实验收，或用户针对此候选明确要求提前发布并披露例外。候选安装与用户自行重启后的验收可先于公开发布，不需要强制豁免。
