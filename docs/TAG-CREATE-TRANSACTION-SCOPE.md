# Annotated tag内部确认事务

状态：内部事务已实现并完成初轮完整验证，无Host／RPC／UI。

预览安全摘要绑定私有原始HEAD／config／metadata与目标／tag bytes，一次消费后先复验，再append对象和zero-old创建refs/tags。

后置只允许固定tag对象／fanout、固定ref／log及必要目录变化，既有metadata保留；压缩对象需完整流校验，不能用新基线掩盖外来变化。

独立初版golden重复15s超时保留证据；消除重复public HEAD reader后，Lead发现global effectiveconfig新鲜度回归，补每verify fresh no-includes config与私有baseline比对。修正后独立success／globalconfig2/2及完整确认25/25通过，readonlypreview60/60通过；最终Lead完整确认＋独立success／globalconfig27/27通过，委派confirm＋preview组合86/86及tightened logancestor补充3/3通过，最终优化静态复核无当前范围确认缺陷。不新增全量声明。

开始后任何失败unknownappendOnly，不删除对象／ref、不retryrollback。调用方需writer与授权，外部ABA／路径交换不属全局原子保证。
