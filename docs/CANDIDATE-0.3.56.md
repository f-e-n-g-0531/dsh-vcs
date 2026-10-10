# 0.3.56 保守跨重命名追溯

> 历史记录：只描述标题中的版本，不是当前安装或功能指南。首次使用请看[项目说明](<../README.md>)。

冻结范围见RENAME-FOLLOW-SCOPE：显式可选exact100%第一父链，固定commit/id，按条携带历史path与oldPath。创建/复制/相似度/路径变更merge身份边界停止且显式提示；不宣称复制/多父来源身份，不跨同名重建。页重放有界，2MiB/超时/cancel/grant保留。

真实Git双重命名与跨页、复制、相似度、删除重建、merge；严格NUL/score/path解析及RPC布尔/grant/cwd/cancel；267/267全量通过。

Chrome37886465341通过（实际React/Monaco隔离RPC，不是实机）；包19文件与stub安装通过。

初次本地候选54c01d…是在版本修改后未重build的旧dist包；与标签工件不一致，门禁拒绝。

重新npm run build + stub安装得到正确SHA256 ef616d1a46475bf2456e6aef1ca30ccdab3ae2e22e19629ed61e654e654b135b。

标签CI37886579481、Chrome37886604692通过；四平台均783460字节与重build本地候选一致。

未移动标签，产品源码无更改。

正式发布37887021751成功，npm latest=0.3.56；实际npm/GitHub均783460字节与上述SHA256一致；不安装不重启。
