# 部分取消暂存三阶段Host协议

状态：候选Host三阶段协议已接入，反向块选择界面已接入未发布候选，见[用户说明](<PARTIAL-UNSTAGE-USER.md>)，仍非正式发布或当前GUI验收。

- vcs/partial-unstage-plan：只接受sessionId、repositoryId、fresh staged修改id。精确Index→HEAD计划，返回action=partial-unstage、显示计划、planToken与期限。
- vcs/partial-unstage-prepare：只接受sessionId、repositoryId、planToken、unitIds，消费计划并复验完整状态，返回目标OID／mode、精确选择和独立确认token。
- vcs/partial-unstage-confirm：只接受sessionId、repositoryId、token，不能替代选择／正文／OID／路径。

计划与确认token默认60秒、最多32项，独立partial-index-unstage kind与方向namespace。stage／unstage之间不得交换令牌或私有snapshot，错配／过期／重复拒绝。plan／prepare只读且持readlock，confirm共用仓库write互斥，授权复验／取消／未知append-only语义保持。

允许受限staged M-space／MM既有普通同mode文件，所选W只绑定freshness不用于恢复内容。恢复计划和候选仍有256KiB／4000行／20万精确格上限，工作区扫描guard不变。

真实验收必须H/I/W三态：只撤回第一块，剩余Index保持；W与HEAD字节不变；全选I=H。合成blob可能追加，确认后失败不保证对象不存在，不GC回滚。Host验证不等于当前GUI已支持。

## 当前验证

独立真实生产Host＋Git反向三阶段1/1通过：计划／选择不改Index，正向确认接口拒绝reverse token且不消耗reverse权限，最终只恢复第一块至HEAD、剩余Index和W保持，重放拒绝。

正反向协调器／RPC／独立请求契约聚合52/52通过。首次fake apply测试漏列assertAuthorized参数导致断言前未抵达barrier而挂起，已停止旧job并修正测试契约，生产实现未因此修改。构建、51文件包检查和隔离安装通过；独立静态复核未发现当前无UI范围确认缺陷。默认全量未通过：已有整文件stage真实RPC与正向partial真实RPC确认超15秒安全返回unknown；反向golden及协议针对性通过不能替代全量门禁，后续继续处理预算／负载问题，未放宽超时。
