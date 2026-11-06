# 认证commit到annotated tag纯计划

状态：内部纯计划已实现并完成独立oracle验证，无ref写入／Host／RPC／UI。

原始commit body先owned capture并核验目标OID，从已认证commit固定目标，type始终commit；tag／tagger／消息严格编码，planID绑定format／目标／tag对象OID／ref。

结果对象body为owned字节但仍可被调用方修改，后续publisher必须重算对象hash／语义再发布，不能只信planID。目标存在性、ref不存在条件及Session授权未由纯计划证明。

独立literal fixedtarget2/2、真实Git commit→tag SHA1／256 oracle2/2及相邻模型组合40/40通过；静态复核无当前范围确认缺陷。专用12项＋独立4项完整16/16通过，verified对象／tag storage捕获组合143/143通过；本批不新增全量声明。

支持严格未签名SHA1／SHA256子集，原commit2MiB／消息64KiB／tagbody128KiB；不执行签名工具，不force覆盖。
