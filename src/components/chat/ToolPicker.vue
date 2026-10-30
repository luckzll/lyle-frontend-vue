<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import { Blocks, Check, ExternalLink, FolderOpen, LoaderCircle, RefreshCw, Terminal, Wrench, X } from '@lucide/vue'
import { getIntegrationCatalog, type IntegrationCatalog, type IntegrationPreset, type NativeWorkspace, type ToolSelection } from '@/api/integrations'
import { createMcpServer, checkMcpServer, syncMcpTools, updateMcpServerStatus } from '@/api/app'

const props = defineProps<{ modelValue: ToolSelection; disabled?: boolean; allowLocal?: boolean; localWorkspace?: NativeWorkspace | null }>()
const emit = defineEmits<{ 'update:modelValue': [value: ToolSelection]; 'update:localWorkspace': [value: NativeWorkspace | null] }>()
const panel = ref<HTMLDialogElement>(); const titleId = useId()
const data = ref<IntegrationCatalog>(); const error = ref(''); const loading = ref(false); const installing = ref('')
const tab = ref<'connected' | 'discover'>('connected'); const nativeAvailable = !!window.lyleTools
const count = computed(() => props.modelValue.mcpToolIds.length + (props.modelValue.workspaceId || props.modelValue.localCli ? 1 : 0))
const selectedWorkspace = computed(() => props.modelValue.localCli ? props.localWorkspace?.name : data.value?.workspaces.find(w => w.id === props.modelValue.workspaceId)?.name)
const message = (e: any) => String(e?.response?.data?.detail || e?.response?.data?.message || e?.message || '工具连接失败，请检查依赖和凭据。')
async function refresh() { loading.value = true; error.value = ''; try { data.value = (await getIntegrationCatalog()).data; error.value = data.value.availabilityError || '' } catch (e) { error.value = message(e) } finally { loading.value = false } }
function open() { if (props.disabled) return; panel.value?.showModal(); void refresh() }
function toggle(id: number, checked: boolean) {
  const ids = props.modelValue.mcpToolIds.filter(item => item !== id)
  if (checked && ids.length < 20) ids.push(id)
  emit('update:modelValue', { ...props.modelValue, mcpToolIds: ids })
}
function bindWorkspace(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  emit('update:modelValue', { ...props.modelValue, workspaceId: value ? Number(value) : null, localCli: false })
  emit('update:localWorkspace', null)
}
async function connectLocal() {
  error.value = ''
  try {
    const selected = await window.lyleTools?.chooseWorkspace()
    if (selected) { emit('update:localWorkspace', selected); emit('update:modelValue', { ...props.modelValue, localCli: true, workspaceId: null }) }
  } catch (e) { error.value = message(e) }
}
async function connect(preset: IntegrationPreset) {
  if (!preset.config || !preset.serverType || installing.value) return
  installing.value = preset.id; error.value = ''
  let id: number | undefined
  try {
    const response = await createMcpServer({ name: `${preset.name} · ${crypto.randomUUID().slice(0, 6)}`, serverType: preset.serverType,
      configRef: preset.config, secretRef: preset.secretRef, status: 'disabled' })
    id = Number(response.data.id)
    const health = await checkMcpServer(id)
    if (health.data.lastHealthStatus !== 'ok') throw new Error(String(health.data.lastHealthMessage || preset.requirements))
    await syncMcpTools(id)
    await updateMcpServerStatus(id, 'enabled')
    await refresh(); tab.value = 'connected'
  } catch (e) { error.value = `${message(e)}${id ? ' 已保存为停用连接，可在高级设置中修复。' : ''}` }
  finally { installing.value = '' }
}
</script>

<template>
  <button class="tools-trigger" type="button" :disabled="disabled" :aria-label="`选择工具，已选 ${count} 项`" @click="open"><Wrench :size="15" aria-hidden="true" /><span>工具</span><span v-if="count" class="tools-count">{{ count }}</span></button>
  <Teleport to="body">
    <dialog ref="panel" class="tools-dialog" :aria-labelledby="titleId" @click="($event.target === panel) && panel?.close()">
      <header><div><span class="eyebrow">对话工具</span><h2 :id="titleId">让 Lyle 直接处理任务</h2><p>选择本次对话可用的工具，结果会回到执行过程。</p></div><button class="icon" type="button" aria-label="关闭工具面板" @click="panel?.close()"><X :size="20" /></button></header>
      <nav aria-label="工具分类"><button type="button" :aria-pressed="tab === 'connected'" @click="tab = 'connected'">已连接<span>{{ data?.tools.length || 0 }}</span></button><button type="button" :aria-pressed="tab === 'discover'" @click="tab = 'discover'">发现开源工具</button><button class="refresh icon" type="button" aria-label="刷新工具" :disabled="loading" @click="refresh"><RefreshCw :size="15" /></button></nav>
      <div class="tools-body">
        <p v-if="error" class="tools-error" role="alert">{{ error }}</p>
        <p v-if="loading" class="tools-note" role="status"><LoaderCircle :size="16" />正在检查可用工具…</p>
        <template v-if="tab === 'connected'">
          <div class="section-heading"><Blocks :size="16" /><h3>连接服务</h3><span>最多选择 20 个</span></div>
          <label v-for="tool in data?.tools" :key="tool.id" class="tool-row"><input type="checkbox" :checked="modelValue.mcpToolIds.includes(tool.id)" :disabled="disabled || (!modelValue.mcpToolIds.includes(tool.id) && modelValue.mcpToolIds.length >= 20)" @change="toggle(tool.id, ($event.target as HTMLInputElement).checked)" /><div><strong>{{ tool.label }}</strong><p>{{ tool.description }}</p><small>{{ tool.riskLevel === 'read_only' ? '只读' : '操作前确认' }} · 服务端</small></div><Check v-if="modelValue.mcpToolIds.includes(tool.id)" :size="16" class="selected" /></label>
          <div v-if="!loading && !error && !data?.tools.length" class="tools-empty"><Blocks :size="25" /><strong>还没有可用的连接工具</strong><p>接入服务并通过连接检查后，就能在这里选择。</p><button type="button" @click="tab = 'discover'">浏览开源工具</button></div>
          <div class="section-heading"><Terminal :size="16" /><h3>项目命令</h3></div>
          <label class="workspace-field"><span>执行工作区</span><select :value="modelValue.workspaceId || ''" :disabled="disabled" @change="bindWorkspace"><option value="">不使用服务端命令</option><option v-for="space in data?.workspaces" :key="space.id" :value="space.id">{{ space.name }} · 服务端</option></select></label>
          <div v-if="modelValue.workspaceId" class="cli-capabilities"><span v-for="tool in data?.cli" :key="tool.name" :class="{ unavailable: !tool.available }">{{ tool.label }} · {{ tool.available ? '已安装' : `缺少 ${tool.binary}` }}</span></div>
          <button v-if="allowLocal && nativeAvailable" class="local-connect" type="button" :disabled="disabled" @click="connectLocal"><FolderOpen :size="17" /><span>{{ modelValue.localCli ? `本机命令目录：${localWorkspace?.path}` : '连接本机命令目录' }}</span></button>
          <p class="tools-note">{{ allowLocal && !nativeAvailable ? '本机终端需要新版 Windows 客户端。' : '' }}服务端工作区与本机文件目录分别授权；测试和命令会显示实际执行位置。</p>
        </template>
        <div v-else class="presets"><article v-for="preset in data?.presets" :key="preset.id" class="preset"><div class="preset-title"><component :is="preset.kind === 'mcp' ? Blocks : Terminal" :size="18" /><strong>{{ preset.name }}</strong><span>{{ preset.kind.toUpperCase() }}</span></div><p>{{ preset.description }}</p><small>{{ preset.requirements }}</small><footer><a :href="preset.repository" target="_blank" rel="noopener noreferrer">GitHub <ExternalLink :size="12" /></a><span>{{ preset.license }}</span><button v-if="preset.kind === 'mcp'" type="button" :disabled="!!installing || disabled" @click="connect(preset)">{{ installing === preset.id ? '正在连接…' : '接入并检查' }}</button></footer></article></div>
      </div>
      <footer class="tools-footer"><span>{{ count ? `已选 ${count} 项${selectedWorkspace ? ` · ${selectedWorkspace}` : ''}` : '当前仅使用内置能力' }}</span><button v-if="count" class="clear-tools" type="button" :disabled="disabled" @click="emit('update:modelValue', { mcpToolIds: [] }); emit('update:localWorkspace', null)">清除选择</button><a href="/advanced-settings?tab=mcp">管理连接</a><button type="button" @click="panel?.close()">完成</button></footer>
    </dialog>
  </Teleport>
</template>

<style scoped>
.tools-trigger{display:inline-flex;align-items:center;gap:5px;border:0;background:transparent;color:var(--muted-foreground);padding:6px 8px;min-height:34px;border-radius:8px;font-size:12px;white-space:nowrap}.tools-trigger:hover{background:var(--surface-muted);color:var(--foreground)}.tools-trigger:disabled{opacity:.5}.tools-count{border-radius:5px;padding:0 5px;background:var(--primary-soft);color:var(--primary);font-size:10px}.tools-dialog{box-sizing:border-box;width:min(620px,calc(100vw - 28px));max-height:min(780px,90dvh);padding:0;border:1px solid var(--border);border-radius:20px;background:var(--surface);color:var(--foreground);box-shadow:var(--shadow-dialog);overflow:auto}.tools-dialog::backdrop{background:var(--backdrop,rgba(15,23,42,.35))}.tools-dialog header{display:flex;justify-content:space-between;align-items:flex-start;padding:24px 24px 18px;gap:15px}.eyebrow{font-size:11px;color:var(--primary);font-weight:600}.tools-dialog h2{font-size:20px;margin:6px 0 8px;letter-spacing:-.4px}.tools-dialog header p,.tools-note{font-size:12px;line-height:1.8;color:var(--muted-foreground);margin:0}.icon{display:inline-grid;place-items:center;border:0;background:transparent;color:var(--muted-foreground);width:32px;height:32px;border-radius:8px;flex-shrink:0}.tools-dialog nav{display:flex;align-items:center;gap:5px;padding:0 24px 12px;border-bottom:1px solid var(--border)}nav button{border:0;background:transparent;color:var(--muted-foreground);padding:8px 12px;font-size:12px;border-radius:8px}nav button[aria-pressed=true]{background:var(--primary-soft);color:var(--primary);font-weight:600}nav button span{margin-left:7px;font-size:10px}.refresh{margin-left:auto}.tools-body{padding:16px 24px;min-height:200px;max-height:52dvh;overflow:auto}.section-heading{display:flex;align-items:center;gap:8px;margin:4px 0 12px}.section-heading h3{font-size:12px;margin:0}.section-heading>span{margin-left:auto;font-size:10px;color:var(--muted-foreground)}.tool-row{display:flex;gap:12px;align-items:flex-start;border:1px solid var(--border);border-radius:11px;padding:13px;margin:8px 0;cursor:pointer}.tool-row input{margin:3px 0 0;accent-color:var(--primary)}.tool-row>div{flex:1;min-width:0}.tool-row strong{font-size:12px;overflow-wrap:anywhere}.tool-row p{font-size:11px;line-height:1.7;color:var(--muted-foreground);margin:5px 0;overflow-wrap:anywhere;max-height:58px;overflow:auto}.tool-row small{font-size:10px;color:var(--muted-foreground)}.selected{color:var(--primary);flex-shrink:0}.tools-empty{display:grid;justify-items:center;text-align:center;gap:10px;background:var(--surface-muted);border-radius:12px;padding:24px 16px;margin-bottom:22px;color:var(--muted-foreground)}.tools-empty strong{font-size:13px;color:var(--foreground)}.tools-empty p{font-size:12px;margin:0}.tools-empty button,.local-connect{border:1px solid var(--border);background:var(--surface);border-radius:8px;padding:8px 12px;color:var(--foreground);font-size:12px}.workspace-field{display:grid;gap:8px;margin:14px 0;font-size:12px}.workspace-field select{width:100%;box-sizing:border-box;border:1px solid var(--border);border-radius:9px;background:var(--surface);color:var(--foreground);padding:10px}.cli-capabilities{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 12px}.cli-capabilities span{font-size:10px;padding:5px 7px;border-radius:6px;background:var(--primary-soft);color:var(--primary)}.cli-capabilities .unavailable{background:var(--surface-muted);color:var(--muted-foreground)}.local-connect{display:flex;gap:9px;align-items:center;width:100%;text-align:left;margin-bottom:10px;overflow-wrap:anywhere}.tools-note svg{vertical-align:middle}.tools-error{font-size:12px;line-height:1.8;background:var(--danger-soft);color:var(--danger);padding:12px;border-radius:9px}.presets{display:grid;gap:10px}.preset{padding:15px;border:1px solid var(--border);border-radius:12px}.preset-title{display:flex;align-items:center;gap:9px}.preset-title strong{font-size:13px}.preset-title>span{margin-left:auto;font-size:10px;color:var(--muted-foreground)}.preset>p{font-size:12px;line-height:1.8;margin:9px 0}.preset>small{font-size:11px;color:var(--muted-foreground);line-height:1.7;display:block}.preset footer{display:flex;align-items:center;gap:12px;margin-top:13px;font-size:10px}.preset a{display:inline-flex;gap:4px;align-items:center;color:var(--primary);text-decoration:none}.preset footer>span{color:var(--muted-foreground)}.preset button{margin-left:auto;font-size:11px;border:1px solid var(--primary-border);background:var(--primary-soft);color:var(--primary);border-radius:7px;padding:7px 10px}.tools-footer{position:sticky;bottom:0;display:flex;align-items:center;gap:14px;background:var(--surface);padding:16px 24px;border-top:1px solid var(--border)}.tools-footer>span{flex:1;font-size:11px;color:var(--muted-foreground);overflow-wrap:anywhere}.tools-footer a{font-size:11px;color:var(--muted-foreground);text-decoration:none;white-space:nowrap}.tools-footer button{background:var(--primary);color:var(--primary-foreground,#fff);border:0;border-radius:9px;padding:9px 18px;font-size:12px}.tools-dialog button{cursor:pointer}.tools-dialog button:disabled{opacity:.55;cursor:default}.tools-dialog :focus-visible{outline:2px solid var(--primary);outline-offset:3px}@media(max-width:640px){.tools-dialog{border-radius:16px;max-height:92dvh}.tools-dialog header{padding:20px 18px 16px}.tools-dialog nav{padding:0 18px 12px}.tools-body{padding:14px 18px;max-height:55dvh}.tools-footer{padding:14px 18px}.tools-dialog h2{font-size:18px}.tools-trigger{padding-inline:5px;font-size:11px}}
</style>
<style scoped>
.tools-dialog{margin:auto;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif}
.tools-dialog[open]{display:flex;flex-direction:column;overflow:hidden}
.tools-dialog>header,.tools-dialog>nav,.tools-footer{flex-shrink:0}
.tools-dialog .tools-body{flex:1 1 auto;min-height:0;max-height:none;overflow:auto}
.tools-dialog .tools-footer{position:static}
.tools-footer .clear-tools{background:transparent;color:var(--muted-foreground);padding:8px 0;font-size:11px;white-space:nowrap}
.tool-row input[type="checkbox"]{box-sizing:border-box;flex:0 0 16px;width:16px;min-width:16px;max-width:16px;height:16px;min-height:16px;max-height:16px;padding:0;margin:3px 0 0;appearance:auto}
</style>
