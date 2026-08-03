<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { CheckCircle2, Clock3, ReceiptText, TriangleAlert } from '@lucide/vue'
import { getBillingOrderStatus, type BillingOrder } from '@/api/billing'
import BillingStatusBadge from '@/components/billing/BillingStatusBadge.vue'
import { formatBillingTime, formatCredits, safeReturnTo } from '@/domain/billing'

const route = useRoute()
const order = ref<BillingOrder | null>(null)
const error = ref('')
const orderNo = computed(() => String(route.params.orderNo || ''))
const returnTo = computed(() => safeReturnTo(route.query.returnTo, '/'))
const pending = computed(() => ['PAID', 'FULFILLING'].includes(order.value?.status || ''))
let pollTimer: number | undefined

onMounted(async () => {
  await refresh()
  if (pending.value) {
    pollTimer = window.setInterval(() => void refresh(), 2000)
  }
})

onBeforeUnmount(() => {
  if (pollTimer) window.clearInterval(pollTimer)
})

async function refresh() {
  try {
    order.value = (await getBillingOrderStatus(orderNo.value)).data
    if (!pending.value && pollTimer) window.clearInterval(pollTimer)
  } catch {
    error.value = '暂时无法确认订单状态，请稍后从订单记录查看。'
  }
}
</script>

<template>
  <main class="result-page" aria-live="polite">
    <article v-if="order" class="result-card">
      <BillingStatusBadge :status="order.status" />
      <span class="result-icon" :class="{ success: order.status === 'FULFILLED', pending }">
        <CheckCircle2 v-if="order.status === 'FULFILLED'" :size="34" aria-hidden="true" />
        <Clock3 v-else-if="pending" :size="34" aria-hidden="true" />
        <TriangleAlert v-else :size="34" aria-hidden="true" />
      </span>

      <template v-if="order.status === 'FULFILLED'">
        <h1>权益已到账</h1>
        <p>{{ order.product.name }} 已生效，新增 {{ formatCredits(order.product.includedCreditMicros) }} AI 额度。</p>
      </template>
      <template v-else-if="pending">
        <h1>付款已确认</h1>
        <p>权益正在发放，通常只需几秒。请勿重复支付。</p>
      </template>
      <template v-else>
        <h1>订单未完成</h1>
        <p>当前状态不会触发权益到账，请从订单详情查看下一步。</p>
      </template>

      <dl>
        <div><dt>商品</dt><dd>{{ order.product.name }}</dd></div>
        <div><dt>实付金额</dt><dd>{{ order.amount.formatted }}</dd></div>
        <div><dt>AI 额度</dt><dd>{{ formatCredits(order.product.includedCreditMicros) }}</dd></div>
        <div><dt>完成时间</dt><dd>{{ formatBillingTime(order.fulfilledAt || order.paidAt) }}</dd></div>
      </dl>

      <p v-if="error" class="result-error">{{ error }}</p>
      <div class="result-actions">
        <RouterLink v-if="order.status === 'FULFILLED'" :to="returnTo">返回刚才的任务</RouterLink>
        <button v-if="pending" type="button" @click="refresh">刷新到账状态</button>
        <RouterLink class="secondary" :to="`/settings/billing/orders/${order.orderNo}`">
          <ReceiptText :size="15" aria-hidden="true" />查看订单
        </RouterLink>
      </div>
      <small>返回后不会自动发送或重新执行原任务。</small>
    </article>
    <article v-else class="result-card">
      <h1>正在确认订单</h1>
      <p>{{ error || '请稍候…' }}</p>
      <RouterLink to="/settings/billing">查看订单记录</RouterLink>
    </article>
  </main>
</template>

<style scoped>
.result-page { display: grid; min-height: calc(100dvh - var(--lyle-header-height)); place-items: center; padding: 32px 20px; }
.result-card { display: grid; width: min(520px, 100%); justify-items: center; border: 1px solid var(--border); border-radius: 15px; background: var(--surface); padding: 32px; box-shadow: var(--shadow-md); text-align: center; }
.result-icon { display: grid; width: 76px; height: 76px; place-items: center; margin: 24px 0 16px; border-radius: 50%; background: var(--danger-soft); color: var(--danger-strong); }
.result-icon.success { background: var(--success-soft); color: var(--success-strong); }
.result-icon.pending { background: var(--warning-soft); color: var(--warning-strong); }
.result-card h1 { margin: 0; font-size: 28px; letter-spacing: -.035em; }
.result-card > p { max-width: 410px; color: var(--muted-foreground); font-size: 13px; line-height: 1.6; }
.result-card dl { width: 100%; margin: 22px 0; }
.result-card dl div { display: flex; justify-content: space-between; gap: 20px; border-top: 1px solid var(--border); padding: 10px 2px; font-size: 12px; }
.result-card dt { color: var(--muted-foreground); }
.result-card dd { margin: 0; font-weight: 700; }
.result-actions { display: grid; width: 100%; gap: 8px; }
.result-actions a, .result-actions button, .result-card > a { display: flex; min-height: 42px; align-items: center; justify-content: center; gap: 7px; border: 0; border-radius: 8px; background: var(--primary); color: white; font-size: 12px; font-weight: 750; }
.result-actions .secondary { border: 1px solid var(--border); background: var(--surface); color: var(--foreground); }
.result-card small { margin-top: 12px; color: var(--muted-foreground); font-size: 9px; }
.result-error { width: 100%; border-radius: 8px; background: var(--warning-soft); color: var(--warning-strong) !important; padding: 9px; }
@media (max-width: 480px) {
  .result-page { width: 100%; min-width: 0; padding: 20px 0 32px; }
  .result-card { width: 100%; min-width: 0; padding: 26px 18px; }
  .result-card dl div { align-items: flex-start; gap: 12px; text-align: left; }
  .result-card dd { overflow-wrap: anywhere; text-align: right; }
}
</style>
