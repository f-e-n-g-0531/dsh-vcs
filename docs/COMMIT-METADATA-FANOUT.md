# Commit／amend metadata扇出限额预判

状态：局部限额预判已实现并完成针对性回归。

metadata原有总节点上限20000（含.git根）不变；目录直接子项数大于剩余额度时，在sort／逐项lstat之前拒绝。每个子项至少消耗一个节点，因此属于必超限的提前拒绝，不提高限额、不跳过关闭屏障。

独立commit／amend mocked-fanout测试验证根已消耗1项、20000直接子项必超限，0childstat／0Git调用；与settledread组合4/4通过。并行workPolicy sibling仍由allSettled完整收齐后返回错误。

初轮广覆盖捕获回归中两项旧command observer把新--git-dir／--work-tree误认subcommand而失败，observer按精确参数过滤修正；最终fanout／capability／consume40/40通过，既有preview其余场景初轮通过。静态复核无当前范围确认缺陷，build／85文件包与隔离安装通过。

不改变配置子集或生产15秒预算，不推断默认全量先前13deadline失败已修复。
