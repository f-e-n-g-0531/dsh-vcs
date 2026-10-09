# 本地 A/B 版本比较协议

已实现的只读能力；模块分工见[架构说明](<ARCHITECTURE.md>)，新增功能实机证据见[实机结论](<LIVE-ACCEPTANCE.md>)。

## 版本身份

两端是本地已存在的完整SHA-1／SHA-256 commit OID，不接受任意revision表达式。方向为A→B，不隐式使用merge-base；交换后重新加载成员和Diff，A=B为空。引用只是选择入口，读取固定OID，不checkout或fetch。

## Host与适配器

- `vcs/revision-changes`接受Session／repositoryId／base／target；`vcs/revision-compare`再要求不透明成员id；图片端点另有固定side字段。
- 请求复用Session cwd重解析、发现授权、过期和容量控制，读取后复验；未知字段、任意root/path/命令参数拒绝。
- 两端验证为commit，禁用replace refs、lazy fetch、外部diff和textconv；缺失对象报错，不联网补齐。
- NUL清单解析及成员ID绑定固定两端、状态和新旧路径；逐文件读取重新确认归属，不能复用父提交比较ID。
- 新增左空、删除右空、重命名读取各侧路径；链接只显示目标文字、gitlink显示OID，二进制／超限明确提示。

## 前端边界

变更两端取消旧请求、清除旧清单和Diff；显示明确版本身份。默认高级只读Diff，基础可选／失败回退。图片复用严格格式准备和浏览器解码；大文件分段是单版本正文，不声称完整A/B Diff。无周期刷新。

测试覆盖方向交换、相同及非祖先提交、重命名／删除、Unicode、伪造身份、对象缺失、取消、授权和工作区不变。自动浏览器／隔离安装不等于当前DSH实机验收。
