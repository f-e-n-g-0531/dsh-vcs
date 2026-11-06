# 部分变更块Stage三阶段协议

状态：候选Host三阶段协议已实现，用户块选择界面已接入未发布候选，见[用户记录](<PARTIAL-STAGE-USER.md>)。内部计划与选择已通过适配器验证。

## 固定请求

- vcs/partial-stage-plan：sessionId、repositoryId、unstaged选中id。guard内解析路径，只读创建精确计划；返回planToken与有界显示计划。
- vcs/partial-stage-prepare：sessionId、repositoryId、planToken、unitIds。先消费计划token，再复验授权／内容并绑定选择生成候选预览；不写对象或Index。
- vcs/partial-stage-confirm：sessionId、repositoryId、token。独立确认token，一次消费，不能附带新选择、路径、正文或OID。

协调器所有方法均采用(address,binding)签名；binding含entry、repository、cwd、signal、assertAuthorized，address含Session／repositoryId及本阶段字段。计划token与确认token固定服务器partial-index-stage操作kind，绑定Session／cwd／发现grant／repository对象，默认60秒、最多32项，重发现／卸载失效，错配尝试烧毁token。选择数组在异步前复制，重复／未知／空选拒绝。

## 保护与限制

plan／prepare走共享仓库读锁，confirm与stage／unstage／branch共用写互斥。写后失败为index-outcome-unknown并披露append-only孤立对象可能性，不回滚或GC。

部分流程允许同mode的Index与HEAD不同（MM），按实际Index→Work规划并绑定fresh MM身份；整文件操作仍拒绝MM；精确UTF8计划每侧256KiB／4000行／20万LCS格，工作树仍有2MiB每文件／16MiB／2万节点限制。完整块而非块内任意逐行，不支持部分unstage。

## 验收

字段白名单、阶段隔离／重放／过期／跨范围、选择数组冻结、授权前后变化、取消、外部锁、与整文件写互斥、默认15秒及真实Git只暂存一个块且Work不变。Host验证不代表浏览器已提供功能。

## 当前验证

固定协调器10项、RPC12项及通用请求契约4项聚合26/26通过；默认生产Host＋真实Git三阶段round-trip1/1通过：计划和选择预览不改Index，确认仅写第一块、完整Work不变，两类令牌重放拒绝，默认15秒预算不变。

构建、50文件包闭包检查、生产依赖隔离安装与stub宿主注册通过；最终npm默认全量992/992通过，无失败／取消／跳过／todo；独立静态复核未发现当前无UI范围可确认缺陷。
