# 复验只读查询并发边界

目标：降低真实连续部分确认在生产15秒预算内的延迟；不改变预算、不减少capture次数或发布前guard。

只在metadata／有效config安全检查后，按依赖并行启动独立只读查询。固定HEAD／Index／work仍重新捕获；tree解析／OID／路径未验证前不能做基于任意路径的内容读取。

所有已启动任务必须settle后才返回失败，不用Promise.all提前reject导致RPC释放时仍有子进程。错误按固定任务顺序选择，取消继续等待真实命令close与清理；失败不得发布cache。

快照不是系统级原子事务，任务并发不允许采纳不一致状态：既有prepare双capture、确认前后完整fingerprint／rawIndexCAS保持。授权回调和持久写入不并行，不在blob自有临时窗口进行整metadata扫描。

## 单次独立采样

相同小仓库连续部分RPC：优化前两次confirm为5615／5604ms；settled分组后5059／4691ms，plan1491／1472ms、prepare778／674ms。进程负载不严格相同，仅报告观察值，无通用性能比例承诺。默认每请求15秒预算保持；真实read重叠、ref/tree双失败优先级、取消／截止时间等待子进程settle、filter／metadata前置8/8测试通过。最终npm默认并发全量1033/1033通过，无失败／取消／跳过／todo（357.8秒）；之后新增两个error-priority测试，最终并发专用10/10再次通过。未改变生产预算或capture次数。构建、50文件包检查与隔离安装通过。

验收：真实进程重叠证据、错误与取消等待全部settle、config/filter前置、固定对象cache成功后建立、缺失／损坏对象拒绝、最终授权变化拒绝、真实默认Host连续部分确认与默认全量；任何失败继续披露，不以更大timeout遮盖。
