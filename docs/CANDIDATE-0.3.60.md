# 0.3.60 baseline JPEG扩展候选

> 历史记录：只描述标题中的版本，不是当前安装或功能指南。首次使用请看[项目说明](<../README.md>)。

冻结JPEG-SCOPE：仅8bit/SOF0/单扫描/1或3分量，结构table/component/marker/entropy边界，APP/COM全剥离。

JPEG结构不是完整像素验证：展示必须browser decode成功且natural尺寸匹配；2MiB/8192维/16M像素。

signature分流保留PNG原完整验证。

现有commit/A-B/workspace授权/opaque ID/mode/取消/URL释放共用；拒绝progressive/CMYK/WebP/SVG。

剥离EXIF/ICC导致旋转/色彩不适合精确审阅。

277/277全量通过，真实Chrome37892269408生成JPEG→Node准备→decode、Git Session RPC committed bytes隔离、pair rename、all/staged/unstaged不同index/working字节、实际ImageComparison两侧decode/取消/URL释放通过。

自动证据不是实机。

版本后重build，19文件/stub install通过，候选SHA256909273ecebf3061c947401207b0887eaa7335a49f215e51acefc70963ed6441a。

同标签CI37892660394/Chrome37892689254通过，四平台包均787446字节与上述SHA256一致。

发布37893056222成功；实际npm/GitHub下载均787446字节且SHA256一致，npm latest=0.3.60。

不安装不重启。
