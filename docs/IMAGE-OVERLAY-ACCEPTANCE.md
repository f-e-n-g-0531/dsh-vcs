# 图片复合比较验收

- 模式默认并排，overlay opacity和swipe位置用原生range（0–100），label和当前值明确，可键盘操作。
- 左上像素注册，不同自然尺寸不stretch；共同canvas最大宽高，fit同因子不会让小图独立放大。
- mode／range／zoom不触发第三次RPC、不换已持有URL，关闭／切scope／卸载每个资源释放一次，retry仅重载对应side。
- absent／error／loading不显示假有效复合；仍能看错误或重试。
- numeric缩放滚动容器keyboardfocus保持，Fit容器resize重新算geometry不重新拉图。
- 图片仅显示、不产生图像写回／工作文件修改。
