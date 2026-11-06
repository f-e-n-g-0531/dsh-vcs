# Commit代际与最近消息复用

最近提交只读load／cancel用独立controller，取消读取本身不改变草稿代际或candidate／ack。显式reuse则属于草稿编辑，应递增代际、撤销当前prepare、废弃candidate和ack，但保留用户输入identity。

prepare的active检查同时比较alive／draft generation／currentcontroller／live access，旧error／finally不能清新任务busy。cancel同样拒绝旧代际，不误伤新候选。

独立golden先复现oldprepare RPC1而非0，修复后与commit／latest组合21/21通过。完整client捕获209/209与相邻54/54通过，独立静态复核无当前范围确认缺陷；构建、隔离Edge完整browser、80文件包与隔离安装通过，最终新增28项专用、commit／latest＋独立golden49/49、相邻81/81、完整client最终237/237通过，最终重建browser复验通过，不改变后端写权限。
