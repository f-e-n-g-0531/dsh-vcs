# 最近提交RPC验收

- action字段白名单独立包含latest-commit；严格own-data仅sessionId／repositoryId，descriptor捕获在首次await前。拒绝path／commitOID／ref／getter／symbol／inherited。
- resolved grant repo只投影type／root给strict适配器，Gitonly拒绝SVN，错误Session／cwd／过期grant拒绝。
- readlock围绕读取保持到authorize后，其他commit／Index writer不能并发，release finally。
- adapter返回后再次authorize，撤权不泄露已读取消息；信号／budget共享取消，无mutationunknown。
- 真实Host返回HEAD而非Index／Work消息，完整仓库写状态保持；生产包包含latestreader和metadata模型闭包。
