# 不覆盖分支创建验收

- refs/heads完整安全UTF8名、目标commit固定存在，new分支此前不存在；实际zero-old CAS防止检查后竞争覆盖。
- no-deref不写symbolic目标，loose／packed碰撞和目录前缀冲突拒绝。
- HEAD原始symbolic字节／tip保持，Index／Work／objects不变；只允许目标ref及其日志／必要目录新增。
- 事务hook绝不执行、固定受控审计committer，ownedempty hook目录清理不伤外来内容。
- 现有target明确无start拒绝，onStart后竞争CAS失败unknown不删对方ref；cancel／authloss不重试或回滚。
