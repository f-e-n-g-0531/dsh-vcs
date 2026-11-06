# 提交引用事务后续要求

纯对象模型不是commit写授权。后续需明确：

- 预览固定当前symbolic branch／old commit／完整Index／配置／身份与消息，tree仅由Index生成，不把Work加入提交。
- Commit body和tree OID确定后，独立确认一次token，发布前仍授权／rawIndexCAS／HEAD-ref检查。
- 新对象追加可能先于ref更新而残留，失败unknown不能GC回滚；ref更新须按oldOID条件CAS，不用无条件写ref或shell。
- 分支ref与HEAD／reflog／packed-refs／lock／worktree关系要按Git事务规范处理，不能只创建commit对象就声称已commit。
- hooks、GPG/SSH签名、commit.gpgsign、自动maintenance、external config等路径不得在默认安全操作中隐式执行；初期拒绝不支持状态并显示原因。
- 结果未知时核对真实branch tip与Index再决策，不重复提交或自动revert；post-update授权丢失也不能称安全取消。

本轮不修改任何用户ref或创建真实用户提交，只验证纯对象编码。
