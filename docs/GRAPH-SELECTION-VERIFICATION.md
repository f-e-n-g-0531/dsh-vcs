# 提交图当前提交：集成回归证据

产品功能已随0.3.40发布；本记录覆盖发布后的测试补强，不构成新版本或真实DSH GUI验收。

- 测试提交797ddba：在真实HistoryPanel组件和模拟RPC中，从图选择第二个提交，断言列表aria-pressed、图aria-current及详情请求OID一致；Home仅移动焦点不增加RPC；从列表选择第一个提交后，图标记同步且旧标记清除。
- 首次运行[36702405618](https://github.com/f-e-n-g-0531/dsh-vcs/actions/runs/36702405618)失败。下载history-dom报告确认浏览器pass=true、calls=9；外层校验器仍期望8次RPC。新增一次图详情读取是预期行为。
- 修正提交6110e9574d324bfa02e299f8311b06194cba56a5将严格RPC计数更新为9，没有放宽为不限定次数。
- 第298轮[完整隔离Chrome重跑](https://github.com/f-e-n-g-0531/dsh-vcs/actions/runs/36702587819)成功，覆盖既有历史、编辑器及原生输入回归。

测试不访问当前DSH会话、不读取登录信息，不安装或重启。当前宿主中的跨面板选择、Session/仓库切换和页面实际加载版本仍需真实验收。正式0.3.40标签与包不变。
