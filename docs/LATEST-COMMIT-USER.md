# 最近提交查看与消息复用

状态：未发布候选界面已接入并验证，尚非正式发布或当前GUI验收。

读取最近提交仅展示固定HEAD的身份与原始消息，不改变正在编辑的草稿或确认候选。用户明确点击复用消息时，只复制消息原文，不替换author／committer，不自动amend；旧preview与ack立即失效。

保留BOM／CRLF／空白／EOF原始状态；读取可接受不代表当前提交写策略可接受。不支持的消息须显式提示，不能默默trim或把CRLF改LF。消息复用用于新提交，仍需单独预览与确认。

## 当前验证

复用／提交组件与独立golden21/21通过，包含load不覆盖、explicit reuse只改消息、旧candidate失效、独立readcancel保留candidate＋ack、CRLF/BOM/empty读可用而写拒绝。独立复核提出缺少专用readcancel，已增加按钮及专用回归。构建、隔离Edge浏览器、65文件包检查和隔离安装通过，默认全量捕获1682/1682通过，无失败／取消／跳过／todo（393.5秒）；全量启动后补充的专用readcancel测试已独立通过，不虚增该次全量覆盖。

七类pending／unknown门禁继续阻止竞争；scope变化／卸载／取消后忽略迟到只读结果，确认阶段不得读或复用。
