# 第七批冻结：SVN历史运行时授权

基线0.3.62；现有纯log/detail/compare planner与file://临时真实仓库测试不代表已接通网络。必须先从Session授权工作副本本地info拿到规范HTTPS repository root/UUID/相对scope，界面展示具体origin/root/UUID/scope及只读命令范围，由用户显式按钮确认。能力绑定session/cwd/repositoryId/root/UUID/scope，5min TTL、最大32、撤销/切cwd失效，每次本地重验证后核对，不接受payload根URL/命令/凭据。只有capability验证后才能invoke远程transport。

当前没有用户授权远程SVN目标；开发只允许离线/临时本地fixture。HTTPS生产transport需证明禁止跨origin redirect/认证缓存/交互/外部网络跳转，未证明前保持关闭，不能以默认svn CLI的redirect行为冒充origin限定。日志数字snapshot/descending游标limit50最大100、copy boundary stop；detail opaque变更ID；正文2MiB、属性名称先probe拒绝svn:special、目录/二进制/删除显式状态；只读高级Diff。追溯仅选中文件stop-on-copy范围，copy来源范围外明确拒绝。

已实现纯授权能力管理、本地info身份解析、内部coordinator（未挂公网handler）：describe生成绑定显示身份的短期offer，approve必须显式且重新本地解析匹配offer，log每次前后重新身份核对并验证token，planner路径/数字边界后才dispatch注入transport，2MiB/15sec预算显式传递。production无transport，approve即报disabled，不虚发可用网络token。6项授权/identity/runtime测试通过，包括显示后scope变化/无同意/过期/越scope不dispatch、cwd变化返回丢弃/撤销/预取消。全程仅注入XML，无网络。后续接UI/handler与真实本地fixture回归。远程真值验证仍需显式用户同意，必须报告未完成部分，不假验收。
