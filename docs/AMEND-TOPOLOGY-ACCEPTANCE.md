# Amend拓扑验收

- normal commit创建以旧HEAD为parent的新子提交；amend创建替代旧HEAD的提交，parent列表必须是旧commit原parents。root仍无parent，merge保留全部有序parents。
- author姓名邮箱／原epoch／原timezone精确保留；newcommitter显式，不默认借旧committer。
- tree来自完整raw Index，允许tree不变而message／committer改变；新OID等于旧OID才算完全no-op。
- ID绑定rawIndex与固定旧HEAD及原拓扑，messageheader-looking文本不能伪造author／parents。
- signedparent／unknownheaders严格拒绝，不将移除签名称为已验证amend。
- pure metadata支持root／merge不等于事务已授权改写；后续有独立operationKind／token／warning和oldHEAD CAS。
