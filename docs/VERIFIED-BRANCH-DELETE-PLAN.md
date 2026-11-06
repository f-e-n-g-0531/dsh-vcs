# 已核验commit对象集合的删除计划

状态：纯组合模型已实现，不删除引用，无Host／RPC／UI。

每个图节点提供完整固定OID与原始commit body；全部有界Buffer捕获后逐个复算Git哈希，并只从严格header提取parents。禁止caller parents／merged／force覆盖，再调用闭合图安全删除模型。

上限：10000对象、每body 2MiB、合计16MiB，缺失／重复／异常header或不支持签名明确拒绝。消息仅参与完整hash，不参与祖先判据。

独立SHA1／SHA256 raw-parent golden2/2及相邻模型／parser组合108/108通过，caller parents注入与原body篡改拒绝。完整专用54项＋独立2项56/56、与既有模型／parser组合158/158通过；独立静态复核无当前范围确认缺陷。默认全量捕获2226/2226通过，无失败／取消／跳过／todo；启动后新增54项专用测试独立完整通过，不虚增覆盖。尚未读取真实仓库图或执行删除。

哈希核验只证明给定对象图的内容身份，不证明当前分支指向、目标ref新鲜度、工作树占用或用户授权。后续仓库capture和条件删除必须独立实现；proof不是删除能力。
