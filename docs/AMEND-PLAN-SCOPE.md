# Amend纯计划范围

状态：纯模型已实现并完成独立拓扑验证，不改ref或提供用户amend。

输入完整raw Index、固定旧HEAD commit body与预期OID，先捕获再核验。新tree来自Index；保留旧commit的原父列表及原author，新committer与消息必须显式提供。root／merge拓扑可纯编码不代表生产事务已支持。

允许仅改消息或committer且tree不变，拒绝最终commitOID完全相同的no-op。计划身份绑定完整rawIndex摘要、旧HEAD／旧tree／父列表、新tree与commit，不接受caller覆盖parents／author。

独立literal拓扑3/3通过：root／normal／merge保持原父列表，原作者精确保留，新committer与消息匹配，不把oldHEAD当新parent。模块21项＋独立3项24/24通过，真实临时Git SHA1／SHA256 root／normal／merge body及tree吻合，独立复核无当前纯模型范围确认缺陷。默认全量捕获1686/1686通过，无失败／取消／跳过／todo；该run启动后新增21项模块测试已独立通过，不虚增全量覆盖。

输出是纯结果非权限，Buffer可变，后续需独立私有capture／预览／旧HEAD条件CAS确认。签名等不支持header拒绝，不偷偷移除后amend。
