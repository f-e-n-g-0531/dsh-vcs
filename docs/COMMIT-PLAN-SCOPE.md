# 固定Index提交计划

状态：纯组合计划已实现并通过针对性验证，未授权任何提交写操作。

从完整raw Index快照校验checksum／stage0／扩展，构建完整嵌套tree；固定单一已出生父提交、父tree、author／committer与消息，生成精确commit body／OID。当前仅普通文件模式，不允许未合并／split／sparse或未知扩展，不从工作文件生成提交。

计划身份须绑定raw Index digest、objectFormat、父提交／父tree、最终tree和commit。父tree与新tree相同拒绝空提交；初期不支持initial／amend／merge／签名／hooks，消息精确UTF8且非空白。

返回的纯计划不是Session权限，也不证明父对象真实存在。后续Host保存私有内容并在确认前验证依赖对象、配置、授权与完整状态，追加对象后再以oldOID条件refCAS。当前不写对象、不更新分支、不提供用户commit。

## 验证

模块及独立binding／getter测试17/17通过，真实临时Git SHA1／SHA256 Index→write-tree、exact commit-tree body／OID一致且不移动refs。raw stat改变不改tree／commit，但改变rawDigest和planID；message改变commit／planID。

独立测试最初复现身份getter多次读取与late signal getter修改message；已收紧inputs／identity plain own-data descriptor，拒绝getter不执行，复制rawIndex后捕获message再检查signal。输出Buffer可变并非私有权限。最终npm默认全量1362/1362通过，无失败／取消／跳过／todo（479.9秒）。纯模块未接入生产包或提交权限，父commit→tree真实关系仍须后续验证。
