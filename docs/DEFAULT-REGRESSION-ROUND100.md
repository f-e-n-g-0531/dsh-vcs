# 默认全量复验（第100轮）

原始npm test未改并发／预算，结果3348项3338通过、10失败，耗时1077.2秒。原始完整输出：D:/TEMP/dsh-subprocess-nMCIAE/dsh-subprocess-29252-60-b07298ee1bb2-stdout.log。与之前3272项／13失败不同测试集合，不作等价性能比较。

三项amend-preview staleHEAD／Index／config测试旧observer只识别argv[0]=config，新增pinnedgitpath后mutation没有触发；只规范化observer副本路径参数，真实spawn不变，三项3/3及完整amend＋readbudget26/26通过。

其余七项包括删除freshness finalcallback未到达、pendingauth final计数未到5和annotatedtag事务deadline；独立tag transaction／Host／RPC三个golden顺序3/3通过仅是负载诊断，不能替代默认全量绿或其余未复验场景。未提高15秒生产预算。

本轮新增settled-read预算契约3项（启动后创建未计入3348），专用与既有helper5/5通过；复核发现初版假阴性风险，用事件循环checkpoint的settlement标志和assert.rejects修正。

当前默认全量未验收绿，完整Fork差距仍在。
