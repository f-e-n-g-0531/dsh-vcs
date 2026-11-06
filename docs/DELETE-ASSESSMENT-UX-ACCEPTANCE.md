# 删除评估界面验收

- name-only请求，仅只读endpoint，UI不发送delete-confirm／tokenprepare或任何写请求。
- exactresponse形状，无token；targetref与输入短名一致，proof首尾=current／targetOID，同format且无重复，最多10000项。
- 同tip不同ref的单点proof允许，currentref／casealias拒绝；无force按钮或checkbox。
- 编辑同步丢弃旧结果／abort，scope／cancel／unmount迟到结果忽略，读取失败不触发仓库unknown。
- Gitworkspace独立于文件选择／status可用，SVN／review隐藏；共享pendingunknown阻止旧handler读评估。
- 隔离浏览器mock验收不等于当前日常GUI升级或真实删除。
