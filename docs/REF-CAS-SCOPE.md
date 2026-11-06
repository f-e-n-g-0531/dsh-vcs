# 本地分支引用CAS基础

状态：内部原语已实现并通过针对性验证，未接用户commit。

只更新固定既有本地分支，必须验证当前symbolic HEAD指向该ref、旧OID仍相等、新OID为完整固定commit。Git update-ref采用oldOID条件CAS，不允许force／无条件更新。

引用事务hook须明确禁用，不能在用户仓库执行reference-transaction脚本；隔离自有空hooks目录只在按身份安全核验后使用和清理。

同步onStart先于mutation子进程，之后取消／失败／授权丢失／CAS失败均保守unknown，不自动重试／reset／删除对象或清锁。调用方仍须持共享仓库writer互斥并绑定完整提交快照，原语本身不提供Session授权或提交权限。

当前采用固定Dsh <dsh@localhost> machine reflog记账身份与固定消息，不作为用户author／committer归属；拒绝packed-refs，适用范围是既有loose直接分支。外部symbolic竞争限制见[竞争边界](<REF-CAS-RACE-LIMITS.md>)。

独立真实Git golden1/1通过：oldOID条件更新成功一次，旧值重放拒绝，Index／Work／对象目录保持。独立复核发现committer.name／email可优先于user.*覆盖固定reflog身份，已添加命令级committer.*覆盖并补充恶意配置回归。初始两项测试在故意破坏packed-refs／commondir后用Git读HEAD作为oracle失败，已改为raw ref不变核对。模块48/48通过，真实SHA1／SHA256 hook不执行且仅refs／logs变化。先前清理测试按全局temp前缀找目录造成并发误认，现前缀含process.pid隔离；同步onStart返回拒绝Promise也已挂catch避免unhandled。此前全量1480/1480通过，最终这两处收尾变更后稳定源码npm默认全量1480/1480再次通过，无失败／取消／跳过／todo（373.3秒）。

只在临时测试仓库验证，实际用户提交入口未开放。
