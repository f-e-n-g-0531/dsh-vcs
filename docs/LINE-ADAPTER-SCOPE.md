# 逐行私有适配器边界

状态：内部适配器已实现并通过针对性验证，当前用户界面仍为原子块选择。

prepareLineIndexStage以Index→Work生成独立行计划；prepareLineIndexUnstage以Index→HEAD生成反向恢复行计划。每个删除当前行／插入目标行有内容绑定操作ID，不接受显示行号作为授权。

选择阶段单次消费计划并在await前复制operationIds，规范计划重算、拒绝空选／重复／未知／跨计划操作。候选不改变任何未选原行，所选插入按目标顺序位于块内保留原行之后；不暗中配对替换。

Line与Block、stage与unstage的计划和候选WeakMap隔离。公开snapshot／flags不能授予策略，apply对应方向只消费本类私有候选；跨API／克隆拒绝。

原始I/H blob哈希独立复验，MM三态和完整W freshness保持。候选若NONE或CR+空LF导致物理行合并则拒绝，不补换行；候选独立256KiB／4000行与输入精确LCS20万格限制保持。

写入沿既有blob追加、自有Index锁、完整CAS、授权／metadata精确自有差异和发布后核对；无reset／checkout／work写回，未知append-only副作用不回滚。

## 当前独立验证

真实Git反向逐行混合1/1通过：在同一替换块只删除Index第一行并插入HEAD第二行，得到literal i1／h1／z，其他Index行、完整W与HEAD保持；行候选调用块apply拒绝。准备／选择仍只读。

新增LINE62项行为跨针对性run验证通过，旧partial／cache／settled／ref相邻111/111通过；独立静态复核未发现当前内部范围确认缺陷。首轮全量1206/1211：两项crossblock测试辅助参数解引用错误已修正并单独2/2通过，三项真实／旧历史请求超时，未扩大生产预算。停止叠加重型验证后单组稳定源码npm默认全量1215/1215通过，无失败／取消／跳过／todo（415.4秒），先前失败记录保留。构建、52文件包闭包和隔离安装已通过，未接入Host／RPC／界面。

需真实SHA1／SHA256替换块单行删除／插入／混合、反向literal、未选与其他暂存／W保持、能力隔离、陈旧状态、取消／授权／错误／容量测试。内部通过不等于用户逐行暂存交付。
