import { http } from './http'

export interface ToolSelection { mcpToolIds: number[]; workspaceId?: number | null; localCli?: boolean }
export interface IntegratedTool { id: number; name: string; label: string; description: string; riskLevel: string }
export interface IntegrationPreset { id: string; name: string; kind: 'mcp' | 'cli'; description: string; repository: string; license: string; requirements: string; serverType?: string; config?: Record<string, unknown>; secretRef?: string }
export interface IntegrationCatalog { tools: IntegratedTool[]; workspaces: { id: number; name: string }[]; cli: { name: string; label: string; available: boolean; binary: string }[]; presets: IntegrationPreset[]; availabilityError?: string }
export interface NativeWorkspace { token: string; name: string; path: string }
export interface DesktopTools {
  chooseWorkspace(): Promise<NativeWorkspace | null>
  run(token: string, name: string, args: Record<string, unknown>, requestId: string): Promise<Record<string, unknown>>
  cancel(requestId: string): Promise<void>
  disconnect(token: string): Promise<void>
}
declare global { interface Window { lyleTools?: DesktopTools } }
export const getIntegrationCatalog = () => http.get<IntegrationCatalog>('/workbench/integrations')
export const invokeIntegratedTool = (name: string, args: Record<string, unknown>, toolSelection: ToolSelection, signal: AbortSignal, sessionId: string) => http.post<Record<string, any>>('/workbench/integrations/invoke', { name, arguments: args, toolSelection, sessionId }, { signal })
export const CLI_LABELS: Record<string, string> = {
  project_git_status: '查看 Git 状态', project_git_diff: '查看代码差异', project_search: '搜索项目源码',
  project_github_issues: '查询 GitHub Issues', project_github_prs: '查询 GitHub PR', project_run_tests: '运行项目测试',
}
export const isIntegratedTool = (name: string) => /^mcp_[1-9][0-9]*$/.test(name) || Object.prototype.hasOwnProperty.call(CLI_LABELS, name)
