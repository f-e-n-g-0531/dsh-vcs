# Amend草稿代际隔离

状态：前端生命周期已修复并完成专用及隔离浏览器验收。

独立golden先复现编辑消息后旧prepare发RPC（1!==0），增加committer／message代际、samevalue强制rerender、currentcontroller与liveaccess校验，旧prepare／cancel不能作用新候选。

不改变原作者／parents保留、明确历史替换ack和确认中断unknown，不扩展后端支持范围。初轮修复与既有amend14/14通过，最终专用18＋既有13项31/31、全部client＋新矩阵254/254通过。静态复核无当前范围确认缺陷。构建、隔离Edge实际字段编辑／取消／freshack、80文件包与隔离安装通过；本批未重跑全量，不新增全量声明。
