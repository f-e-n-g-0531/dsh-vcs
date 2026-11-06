# 部分块界面复核

独立复核发现两项接入前问题：

1. 原始换行terminator只用对象key判断，数组[LF]可被强制转换为合法key并绕过NONE位置检查。已添加严格字符串类型检查；独立响应负例复现后修正，通过。不是XSS或服务器写授权绕过。
2. 整文件stage与partial-stage同时显示时仅共享unknown状态，尚未共享pending confirm锁；可同时发出竞争确认。服务器mutex／CAS仍保护，但界面须保证单个仓库同时只有一个已确认意图。已接入Panel同步repository pending Set及显示状态，所有index确认RPC统一经过gate，重复确认即使使用旧事件闭包也不会发出第二个底层请求；界面禁用其他pending动作。生产竞争确认回归通过；取消／卸载继续转unknown，尚未结果的底层RPC释放前gate保持。

复核先前怀疑token正则尾换行接受，独立测试拒绝通过后已撤回，不列为缺陷。
