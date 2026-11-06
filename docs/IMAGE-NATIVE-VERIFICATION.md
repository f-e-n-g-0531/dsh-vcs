# 真实图片几何与键盘验收

状态：隔离浏览器验收扩展已执行通过，不改生产功能或当前GUI。

新增不等尺寸decoded图片的真实boundingbox／computedstyle校验，及CDP Input.dispatchKeyEvent驱动原生range Home／End／Arrow键，要求isTrusted与两次RPC资源复用。合成KeyboardEvent不算原生默认行为证据。

真实Edge隔离浏览器执行通过：700×600／350×300 decoded图片在620／320／1000容器宽下fit和100／200%共同像素比例、computed opacity0／1、swipe0／25／50／100边界与两次RPC资源保持通过。原生range通过CDP trusted Home／ArrowRight／End／ArrowLeft，overlay和swipe两组均达0／1／100／99，事件isTrusted全部true，RPC仍2次。报告image-native-report.json已读取确认pass。

首次把CDP测试接入旧run-monaco-browser入口但npm test:browser实际走run-isolated-browser，未生成报告，未计作键盘通过；后接实际入口执行并读取报告后才验收。组件／资源／scale／runner针对性27/27通过，本轮无生产代码变动，未新增全量声明。
