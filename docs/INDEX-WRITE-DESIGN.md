# 确认式暂存／取消暂存设计边界

状态：候选单文件unstage已完成适配器／固定RPC／确认界面与隔离验证；stage仍在[捕获字节对象存储](<STAGE-CAPTURED-BYTES.md>)基础开发阶段，尚未开放。Fork对齐顺序见[清单](<FORK-PARITY.md>)。

## 必须解决的问题

现有工作区change ID绑定路径和状态，不绑定正文；不能把同一个ID当成写授权。现有分支切换的插件内互斥也不能防止外部Git写入Index。不能采用“重新status后git add实时路径”来声称只暂存预览过的内容。

## 首个可交付边界

- 明确确认的单个已跟踪普通文本修改，先文件级，不假称已支持逐行／块。拒绝冲突、改名、删除、新增、特殊Index flags、链接、子模块、attributes、filters、sparse／partial及进行中操作。
- Stage必须绑定捕获的原始字节及其明确转换规则；不能重新读取一个可能已变化的路径并静默暂存。最初拒绝已部分暂存的选中文件，避免全文件stage覆盖用户的行级选择；其他文件的暂存内容必须保持。
- Unstage必须从预览中固定的HEAD树恢复所选条目，不执行宽泛reset／read-tree，不改工作文件，不改变其他条目。unborn HEAD单独设计，不默认放开。

## 事务和并发

1. 服务器预览保存操作种类、Session／cwd／仓库身份、固定HEAD、完整Index字节指纹、所选路径和模式、Index条目及工作正文指纹，返回仅有界公开摘要和短期一次性token。
2. 确认消费token，复验授权并占有插件内写锁；同一token不能跨操作使用。
3. 安全创建并独占真实index.lock，确认锁文件身份、原Index指纹和仓库元数据未改变。锁只约束遵循Git协议的Index写者，不能冻结HEAD或工作文件。
4. 从已确认Index构建隔离candidate index，仅修改固定路径。不得接受浏览器提供GIT_INDEX_FILE、命令参数、任意环境变量或stdin。若新增命令能力，应使用私有、专用、受限的内部入口并继承输出、超时、取消和环境保护。
5. 写入前再次检查授权、HEAD、Index及捕获文件身份，验证candidate的全部未选条目保持原值；原子发布candidate Index。只清理自己创建且身份仍匹配的锁，不删除外部进程的锁。
6. 只在真正开始仓库持久写入前发出onStart。写入后取消、超时、授权变化或结果无法确认均为结果未知，不自动回滚或重试；成功后核对所选与未选条目并刷新。

对HEAD及工作文件的复验不是跨进程全局事务。可承诺的是发布用户确认的捕获字节／固定HEAD条目，以及不丢失外部Index更新；不能承诺面对任意恶意并发写者，发布瞬间文件系统所有状态仍与预览一致。

## 纯模型与锁基础的接入约束

Index模型和自有锁由候选unstage适配器接入受控RPC，不单独授予仓库写权限。锁helper只校验文件身份、CAS和发布生命周期，不负责Git格式、内容授权、HEAD／配置／路径安全；适配器必须先完成这些验证。candidate必须经过严格解析和单条目语义比较，不能把任意Buffer直接送入publish。每个异步锁操作须等待完成，不在回调退出后保留发布能力。

## 候选构建的额外要求

- 先交付现有条目的unstage路径，再交付stage，降低首批持久写范围；捕获字节的hash-object -w会追加对象，取消时可能留下不可达对象，必须披露，不能用GC作为回滚。onStart应在首次持久仓库写入前触发，而不只是在Index rename前触发；内部可另跟踪publishStarted区分Index是否可能变化。
- 初期只接受经校验的完整Index v2／v3，拒绝split／sparse／未知mandatory扩展与意外extended flags。候选语义比较须覆盖所有未选路径的mode／OID／stage／flags，不只比较git status。
- 当前命令runner丢弃继承GIT_*且忽略stdin。新增内部candidate-index或捕获Buffer能力不得开放任意env／stdin／参数，也不能改变既有只读runner默认。
- EOL转换必须明确。首个raw-byte stage应拒绝非identity autocrlf／eol和相关attributes，而不是把与git add不同的结果静默呈现。
- 锁定后再次校验完整Index，写入自有index.lock并flush，原子rename发布；Windows共享冲突不得删除旧Index再重试。崩溃持久性与目录fsync须按平台验证，不默认承诺。
- 顶层操作预算在work返回后也可能过期；写后成功丢失确认同样须映射结果未知，不能被通用cancel／timeout覆盖。

## Index格式与扩展

二进制格式依据Git的gitformat-index规范：v2／v3条目的8字节padding相对于条目起点，而不是整个文件；SHA256仓库的对象ID和尾部校验和都为32字节。尾部全零可能来自合法index.skipHash配置，但在本写入边界下无法验证，应明确拒绝为不支持，而不是判定仓库损坏。

替换OID后不能保留旧TREE缓存，否则write-tree或diff可能复用旧树。EOIE／IEOT等派生索引扩展应删除或重建；link／sdir等必需扩展和未理解的语义扩展须拒绝。大写可选扩展表示Git读取时可忽略，不表示写入器可以原样复制未知缓存。

## Racy-clean缓存与Index时间

索引重新发布会更新时间戳。即使未选条目的mode／OID／flags与原来完全相同，直接保留其stat缓存也可能把同一时间粒度内修改的工作文件误判为干净。候选构建必须针对旧Index时间执行Git兼容的racy smudge，或保守清除所有条目的stat缓存（保留mode／OID／path／flags）。未选条目的语义内容保持不变，不等于stat缓存字节必须不变；后者反而可能不安全。纯Buffer构建结果不得在没有明确缓存失效策略时直接发布到live Index。

## 验收

真实临时仓库覆盖：正常stage／unstage、其他文件部分暂存不变、所选MM拒绝、HEAD／Index／正文在预览后变化、锁竞争、过期及重复token、Session变更、取消前后、失败与结果未知、CRLF及无末行换行、特殊Unicode路径、链接替换／硬链接、attributes／filters／hooks、SHA1／SHA256、候选Index异常、仅清理自有锁。RPC与浏览器必须验证精确预览身份和确认、取消、恢复提示。

这些前置证据完成前，保留默认只读和现有唯一分支切换写入口，不以通用协调器存在宣称暂存已完成。
