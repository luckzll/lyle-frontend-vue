## 访客聊天首页与登录提示设计验收（2026-09-02）

**Evidence**

- Source visual truth: `C:/Temp/codex-clipboard-ef25a35f-6778-474e-9894-62e4a8ea95fa.png`.
- Browser-rendered desktop implementation: `D:/vit/文档/Lyle/ai-app/frontend-vue/design-qa-guest-home-implementation.png`.
- Same-input comparison image: `D:/vit/文档/Lyle/ai-app/frontend-vue/design-qa-guest-home-comparison.png`（左侧为参考，右侧为实现）.
- Responsive implementation: `D:/vit/文档/Lyle/ai-app/frontend-vue/design-qa-guest-home-mobile-v2.png`.
- Mobile auth prompt: `D:/vit/文档/Lyle/ai-app/frontend-vue/design-qa-auth-gate-mobile.png`.
- Source pixels: 2232 × 1350，包括约 63 px 浏览器工具栏；对照时裁出 2232 × 1287 应用区域并归一化为 1440 × 831。实现截图为 1439 × 831，对照时归一化为 1440 × 831。浏览器 CSS 视口为 1440 × 831，设备缩放系数 1。
- State: 未登录访客，根路由 `/`，登录提示关闭；登录提示另在桌面与 390 × 844 移动视口单独验证。

**Findings**

- No actionable P0, P1, or P2 findings remain.
- Fonts and typography: 沿用现有 Inter / 系统字体栈、标题权重和正文行高；参考中的“AI 聊天”“今天想推进什么？”以及卡片信息层级均保持。
- Spacing and layout rhythm: 侧栏、顶栏、主内容阅读宽度、2 × 2 快捷卡片和底部输入区与参考同轴；访客标识和登录入口是必要的状态差异，没有挤压主任务区。
- Colors and visual tokens: 全部使用现有 primary、primary-soft、surface、border、foreground 与 muted token，未引入新的孤立视觉体系。
- Image quality and asset fidelity: 参考界面没有需要复刻的位图或装饰图片；Logo、导航与功能图标继续使用项目既有组件和图标库，没有占位资产。
- Copy and content: 保留参考页的核心标题、四个快捷入口、上下文和输入提示；新增文案仅用于解释访客状态及登录后返回原目标。
- Accessibility and interaction: 桌面和移动端均可通过可访问名称找到登录入口；功能卡片、输入区、通知和侧栏项目会打开统一登录提示；取消后留在原页，确认后进入 `/login?redirect=<原目标>`。
- Responsive behavior: 390 × 844 下无横向溢出；快捷卡片改为单列并在输入区上方独立滚动，登录提示完整显示且按钮保持可触达。
- Browser console errors: 0。

**Open Questions**

- None for the guest-preview scope.

**Implementation Checklist**

- [x] 根地址对未登录访客公开展示聊天工作台预览。
- [x] 已登录用户继续使用原完整 ChatView，不改变现有能力。
- [x] 侧栏、提醒、快捷入口和输入区统一弹出登录提示。
- [x] 登录跳转保留原目标路径，登录成功后可以返回。
- [x] 套餐页保持公开，并复用相同登录提示。
- [x] 桌面、移动端、构建、E2E 与浏览器控制台验证通过。

**Follow-up Polish**

- P3: 可以在后续线上数据分析中比较“立即弹登录”与“允许先输入草稿、发送时弹登录”的转化率；当前版本选择更明确且不会让访客误以为草稿已经保存。

**Comparison History**

- Pass 1: 桌面实现与参考图同图对照，整体框架与主内容匹配；发现移动端“当前上下文”按钮文字折行、最后一张快捷卡片被输入区覆盖，并且图标式登录入口缺少独立可访问名称（P2）。
- Pass 2: 将移动端上下文按钮固定为 40 × 40 图标按钮，主内容改为独立滚动区域，为登录入口补充明确 `aria-label`。390 × 844 复查无横向溢出，四张卡片和输入区均可触达，P2 已关闭。

final result: passed

---

**Evidence**
- Source visual truth: `C:/Temp/codex-clipboard-cb24c3de-89d4-426f-9187-cbd3d5dfaccb.png`.
- Supporting source error state: `C:/Temp/codex-clipboard-cf2cf7ec-d37f-4762-aa36-e5ccc150b66a.png`.
- Browser-rendered desktop implementation: `D:/vit/文档/Lyle/.worktrees/model-switcher-frontend/test-results/design-qa-chat-centered-desktop.png`.
- Browser-rendered mobile implementation: `D:/vit/文档/Lyle/.worktrees/model-switcher-frontend/test-results/design-qa-chat-centered-mobile.png`.
- Source pixels: 2549 × 1403 at desktop density. Implementation pixels/CSS viewport: 1280 × 720 desktop and 390 × 844 mobile, device scale factor 1. The source and implementation were compared at their full-view aspect ratios; exact content length differs because the QA account uses a shorter fixture conversation.
- State: authenticated test account, populated two-message conversation, context panel closed for captures, Qwen 3.7 Flash selected.
- Full-view comparison evidence: the source and desktop implementation were opened together in one comparison input. The source exposed the original full-width message alignment; the implementation showed the requested centered reading column.
- Focused comparison: a separate crop was unnecessary because the changed surface is the full message/composer column. Browser measurements provide the focused evidence: assistant and user tracks are both 860 CSS px wide and share the same horizontal origin; the composer is 860 CSS px wide and centered on the same axis.

**Findings**
- No actionable P0, P1, or P2 findings remain.
- Fonts and typography: the existing application font stack, weights, line heights, Markdown hierarchy, and wrapping are preserved. The narrower measure improves long-form scanability without truncation.
- Spacing and layout rhythm: desktop messages and composer now share one 860 px centered reading track. The outer conversation canvas remains full width, preserving the product shell and context-panel behavior.
- Colors and visual tokens: no palette drift was introduced; surface, border, primary-soft, foreground, and muted tokens remain unchanged.
- Image quality and asset fidelity: no raster or custom image assets are required for this layout change. Existing product icons are preserved.
- Copy and content: application copy is unchanged by the layout work. The separate provider-network fix changes only the actionable failure message.
- Responsive behavior: at 390 × 844, messages and composer use the available width, the document has no horizontal overflow, and the internal message list remains scrollable.
- Accessibility and interaction: model selection was changed from Qwen to GPT-5.5 and back successfully; the context dialog opened and closed correctly; the composer remains focusable; browser console warnings/errors were empty.

**Open Questions**
- None for the centered-layout scope.

**Implementation Checklist**
- [x] Center user and assistant messages in a shared desktop reading track.
- [x] Center the composer on the same axis and width.
- [x] Preserve full-width outer canvas and context panel.
- [x] Preserve mobile full-width behavior without horizontal overflow.
- [x] Verify model switching and context-panel interactions.
- [x] Check browser console warnings/errors.

**Follow-up Polish**
- P3: a later visual pass could tune the reading width between 820 and 880 px from real-user preference, but 860 px currently balances tables, Markdown, and chat readability.

**Comparison History**
- Pass 1: the original screenshot and browser-rendered implementation were compared together. The requested intentional difference—moving the message/composer content into a centered reading track—was present, with no new P0/P1/P2 regression. No corrective visual iteration was required.

final result: passed

---

# 套餐页工作台内嵌设计验收

## 视觉依据

- 工作台框架来源：`C:\Temp\codex-clipboard-3369cc6b-9cd2-46e7-82b1-1097223a95aa.png`（2559 × 1398）
- 套餐卡片来源：`C:\Users\zhl20\Desktop\admin\file\work\创业\套餐.png`（2390 × 1268）
- 实现截图：`D:\vit\文档\Lyle\ai-app\frontend-vue\design-qa-pricing-workbench.png`（1787 × 1119）
- 浏览器验证视口：2048 × 1119 CSS px，设备缩放系数 1。内置浏览器受面板可用宽度影响，最终截图宽度为 1787 px。

## 验收状态

- 页面：`/pricing`
- 状态：未登录、套餐目录接口使用本地测试数据
- 目标：保留工作台左侧导航与顶部栏，在主内容区展示四档套餐；移除套餐页自带的独立 Logo 与“返回工作台”导航。

## 对照结果

### 全页结构

- 工作台左侧导航、顶部标题栏和账号区域与框架参考保持一致。
- “设置”导航在套餐页保持选中，套餐内容位于工作台主内容区。
- 套餐标题、说明、当前套餐摘要、四列套餐卡片和底部说明延续原套餐页的信息层级。

### 重点区域

- 桌面宽屏截图已经能清晰覆盖顶部栏、左侧导航、标题区与全部套餐卡片，无需额外裁剪。
- 四档套餐在宽屏保持单行排列；窄屏回归测试验证为单列且无横向溢出。

## 设计表面检查

- 字体：沿用项目现有字体栈；标题、价格、正文和辅助文字的字号层级与参考一致。
- 间距与布局：移除独立页导航后缩短顶部留白，主内容最大宽度与卡片间距保持稳定。
- 色彩与令牌：继续使用项目的主色、边框色、背景色和状态色变量，没有引入孤立色值体系。
- 图片与资产：未新增装饰性位图；导航和卡片继续使用项目现有图标体系。
- 文案与内容：保留四档套餐、价格、额度、有效期、功能说明及支付状态提示。

## 交互与回归

- `/pricing` 保持公开可访问，同时使用默认工作台布局。
- 工作台框架、侧边栏、“设置”选中态、套餐标题和四档卡片均可见。
- 页面中不再存在 `.pricing-nav` 独立导航。
- 控制台错误与警告：0。
- 构建与 Playwright 商业化回归：通过（详见本次提交验证记录）。

## 对照历史

1. 初始实现：套餐页使用独立全屏导航，与工作台框架参考不一致。
2. 修正实现：将路由布局切换为默认工作台布局，移除页面内部独立导航，并缩短内容顶部留白。
3. 修正后验证：浏览器截图确认左侧导航、顶部栏、选中态和四档套餐同时呈现；未发现 P0、P1 或 P2 级视觉问题。

## 最终结果

passed
