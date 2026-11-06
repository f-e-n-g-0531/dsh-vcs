# 私有快照分支创建事务

状态：内部事务已实现并通过初轮验证，无创建分支Host／RPC／UI。

只消费prepare发放的精确摘要WeakMap，固定原name／ref／HEAD起点，先烧毁再复验。错误仓库／克隆／重放／陈旧HEAD与配置或namespace拒绝，不允许caller替换起点。

确认沿条件创建原语，成功后仅允许目标ref／新日志／必要祖先目录变化，原HEAD与既有引用日志保持；不checkout，不改Work／Index或对象。

独立真实Git golden1/1通过：issued快照创建固定HEAD分支，HEAD／rawIndex／不同Work／对象保持，重放拒绝。初轮确认组45/45与旧preview75/75通过，独立静态复核无当前范围确认缺陷。默认全量捕获1994/1994通过，无失败／取消／跳过／todo；之后新增7项finalauth突变与target版本pin已独立验证，最终完整51/51模块复验通过，不虚增该次全量覆盖。

开始后不确定均unknown，不重试／回滚／删竞争引用。调用方需持共享writer，外部进程原子隔离与版本后端限制明确保留。
