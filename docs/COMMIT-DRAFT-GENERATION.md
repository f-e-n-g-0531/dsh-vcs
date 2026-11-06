# Commit草稿代际隔离

状态：前端生命周期已加固并完成初轮验证，不改变后端提交权限。

作者／committer／message编辑、清草稿与显式复用最近消息废弃旧prepare／cancel闭包；same-value编辑与A→B→A仍新代际，旧candidate不能复用。

独立golden先复现1!==0旧prepare提交，修复后commit／latest＋golden49/49、全部client237/237通过，静态复核无当前范围确认缺陷。构建、隔离Edge实际身份A→B→A／clear／same-message reuse、80文件包与隔离安装通过；不新增全量声明。

confirm／ack原snapshot身份检查保持；最近提交只读取消不清草稿、candidate或ack，不误判unknown。
