# Amend预览／确认RPC

状态：候选两路协议已接入并验证，无amend界面。

vcs/amend-prepare仅sessionId／repositoryId／committer／message，禁止author／parents／HEAD／tree覆盖；原作者和拓扑来自固定旧HEAD。vcs/amend-confirm仅地址和单次amend token，namespace独立于commit／Index／branch。

准备持reader且只读，确认持通用writer；grant／Session／cwd／repo绑定与返前授权保持。历史改写开始后不确定结果报amend-outcome-unknown，可能对象已追加或tip已替换，须核对HEAD／Index不重试或回滚。

独立真实生产Host root amend验证通过：保留原author和无parent拓扑、tree=Index，Index／不同Work保持，重放拒绝；真实Host与契约5/5、amend／commit／latest协议组合22/22通过。独立静态复核无当前RPC范围确认缺陷。独立契约初期沿用通用字段错误预期已更新，生产行为未改；最终amend RPC12/12（含实际默认Host）通过；构建、67文件包检查与隔离安装通过，npm默认全量1788/1788通过，无失败／取消／跳过／todo（422.0秒）。

严格仓库范围和外部竞争限制沿内部事务，当前协议不代表GUI更新或正式发布。
