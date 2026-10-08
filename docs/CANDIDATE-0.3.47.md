# 0.3.47 历史审阅隔离修复

冻结062b3e8产品/回归改动：工作区与历史使用互斥可见视图；进入历史取消本地比较并清空选择，阻止迟到回填，工作区快捷键与模式不接管历史；历史区域使用剩余高度而非35vh。用户报告工作区通过、历史仍显示本地，顶层代码确有同时显示问题；不声称修复后实机验收通过。

本地check、19文件verify:package、临时生产安装/stub注册通过。完整客户端中英文模拟RPC Chrome37742403253通过，覆盖同路径不同提交/本地内容及迟到取消；不是真实GUI。[标签四平台CI37743051531](https://github.com/f-e-n-g-0531/dsh-vcs/actions/runs/37743051531)、[标签Chrome37743091176](https://github.com/f-e-n-g-0531/dsh-vcs/actions/runs/37743091176)通过。[正式发布37743588012](https://github.com/f-e-n-g-0531/dsh-vcs/actions/runs/37743588012)成功。npm latest=0.3.47；实际下载npm/GitHub及四平台包均779884字节，SHA256 `d8eb1f4fcbb4bbbbc30e45d44a95e6dbdf4eecf79d6a3ea20d84069b6b54e677`与本地候选一致。固定标签919935b01c70eb180ae9ab9ec9c2b257b8b7743c，未移动。无安装、无重启。
