# 反向块界面独立验收

- action必须partial-unstage，正向action拒绝；候选path／HEAD／Index／planId／unitIds集合精确匹配，不能接受其他恢复选择。
- Index→HEAD恢复方向在标题、删除／添加原始行标签、警告及确认文字中明确；不把W作为恢复内容，不叫作丢弃修改。
- staged普通M-space／MM可显示，整文件unstage只M-space；mode／rename／submodule／comparison guards保持。
- plan／prepare只读，确认才可能追加合成blob；标签不可沿用“unstage从不写对象”的整文件承诺。
- raw plan验证严格有界，terminator必须字符串，EOF／bytes／坐标count检查与正向一致。
- 计划消费后改选重plan，所有scope／expiry／cancel读请求不写；confirm pending取消／卸载触发共享unknown。
- partial-unstage-confirm加入同步repository pending gate，正反及整文件操作竞争旧handler也只能发一个底层请求。
- 最终result只path／head／index，与预览target一致才成功；不要求最终result带unitIDs或planID。
