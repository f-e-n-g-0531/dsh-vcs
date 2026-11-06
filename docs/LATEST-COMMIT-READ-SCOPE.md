# 最近提交只读仓库适配器

状态：内部只读适配器已实现并通过针对性验证，尚无最近信息RPC／界面，不开放amend。

固定canonical embedded Git的symbolic HEAD、ref与objectFormat；读取固定OID原始commit并核验hash，返回身份与原始消息；返回前重复核对HEAD／配置／metadata稳定。不从Work或Index推算历史信息，不修改引用或对象。

沿用strict header／UTF8／容量子集，签名或未知header暂拒绝。配置include必须禁展开后拒绝，安全Git调用禁止lazy fetch／replace／环境重定向。

独立真实Git golden1/1通过：返回HEAD身份消息不受不同Index／Work影响，rawIndex／对象目录／HEAD／Work不变。初期strict配置漏掉Windows init生成的core.symlinks，已接受此只读场景无执行副作用的标志，不触碰文件或放开external config。模块41项、独立golden及纯metadata组合56/56通过，独立静态复核无当前范围确认缺陷。core.worktree启动重定向可先于config拒绝，配置专用调用已显式固定git-dir／work-tree后no-includes检查；不放开配置。最终模块41/41通过，目录metadata也绑定完整version；npm默认全量1664/1664通过，无失败／取消／跳过／todo（416.6秒）。尚未接最近信息RPC／UI。

固定读结果只证明读取期间观察一致，不授予历史改写或消息复用权限，后续用户必须明确选择。
