# V5 受控 Agent 循环真实验收证据

更新时间：2026-07-15（Asia/Shanghai）

## 当前自动化门禁

运行 `npm run test:e2e:v5-real` 会自行启动 Java 控制面、Python 决策/工具服务、真实数据库连接和前端，再执行不拦截 Agent Task API 的 Playwright 场景。仅外部 Tavily 供应商由本地协议夹具替代，以消除互联网和第三方配额波动；夹具会返回包含提示注入指令、原始正文、查询参数和 Fragment 的结果。

本轮通过的真实链路：

| 场景 | Task ID | 结果与证据 |
| --- | --- | --- |
| 项目巡检与个人记忆脱敏 | `2076920172839890945` | 5/5 完成；`memory.snapshot` 只保存计数摘要，标记 `redacted=true`、`sensitivity=PERSONAL`，Step 与 Artifact 均无个人记忆正文。 |
| 资料调研与外部正文脱敏 | `2076920182839111682` | 2/2 完成；真实 Java → Python 工具调用得到 `fixture.example` 来源，只持久化域名级引用和结构化摘要；URL 路径、查询参数、Fragment 和提示注入正文均不落库。 |
| 暂停与恢复 | `2076920184818823169` | 长时 `release.check` 运行期间发起暂停；当前调用安全结算后停在结论步骤前，恢复后完成任务。 |

数据库抽查结果：夹具原始正文、`Ignore previous rules`、`tracking=must-not-persist`、旧的“网页搜索结果：”与“长期摘要：”在 Step 和 Artifact 中的残留计数均为 0。

安全边界现场复验：内置浏览器任务 `2077010995203997698` 真实完成 2/2。`research.search` 的 Step 只保存 `tool-result://...` 和 `https://fixture.example`，`criterionEvidence.note` 被 Java 控制面固定重写；Step 与 Artifact 对提示注入正文和追踪参数的数据库残留计数均为 0。Java 回归用例还覆盖了伪造 `redacted=true`、合法格式摘要、恶意 note、任意顶层/嵌套字段、usage 附加字段和伪造 criterion 的组合攻击。

派生敏感边界复验：内置浏览器任务 `2077261182593908738` 真实完成 2/2。Java 控制面使用实际传给 `analysis.synthesize` 的 Artifact 快照判定敏感级别，不读取结果关键词或上游 `redacted`/`sensitivity` 声明；综合步骤落库摘要固定为“已形成结构化执行结论；敏感上游正文已省略。”，敏感级别为 `EXTERNAL_CONTENT`，criterion note 由控制器重写。Step 与 Artifact 敏感原文残留计数均为 0；正常执行和 staged 崩溃恢复均有无关键词攻击回归用例。

## 历史数据治理

- Flyway V16 清除敏感工具 Step/Artifact/Event 的旧正文，并将 Reviewer v1 结果标为 `legacy-invalidated-v16`；旧的完成态改为部分完成，不能继续作为发布结论。
- Flyway V17 继续清除旧 `analysis.synthesize` 对上游敏感正文形成的派生副本。
- 前端展示层还有独立兜底：未带脱敏标记的敏感工具输出，以及包含旧敏感正文特征的综合结果，都只显示隐藏提示。

## 质量结果

- Python 全量：359 passed。
- Java 全量：65 passed。
- 前端单元：67 passed。
- V5 Mock Playwright：6 passed。
- V5 真实跨服务 Playwright：1 passed。
- 前端生产构建（灰度变量开启）：passed。
- Compose YAML 与发布检查脚本语法：passed。

## 灰度构建

前端 Dockerfile 已声明 `VITE_AGENT_TASK_ENABLED` 与 `VITE_AGENT_TASK_ENABLED_USERS` 构建参数；Compose 从生产环境文件传入这两个参数，并同时配置后端动态开关、用户白名单和工具/模型白名单。灰度值变化后必须重新构建前端镜像。发布检查脚本会拒绝前后端开关不一致或缺少白名单的配置。

## 说明

PRD 中“至少 10 位目标用户”的灰度理解度与结果采纳率属于上线灰度指标，仍需在目标用户灰度阶段采集，不能由本地工程测试替代。
