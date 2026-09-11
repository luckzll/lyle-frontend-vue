# 登录安全验证与倒计时验收

Date: 2026-09-11

final result: passed

## 范围与视觉依据

用户要求压低验证栏、给密码登录补上安全验证、显示验证码重发倒计时。本次为现有登录设计的局部修改。

- 来源：`C:/Temp/codex-clipboard-ba4e5585-98b9-4df4-ac15-5f489a6377b6.png`，873 × 507 像素，只有表单局部；红框是用户标注。
- 实现：`http://127.0.0.1:5176/login`，实际前端代码和隔离 fixture 后端。
- 证据目录：`D:/vit/文档/Lyle/artifacts/2026-09-11-login-verification/`。
- 组合对比：`verification-before-after.png`（1180 × 440）。来源字段宽 840px 归一化为 530px，实现字段宽为 529.93 CSS px。已打开组合图，在同一输入中比较表单结构、字体、颜色、间距和文案。
- 桌面完整截图：`login-code-desktop.png`、`login-password-desktop.png`。CSS viewport 和截图均为 1280 × 720；浏览器 DPR 为 1.5，截图输出为 CSS 尺寸。
- 手机完整截图：`login-code-mobile.png`、`login-password-mobile.png`，CSS viewport 和截图均为 390 × 844。
- 状态：浅色、未登录、空表单、分别选中两种登录方式。完整截图均已打开查看。来源不含整页，因此不声称整页逐像素匹配；完整实现截图用于检查构图和响应式布局。

## 发现与处理

无遗留 P0 / P1 / P2 问题。

原验证栏明显高于输入框。实现去掉重复说明行，将图标、标题和按钮排成一行；桌面和手机实测均为 54px，桌面输入框约 57.33px。组合图确认验证栏回到表单控件的视觉层级。

密码登录在密码字段下显示同一控件。未验证时禁用登录，提交函数也检查凭据；后端在密码校验之前消费验证凭据，错误密码尝试同样不能复用凭据。

发码后按钮显示“60 秒后重发”，下方有时钟图标和剩余时间。以绝对截止时间保存当前标签页的冷却状态，按归一化邮箱区分；同一邮箱的登录、设置密码、绑定发码共享冷却，与后端规则一致。结束后恢复“重新发送”。

## 五项视觉检查

1. 字体：保留 Inter / 系统中文字体回退。验证标题 14px、600 字重，按钮 13px；手机分别为 13px、12px，均未换行。倒计时使用等宽数字。
2. 间距：54px 验证栏与输入框接近，按钮靠右；手机未出现横向溢出，切换和提交操作可见。
3. 颜色：沿用紫色操作、浅灰边框与背景；冷却文案使用可读灰色，不随通用禁用样式过度淡化；成功反馈保留绿色。
4. 资产：保留已有 Lucide 标准图标、登录波纹位图及品牌素材，没有以代码绘图替换现有资产。手机沿用现有布局隐藏左侧品牌图。
5. 文案：“安全验证已通过”适用两种登录方式。发送中、倒计时、重发和错误反馈均明确。role=timer 配合 aria-live=off，避免读屏每秒重复播报。

## 交互与测试证据

隔离组件验收页 `http://127.0.0.1:5177` 使用真实 EmailAuthForm，仅该服务用明确标注的模拟控件替换 HumanVerification。实际产品没有绕过验证的代码。未操作真实 CAPTCHA、未发送邮件、未修改实际账号密码。

- `countdown-start.png`：发送后立即 60 秒，重发禁用；随后观察到 52 秒。
- `countdown-restored.png`：刷新后重新填入同邮箱，恢复 37 秒；切换密码再切回时继续为 21 秒。
- `countdown-expired.png`：归零后恢复“重新发送”。
- `countdown-mobile.png`：390 × 844 CSS viewport，内容宽 375px（滚动条占位），无横向溢出，倒计时文案可读。该滚动页面截图输出为 375 × 812。
- 密码模式不受邮箱发码冷却阻挡。错误密码后提示并清空验证，再次模拟验证后正确密码完成登录，见 `password-login-success.png`。
- 邮箱验证码登录在发码凭据消费后仍可使用有效验证码完成，没有要求第二次安全验证。
- 正常应用登录页浏览器 error / warn 日志为空。隔离页错误密码和非测试邮箱的错误为预期 fixture 响应。
- Vitest：email-code-cooldown.spec.ts + captcha.test.ts，13 / 13 通过；覆盖刷新恢复、时间跳跃、跨用途冷却、邮箱隔离、Retry-After、存储不可用和卸载清理。
- Maven 相关安全测试通过：EmailPasswordSecurityTest 16、HumanVerificationServiceTest 9、EmailIdentityServiceTest 8、AuthServicePasswordTest 4、EmailCodeServiceTest 8、AuthSessionServiceTest 5；对应 Surefire 报告无失败和错误。
- 隔离 fixture HTTP 检查 40 / 40 通过。
- 最终 npm run build（vue-tsc + Vite）通过，见 frontend-build.log。
- 既有 E2E 文案断言已更新；本次未运行 Playwright CLI。真实 CAPTCHA 完整挑战和实际邮件投递不在隔离浏览器验收范围内。

## 对比历史与完成检查

第一次实现后的组合检查无新增 P0 / P1 / P2 问题，无需第二轮视觉修改。原高验证栏为用户要求修正的既有问题，改善已通过组合图确认。

- [x] 桌面、手机整页检查与局部组合比较
- [x] 密码登录前后端安全凭据检查
- [x] 倒计时开始、递减、刷新、切换与结束检查
- [x] 相关测试及最终构建

本地代码已完成，未提交或部署。之前的资料页面验收保存在 previous-resources-qa.md。
