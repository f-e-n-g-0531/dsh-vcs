# Lightweight tag不覆盖引用原语

状态：内部原语实现，无Host／RPC／UI。

固定refs/tags与expectedCommitOID，从仓库rawcommit hash认证后zero-old no-deref创建，非annotated对象发布。不写objects／HEAD／Index／Work，保留当前日志和Indexstat，禁用事务hook。

独立真实Git dirtyWork／HEAD／rawIndex／objects保持golden1/1与当前Git dangling tag zero-old拒绝1/1通过，既有refCAS组合49/49通过。初轮golden复制时漏写dirty fixture导致base!=dirty断言失败，补fixture后复验通过。静态复核clone残留变量／提示已清理，最终专用44＋独立2项46/46通过，含SHA1／256类型／hash／签名拒绝、hooks禁用、authcancel边界、born／dangling symbolic竞争及对象集合保持。不新增全量声明。

已有ref／日志／prefix／case／packedrefs等拒绝，poststart失败unknown无retryrollback，callerwriter和真实授权为前提。Git版本symbolic行为仍需独立实测，不承诺外部ABA或路径交换隔离。
