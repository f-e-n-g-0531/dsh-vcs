# 真实RPC预算验证

默认生产Host＋真实Git stage→unstage完整测试单独运行通过，使用真实发现ID／状态ID和默认每RPC15秒预算；没有扩大生产预算。

全量默认测试进程并发下904项中903通过，真实stage confirm在机器资源争用下超过15秒并正确返回index-outcome-unknown。此结果不是安全成功，也不能用单独通过掩盖。Stage重复全metadata／work快照成本仍是当前限制。

以明确--test-concurrency=2重跑同一全量904/904通过，无失败／取消／跳过／todo（约812.6秒）。未修改npm默认并发、生产timeout／取消／未知语义，也不把超时当成功。此结果只证明该受控测试负载，不保证任意机器／规模；默认并发全量先前超时仍如实保留，后续固定对象读取复用与严格framed rev-parse合并已完成，保持全部可变复验与15秒预算，最终npm默认并发924/924通过（285.6秒）；不将此前超时删除，也不声称对任意负载保证成功。详见[优化记录](<INDEX-CAPTURE-PERFORMANCE.md>)。

独立实测每RPC（单次小仓库，非性能承诺）：发现390ms、状态441ms、stage prepare1817ms、stage confirm7254ms、状态455ms、unstage prepare1764ms、unstage confirm4400ms，全部默认15秒预算内；整流程17.76秒不是单RPC耗时。
