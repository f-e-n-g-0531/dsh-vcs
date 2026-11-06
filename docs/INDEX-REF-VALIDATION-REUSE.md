# 单操作引用语法校验复用

目标：减少相同ref字符串的纯语法check-ref-format重复启动，不改生产15秒预算。

只在一次公开prepare／apply私有context内保存成功验证的精确ref名称。HEAD原始字节／ref／commit、配置、metadata、Index、work和授权依然每capture重读；ref名称变化须重新语法验证，完整fingerprint仍拒绝状态变化。不能跨操作／Session保存。

并发read group仍allSettled等待全部关闭，ref错误仍在tree错误之前返回；取消warm cache命中也检查。不能缓存失败或先于成功建立条目。

## 当前独立真实Host采样

整文件stage confirm3304ms／unstage1976ms，连续partial confirm3179／2997ms，反向partial真实golden通过；默认15秒不变。采样负载非严格基准，不作性能比例保证。实现方新ref13项＋独立关键auth／对象失效2项最终15/15通过；实际计数prepare9（原10）、stage apply29（原36）、unstage18（原22）。首轮默认全量1105/1106，仅新测试HEAD竞态注入在lstat后发生，生产先报stale而非语法错误；改到lstat前注入后针对性通过。稳定源码npm默认全量1106/1106通过，无失败／取消／跳过／todo（324.3秒），生产校验和15秒预算不变；构建、51文件包检查和隔离安装通过。

新回归应证实同操作refchecker只运行一次、下一公开操作重跑、有效／无效ref变化拒绝、HEAD和其他状态变化不被掩盖，及默认Host真实确认预算／全量。此前超时记录保留，复用不是跳过当前HEAD身份。
