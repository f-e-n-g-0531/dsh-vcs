# 候选提交编辑与确认

状态：未发布候选界面已接入，不代表正式发布或当前GUI更新。

Git已暂存模式提供显式author／committer姓名邮箱、秒级时间与时区、消息编辑。预览后核对当前父HEAD／分支、Index摘要、新tree与commit OID、身份与消息，再另行勾选确认；不会自动stage、amend或push。

修改metadata须丢弃旧预览；确认只发送token。提交来自完整Index，不读取或写入工作正文，保留未暂存修改。七类Index／commit确认共享pending／unknown恢复门禁；结果未知先刷新核对HEAD／Index，不自动重试或rollback。

仅已出生loose本地分支、预先存在reflog、普通stage0Index和当前严格配置子集；initial／amend／signed／hooks／packedrefs／shared-worktree／属性转换等不支持。identity显式填写，时间初值若来自浏览器也需预览确认；reflogmachine审计身份与commit作者区分。

## 当前独立验证

组件预览身份／消息／format／ref替换literal与源码绑定2/2通过；原有六类Index组件71/71通过，独立静态复核无当前组件范围确认缺陷。首轮提交组件7项＋独立2项9/9通过，含编辑失效、过期、scope／取消／卸载unknown；最终七类组件聚合83/83通过；生产门禁及双向旧handler互斥／unknown持久验证通过，首轮隔离Edge浏览器与63文件包安装通过。首轮全量1604/1604通过，新增测试及重复locale键清理后最终源码构建／隔离Edge浏览器／63文件包检查／隔离安装通过，npm默认全量1608/1608通过，无失败／取消／跳过／todo，不能把已有协议测试替代界面验收。

外部Git进程不受本进程writer门禁控制，不宣称跨Index／HEAD／ref全局原子。对象追加后取消可能残留对象或ref已更新，必须核对结果。
