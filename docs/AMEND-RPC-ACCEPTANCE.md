# Amend协议验收

- 严格两阶段字段在lookup前捕获，preview只committer／message、confirm只token，caller author／parents／OID不可覆盖。
- 授权scope固定，读／写互斥与commit同门禁，生命周期invalidate／dispose／TTL／grantreplacement，确认cache清理。
- amendunknown在inner／outer优先cancel，pre-entry取消确定无写，postdispatch预算unknown明确历史可能已改写。
- commit与amend token双向隔离且不消耗对方合法token。
- 真实Host root amend无parent、保留原author，新tree=Index、Work／Index保持。
- 不改UI、不自动stage／push，无一般Git兼容或外部进程全局原子承诺。
