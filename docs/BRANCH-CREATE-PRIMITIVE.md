# 本地分支不覆盖创建原语

状态：内部基础已实现并通过针对性验证，无创建分支RPC／界面。

从固定已存在commit创建明确refs/heads名称，必须不存在；实际Git引用事务携带全零oldOID实现不存在条件更新；当前Git2.56真实验证也拒绝悬空symbolic目标，其他版本／引用后端须独立核验，不自动checkout或修改HEAD。新分支名不是任意revision表达式。

禁用引用事务hook，固定machine reflog审计；canonical embedded／loose refs等严格范围保持，packed／shared／links／锁／外部配置等拒绝。开始后CAS冲突、取消或撤权均unknown，不删除竞争引用，不重试或回滚。

模块＋独立preservation／dangling characterization58/58通过。初期cloned CAS残留expectedOid未定义使前置失败，已修正；postwrite测试把HEAD误当目标分支已修正oracle。静态悬空symbolic竞争推断经Git2.56复现未成立，按真实拒绝证据记录不虚报缺陷。最终模块扩展63/63通过；npm默认全量1874/1874通过，无失败／取消／跳过／todo（468.5秒）。尚未导入生产包或注册RPC／UI。

调用者必须持共享writer与授权；原语不授予Session权限，不改变工作文件／Index或创建对象。
