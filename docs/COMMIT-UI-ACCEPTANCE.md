# 提交界面独立验收

- 所有字段显式可见：两组name／email／epoch秒／timezone＋message；不从环境默填隐藏身份。
- prepare响应action、format、OID宽度、ref、digest、token／expiry与提交metadata逐字段精确匹配，尤其author与committer不能互换或省略timestamp。
- 修改form同步丢弃candidate和ack；旧handler不能确认，过期重preview。
- confirm仅token，成功返回head／ref／tree／indexDigest必须与candidate完全一致；不可信结果一律unknown。
- prepare取消／unmount忽略late response，无写；confirm取消／unmount先锁定仓库unknown，跨mode选中文件仍保持。
- 父候选状态清楚，只提交Index不stageall/amend/push。七类确认共享同步pending gate与unknown，旧handler竞争不得发两底层请求。
- 文案披露仅严格配置子集、外部竞争非全局原子及append-only残留，UI不冒称所有Git commit支持。
