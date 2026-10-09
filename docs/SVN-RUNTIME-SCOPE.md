# SVN 历史：当前结论

## 状态

正式版为 0.3.62，其远程历史访问仍关闭。第七批尚未交付；开发源码 apply 已注册固定 HTTPS SVN 历史 RPC，读取须已发现仓库、显式网络同意及有效能力，未授权不发起网络。当前安装 DSH 未变更；公开身份查询仍只读本地工作副本并返回 remoteEnabled=false，远程能力另经 describe/approve 获取。

生产客户端已挂载显式同意入口及历史 UI，卸载／刷新／切换时撤销 grant；完整本地 check 与[Chrome及实时TLS整链](https://github.com/f-e-n-g-0531/dsh-vcs/actions/runs/37916159637)通过。清理 revoke 属于取消授权，不是自动历史刷新。当前安装版未变更。

## 已实现

- 内部传输获得逐步授权回调，每次重新解析 Session/cwd 身份并校验能力；cwd 漂移或撤销阻止下一 IO（专项回归通过）。内部授权绑定 Session、cwd、仓库、HTTPS root、UUID 与 scope；显式同意、5 分钟 TTL、最多 32 项。撤销、身份变化和容量淘汰使能力失效并取消活动请求。
- 日志固定数字快照与降序游标，每页最多 100 条；详情使用身份绑定的不透明成员 ID。比较重新核对成员，读取固定 r-1/r，先检查属性名并拒绝 svn:special。
- 追溯止于复制边界，不扩大路径授权；范围外复制来源隐去。文本比较默认高级只读 Diff。
- 子进程与 HTTPS 原语有容量、取消与期限限制；等待实际关闭后返回。HTTPS 保持 TLS 验证，拒绝所有重定向，不开放任意认证头。
- DAV 解析按命名空间 URI 识别，校验 UUID、数字 baseline、链接边界、日志分页、详情范围和属性名。内部 discovery → baseline → REPORT 链每步前后检查授权，无默认传输或公开注册。

## 验证结论

- 真实临时 SVN 仓库验证日志、详情、比较、复制边界和删除追溯；工作区覆盖不参与历史正文，读取不改变工作副本。
- [隔离 Apache／Chrome 回归通过](https://github.com/f-e-n-g-0531/dsh-vcs/actions/runs/37905967130)：真实提交、UUID、r2 baseline、REPORT、固定历史正文与符号链接属性名。未读取链接正文。
- 真实 TLS socket 验证证书信任、重定向拒绝、取消和撤销后停止下一请求。[实际 Apache TLS／Chrome 回归通过](https://github.com/f-e-n-g-0531/dsh-vcs/actions/runs/37907822373)：有界 HTTPS 连接真实 Apache，发现、baseline、日志、详情及 r1/r2 正文与 special 拒绝贯通；仅测试注入本地 CA，TLS 验证保持开启。未涵盖生产 Session/cwd 能力绑定。
- DAV 专项 19 项测试通过。内部历史正文链要求显式成员重核，固定数字 baseline、属性名先探测；真实捕获 special 响应阻止 GET，范围／成员拒绝零请求。[真实 Apache 正文链回归通过](https://github.com/f-e-n-g-0531/dsh-vcs/actions/runs/37907519476)：每次成员校验重新读取实际详情，r1/r2 分别为 before/after，链接属性阻止正文 GET，未授权不增加请求。使用有界 HTTP 测试适配器，尚未接生产 TLS／Session。[组合链 Apache／Chrome 回归通过](https://github.com/f-e-n-g-0531/dsh-vcs/actions/runs/37907085725)：内部日志／详情链经有界 HTTP socket 测试适配器读取真实服务，6 次请求、每步前后授权；未授权调用不增加请求。不是 Session/cwd 或 Apache TLS 整链验收。
- React／Monaco 自动证据不是当前 DSH 实机验收。

## 尚未完成

- Session/cwd 能力与真实 Apache 有界 HTTPS 多步传输贯通，历史正文安全读取与追溯集成。
- 内部 runtime 已接通显式 DAV 日志／详情传输与成员 ID；10 项专项通过，无同意零请求、cwd 漂移阻止下一请求。[真实 Apache TLS runtime 回归通过](https://github.com/f-e-n-g-0531/dsh-vcs/actions/runs/37908474824)：显式同意前零请求、日志／详情及成员 ID 正确、cwd 漂移只触发第一步后停止。身份解析器仍为 fixture 注入，不是公开 Session discovery；内部 DAV 正文传输已接 runtime 比较，固定 r-1/r，每次 GET 再探测 special；注入响应回归验证 before/after 与 special 零 GET。[真实 runtime Apache TLS 比较／追溯回归通过](https://github.com/f-e-n-g-0531/dsh-vcs/actions/runs/37908936223)：固定 r1/r2 为 before/after，文件历史为 r2/r1，special 比较拒绝且没有链接 GET。[复制／删除 Apache TLS 回归通过](https://github.com/f-e-n-g-0531/dsh-vcs/actions/runs/37909235727)：追溯仅 r4/r3，不越复制边界；删除 peg 为 r4，比较旧侧为 copied edit、新侧为空。内部 resolver 已绑定实际 host Session discovery grant，cwd／过期拒绝专项通过；[host resolver／Apache TLS 联合回归通过](https://github.com/f-e-n-g-0531/dsh-vcs/actions/runs/37909712258)：必须先发现仓库、显式同意，cwd 变化阻止后续 IO，比较与复制／删除追溯正确。[实际工作副本适配器联合回归通过](https://github.com/f-e-n-g-0531/dsh-vcs/actions/runs/37910657380)：真实 discoverRepositories／本地 svn info 接入 host grant 和 TLS runtime，历史比较、复制／删除追溯、无同意零请求及 cwd 漂移均通过；测试证书显式 CA 信任与名称验证保持开启。属于隔离 CI，不是用户当前 DSH 实机验收。公开远程入口仍关闭。
- 内部 host 已组合现有发现授权、runtime 和严格 SVN RPC，默认无传输；RPC 整次操作拥有至多15秒取消期限（含比较的多次 dispatch），等待下层清理后释放槽，6 项 deadline／RPC／撤销专项通过；6 项授权／字段／撤销／容量专项与完整 npm run check 通过。同意响应已携带经过数字校验的本地 revision snapshot，初始化历史不需要同意前网络；12 项 host/runtime 专项通过。内部同意／历史／撤销 UI wrapper 已组合并补齐中英文标签，编译及初始渲染零 RPC 回归通过；本地单次过期计时卸载历史、取消未完成撤销并要求重新同意；严格校验 token／snapshot／五分钟期限，3 项 UI/helper 回归通过，不执行周期刷新。详情／Diff／追溯增加手动重试，替换请求时清空旧数据及成员选择并取消旧请求；4 项源码契约／编译／expiry 回归通过。[真实 React／Chrome 同意与恢复回归通过](https://github.com/f-e-n-g-0531/dsh-vcs/actions/runs/37912194320)：初始零 RPC，必须勾选同意，详情失败手动重试成功，撤销清除历史且所有请求 signal 清理。RPC 响应为 fixture 注入，不是实时网络浏览器整链；[Diff／追溯失败恢复 Chrome 回归通过](https://github.com/f-e-n-g-0531/dsh-vcs/actions/runs/37912475490)：手动重试创建实际高级 Diff，切换失败追溯仍释放编辑器，追溯重试成功，撤销清空历史；仍为注入 RPC 响应。[实际 Chrome 过期交互通过](https://github.com/f-e-n-g-0531/dsh-vcs/actions/runs/37912744828)：真实单次计时结束后取消 pending 历史 signal，迟到响应不显示，返回重新同意入口且请求数不增加；仍为注入 RPC。[严格 RPC／实际 Apache TLS 回归通过](https://github.com/f-e-n-g-0531/dsh-vcs/actions/runs/37913148025)：未知 URL 字段零额外网络，RPC 比较返回固定 before/after，追溯返回 r2/r1；包括整次15秒期限。隔离 loopback browser RPC 桥已实现固定 origin／路径／测试 token、精确 preflight、64KiB 请求与4MiB响应边界、断开取消；专项通过，未接 DSH。测试 browser RPC client 已限制 loopback 地址、禁凭据／重定向、保留恢复码并传递 AbortSignal；3 项 bridge/client 专项通过，真实 socket 断开触发服务端操作取消。[实时 TLS 浏览器整链回归通过](https://github.com/f-e-n-g-0531/dsh-vcs/actions/runs/37914278797)：实际 React fetch→测试鉴权桥→严格 RPC→host grant／本地 SVN info→Apache TLS，勾选同意、历史日志、实际高级 Diff before/after、追溯和撤销贯通。属于隔离 CI，不是当前 DSH GUI 实机验收；开发源码生产 UI／RPC 已挂载，正式发布门禁仍未完成。SVN RPC 保留 host rediscover-required，缺失／过期／cwd 改变可触发界面重新发现；内部 AbortError 与任意取消原因安全映射，9 项专项通过。固定 HTTPS host factory 已组合有界 TLS／DAV，无 CLI、测试 CA 或 request 注入入口；本地同意／撤销和未授权拒绝6项专项通过。[审阅提案过期 Chrome 回归通过](https://github.com/f-e-n-g-0531/dsh-vcs/actions/runs/37914784173)：清除勾选与旧提案，只留下手动重试，不增加 RPC、不自动批准；同轮实时 TLS 浏览器链保持通过。host dispose 已作废全部提案／同意、取消在途传输并永久拒绝新 SVN 操作；9 项 lifecycle／consent 专项通过，等待 transport 清理后返回。生产后端构建已生成固定 HTTPS host 单独 bundle，运行导入／dispose 专项与24文件 package 闭包通过；不含测试桥、CLI transport 或证书注入。源码 apply 已挂载固定 HTTPS host，绑定插件 effect dispose；25 项 host／真实 Git RPC／activation 专项、24 文件包闭包和隔离 production-only stub 安装通过；公开同意／撤销／历史 RPC 和界面、完整本地化与失败恢复回归仍待完成。
- 全量检查、包校验、固定标签四平台 CI、同标签 Chrome、正式发布和两端工件核验。
- 外部 SVN 目标必须获得显式网络同意；当前没有获授权目标，不发外部 SVN 请求。

不自动安装或重启 DSH，不提供产品仓库写操作。
