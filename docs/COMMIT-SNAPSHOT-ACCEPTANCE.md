# 私有快照一次性复验验收

- 原始摘要对象的WeakMap身份才可消费，JSON克隆／spread重建／其他仓库／其他操作不能复用。
- consume入口同步取出并删除grant，错误参数／撤权／取消亦烧毁，不因失败重试同一摘要。
- author／committer／message公开冻结只作显示，内部captured图不泄露Buffer，调用方改摘要不获能力。
- 在第一次授权之前与最后一次授权之后均核对原始完整fingerprint，HEAD／rawIndex／config／metadata变化拒绝；不能以fresh状态重建后替换baseline。
- prepare和consume都不调用typed store或refCAS，不创建object／lock／ref／reflog。
- Work正文不读不绑定；只读commit内容取Index，不声称工作区内容快照。
- 有效consume只是当前只读preflight，无Session／writer门禁／事务执行权限，后续写链必须重验。
