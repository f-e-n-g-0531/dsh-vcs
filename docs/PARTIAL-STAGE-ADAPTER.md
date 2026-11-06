# 部分变更块Stage内部接入

状态：内部适配器已实现并通过独立组合43/43回归，用户仍仅有受限整文件stage／unstage；部分变更块尚无RPC或界面。

## 两阶段内容绑定

1. 只读计划：guard内按unstaged ID解析文件，固定HEAD、完整Index和全工作字节；读取验证Index blob，生成256KiB／4000行／20万格精确计划。服务器保存私有before／after，不向客户端授予路径或正文写权限。
2. 选择预览：只接收原服务器私有计划snapshot与unitIds，复验完整状态，拒绝空选、重复、未知、篡改和过期内容；生成新的固定候选字节与目标OID。选择snapshot不能通过JSON克隆获得权限。
3. 确认执行：选择ID在预览时冻结，确认不能再换另一组块；复用捕获blob追加与完整Index CAS，实际工作文件保持完整after，Index只包含所选before→after变更。

首批仍要求Index等于HEAD，不放开所选MM。原子单元是相邻精确删除／插入块，不是块内任意逐行。Plan ID绑定内容但不是Session授权，后续Host token仍须绑定grant、cwd和仓库。

## 能力消费与三态分离

计划snapshot、选择后的候选snapshot和Host确认token是不同能力。计划选择应明确是否单次消费；首批按选择尝试消费，失败／空选等不得使旧内容授权悄然变成另一候选。Host token仍是确认即消费，与内部snapshot重复使用策略分别验证。

完整捕获work(W)与部分候选(P)必须分开保存。发布后仅改变Index对应字段；baseline工作摘要继续是W，不能改成P，否则会把未选变更丢失或放宽工作复验。

## 当前实现验证

preparePartialIndexStage生成只读私有计划；selectPartialIndexStage在任何await／校验前消费计划能力并冻结选择，生成独立stage候选。模块42项＋独立选择数组／fullW分离1项，独立复核组合43/43通过；原stage／cache相邻58/58通过。复核未发现当前内部范围可确认缺陷。故意损坏Git对象的Windows只读夹具已chmod后重跑通过。

首次默认全量969项中968通过，真实stage确认在并行多组重型回归负载下超15秒返回unknown；不称全量通过。停止重复负载后单组稳定源码npm默认并发全量969/969通过，无失败／取消／跳过／todo（353.9秒），未改生产预算。构建、49文件包闭包检查与生产依赖隔离安装通过；未开放部分RPC或界面。

## 当前独立验证

精确计划→blob→自有Index锁组合在真实SHA1／SHA256中2/2通过。独立完整适配器回归1/1通过：选择数组在select调用后的首次await期间改成另一块，返回候选仍绑定原选择；计划再次选择拒绝，Index只包含第一块、完整work保留，Git显示MM。

## 验收

三态golden：HEAD=Index=old1／anchor／old2，Work=new1／anchor／new2，选择第一块后Index=new1／anchor／old2，Work仍new1／anchor／new2。全选Index=Work，但空选不发写请求。

覆盖SHA1／SHA256、混合换行／BOM／无末行换行、计划与选择snapshot克隆／跨操作、单位ID错配／重复、选择数组后变更、Index／HEAD／工作变化（含未选工作）、原始对象Hash、取消／未知append-only及未选其他文件暂存保持。

本适配器完成不等于Fork逐行暂存完成；MM、反向部分unstage、用户RPC和确认界面另行接入。
