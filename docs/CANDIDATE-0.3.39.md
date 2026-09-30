# 0.3.39 提交图键盘候选（未发布）

范围冻结为提交图上下键、Home/End焦点移动，不自动选择提交，不新增网络或产品写操作。继承0.3.38，SVN历史仍未启用。

第281轮本地245/245测试、19文件包校验、临时生产安装与stub宿主注册通过。候选SHA256：`52b62f2a89502199f47b115ffcdeb4a7ebce1234303ca0e8157fa735340de1d6`。此前[源码隔离Chrome](https://github.com/f-e-n-g-0531/dsh-vcs/actions/runs/36696585033)通过；第282轮完成固定提交 `951b46cb800a1c1586c496097ab0b14c4156baab` 的[四平台标签CI](https://github.com/f-e-n-g-0531/dsh-vcs/actions/runs/36697061698)及[同标签Chrome](https://github.com/f-e-n-g-0531/dsh-vcs/actions/runs/36697128857)，全部成功。已下载四个平台包，均778612字节且上述SHA256一致。Artifact ID：Ubuntu22=11088283345、Windows24=11088224106、Ubuntu24=11088103895、Windows22=11087449487。候选自动化验证已完成。

真实DSH GUI未验收；用户暂不升级决定有效，不安装不重启。0.3.38提前发布授权不适用于本版，当前正式版仍为0.3.38。
