# 提交Host确认协议

状态：候选Host两路协议已接入，显式提交候选界面已接入验证中，无正式发布；见[用户范围](<COMMIT-USER-SCOPE.md>)。

vcs/commit-prepare仅接受sessionId、repositoryId、author／committer（name、email、timestamp、timezone）与message，所有metadata own-data严格有界。身份显式提供，不隐式借用OS环境；服务器复验内容与仓库配置／rawIndex／固定父对象，保留私有快照。

vcs/commit-confirm仅接受sessionId、repositoryId、单次token，不能替换消息／身份／OID／树／路径。固定commit操作类型与其他变更token隔离，60秒／32项默认，绑定grant／Session／cwd／repo对象，确认持共享writer。

确认开始后中断／撤权／budget不确定均commit-outcome-unknown，可能留下对象或更新ref，须检查HEAD／Index，不重试或回滚。预览仅持readlock不写。

保守范围及外部竞争限制沿内部事务，不支持initial／amend／signed／hook／packedrefs等一般Git状态。当前接通RPC不等于完整Fork或GUI已更新。

## 当前验证

真实生产Host临时Git staged-only commit与重放拒绝通过；协调器／RPC／独立契约24/24通过。真实集成发现Host discovery repo附加字段被strict adapter拒绝，已固定投影type/root；复核发现pre-dispatch已取消被误报unknown，现以dispatched标记区分明确未派发cancel与可能写入后unknown。初期golden源码转义和surrogate test错误修正后通过。

最终构建、63文件包闭包和隔离生产依赖安装通过；最终稳定源码npm默认全量1595/1595通过，无失败／取消／跳过／todo（389.9秒）。
