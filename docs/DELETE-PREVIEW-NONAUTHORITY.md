# 删除预览非执行权限

真实仓库预览从固定HEAD与目标ref读图并hash验证，只返回安全候选。它没有私有执行grant，也没有删除入口；客户端不能通过提交proof／planId请求任意引用删除。

后续执行必须绑定原始ref／HEAD／配置／metadata基线、目标oldOID条件删除，并明确禁止当前分支／其他worktree占用和未合并force。观察检查不是文件系统全局原子事务。
