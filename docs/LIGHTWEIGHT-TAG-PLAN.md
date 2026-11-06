# Lightweight tag认证目标纯计划

状态：纯计划已实现并完成独立初验，无对象或引用写入／Host／RPC／UI。

固定原始commit body经hash核验后，直接生成refs/tags短名到commitOID的计划；不生成tag对象，不需要tagger或消息，不接受caller ref／force／类型覆盖。

输入commit最多2MiB，短名保持严格portable UTF8边界，输出冻结标量与domain计划ID；目标仓库存在性、引用不存在及用户授权仍由后续事务验证。

独立literal＋真实Git SHA1／256目标oracle4/4通过，verified对象模型组合122/122通过；专用13项＋独立4项完整17/17、与annotated模型组合32/32通过，独立静态复核无当前范围确认缺陷。最终verified对象＋lightweight完整roster135/135通过。不新增全量声明。

与annotated tag是独立语义，不能将本模型完成冒称lightweight用户创建已接通。
