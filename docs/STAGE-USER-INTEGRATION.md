# 确认式单文件Stage接入

当前未发布候选已接入严格stage RPC与确认界面，不是正式发布或当前GUI验收。

## 协议和用户操作

- Git未暂存模式，选中index为空格／worktree为M的既有普通修改文件；仅此候选支持，MM／新增／删除／改名／冲突不开放。
- prepare只接受sessionId、repositoryId、选中id，安全guard内按固定unstaged身份解析路径；confirm只接受sessionId、repositoryId、token。
- 预览显示action、路径、固定HEAD、原Index和捕获字节目标OID／mode、过期时间；明确勾选后一次确认，不发送路径／正文／替代OID。
- Stage与unstage共用仓库级结果未知门禁，取消已发出请求或切换范围均保留未知；刷新其他仓库不能解除，须显式刷新当前实际仓库核对。
- Blob追加后失败可留下不可达对象；不自动删除对象、GC或回滚。每文件2MiB／工作总正文16MiB／2万节点及其他仓库guard保留，不能因限制而静默扩大支持范围。

## 验证

构建、隔离Edge156完整React／Monaco浏览器（index-stage与index-unstage步骤）、48文件包检查、生产依赖隔离安装与stub宿主注册已通过。测试包SHA256为7122a255d34ad6be85c4a83ea6712aa6848ad428a595fa10a3f983ab65bee98a，只对应当次验证工件。

前端stage12＋unstage10＋branch9针对性31/31通过；独立Host／selector／客户端／请求契约聚合42/42通过；复核发现并修正中英文警告误称“预检即追加blob”，新增断言明确预检与取消预检不写对象，只有发送确认后才有append-only副作用。最终全量864/864通过，无失败／取消／跳过／todo；警告修正及新增只读预览断言后stage／unstage客户端22/22再次通过。首次selection测试误将status字段预期为M而非modified，按真实公开协议修正，生产实现未因此变更。

Stage并非逐行暂存或commit闭环，完整差距见[Fork清单](<FORK-PARITY.md>)。未提交、未发布、未升级日常profile或重启DSH。
