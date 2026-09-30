# DSH 0.2.0-rc.2 兼容性排查

## 已确认

- 0.3.35 的 peerDependencies 精确要求 @deepseek-ai/dsh 0.1.7-rc.2；0.2.0-rc.2 会被拒绝，即便 peer optional=true。
- 已安装 dsh-app-boot 的 evaluatePluginCompatibility 使用 semver.satisfies(runtimeVersion, requirement, {includePrerelease:true})；没有根据 optional 忽略检查。
- 新宿主 dsh-client-connection 的 HostConnectionService.register(owner,channel,handler) 实现仍在：通过 owner.effect 注册 owner.webServer 路由，路由先 admit，再桥接 RPC。
- RPC 桥接仍依次传 endpoint、payload、signal，新增/保留的第四个 peer 参数不影响插件当前前三参数签名。
- 但 register 在宿主类型中是 private；公开 API 是 connection.rpc.handle(channel,handler)。旧版插件显式传 owner 是为避免嵌套 getter 丢失插件上下文，不能无测试切换。
- 新宿主声明仍提供 connection.fetch.register、connection.admit、sessionPersistence.stat(id,options)、客户端 useSessions、retainedBy 与 layout.selectPanel。仅存在接口不等于运行时兼容。

## 待验证后才能放宽声明

1. 使用已安装的真实 HostConnectionService，在隔离 Context 中注册插件；验证 RPC 路由、静态资源、拒绝未认证请求、释放清理。不接触运行中宿主，不读取用户 Cookie。
2. 验证 Session cwd 解析与新客户端槽位、选择状态；补充实际契约测试。
3. 确定使用公开注册入口还是保留受测的 owner 显式适配。
4. 仅声明经过验证的宿主版本，不使用 * 或强制豁免。新补丁包需独立版本和验证，不能覆盖 0.3.35。

当前没有修改 peer 范围、安装包或宿主配置。真实 GUI 验收仍未完成。
