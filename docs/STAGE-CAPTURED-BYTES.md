# 捕获字节暂存接入边界

状态：内部blob存储基础已实现并完成针对性验证，当前未发布候选已接入单文件stage RPC及确认界面，见[接入记录](<STAGE-USER-INTEGRATION.md>)，不等于正式发布或当前GUI更新。已有候选unstage见[说明](<UNSTAGE-ADAPTER-SCOPE.md>)。

## 与取消暂存的区别

Unstage可复用已有HEAD blob，只改Index。Stage需先把用户确认的捕获字节存入Git对象库，再发布Index。对象追加后取消可能留下不可达blob；必须明确披露，不能自动删对象、GC或回滚其他用户写入。

## Blob存储边界

- 输入为服务器私有捕获Buffer，进入异步工作前立即复制；不从实时工作路径重读替代内容，不接受浏览器正文／任意命令／环境变量。最大2MiB，保留原始编码与换行字节。
- 使用显式可信sha1／sha256，哈希Git规范blob头和原始字节；压缩后写canonical对象fanout下自有临时文件。
- 不覆盖已有对象；若目标已存在，按压缩／解压预算验证完整类型、长度、字节和哈希，一致才复用，损坏则拒绝，不能凭文件名信任。
- 压缩流验证除maxOutputLength外须拒绝截断、错误类型／长度、尾随垃圾及多流歧义；不能inflate成功就认定整个文件合法。
- 无覆盖发布原语须可靠；使用自有temp到目标的hardlink NOREPLACE时，清理只移除自有temp，最终对象保持单链接。文件系统不支持时拒绝，不降级成覆盖rename。
- canonical目录、链接／硬链接、alternates、并发目标及临时所有权都要复验。它不是恶意并发文件系统的原子隔离或跨平台崩溃持久性保证。
- 首次持久副作用前触发onStart并复验授权，后续取消／失败为append-only结果未知，不自动删除已发布对象；从不改Index、HEAD、refs、工作文件或配置。

## 后续Stage事务

1. 仅现有普通tracked文件，原Index等于固定HEAD且工作字节不同；拒绝所选MM，保留所有未选暂存。
2. 安全guard后按unstaged选中ID解析路径，捕获原始Buffer和确定目标OID，生成固定操作kind预览。
3. 一次确认后取得真实index.lock，对完整Index／HEAD／工作身份及原始内容复验，写已确认blob，再构建仅改指定tuple的candidate。
4. 对象追加会合法改变objects目录及元数据，不能把自己产生的对象当外部篡改，但也不能完全跳过元数据重验；只豁免精确已验证的新对象身份。
5. Index CAS及原子发布、授权和ambient budget、成功核对与未知结果恢复沿用受控写事务。

EOL／attributes／filter语义尚未放开，不能把raw-byte stage宣传为所有配置下与git add等价。正式开放前须真实仓库、RPC、浏览器和包闭包证据。

## 当前验证

独立blob头／压缩预算oracle3/3通过；已有目标的尾随垃圾、第二压缩流、错误类型、错误声明长度、解压bomb拒绝5/5通过，全部拒绝前未触发写入onStart且目标字节保持不变。真实Git读取和存储模块32项测试通过，含SHA1／SHA256空／二进制blob及packed-only对象；连同独立同OID并发、损坏目标和格式oracle合计41/41通过，无失败或跳过。当前模块未纳入正式包或stage RPC，不用旧全量通过数冒充新模块全量验收。
