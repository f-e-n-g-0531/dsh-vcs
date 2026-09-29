# 独立布局检查

执行 `node scripts/layout-fixture.mjs`，在浏览器打开生成的 [验收页](<../test-results/layout-fixture.html>)，点击 **Run geometry checks**。页面输出浏览器信息与 12 个组合的 JSON 结果。生成文件位于忽略目录，不进入发布包。

使用项目实际 CSS 与中英文标签，组合 180/260px 侧栏及 1/1.25/2 倍 CSS zoom，带四位数计数和长文件列表。检查按钮在筛选栏内、按钮互不重叠、列表在筛选栏下方、重命名按钮中心点可命中。

限制：这是合成静态布局，不加载 DSH、React 状态、Monaco 或 RPC；CSS zoom 不等同浏览器缩放。已在 [GitHub Browser layout checks](https://github.com/f-e-n-g-0531/dsh-vcs/actions/runs/36528801769) 执行 runner Chrome 无头检查：提交 `160d153` 的 12 个组合通过，结果 JSON 和 DOM 随工作流工件保存（保留 14 天）。使用 runner 预装 Chrome，不修改本机浏览器；该工作流仅手动触发，不改变标签 CI 策略。结果通过也不能替代真实 GUI 的主题、键盘、滚动和点击验收。不要以“生成成功”记录“浏览器通过”。
