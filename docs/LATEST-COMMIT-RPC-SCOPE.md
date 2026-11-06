# 最近提交只读RPC

状态：候选只读Host已接入并验证，未接消息复用界面或amend。

vcs/latest-commit只接受sessionId与已发现repositoryId，严格own-data字段在首次await前捕获，无getter／额外路径／任意OID或ref。Gitonly，固定授权仓库root投影给只读适配器，持共享readlock并在返回前再授权。

返回固定HEAD／ref／format／tree／parents／author／committer／精确message与messageBytes，不含修改权限或确认token。取消／timeout是只读失败，不映射为mutation unknown。

独立真实生产Host读取HEADmetadata而非不同Index／Work通过，Index／对象／HEAD／Work保持。独立endpoint契约初期误用通用unknown-field错误文案，已按latest专用精确字段错误更新，生产行为未改。latest RPC／commit RPC／契约组合18/18、真实Host与契约5/5通过；独立静态复核无当前Host范围确认缺陷。构建、65文件包闭包与隔离安装通过，最终RPC8/8通过，默认全量1673/1673通过，无失败／取消／跳过／todo（394.8秒）；包含持久Session授权补充测试。

配置与header严格子集沿适配器，签名等仍拒绝；UI后续复用消息需用户明确动作，不能自动amend。
