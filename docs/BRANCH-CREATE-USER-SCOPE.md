# 候选创建本地分支界面

状态：未发布候选界面已接入并通过初轮验证，未正式发布或更新日常GUI。

仅填写安全分支短名，服务器固定当前HEAD起点，预览显示完整新ref／固定commitOID／当前分支。勾选确认后单次token创建，不自动checkout或切换分支，不stage／commit／push。

修改名称废弃旧candidate与ack，结果需exact匹配name／ref／commit／currentRef；网络中断或不匹配锁定仓库unknown，显式刷新核对refs／HEAD，不自动重试或删分支。

独立candidate固定name／ref／HEAD target绑定golden通过，原有八类组件95/95通过。独立复核初期locale标签未完成，现zh／en no-checkout／no-overwrite提示已写入；创建组件13项、相邻组件组合117/117及独立candidate golden通过；构建、隔离Edge完整浏览器含branch-create、70文件包检查与隔离安装通过。默认全量2118/2118通过，无失败／取消／跳过／todo（511.6秒）。后续一致性增量已将BranchSwitcher接入同一十类门禁，见[共享切换恢复](<BRANCH-SWITCH-SHARED-GATE.md>)；原创建验收不追溯增加该项覆盖。

名称保持原UTF8，1000总字节／255组件，便携字符与命名空间限制明确；strict后端packedrefs／hooks／shared等范围及外部竞争观察限制不变。
