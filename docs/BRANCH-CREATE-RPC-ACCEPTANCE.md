# 创建分支RPC验收

- prepare仅sessionId／repositoryId／name，confirm仅token，严格own-data在lookup前捕获；ref／targetOID／startpoint不可输入。
- target由服务端固定HEAD，Gitonly严格root投影；准备readlock／确认writer，grant／cwd／Session／repo对象绑定与expiry／eviction／dispose清理。
- crossoperation tokens不能执行分支创建；readonly预览无写，confirm结束清cache。
- unknown优先cancel，pre-dispatchabort确定cancel，outerbudget可能写入须unknown并核对refsHEAD，不自动删分支。
- actual默认Host创建新分支后HEAD原symbolic／Index／Work保持，token重放拒绝。
