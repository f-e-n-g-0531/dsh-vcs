# 只读删除评估草稿代际

独立测试复现same-value与A→B→A之后旧评估按钮仍发RPC（1!==0）；原按name字符串相等不足以隔离旧代际，旧cancel还可清新结果。

新增generation与same-value强制rerender，edit／cancel／pendingblocked清理推进代际，旧评估／cancel入口拒绝。response还校验当前controller和代际，cleanup仍owner-only，不因blocked永久busy。

纯只读，无token／删除确认／unknown写入，proof分页保持。修正后专用新增2＋既有14项16/16、完整client＋新golden238/238通过；独立静态复核无当前范围确认缺陷。构建、隔离Edge完整browser、80文件包与隔离安装通过；不新增全量声明。
