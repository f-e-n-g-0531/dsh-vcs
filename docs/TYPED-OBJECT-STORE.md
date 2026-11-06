# Tree／commit有类型追加对象原语

状态：内部原语已实现并通过针对性验证，无RPC或ref更新。blob API保持独立不变。

storeCapturedObject仅接受明确tree或commit类型，固定sha1／sha256，输入Buffer在首次await／授权前捕获；对象头按真实类型和body字节数生成，不伪装blob。Tree最多8MiB，commit body最多128KiB，压缩／解压容量独立有界。

仅向canonical embedded .git/objects追加，授权与signal／ambient预算贯穿；自有独占temp、文件sync、hardlink NOREPLACE发布，已有目标须验证普通single-link文件、完整压缩消费、原始header／type／bytes／hash全部吻合，拒绝替换。

开始通知先于fanout／temp等任何副作用；之后错误append-only unknown，已发布对象不删、不GC回滚，自有temp只按身份清理。没有目录级持久性或恶意并发目录替换隔离保证，调用方须排除hostile mutation。

该层只核对对象身份／有界原始内容，不验证引用对象存在性或tree／commit语义；后续适配器必须使用精确编码模型并验证固定依赖，再以独立refCAS事务更新分支。用户commit仍未开放。

## 当前独立验证

独立typed header／同步捕获／重复写已有内容不变golden4项已纳入验证。静态复核未发现当前原语范围确认缺陷。早期复制typed测试仍用cat-file blob读取tree而失败，已按真实type修正oracle，最终typed原语／独立golden／旧blob组合72/72通过，不修改生产类型语义；包含SHA1／SHA256真实hash-object／cat-file／packed-only重复及完整压缩流腐坏拒绝。最终npm默认全量1345/1345通过，无失败／取消／跳过／todo（382.4秒）。未接入生产commit流程或打包闭包，尚不更新ref。
