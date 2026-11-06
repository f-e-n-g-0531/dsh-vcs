# Fork 对齐增量验证

基于 52e9ff3（0.7.3）之后的未提交工作区修改，不是正式发布或当前 GUI 验收。完整缺口见[对齐清单](<FORK-PARITY.md>)。

## 图片缩放

- 两侧共用 Fit、实际大小和25／50／100／200%控制；数值缩放使用原始像素尺寸，可键盘聚焦滚动。
- 保留现有文件、像素及解码预算，缩放不重新RPC读取或替换对象URL。
- 针对性单测8/8通过；当时全量604/604，无失败、取消、跳过或todo。
- 隔离Edge156 React／Monaco整套夹具通过，含700×600原始图两轴滚动及200%尺寸、URL清理。包检查通过。

## Reflog只读浏览

- 新增Git专用互斥视图，一次读取最近200项HEAD日志；201项前瞻提示截断，不提供旧日志分页。日期为reflog事件时间而非commit时间。
- 点击读取服务端返回的固定完整OID；显示用HEAD selector从不作为命令输入，不提供reset、checkout、restore或写引用。日志目标对象被外部GC后可能不可读，详情显示错误，不伪装为恢复成功。
- 保留Session／cwd授权复验、仓库访问互斥、整操作预算及2MiB命令输出上限；取消、切换范围抑制旧结果。手动刷新读取新快照。
- 16项聚合针对性测试（9项后端／RPC、6项客户端、1项浏览器名单契约）及构建通过；集成全量623/623，无失败、取消、跳过或todo。随后补入通用请求契约名单，4/4再次通过。
- 隔离Edge156整套React／Monaco夹具通过，报告包含reflog步骤；41文件包完整性检查与生产依赖隔离安装、stub宿主注册通过。安装包SHA-256：3e6a9e070a68a0c8bacb8c1d95e5ce61b36d2f0a6ae63d954a55a89226200efb。该包在随后README补充前生成，校验值只对应当次验证包，不作为最终发布包身份。
- 独立只读复核未发现可确认的正确性或安全回归；这不代表完整Fork能力或所有平台验证。

## 确认式写事务基础

- 新增服务器固定operationKind的通用协调器，现有分支切换包装器复用；保留原RPC、错误码、公开字段、60秒默认过期、32个token上限、范围绑定及共享互斥。未增加暂存／提交／任意命令入口。
- 新增11项通用事务测试；与原分支Host／RPC、Reflog授权回归合计23/23通过，构建通过。随后全量634/634通过，无失败、取消、跳过或todo；42文件包检查、生产依赖隔离安装及stub宿主注册、隔离Edge156完整React／Monaco回归全部通过。
- 文件级暂存方案明确使用完整Index内容绑定、真实index.lock、candidate Index和只改选中条目；不采用实时路径git add冒充已确认字节，详见[设计边界](<INDEX-WRITE-DESIGN.md>)。

## Index候选与自有锁基础

- 新增严格v2／v3、SHA1／SHA256纯Buffer模型与单现有条目候选构建，8MiB／10万项上限。拒绝特殊flags、非普通模式、不可验证skipHash和不支持扩展；移除旧TREE／EOIE／IEOT，保守清除所有stat缓存以处理racy-clean。
- 新增自有index.lock的排他创建、完整Index CAS、候选内容绑定、同目录rename及发布后身份／内容复验。不清理外部锁，不自动回滚；观察到发布后分歧报结果未知。
- 独立复核修正延迟Buffer捕获和callback结束后pending链继续发布；对应回归及同inode候选篡改、发布后分歧均已通过。
- 仅内部实现和临时目录测试，尚未接入RPC、客户端或正式包，不代表stage／unstage已开放。聚合48/48与全量682/682通过，无失败、取消、跳过或todo；重复扩展校验线性化后3项针对性回归再次通过。详细判据见[Index基础验收](<INDEX-FOUNDATION-ACCEPTANCE.md>)。

## 内部单文件取消暂存

- 真实Git适配器与固定确认包装器已实现：预览绑定固定HEAD、完整Index、工作字节和元数据，真实index.lock下只恢复一个既有文件tuple，不改工作文件或其他暂存内容；拒绝选中MM等未支持状态。
- 独立真实协调器集成补齐原Index／目标tuple摘要；复核修正ambient budget在锁最后检查中的取消传播及混合大小写元数据guard。最终聚合81/81、全量731/731通过，无失败、取消、跳过或todo。
- 后续候选已接入严格ID-only／token-only RPC、staged模式明确确认界面及46文件包闭包；独立复核修正pending确认卸载与跨仓库刷新未知状态丢失，客户端10项回归通过。最终集成结果另见[接入记录](<UNSTAGE-INTEGRATION-RESULTS.md>)。stage／commit仍未支持；详细[适配器边界](<UNSTAGE-ADAPTER-SCOPE.md>)与[Host接入契约](<UNSTAGE-RPC-CONTRACT.md>)保持明确，未改变日常用户仓库。

## 捕获字节blob存储基础

- 新增内部append-only对象存储：同步捕获Buffer、2MiB上限、显式sha1／sha256、压缩／解压预算、既有对象精确内容验证、自有temp及hardlink NOREPLACE发布，不改Index／HEAD／工作区。
- 对象追加后取消可能留下不可达对象，始终不删除最终对象或GC回滚；文件系统缺少可靠hardlink时拒绝，不降级成覆盖写。
- 模块及独立回归41/41通过，无失败／跳过；真实Git cat-file与packed-only重复对象验证通过。stage尚未接入RPC、界面或包闭包。已有unstage最终恢复修正后的全量753/753通过；此全量启动时尚无blob测试，不能将其当新模块全量证据。

## 内部捕获字节stage适配器

- 内部stage与固定操作kind确认包装器已实现，使用私有捕获Buffer、精确目标OID及自有blob追加差异；只修改一个既有普通tracked文件，拒绝选中MM，保持其他暂存。尚未连接stage RPC／界面。
- 独立回归修正对象追加后最终授权变化仍可能发布Index的问题，现于rename前复验并保留原Index；自有对象差异不豁免其他metadata。stage32项、相邻聚合82项通过；全量837/837通过，无失败／取消／跳过／todo。
- 首次全量1项post-temp deadline夹具受50ms时序影响，改为目标阶段精确注入TIMEOUT后重跑通过，不改变生产预算。新增blob依赖纳入47文件包闭包，构建／包检查／生产依赖隔离安装通过。
- stage取消可能留下不可达blob，明确append-only未知、不删除对象或GC回滚；完整限制见[适配器范围](<STAGE-ADAPTER-SCOPE.md>)及[复核结果](<STAGE-REVIEW-RESULTS.md>)。

## 候选单文件stage用户闭环

- 已接入固定ID-only prepare／token-only confirm、Git unstaged普通修改入口、明确勾选与限时一次确认；stage／unstage共享仓库级unknown门禁，不能切换操作绕过。
- 独立复核修正警告误称预检即写对象，明确准备／取消预检只读，发送确认后才可能append-only；对应断言与stage／unstage客户端22/22通过。Host／selector／客户端／契约聚合42/42、全量864/864通过，无失败／取消／跳过／todo。
- 最终构建、隔离Edge156完整浏览器含stage／unstage步骤、48文件包检查及生产依赖隔离安装通过。仍是未发布候选，不是当前GUI验收；逐行／块、commit等仍缺失。详见[Stage接入](<STAGE-USER-INTEGRATION.md>)。

## 部分选择精确模型与真实Host补证

- 新增纯Buffer精确变更块计划，保留UTF8／BOM／LF／CRLF／CR／无末行换行；每侧256KiB／4000行、20万精确LCS格，超限拒绝且不使用显示Diff近似。计划全字段重算校验，原子块选择，尚未接入部分stage RPC。
- 模块27项＋独立golden／最小性oracle合计39/39通过，覆盖2116对模块属性输入及961对独立重复行输入、全部单元子集。
- 补默认生产Host＋真实Git stage→unstage RPC组合，单独通过；默认高并发全量904项中903通过，此组合stage-confirm超15秒安全返回unknown。并发2受控全量904/904通过，无失败／取消／跳过／todo；未改npm默认并发或生产预算。单次小仓库stage confirm7254ms、unstage confirm4400ms，默认高并发先前失败仍保留，后续优化重复快照。详细[预算记录](<REAL-RPC-BUDGET-VALIDATION.md>)，不将受控通过推广为任意负载性能保证。

## 写入固定对象读取优化

- 每公开操作私有缓存固定OID树／blob类型，key绑定canonical root／format／commit／完整metadataHash；不跨操作保存，不跳过任何授权、配置、HEAD、Index、attributes或工作内容复验。
- 严格合并root／format／HEAD读取，SHA1／SHA256真实计数prepare16→10、stage apply64→36、unstage apply40→22个Git进程；文件扫描与内容哈希保持。
- cache19项、stage／unstage66项、独立旧blob删除／最终授权变化回归通过。修正Windows readonly故意损坏与budget注入夹具后，最终npm默认并发全量924/924通过，无失败／取消／跳过／todo；生产15秒预算及npm并发设置未改。
- 构建、48文件包检查及隔离安装通过；单次小仓库stage confirm约5.69秒／unstage约3.09秒（实现方采样），不是通用性能保证。详见[性能边界](<INDEX-CAPTURE-PERFORMANCE.md>)。

## 内部部分变更块stage适配器

- 新增只读私有计划与单次选择能力，固定Index blob原字节重新计算OID，按精确unit IDs生成私有候选；复用既有stage对象追加／CAS发布，完整work与部分candidate分开绑定。选中MM仍拒绝，未接入部分RPC／界面。
- 部分42项＋独立选择数组／fullW分离组合43/43通过，SHA1／SHA256精确内容→blob→Index组合2/2通过；原stage／cache相邻58/58通过。独立复核未发现当前内部范围可确认缺陷。
- 首次重复重型负载下全量968/969，真实stage confirm超15秒安全unknown；停止重复负载后稳定源码npm默认全量969/969通过，无失败／取消／跳过／todo。生产预算未放宽，先前失败如实保留。
- 构建、49文件包闭包检查与生产依赖隔离安装通过；详细[部分stage边界](<PARTIAL-STAGE-ADAPTER.md>)。

## 部分变更块三阶段Host协议

- 新增独立planToken与确认token，guard内ID-only计划→token＋unit IDs选择预览→token-only确认，固定partial-index-stage操作kind；两阶段只读、token限时单次且绑定grant／Session／cwd／repository，确认不能替换选择。
- 协调器／RPC／独立请求契约聚合26/26，默认生产Host＋真实Git1/1通过，验证仅选中块进入Index、完整Work不变和两类令牌拒绝重放。
- 独立复核未发现当前无UI范围可确认缺陷；最终npm默认全量992/992通过，无失败／取消／跳过／todo。构建、50文件包闭包检查和隔离安装通过；未接用户块选择界面，见[RPC契约](<PARTIAL-STAGE-RPC.md>)。

## 内部连续部分MM暂存

- 仅partial私有策略允许同mode的H／I／W三态，计划基于实际Index→Work，精确fresh MM身份；整文件stage／unstage仍拒绝MM且公共options不能放开。
- 新MM16项行为验证、既有六文件119/119通过；默认真实Host两次部分确认1/1通过，第一选择产生MM后第二计划只显示剩余块，最终Index=Work，未选其他暂存及工作内容保持。
- 首次全量1023/1024，一旧partial正向对象复验保守unknown（原因未确认），未放宽guard；停止重叠测试后稳定源码npm默认全量1024/1024通过，无失败／取消／跳过／todo。MM界面仍拒绝，尚未扩展用户入口，见[三态边界](<PARTIAL-MM-SCOPE.md>)。

## 只读复验查询并发

- 在metadata／config guard后对独立root／Index／HEAD、ref／固定树、blob类型／attributes分组并发；allSettled等待全部子任务关闭，按原顺序验证和报错，授权／持久写入及所有capture边界不变。
- 真实命令barrier、失败优先级、取消／deadline清理、guard前置最终10/10通过；默认全量1033/1033通过，无失败／取消／跳过／todo。之后新增的两个专用优先级测试亦包含10项单独再次通过。
- 默认15秒预算未放宽；单次小仓库两次部分confirm约5059／4691ms，仅观察值。构建、50文件包检查与隔离安装通过，详见[并发边界](<INDEX-CAPTURE-CONCURRENCY.md>)。

## 内部反向部分取消暂存

- 新增Index→固定HEAD精确恢复计划／单次选择／独立apply能力，staged M-space／MM身份，两个端点原blob重新计算Git哈希，所有W只作完整freshness绑定不作为恢复内容。
- 独立反向插入／删除／替换golden3/3与真实三态1/1通过；新适配器27/27、既有相邻130/130、MM16/16通过。选择第一块仅恢复HEAD第一块，其余Index／W保持，reverse能力不能调用stage。
- 修正测试将onStart误当已追加对象的注入时机后，稳定源码npm默认全量1066/1066通过，无失败／取消／跳过／todo。构建、50文件包检查和隔离安装通过，独立复核无当前内部范围确认缺陷。
- 尚无部分unstage Host／RPC／界面，不能称用户已获得该能力；候选合成blob保留append-only未知语义，见[反向适配器](<PARTIAL-UNSTAGE-ADAPTER.md>)。

## 单操作纯引用语法校验复用

- 仅private context成功的精确ref名称语法复用，不缓存当前HEAD／commit／配置／Index／工作状态；ref变化重跑语法检查，原有全fingerprint和取消／错误优先级保持。
- prepare9、stage apply29、unstage18个Git启动（此前10／36／22），真实三方向Host RPC3/3通过，单次小仓库partial confirm3179／2997ms，不作通用性能保证。
- 新ref13项＋关键对象失效／最终auth2项15/15通过；修正测试HEAD注入阶段后最终npm默认全量1106/1106通过，无失败／取消／跳过／todo，15秒生产预算未改。构建、51文件包检查与隔离安装通过。详见[ref复用边界](<INDEX-REF-VALIDATION-REUSE.md>)。

## 候选反向部分取消暂存界面

- 已接入staged M-space／MM恢复块选择，明确当前Index删除／HEAD恢复原始行，三阶段readonly计划→候选→独立确认；合成blob append-only风险与W不写回保持。反向确认加入四类Index共享pending／unknown gate。
- 反向组件17项与四类客户端聚合54/54通过；独立复核未发现当前范围确认缺陷。修正初始复制测试正向error／expiry标签预期，生产实现未因此改变。
- 最终源码含特殊／binary／large／symlink／image比较拒绝guard，构建、隔离Edge156浏览器含partial-unstage步骤、51文件包检查及隔离安装通过；npm默认全量1123/1123通过，无失败／取消／跳过／todo。仍未正式发布或更新日常GUI，见[反向块用户说明](<PARTIAL-UNSTAGE-USER.md>)。

## 块内独立行选择纯模型

- 新增raw-line-selection-v1，固定精确块内每个before删除／after插入独立ID；未选原行保留，所选插入按目标序追加于该块保留行之后，不隐式配对。整个计划schema重新计算校验，无显示offset授权。
- 独立发现NONE后插入与CR＋空LF拼接会合并物理行；已收紧为候选编码后逐token重解析一致，否则拒绝，不补换行。候选独立256KiB／4000行，输入精确LCS上限不变。
- 模块与独立32子集／反向／容量／EOF边界golden29/29通过，441对输入全部操作子集暴力oracle通过；最终npm默认全量1152/1152通过，无失败／取消／跳过／todo。尚无逐行适配器／RPC／界面或包导入，见[逐行模型边界](<LINE-INDEX-SCOPE.md>)。

## 正反向逐行内部适配器

- 新增私有LINE计划／选择／apply六API，独立于BLOCK／whole和相反方向能力；固定I→W暂存、I→H恢复，每行操作ID复制后绑定候选，保持完整W与未选Index语义。
- 新LINE62项行为验证、既有相邻111/111通过，独立真实反向mixed-line1/1通过；独立复核未发现当前内部范围确认缺陷。unsafeEOF／CR边界在选择阶段只读拒绝，无fallback。
- 首次全量两项新测试helper错误和三项负载超时如实保留；修正helper并停止叠加验证后稳定源码npm默认全量1215/1215通过，无失败／取消／跳过／todo。构建、52文件包闭包检查与隔离安装通过，尚无逐行Host／RPC／UI，见[逐行适配器范围](<LINE-ADAPTER-SCOPE.md>)。

## 正反向逐行三阶段Host

- 新增line-stage／line-unstage固定六路协议，独立方向工厂、plan／confirm token namespace，operationIds上限8000，块unitIds仍4000；read阶段只读、确认不能替代选项／正文／offset。
- 真实生产Host＋Git2/2、协调器26项与协议／请求契约聚合46/46通过，行／块／整文件／方向token隔离，Index只匹配所选delete＋insert候选、W和HEAD保持。
- 独立复核未发现当前Host范围确认缺陷；构建、53文件包检查与隔离安装通过，最终npm默认全量1259/1259通过，无失败／取消／跳过／todo。尚无逐行UI，见[逐行RPC说明](<LINE-INDEX-RPC.md>)。

## 候选正反向逐行用户界面

- 新增固定LineStage／LineUnstage入口，严格operation逐项对照source units、算法／坐标／text／terminator／ID／数量验证；每个delete／insert独立勾选，三阶段只读计划／候选与最终明确确认，六类共享pending／unknown恢复。
- 独立静态复核未发现当前UI范围确认缺陷，首轮六类客户端聚合69/69、最终Line组件与独立文案18/18通过。实现子任务收尾失败无报告，Lead仅按当前源码与已收集验证结果验收，不以子任务状态证明完成。
- 最终构建、隔离Edge156完整浏览器含line-selection步骤、53文件包检查和隔离安装通过；稳定源码npm默认全量1277/1277通过，无失败／取消／跳过／todo。仍是严格受限候选，commit等完整Fork能力未齐，见[逐行用户范围](<LINE-SELECTION-USER.md>)。

## 纯Git tree／commit对象编码

- 新增纯Buffer tree／commit对象模型，目录aware字节排序、原始OID20／32字节、独立author／committer严格身份／时间／时区、消息64KiB原字节保留，禁止header注入，支持显式SHA1／SHA256。
- 模块10项与独立literal3项13/13通过；真实临时Git hash-object／mktree／cat-file编码和身份／容量负例通过。最终npm默认全量1290/1290通过，无失败／取消／跳过／todo。
- 不导入提交生产流程、不存储tree／commit、不移动ref，尚无commit用户功能。后续Index→tree与refCAS事务单独验收，见[提交对象基础](<COMMIT-OBJECT-SCOPE.md>)。

## 完整Index到嵌套tree纯模型

- 新增平面普通Index路径→trie→bottom-up精确tree构建，文件／目录冲突双序拒绝，Git目录aware排序，输出独立body。明确限制深度64component、10万文件／100001总node／aggregate8MiB；保守case／normalization aliases拒绝但不归一化接受数据。
- 模块12/12＋独立literal3/3、与commit编码组合28/28通过；真实临时SHA1／SHA256 parseIndex→root等于Git write-tree，各body hash-object／cat-file吻合。最终npm默认全量1305/1305通过，无失败／取消／跳过／todo。
- 纯模型不读取Work、不写对象或ref，用户commit仍缺，后续对象发布和refCAS事务独立接入，见[Index tree范围](<INDEX-TREE-SCOPE.md>)。

## Tree／commit有类型追加对象原语

- 新增storeCapturedObject仅tree／commit类型，8MiB／128KiB body容量、完整压缩消费、类型／长度／原字节／hash验证，独占temp＋hardlink NOREPLACE，自有清理，poststart append-only unknown；blob API不变。
- 类型原语36项＋独立header／捕获golden4项、旧blob组合72/72通过，真实Git SHA1／SHA256对象与packed-only重复读取吻合；独立静态复核无当前范围确认缺陷。初期复制测试cat-file blob误读tree的oracle已修正，生产类型语义未变。
- 最终npm默认全量1345/1345通过，无失败／取消／跳过／todo。未接入commit生产链、不更新ref，用户commit仍未开放，见[有类型对象存储](<TYPED-OBJECT-STORE.md>)。

## 固定raw Index确定性提交纯计划

- 组合rawIndex checksum／扩展guard、完整tree和单父commit，SHA256 domain计划ID绑定rawIndexDigest／format／parent／parentTree／tree／commit，非空白消息精确保留。
- 独立重现identity getter重复读取和late getter改消息，已收紧plain own-data descriptor捕获与rawIndex／message先复制；输出Buffer仍mutable，不是能力或授权，不能证明父对象关联。
- 模块及独立17/17通过，真实SHA1／SHA256 Git write-tree／commit-tree bytes／OID相符、Work忽略且refs不变；最终npm默认全量1362/1362通过，无失败／取消／跳过／todo。未开放commit，见[固定提交计划](<COMMIT-PLAN-SCOPE.md>)。

## 固定父commit哈希与tree依赖解析

- 新增纯parseVerifiedCommit先对原始body复算commitOID，再严格解析tree／连续parents／author／committer，支持可选精确encoding UTF-8，其他／签名／continuation拒绝，消息原字节opaque且不作header。
- 复核发现options参数绑定getter可在复制前替换输入，已独立复现并改为先复制body后读取options；最终模块＋独立golden16/16通过，真实SHA1／SHA256 Git对象验证吻合。
- 最终npm默认全量1378/1378通过，无失败／取消／跳过／todo。纯依赖验证不证明branch授权／ref freshness、不移动ref，commit用户功能仍缺，见[固定父对象范围](<VERIFIED-COMMIT-SCOPE.md>)。

## 已核验父对象组合Index提交计划

- 新增纯wrapper先复制Index／parentbody，再检查own-data参数、验证固定parent哈希并从header导出parentTree，禁止caller覆盖，返回既有内容绑定计划；无仓库IO／ref更新。
- 最终组合模块＋独立golden16/16、相邻六文件44/44通过，真实SHA1／SHA256 Git oracle与HEAD不变核验通过，独立静态复核无当前范围确认缺陷。默认全量捕获1380/1380通过，无失败／取消／跳过／todo；启动后新增14项组合模块测试单独通过，不虚增全量覆盖。
- 未开放commit，仍需实际仓库capture及refCAS事务，见[已核验提交计划](<VERIFIED-COMMIT-PLAN.md>)。

## 实际仓库只读提交预览

- 新增prepareCommitPreview固定canonical born symbolic HEAD／rawIndex／配置／metadata双capture与closing barrier，固定parent body哈希验证，tree来自Index而非Work，frozen无Buffer summary，无apply／RPC／权限。
- 独立复核发现config include在拒绝前展开外部内容，改--no-includes并以非法workconfig回归确认拒绝；消息plaintext、签名config即使false、链接／属性等保守限制明确披露。
- 模块35项、独立no-write golden及browser runner组合49/49通过；初全量1424/1425旧timer边界测试竞态修正后最终npm默认全量1430/1430通过，无失败／取消／跳过／todo。生产runner与15秒预算不变，未开放用户commit，见[真实提交预览范围](<COMMIT-PREVIEW-SCOPE.md>)。

## 既有本地分支oldOID CAS基础

- 新增内部compareAndSwapBranch使用Git update-ref --no-deref new old，检查既有born symbolic HEAD与直接loose目标、完整固定commit／format；自有外部空hooks目录禁reference-transaction，固定machine reflog身份。
- 复核发现committer.*覆盖user.*影响审计身份，已补命令级committer覆盖回归；cleanup仅自有空目录，外来条目保留，poststart均unknown不retry／reset。明确外部symref／HEAD竞争非全局原子限制及packedrefs拒绝。
- 模块48/48与独立real golden通过，真实SHA1／SHA256只refs／logs变化、hook不执行；修复测试全局temp前缀并发误认后最终稳定源码npm默认全量1480/1480通过，无失败／取消／跳过／todo。仍未接用户commit，见[refCAS范围](<REF-CAS-SCOPE.md>)。

## 固定提交对象图仅追加发布

- 新增publishCommitObjects全部body先捕获、typed hash／canonical tree图重建／child路径与postorder／root-commit绑定预校验，再child trees→root→commit追加，auth贯穿、start一次、poststart均append-only unknown。
- 模块37项、独立callerBuffer突变golden与typedstore组合76/76通过，真实SHA1／SHA256对象读取吻合、refs／Index不变、已有图无start、部分失败保留child；独立复核无当前范围确认缺陷。
- 稳定源码npm默认全量1518/1518通过，无失败／取消／跳过／todo。仍不移动ref，发布对象不是用户commit成功，见[提交对象图范围](<COMMIT-OBJECT-PUBLISH-SCOPE.md>)。

## 私有提交快照一次性只读复验

- prepare安全摘要通过private WeakMap绑定root／原fingerprint／完整plan；consume先烧毁grant再验证repo／参数／授权，clone／错误repo／重放拒绝。固定计划重新构建并比对原ID，最后授权后最终capture，公开结果不含Buffer／执行权限。
- capability37项均通过、既有preview35项与独立no-write golden通过，独立静态复核无当前范围确认缺陷。Work正文不读不绑定，stalled授权受共享deadline限制，所有操作仍只读。
- 稳定源码npm默认全量1556/1556通过，无失败／取消／跳过／todo。未连接对象发布或refCAS，未开放用户commit，见[私有快照范围](<COMMIT-SNAPSHOT-SCOPE.md>)。

## 私有快照内部提交确认事务

- 新增applyCommitPreview同一private grant先烧毁，原fingerprint／重建plan核对、固定对象图追加、仅created精确对象／fanout允许差异、oldOID refCAS、postcommit Index／配置／metadata／单条reflog append核对；所有poststart失败unknown不retry／回滚。
- 复核发现对象inflate未核对完整压缩消费，已修复info.bytesWritten判据并以late suffix回归确认ref前拒绝。初期atime测试误判修正为rawbytes／inode／mtime／ctime写身份核对。
- 确认组19/19、旧capability37/37通过，真实SHA1／SHA256 staged-only parent／tree／body吻合，W和rawIndex保持。最终稳定源码npm默认全量1575/1575通过，无失败／取消／跳过／todo。
- 调用方writer门禁、loose分支／既有reflog及外部竞争非原子限制明确；尚无用户commit Host／RPC／UI，见[内部提交事务](<COMMIT-TRANSACTION-SCOPE.md>)。

## 提交Host预览与token确认协议

- 新增commit-prepare仅有界显式身份／消息，descriptor快照先于lookup；commit-confirm token-only，固定kind与grant/cwd/session/repo绑定，shared writer与Index／branch操作互斥，预览reader无写。
- 真实Host发现discovery repo附加字段不适配strict内部输入，已投影type/root；复核pre-entry abort误报unknown，增加dispatched分类，保留poststart／outerlifetime unknown。
- 真实生产Host staged-only提交及重放拒绝、协调器／RPC／独立契约24/24通过，构建、63文件包检查及隔离安装通过；最终npm默认全量1595/1595通过，无失败／取消／跳过／todo。无提交UI或正式发布，见[提交RPC范围](<COMMIT-RPC-SCOPE.md>)。

## 候选显式提交编辑与确认界面

- 新增双身份／epoch秒／timezone／精确message显式编辑，只读prepare核对parent／ref／Indexdigest／tree／commit、identity/message全等，编辑使旧preview失效，token-only单次确认，成功精确四字段匹配。无stageall/amend/push。
- 七类commit／Index确认共享同步pending＋unknown门禁，跨mode／focus保持不确定状态；生产旧handler互斥／恢复回归通过。独立组件静态复核无当前范围确认缺陷。七类组件聚合83/83、独立替换golden通过。
- 首轮浏览器重复locale键warning已清理；最终构建、隔离Edge156完整浏览器含commit步骤、63文件包检查及隔离安装通过；npm默认全量1608/1608通过，无失败／取消／跳过／todo。严格配置子集／外部竞争限制保留，未正式发布或更新日常GUI，见[候选提交用户范围](<COMMIT-USER-SCOPE.md>)。

## 已核验提交身份／消息纯读取模型

- 新增readVerifiedCommitMetadata先owned body capture再own-data options与哈希／严格header核验，分别提取author／committer和精确UTF8消息，消息64KiB、身份1024字节，空白／BOM／CRLF／EOF保留。root／merge可读取不意味支持amend。
- 新模块12项＋独立literal2项14/14、与父parser组合24/24通过，真实临时Git SHA1／SHA256 commit-tree／cat-file吻合；独立静态复核无当前范围确认缺陷。初期invalidformat testhelper先hash null问题修正，生产未改。
- 默认全量捕获1610/1610通过，无失败／取消／跳过／todo；新增12项模块测试在该run启动后创建，单独通过而不虚增全量覆盖。尚无recent-commit RPC/UI或amend，见[最近信息模型](<LATEST-COMMIT-METADATA-SCOPE.md>)。

## 固定HEAD最近提交只读适配器

- 新增readLatestCommit固定canonical symbolic HEAD／loose或packed ref与format，metadata双capture含closingbarrier，原始固定OID body独立hash核验后返回身份和精确消息；无Work／Index内容读取或写入。
- strict config首次调用no-includes且固定git-dir／work-tree，修复core.worktree启动重定向；允许Windows初始化core.symlinks只读标志，外部配置仍拒绝。模块41项、独立golden与metadata组合56/56通过，静态复核无当前范围确认缺陷。
- npm默认全量1664/1664通过，无失败／取消／跳过／todo。尚无最近信息RPC／UI或amend，见[最近读取范围](<LATEST-COMMIT-READ-SCOPE.md>)。

## 最近提交信息只读Host协议

- 新增vcs/latest-commit严格sessionId／repositoryId own-data preawait快照，Gitonly，投影server type/root、共享reader锁与postreadgrant复验；readonly取消／timeout不映射mutationunknown。
- 实际生产Host返回固定HEAD信息，不受Index／Work影响且仓库无写；独立endpoint契约与真实Host5/5，RPC最终8/8（含persistedSession），相邻协议18/18通过，独立复核无当前范围确认缺陷。
- 构建、65文件包检查与隔离安装通过；默认全量1673/1673通过，无失败／取消／跳过／todo。尚无最近信息复用UI或amend，见[最近信息RPC](<LATEST-COMMIT-RPC-SCOPE.md>)。

## 最近提交展示与显式原文消息复用

- 新增提交面板显式latest load，深度验证metadata／exact messageBytes，load不动draft／candidate／ack，explicit reuse只改message并同步废弃旧候选，身份保留且无amend／自动提交。CRLF／BOM／empty原文保留，现writepolicy仍可明确拒绝。
- 复核缺少dedicated readcancel已补，不清candidate／ack，独立测试通过；组合组件＋独立golden21/21通过。构建、隔离Edge完整浏览器、65文件包检查与隔离安装通过。
- 默认全量捕获1682/1682通过，无失败／取消／跳过／todo；启动后补专用cancel测试单独通过，不虚增全量覆盖。未发布或更新日常GUI，amend仍缺，见[消息复用用户范围](<LATEST-COMMIT-USER.md>)。

## 已核验HEAD amend纯计划

- 新增createAmendPlan从hashverified旧HEAD保留原始author／有序parents，newtree来自rawIndex，committer／message显式提供；root／merge拓扑仅纯编码，非用户历史改写权限。允许same-tree message-only，只有新OID完全等于旧OID拒绝no-op。
- metadata先capture，版本ID绑定rawIndex／oldhead／oldtree／parents／newtree／newcommit；模块21＋独立3项24/24通过，真实SHA1／SHA256 Git root／normal／merge body／tree吻合，独立静态复核无当前范围确认缺陷。
- 默认全量捕获1686/1686通过，无失败／取消／跳过／todo；模块21项在该run启动后创建，单独通过而不虚增全量覆盖。尚无amend适配器／RPC／UI，见[amend纯计划范围](<AMEND-PLAN-SCOPE.md>)。

## 实际仓库amend只读预览与隔离快照

- 新增prepareAmendPreview固定rawIndex／hashverified旧HEAD，保留author／parents、显式committer／message，same-tree消息修改可用，action与private WeakMap独立于normalcommit，不提供amend apply／consume。
- 模块21＋独立golden22/22通过，正常commit capability与旧回归通过，真实SHA1／SHA256 root／merge／same-tree／staged≠Work只读核对、normal apply／consume拒绝amend摘要，独立复核无当前范围确认缺陷。
- 构建、66文件包检查及隔离安装通过；最终npm默认全量1729/1729通过，无失败／取消／跳过／todo。尚无amend确认／RPC／UI，见[amend预览范围](<AMEND-PREVIEW-SCOPE.md>)。

## 隔离私有快照内部amend确认事务

- 新增applyAmendPreview仅烧毁amend map，private fixed-kind executor复验createAmendPlan与原fingerprint，保留原author／parents，固定对象追加＋oldHEAD CAS替换tip，正常commit能力不能互换。
- 继承精确自有object／完整压缩消费／原Index／配置／reflog barriers，poststart失败vcs/amend-outcome-unknown，callerwriter与外部竞争限制沿用，无rollback／retry。独立静态复核无当前范围确认缺陷。
- 初轮确认组34/34；扩展amend31/31最终完整通过，涵盖双format×root／normal／merge×staged／message-only及故障guards，正常confirm回归通过。默认全量捕获1744/1744通过，无失败／取消／跳过／todo；启动后扩展测试独立通过，不虚增全量计数。尚无amend Host／RPC／UI，见[内部amend事务](<AMEND-TRANSACTION-SCOPE.md>)。

## Amend专属内部确认协调器

- 新增createAmendCoordinator fixedkind，prepare仅committer／message own-data同步捕获、author／parents不得覆盖；公开复制旧tree／父列表／身份／目标OID，私有snapshot保留。strict type/root投影避免discovery extras。
- amend与commit／Index／branch同binding token隔离，通用writer与grant／TTL／cap／singleuse验证，poststart错误amendunknown明确历史改写风险。模块14＋独立golden／commit组合27/27通过，独立静态复核无当前范围确认缺陷。
- npm默认全量1776/1776通过，无失败／取消／跳过／todo。尚未注册amend RPC或UI，见[amend Host范围](<AMEND-HOST-SCOPE.md>)。

## Amend专属预览／确认RPC

- 新增amend-prepare仅显式committer／message、amend-confirm token-only，严格own-data prelookup捕获、禁止author／parents／HEAD替换；fixedkind与commit／Index能力隔离，reader预览／writer确认、grant生命周期及cache清理完整。
- poststart／outerlifetime amendunknown优先cancel，pre-dispatchabort保持cancel不烧token；明确historyrewrite／appendonly／HEADindex检查和禁retryrollback。独立静态复核无当前范围确认缺陷。
- RPC12/12含实际默认Host、独立真实Host与契约5/5、相邻22/22通过；原author／rootparents／stagedtree／rawIndex／Work保持、重放拒绝。构建、67文件包检查与隔离安装通过，npm默认全量1788/1788通过，无失败／取消／跳过／todo。尚无amend UI，见[amendRPC范围](<AMEND-RPC-SCOPE.md>)。

## 候选amend历史改写编辑与明确确认界面

- 独立AmendPanel只发送committer／message，显示旧HEAD／旧tree／原author／全部parents（root零项）和新tree／commit，actionamend严格metadata／format／OID／TTL绑定，编辑废弃旧候选，单次ack+token确认。
- 已加载empty staged允许message-only，八类mutation共享同步pending／unknown；普通commit先显示并以region隔离amend表单测试。独立静态复核无当前范围确认缺陷，组件＋独立golden25/25通过。
- 构建、隔离Edge完整浏览器含amend、67文件包检查与隔离安装通过；npm默认全量1803/1803通过，无失败／取消／跳过／todo。仍是严格子集／外部竞争限制候选，未正式发布或更新日常GUI，见[amend用户范围](<AMEND-USER-SCOPE.md>)。

## 图片叠加／滑动比较候选

- 新增overlay opacity与swipe split原生range0–100，默认并排；稳定左右资源owners跨模式／zoom不重拉，不同尺寸左上共同canvas按相同比例显示，无图像自动registration或像素写入。
- 加载／absent／error不伪装复合可用，per-side retry及URL关闭／scope／卸载释放保持；专用＋资源／scale14/14、与client34/34通过，独立复核无当前范围确认缺陷。
- 构建、隔离Edge完整浏览器追加mode／range边界无额外RPC检查、67文件包与隔离安装通过；npm默认全量1809/1809通过，无失败／取消／跳过／todo。native range键盘语义保留但未声称自动化按键覆盖，未更新日常GUI，见[图片复合范围](<IMAGE-OVERLAY-SCOPE.md>)。

## 固定commit本地分支条件创建原语

- 新增createLocalBranch实际Git zero-old／no-deref条件创建，固定已存在commit、HEAD原symbolic／tip与optionalIndexstat前后核对，ownemptyhooks＋fixed audit、poststart unknown无覆盖retryrollback。无checkout／对象／Index／Work写入。
- 独立golden捕获cloned CAS expectedOid未定义前置bug已修复；postwrite测试误把HEAD当目标ref修正。静态推断dangling symref可能被覆盖经实际Git2.56复现不成立，报dangling symref already exists且原条目保持，已按实证记录，其他版本不泛化。
- 模块扩展63/63、独立preservation／Gitcharacterization通过；npm默认全量1874/1874通过，无失败／取消／跳过／todo。尚无创建分支Host／RPC／UI，见[分支创建基础](<BRANCH-CREATE-PRIMITIVE.md>)。

## 固定HEAD分支创建只读预览

- 新增prepareBranchCreate仅短名，目标来自双次hashverified当前HEAD，不接受callerOID；outerraw HEAD/config／refslogs namespace稳定观察与目标absence双检，安全frozen摘要无权限。
- 名称portable字符／HEAD保留／1000总字节／255组件限制，case冲突及prefix／log／packed／linked拒绝。独立复核portable禁字符缺口已由最终实现覆盖，preIO回归通过。
- 模块70＋独立golden／guard75/75、旧fixedHEAD组合42/42通过，whole仓库无写；npm默认全量1949/1949通过，无失败／取消／跳过／todo。尚无确认／RPC／UI，见[创建分支预览范围](<BRANCH-CREATE-PREVIEW-SCOPE.md>)。

## 创建分支私有快照与确认事务

- prepare安全摘要绑定private原capture／name／fixedHEAD／ref，apply同步烧毁并拒绝clone／wrongrepo／public替换；prestart每次授权后原baseline capture＋hashverifiedHEAD复验，调用fixed zero-old创建。
- postcheck只豁免exacttarget／log与必要ancestor目录timestamp，保留oldrows与目录identity，rawtargetOID+version核对并在finalauth后重验。所有poststart失败branch-createunknown，不retry／rollback，callerwriter必要。
- 初轮确认组45/45、旧preview75/75，独立静态复核无当前范围确认缺陷；全量捕获1994/1994通过，无失败／取消／跳过／todo。后补7项finalauth突变和target版本pin后完整模块51/51通过，不虚增该次全量覆盖。尚无Host／RPC／UI，见[私有分支事务](<BRANCH-CREATE-TRANSACTION-SCOPE.md>)。

## 创建分支专属内部确认协调器

- 新增createBranchCreateCoordinator固定kind，仅安全短名own-data同步捕获，无caller起点OID／ref；公开target复制，原私有snapshot保留，type/root投影与genericwriter／grant绑定／TTL／cap／singleuse保持。
- wrongkind双向隔离、跨switch／commit／amend／stage／unstage同binding互斥和预／后start错误分类，专用85/85、独立golden＋相邻112/112通过，独立静态复核无当前范围确认缺陷。
- 默认全量捕获2002/2002通过，无失败／取消／跳过／todo；启动后专用85项测试单独通过，不虚增计数。尚无创建分支RPC／UI，见[创建分支Host范围](<BRANCH-CREATE-HOST-SCOPE.md>)。

## 创建分支授权预览／确认RPC

- 新增branch-create-prepare name-only与confirm token-only strict own-data prelookup快照，Gitonly／服务器HEAD起点／type-root投影，reader预览＋genericwriter确认；grant失效／clearcache／dispose和unknown优先正确。
- actual默认Host golden创建后HEAD不checkout、rawIndex／Work保持、重放拒绝；真实Host＋契约5/5、专用RPC20/20／相邻27及48项通过。独立静态复核无当前范围确认缺陷。构建、70文件包检查与隔离安装通过。
- 默认全量捕获2088/2088通过，无失败／取消／跳过／todo；后新增测试单独完整通过，不虚增全量覆盖。尚无创建分支UI，见[创建分支RPC范围](<BRANCH-CREATE-RPC-SCOPE.md>)。

## 固定HEAD创建分支候选界面

- 新增name-only编辑、fixedHEAD／完整ref／currentRef预览、独立ack＋token确认；exactname／target=head／format／TTL／四字段成功匹配，改名／scope／取消令旧candidate失效，无自动checkout。
- 创建接现有八类同步pending／unknown为九类；旧BranchSwitcher rawRPC未改，不冒称所有HEAD写者前端状态统一。独立复核初期缺locale已补zh/en明确no-checkout／bounds／恢复警告，逻辑无额外确认缺陷。组件13＋相邻117项／独立golden通过。
- 构建、隔离Edge完整浏览器含branch-create、70文件包检查与隔离安装通过；npm默认全量2118/2118通过，无失败／取消／跳过／todo。未发布或更新日常GUI，见[创建分支用户范围](<BRANCH-CREATE-USER-SCOPE.md>)。

## 切换分支统一共享pending／unknown恢复

- BranchSwitcher改走同一indexRpc十类confirm同步仓库门禁，switch读／预览也受live blocked限制；confirm取消／scope／unmount先markparentunknown，late成功忽略，旧handler不能消费replacement token。scope含mode／refresh／scan不含文件选择。
- 旧expiry测试改clock推进而非修改复制响应，保留冻结snapshot。新sharedgate7项与相邻40/40通过，独立静态复核无当前范围确认缺陷；恢复／refresh只清当前repo且pending时拒绝。
- 构建、隔离Edge完整浏览器、70文件包检查及隔离安装通过；npm默认全量2129/2129通过，无失败／取消／跳过／todo。未扩大后端checkout权限，见[切换共享门禁](<BRANCH-SWITCH-SHARED-GATE.md>)。

## 普通分支删除安全纯图计划

- 新增createBranchDeletePlan拒绝current ref／casealias，以CURRENT沿parents到TARGET证明merged；closed graph缺失／重复／所有component循环拒绝，无force输入，pureproof不授予删除权限。
- own-data图先捕获再signal，最多1万节点／16父；iterativecycle与proof无递归，canonical rows／parentsets绑定ID。初期生成regex转义错误修正，独立topic/config与unsafe-ref回归通过，当前源码静态复核无额外确认缺陷。
- 专用92＋独立3项95/95通过；默认全量捕获2132/2132通过，无失败／取消／跳过／todo。专用测试在run启动后创建，独立完整通过不虚增计数。无实际删除／RPC／UI，见[删除纯计划范围](<BRANCH-DELETE-PLAN-SCOPE.md>)。

## Raw commit对象集合认证删除图

- 新增createVerifiedBranchDeletePlan严格own-data对象集合，先校验节点／perbody2MiB／aggregate16MiB再全部owned capture，逐个fullGit hash与strictheader核验，parents只能来自rawbody，closedgraph判定沿用puremodel。
- 所有节点含disconnected均验证，不信caller merged／force／parents；不返回body、不授予ref权限，Proxy／shared-memory原子性明确排除。专用54＋独立2项56/56、相邻158/158通过，静态复核无当前范围确认缺陷。
- 默认全量捕获2226/2226通过，无失败／取消／跳过／todo；启动后54项专用测试独立完整通过，不虚增计数。无实际仓库图capture／删除，见[认证删除图范围](<VERIFIED-BRANCH-DELETE-PLAN.md>)。

## 实际仓库普通分支删除只读预览

- prepareBranchDelete固定currentHEAD与loose targettip，双端完整parent rawhash认证，closedgraphmerged证明；fullmetadata／HEAD／config／target观察屏障，15s／1万节点／2MiBbody／16MiB图／2万metadata限制，超限拒绝非force。
- readonly无WorkIndex正文／ref／对象／temp写入，真实sha1／sha256 root／merge／unmerged、stale各阶段／cancel／limits专用85项；复核缺失name继承问题以nullprototype修正，独立getter0调用验证。最终完整＋golden87/87通过。
- 默认全量捕获2363/2363通过，无失败／取消／跳过／todo；后新增测试和capture硬化独立完整复验，不虚增覆盖。无删除执行／Host／RPC／UI，见[删除预览范围](<BRANCH-DELETE-PREVIEW-SCOPE.md>)。

## 固定old-OID非当前分支条件删除原语

- 新增deleteLocalBranch仅exactrefsheads／expectedOID，current／casealias拒绝，HEADraw／tip／logs与optionalIndexstat固定，ownemptyhooks禁用事务hook，update-ref --no-deref -d ref expectedOID，不checkout／objects／Index／Work写。poststartunknown无retryrollback。
- 实测Git2.56 SHA1／256 matchingresolvedOID symbolic条目可删但destination保持；该CAS不是rawtype身份保护，源与文档明确窗口，无Host／RPC／UI。专用91＋独立2项93/93通过，静态复核无当前内部范围额外缺陷。
- 首轮全量2368/2369，metadata2万项遍历先达15s导致限额错误类型断言失败；加fanout预拒绝，不扩大预算或弱化测试。修正后默认全量2460/2460通过，无失败／取消／跳过／todo，见[条件删除原语](<BRANCH-DELETE-PRIMITIVE-SCOPE.md>)与[实测竞争](<BRANCH-DELETE-RAW-REF-RACE.md>)。

## 私有已合并分支删除事务

- exact摘要WeakMap绑定原merged认证图／HEAD／target／metadata，一次性burn，prestart授权前后核对原基线；post仅允许目标ref／log及必要空祖先目录消失，其他metadata／HEAD保持，finalauth后再验。
- 独立真实golden1/1、既有preview85/85通过；首轮专用fixture EPERM／deadline时序失败保留，修正后委派完整46/46通过，未冒充Lead独立重跑。全量捕获2461/2461通过，后新增专用不虚增该计数。
- 内部trusted-concurrency范围，仍无删除Host／RPC／UI，rawref类型外部竞争非原子保护，见[事务范围](<BRANCH-DELETE-TRANSACTION-SCOPE.md>)。

## 删除分支专属内部确认协调器

- 新增createBranchDeleteCoordinator固定kind，only-own短name prepare，private merged snapshot服务器保留；public current／target／proof复制，无caller force／OID／graph。
- TTL／capacity／grant／scope／singleuse、create／switch／commit／amend／Index双向token隔离与sharedwriter／reader验证，专用88/88＋独立golden／相邻200/200、全部Host roster325/325通过。
- 无删除RPC／UI，不新增全量通过声明；rawref类型外部竞争限制未解决，仍internaltrusted范围，见[删除Host范围](<BRANCH-DELETE-HOST-SCOPE.md>)。

## 删除分支只读评估RPC

- 新增branch-delete-preview严格name-only prelookup快照，Gitonly／reader与postread授权；公开摘要重新构造current／target／proof不暴露WeakMap身份，vcs仅prepare导出。无删除confirm／tokenprepare路由。
- actual默认Host无token、ref／HEAD／rawIndex／Work保持，unsupportedconfirm拒绝，独立＋契约5/5；专用10/10、相邻35/35、全部RPC roster143/143通过，静态复核无当前范围确认缺陷。
- 构建通过；包初轮source allowlist缺图模块失败，以exact2 runtime源修正，74文件包检查与隔离安装通过。本批不新增全量通过声明；rawref竞争未解决不开放写入口，见[只读RPC范围](<BRANCH-DELETE-PREVIEW-RPC.md>)。

## 删除分支只读安全评估界面

- name-only只读RPC展示固定current／target与认证祖先proof，exactresponse无token／confirm／force；proof唯一dense1..10000首尾与format固定，same-tip单点允许，copyfreeze。
- 编辑／cancel／scope迟到结果忽略，不触发unknown；Gitworkspace独立status／selection，sharedpendingunknown阻止旧handler读评估。zh/en明确未执行删除／merged非许可／原始ref竞争限制，静态复核无当前范围确认缺陷。
- 专用10项与独立golden／相邻40/40、全部client roster捕获183/183通过，新freeze项单独完整复验；初轮缺fixture ENOENT补齐复验。构建、隔离Edge完整浏览器含新assessment、74文件包与隔离安装通过。本批不新增全量声明，见[只读评估UI](<BRANCH-DELETE-ASSESSMENT-UI.md>)。

## 删除只读评估长证明分页

- 完整proof仍验证1..10000，展示收起零路径项／展开每页100；独立getProofPage0-based边界拒绝、global序号／总数／prevnext，翻页不RPC。每次结果新viewer实例重置，旧handler不影响replacement。
- 专用14/14、全部client加独立golden190/190通过；独立静态复核无当前范围确认缺陷。构建与隔离Edge真实native details／1万OID100页／DOM上限／结果重置验收通过，74文件包及隔离安装通过。
- 不改变backend祖先判断／rawref限制，无删除写入口，不新增全量通过声明，见[证明分页](<DELETE-PROOF-PAGINATION.md>)。

## 未签名annotated tag纯对象模型

- 新增encodeGitTag／parseVerifiedGitTag，固定typecommit／portable短tag／显式tagger／消息，SHA1／256全Git framing hash；exactown字段，原body先copy再options／signal，canonical四header，消息BOM／CRLF／EOF保持。
- 非空64KiB消息、identity1024byte／timezone1400，PGP marker／未知header／type／签名选项拒绝，parser冻结标量不泄漏body；不证明目标存在或ref安全。专用12＋独立literal／真实Git4项16/16通过，verified对象roster106/106，静态复核无当前范围确认缺陷。
- 无引用写入／Host／RPC／UI／签名，真实Git对象oracle仅隔离临时仓库；本批不新增全量声明，见[tag对象范围](<GIT-TAG-OBJECT-SCOPE.md>)。

## Append-only tag对象存储支持

- storeCapturedObject新增显式tag类型与128KiB上限，语义仍opaque；所有fullstream／framing／hash／exclusive temp+hardlink NOREPLACE／owned cleanup／poststartunknown规则保持，无ref写入或用户入口。
- 原invalidtype tag更新为tagg，保留未知类型拒绝；初轮专用生成字符串转义SyntaxError修正后25新＋36旧61/61，含独立bytecapture67/67通过。blob／object／commitpublisher组合111/111、tagmodel／publisher53/53通过，静态复核无当前范围确认缺陷。
- 实际Git SHA1／256 tag字节核验，无refs／HEAD／Index／Work写入；不新增全量通过声明，见[tag存储范围](<TAG-OBJECT-STORE-SCOPE.md>)。

## 认证commit到annotated tag纯计划

- 新增createVerifiedTagPlan rawcommit先owned capture再inputs traps，tagger／message snapshot后才signal；hashverifiedtarget／tree派生固定typecommit tag，canonical roundtrip，domainSHA256 tuple绑定format／target／tagOID／ref。
- Frozenmetadata但ownedbody可变，明确publisher需重算hash；不证明仓库存在性／refabsence／授权。专用12＋独立literal／realGit4项16/16、既有模型40/40、verified对象tagstorage捕获143/143通过，静态复核无当前范围确认缺陷。
- 无引用写入／Host／RPC／UI，不新增全量声明，见[认证tag计划](<VERIFIED-TAG-PLAN-SCOPE.md>)。

## 目标认证tag对象append-only发布适配层

- publishTagObject捕获bounded targetcommit／tag rawbodies，再分别hash与strictheader核验，绑定tag.object=targetOID；不信planID／parsedmeta，onlytag store无refs／target写入。existingvalidnostart，poststartunknownappendOnly不delete／retryGC。
- 首委派worker失败未留artifact，Lead检查后实现；独立测试专用26＋golden2项28/28通过，真实Git SHA1／256字节及HEAD／Index／target保持；相关tag／store／commitpublisher138/138通过，静态复核无当前范围确认缺陷。
- 未证明目标磁盘存在／refabsence／Session授权，无Host／RPC／UI，本批不新增全量声明，见[tag发布范围](<TAG-OBJECT-PUBLISH-SCOPE.md>)。

## 当前HEAD annotated tag真实仓库只读预览

- prepareTagCreate只name／tagger／message，服务器readLatestCommit认证HEAD后固定fullOID rawread生成tagplan；refs/tags＋logs absence含prefix／case，fullmetadata／HEAD／config稳定屏障，15s／2万metadatafanout上限，无WorkIndex正文／temp对象引用写。
- 安全冻结摘要含tagOID／planID不含body或执行能力；最终60专用＋独立1项61/61、tag纯模型组合捕获91/91通过，wronghash／真实malformed／signedtarget拒绝，静态复核无当前范围确认缺陷。
- 无Host／RPC／UI／force／签名／push，不新增全量声明，见[tag预览范围](<TAG-CREATE-PREVIEW-SCOPE.md>)。

## Annotated tag引用不覆盖创建原语

- createLocalTag仅fixedrefs/tags与expectedTagOID，必须existing strict tag rawhash／tag名匹配，目标rawcommit真实存在并认证；HEAD／currentlogs／Indexstat固定，ownedemptyhooks禁用事务hook，Git zero-old no-deref创建无objects写入。
- 初期snapshot漏tags日志父目录和wrongtype错误code测试oracle修正，最终89专用＋独立2项91/91通过；相邻CAS50/50与模型58/58通过，静态复核无当前范围确认缺陷。实测Git2.56 born／dangling symbolic竞争拒绝且保留，不泛化所有版本。
- poststartunknown不retryrollback，无Host／RPC／UI，不新增全量声明，见[tag引用原语](<TAG-REF-CREATE-SCOPE.md>)。

## 私有annotated tag对象＋引用确认事务

- unchanged安全summary绑定WeakMap原始HEAD／metadata／target/tagbytes，先burn后复验，appendtag后严格fullinflate／rawhash与onlyexactobject追加包络，CAS固定ref／tagOID，post只固定ref／optional审计log与必要祖先变化，finalauth再验。
- 初始重复latestreader正常golden多次15s超时，独立结构分析定位重复调用；优化移出重复fullreader后Lead globalconfig回归暴露漏检，补everyverify fresh effective no-includes比对后成功／globalconfig2/2，最终Lead确认25＋独立2项27/27通过。预算未提高，失败证据保留；委派confirm＋preview86/86及logancestor3/3通过，最终静态复核无当前范围确认缺陷。
- 无Host／RPC／UI，poststartunknownappendOnly不retryrollback，不新增全量声明，见[tag事务](<TAG-CREATE-TRANSACTION-SCOPE.md>)与[预算证据](<TAG-TRANSACTION-BUDGET-EVIDENCE.md>)。

## Tag创建专属内部确认协调器

- createTagCreateCoordinator严格ownname／tagger／stringmessage预await捕获，tagencoder验证，fixedkind独立token保留private快照；公开tagger／object复制，不泄露body，poststartunknown核对refsHEAD禁止retry／delete／rollback。
- 专用27＋独立fakeauthority／actual真实事务2项29/29通过，全部Host roster352/352通过；真实事务HEAD／Index保持且token重放拒绝，静态复核无当前范围确认缺陷。
- 无RPC／UI／认证来源假设或外部原子性承诺，不新增全量声明，见[tagHost范围](<TAG-CREATE-HOST-SCOPE.md>)。

## Annotated tag授权预览／确认RPC

- tag-create-prepare严格own name／tagger／message prelookup快照，serverHEAD固定，confirm onlytoken；Gitonly reader／writer与grant失效／cache／dispose保持，unknown优先cancel，predispatchabort明确取消。
- actualHost＋契约5/5：tagOID／peelcommit一致、HEADIndexWork保持、replay拒绝；专用23/23、相邻54/54、全部RPC167/167通过，静态复核无当前范围确认缺陷。
- 构建、80文件runtime闭包及隔离安装通过；无tag界面，不新增全量声明，见[tagRPC范围](<TAG-CREATE-RPC-SCOPE.md>)。

## Annotated tag创建候选界面

- explicitname／blanktagger／exactmessage编辑，fixedserverHEAD／tagOID／targetTree／ref／metadata／bytecount／TTL绑定，uncheckedack＋tokenonly确认，exact五字段成功，shared第11类pendingunknown。
- 独立复核oldprepare／cancel跨draft缺陷，generation＋samevalue rerender修正，旧confirm／ack／expiry隔离维持；最终专用16项、全部client＋独立golden206/206通过。并发guard中间失败保留，不改后端权限。
- 构建、隔离Edge完整browser含tag-create、80文件包与隔离安装通过；本批不新增全量声明，无日常GUI升级，见[tag用户范围](<TAG-CREATE-USER-SCOPE.md>)。

## 分支创建草稿generation隔离

- 独立旧prepareA在draftB提交A复现1!==0，加入edit／cancel generation及samevalue强制rerender，准备response／error／finally拒绝旧代际，oldcancel不清新候选，confirm／ack原token身份保持。
- 新增4项专用，branch＋tag＋golden34/34、完整client＋独立golden最终209/209通过，静态复核无当前范围确认缺陷；browser实际当前UI A→B→A／freshack／latecancel验证，不假称detachedDOM事件验证闭包。
- 构建、隔离Edge完整browser、80文件包与隔离安装通过，不新增全量声明，不扩大Git写入权限，见[草稿代际](<BRANCH-CREATE-DRAFT-GENERATION.md>)。

## Commit草稿代际及最近消息复用隔离

- 独立golden复现oldprepare提交旧message，新增author／committer／message编辑／clear／reuse／cancel generation＋forcedrerender，preparereturn/error/finally校验controller／generation／liveaccess；latest-only cancel保留candidateack。
- 新增28测试，commit／latest＋独立golden49/49、相邻81/81、全部client最终237/237通过，静态复核无当前范围确认缺陷。browser当前mounted身份A→B→A／clear／current及same-message reuse通过，不虚称detachedDOM闭包验证。
- 最终构建、隔离Edgebrowser、80文件包／隔离安装通过，不新增全量声明，不改变后端权限，见[commit草稿隔离](<COMMIT-DRAFT-GENERATION.md>)。

## Amend草稿代际隔离

- 独立golden先复现oldprepare提交旧message（1!==0），新增committer／message／clear／cancel generation＋samevalue rerender，prepareactive含controller／liveaccess／generation，旧cancel不清新候选，confirm／ack／unknown保持。
- 18专用＋13既有31/31、全部client＋专用254/254通过，静态复核无当前范围确认缺陷；真实browser当前DOM各字段编辑／取消／重新ack通过，不假称detachedDOM闭包验证。
- 构建、80文件包与隔离安装通过，不新增全量声明，不扩展amend后端子集，见[amend草稿隔离](<AMEND-DRAFT-GENERATION.md>)。

## 切换分支目标代际与owner cleanup

- 独立golden复现oldprepare在无目标时仍提交旧B，增加selection／listreset／cancel／close generation＋samevalue render，read／prepare任务identity／liveaccess响应保护，confirm原token身份与unknown保持。
- 静态复核发现access-dependent finally会在兄弟pending期间settle后永久busy，独立golden复现true!==false，Lead交接后修复为generation／controller／alive ownership-only cleanup，不放松响应access。
- 新旧switch＋独立26/26、完整client＋代际246/246通过；最终构建、隔离Edgebrowser native B→C→B／freshpreviewcancel、80文件包与隔离安装通过。不新增全量声明，见[目标代际](<BRANCH-SWITCH-TARGET-GENERATION.md>)。

## 只读删除评估草稿代际

- 独立samevalue／A→B→A回归复现oldassess请求1!==0，新增clear推进generation＋forcedrerender，oldassess／cancel拒绝旧代际，active含controller／generation，owner-only finally与proof分页保持，无unknown写入。
- 专用2＋既有14项16/16、完整client＋新golden238/238通过，静态复核无当前范围确认缺陷；构建、隔离Edgebrowser、80文件包与隔离安装通过。
- 不提供删除确认，不新增全量声明，见[评估代际](<ASSESSMENT-DRAFT-GENERATION.md>)。

## Lightweight tag认证目标纯计划

- createVerifiedLightweightTagPlan rawcommit先owned copy再own-data inputs／signal，strictportable短名与2MiB上限，完整hashheader核验后生成直接commit target／tree／refs/tags的冻结标量计划，无tagger／message／tag对象。
- 独立domainID与annotated不同，requiredtargetname拒绝override／getters，native任意取消reason保持；专用13＋独立literal／realGit4项17/17、verified对象完整roster135/135通过，静态复核无当前范围确认缺陷。
- 无对象／ref写入／Host／RPC／UI，不新增全量声明，见[lightweight纯计划](<LIGHTWEIGHT-TAG-PLAN.md>)。

## Lightweight tag真实仓库只读预览

- prepareLightweightTagCreate仅own短name/native signal，fixed currentHEAD rawhash→lightweightplan，refs/tags＋logs absence／prefix／case，fullmetadata／HEAD／config closing屏障，无对象引用temp写与WorkIndex正文读取。
- 初轮生成RegExp字符串转义运行时SyntaxError修为验证过literal；专用51＋独立1项52/52、lightweightplan18/18、既有annotatedpreview60/60通过，真实SHA1／256整个仓库无写，静态复核无当前范围确认缺陷。
- 无Host／RPC／UI，不新增全量声明，见[lightweight预览](<LIGHTWEIGHT-TAG-PREVIEW.md>)。

## Lightweight tag不覆盖引用创建原语

- createLightweightTag fixed refs/tags／expectedCommitOid，仓库rawcommit hash认证两次后zero-old no-deref更新，HEAD／日志／Indexstat固定，ownedemptyhooks禁用事务hook，无objects／Work写。
- clone未用tag变量与提示清理；独立golden初漏dirtyfixture修复，专用44＋独立2项46/46、既有refCAS49/49通过，静态复核无功能安全缺陷。当前Git2.56 born／dangling symbolic竞争拒绝且destination保持，版本事实不泛化。
- 无Host／RPC／UI，不新增全量声明，见[lightweight引用原语](<LIGHTWEIGHT-REF-CREATE.md>)。

## Lightweight tag私有确认事务

- issued摘要WeakMap绑定原HEAD／metadata，synchronous burn严格callback／repo校验，onecurrentfacts认证＋everybarrier fresheffectiveconfig与原rawHEAD/currentref核对；zero-oldfixedHEAD创建无对象追加。
- post仅固定ref／optional auditedlog与必要祖先dirs，createdrows与finalauthclosure保留；poststartunknown无appendOnly／retryrollback。54专用＋独立success／globalconfig2项56/56通过，既有readonly51/51通过，静态复核无当前范围确认缺陷。
- 首轮命令计数filter前缀、Windows readonlyobject fixture失败修正后完整复验，不提高预算；无Host／RPC／UI，不新增全量声明，见[lightweight事务](<LIGHTWEIGHT-TAG-TRANSACTION.md>)。

## Lightweight tag专属内部确认协调器

- createLightweightTagCoordinator name-onlyown捕获，fixedkind与annotatedtag独立，8scalarpublicprojection保留privateidentity，generic TTL／cap／grantburn／sharedwriter与unknown继承；clone诊断名清理。
- 独立actual仓库创建与annotated跨token2/2，专用30/30、全部Host＋独立golden384/384通过，静态复核无功能安全缺陷。测试初literal转义与U+FFFD误当surrogate失败修正后完整通过，未弱化生产校验。
- 无RPC／UI，不新增全量声明，见[lightweightHost](<LIGHTWEIGHT-TAG-HOST.md>)。

## Lightweight tag授权预览确认RPC

- name-only prepare／token-only confirm strictown prelookup，Gitonly/commonreader／genericwriter，serverHEADtarget，grantinvalidate／cache／dispose及unknownpriority／predispatchabort接入，annotatedtoken独立。
- 首worker失败无路由；重委派期间actualHost先遇未保存vcs export，保存后真实5/5、专用25/25、相邻72/72通过，静态复核无当前范围确认缺陷。最终build／84文件包与隔离安装通过。
- 全部RPC并行real annotatedtag触发预算失败保留；不提高生产15s，顺序roster193/193通过，不冒称并行全绿／全量。无lightweightUI，见[RPC范围](<LIGHTWEIGHT-TAG-RPC.md>)。

## Lightweight tag创建候选界面

- name-only draft／serverHEAD／tree／ref／format／planId／tokenTTL固定，exact10字段preview与四字段success；直接commit无tag对象／tagger／message，与annotated分开展示，代际＋taskidentity旧回调隔离，shared第12类确认pendingunknown。
- 专用19＋独立serveraction1项20/20、完整client最终256/256通过，future-expiry fixture老化改每请求freshbound保留真实范围；静态复核无当前范围确认缺陷。
- build、隔离Edge完整browser含lightweight-tag、84文件包／隔离安装通过，不新增全量声明，不更新日常GUI，见[lightweight用户范围](<LIGHTWEIGHT-TAG-USER-SCOPE.md>)。

## Lightweight真实RPC双格式集成与默认全量核验

- 新增4例实际defaultHost SHA1／256成功与prepare后外部竞争，directcommit／HEAD／rawIndex／stageddirtyWork／objects字节及identityversion保持、tokenreplay／competitor不覆盖。专用4/4且Lead重复4/4通过，fixture unsupported gpgsign配置修正保留。
- 当前原始npm test默认全量3272项3259通过／13失败（deadline相关），不修改默认并发或15s预算。六个失败事务golden顺序隔离6/6通过，仅属诊断证据，不替代默认全量绿，也未验证另外七项全部通过。
- 当前全量未验收，完整Fork仍缺多项功能，见[本轮集成矩阵](<LIGHTWEIGHT-RPC-INTEGRATION-MATRIX.md>)。

## 分支创建重复Git事实读取优化

- apply改onefull latestreader＋每barrier fresheffectiveconfig／rawcurrentref，prepare pinconfig；capture扩展完整.git metadata，保留objects／Index／hooks／locks原始versions与closing，postonlytargetref／log／ancestor例外，15秒预算未增。
- SHA1／SHA256 apply实际22Git启动（config11 facts5 checkref2 catfile3 update1），新19/19、既有preview＋confirm121/121、独立创建／globalconfig／realHost3/3通过，静态复核无当前范围确认缺陷。初instrumentation计数和Windows readonlyfixture失败修正不改生产语义。
- 最终build／84文件包与隔离安装通过；先前默认全量13deadline失败未重跑整体，不宣称全部修复，见[验证成本](<BRANCH-CREATE-VERIFICATION-COST.md>)。

## 分支删除内部事务验证开销与配置新鲜度

- oneapply fullreader＋everyfresh/deleted effectiveconfig与preparebaseline、原rawcurrentref字节比对，原fullmetadata／HEAD／config与onlytargetlog删除例外保持，pendingauth共同signalrace有界。
- 独立finalglobalconfig先复现Missing expected rejection，修复后success／globalconfig2/2；既有confirm＋preview131/131，新freshness27/27通过，SHA1／256 apply实测30Git启动，预算不变。新测试初错误要求prestart失败后reflog消失，修正为保留targetlog后通过。静态复核无当前范围确认缺陷。
- build／84文件包／隔离安装通过；默认全量13失败尚未整体重跑，rawref类型竞争未解决，无删除写RPC／UI；实现worker最终顺序组合158/158通过（27新鲜度＋46确认＋85预览），未执行全量，见[删除验证开销](<BRANCH-DELETE-VERIFICATION-COST.md>)。

## Commit／amend捕获独立只读并行

- capture的metadata与workPolicy通过settledReads并行，等待所有siblings后按输入顺序确定首错；同步throw亦被捕获并drain，关闭metadata／root屏障、配置验证先后与同15秒budget不变。
- helper＋真实初验4/4、capture／capability75/75、顺序真实commit／amend＋helper5/5通过，静态复核无当前范围确认缺陷；build／85文件包与隔离安装通过。
- 未测量性能提升比例，不推断默认全量13deadline已修复，本批未重跑默认全量，见[settled读取](<COMMIT-CAPTURE-SETTLED-READS.md>)。

## Commit／amend首次配置读取路径绑定

- capture首次Git config显式--git-dir=canonical.git／--work-tree=canonicalroot并--no-includes，保留core.worktree等原policy拒绝，不以-c改写危险配置。
- 真实重定向fixture commit／amend断言仅config调用且含两pin、无catfile、rawHEADIndex保持；preflight＋preview37/37，顺序真实事务＋preflight5/5通过。observer仅过滤新增路径全局参数不改实际spawn，静态复核无当前范围确认缺陷。
- build／85文件包与隔离安装通过，不增加预算、不新增全量声明，见[配置仓库绑定](<COMMIT-CONFIG-REPOSITORY-BINDING.md>)。

## Commit／amend metadata立即扇出预拒绝

- 2万节点上限含根不变，names.length超过剩余节点额度时在sort／childstat前拒绝，每child至少1节点，不删closingbarrier／sharedbudget。
- 独立commit／amend0childstat／0Git＋settledsiblings4/4；广捕获回归两项旧observer不识别新增pathpins，精确过滤测试observer后fanout／capability／consume40/40通过，静态复核无当前范围确认缺陷。
- build／85文件包与隔离安装通过，不新增默认全量绿声明，见[扇出预判](<COMMIT-METADATA-FANOUT.md>)。

## Commit／amend工作区扇出准入预判

- workPolicy先过滤精确根.git，再按含root的2万节点剩余额度立即拒绝必超fanout；嵌套.git／大小写别名原拒绝与names/types-only保持，settledsiblings收齐不变。
- commit／amend19999准入首child sentinel、20000拒绝0childstat边界与metadatahelper8/8，完整preview＋新边界39/39通过，静态复核无当前范围确认缺陷。build／85文件包与隔离安装通过。
- 未测真实2万文件遍历、不增预算、不新增默认全量绿声明，见[workfanout](<COMMIT-WORK-FANOUT.md>)。

## 最近提交共享读取器metadata立即扇出预判

- metadata root含节点2万限额不变，直接children超过remaining时sort／childstat前拒绝；19999sentinel准入／20000零childstat边界2/2且0Git，不伪称真实2万项遍历。
- 完整reader／metadata55/55、RPC／UI消费者21/21、真实branch／annotated／lightweightpreview3/3通过，静态复核无当前范围确认缺陷；firstconfig与rawHEADref／hash／closing屏障保持。
- build／85文件包与隔离安装通过，未提高预算／测性能比例／新增默认全量绿声明，见[共享读取器扇出](<LATEST-METADATA-FANOUT.md>)。

## Tag原生任意取消原因契约补充

- 检查当前parser／annotatedplan／lightweightplan已分离native品牌识别与throwIfAborted，无需重复生产修复。新增SHA1／256 ×3消费者的string／number／null／object／Error／Symbol取消reason严格identity、active／aborted实例覆盖getter零读取与cooperative第二检查回归。
- 专用12/12，tag模型与publisher75/75、verified模型组合143/143通过，静态复核无当前范围确认缺陷；不推导可序列化API reason或eventloop异步中断。
- 本轮无生产代码变更、不新增全量声明，见[native取消契约](<TAG-NATIVE-CANCEL-CONTRACT.md>)。

## 默认全量第100轮复验及并行预算契约

- 原始npm test未改并发预算，3348项3338通过／10失败，1077.2秒；不同于先前3272集合不作直接性能比较，当前默认全量未绿。
- 三项amend stale注入observer未识别pinnedpath导致mutation未触发，测试副本规范化后3/3、完整amend＋readbudget26/26通过；其余deadline／最终callback未达等失败保留，tag三golden顺序3/3仅诊断不替代默认。
- 新增settledbudget3项验证exact AsyncLocalStorage／nesteddeadline与取消drain；静态review指出初test假阴性后，用setImmediate settlement检查和assert.rejects修正，helper组合5/5通过，无生产helper改动。详见[默认结果](<DEFAULT-REGRESSION-ROUND100.md>)。

所有真实Git变更仅用于临时测试仓库。未升级用户profile、未重启DSH、未发布或提交；当前页面不因源码构建自动更新。
