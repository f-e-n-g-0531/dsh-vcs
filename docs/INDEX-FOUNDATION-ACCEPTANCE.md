# Index写入基础验收

本模块仍是内部基础，不是stage／unstage用户能力。设计见[写入边界](<INDEX-WRITE-DESIGN.md>)。

## 规范依据

- [Git index format](https://git-scm.com/docs/gitformat-index)：DIRC、网络字节序、v2／v3条目、SHA1／SHA256与扩展。
- [Git racy index](https://github.com/git/git/blob/master/Documentation/technical/racy-git.adoc)：Index重写后的stat缓存失效问题。

## 必须通过的独立判据

1. 真实Git生成的v2／v3及SHA1／SHA256索引可解析；候选只修改固定路径的已确认mode／OID，其他路径／stage／flags语义保持不变。
2. TREE／EOIE／IEOT不以旧缓存进入候选；Git在临时alternate index上write-tree所得树必须包含新OID，而不是复用旧树。
3. 不依赖工作文件时间戳来判断目标OID更改；目标stat失效。未来live publish也必须处理未选条目的racy-clean缓存，避免新Index时间掩盖工作修改。
4. 所有padding残余长度、UTF8字节数、排序与重复、路径别名、flags、版本、count、checksum、扩展长度等负例失败关闭；合法skipHash索引明确不支持。
5. 自有index.lock使用排他创建；外部锁不改、不删除；原Index全量CAS，锁身份替换拒绝，发布只做同目录rename，不先删除旧Index或盲重试。
6. 发布前取消清理自有锁，发布开始后无法确认的结果标记未知；保留其他进程Index变化，不自动回滚。
7. callback能力不在作用域结束后继续使用；未等待的异步操作不能逃逸清理，也不能在出错后继续发布。

## 当前状态

自有锁27项针对性测试通过；独立新增候选内容捕获、同inode篡改、callback结束后的能力撤销及重复发布测试。复核发现的延迟Buffer拷贝与pending链逃逸已修正，并增加发布前候选digest和发布后实际字节复验；这些仍不提供对恶意文件系统的全局原子隔离。纯模型13项针对性测试通过，含真实Git SHA1／SHA256、v2／v3 alternate index验证。补入Git write-tree／diff-files判据后，纯模型与锁基础聚合48/48通过；全量682/682通过，无失败、取消、跳过或todo。随后将重复扩展检查改为Set保持线性，3项缓存／扩展针对性回归再次通过。补充SHA1／SHA256真实candidate+lock组合2/2和全偏移截断／重校验恶意count／扩展长度3/3通过。尚未接入RPC、客户端或正式包；不从这些基础模块的存在推导为完整Fork暂存能力。
