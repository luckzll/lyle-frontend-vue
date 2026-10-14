# 文档保存与附件上传

普通聊天的完整回复、项目智能体完整回复、执行中心的结果详情均提供“保存为文件”。支持真正的 Word `.docx` 与 UTF-8 Markdown `.md`。Word 保留标题、列表、表格、强调和链接；图片保留说明与原始链接，不下载嵌入远端图片。

文件在浏览器本地生成，不会为导出额外上传对话正文。支持 File System Access API 的安全页面通过系统“另存为”窗口选择位置；取消不写入，写入失败不显示成功。其它浏览器使用明确的下载入口，位置由浏览器下载设置决定。用户也可直接下载。

自动化仍在服务器定时运行并在执行中心保存结果。该导出入口保存当前结果详情（包括状态、风险和数据范围），不表示自动化已将文件写入本机。关闭网页后无值守写入本地目录、PPT 生成尚未接入。

## 上传限制与发布

- 单个附件保持 5 MiB，普通聊天单轮合计 20 MiB。
- Nginx 统一设置 `client_max_body_size 8m`，覆盖普通聊天 multipart 上传及本地项目文档 base64 请求的额外体积。
- 构建完整镜像使用 `deploy/nginx.production.conf`。增量发布使用 `deploy/Dockerfile.frontend-release-patch`，同时更新静态资源和 Nginx 配置。
- 增量构建上下文需包含 `frontend-vue/dist/` 及 `frontend-vue/deploy/nginx.production.conf`；不要只更新 dist，否则 413 修复不会生效。
- 后端仍负责认证、5 MiB 文件校验与格式解析，代理上限不替代业务校验。

## 验证入口

本地组件预览：`/.local/document-export-preview/`，使用示例数据。测试参数 `picker=cancel`、`picker=failure`、`picker=download` 仅存在于本地预览，分别模拟取消、写入失败、不支持保存位置选择。生产代码不包含这些测试替身。

定向测试：`document-export.spec.ts`、`execution-document.spec.ts`、`attachment-error.spec.ts` 与既有 `chat-attachments.spec.ts`。
