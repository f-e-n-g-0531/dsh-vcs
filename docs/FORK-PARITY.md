# Fork 完整能力对齐

## 目标与证据

目标是逐项补齐 Fork 公开能力及对应交互，不再将只读能力对齐称为完整对齐。基线为本仓库 52e9ff3（0.7.3）与 2026-11-05 获取的 [Fork 官网](https://fork.dev/) Feature Overview。官网不是详细行为规格，Windows／macOS 差别及异常交互仍须核实；不复制专有资源。

以下“已有”仅指源代码有实现，不表示与 Fork 等价或已通过本轮验证。另以官方 [Windows release notes](https://fork.dev/releasenoteswin) 2.23（2026-09-25）及 [macOS release notes](https://fork.dev/releasenotes) 2.71（2026-10-23）作为扩展基线。首页下载链接较旧，不作为最新版本证明。首页部分区块按平台隐藏，不能由缺少展示推断该平台没有功能。

## 能力清单

| 功能组 | 当前差距 | 验收重点 |
| --- | --- | --- |
| 工作区与 Diff | 已有 Git 暂存／未暂存读取及 Monaco 比较；缺正文编辑；受限逐行选择候选界面已接入 | HEAD／index／worktree 清晰；取消、过期、计算不完整提示 |
| 图片 Diff | 已有有限 PNG／JPEG／WebP 并排；已增加适应窗口、原始大小及25／50／100／200%同步缩放；候选叠加透明度／滑动分割已接入并隔离验证 | 同步缩放、原始尺寸、适应窗口、错误重试及 URL 释放 |
| 历史／目录／Blame | 已有固定快照分页、图、搜索、树及 Blame | 图分叉合并、键盘、选择和窗口边界；有界历史不冒充全量 |
| 分支／标签 | 已有引用导航及确认切换已有本地分支；从当前HEAD创建分支候选界面已接入隔离验证；删除已有只读合并评估候选，实际删除仍缺；当前HEAD unsigned annotated及lightweight tag候选已接入；仍缺任意起点创建、删除tag及 detached checkout | 精确引用与 OID、过期拒绝、未合并风险、无自动 force |
| 暂存／提交 | 候选支持严格受限整文件stage／unstage；候选完整块stage界面已接入，候选反向完整块unstage界面已接入；受限块内逐行stage／unstage候选界面已接入；受限显式commit候选界面已接入并通过隔离验证；最近提交只读展示／显式消息复用候选已接入；受限amend历史改写候选界面已接入并通过隔离验证；新增／改名／转换等普遍Git写操作仍有缺口 | 只写已确认内容；CRLF、无末行换行、改名、冲突、并发修改 |
| 远端／同步 | 缺 remote 管理及 fetch／pull／push；缓存远程引用不等于 fetch | 网络授权、凭据保密、上游及 refspec、无自动 force 或 retry |
| Stash | 已有列表及只读详情；缺 create／apply／pop／drop 和图中集成 | 固定 OID、范围确认、冲突恢复、成功 apply 才可 pop 删除 |
| Cherry-pick／revert | 缺写操作 | 固定目标与父提交、continue／abort、结果未知提示 |
| Merge／rebase | 缺写操作和可视化交互式 rebase | 预览计划、重排／edit／squash、过期拒绝及中断恢复 |
| 冲突解决 | 已有阶段只读查看；缺三方编辑和解决写回 | base／ours／theirs 身份；确认写回才标记解决；二进制和改名 |
| Reflog | 已增加最近200项 HEAD 日志只读快照及固定 OID 详情；恢复入口仍缺失 | 2MiB命令输出上限、201项前瞻提示截断；selector仅显示、从不执行；恢复优先显式创建新引用，不静默 reset |
| 仓库管理 | 已有 Session 范围内发现选择；缺创建／clone／最近仓库及统计 | 不覆盖已有目标；网络和磁盘范围明确 |
| 子模块 | 已有指针与检出状态读取；缺 init／update／同步 | 每个仓库独立授权；不自动递归或联网 |
| LFS／Git-flow／GPG | 签名元数据读取不等于验签／签名；专用操作缺失 | 区分工具、配置与验证结果；不自动执行配置的外部命令 |
| GitHub 通知 | 缺服务集成 | 明确账号和网络授权、token 安全存储及撤销 |

SVN 是本项目额外能力，继续保留显式 HTTPS 历史授权及固定修订边界；Fork 的 Git 能力不推导为 SVN 写授权。

## 官网版本记录中的扩展能力

以下也必须纳入后续逐项验收，不能仅完成首页清单就宣布全部对齐：

- 图折叠／展开、Quick Launch、模糊路径搜索、纵向标签页及工作区持久化。
- Worktree 创建／删除／远程分支检出、跨 worktree 共享仓库配置与独立视图状态。
- Patch 导出／剪贴板应用与冲突预判；bisect good／bad／skip。
- 托管服务账号、SSH key、PR 创建入口、推送多个分支及上游状态。
- Partial stash、恢复 index 状态、rebase update-refs、cherry-pick／revert 冲突预判。
- LFS 锁定／解锁／状态；图片 pixel／swipe／onion 及 TGA 等格式；16-bit 图像需按平台核实。
- 选中代码历史、Repository Treemap 活动统计、Activity Manager、外部 diff／merge 工具及受控自定义命令。
- AI branch／SHA range review 与提交说明生成：按各平台版本逐项核对，DSH 自带 AI 不等于插件已实现这些工作流。

上述为官方公开可验证范围，不是其内部全部行为的穷尽证明。每项仍需明确操作场景、失败路径、授权及平台证据。

## 实施顺序

1. 图片审阅交互、当前测试基线及完整差距核对。
2. 已完成通用一次确认事务、Index模型／锁、blob存储与受限单文件stage／unstage；当前候选已接入固定RPC和明确确认界面，未正式发布。Stage按[捕获内容绑定](<STAGE-CAPTURED-BYTES.md>)写入，不直接git add实时路径；部分文件／配置和逐行操作仍未支持。
3. 引用创建、文件级暂存、逐行暂存、提交／amend，每项独立端到端验收。
4. Stash、Reflog 与恢复、冲突解决、merge／cherry-pick／revert，随后 rebase 与可视化计划。
5. 远端管理、凭据及网络授权后增加 clone／fetch／pull／push；子模块、LFS、Git-flow、GPG、通知独立验收。
6. 布局、键盘、失败恢复、大仓库性能及平台差异，不能以菜单出现代替行为等价。

现有[贡献约束](<../CONTRIBUTING.md>)限制新增写操作。实际开放每种新写能力前，应同步修订精确范围与安全规范；本计划不删除保护，不在用户仓库执行真实写操作。验证使用临时仓库。

## 验证与交付

- 每项记录真实仓库、RPC、React 及隔离浏览器证据；失败、跳过和未验证单列。
- 构建／单测不等于当前 DSH GUI 更新；不自动安装、升级或重启，不启动替代服务冒充当前 GUI。
- 发布、推送标签、更新日常 profile 及真实远端写入不作为本轮默认动作。
- 全部清单与平台交互证据闭合前，不宣称完整对齐；当前尚未达到。
