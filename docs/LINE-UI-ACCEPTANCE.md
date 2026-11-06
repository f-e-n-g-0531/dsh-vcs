# 逐行界面独立验收

- 固定LineStage／LineUnstage工厂的action与endpoint，不接客户端任意direction。
- raw-line-selection-v1和sourceAlgorithm均正确，unit与operation有界；operations按unit顺序、先全部delete再insert，每个kind／unitId／unitOffset／beforeLine或afterLine／text／terminator必须精确对应原unit，不允许重复／遗漏／跨块描述。
- 每个操作checkbox显示删除当前Index或插入Work／HEAD目标行、真实换行，1基坐标。只选insert明确保留旧行并在块末目标顺序插入，不暗中配对替换。
- 计划与候选action／path／head／index／planId／所选operationIds精确绑定，最多8000；确认只token，改选重plan。
- 计划和候选TTL分开，消费后错误不可重用旧planToken；unsafe拼接服务端拒绝后须replan，不显示为可执行整块fallback。
- 全6类Index确认共用同步repository pending和unknown，旧handler竞争／scope变更／取消不能绕过。
- 输入／candidate容量拒绝、BOM／EOF／EOL语义、append-only合成对象与完整W复验准确披露。
