# 本地 A/B 版本比较草案（未实现）

## 第一批范围

- 从已加载提交列表选择 A（左）和 B（右），只接受完整 SHA-1/SHA-256 commit OID；先不支持任意 revision 表达式、远程引用或工作区混合比较。
- 方向明确为 A → B，而非隐含 merge-base；交换两端重新获取文件列表和 ID。A=B 返回空列表。
- 跨分支但本地已存在的 commit 可比较；不执行 checkout/fetch，不修改索引和工作树。

## 服务端协议建议

- 新增专用端点（名称待实现时确认），仅接受 sessionId、repositoryId、base、target 以及逐文件比较所需的 opaque id；拒绝客户端 root/path/任意 Git 参数。
- 每次复用 Session cwd 重解析、发现授权、TTL、容量限制、canonical root 校验、取消信号及读取后失效检查。
- 用固定参数验证两端确为 commit，关闭 replace refs、lazy fetch、外部 diff 和 textconv。对象缺失返回可操作错误，不联网。
- 文件清单复用 NUL 分隔 name-status 解析，覆盖 A/M/D/T/R/C；ID 必须绑定仓库作用域、A、B、状态及旧/新路径，禁止把单提交父比较的 ID 当成 A/B ID。
- 保持 2 MiB 命令/文本上限和 10000 文件上限。逐文件比较再次验证清单归属；不能把收到的 path 直接传给 Git。
- 新增左空、删除右空、重命名左右读旧/新路径；symlink 只显示目标文本，gitlink 只显示 OID；二进制或超限明确提示。

## 实现顺序及测试门槛

1. 提取共享变更清单解析与对象读取，保持现有根/合并父提交测试不退化。
2. 适配器测试：A=B、方向交换、非祖先提交、重命名/删除/新增、Unicode 路径、伪造 OID/ID、非 commit 对象、缺失 promisor blob、取消及只读前后状态。
3. RPC 测试：陌生 Session/仓库、cwd 变化、过期授权、字段注入、读取期间取消/撤销授权。
4. UI：两端完整身份可见、交换操作、加载/失败状态，变更 A/B 立即取消旧请求且清除旧文件与 Diff；不增加定时刷新。
5. 浏览器模拟延迟响应回归 + 真实 Git RPC 集成 + 四平台候选 CI + 真实 DSH GUI 验收，之后才正式发布。

文件历史与 Blame 依赖这些不可变版本边界；它们不属于本批已实现范围。
