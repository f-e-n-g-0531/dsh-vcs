# Tag原生取消原因契约

当前源码已正确分离native AbortSignal品牌getter与throwIfAborted，本轮不重复修改生产。新增独立SHA1／SHA256 × parser／annotatedplan／lightweightplan矩阵。

提前取消reason为string／number／null／plainobject／Error／Symbol时严格保持同一值；原生aborted／reason／throwIfAborted实例getter覆盖不得执行。active信号覆盖同样不执行；受控合作式第二检查抛原因原样保留。

专用12/12、tag parser／两类plan／发布组合75/75通过，不代表API传输可序列化任意reason或异步中断同步算法；仅纯模型原生语义验证。verified模型完整组合143/143通过，独立静态复核无当前范围确认缺陷。本轮仅增加测试与记录，生产代码无需修改。未改变写权限／预算，不新增默认全量通过声明。
