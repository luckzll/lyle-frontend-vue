# V6.4 AI 用量视觉验收

- 设计基准：`/Users/luckzll/Desktop/Lyle/UI设计/v6.4/lyle-v6.4-ai-usage-approved.png`（1487 × 1058）
- 实现截图：`/Users/luckzll/Desktop/Lyle/ai-app/frontend-vue/artifacts/v64-usage-implementation.png`（1487 × 1058）
- 并排对比：`/Users/luckzll/Desktop/Lyle/ai-app/frontend-vue/artifacts/v64-usage-comparison.png`（2986 × 1058）
- 验收地址：`http://127.0.0.1:4174/settings/usage`
- 浏览器视口：1502 × 1069；浏览器内容区截图与设计基准同为 1487 × 1058。

## 验收状态

- 使用已登录的 V6.4 模拟账号与真实结构的 Token、调用次数、估算费用、额度、任务拆分和最近消耗数据。
- 系统导航展开，“设置”和“AI 用量”处于选中状态；标题、周期切换、汇总卡、趋势、额度、任务拆分和最近消耗均与基准结构对齐。
- 已验证“今日 / 本月”切换并确认选中状态。
- 已验证额度编辑：填写 42,000 / 52,000、保存成功后编辑表单关闭。
- 已验证最近消耗跳转到 `/?conversationId=1001`，随后返回用量页面。
- 浏览器控制台错误与警告：0。

## 对比记录

首轮发现主导航宽度、设置二级导航、页面内边距、趋势高度和垂直节奏与基准不一致；调整后使用同尺寸、同状态截图再次并排对比。最终未发现阻塞交付的 P0、P1 或 P2 视觉问题。

Final result: passed
