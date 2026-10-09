# 0.3.62 有界历史分段与加载窗口候选

冻结LARGE-FILE-SCOPE：固定commit/tree UTF8普通blob最大16MiB/片64KiB对齐UTF8，single高级只读；明确byte范围/局部行号非全文件行号，不声称full diff或stream IO；size先探测，单并发segment且保留history容量/失败释放。列表graph滚动最多200行，固定snapshot，加载更早替换较新行，明确窗口覆盖/局部筛选；原服务端skip10000/页50不放开，仍非全图。Session/cwd/cancel/links/PNG/Blame容量边界不变。

281/281全量通过。实际Git Session discovery/grant/tree-segment多MiB中文重组不读取workspace改动；EOF/oversize/binary/preabort拒绝通过。Chrome37895435055实际single Monaco前后替换/retry/expired/cancel/切库late隔离；37895973927六页窗口最多200rows固定snapshot与覆盖通过。新功能自动证据非实机。不安装不重启。版本后build，19文件/stub install通过，SHA256540e73a21fc2511cb325b3ff09949c375338910bf8097c8c22ae105641619130。待同标签CI/Chrome与正式公共工件核验。
