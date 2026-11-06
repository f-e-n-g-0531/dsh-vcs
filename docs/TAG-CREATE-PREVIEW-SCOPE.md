# 当前HEAD annotated tag只读仓库预览

状态：内部预览已实现并完成独立真实仓库初验，无对象／ref写入，无Host／RPC／UI。

仅name／tagger／message，服务器固定当前HEAD为commit目标，核验原始body后构建tag计划；refs/tags及对应日志命名空间必须无碰撞。

完整metadata／rawHEAD／config稳定观察、严格仓库子集、共享15秒与2万metadata限额，不读取Work／Index正文，不创建temp／对象。

独立真实Git Unicode嵌套tag预览golden1/1通过：HEAD固定、无objectbody公开、无任何metadata目录／rawIndex改变；tagplan／publisher组合45/45通过。初轮专用矩阵＋独立golden58/58通过，补充wronghash／真实malformed／signedtarget后最终61/61通过，与完整tag纯模型组合捕获91/91通过，包含SHA1／256、collision／prefix／case／packed、staleHEAD／config／objects／最终closure、fanout限额与取消。独立静态复核无当前范围确认缺陷；本批不新增全量声明。

返回安全摘要tagOID／planID／targetTree及元数据，不返回body或执行能力；不覆盖、不签名、不push。外部并发原子性未承诺。
