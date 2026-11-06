# 内部amend确认事务

状态：内部事务已实现并通过初轮验证，无amend Host／RPC／UI。

applyAmendPreview仅消费amend私有WeakMap，普通commit摘要不得授权amend，反向亦然；先烧毁后复验原始HEAD／Index／配置／metadata及重建amend planID。

保留原author／parents，固定候选对象追加后，仅准许精确自有对象metadata变化；oldHEAD条件CAS替换tip，不创建oldHEAD为parent的子提交。原始Index与不同Work保持。

独立真实Git golden1/1通过：root message-only amend替换tip、仍无parent、不把oldHEAD接作parent，原author／rawIndex／不同Work保持；normal commit API拒绝amend摘要、重放拒绝。初轮amend／normal确认组34/34通过；实现方扩展SHA1／SHA256×root／normal／merge×staged／message-only完整矩阵及失败guards，组合47/47通过，新增late压缩suffix1/1另行通过。默认全量捕获1744/1744通过，无失败／取消／跳过／todo；启动后新增测试单独核验，不虚增全量覆盖。最终完整amend文件31/31通过，无失败／取消／跳过；独立静态复核无当前内部事务范围确认缺陷。

开始后的撤权／取消／CAS失败统一amend-outcome-unknown，不自动重试／reset／删除对象／GC回滚。调用方writer互斥、loose分支／既有reflog及外部竞争限制沿commit事务，未获一般历史改写权限。
