# 分支切换目标代际隔离

状态：前端目标生命周期已加固并完成初轮验证，不扩大checkout范围。

选择变化（含同值或A→B→A）、重新读取、取消和关闭使旧prepare／read／cancel／close不能操作新目标或候选。任务active同时核对controller／liveaccess和代际，旧finally不能解除新任务busy。

独立golden先复现1!==0旧目标请求，修正后switch／shared／golden17/17、完整client捕获237/237通过。最终新增8项代际测试＋既有switch16项及独立2项26/26、全部client＋代际／独立246/246通过。独立复核发现pending期finally依赖access导致永久busy，独立golden复现后改owner-only cleanup修复；原响应仍liveaccess。最终重建、隔离Edgebrowser、80文件包与隔离安装通过，不新增全量声明。

确认仍只消费原token且目标OID精确匹配，确认取消／卸载保持unknown；后台授权／dirty／配置guard不改变。
