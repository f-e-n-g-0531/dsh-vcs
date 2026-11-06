# Commit／amend首次配置读取仓库绑定

状态：配置预检加固，policy范围和15秒budget不变。

首次Git config明确--git-dir=canonical.git和--work-tree=canonicalroot，加--no-includes，不在拒绝core.worktree等危险配置之前让startup解析采用外部工作区。

新增真实仓库commit／amend重定向fixture断言仅首次config发生、无cat-file，rawHEAD／Index保持。既有command observer忽略新增两项全局路径参数以继续验证逻辑command，而非把它们误认subcommand。

不开放此前不支持的配置，也不扩大提交／历史改写权限。真实重定向commit／amend＋既有preview37/37，顺序realcommit／amend＋preflight5/5通过；静态复核无当前范围确认缺陷。构建、85文件包与隔离安装通过；未重跑默认全量，不称先前13失败已解决。
