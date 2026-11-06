# 分支创建草稿代际隔离

状态：前端候选生命周期已加固并完成初轮复验。

编辑短名（含同值编辑与A→B→A）或取消使旧prepare／cancel闭包失效，不能提交旧name或清新候选。代际与controller身份双检，迟到响应不得覆盖当前candidate。

独立golden先复现1!==0的旧prepare提交，修正后与branch／tag组件30/30通过；最终专用新增4项，branch／tag＋独立golden34/34通过；完整client roster初轮205/205，最终补充后209/209通过，静态复核无当前范围确认缺陷。构建、隔离Edge当前UI A→B→A／取消后重新ack／迟到读结果隔离、80文件包与隔离安装通过。不新增全量声明。

不改变token确认协议和后端创建范围，readonly取消不锁unknown，已发confirm取消仍unknown。文件选择不改变scope，Session／repo／mode／refresh／scan维持原失效策略。
