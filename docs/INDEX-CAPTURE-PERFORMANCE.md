# 写入复验性能优化边界

目标：减少同一次prepare／confirm中固定对象的重复读取进程，不削弱任何可变状态复验，不增加生产15秒预算。

## 允许复用

只在单个公开操作私有上下文中复用固定commit OID的完整树解析及已验证HEAD blob类型。cache key必须含canonical root、objectFormat、完整commit OID及当次对象／metadata身份；metadata变化后不能直接复用。Stage添加精确自有blob导致metadata变化时，先重新验证再建立该次新cache。

## 不允许复用

授权／Session／cwd／grant、当前HEAD与ref、有效配置、attributes、完整Index字节和身份、工作文件原始内容及身份、目录／metadata校验每次继续执行。不能以缓存命中代替取消／预算检查，不能跨操作、仓库、grant或插件生命周期保存该缓存。

Root／格式／HEAD等rev-parse输出若合并为一次命令，仍须严格字段数与OID／format验证，不接受混杂选项输出；所有Git读取在配置与路径guard之后，仍禁用替换refs、懒fetch和shell。

## 真实进程计数

合并root／format／HEAD严格framed rev-parse读取，仍每capture重读。SHA1计数：prepare两次capture由16→10个Git进程；stage apply八次capture由64→36（blob追加metadata变化后固定对象重新读取）；unstage apply五次capture由40→22。SHA1／SHA256计数均通过。新测试初次暴露两处夹具问题：Windows loose对象只读导致故意损坏未执行；改写budget.deadline属性不会改变内部闭包截止时间。分别在临时对象chmod及共享budget检查点注入TIMEOUT后重跑；没有改变生产取消或文件权限策略。最终cache19/19、既有stage／unstage66/66、真实RPC1/1由实现方针对性验证通过；Lead独立固定blob删除及最终授权变化2/2、修正夹具2/2通过。此前全量922/924仅失败于修正前夹具，最终不变源码npm默认并发全量924/924通过，无失败／取消／跳过／todo（285.6秒），包含真实生产RPC。

## 当前单次采样

相同小仓库逐RPC一次采样：优化前stage confirm7254ms／unstage confirm4400ms；复用后stage confirm6309ms／unstage confirm3470ms，prepare1881ms／1569ms；合并rev-parse后实现方另次采样stage confirm5689ms／unstage confirm3088ms，prepare1686ms／1420ms。进程负载并非严格相同，此处只记录观察值，不声称稳定比例提升。默认15秒预算和npm测试并发设置不变；最终默认并发924/924通过，只说明本次受测负载，仍非任意规模性能保证。

## 验收

- 真实Git计数确认同次操作重复ls-tree／cat-file减少，跨操作重新读取。
- metadata／对象／config／HEAD／Index／work在回调后变化继续拒绝；尤其仅删除／替换旧blob不能因曾经缓存而允许成功。
- 与既有stage／unstage／真实Host默认预算测试回归。比较前后相同小仓库逐RPC耗时，不将一次采样推广为通用性能保证。
- 默认全量高并发先前超时记录保留，优化后重跑同一入口，不能只换更大timeout。
