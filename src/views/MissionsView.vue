<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Plus, RefreshCw } from '@lucide/vue'
import { listMissions, type Mission } from '@/api/missions'
import { toAppError } from '@/api/errors'
import MissionCard from '@/components/domain/mission/MissionCard.vue'
import AppButton from '@/components/ui/AppButton.vue'
import PageHeader from '@/components/layout/PageHeader.vue'
import LoadingState from '@/components/feedback/LoadingState.vue'
import ErrorState from '@/components/feedback/ErrorState.vue'
import EmptyState from '@/components/feedback/EmptyState.vue'

type View = 'active' | 'approval' | 'paused' | 'history' | 'all'
const missions = ref<Mission[]>([])
const loading = ref(false)
const error = ref('')
const view = ref<View>('active')
const tabs: Array<{ id: View; label: string }> = [
  { id: 'active', label: '运行中' },
  { id: 'approval', label: '待预演与批准' },
  { id: 'paused', label: '已暂停' },
  { id: 'history', label: '到期与撤销' },
  { id: 'all', label: '全部' }
]
const visible = computed(() => missions.value.filter((mission) => {
  if (view.value === 'active') return mission.status === 'ACTIVE'
  if (view.value === 'approval') return ['DRAFT', 'SHADOW', 'AWAITING_APPROVAL'].includes(mission.status)
  if (view.value === 'paused') return mission.status === 'PAUSED'
  if (view.value === 'history') return ['EXPIRED', 'REVOKED', 'ARCHIVED'].includes(mission.status)
  return true
}))

onMounted(load)
async function load() {
  loading.value = true
  error.value = ''
  try {
    missions.value = (await listMissions({ limit: 100 })).data.items
  } catch (exception) {
    error.value = toAppError(exception, '持续任务加载失败，请稍后重试。').message
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="page missions-page">
    <PageHeader eyebrow="V6 · 可信委托" title="持续任务" description="一次设定目标、范围、预算和有效期；Lyle 在边界内持续执行，只在异常处打断你。">
      <template #actions>
        <AppButton variant="secondary" size="icon" aria-label="刷新持续任务" :loading="loading" @click="load"><RefreshCw :size="17" /></AppButton>
        <RouterLink to="/missions/new"><AppButton><Plus :size="17" />新建持续任务</AppButton></RouterLink>
      </template>
    </PageHeader>
    <nav class="tabs" aria-label="持续任务分类">
      <button v-for="tab in tabs" :key="tab.id" :class="{ active: view === tab.id }" type="button" @click="view = tab.id">{{ tab.label }}</button>
    </nav>
    <LoadingState v-if="loading" label="正在加载持续任务" :cards="3" />
    <ErrorState v-else-if="error" title="持续任务加载失败" :message="error" @retry="load" />
    <EmptyState v-else-if="!visible.length" title="这个分类里还没有持续任务" description="从一个低风险、重复且边界清晰的目标开始。">
      <RouterLink to="/missions/new"><AppButton>创建持续任务</AppButton></RouterLink>
    </EmptyState>
    <section v-else class="mission-grid">
      <MissionCard v-for="mission in visible" :key="mission.id" :mission="mission" />
    </section>
  </div>
</template>

<style scoped>
.missions-page { width: min(1240px, 100%); margin: 0 auto; }
.tabs { display: flex; gap: var(--space-1); overflow-x: auto; border-bottom: 1px solid var(--border); }
.tabs button { border: 0; border-bottom: 2px solid transparent; background: transparent; padding: 10px 12px; color: var(--muted-foreground); font-size: 13px; font-weight: 650; white-space: nowrap; }
.tabs button.active { border-color: var(--primary); color: var(--primary); }
.mission-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: var(--space-4); }
a { text-decoration: none; }
@media (max-width: 640px) { .mission-grid { grid-template-columns: 1fr; } }
</style>
