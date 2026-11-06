# 创建分支专属确认协调器

状态：内部Host工厂已实现，未注册创建分支RPC／UI。

固定branch-create operationKind，prepare地址只包含Session／repositoryId／分支短名，无caller OID／ref／路径。公开summary显示name／ref／目标OID／当前HEAD与currentRef及format，私有原snapshot服务器保留。

token默认60秒／32项，绑定entry／repo对象／cwd／Session，独立namespace与其他写操作隔离；confirm持共享writer，授权前后复验，开始后的不确定结果明确要求核对refs与HEAD，不自动重试／回滚。

独立public target篡改与commit token隔离golden通过；相邻commit／amend协调器组合27/27通过（新专用模块测试尚未计入该组）。独立静态复核无当前范围确认缺陷；专用模块85/85、与独立golden／commit／amend组合112/112通过。默认全量捕获2002/2002通过，无失败／取消／跳过／todo；该run启动后新增85项专用测试已单独通过，不虚增全量覆盖。

该层依赖调用方提供真实授权绑定，内部工厂不代表已开放用户创建分支。
