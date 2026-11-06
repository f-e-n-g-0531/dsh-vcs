# Amend专属确认协调器

状态：内部Host适配器已实现并通过针对性验证，未注册amend RPC或界面。

固定amend operationKind，不接受caller author／parents／mode覆盖。prepare只捕获Session／repo地址、显式committer与消息，旧author与parents来自服务端已核验HEAD。公开摘要显示旧HEAD／previousTree／parents与新tree／commit，不暴露对象Buffer。

confirm token独立于commit／Index／branch，默认60秒／32项，绑定entry／repository对象／cwd／Session，消费前后授权和共享writer互斥沿通用协调器。开始后错误报告amend-outcome-unknown，可能历史已替换或仅追加对象，不retry／rollback。

独立同binding token隔离golden通过；amend／commit协调器组合25/25通过，包含TTL／容量／binding／授权／互斥和unknown。最终amend14项＋独立golden／commit组合27/27通过，独立静态复核无当前范围确认缺陷。npm默认全量1776/1776通过，无失败／取消／跳过／todo（418.2秒）。

该层仍是内部工厂，不替代实际Session授权，尚无用户amend入口。
