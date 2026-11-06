# 私有已合并分支删除事务

状态：内部事务已实现并完成专用复验，无删除Host／RPC／UI。

已认证merged预览摘要绑定WeakMap原始仓库／HEAD／target／配置／metadata；apply先消费后复验，克隆／重放／crossrepo／caller覆盖拒绝。

确认前复验原基线与当前commit身份；条件删除固定target oldOID，后只允许目标ref／log及必要空祖先目录消失，既有其他metadata保持。

独立真实Git golden1/1通过：issued merged快照删除后HEAD／rawIndex／不同Work／objects保持，重放拒绝。默认全量捕获2461/2461通过，无失败／取消／跳过／todo（525.4秒）；专用测试随后新增，未虚增该计数。首轮专用失败包含Windows loose object只读属性导致fixture EPERM，以及原3秒deadline未进入onStart的时序断言；fixture已chmod再变更、deadline按实际onStart边界验证，未增加生产15秒预算。最终完整专用46/46通过（251.9秒），既有preview85/85与独立golden1/1通过；专用最终结果为委派执行回报，Lead初轮组合46/47失败已如实保留，不冒充独立重跑。

开始后任何失败unknown，不重试／回滚／重建分支。必须caller共享writer与真实授权；不保证原始ref类型外部竞争CAS，见[实测限制](<BRANCH-DELETE-RAW-REF-RACE.md>)，不能把本层当一般安全删除用户入口。
