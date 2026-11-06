# 单文件unstage的Host接入契约

状态：当前未发布候选已接入该RPC及确认界面；隔离验证不等于正式发布或当前GUI验收。

## 固定协议

- prepare：vcs/index-unstage-prepare，只接受sessionId、repositoryId、id。Host在受控适配器安全检查之后，从fresh staged change中解析精确路径；不得接受path、action、mode、OID、正文、环境变量或命令。
- confirm：vcs/index-unstage-confirm，只接受sessionId、repositoryId、token。固定服务器operationKind，不根据客户端字段选择操作。
- 公开预览：action=unstage、path、固定HEAD、原Index与目标的mode／OID、token、expiresAt；不公开私有fingerprint／原始Index／工作正文。

## 生命周期

1. prepare使用共享仓库读锁，确认绑定Session／cwd／发现grant／repository，最多60秒一次性token。重发现、过期及dispose使预览失效。
2. confirm必须在普通读锁分发之前进入写协调器，避免读转写自锁。先消费token，授权复验并取得与分支切换共享的写互斥。
3. 内部适配器检查真实index.lock、候选内容和完整Index CAS；只允许自有锁回调期间忽略该唯一锁的存在，锁身份仍由helper复验。
4. 两层Host异常处理都必须优先保留vcs/index-outcome-unknown，再考虑cancel／timeout。整操作预算work返回后的expiry也可能覆盖ok或unknown envelope，因此confirm外层必须保守映射未知；不能凭原始signal未取消就认定未写入。
5. 成功清空旧选择并重新发现／刷新状态；结果未知要求用户刷新核对，不自动再次确认、回滚或重试。

## 验收

精确字段白名单、Git-only、SVN拒绝、旧grant／cwd切换、参数注入、同token并发／复用／过期、跨操作重放、与分支切换／读取互斥、已发布后预算过期、已返回unknown envelope后预算过期、取消清理与无自动重试。浏览器只能展示/确认服务器摘要，不可构造替代snapshot。

在适配器、真实RPC和浏览器证据完成前，保持现有只读默认，未开放写入的用户文档不能提前改称支持。
