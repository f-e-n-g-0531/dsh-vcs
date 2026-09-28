# 兼容性与发布验收

## 支持目标与证据

- Node.js：>=22；CI 配置为 22、24，Windows 与 Linux。CI 配置存在不代表远端已通过。
- DSH：代码对照 @deepseek-ai/dsh 0.1.7-rc.2 的实际安装实现检查；依赖 connection/webServer/sessions/sessionPersistence，以及 Web slots/layout/locale/uiSession 服务。不是所有旧版宿主的兼容承诺。manifest 将 DSH peer 精确限制为 0.1.7-rc.2；optional 只避免 npm 自动安装整套宿主，不绕过 DSH 的版本检查。RPC 当前使用 connection.register 内部接口作为上下文兼容修复，因此升级宿主前必须重新验收，不建议随意添加版本豁免。
- 平台：仅 DSH Web；不支持作为独立 Vite 网站启动。React 由宿主提供，Monaco 和 Worker 随包分发。
- Git/SVN：运行环境须按项目类型提供 git 或 svn；完整测试另需 svnadmin。
- 发布渠道：GitHub Release 的预构建 tgz，非 npm registry。包名 @local/dsh-vcs 是宿主模块身份，保留以避免升级出现重复插件；private:true 不妨碍 tgz 安装。

## 自动检查

```sh
npm ci
npm run check
npm run verify:package
npm run test:install
npm pack
```

verify:package 检查拟打包列表与插件入口契约；test:install 在临时目录中安装真实 tgz，只装生产依赖，导入 Host 入口并使用桩服务检查注册。二者都不能替代真实宿主启动、认证和浏览器验收。

## 正式发布前人工门槛

1. 使用独立 DSH 测试 profile 安装最终 tgz，确认启用且卸载/回滚可用。
2. 检查登录后的 RPC 和三个编辑器资源正常；无认证请求应拒绝；终端无插件注入异常。
3. 深色/浅色、Monaco Worker、基础比较降级、多 Session 切换、聊天/工作区保持正常。
4. Windows 与 Linux 的远端 CI 全通过；macOS 未验证。
5. 维护者启用 GitHub 私密漏洞报告，完善支持联系渠道。
6. 审核自定义非商业许可与实际源码权属；第三方声明随包保留。

以上未执行项目应保持未验收状态，不应仅依据单元测试宣称生产就绪。
