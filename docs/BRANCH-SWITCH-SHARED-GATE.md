# 分支切换共享恢复门禁

状态：前端恢复一致性已接入并通过初轮验证，不扩展后端checkout权限。

旧BranchSwitcher改走与Index／commit／amend／branch-create相同的同步仓库pending／unknown门禁（十类确认）。按钮disabled不作为唯一互斥，旧handler也须被当前门禁拒绝。

切换confirm取消／卸载／scope变化和无法核对响应须锁定仓库unknown，不自动重放token或rollback；显式刷新／恢复核对当前分支后再准备。readonly load／prepare取消不当作写入未知。

初轮既有switch／commit／create组件33/33通过；旧expiry测试原先修改caller响应来模拟过期，复制冻结后改为真实clock推进，不削弱生产校验。构建、隔离Edge完整浏览器、70文件包与隔离安装通过，专用共享门禁7项及相邻组合40/40通过，独立静态复核无当前范围确认缺陷。npm默认全量2129/2129通过，无失败／取消／跳过／todo（455.2秒）。

不因切换文件选择清候选，但Session／repo／mode／refresh／scan变化按scope失效。此一致性仅前端，后端仍执行原严格工作区／配置guard。
