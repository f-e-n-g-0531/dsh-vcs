# 0.3.61 simple VP8 WebP候选

冻结WEBP-SCOPE：仅simple RIFF单VP8静态keyframe；拒绝VP8L（未获真实lossless像素证据）、VP8X/ALPH/动画/metadata/多块/尾随/padding异常。2MiB/8192维/16M像素，结构门禁+浏览器decode自然尺寸核验才显示，复用commit/A-B/workspace授权/opaque ID/mode/取消/资源释放，不改PNG/JPEG。

278/278全量通过。Chrome37893800779真实canvas VP8 payload显式simple test fixture→准备→decode；原canvas extended仍拒绝；临时Git Session commit工作覆盖隔离、A/B rename、三模式index/working不同字节及实际UI decode/关闭URL释放通过。不冒充一般WebP/实机支持。版本后build，19文件/stub install通过，SHA256faac8915bbbce87a8b8e701bbe6ce439ccaa8b023d32005f021f0f62ca72bc1d。同标签CI37894235962/Chrome37894268563通过，四平台787963字节与上述SHA256一致。发布37894675705成功，实际npm/GitHub下载均787963字节且SHA256一致，npm latest=0.3.61。不安装不重启。
