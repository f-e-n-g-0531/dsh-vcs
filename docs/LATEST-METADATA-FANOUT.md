# 最近提交读取器metadata扇出预判

状态：共享只读读取器局部限额加固。

metadata总节点20000含根不变；立即子项必超剩余额度时在sort／childstat前拒绝。root＋19999项允许进入首child，root＋20000项提前拒绝且0Git。测试用sentinel验证准入，不伪称真实2万节点全遍历。

专项边界2/2、读取器／metadata组合55/55、RPC／UI消费方21/21、真实branch／annotatedtag／lightweighttag预览3/3通过，静态复核无当前范围确认缺陷。build／85文件包与隔离安装通过。

HEAD／config／原始ref、hash认证和closingmetadata屏障未改，读取器复用路径共享收益但未测量耗时比例；生产15s不变。默认全量先前13失败仍待整体复验。
