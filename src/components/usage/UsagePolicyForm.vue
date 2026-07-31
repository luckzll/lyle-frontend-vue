<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ChevronRight, Info } from '@lucide/vue'
import type { UsagePolicy } from '@/api/usage'
import { formatTokens } from '@/domain/usage'

const props = defineProps<{ policy: UsagePolicy | null; saving?: boolean }>()
const emit = defineEmits<{
  save: [payload: {
    dailySoftTokenLimit: number
    dailyHardTokenLimit: number
    dailySoftCostMicros: number
    dailyHardCostMicros: number
  }]
}>()

const editing = ref(false)
const softTokens = ref(0)
const hardTokens = ref(0)
const usedPercent = computed(() => Math.min(100, Math.max(0, props.policy?.usedPercent || 0)))

watch(() => props.policy, (policy) => {
  if (!policy) return
  softTokens.value = policy.dailySoftTokenLimit
  hardTokens.value = policy.dailyHardTokenLimit
}, { immediate: true })

function save() {
  if (!props.policy) return
  emit('save', {
    dailySoftTokenLimit: Math.round(softTokens.value),
    dailyHardTokenLimit: Math.round(hardTokens.value),
    dailySoftCostMicros: props.policy.dailySoftCostMicros,
    dailyHardCostMicros: props.policy.dailyHardCostMicros
  })
  editing.value = false
}
</script>

<template>
  <article class="quota-card" :class="`status-${policy?.status?.toLowerCase() || 'loading'}`">
    <header><h3>今日额度</h3><Info :size="15" aria-label="每日 00:00 恢复" /></header>
    <div v-if="policy" class="quota-content">
      <div class="quota-total">
        <strong>{{ formatTokens(policy.usedTokens) }}</strong>
        <span>/ {{ formatTokens(policy.dailyHardTokenLimit) }} Token</span>
        <em>{{ policy.status === 'EXHAUSTED' ? '已达上限' : policy.status === 'NEAR_LIMIT' ? '接近上限' : '额度充足' }}</em>
      </div>
      <div class="quota-track"><span :style="{ width: `${usedPercent}%` }"></span></div>
      <div class="quota-meta"><span>重置时间：明日 00:00</span><strong>{{ Math.round(usedPercent) }}%</strong></div>
      <button class="quota-edit" type="button" @click="editing = !editing">调整额度 <ChevronRight :size="15" aria-hidden="true" /></button>
      <form v-if="editing" class="quota-form" @submit.prevent="save">
        <label><span>提醒阈值（Token）</span><input v-model.number="softTokens" type="number" min="1" /></label>
        <label><span>每日硬上限（Token）</span><input v-model.number="hardTokens" type="number" min="1" /></label>
        <button type="submit" :disabled="saving">{{ saving ? '保存中…' : '保存额度' }}</button>
      </form>
    </div>
    <div v-else class="quota-loading">正在读取额度…</div>
  </article>
</template>

<style scoped>
.quota-card { position: relative; min-width: 0; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); padding: 16px 18px; }
.quota-card header { display: flex; align-items: center; gap: 7px; }
.quota-card h3 { margin: 0; font-size: 14px; }
.quota-card header svg { color: var(--muted-foreground); }
.quota-content { display: grid; gap: 14px; margin-top: 24px; }
.quota-total { display: flex; align-items: baseline; gap: 5px; }
.quota-total strong { font-size: 25px; letter-spacing: -.03em; }
.quota-total span { color: var(--muted-foreground); font-size: 11px; }
.quota-total em { margin-left: auto; border-radius: 6px; background: var(--success-soft); color: var(--success-strong); padding: 5px 8px; font-size: 11px; font-style: normal; font-weight: 700; }
.status-near_limit .quota-total em { background: var(--warning-soft); color: var(--warning-strong); }
.status-exhausted .quota-total em { background: var(--danger-soft); color: var(--danger-strong); }
.quota-track { height: 7px; overflow: hidden; border-radius: 99px; background: var(--surface-muted); }
.quota-track span { display: block; height: 100%; border-radius: inherit; background: var(--primary); }
.quota-meta { display: flex; justify-content: space-between; color: var(--muted-foreground); font-size: 11px; }
.quota-edit { display: inline-flex; align-items: center; justify-self: end; gap: 3px; border: 0; background: transparent; color: var(--primary); padding: 0; font-size: 12px; font-weight: 700; }
.quota-form { display: grid; gap: 10px; border-top: 1px solid var(--border); padding-top: 14px; }
.quota-form label { display: grid; grid-template-columns: 1fr 150px; align-items: center; gap: 12px; color: var(--muted-foreground); font-size: 11px; }
.quota-form input { height: 36px; }
.quota-form button { justify-self: end; }
.quota-loading { display: grid; min-height: 170px; place-items: center; color: var(--muted-foreground); font-size: 13px; }
</style>
