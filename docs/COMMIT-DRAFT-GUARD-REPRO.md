# Commit旧草稿准备复现

独立golden保存draftA准备／取消回调，message编辑到B后调用旧prepare，实际RPC1次而预期0次（1!==0）。此为前端意图错位，服务器仍确认原安全候选，不夸大为权限绕过。

修复覆盖author／committer／message、显式clear／reuse，same-value强制rerender；不得破坏latest只读cancel保留当前candidate／ack的专门语义。
