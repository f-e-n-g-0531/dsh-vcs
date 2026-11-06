# Lightweight tag私有确认事务

状态：内部事务已实现并完成独立初验，无Host／RPC／UI。

只消费服务器issued预览摘要身份，固定HEAD／短name／ref与原始metadata，失败也烧毁。授权前后fresh原HEAD／config／命名空间核对，effective全局配置每屏障重读比对，不扩大15秒预算。

仅条件创建固定ref，后置只允许目标ref／optional审计log与必要祖先目录变化；不创建对象，其他metadata原版本保持。poststart unknown无retry／rollback／删竞争引用。

独立真实Git fixedtarget／replay1/1和finalauth effectiveglobalconfig1/1通过，既有readonly preview51/51通过。最终专用54＋独立2项56/56通过，包含pre／各auth stale、finalglobalconfig／auditlog／目标重建、direct／symref竞争与pendingauth预算；静态复核无当前范围确认缺陷。首轮instrumentation前缀计数与Windows readonlyobject fixture失败已修正并保留记录，不新增全量声明。

callerwriter和授权来源仍必需；外部ABA／hostile路径交换非全局原子保证。
