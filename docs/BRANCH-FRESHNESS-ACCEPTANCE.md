# 分支创建低开销复验验收

- private original capture覆盖完整.git metadata（objects／hooks／Indexstat），新增fanout上限预拒绝；不能只refs/logs而漏原publicreader检查。
- prepare及apply固定effective config baseline，每verify fresh no-includes pinnedconfig，授权后global／system变化拒绝，rawHEAD与currentbranch精确原OID。
- 仅新ref／日志及必要祖先dirs例外，旧对象／Index／config／HEADlog版本不变，postfinalauth重复验证。
- 实际Git启动数以带-c前缀args正确统计，验证减少重复进程，不改生产15秒预算。
- 克隆／重放／并发token／writer语义保持。
