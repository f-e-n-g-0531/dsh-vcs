# Index快照构建嵌套tree

状态：纯模型已实现并通过针对性验证，不读取Work、不写对象或ref、不提供用户commit。

输入平面普通stage0路径／mode／OID，模型自行校验并构建trie，再自底向上调用精确tree编码。目录排序按Git字节规则，root/tree列表顺序确定；空Index生成真实空tree。

拒绝重复、文件与目录前缀冲突（a和a/b，无论输入顺序）、同目录大小写／Unicode规范化别名（保留原始输出字节，但别名组合拒绝）、.git／dot／dotdot／绝对／反斜杠／ADS／控制字符和不合法UTF8。只支持100644／100755，符号链接和gitlink另行接入，不静默丢条目。

上限：10万条目、路径4096UTF8字节、目录深度64、aggregate tree bodies8MiB、节点有界，超限拒绝。返回各目录独立body／OID，不校验外部blob存在性；后续提交适配器须在授权与快照下确认对象及配置／引用。

## 当前验证

模块12/12与独立nested字节／prefix冲突3/3通过；与commit对象组合28/28通过。真实SHA1／SHA256从parseGitIndex到root与write-tree一致，所有tree body hash-object／cat-file吻合；24种输入排列、路径／节点／aggregate容量边界通过。

当前保守alias策略会拒绝部分Git合法大小写／规范化并存路径，属明确范围拒绝，不静默归一化或丢条目。最终npm默认全量1305/1305通过，无失败／取消／跳过／todo（408.1秒）。尚未导入生产提交适配器或包闭包，不读取Work或移动ref。

真实Git临时仓库SHA1／SHA256 write-tree与嵌套Unicode／executable路径oracle是必要验收，纯模型通过不代替受控refCAS commit事务。
