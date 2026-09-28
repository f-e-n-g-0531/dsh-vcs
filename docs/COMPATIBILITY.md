# 兼容性与发布验收

## 支持目标与证据

- Node.js：>=22；CI 配置为 22、24，Windows 与 Linux。CI 配置存在不代表远端已通过。
- DSH：代码对照 @deepseek-ai/dsh 0.1.7-rc.2 的实际安装实现检查；依赖 connection/webServer/sessions/sessionPersistence，以及 Web slots/layout/locale/uiSession 服务。不是所有旧版宿主的兼容承诺。manifest 将 DSH peer 精确限制为 0.1.7-rc.2；optional 只避免 npm 自动安装整套宿主，不绕过 DSH 的版本检查。RPC 当前使用 connection.register 内部接口作为上下文兼容修复，因此升级宿主前必须重新验收，不建议随意添加版本豁免。
- 平台：仅 DSH Web；不支持作为独立 Vite 网站启动。React 由宿主提供，Monaco 和 Worker 随包分发。
- Windows SVN 工具链：CI 固定使用 VisualSVN 分发的 Apache Subversion 1.14.5-5 ZIP 并核对 SHA-256，不再依赖未固定版本的 SlikSVN。旧 runner 将中文 argv 转成 `??`，设置 LC_ALL 未解决；仅替换发行版也未解决英文 runner 上的失败。SVN 1.14 的 Windows 参数转换使用系统 ANSI 代码页（CP_ACP），LC_ALL 不改变它。CI 在校验下载包后，仅为临时工具副本的 svn.exe/svnadmin.exe 合并 activeCodePage=UTF-8 manifest（需 Windows SDK mt.exe、Windows 10 1903+）；保留原有 manifest 设置，不更改系统区域。修改资源会使厂商签名失效，因此只限临时 CI 副本，不随插件分发。仍须以实际 runner 的中文回归结果验收。用户环境也须使用能正确接收中文参数的 SVN；本次 CI 配置不修复用户已安装的 ANSI SVN。LC_ALL 不能保证修复任意 Windows SVN 构建的 ANSI 参数处理。不修改系统代码页、不跳过中文路径断言。
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
