# Lyle Web

Lyle V4.2 的 Vue 3 前端。登录后的默认入口是「今日工作台」，应用围绕开始、推进、资料、系统和管理员五组导航组织。

## 本地运行

```bash
npm ci
npm run dev
```

默认地址：`http://127.0.0.1:5173`。Vite 会按现有配置代理 `/api` 请求。

## 质量检查

```bash
npx vue-tsc --noEmit
npm run test:unit
npm run build
npm run audit:dependencies
npm run audit:dependencies:production
npm run test:e2e
npm run test:e2e:v64-real
npx playwright test tests/e2e/v42-dashboard-shell.spec.ts
npx playwright test tests/e2e/v42-core-workflows.spec.ts
npx playwright test tests/e2e/v42-execution-automation.spec.ts
npx playwright test tests/e2e/v42-mobile-critical.spec.ts
npx playwright test tests/e2e/v42-tasks-resilience.spec.ts
npx playwright test tests/e2e/v42-visual-regression.spec.ts
npx playwright test tests/e2e/v42-core-accessibility.spec.ts
```

`audit:dependencies` 检查包含开发与测试工具在内的完整依赖树，中等及以上漏洞会使命令失败；`audit:dependencies:production` 只检查生产依赖，用于生产发布门禁。

端到端测试使用 Playwright。V4.2 的 mock 契约测试不依赖本地后端，覆盖首次巡检、自然语言启用自动化、Chat 候选任务、连接并行诊断、执行确认、失败重试、移动端关键动作、任务韧性和视觉基线；原有集成测试仍需 Java 与 Python 服务可用。

`npm run test:e2e:v64-real` 是 V6.4 发布门禁：脚本会创建隔离的
MySQL/PostgreSQL 数据库、执行 Flyway/Alembic 全链迁移并启动三端真实服务，
验证双用户的会话轮换与重放撤销、改密、会话/附件/知识库/记忆/待办/Mission/
用量隔离、额度执行和管理员权限。测试结束会清理临时数据库、服务进程和附件文件。

## 工程边界

- `src/design/`：原始与语义设计 Token、焦点和 reduced-motion 规则。
- `src/components/ui/`：无业务语义的基础组件。
- `src/components/feedback/`：加载、空、错误、Toast 和确认反馈。
- `src/components/layout/`：页面标题、筛选、上下文面板和详情抽屉。
- `src/components/domain/`：自动化、确认、结果、连接、建议和状态组件。
- `src/app/`：应用壳层和结构化导航。
- `src/api/adapters/`：把后端响应归一化为稳定的页面 ViewModel。
- `src/stores/`：只保存必要的跨页面状态；页面列表、筛选和抽屉状态留在页面内。

新界面优先使用语义 Token 与共享组件。`src/styles.css` 是兼容旧页面的 legacy 层，不再承载新的领域组件样式。

## 数据与安全

- 一次性聊天正文只存在内存；`sessionStorage` 仅保存 intent/project ID，并在消费后清除。
- Chat 到自动化的自然语言意图同样只存在 Pinia 内存，URL 只携带一次性 `handoffId`。
- URL 只携带项目、结果、视图等 ID 或枚举，不携带聊天、任务、文件或凭据正文。
- 本地偏好只保存侧栏折叠等非敏感 UI 状态。
- 产品事件使用白名单事件名和安全元数据，不记录聊天正文、任务内容、文件内容、Secret 或原始 Trace。
- Chat 的可扩展 SSE 元数据在进入页面状态前经过字段白名单和递归脱敏；原始工具正文、完整 payload、结果正文与常见凭据表示法不会被保留。
- 普通用户和管理员入口同时受路由权限与服务端权限约束。

更多信息见 [设计规范](docs/V4.2-DESIGN-SYSTEM.md)、[页面清单](docs/V4.2-PAGE-INVENTORY.md) 和 [发布说明](V4.2_RELEASE_NOTES.md)。
