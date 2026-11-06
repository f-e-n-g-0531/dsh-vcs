# Tag引用条件创建验收

- realtag对象hash／内部tag名与ref一致，目标rawcommit存在且认证，不能用commitOID或nestedtag替代。
- refs/tags与logs namespace absence含prefixcase，zero-old实际竞争不覆盖；现有ref在start前拒绝。
- HEADraw／currenttip／logs／Indexstat保持，objects无写，dirtyWork不checkout；hooks不执行。
- poststart失败unknown无retryrollback，观察非外部原子隔离；当前Git symbolic竞争以真实fixture证据为准。
