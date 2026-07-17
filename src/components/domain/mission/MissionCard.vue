<script setup lang="ts">
import { ArrowRight, CalendarClock, ShieldCheck } from '@lucide/vue'
import type { Mission } from '@/api/missions'
import { formatBeijingTime } from '@/domain/date-time'
import AppCard from '@/components/ui/AppCard.vue'
import MissionStatusBadge from './MissionStatusBadge.vue'

defineProps<{ mission: Mission }>()
</script>

<template>
  <RouterLink class="mission-link" :to="`/missions/${mission.id}`">
    <AppCard interactive class="mission-card">
      <header>
        <MissionStatusBadge :status="mission.status" />
        <span class="template">{{ {
          'project-health': '项目健康守护',
          'research-weekly': '持续调研周报',
          'release-readiness': '发布准备复查'
        }[mission.templateId] }}</span>
      </header>
      <div class="body">
        <h2>{{ mission.title }}</h2>
        <p>{{ mission.goal }}</p>
      </div>
      <dl>
        <div><dt><CalendarClock :size="15" />下次运行</dt><dd>{{ formatBeijingTime(mission.nextRunAt, mission.status === 'ACTIVE' ? '等待事件或计划时间' : '未安排') }}</dd></div>
        <div><dt><ShieldCheck :size="15" />当前授权</dt><dd>{{ mission.activeGrantVersion ? `v${mission.activeGrantVersion}` : '尚未批准' }} · {{ formatBeijingTime(mission.expiresAt, '有效期未知') }}</dd></div>
      </dl>
      <footer>
        <span v-if="mission.latestRun">最近运行：{{ mission.latestRun.status }}</span>
        <span v-else>尚未产生运行</span>
        <ArrowRight :size="17" aria-hidden="true" />
      </footer>
    </AppCard>
  </RouterLink>
</template>

<style scoped>
.mission-link { color: inherit; text-decoration: none; }
.mission-card { display: grid; height: 100%; gap: var(--space-4); }
header, footer { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); }
.template { color: var(--muted-foreground); font-size: 12px; font-weight: 650; }
h2 { margin: 0; font-size: 18px; letter-spacing: -.015em; }
.body p { display: -webkit-box; margin: 7px 0 0; overflow: hidden; color: var(--muted-foreground); line-height: 1.55; -webkit-line-clamp: 3; -webkit-box-orient: vertical; }
dl { display: grid; gap: var(--space-2); margin: 0; }
dl div { display: grid; grid-template-columns: 100px 1fr; gap: var(--space-3); font-size: 12px; }
dt { display: flex; align-items: center; gap: 6px; color: var(--muted-foreground); }
dd { margin: 0; text-align: right; }
footer { border-top: 1px solid var(--border); padding-top: var(--space-3); color: var(--muted-foreground); font-size: 12px; }
</style>
