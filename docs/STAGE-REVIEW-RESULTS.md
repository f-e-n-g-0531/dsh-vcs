# Stage内部复核记录

状态：未接入stage RPC／用户界面，不是发布声明。

独立最终授权回归发现：blob追加成功后，Index锁的最终授权回调改变工作文件，适配器仍先发布Index，随后postcheck才返回未知。虽然未伪装为成功，但未满足可观察到的发布前变化必须阻止Index写入。测试在临时仓库复现，原Index字节确已改变。

已修正：新增独立indexPublishStarted标记，在每次publish前授权之后完成完整快照复验；不因blob mutationStarted而跳过。独立回归1/1通过，观察到的最终授权变化在rename前拒绝、原Index字节保持、已追加blob保留，仍返回未知，不自动删除对象。

其他metadata允许差异仍严格限于精确新对象与必要fanout，详见[验证清单](<STAGE-VALIDATION-CHECKLIST.md>)。

相邻stage／unstage／selector／token回归82/82通过。首次全量837项中836通过，1项blob post-temp deadline夹具在高负载下提前耗尽50ms，未到目标注入点；生产按预算安全停止。将该测试改为临时文件已确认后精确注入TIMEOUT，不增加生产预算；独立真实ambient deadline测试保留。精确注入后blob聚合41/41再次通过；最终全量837/837通过，无失败、取消、跳过或todo。

因共享适配器新增blob模块导入，同步将其纳入运行时包闭包；构建、47文件包检查及生产依赖隔离安装／stub宿主注册通过。Stage固定包装器本身尚未接入RPC／用户界面。
