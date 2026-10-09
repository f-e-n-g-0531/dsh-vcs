# WebP独立冻结范围

基线0.3.60。先仅simple RIFF/WEBP单VP8块（VP8L延期：没有真实lossless像素解码证据，不以伪造header测试放行）（无VP8X/ALPH/动画/EXIF/XMP/ICC等扩展）；extended/动画不降级吞掉标记而是明确拒绝。2MiB、8192维、16M像素。RIFF size必须等于正文，单块长度/padding精确，VP8只接受可显示keyframe/version0..3、有效起始码/分区边界；VP8L本批拒绝。不得依扩展名判断。结构检查不等于像素完整验证，浏览器decode及自然尺寸核验必须成功才能显示；不增加原始远程URL，不减弱PNG/JPEG、Session/opaque ID/并发2/取消释放。

已接入RPC/UI；Chrome37893800779真实VP8数据simple fixture→Node准备→decode、临时Git Session提交与工作区隔离、rename A/B两侧、三种workspace mode不同index/working字节及实际比较UI取消/URL释放通过。canvas扩展容器原样仍拒绝，simple容器仅测试显式构造；不冒充任意WebP支持。VP8L未获真实像素证据故冻结前移出交付范围，继续明确拒绝。待全量/四平台/同标签/发布门禁。扩展透明/动画不在此批。
