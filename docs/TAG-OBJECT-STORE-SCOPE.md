# Append-only tag对象存储

状态：内部对象存储已扩展并通过初轮验证，无refs/tags或用户写入口。

显式tag类型body最多128KiB，完整Git tag长度NUL hash与压缩流校验。存储只认识opaque对象字节，语义与目标commit存在性由调用方验证。

不覆盖已有对象，exclusive temp＋hardlink NOREPLACE；已有完整有效对象只读返回，无onStart。开始后失败append-only unknown，不删除已发布对象或自动GC。

独立immutable tag字节golden2/2、与既有tree／commit存储组合42/42通过。原invalid-type测试tag改为tagg以对应新增支持，其他安全断言保持。blob／object／commit publisher组合111/111、tagmodel／publisher组合53/53通过，独立静态复核无当前范围确认缺陷。初轮tag专用测试生成字符串含原始NUL／换行导致SyntaxError，修正测试转义后专用25项／existing36组合61/61、含独立golden与既有golden67/67通过。真实Git SHA1／256 tag字节与hash一致，未创建任何ref。本批不新增全量通过声明。

不创建标签引用，不执行签名／push，不代表标签管理对齐完成。
