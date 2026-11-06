# Unstage接入前复核待办

内部适配器33/33真实Git针对性测试已通过，但独立复核提出以下具体接入前修正项，不能据通过数直接开放RPC：

1. 已将当前整操作budget捕获进index-lock的checkAbort，每次显式signal检查同时执行budget.throwIfExpired。这样最终异步CAS后、rename前也观察budget取消，不依赖适配器回调。新增不直接传给锁的ambient取消回归通过，确认不rename且start后仍按未知语义返回；原35项锁回归通过。
2. 已将元数据guard key保守统一为小写，forbidden集合、lock／promisor后缀和hooks规则一致匹配；物理路径与指纹保留原拼写，自有锁只豁免精确index.lock。真实协调器集成补入objects/info/Alternates、SHALLOW、混合大小写.PROMISOR拒绝后仍成功取消暂存，1/1通过。

本记录为内部开发检查，不是已发布漏洞声明。修正后更新验证证据；无需修改系统Git配置或用户仓库。
