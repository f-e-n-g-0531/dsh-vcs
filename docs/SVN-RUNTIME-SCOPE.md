# SVN 历史：冻结范围与验证结论

## 发布状态

正式版仍为 **0.3.62**；第七批候选尚未发布。0.3.63固定标签的[Chrome通过](https://github.com/f-e-n-g-0531/dsh-vcs/actions/runs/37917253091)，[CI Windows两组合失败](https://github.com/f-e-n-g-0531/dsh-vcs/actions/runs/37917216512)：离线测试URL替换未覆盖Windows RUNNER~1与Node %7E编码差异。0.3.64同标签Chrome通过但Windows仍失败；诊断确认根因后改为校验解码后的精确本地目标再映射，生产严格属性匹配未放宽。[修复后的四组合分支CI全绿](https://github.com/f-e-n-g-0531/dsh-vcs/actions/runs/37918817204)。两个旧标签保持不动且不发布，下一候选使用新版本。开发源码已挂载固定 HTTPS 后端与显式同意 UI，当前安装 DSH 未变更。0.3.65已通过[固定标签四组合CI](https://github.com/f-e-n-g-0531/dsh-vcs/actions/runs/37919692670)、[同标签Chrome](https://github.com/f-e-n-g-0531/dsh-vcs/actions/runs/37919725030)、346项本地测试、24文件闭包、隔离安装和四份候选包同摘要核验（806020字节，SHA256 127a7ebf26bb50a7989b6df48aadd8b36f24b64e60e1a243fae78c773cb9a49a）。[正式发布流程](https://github.com/f-e-n-g-0531/dsh-vcs/actions/runs/37920374654)中npm接受上传，但公开版本metadata仍404、latest仍0.3.62；公开工件门禁正确失败，GitHub Release未创建。不得盲目重传或宣称发布完成；需继续只读检查registry实际状态后决定同工件恢复。

## 第七批冻结范围

- 从获授权工作副本的本地 svn info 获取 HTTPS root、UUID、scope 和数字 revision。初始快照为本地工作副本修订，不是服务器 HEAD；同意前不获取远程最新修订。
- 手动审阅网络访问范围并勾选同意，能力绑定 Session、cwd、仓库、root、UUID、scope；5分钟有效，最多32项。审阅提案和已批准能力过期均要求重新手动同意，不自动续权。
- 固定数字快照日志，降序游标，每页最多100条（UI 50条）；详情使用身份绑定的不透明成员 ID。
- 选中文件重新校验成员后比较固定 r-1/r，新增／删除使用空侧；先探测 svn:special 并拒绝特殊文件正文。每侧最多2MiB，严格 UTF-8，二进制或不支持编码显示提示。默认高级只读 Diff，基础仅手动选择或失败回退。
- 文件追溯固定 peg，删除使用 r-1，止于复制边界；范围外来源隐去，不扩大路径权限。
- 每步 IO 前后重新解析 Session/cwd 并校验能力；cwd 漂移、撤销、替换或淘汰阻止后续请求。RPC最多2项并发，整次操作最多15秒，等待下层清理后释放槽。插件 dispose 作废所有能力并取消在途传输。
- 界面卸载、切换及刷新清理能力；手动重试清除旧正文和选择，取消旧请求。服务端能力失效退出历史并返回审阅；已取消请求晚到错误不影响当前同意。刷新仅手动或可见 window 聚焦，没有周期刷新。

## 网络与功能边界

生产传输仅有界 HTTPS／DAV，保持系统 CA 与证书名称验证；拒绝所有重定向和压缩响应，不开放任意 URL、认证头、CLI远程命令、测试 CA 或 request 注入。只支持服务端无需额外认证的 HTTPS SVN；本批不提供用户名／密码、客户端证书、HTTP／svn／svn+ssh、跨复制来源继续追溯、任意 A/B 修订或远程 HEAD 更新。

本地 SVN BASE／工作副本比较仍离线。公开本地身份查询的 remoteEnabled=false 表示该离线入口不执行远程操作；远程历史经独立 describe／approve 获取能力。未授权不发起网络。不提供产品仓库写操作，不自动安装或重启 DSH。

## 自动证据

- 真实临时 Git／SVN仓库完整本地 check 通过；后端 bundle 导入与dispose、24文件包闭包、production-only隔离stub安装通过。stub安装不是实机验收。
- [真实 React浏览器→fetch→鉴权测试桥→严格 RPC→host grant／本地 svn info→Apache TLS整链通过](https://github.com/f-e-n-g-0531/dsh-vcs/actions/runs/37914278797)：同意、日志、实际高级Diff before/after、追溯、撤销；工作区 WORKING 不进入历史比较。真实复制／删除追溯、special零GET、无同意零请求、cwd漂移阻止后续IO均验证。测试仅注入显式本地CA，TLS和名称验证保持开启。
- [生产源码挂载后的Chrome与实时TLS整链通过](https://github.com/f-e-n-g-0531/dsh-vcs/actions/runs/37916159637)。
- [恢复、提案／能力过期及服务器同意失效Chrome通过](https://github.com/f-e-n-g-0531/dsh-vcs/actions/runs/37916561100)：不重放describe／approve／log，旧history和编辑器释放，pending信号取消，晚到响应不显示。恢复错误采用注入RPC，与实际TLS链证据分开。
- 真实TLS socket覆盖证书信任、重定向拒绝、取消与关闭；真实browser bridge socket断开触发服务端取消。DAV解析按命名空间URI校验UUID、数字baseline、链接范围、日志分页及属性名。

## 实机与剩余门禁

以上是隔离CI与自动测试，不是当前DSH GUI或外部SVN目标实机验收。尚无获授权外部SVN目标，不发外部SVN请求；发布后用户仍须自行在界面审阅并明确同意。保留既有实机通过项，不把新功能自动证据改称实机通过。

剩余工作限于冻结范围复核、最终全量／包检查、版本与不可移动标签、四组合CI及同标签Chrome、候选和正式工件核验；失败先定位修复，不移动已有标签，不发布文档／测试空版本。
