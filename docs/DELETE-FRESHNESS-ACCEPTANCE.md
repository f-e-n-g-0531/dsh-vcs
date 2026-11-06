# 删除低开销屏障验收

- 一次完整HEAD认证后每fresh／deleted fresh有效no-includes配置，原始prepare baseline不替换。
- rawHEAD／currentbranchOID／localconfig与全部metadata贯穿，删除只targetref／log与空祖先prune例外。
- finalauth global／system配置变化应unknown，preauth变化具体拒绝，对象／Index／hook／lock变化保留拒绝。
- pending授权受共同deadline，start边界unknown不更改，不提高生产15秒预算。
- applyGit启动数确定性上限回归，有-c前缀正确统计，不以fixture总耗时推断生产耗时。
