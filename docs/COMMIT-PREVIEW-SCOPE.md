# 实际仓库只读提交预览

状态：内部只读适配器已实现并验证，尚无commit写入／RPC／界面。

固定canonical embedded born symbolic Git仓库的HEAD／ref／format、raw Index、配置及父commit原字节，重复capture比较稳定性，再以已核验父关系构建Index提交计划。内容从Index生成，不读取Work；未暂存修改不加入提交。

预览只返回固定对象ID、身份与精确消息等有界summary，不发放写能力；后续确认必须重新验证授权／当前ref与Index，不能把只读summary作为执行权限。当前不保存tree／commit对象、不更新ref或reflog。

初期保守拒绝不支持的配置／hooks／signing／filter／attributes／shared-worktree／alternates／shallow／操作中／锁／链接等状态。父签名header暂不支持，不冒称一般Git commit兼容性。

当前配置策略按key存在即拒绝commit.gpgsign／tag.gpgsign，即使显式false也不接收，属于保守初期范围；消息仅plaintext UTF8（LF／TAB允许，CR／其他控制／format等拒绝），不冒称任意消息兼容。

独立真实Git golden1/1通过：targettree来自Index而非不同Work，Index／objects／HEAD／Work均不变。测试最初配置显式sign=false触发已声明拒绝，去除该不支持key后通过，生产guard未改。模块与独立初轮30/30通过，包含SHA1／SHA256稳定性、guards、超限、signedparent、取消／deadline。独立复核发现config读取在拒绝include前已默认展开外部文件；已改为--no-includes，非法working config回归确认在读取固定对象前拒绝include.path。最终模块35项针对性通过，补充closing metadata barrier／cached attributes／只open .git内容／链接guard。首轮全量1424/1425，唯一旧browser deadline测试因timer早于墙钟边界触发断言竞态；测试改为到达真实deadline再检查下一调用，生产runner未变，最终preview＋browser runner49/49通过，稳定源码npm默认全量1430/1430通过，无失败／取消／跳过／todo（376.7秒）。

两次读取不是跨文件原子快照，后续refCAS和完整提交事务必须单独设计与核验。
