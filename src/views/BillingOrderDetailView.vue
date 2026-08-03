<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ArrowLeft, Copy, Headphones, ShieldCheck } from '@lucide/vue'
import { getBillingOrder, type BillingOrder } from '@/api/billing'
import BillingStatusBadge from '@/components/billing/BillingStatusBadge.vue'
import SettingsFrame from '@/components/settings/SettingsFrame.vue'
import {
  formatBillingTime,
  formatCredits,
  paymentProviderLabel,
  purchaseIntentLabel,
  refundStatusLabel
} from '@/domain/billing'

const route = useRoute()
const order = ref<BillingOrder | null>(null)
const error = ref('')
const copied = ref(false)
const orderNo = computed(() => String(route.params.orderNo || ''))

const timeline = computed(() => {
  if (!order.value) return []
  const items = [
    { label: '订单已创建', time: order.value.createdAt, done: true },
    { label: '付款已确认', time: order.value.paidAt, done: Boolean(order.value.paidAt) },
    { label: '权益已发放', time: order.value.fulfilledAt, done: Boolean(order.value.fulfilledAt) }
  ]
  if (order.value.refundStatus) {
    items.push({
      label: order.value.refundStatus === 'SUCCEEDED' ? '退款已完成' : '退款处理中',
      time: undefined,
      done: order.value.refundStatus === 'SUCCEEDED'
    })
  }
  return items
})

onMounted(async () => {
  try {
    order.value = (await getBillingOrder(orderNo.value)).data
  } catch {
    error.value = '订单不存在或你没有权限查看。'
  }
})

async function copyOrderNo() {
  if (!order.value) return
  try {
    await navigator.clipboard.writeText(order.value.orderNo)
    copied.value = true
    window.setTimeout(() => { copied.value = false }, 1200)
  } catch {
    copied.value = false
  }
}
</script>

<template>
  <SettingsFrame>
    <section class="order-page" aria-labelledby="order-title">
      <RouterLink class="back-link" to="/settings/billing"><ArrowLeft :size="15" aria-hidden="true" />返回套餐与账单</RouterLink>
      <p v-if="error" class="order-error">{{ error }}</p>
      <template v-else-if="order">
        <header>
          <div>
            <p>订单详情</p>
            <h2 id="order-title">{{ order.product.name }}</h2>
          </div>
          <div class="order-header-actions">
            <RouterLink
              v-if="['CREATED', 'PENDING_PAYMENT'].includes(order.status)"
              class="continue-pay"
              :to="`/checkout/${order.orderNo}`"
            >继续支付</RouterLink>
            <BillingStatusBadge :status="order.status" />
          </div>
        </header>

        <div class="order-layout">
          <article class="detail-card">
            <h3>状态进度</h3>
            <ol class="timeline">
              <li v-for="item in timeline" :key="item.label" :class="{ done: item.done }">
                <span aria-hidden="true"></span>
                <div><strong>{{ item.label }}</strong><small>{{ item.time ? formatBillingTime(item.time) : '等待处理' }}</small></div>
              </li>
            </ol>
          </article>

          <article class="detail-card">
            <h3>金额与支付</h3>
            <dl>
              <div><dt>实付金额</dt><dd>{{ order.amount.formatted }}</dd></div>
              <div><dt>支付方式</dt><dd>{{ paymentProviderLabel(order.paymentProvider) }}</dd></div>
              <div><dt>支付时间</dt><dd>{{ formatBillingTime(order.paidAt) }}</dd></div>
              <div><dt>订单号</dt><dd><button type="button" @click="copyOrderNo">{{ order.orderNo }}<Copy :size="12" aria-hidden="true" />{{ copied ? '已复制' : '' }}</button></dd></div>
            </dl>
          </article>

          <article class="detail-card benefits">
            <h3>商品与权益快照</h3>
            <dl>
              <div><dt>购买类型</dt><dd>{{ purchaseIntentLabel(order.orderType) }}</dd></div>
              <div><dt>AI 额度</dt><dd>{{ formatCredits(order.product.includedCreditMicros) }}</dd></div>
              <div><dt>有效期</dt><dd>{{ order.product.validityDays ? `${order.product.validityDays} 天` : '按发布规则' }}</dd></div>
            </dl>
            <ul><li v-for="benefit in order.product.benefits" :key="benefit">{{ benefit }}</li></ul>
          </article>

          <article class="detail-card help">
            <Headphones :size="20" aria-hidden="true" />
            <div>
              <h3>退款与帮助</h3>
              <p>已使用权益可能影响退款。联系客服时只需提供订单号，无需提供支付凭据或敏感信息。</p>
            </div>
            <span v-if="order.refundStatus">退款状态：{{ refundStatusLabel(order.refundStatus) }}</span>
          </article>
        </div>

        <p class="security-note"><ShieldCheck :size="14" aria-hidden="true" />页面不展示渠道交易号、商户号、签名字段和内部账本 ID。</p>
      </template>
    </section>
  </SettingsFrame>
</template>

<style scoped>
.order-page { display: grid; width: 100%; min-width: 0; max-width: 980px; margin: 0 auto; gap: 14px; }
.back-link { display: flex; width: fit-content; align-items: center; gap: 5px; color: var(--muted-foreground); font-size: 11px; }
.order-page > header { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
.order-header-actions { display: flex; align-items: center; gap: 9px; }
.continue-pay { display: inline-grid; min-height: 34px; place-items: center; border-radius: 7px; background: var(--primary); color: white; padding: 0 12px; font-size: 11px; font-weight: 750; }
.order-page header p { margin: 0 0 3px; color: var(--muted-foreground); font-size: 10px; }
.order-page h2 { margin: 0; font-size: 25px; letter-spacing: -.03em; }
.order-layout { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.detail-card { border: 1px solid var(--border); border-radius: 11px; background: var(--surface); padding: 18px; }
.detail-card h3 { margin: 0 0 14px; font-size: 14px; }
.timeline { display: grid; gap: 0; margin: 0; padding: 0; list-style: none; }
.timeline li { position: relative; display: grid; grid-template-columns: auto 1fr; gap: 11px; min-height: 54px; color: var(--muted-foreground); }
.timeline li::after { position: absolute; top: 15px; bottom: -3px; left: 5px; width: 1px; background: var(--border); content: ''; }
.timeline li:last-child::after { display: none; }
.timeline li > span { z-index: 1; width: 11px; height: 11px; margin-top: 3px; border: 2px solid var(--border); border-radius: 50%; background: var(--surface); }
.timeline li.done > span { border-color: var(--success-strong); background: var(--success-strong); }
.timeline li.done { color: var(--foreground); }
.timeline li div { display: grid; align-content: start; gap: 3px; }
.timeline small { color: var(--muted-foreground); font-size: 10px; }
.detail-card dl { display: grid; margin: 0; }
.detail-card dl div { display: flex; justify-content: space-between; gap: 14px; border-top: 1px solid var(--border); padding: 10px 0; font-size: 11px; }
.detail-card dl div:first-child { border-top: 0; }
.detail-card dt { color: var(--muted-foreground); }
.detail-card dd { margin: 0; text-align: right; font-weight: 700; }
.detail-card dd button { display: flex; align-items: center; gap: 4px; border: 0; background: transparent; color: inherit; padding: 0; font: inherit; }
.benefits ul { margin: 10px 0 0; padding-left: 18px; color: var(--muted-foreground); font-size: 11px; }
.help { grid-column: 1 / -1; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 10px; }
.help h3 { margin-bottom: 4px; }
.help p, .help span { margin: 0; color: var(--muted-foreground); font-size: 11px; }
.security-note { display: flex; align-items: center; gap: 6px; margin: 0; color: var(--muted-foreground); font-size: 10px; }
.order-error { border-radius: 8px; background: var(--danger-soft); color: var(--danger-strong); padding: 12px; }
@media (max-width: 760px) {
  .order-page > header { align-items: flex-start; flex-direction: column; }
  .order-header-actions { width: 100%; justify-content: space-between; }
  .order-layout { grid-template-columns: 1fr; }
  .help { grid-column: auto; grid-template-columns: auto 1fr; }
  .help span { grid-column: 2; }
}

@media (max-width: 420px) {
  .detail-card { min-width: 0; padding: 16px; }
  .detail-card dl div { align-items: flex-start; flex-direction: column; gap: 5px; }
  .detail-card dd { width: 100%; overflow-wrap: anywhere; text-align: left; }
  .detail-card dd button { max-width: 100%; flex-wrap: wrap; overflow-wrap: anywhere; text-align: left; }
  .help { grid-template-columns: 1fr; }
  .help > svg { display: none; }
  .help span { grid-column: 1; }
}
</style>
