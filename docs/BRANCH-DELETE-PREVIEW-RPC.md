# 分支删除只读预览RPC

状态：候选只读协议已接入并完成初轮验证。

仅vcs/branch-delete-preview，参数Session／repositoryId／name，服务器固定current／target并认证mergedproof。返回新公开摘要，无token或执行能力；不注册branch-delete-confirm，也不从vcs导出applyBranchDelete。

Gitonly、strict own-data prelookup snapshot、reader锁及授权后检查，超限／未合并／不支持对象明确拒绝。

独立actualHost＋field contract5/5通过：无token、目标ref／HEAD／rawIndex／Work保持，confirm路由不存在。静态复核无当前范围确认缺陷。构建通过，package初轮显式source allowlist缺两图模块失败，按精确runtime文件补齐后74文件检查及隔离安装通过，未开放整个src。

专用10/10、与actualHost／契约／create组合35/35、全部RPC roster143/143通过；本批未新增全量通过声明。

运行时闭包包含preview及其内部条件删除依赖，但不等于注册远程写入口。外部rawref竞争限制未解决，因此本轮仅开放评估。
