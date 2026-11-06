# 认证tag对象发布适配层

状态：内部append-only适配层已实现并完成独立初验，无refs/tags／Host／RPC／UI。

捕获目标commit与tag原始body，发布前复算hash和严格header，tag.object必须匹配已认证commitOID。计划ID或mutable输出body不能替代重新核验。

只存tag对象，不创建target／ref；已有有效对象无需onStart。开始后失败append-only unknown，不删除对象、自动GC或重试。

独立SHA1／SHA256输入callback篡改golden2/2通过，与tag store／commitpublisher／verifiedplan组合80/80通过。全部相关tag模型／store／commitpublisher组合138/138通过；静态复核无当前范围确认缺陷，专用26项＋独立2项完整28/28通过，包含真实Git SHA1／256 cat-file、已有对象nostart、target不匹配与body篡改preauth拒绝、postpublication取消／撤权保留对象unknown；本批不新增全量声明。

提供的target bytes认证不证明它已经存在当前仓库；后续仓库事务仍需独立target存在性、ref不存在及授权验证。
