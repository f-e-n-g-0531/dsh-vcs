# WebP独立冻结范围

基线0.3.60。先仅simple RIFF/WEBP单VP8或VP8L块（无VP8X/ALPH/动画/EXIF/XMP/ICC等扩展）；extended/动画不降级吞掉标记而是明确拒绝。2MiB、8192维、16M像素。RIFF size必须等于正文，单块长度/padding精确，VP8只接受可显示keyframe/version0..3、有效起始码/分区边界；VP8L只接受version0。不得依扩展名判断。结构检查不等于像素完整验证，浏览器decode及自然尺寸核验必须成功才能显示；不增加原始远程URL，不减弱PNG/JPEG、Session/opaque ID/并发2/取消释放。

第一轮仅内部prepareSimpleWebp及有界结构负向测试；未启用RPC/UI。接下来真实浏览器生成→服务端准备→decode及真实仓库/RPC/界面回归，再冻结发布。扩展透明/动画不在此批。
