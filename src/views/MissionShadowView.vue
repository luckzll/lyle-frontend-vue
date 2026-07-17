<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft, Play, ShieldCheck } from '@lucide/vue'
import { getMission, shadowMission, submitMissionApproval, type Mission, type ShadowResult } from '@/api/missions'
import { toAppError } from '@/api/errors'
import ShadowDecisionTable from '@/components/domain/mission/ShadowDecisionTable.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppCard from '@/components/ui/AppCard.vue'
import LoadingState from '@/components/feedback/LoadingState.vue'
import ErrorState from '@/components/feedback/ErrorState.vue'

const route = useRoute()
const router = useRouter()
const mission = ref<Mission | null>(null)
const shadow = ref<ShadowResult | null>(null)
const loading = ref(false)
const submitting = ref(false)
const error = ref('')
const grantVersion = computed(() => mission.value?.grants?.[0]?.version || 1)

onMounted(loadAndShadow)
async function loadAndShadow() {
  loading.value = true
  error.value = ''
  try {
    mission.value = (await getMission(String(route.params.id))).data
    if (mission.value.status === 'DRAFT' || mission.value.status === 'SHADOW') await runShadow()
  } catch (exception) {
    error.value = toAppError(exception, 'Shadow Mode 预演失败。').message
  } finally {
    loading.value = false
  }
}

async function runShadow() {
  if (!mission.value) return
  const response = (await shadowMission(mission.value.id, mission.value.version, grantVersion.value)).data
  shadow.value = response
  mission.value = response.mission
}

async function submit() {
  if (!mission.value) return
  submitting.value = true
  error.value = ''
  try {
    const next = (await submitMissionApproval(mission.value.id, mission.value.version, grantVersion.value)).data
    await router.push(`/missions/${next.id}/grant`)
  } catch (exception) {
    error.value = toAppError(exception, '提交授权批准失败，请刷新后重试。').message
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="page shadow-page">
    <RouterLink class="back" :to="`/missions/${route.params.id}`"><ArrowLeft :size="16" />返回持续任务</RouterLink>
    <header><span class="eyebrow">Shadow Mode · 不执行真实写操作</span><h1>先看看这份授权会放行什么</h1><p>预演使用真实工具目录、资源范围和策略规则，但不保证覆盖未来所有动作；正式运行仍逐动作重检。</p></header>
    <LoadingState v-if="loading" label="正在预演典型动作" :cards="3" />
    <ErrorState v-else-if="error && !mission" title="预演失败" :message="error" @retry="loadAndShadow" />
    <template v-else-if="mission && shadow">
      <section class="summary-grid">
        <AppCard><strong>{{ shadow.summary.allow }}</strong><span>边界内允许</span></AppCard>
        <AppCard><strong>{{ shadow.summary.requireConfirmation }}</strong><span>仍需单次确认</span></AppCard>
        <AppCard><strong>{{ shadow.summary.deny }}</strong><span>明确拒绝</span></AppCard>
      </section>
      <AppCard class="notice"><ShieldCheck :size="19" /><p>{{ shadow.notice }}</p></AppCard>
      <ShadowDecisionTable :decisions="shadow.decisions" />
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <footer><AppButton variant="secondary" :loading="loading" @click="runShadow"><Play :size="16" />重新预演</AppButton><AppButton :loading="submitting" @click="submit">确认预演结果，进入授权批准</AppButton></footer>
    </template>
  </div>
</template>

<style scoped>
.shadow-page { width: min(1100px, 100%); margin: 0 auto; }
.back { display: inline-flex; align-items: center; gap: 6px; color: var(--muted-foreground); font-size: 13px; text-decoration: none; }
.eyebrow { color: var(--primary); font-size: 12px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
h1 { margin: 7px 0 5px; font-size: 32px; letter-spacing: -.03em; }
header p { max-width: 760px; margin: 0; color: var(--muted-foreground); line-height: 1.6; }
.summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-3); }
.summary-grid article { display: grid; gap: 4px; text-align: center; }.summary-grid strong { font-size: 30px; }.summary-grid span { color: var(--muted-foreground); font-size: 12px; }
.notice { display: flex; align-items: flex-start; gap: var(--space-3); border-color: var(--info-border); background: var(--info-soft); color: var(--info-strong); }.notice p { margin: 0; }
footer { display: flex; justify-content: flex-end; gap: var(--space-2); }
.error { color: var(--danger-strong); }
@media (max-width: 640px) { .summary-grid { grid-template-columns: 1fr; } footer { flex-direction: column-reverse; } footer button { width: 100%; } }
</style>
