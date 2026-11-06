# 部分取消暂存内部适配器

状态：内部适配器已实现，尚无部分unstage RPC或用户入口。

## 方向

原始I是当前Index，H是预览固定HEAD，W是完整工作文件。恢复计划必须I→H；显示HEAD→I的差异不能直接沿用正向选择坐标。选择第一恢复块后，其余Index暂存保持，W不改。

例：H=old1／anchor／old2，I=staged1／anchor／staged2，W=staged1／anchor／work2。撤回第一块应得到Index=old1／anchor／staged2，不能变成HEAD或Work，W仍staged1／anchor／work2。全选Index=H。

## 私有策略

只允许fresh staged普通M-space／MM身份，同mode且HEAD／Index路径均存在，工作文件普通可读且内容完整绑定。所选work不要求等于Index，但任何选择后工作变化仍使快照过期。整文件unstage／stage旧MM拒绝不变，公开allowMM／direction字段不能授予能力。

计划snapshot、选择候选、stage或unstage能力必须隔离，计划选择单次消费。固定Index和HEAD的blob原字节均须独立复算Git哈希，UTF8精确计划256KiB／4000行／20万格无近似。

## 合成对象与发布

部分恢复常生成新的blob，沿append-only对象存储＋真实index.lock完整CAS发布，只改所选tuple，不reset／checkout／编辑工作区。失败后对象可留存，不自动删对象或GC回滚；写开始后任何未确认结果为unknown，完整metadata自有对象差异只允许精确目标／fanout。

## 当前独立验证

反向替换／恢复删除／撤回插入pure golden3/3通过。独立真实Git三态1/1通过：仅第一块回HEAD，剩余Index保持、W与HEAD不变，reverse选择候选不能调用stage API；计划／选择Index只读。新适配器27/27、既有七文件130/130、部分MM16/16通过；独立复核未发现当前内部范围缺陷。首次全量1064/1066，两项测试在旧注入点错误预期blob留存；已在目标对象确实存在后注入，最终新文件27/27重跑通过，稳定源码npm默认全量1066/1066通过，无失败／取消／跳过／todo（340.1秒）。未修改生产语义或guard。构建、50文件包检查与隔离安装通过。

## 验收

真实SHA1／SHA256三态、只选第一／第二／全选，raw BOM／换行／无末行换行；其他暂存与全部W保持；wrongmode／旧ID、跨stage/whole快照、克隆、重复选择、状态变化、预算／取消／授权／对象变化拒绝。内部通过不等于用户部分取消暂存已支持。
