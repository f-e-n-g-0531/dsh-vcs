# 分支切换旧目标准备复现

独立memory golden先选B保存prepare，再改为无目标，调用旧prepare仍发一次B请求（1!==0）。这是前端意图错位，不声称能绕过服务端checkout确认或权限。

修复需同值选择与A→B→A代际隔离，取消／关闭／重新读取都使旧入口失效；late列表／preview错误和finally不能操作新任务。

原confirm仍必须originalsnapshot tokenidentity与目标ref／OID匹配，unknownshared门禁保持。
