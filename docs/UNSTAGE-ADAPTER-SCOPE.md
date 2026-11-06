# 单文件取消暂存适配器

状态：当前未发布候选已接入固定RPC、staged模式确认界面及包闭包；仍不是正式发布或当前GUI验收。该适配器不接受浏览器授权；后续Host必须从已发现仓库和fresh change ID解析精确路径，不能让浏览器直接提交磁盘路径。

## 操作语义

- 只恢复一个既有普通文件的Index mode／OID到预览固定的HEAD条目；不改HEAD、分支、配置、对象数据库或工作文件。
- 当前首批拒绝选中文件MM部分暂存，避免将全文件取消暂存误当成逐行操作。其他文件的部分暂存／工作区修改允许存在且不应改变。
- 不支持新增／删除／改名／冲突、unborn／detached HEAD、linked worktree、特殊Index flags／模式、split／sparse／partial、attributes／filters／命令hooks及链接／硬链接。完整产品能力仍需后续逐项扩展。
- 原始工作字节与Index内容匹配只适用于明确支持的EOL／无过滤器环境，不能用解码后文本判断相等。

## 确认与持久写入

预览绑定完整Index、HEAD、选中tuple、工作字节与文件身份、元数据及配置指纹。确认前重建快照，取得真实index.lock，再次复验；只把纯模型验证后的candidate原子发布。自有锁不得造成元数据指纹自我失效，也不能作为跳过外部锁的理由。

固定操作kind的确认包装器只公开action、path、head、index、target摘要，不公开正文／指纹／路径授权。token短期一次使用，绑定Session／cwd／发现grant／repository。写后授权或截止时间不确定仍为结果未知；不自动回滚／重试。

## 验证入口

- [Index模型](<../src/git-index.mjs>)与[自有锁](<../index-lock.mjs>)已有独立负例及真实Git临时仓库聚合验证。
- [组合回归](<../test/index-foundation-integration.test.mjs>)在SHA1／SHA256真实Git中发布单文件unstage候选，验证其他文件staged tuple及所有工作字节保持不变，2/2通过。
- 固定操作确认包装器8/8测试通过；与通用和分支协调器合计24/24，覆盖单次token、过期、绑定、授权、共享锁和跨操作隔离。尚未连接RPC。
- 适配器34项针对性真实Git测试通过，覆盖stale工作／HEAD／Index、权限、外部锁、配置、attributes／filters、symlink／hardlink、取消、最终授权后变化及postpublish unknown。独立复核另修正ambient budget和混合大小写元数据guard；最终适配器／锁／协调器集成81/81及全量731/731通过，无失败、取消、跳过或todo。
- 整工作树扫描包含ignored／untracked：每个普通文件不超过2MiB、总正文16MiB、最多2万节点，超限或不支持文件保守拒绝；不是任意大型工作区支持。

不提供任意命令、任意环境变量、正文编辑或网络功能。不因内部适配器存在宣称Fork暂存／提交闭环完成。
