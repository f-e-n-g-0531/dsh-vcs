# 创建分支预览验收

- 请求仅短名，不允许headOID／startpoint／ref／root等替换；own-data preawait捕获。
- 起点只来自hashverified当前HEAD，currentRef与targetOID同时固定，返回safe frozen摘要。
- 目标refs和logs无碰撞／目录前缀冲突，metadata与rawconfig／HEAD稳定；不创建必要目录，不留锁／temp。
- 两次readLatestCommit之间配置更改即使head不变也拒绝，不把新的policy状态当旧基线。
- 名称原始UTF8保留、禁止control／Cf／Windows别名／.lock／dotdot；外部ref竞争仍要后续创建CAS保障。
