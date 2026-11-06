# 引用CAS独立验收

- 仅refs/heads固定本地分支；symbolic HEAD与ref及旧OID在写前核对，但与外部HEAD切换不是系统级原子事务，不能隐瞒race窗口。
- 新OID必须已有固定commit，显式sha1／sha256；oldOID条件传入update-ref，--no-deref不允许跳转symbolic目标。
- command参数固定无shell，禁用reference-transaction hook和其他隐式用户代码；不通过删除用户hook实现。
- hooks临时目录自有、空且identity稳定，清理非recursive、外来文件不能删除。
- reflog身份和文本必须明确策略，不能泄漏任意message或环境身份；不得假装branch+HEAD+Index跨文件原子。
- CAS失败不force、不retry、不回滚，onStart之后一切不可确认结果unknown；前置错误不触发mutation。
- 临时仓库检查Index／Work／object文件不变，只有目标ref及正常reflog允许改变。
- 外部进程竞争、packedrefs、链接／reftable／worktrees等不支持情况必须拒绝或明确支持证据。
