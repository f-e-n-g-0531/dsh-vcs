# 0.3.58 PNG工作区与A/B

> 历史记录：只描述标题中的版本，不是当前安装或功能指南。首次使用请看[项目说明](<../README.md>)。

冻结IMAGE-EXTENSION-SCOPE：仅静态非交错PNG，历史提交/A-B/Git工作区共用安全校验、元数据剥离、2MiB/16M像素、并发2；不放开JPEG/WebP/SVG。

工作区opaque ID重验，HEAD/index固定对象，工作文件regular/no-follow/前后指纹，校验后与最终status/HEAD/index检查后再核验文件，冲突拒绝。

手动展开，模式/刷新/Session/选中文件重置取消资源。

276/276全量通过；真实不同index/working字节、rename两侧、方向ID、delete/untracked absent、size/symlink/取消验证。

Chrome37889955945实际解码与object URL清理通过（隔离RPC非实机）；旧fixture异步remount race已定位修复，不放宽断言。

版本后重build，包19文件/stub install通过，候选SHA25673255148ded0df8997a3db366dfd711e63c66ec540ec8b1c9f0c34be98f79222。

标签CI37890347191失败：Windows symlink返回安全拒绝Symlink escapes repository，而测试仅匹配links/regular file；产品没有放行。

修正测试接受同样安全拒绝，旧标签不移动、0.3.58不发布，下一候选重走门禁。

不安装不重启。
