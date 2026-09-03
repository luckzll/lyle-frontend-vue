<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ArrowRight, CreditCard, Info, ReceiptText, Sparkles, Trash2, XCircle } from '@lucide/vue'
import {
  closeBillingOrder,
  deleteBillingOrder,
  getBillingRefunds,
  type BillingOrder,
  type BillingRefund
} from '@/api/billing'
import BillingStatusBadge from '@/components/billing/BillingStatusBadge.vue'
import SettingsFrame from '@/components/settings/SettingsFrame.vue'
import { formatBillingTime, formatCredits, ledgerLabel, refundStatusLabel } from '@/domain/billing'
import { useBillingStore } from '@/stores/billing'

const store = useBillingStore()
const refunds = ref<BillingRefund[]>([])
const error = ref('')
const ledgerFilter = ref('')
const busyOrderNo = ref('')

const visibleLedger = computed(() => ledgerFilter.value
  ? store.ledger.filter((entry) => {
      if (ledgerFilter.value === 'CREDIT') return entry.direction === 'CREDIT'
      if (ledgerFilter.value === 'DEBIT') return entry.direction === 'DEBIT'
      return ['EXPIRATION', 'REFUND_REVERSAL', 'CORRECTION'].includes(entry.entryType)
    })
  : store.ledger
)

onMounted(() => {
  void load()
})

async function load() {
  error.value = ''
  try {
    const [, refundResponse] = await Promise.all([store.loadDashboard(), getBillingRefunds()])
    refunds.value = refundResponse.data
  } catch {
    error.value = '当前无法加载套餐与账单，不影响已购权益使用。'
  }
}

function requestErrorMessage(exception: any, fallback: string) {
  return exception?.response?.data?.message || fallback
}

async function cancelOrder(order: BillingOrder) {
  if (!window.confirm(`确认取消“${order.product.name}”订单？取消后该支付单将不能继续付款。`)) return
  busyOrderNo.value = order.orderNo
  error.value = ''
  try {
    const updated = (await closeBillingOrder(order.orderNo)).data
    store.orders = store.orders.map((item) => item.orderNo === updated.orderNo ? updated : item)
  } catch (exception: any) {
    error.value = requestErrorMessage(exception, '订单暂时无法取消，请稍后重试。')
  } finally {
    busyOrderNo.value = ''
  }
}

async function deleteOrder(order: BillingOrder) {
  if (!window.confirm(`确认删除“${order.product.name}”订单记录？后台仍会保留必要的支付审计信息。`)) return
  busyOrderNo.value = order.orderNo
  error.value = ''
  try {
    await deleteBillingOrder(order.orderNo)
    store.orders = store.orders.filter((item) => item.orderNo !== order.orderNo)
  } catch (exception: any) {
    error.value = requestErrorMessage(exception, '订单记录暂时无法删除，请稍后重试。')
  } finally {
    busyOrderNo.value = ''
  }
}
</script>

<template>
  <SettingsFrame>
    <section class="billing-page" aria-labelledby="billing-title">
      <header class="billing-heading">
        <div>
          <h2 id="billing-title">套餐与账单</h2>
          <p>查看当前权益、AI 额度和购买记录。</p>
        </div>
        <RouterLink class="primary-link" to="/pricing">查看套餐<ArrowRight :size="15" aria-hidden="true" /></RouterLink>
      </header>

      <p v-if="error" class="billing-error" role="status">
        {{ error }}<button type="button" @click="load">重试</button>
      </p>

      <div v-if="store.status === 'loading'" class="billing-loading" aria-live="polite">正在加载套餐与账单…</div>
      <template v-else-if="store.account">
        <section class="summary-grid" aria-label="当前套餐和 AI 额度">
          <article class="summary-card plan">
            <div class="card-kicker"><CreditCard :size="16" aria-hidden="true" />当前套餐</div>
            <div class="card-title-row">
              <h3>{{ store.account.plan.name }}</h3>
              <BillingStatusBadge :status="store.account.plan.status === 'ACTIVE' ? 'FULFILLED' : store.account.plan.status" label="生效中" />
            </div>
            <p v-if="store.account.plan.expiresAt">有效期至 {{ formatBillingTime(store.account.plan.expiresAt) }}</p>
            <p v-else>免费权益持续有效，商业额度按已发布规则使用。</p>
            <ul>
              <li v-for="benefit in store.account.plan.benefits.slice(0, 3)" :key="benefit">{{ benefit }}</li>
            </ul>
            <RouterLink to="/pricing">{{ store.account.plan.code === 'FREE' ? '升级套餐' : '续期套餐' }}</RouterLink>
          </article>

          <article class="summary-card credits">
            <div class="card-kicker"><Sparkles :size="16" aria-hidden="true" />AI 额度</div>
            <p class="credit-value">{{ formatCredits(store.account.availableCreditMicros) }}</p>
            <p>当前可用 AI 额度</p>
            <div class="credit-stats">
              <span>累计获得<strong>{{ formatCredits(store.account.totalGrantedCreditMicros) }}</strong></span>
              <span>累计使用<strong>{{ formatCredits(store.account.totalConsumedCreditMicros) }}</strong></span>
            </div>
            <p v-if="store.account.nextExpiryAt" class="expiry">最近一批额度将在 {{ formatBillingTime(store.account.nextExpiryAt) }} 到期</p>
            <p v-if="store.account.settlementMode === 'SHADOW'" class="shadow-note">当前为影子结算，记录计价结果但不扣减额度。</p>
          </article>
        </section>

        <section class="billing-section" aria-labelledby="ledger-title">
          <header>
            <div>
              <h3 id="ledger-title">额度明细</h3>
              <p>免费、购买、消费、退款和修正均保留独立流水。</p>
            </div>
            <div class="filter-group" aria-label="额度明细筛选">
              <button v-for="item in [
                { value: '', label: '全部' },
                { value: 'CREDIT', label: '获得' },
                { value: 'DEBIT', label: '使用' },
                { value: 'ADJUSTMENT', label: '调整' }
              ]" :key="item.value" type="button" :aria-pressed="ledgerFilter === item.value" @click="ledgerFilter = item.value">
                {{ item.label }}
              </button>
            </div>
          </header>
          <div v-if="visibleLedger.length" class="ledger-list">
            <article v-for="(entry, index) in visibleLedger" :key="`${entry.sourceId}-${entry.entryType}-${index}`">
              <span class="ledger-icon" :class="entry.direction.toLowerCase()">
                <Sparkles :size="15" aria-hidden="true" />
              </span>
              <div>
                <strong>{{ ledgerLabel(entry.entryType) }}</strong>
                <span>{{ formatBillingTime(entry.occurredAt) }}</span>
              </div>
              <p :class="entry.direction.toLowerCase()">
                {{ entry.direction === 'CREDIT' ? '+' : '−' }}{{ formatCredits(entry.creditMicros) }}
                <span>余额 {{ formatCredits(entry.balanceAfterMicros) }}</span>
              </p>
            </article>
          </div>
          <div v-else class="section-empty">使用或获得 AI 额度后会显示在这里。</div>
        </section>

        <section class="billing-section" aria-labelledby="orders-title">
          <header>
            <div>
              <h3 id="orders-title">订单记录</h3>
              <p>支付状态只以服务端确认结果为准。</p>
            </div>
          </header>
          <div v-if="store.orders.length" class="order-list">
            <article v-for="order in store.orders" :key="order.orderNo" class="order-row">
              <RouterLink class="order-main" :to="`/settings/billing/orders/${order.orderNo}`">
                <span><ReceiptText :size="18" aria-hidden="true" /></span>
                <div>
                  <strong>{{ order.product.name }}</strong>
                  <small>{{ formatBillingTime(order.createdAt) }} · {{ order.orderNo }}</small>
                </div>
                <strong class="order-amount">{{ order.amount.formatted }}</strong>
                <BillingStatusBadge :status="order.status" />
                <ArrowRight :size="16" aria-hidden="true" />
              </RouterLink>
              <div class="order-actions">
                <button
                  v-if="['CREATED', 'PENDING_PAYMENT'].includes(order.status)"
                  type="button"
                  :disabled="busyOrderNo === order.orderNo"
                  @click="cancelOrder(order)"
                ><XCircle :size="14" aria-hidden="true" />{{ busyOrderNo === order.orderNo ? '取消中…' : '取消订单' }}</button>
                <button
                  v-else-if="['CLOSED', 'CANCELLED'].includes(order.status)"
                  type="button"
                  :disabled="busyOrderNo === order.orderNo"
                  @click="deleteOrder(order)"
                ><Trash2 :size="14" aria-hidden="true" />{{ busyOrderNo === order.orderNo ? '删除中…' : '删除记录' }}</button>
              </div>
            </article>
          </div>
          <div v-else class="section-empty">还没有购买记录。<RouterLink to="/pricing">查看套餐</RouterLink></div>
        </section>

        <section class="billing-help">
          <Info :size="18" aria-hidden="true" />
          <div>
            <strong>退款与帮助</strong>
            <p>普通用户暂不提供一键退款。已使用权益可能影响退款，请携带订单号联系客服。</p>
            <p v-if="refunds.length">你有 {{ refunds.length }} 条退款记录，最新状态：{{ refundStatusLabel(refunds[0].status) }}</p>
          </div>
          <RouterLink to="/settings/usage">查看 AI 用量</RouterLink>
        </section>
      </template>
    </section>
  </SettingsFrame>
</template>

<style scoped>
.billing-page { display: grid; width: 100%; min-width: 0; max-width: 1100px; margin: 0 auto; gap: 14px; }
.billing-heading, .billing-section > header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.billing-heading h2, .billing-section h3 { margin: 0; color: var(--foreground); letter-spacing: -.025em; }
.billing-heading h2 { font-size: 24px; }
.billing-heading p, .billing-section header p { margin: 5px 0 0; color: var(--muted-foreground); font-size: 12px; }
.primary-link { display: inline-flex; min-height: 38px; align-items: center; gap: 7px; border-radius: 8px; background: var(--primary); color: white; padding: 0 14px; font-size: 12px; font-weight: 750; }
.billing-error, .billing-loading { border: 1px solid var(--border); border-radius: 8px; background: var(--surface-muted); padding: 11px 13px; color: var(--muted-foreground); font-size: 12px; }
.billing-error { display: flex; border-color: var(--warning-border); background: var(--warning-soft); color: var(--warning-strong); }
.billing-error button { margin-left: auto; border: 0; background: transparent; color: inherit; font-weight: 700; }
.summary-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.summary-card { display: flex; min-height: 240px; flex-direction: column; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); padding: 20px; box-shadow: var(--shadow-sm); }
.card-kicker { display: flex; align-items: center; gap: 7px; color: var(--muted-foreground); font-size: 11px; font-weight: 750; text-transform: uppercase; letter-spacing: .08em; }
.card-title-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 16px; }
.card-title-row h3 { margin: 0; font-size: 26px; }
.summary-card > p { color: var(--muted-foreground); font-size: 12px; }
.summary-card ul { display: grid; gap: 4px; margin: 8px 0 16px; padding-left: 18px; color: var(--muted-foreground); font-size: 12px; }
.summary-card > a { margin-top: auto; color: var(--primary); font-size: 12px; font-weight: 750; }
.credit-value { margin: 14px 0 -3px; color: var(--foreground) !important; font-size: 38px !important; font-weight: 800; letter-spacing: -.04em; }
.credit-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: auto; }
.credit-stats span { display: grid; gap: 3px; border-radius: 8px; background: var(--surface-muted); padding: 10px; color: var(--muted-foreground); font-size: 10px; }
.credit-stats strong { color: var(--foreground); font-size: 14px; }
.expiry, .shadow-note { margin-bottom: 0; }
.shadow-note { color: var(--warning-strong) !important; }
.billing-section { display: grid; gap: 12px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); padding: 17px; }
.filter-group { display: flex; border: 1px solid var(--border); border-radius: 7px; overflow: hidden; }
.filter-group button { min-height: 32px; border: 0; border-left: 1px solid var(--border); background: var(--surface); color: var(--muted-foreground); padding: 0 11px; font-size: 11px; }
.filter-group button:first-child { border-left: 0; }
.filter-group button[aria-pressed='true'] { background: var(--primary-soft); color: var(--primary); font-weight: 700; }
.ledger-list, .order-list { display: grid; }
.ledger-list article, .order-row { border-top: 1px solid var(--border); }
.ledger-list article { display: grid; align-items: center; padding: 12px 2px; }
.ledger-list article { grid-template-columns: auto minmax(0, 1fr) auto; gap: 10px; }
.ledger-list article:first-child, .order-row:first-child { border-top: 0; }
.ledger-icon, .order-main > span:first-child { display: grid; width: 32px; height: 32px; place-items: center; border-radius: 8px; background: var(--primary-soft); color: var(--primary); }
.ledger-icon.debit { background: var(--surface-muted); color: var(--muted-foreground); }
.ledger-list article > div, .ledger-list article > p, .order-main > div { display: grid; gap: 2px; margin: 0; }
.ledger-list span, .order-main small { color: var(--muted-foreground); font-size: 10px; }
.ledger-list article > p { text-align: right; color: var(--success-strong); font-size: 13px; font-weight: 750; }
.ledger-list article > p.debit { color: var(--foreground); }
.order-row { display: flex; align-items: center; gap: 10px; padding: 4px 2px; }
.order-main { display: grid; min-width: 0; flex: 1; grid-template-columns: auto minmax(0, 1fr) auto auto auto; align-items: center; gap: 12px; color: var(--foreground); padding: 8px 0; }
.order-actions button { display: inline-flex; min-height: 32px; align-items: center; gap: 5px; border: 1px solid var(--border); border-radius: 7px; background: var(--surface); color: var(--muted-foreground); padding: 0 9px; font-size: 10px; font-weight: 700; white-space: nowrap; }
.order-actions button:hover { border-color: var(--danger-border); color: var(--danger-strong); }
.order-actions button:disabled { cursor: wait; opacity: .6; }
.order-amount { font-size: 13px; }
.section-empty { border-radius: 8px; background: var(--surface-muted); padding: 18px; color: var(--muted-foreground); text-align: center; font-size: 12px; }
.billing-help { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: start; gap: 11px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface-muted); padding: 15px; }
.billing-help p { margin: 4px 0 0; color: var(--muted-foreground); font-size: 11px; }
.billing-help a { color: var(--primary); font-size: 11px; font-weight: 700; }
@media (max-width: 800px) {
  .billing-heading { align-items: stretch; flex-direction: column; }
  .primary-link { width: 100%; justify-content: center; }
  .summary-grid { grid-template-columns: 1fr; }
  .billing-section > header { display: grid; }
  .filter-group { width: 100%; }
  .filter-group button { flex: 1; }
  .order-row { align-items: stretch; flex-direction: column; gap: 0; }
  .order-main { grid-template-columns: auto minmax(0, 1fr) auto; }
  .order-actions { display: flex; justify-content: flex-end; padding: 0 0 8px 44px; }
  .order-list .order-amount { grid-column: 2; }
  .order-list :deep(.billing-status) { grid-column: 3; grid-row: 1 / span 2; }
  .order-main > svg { display: none; }
  .billing-help { grid-template-columns: auto 1fr; }
  .billing-help a { grid-column: 2; }
}

@media (max-width: 420px) {
  .summary-card { min-height: 0; padding: 16px; }
  .credit-stats { grid-template-columns: 1fr; }
  .ledger-list article { align-items: start; grid-template-columns: auto minmax(0, 1fr); }
  .ledger-list article > p { grid-column: 2; text-align: left; }
  .order-main { align-items: start; grid-template-columns: auto minmax(0, 1fr); }
  .order-list .order-amount,
  .order-list :deep(.billing-status) { grid-column: 2; grid-row: auto; justify-self: start; }
  .billing-help { grid-template-columns: 1fr; }
  .billing-help > svg { display: none; }
  .billing-help a { grid-column: 1; }
}
</style>
