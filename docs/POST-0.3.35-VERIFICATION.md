# 0.3.35 发布后修复验证

第 183/200 轮，主线源码 `68bdcbff4d32d07d5af00bb76ac85a5f51d370ce`：

- 空 HEAD 历史仍提供手动引用 A/B 比较入口；真实 unborn HEAD 测试验证既有分支和标签可比较，不改变 HEAD、索引及工作区。
- HistoryPanel 自身按 Session/仓库重置，避免旧分页偏移、快照及提交选择跨范围保留；取消和丢弃迟到分页响应。
- npm run check：构建成功，204/204 测试通过，无跳过。
- verify:package：19 文件、导出、资源、许可及 Cordis patch 校验通过。
- test:install：生产依赖安装与模拟宿主注册通过；非真实 DSH 验收。
- [空历史 Chrome 回归](https://github.com/f-e-n-g-0531/dsh-vcs/actions/runs/36673634611)及[范围切换 Chrome 回归](https://github.com/f-e-n-g-0531/dsh-vcs/actions/runs/36673918366)成功；实际组件、模拟 RPC。

## 不得混同正式工件

源码包版本仍为 0.3.35，但上述是发布后的 main 改动，不是已有 v0.3.35 标签内容，未再次发布。本次安装测试 tarball SHA-256：

```text
871d415152c004db0a7ed75b1c7cc65185c01bd68b0f9ce39da9680ed93d0ee2
```

正式工件与 SHA 见[0.3.35 发布记录](<RELEASE-0.3.35.md>)。后续若发布这些修复，需新版本、独立标签 CI 和验收；不可覆盖已发布版本。真实 GUI 仍按[清单](<LIVE-ACCEPTANCE.md>)待验收。
