# JPEG独立冻结范围

基线0.3.59。只支持8位baseline sequential SOF0、单扫描、1或3分量；2MiB/边8192/16M像素。拒绝progressive/arithmetic/multiple scan/CMYK/未知marker/尾随正文。解析长度及扫描字节，移除全部APPn/COM元数据（包括EXIF/ICC，旋转与色彩精确性不保证）。浏览器必须真实完整decode并核验自然尺寸；仅结构门禁不是完整像素校验，不单独据此发布或启用。复用Session/opaque文件授权、取消、并发及URL释放。JPEG路径/格式按signature识别，不靠扩展名；PNG现有完整验证不减弱。

首轮实现内部结构准备函数与负向测试，不接入公开RPC/UI；待真实JPEG browser decode、畸形样本、真实仓库/RPC/取消与冻结发布门禁。WebP仍拒绝，须另立范围。
