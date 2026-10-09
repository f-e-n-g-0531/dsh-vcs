# 提交图键盘验证结论

功能已随 0.3.39 发布：上下键与 Home/End 仅移动焦点，首尾不越界；修饰键与未处理按键不接管默认行为。

[隔离 Chrome 原生输入回归](https://github.com/f-e-n-g-0531/dsh-vcs/actions/runs/36699145067)通过，验证 Enter/Space 激活和 Tab 退出。CDP 输入证据不等同物理键盘、辅助技术或当前 DSH 实机验收。
