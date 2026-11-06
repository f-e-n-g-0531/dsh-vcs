# 候选commit发布前门禁

现有真实Host临时仓库验证不是日常GUI验收或正式发布。更新日常插件、重启、提交／推送项目变更均不在当前自动实施范围。

用户界面需通过双身份／消息精确预览绑定、编辑失效、singleconfirm、过期、取消／卸载unknown、七类pending互斥、跨repo unknown保留，及隔离Edge浏览器。

后端仍保守拒绝signedparent／hooks／packedrefs／initial／amend／reftable／shared等；任何UI提示不得暗示一般Git完全支持。不以样本确认时长作任意负载性能保证，生产共享15秒预算保持。

实际GUI更新需独立授权和已构建artifact安装／刷新核验，不通过另起server冒充当前页面更新。
