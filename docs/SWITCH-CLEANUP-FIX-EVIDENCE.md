# 只读switch cleanup修复证据

独立golden实际复现：list未完成时pending=true，响应在pending期返回，恢复pending=false后switch入口仍disabled true（预期false）。响应不应安装，但owningfinally应释放busy。

Lead在实现worker交接后把read／prepare finally改为仅generation／controller／alive／!aborted ownership检查，不依赖access；response／error仍依赖liveaccess。修复后新旧switch矩阵＋独立golden26/26通过，不改变confirmunknown规则。
