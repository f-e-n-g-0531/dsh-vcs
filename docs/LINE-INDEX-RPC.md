# 精确逐行三阶段Host协议

状态：候选Host六路协议已接入，正反向逐行候选界面已接入验证中，见[用户说明](<LINE-SELECTION-USER.md>)，未正式发布。

固定正向line-stage和反向line-unstage方向，各三个endpoint：

- plan只接受sessionId、repositoryId、fresh对应mode的选中id；返回独立planToken和精确raw-line-selection-v1计划。
- prepare只接受sessionId、repositoryId、planToken、operationIds（1–8000唯一hex64操作）；消费计划后重验完整状态，返回目标OID和冻结选择、独立token。
- confirm只接受sessionId、repositoryId、token，不能换正文／路径／偏移／operationIDs／方向。

整文件／块／行及正反向使用独立operationKind和令牌namespace；均绑定Session／cwd／grant／repo对象，默认60秒／32项，错配和重放拒绝。read阶段持共享读锁，confirm共用仓库写互斥；取消／过期／授权复验和append-only未知语义保持。

每端256KiB／4000行／20万精确LCS格，候选额外256KiB／4000行及raw token边界检查。只删选中的Index行，未选保持；插入选中的目标行在该块保留行之后按目标原序。unsafe NONE／CR+空LF拼接拒绝，不补换行，不模糊匹配。

真实验收正向I→W和反向I→H，块内只选delete0＋insert1，得到Index保留line1再加目标line1，W不变。Host能力完成不代表用户界面逐行支持。

## 当前验证

独立默认生产Host＋真实Git正反向2/2通过：同一替换块只删当前第0行并插入目标第1行，Index得到i1＋w1或i1＋h1，不等于整目标，W／HEAD保持；plan和prepare不改Index。

协调器26项与RPC／独立endpoint契约聚合46/46通过，8000操作ID边界与块4000上限隔离。构建、53文件包检查和生产依赖隔离安装通过；独立静态复核未发现当前Host范围确认缺陷；最终npm默认全量1259/1259通过，无失败／取消／跳过／todo（415.4秒），正反向逐行候选界面已接入验证中，见[用户说明](<LINE-SELECTION-USER.md>)，未正式发布。
