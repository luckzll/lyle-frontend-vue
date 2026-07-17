<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ArrowLeft, ShieldCheck } from '@lucide/vue'
import { createMission, type MissionCreateInput } from '@/api/missions'
import { listProjects, listWorkspaces } from '@/api/app'
import type { Project } from '@/api/types'
import { toAppError } from '@/api/errors'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'

type Workspace = { id: number; name: string; rootPath?: string; status?: string }
const router = useRouter()
const templateId = ref<MissionCreateInput['templateId']>('project-health')
const title = ref('')
const goal = ref('')
const criteria = ref('形成有证据的周期结果\n异常能说明最后安全状态和下一步')
const forbidden = ref('不提交 Git\n不对外发送或发布\n不永久删除任何内容')
const projectId = ref<number | null>(null)
const workspaceId = ref<number | null>(null)
const projects = ref<Project[]>([])
const workspaces = ref<Workspace[]>([])
const autoMaintainTasks = ref(false)
const allowFilePatch = ref(false)
const writeRelativePath = ref('')
const writeContent = ref('')
const validityDays = ref(30)
const frequency = ref('WEEKDAYS')
const time = ref('09:00')
const dayOfWeek = ref('FRIDAY')
const loading = ref(false)
const loadingScope = ref(false)
const error = ref('')
const needsScope = computed(() => templateId.value !== 'research-weekly')
const writeTargetValid = computed(() => !allowFilePatch.value || Boolean(
  workspaceId.value && writeRelativePath.value.trim() && writeContent.value
))
const valid = computed(() => goal.value.trim().length >= 5
  && (!needsScope.value || (projectId.value && workspaceId.value))
  && validityDays.value >= 1 && validityDays.value <= 30
  && writeTargetValid.value)

onMounted(async () => {
  loadingScope.value = true
  try {
    const [projectResponse, workspaceResponse] = await Promise.all([
      listProjects('active', 100),
      listWorkspaces()
    ])
    projects.value = projectResponse.data.items
    workspaces.value = (workspaceResponse.data.items as Workspace[]).filter((item) => item.status !== 'inactive')
    projectId.value = projects.value[0]?.id ?? null
    workspaceId.value = workspaces.value[0]?.id ?? null
  } catch (exception) {
    error.value = toAppError(exception, '项目或工作区加载失败。').message
  } finally {
    loadingScope.value = false
  }
})

async function submit() {
  if (!valid.value || loading.value) return
  loading.value = true
  error.value = ''
  try {
    const input: MissionCreateInput = {
      ...(title.value.trim() ? { title: title.value.trim() } : {}),
      goal: goal.value.trim(),
      templateId: templateId.value,
      ...(projectId.value ? { projectId: projectId.value } : {}),
      ...(workspaceId.value ? { workspaceId: workspaceId.value } : {}),
      completionCriteria: criteria.value.split('\n').map((value) => value.trim()).filter(Boolean),
      forbidden: forbidden.value.split('\n').map((value) => value.trim()).filter(Boolean),
      autoMaintainTasks: autoMaintainTasks.value,
      allowFilePatch: allowFilePatch.value,
      ...(allowFilePatch.value && workspaceId.value ? {
        writeTarget: {
          workspaceId: workspaceId.value,
          relativePath: writeRelativePath.value.trim(),
          newContent: writeContent.value
        }
      } : {}),
      validityDays: validityDays.value,
      timezone: 'Asia/Shanghai',
      schedule: {
        type: 'FIXED_TIME',
        config: {
          frequency: frequency.value,
          time: time.value,
          ...(frequency.value === 'WEEKLY' ? { dayOfWeek: dayOfWeek.value } : {})
        },
        misfirePolicy: 'RUN_ONCE'
      }
    }
    const mission = (await createMission(input)).data
    await router.push(`/missions/${mission.id}/shadow`)
  } catch (exception) {
    error.value = toAppError(exception, '持续任务草稿创建失败，请检查范围后重试。').message
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="page create-page">
    <RouterLink class="back" to="/missions"><ArrowLeft :size="16" />返回持续任务</RouterLink>
    <header><span class="eyebrow">先设边界，再谈自动</span><h1>创建持续任务</h1><p>授权最长 30 天。扩大权限需要重新批准；暂停和撤销会在下一动作前生效。</p></header>
    <form @submit.prevent="submit">
      <AppCard class="form-card">
        <div class="two-columns">
          <label class="field"><span>首发模板</span><select v-model="templateId"><option value="project-health">项目健康守护</option><option value="research-weekly">持续调研周报</option><option value="release-readiness">发布准备复查</option></select></label>
          <label class="field"><span>持续天数</span><input v-model.number="validityDays" type="number" min="1" max="30" /></label>
        </div>
        <label class="field"><span>名称 <small>可选</small></span><input v-model="title" maxlength="255" placeholder="例如：Lyle 项目工作日健康守护" /></label>
        <label class="field"><span>持续目标</span><textarea v-model="goal" rows="5" maxlength="10000" placeholder="例如：每个工作日上午检查项目测试、未完成任务和文档缺口；可以创建一个内部跟进任务，但不要修改代码或联系任何人。" autofocus /></label>
        <label class="field"><span>完成标准 <small>每行一条</small></span><textarea v-model="criteria" rows="3" /></label>
        <div class="two-columns">
          <label class="field"><span>目标项目 <small>{{ needsScope ? '必选' : '可选' }}</small></span><select v-model="projectId" :disabled="loadingScope"><option :value="null">不绑定项目</option><option v-for="project in projects" :key="project.id" :value="project.id">{{ project.name }}</option></select></label>
          <label class="field"><span>授权工作区 <small>{{ needsScope ? '必选' : '可选' }}</small></span><select v-model="workspaceId" :disabled="loadingScope"><option :value="null">不访问工作区</option><option v-for="workspace in workspaces" :key="workspace.id" :value="workspace.id">{{ workspace.name }}{{ workspace.rootPath ? ` · ${workspace.rootPath}` : '' }}</option></select></label>
        </div>
        <fieldset>
          <legend>触发计划</legend>
          <div class="schedule-grid">
            <label class="field"><span>频率</span><select v-model="frequency"><option value="DAILY">每天</option><option value="WEEKDAYS">工作日</option><option value="WEEKLY">每周</option></select></label>
            <label v-if="frequency === 'WEEKLY'" class="field"><span>星期</span><select v-model="dayOfWeek"><option value="MONDAY">周一</option><option value="FRIDAY">周五</option><option value="SUNDAY">周日</option></select></label>
            <label class="field"><span>北京时间</span><input v-model="time" type="time" /></label>
          </div>
        </fieldset>
        <label class="toggle"><input v-model="autoMaintainTasks" type="checkbox" /><span><strong>允许创建单个项目内部任务</strong><small>属于 R1 低风险可撤销写入；仍需 Shadow Mode 命中明确规则，批量创建不会自动执行。</small></span></label>
        <label class="toggle"><input v-model="allowFilePatch" type="checkbox" /><span><strong>允许修改一个明确的工作区文件</strong><small>属于 R1 低风险可撤销写入；必须给出具体相对路径和完整新内容，且不能触碰敏感路径。</small></span></label>
        <fieldset v-if="allowFilePatch" class="write-target">
          <legend>受控文件 Patch 目标</legend>
          <label class="field"><span>工作区相对路径</span><input v-model="writeRelativePath" placeholder="例如：docs/project-status.md" /></label>
          <label class="field"><span>自动运行时写入的完整内容</span><textarea v-model="writeContent" rows="5" placeholder="请填写完整目标内容；执行前后会保存哈希和补偿快照。" /></label>
          <small v-if="!writeTargetValid" class="write-hint">必须选择工作区，并填写相对路径和完整内容。</small>
        </fieldset>
        <label class="field"><span>始终禁止 <small>每行一条</small></span><textarea v-model="forbidden" rows="4" /></label>
        <aside><ShieldCheck :size="19" /><p><strong>模型不能扩大这份授权。</strong>Java 策略层会在每次工具动作前重新检查任务状态、授权快照、当前收紧规则、资源范围与周期预算。</p></aside>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
        <footer><RouterLink to="/missions"><AppButton variant="secondary">取消</AppButton></RouterLink><AppButton type="submit" :loading="loading" :disabled="!valid">生成草稿并预演</AppButton></footer>
      </AppCard>
    </form>
  </div>
</template>

<style scoped>
.create-page { width: min(860px, 100%); margin: 0 auto; }
.back { display: inline-flex; align-items: center; gap: 6px; color: var(--muted-foreground); font-size: 13px; text-decoration: none; }
.eyebrow { color: var(--primary); font-size: 12px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
h1 { margin: 7px 0 5px; font-size: 32px; letter-spacing: -.03em; }
header p { margin: 0; color: var(--muted-foreground); line-height: 1.6; }
.form-card { display: grid; gap: var(--space-5); }
.field { display: grid; gap: var(--space-2); }
.field > span, legend { font-size: 13px; font-weight: 700; }
small { color: var(--muted-foreground); font-weight: 500; }
textarea, select, input { width: 100%; border: 1px solid var(--input); border-radius: var(--radius-md); background: var(--surface); padding: 10px 12px; color: var(--foreground); font: inherit; line-height: 1.55; }
textarea { resize: vertical; }
.two-columns, .schedule-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-4); }
.schedule-grid { grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); }
fieldset { margin: 0; border: 1px solid var(--border); border-radius: var(--radius-lg); padding: var(--space-4); }
legend { padding: 0 var(--space-2); }
.write-target { display: grid; gap: var(--space-3); }
.write-hint { color: var(--danger-strong); }
.toggle { display: flex; align-items: flex-start; gap: var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: var(--space-4); }
.toggle input { width: auto; margin-top: 3px; }
.toggle span, .toggle small { display: block; }.toggle small { margin-top: 4px; line-height: 1.5; }
aside { display: flex; align-items: flex-start; gap: var(--space-3); border: 1px solid var(--info-border); border-radius: var(--radius-lg); background: var(--info-soft); padding: var(--space-3); color: var(--info-strong); }
aside p { margin: 0; font-size: 13px; line-height: 1.55; }
footer { display: flex; justify-content: flex-end; gap: var(--space-2); } footer a { text-decoration: none; }
.error { margin: 0; color: var(--danger-strong); }
@media (max-width: 640px) { .two-columns { grid-template-columns: 1fr; } footer { position: sticky; bottom: 0; background: var(--surface); padding: var(--space-3) 0; } }
</style>
