# Lightweight tag创建候选界面

状态：候选界面已接入并完成初轮隔离验证，未发布或更新日常GUI。

只填写短name，服务器固定当前HEAD；核对directcommit／targetTree／currentRef／refs/tags后单次ack确认。不生成tag对象，无tagger／消息，不覆盖、签名、push或checkout。

修改草稿推进代际，旧prepare／cancel／confirm／ack不可复用；scope／取消confirm锁unknown，显式核对refsHEAD后恢复，不retryrollback。

验证：实际10字段候选schema与Host匹配（最初任务计数字样有误，未添加虚构字段）；独立serveraction golden1/1、最终专用19项＋独立golden20/20、完整client256/256通过（初轮future-expiry测试基准在慢速并行执行中老化，改为每请求生成future bound后通过），静态复核无当前范围确认缺陷。构建、隔离Edge完整browser含lightweight-tag、84文件包与隔离安装通过。本批不新增全量声明。

共享第12类变更pendingunknown，与annotatedtag标题及token区分。strict仓库子集和外部观察限制保持。
