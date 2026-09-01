<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Check, Clock3, Copy, CreditCard, Info, ShieldCheck } from '@lucide/vue'
import QRCode from 'qrcode'
import {
  createCheckout,
  getBillingOrder,
  getBillingOrderStatus,
  type BillingOrder,
  type CheckoutSession
} from '@/api/billing'
import BillingStatusBadge from '@/components/billing/BillingStatusBadge.vue'
import { formatBillingTime, formatCredits, purchaseIntentLabel, safeReturnTo } from '@/domain/billing'

const route = useRoute()
const router = useRouter()
const order = ref<BillingOrder | null>(null)
const checkout = ref<CheckoutSession | null>(null)
const loading = ref(true)
const actionLoading = ref(false)
const error = ref('')
const copied = ref(false)
const qrCodeDataUrl = ref('')
const now = ref(Date.now())
let pollTimer: number | undefined
let clockTimer: number | undefined

const orderNo = computed(() => String(route.params.orderNo || ''))
const returnTo = computed(() => safeReturnTo(route.query.returnTo, '/settings/billing'))
const remainingSeconds = computed(() => {
  const expiry = checkout.value?.expiresAt || order.value?.expiresAt
  if (!expiry) return 0
  return Math.max(0, Math.floor((new Date(expiry).getTime() - now.value) / 1000))
})
const remainingText = computed(() => {
  const minutes = Math.floor(remainingSeconds.value / 60)
  const seconds = remainingSeconds.value % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
})
const terminal = computed(() => ['FULFILLED', 'CLOSED', 'CANCELLED', 'REFUNDED'].includes(order.value?.status || ''))
const paymentActionLabel = computed(() => checkout.value?.provider === 'ALIPAY' ? '前往支付宝付款' : '前往支付')
const statusTitle = computed(() => {
  if (!order.value) return '正在准备收银台'
  if (order.value.status === 'PAID' || order.value.status === 'FULFILLING') return '付款已确认'
  if (order.value.status === 'FULFILLED') return '权益已到账'
  if (order.value.status === 'CLOSED') return '订单已关闭'
  return '完成支付'
})
const statusDescription = computed(() => {
  if (!order.value) return '请稍候'
  if (order.value.status === 'PAID' || order.value.status === 'FULFILLING') return '权益正在发放，请勿重复支付。'
  if (order.value.status === 'FULFILLED') return '套餐与 AI 额度已写入你的账户。'
  if (order.value.status === 'CLOSED') return '订单未产生扣款。'
  if (checkout.value?.sandbox) return '这是开发沙箱支付单，请由管理员确认支付结果。'
  return '请使用已配置的支付方式完成付款。'
})

onMounted(async () => {
  await prepare()
  clockTimer = window.setInterval(() => { now.value = Date.now() }, 1000)
  document.addEventListener('visibilitychange', handleVisibility)
})

onBeforeUnmount(() => {
  if (pollTimer) window.clearInterval(pollTimer)
  if (clockTimer) window.clearInterval(clockTimer)
  document.removeEventListener('visibilitychange', handleVisibility)
})

async function prepare() {
  loading.value = true
  error.value = ''
  try {
    order.value = (await getBillingOrder(orderNo.value)).data
    if (order.value.status === 'FULFILLED') {
      await goToResult()
      return
    }
    if (['CREATED', 'PENDING_PAYMENT'].includes(order.value.status)) {
      checkout.value = (await createCheckout(orderNo.value)).data
      await renderQrCode()
      startPolling()
    } else if (['PAID', 'FULFILLING'].includes(order.value.status)) {
      startPolling()
    }
  } catch (exception: any) {
    error.value = exception?.response?.data?.message || '收银台暂时不可用，订单仍会保留。'
  } finally {
    loading.value = false
  }
}

function startPolling() {
  if (pollTimer) window.clearInterval(pollTimer)
  pollTimer = window.setInterval(() => void refreshStatus(), 2000)
}

async function refreshStatus() {
  try {
    order.value = (await getBillingOrderStatus(orderNo.value)).data
    if (order.value.status === 'FULFILLED') {
      if (pollTimer) window.clearInterval(pollTimer)
      await goToResult()
    } else if (terminal.value && pollTimer) {
      window.clearInterval(pollTimer)
    }
  } catch {
    error.value = '暂时无法确认支付状态，可稍后在订单记录中查看。'
  }
}

async function checkPayment() {
  actionLoading.value = true
  error.value = ''
  try {
    await refreshStatus()
  } finally {
    actionLoading.value = false
  }
}

async function renderQrCode() {
  qrCodeDataUrl.value = ''
  const session = checkout.value
  if (session?.checkoutType !== 'QR_CODE' || !session.action) return
  try {
    qrCodeDataUrl.value = await QRCode.toDataURL(session.action, {
      width: 224,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#101828', light: '#ffffff' }
    })
  } catch {
    error.value = '微信支付二维码生成失败，请刷新页面后重试。'
  }
}

function openPayment() {
  error.value = ''
  const session = checkout.value
  if (!session?.action) {
    error.value = '支付凭据尚未生成，请刷新页面后重试。'
    return
  }
  if (session.checkoutType === 'HTML_FORM') {
    const host = document.createElement('div')
    host.hidden = true
    host.setAttribute('aria-hidden', 'true')
    host.innerHTML = session.action
    document.body.appendChild(host)
    const form = host.querySelector<HTMLFormElement>('form')
    if (!form) {
      host.remove()
      error.value = '支付宝支付表单无效，请刷新页面后重试。'
      return
    }
    form.submit()
    window.setTimeout(() => host.remove(), 5000)
    return
  }
  try {
    const target = new URL(session.action, window.location.origin)
    if (!['http:', 'https:'].includes(target.protocol)) throw new Error('unsupported protocol')
    window.location.assign(target.toString())
  } catch {
    error.value = '支付跳转地址无效，请刷新页面后重试。'
  }
}

async function payLater() {
  if (pollTimer) window.clearInterval(pollTimer)
  await router.push('/settings/billing')
}

async function copyOrderNo() {
  try {
    await navigator.clipboard.writeText(orderNo.value)
    copied.value = true
    window.setTimeout(() => { copied.value = false }, 1200)
  } catch {
    copied.value = false
  }
}

function handleVisibility() {
  if (document.visibilityState === 'visible') void refreshStatus()
}

function goToResult() {
  return router.replace({
    path: `/billing/result/${orderNo.value}`,
    query: { returnTo: returnTo.value }
  })
}
</script>

<template>
  <main class="checkout-page" aria-labelledby="checkout-title">
    <header class="checkout-header">
      <RouterLink to="/pricing">Lyle</RouterLink>
      <span><ShieldCheck :size="15" aria-hidden="true" />安全收银台</span>
    </header>

    <div v-if="loading" class="checkout-loading" aria-live="polite">正在恢复订单和支付状态…</div>
    <div v-else-if="!order" class="checkout-loading danger">
      <strong>订单无法加载</strong>
      <p>{{ error }}</p>
      <RouterLink to="/settings/billing">返回订单记录</RouterLink>
    </div>
    <section v-else class="checkout-layout">
      <article class="order-summary">
        <p class="eyebrow">订单摘要</p>
        <h1 id="checkout-title">{{ order.product.name }}</h1>
        <p>{{ order.product.description }}</p>

        <dl>
          <div><dt>购买类型</dt><dd>{{ purchaseIntentLabel(order.orderType) }}</dd></div>
          <div><dt>AI 额度</dt><dd>{{ formatCredits(order.product.includedCreditMicros) }}</dd></div>
          <div><dt>有效期</dt><dd>{{ order.product.validityDays ? `${order.product.validityDays} 天` : '按已发布规则' }}</dd></div>
        </dl>

        <ul>
          <li v-for="benefit in order.product.benefits" :key="benefit"><Check :size="15" aria-hidden="true" />{{ benefit }}</li>
        </ul>

        <div class="amount-row">
          <span>实付金额</span>
          <strong>{{ order.amount.formatted }}</strong>
        </div>

        <button class="order-number" type="button" @click="copyOrderNo">
          订单号 {{ order.orderNo }}<Copy :size="13" aria-hidden="true" />{{ copied ? '已复制' : '' }}
        </button>
        <p class="refund-note"><Info :size="14" aria-hidden="true" />已使用权益可能影响退款，具体以退款规则和人工审核为准。</p>
      </article>

      <article class="payment-panel" aria-live="polite">
        <BillingStatusBadge :status="order.status" />
        <div class="payment-state">
          <span class="payment-icon" :class="{ success: order.status === 'FULFILLED' }">
            <CreditCard :size="26" aria-hidden="true" />
          </span>
          <h2>{{ statusTitle }}</h2>
          <p>{{ statusDescription }}</p>
        </div>

        <div v-if="['CREATED', 'PENDING_PAYMENT'].includes(order.status)" class="payment-credential">
          <div v-if="checkout?.sandbox" class="sandbox-box">
            <strong>开发沙箱</strong>
            <p>此页面不提供绕过权限的“模拟成功”按钮。管理员可通过受保护的 Mock 完成接口确认支付。</p>
          </div>
          <div v-else-if="checkout?.checkoutType === 'QR_CODE' && checkout.action" class="wechat-qr">
            <img v-if="qrCodeDataUrl" :src="qrCodeDataUrl" alt="微信支付二维码" width="224" height="224" />
            <div v-else class="credential-placeholder">正在生成微信支付二维码…</div>
            <strong>请使用微信扫码支付</strong>
            <span>支付完成后本页会自动确认并发放权益</span>
          </div>
          <button v-else-if="checkout?.action" type="button" class="pay-action" @click="openPayment">{{ paymentActionLabel }}</button>
          <div v-else class="credential-placeholder">等待支付渠道返回凭据</div>
        </div>

        <div v-if="remainingSeconds > 0 && !terminal" class="countdown">
          <Clock3 :size="15" aria-hidden="true" />支付凭据剩余 {{ remainingText }}
        </div>

        <p v-if="error" class="checkout-error" role="alert">{{ error }}</p>

        <div class="payment-actions">
          <button
            v-if="['CREATED', 'PENDING_PAYMENT', 'PAID', 'FULFILLING'].includes(order.status)"
            type="button"
            :disabled="actionLoading"
            @click="checkPayment"
          >{{ actionLoading ? '查询中…' : '我已完成支付' }}</button>
          <RouterLink v-if="order.status === 'FULFILLED'" :to="{ path: `/billing/result/${order.orderNo}`, query: { returnTo } }">查看到账结果</RouterLink>
          <RouterLink v-if="order.status === 'CLOSED'" to="/pricing">返回套餐页</RouterLink>
          <button
            v-if="['CREATED', 'PENDING_PAYMENT'].includes(order.status)"
            class="secondary"
            type="button"
            :disabled="actionLoading"
            @click="payLater"
          >稍后支付</button>
        </div>

        <footer><ShieldCheck :size="14" aria-hidden="true" />前端不会根据跳转参数判断支付成功。</footer>
      </article>
    </section>
  </main>
</template>

<style scoped>
.checkout-page { width: 100%; min-width: 0; max-width: 1040px; margin: 0 auto; padding: 26px 20px 52px; }
.checkout-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; }
.checkout-header > a { color: var(--foreground); font-size: 18px; font-weight: 850; letter-spacing: -.04em; }
.checkout-header span { display: flex; align-items: center; gap: 6px; color: var(--muted-foreground); font-size: 11px; }
.checkout-loading { border: 1px solid var(--border); border-radius: 12px; background: var(--surface); padding: 34px; text-align: center; }
.checkout-loading.danger { border-color: var(--danger-border); }
.checkout-layout { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(360px, .9fr); gap: 18px; align-items: stretch; }
.order-summary, .payment-panel { border: 1px solid var(--border); border-radius: 14px; background: var(--surface); padding: 26px; box-shadow: var(--shadow-sm); }
.eyebrow { margin: 0 0 6px; color: var(--primary); font-size: 10px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; }
.order-summary h1 { margin: 0; font-size: 30px; letter-spacing: -.035em; }
.order-summary > p:not(.eyebrow):not(.refund-note) { color: var(--muted-foreground); font-size: 13px; }
.order-summary dl { display: grid; gap: 9px; margin: 24px 0; }
.order-summary dl div { display: flex; justify-content: space-between; gap: 16px; border-bottom: 1px solid var(--border); padding-bottom: 9px; }
.order-summary dt { color: var(--muted-foreground); font-size: 12px; }
.order-summary dd { margin: 0; font-size: 12px; font-weight: 700; }
.order-summary ul { display: grid; gap: 8px; padding: 0; list-style: none; }
.order-summary li { display: flex; gap: 7px; color: var(--muted-foreground); font-size: 12px; }
.order-summary li svg { color: var(--success-strong); }
.amount-row { display: flex; align-items: baseline; justify-content: space-between; margin-top: 28px; border-top: 1px solid var(--border); padding-top: 18px; }
.amount-row span { color: var(--muted-foreground); font-size: 12px; }
.amount-row strong { font-size: 28px; letter-spacing: -.035em; }
.order-number { display: flex; align-items: center; gap: 5px; margin-top: 16px; border: 0; background: transparent; color: var(--muted-foreground); padding: 0; font-size: 10px; }
.refund-note { display: flex; align-items: flex-start; gap: 6px; color: var(--muted-foreground); font-size: 10px; }
.payment-panel { display: flex; flex-direction: column; }
.payment-state { display: grid; justify-items: center; margin: 32px 0 20px; text-align: center; }
.payment-icon { display: grid; width: 62px; height: 62px; place-items: center; border-radius: 16px; background: var(--primary-soft); color: var(--primary); }
.payment-icon.success { background: var(--success-soft); color: var(--success-strong); }
.payment-state h2 { margin: 16px 0 5px; font-size: 23px; }
.payment-state p { min-height: 38px; margin: 0; color: var(--muted-foreground); font-size: 12px; line-height: 1.55; }
.payment-credential { display: grid; min-height: 128px; place-items: center; border: 1px dashed var(--border); border-radius: 10px; background: var(--surface-muted); padding: 16px; }
.sandbox-box { text-align: center; }
.sandbox-box strong { color: var(--warning-strong); }
.sandbox-box p { margin: 6px 0 0; color: var(--muted-foreground); font-size: 11px; line-height: 1.5; }
.wechat-qr { display: grid; justify-items: center; gap: 8px; text-align: center; }
.wechat-qr img { width: 224px; height: 224px; border: 8px solid white; border-radius: 8px; background: white; box-shadow: 0 1px 2px rgb(16 24 40 / 8%); }
.wechat-qr strong { color: var(--foreground); font-size: 13px; }
.wechat-qr span { color: var(--muted-foreground); font-size: 10px; line-height: 1.5; }
.credential-placeholder { color: var(--muted-foreground); font-size: 12px; }
.pay-action { display: grid; min-height: 42px; place-items: center; border: 0; border-radius: 8px; background: var(--primary); color: white; padding: 0 18px; font-weight: 700; cursor: pointer; }
.countdown { display: flex; align-items: center; justify-content: center; gap: 6px; margin-top: 12px; color: var(--muted-foreground); font-size: 11px; }
.checkout-error { border-radius: 8px; background: var(--danger-soft); color: var(--danger-strong); padding: 10px; font-size: 11px; }
.payment-actions { display: grid; gap: 8px; margin-top: auto; padding-top: 20px; }
.payment-actions button, .payment-actions a { display: grid; min-height: 42px; place-items: center; border: 0; border-radius: 8px; background: var(--primary); color: white; font-size: 12px; font-weight: 750; }
.payment-actions .secondary { border: 1px solid var(--border); background: var(--surface); color: var(--foreground); }
.payment-panel footer { display: flex; justify-content: center; gap: 5px; margin-top: 14px; color: var(--muted-foreground); font-size: 9px; }
@media (max-width: 800px) {
  .checkout-page { width: 100%; max-width: 560px; padding: 16px 12px 40px; }
  .checkout-layout { display: flex; flex-direction: column-reverse; }
  .payment-panel, .order-summary { padding: 20px; }
  .payment-state { margin-top: 24px; }
}
</style>
