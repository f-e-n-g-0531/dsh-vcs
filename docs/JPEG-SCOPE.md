# JPEG独立冻结范围

基线0.3.59。只支持8位baseline sequential SOF0、单扫描、1或3分量；2MiB/边8192/16M像素。拒绝progressive/arithmetic/multiple scan/CMYK/未知marker/尾随正文。解析长度及扫描字节，移除全部APPn/COM元数据（包括EXIF/ICC，旋转与色彩精确性不保证）。浏览器必须真实完整decode并核验自然尺寸；仅结构门禁不是完整像素校验，不单独据此发布或启用。复用Session/opaque文件授权、取消、并发及URL释放。JPEG路径/格式按signature识别，不靠扩展名；PNG现有完整验证不减弱。

已接入现有图片RPC/UI；signature分流，PNG原完整验证不减弱。Chrome37892269408通过：真实canvas JPEG经过服务端结构/metadata处理再次decode；临时Git Session RPC提交读取忽略工作覆盖，A/B rename两侧路径，all/staged/unstaged不同字节正确拒绝坏index，实际ImageComparison两侧decode/close取消/URL释放。277/277全量通过。接下来冻结新版本、同标签四平台/Chrome/工件及正式发布；这些是自动证据，不是实机。WebP仍拒绝，须另立范围。
