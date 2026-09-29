# v0.3.35 正式发布核验

用户明确要求正式发布并指定更新为 v0.3.35。真实 DSH GUI 尚未验收，此例外已写入 GitHub Release 说明，不能据此宣称整体 Fork 对齐完成。

- 固定源码：`6211f37fdfaf5f7d17bb220ae3dd4d7c7365f9d2`。未移动旧标签。
- [四平台标签 CI](https://github.com/f-e-n-g-0531/dsh-vcs/actions/runs/36578557690)：Windows/Ubuntu × Node22/24 全部成功。
- [同标签 Chrome 回归](https://github.com/f-e-n-g-0531/dsh-vcs/actions/runs/36578618927)：成功；实际组件配合模拟 RPC，不等同真实 GUI。
- [正式发布工作流](https://github.com/f-e-n-g-0531/dsh-vcs/actions/runs/36579195413)：成功。
- [GitHub Release](https://github.com/f-e-n-g-0531/dsh-vcs/releases/tag/v0.3.35)：draft=false、prerelease=false。
- npm 公共查询最终确认版本 0.3.35，latest=0.3.35。发布后初次查询曾返回 404/旧 latest，后续查询已恢复，未重复发布。
- 分别下载 GitHub 与 npm 安装包计算 SHA-256，结果相同，并匹配 GitHub SHA256SUMS.txt：

```text
d9b5bc98f620a8915375dbbeef0fcf6fb7b0d6f0a5e7aa38791e7a5d950c4594
```

## 安装与剩余工作

```powershell
dsh plugin --profile web add @feng0531/dsh-vcs@0.3.35
```

本次发布没有安装到当前宿主或重启 DSH。安装会改变 profile 配置，需要明确目标；宿主重启由用户执行。按[真实验收清单](<LIVE-ACCEPTANCE.md>)记录实际加载版本、审阅操作及截图/错误。后续发布仍默认要求验收，不将本次例外视作永久豁免。
