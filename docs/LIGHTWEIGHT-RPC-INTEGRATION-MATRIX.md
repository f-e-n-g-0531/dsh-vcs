# Lightweight RPC真实集成矩阵

状态：双格式真实Host矩阵已通过；当前默认完整回归失败，未验收全量绿。

本轮补SHA1／SHA256 direct commit引用、HEAD／rawIndex／dirtyWork保持、objects文件字节与版本无新增／修改、token重放拒绝，及prepare后外部创建竞争目标不覆盖。

新增真实矩阵4/4通过，Lead重复4/4通过：两种format的objects递归字节及dev/ino/mode/nlink/size/birthtime/mtime/ctime（排除atime）、HEAD／Index／staged与dirtyWork保持；外部竞争目标先创建后确认拒绝且token烧毁。初期fixture的commit.gpgsign配置不在strict范围，移除fixture配置后通过。

原始npm test（node --test test/*.test.mjs）3272项中3259通过、13失败（925.9秒），未改默认并发或15秒生产预算。失败涉及amend／branchcreate／branchdelete／lightweight事务deadline及unknown；保留原始输出D:/TEMP/dsh-subprocess-nMCIAE/dsh-subprocess-29252-57-645fa38a76ca-stdout.log。六个失败golden按顺序隔离复验6/6通过，不能替代默认全绿或覆盖未隔离的其他七项；后续需减少重复Git读取或有证据的测试资源规划，不扩大生产超时。

完整Fork仍缺实际分支／tag删除、任意起点、远端、stash写、merge／rebase与冲突编辑等，集成通过不标目标complete。
