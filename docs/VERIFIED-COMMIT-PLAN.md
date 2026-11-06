# 已核验父对象的Index提交计划

状态：纯组合模型已实现，不读取仓库、不写对象或ref。

输入raw Index和raw parent commit以及固定预期parentOID。两份Buffer先复制，再读取普通own-data参数；parent commit必须完整哈希匹配且满足严格header语法。parentTree仅来自已核验body，不接受独立parentTree覆盖。

派生树与Index计划身份包含固定parentOID／parentTree／rawIndexDigest／新tree与commitOID。父消息中的tree字样不影响依赖关系；错OID、篡改body、未知header或空提交拒绝。

## 当前独立golden

两份输入Buffer在signal callback修改前捕获2/2通过；parentTree来自header而非消息，caller覆盖与body篡改拒绝。最终组合模块＋独立golden16/16通过，真实临时Git SHA1／SHA256核验且HEAD不变；相邻六文件44/44通过。默认全量捕获1380/1380通过，无失败／取消／跳过／todo；该次启动后新增的14项组合模块测试另行16/16针对性验证，不冒称均包含于1380计数。独立静态复核无当前纯组合范围确认缺陷。

这只证明输入parentbody与OID一致，不证明它是当前授权分支HEAD，也不证明外部tree／blob存在。后续真实仓库capture和refCAS仍需独立实现，未提供用户commit。
