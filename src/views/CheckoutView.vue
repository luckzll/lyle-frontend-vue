<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Icon } from '@iconify/vue'
import alipayIcon from '@iconify-icons/simple-icons/alipay'
import wechatIcon from '@iconify-icons/simple-icons/wechat'
import { Check, Clock3, Copy, CreditCard, ExternalLink, Info, ShieldCheck } from '@lucide/vue'
import QRCode from 'qrcode'
import {
  createCheckout,
  closeBillingOrder,
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
const designPreview = computed(() => import.meta.env.DEV && route.query.preview === 'checkout')
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
const activeProvider = computed(() => String(checkout.value?.provider || 'ALIPAY').toUpperCase())
const paymentActionLabel = computed(() => activeProvider.value === 'ALIPAY' ? '前往支付宝支付' : '前往微信支付')
const paymentSecurityLabel = computed(() => activeProvider.value === 'ALIPAY' ? '支付宝安全支付' : '微信安全支付')
const paymentMethods = computed(() => [
  {
    id: 'ALIPAY',
    label: '支付宝',
    description: '新标签页安全支付',
    icon: alipayIcon,
    brandClass: 'alipay',
    available: activeProvider.value === 'ALIPAY'
  },
  {
    id: 'WECHAT',
    label: '微信支付',
    description: activeProvider.value === 'WECHAT' ? '扫码完成支付' : '即将支持',
    icon: wechatIcon,
    brandClass: 'wechat',
    available: activeProvider.value === 'WECHAT'
  }
])
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
  if (activeProvider.value === 'ALIPAY' && checkout.value?.action) return '点击下方按钮，将在新标签页完成支付。'
  if (activeProvider.value === 'WECHAT' && checkout.value?.action) return '请使用微信扫码完成支付。'
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
  if (designPreview.value) {
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString()
    order.value = {
      orderNo: 'L2026090308190817AFBC6C8D28',
      status: 'PENDING_PAYMENT',
      orderType: 'RENEWAL',
      productCode: 'PLAN_LITE',
      priceVersionCode: 'PLAN_LITE_202609',
      product: {
        productCode: 'PLAN_LITE',
        productType: 'PLAN',
        name: '轻享版',
        description: '适合日常聊天、写作与轻量资料处理。',
        priceVersionCode: 'PLAN_LITE_202609',
        includedCreditMicros: 1_000_000_000,
        validityDays: 30,
        benefits: ['1,000 AI 额度', '额度 30 天有效', '聊天、写作、知识库与自动化按实际用量计费', '一次性购买，不自动续费']
      },
      amount: { currency: 'CNY', payableMinor: 990, paidMinor: 0, formatted: '¥9.90' },
      paymentProvider: 'ALIPAY',
      expiresAt,
      createdAt: new Date().toISOString()
    }
    checkout.value = {
      orderNo: order.value.orderNo,
      orderStatus: 'PENDING_PAYMENT',
      provider: 'ALIPAY',
      checkoutType: 'HTML_FORM',
      action: '<form action="about:blank" method="get"></form>',
      expiresAt,
      sandbox: false
    }
    loading.value = false
    return
  }
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
  if (designPreview.value) return
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
    form.target = '_blank'
    form.rel = 'noopener noreferrer'
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

async function cancelOrder() {
  if (!order.value || !window.confirm('确认取消这个待支付订单？取消后将不能继续付款。')) return
  actionLoading.value = true
  error.value = ''
  try {
    if (designPreview.value) {
      order.value = { ...order.value, status: 'CLOSED' }
      checkout.value = null
      return
    }
    order.value = (await closeBillingOrder(order.value.orderNo)).data
    checkout.value = null
    if (pollTimer) window.clearInterval(pollTimer)
  } catch (exception: any) {
    error.value = exception?.response?.data?.message || '订单暂时无法取消，请稍后重试。'
  } finally {
    actionLoading.value = false
  }
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
      <div class="checkout-brand">
        <RouterLink to="/pricing">Lyle</RouterLink>
        <span>安全收银台</span>
      </div>
      <span class="security-label"><ShieldCheck :size="16" aria-hidden="true" />{{ paymentSecurityLabel }}</span>
    </header>

    <div v-if="loading" class="checkout-loading" aria-live="polite">正在恢复订单和支付状态…</div>
    <div v-else-if="!order" class="checkout-loading danger">
      <strong>订单无法加载</strong>
      <p>{{ error }}</p>
      <RouterLink to="/settings/billing">返回订单记录</RouterLink>
    </div>
    <section v-else class="checkout-layout">
      <article class="order-summary">
        <header class="summary-heading">
          <div>
            <p class="eyebrow">订单摘要</p>
            <h1 id="checkout-title">{{ order.product.name }}</h1>
            <p>{{ order.product.description }}</p>
          </div>
          <span class="intent-chip">{{ purchaseIntentLabel(order.orderType) }}</span>
        </header>

        <dl>
          <div><dt>AI 额度</dt><dd>{{ formatCredits(order.product.includedCreditMicros) }}</dd></div>
          <div><dt>有效期</dt><dd>{{ order.product.validityDays ? `${order.product.validityDays} 天` : '按已发布规则' }}</dd></div>
          <div><dt>购买类型</dt><dd>{{ purchaseIntentLabel(order.orderType) }}</dd></div>
        </dl>

        <ul>
          <li v-for="benefit in order.product.benefits" :key="benefit"><Check :size="15" aria-hidden="true" />{{ benefit }}</li>
        </ul>

        <footer class="summary-footer">
          <button class="order-number" type="button" @click="copyOrderNo">
            <span>订单号</span>
            <strong>{{ order.orderNo }}</strong>
            <Copy :size="14" aria-hidden="true" />
            <em v-if="copied">已复制</em>
          </button>
          <p class="refund-note"><Info :size="14" aria-hidden="true" />订单信息已同步发送至站内信，可随时查询。</p>
          <div class="amount-row">
            <span>应付金额</span>
            <strong>{{ order.amount.formatted }}</strong>
          </div>
        </footer>
      </article>

      <article class="payment-panel" aria-live="polite">
        <div class="payment-status-row">
          <BillingStatusBadge :status="order.status" />
          <span v-if="remainingSeconds > 0 && !terminal" class="status-countdown">
            <Clock3 :size="14" aria-hidden="true" />{{ remainingText }}
          </span>
        </div>
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
          <template v-else-if="checkout?.action">
            <section class="payment-methods" aria-labelledby="payment-method-title">
              <div class="section-label">
                <span id="payment-method-title">支付方式</span>
                <small>安全加密</small>
              </div>
              <div class="method-list">
                <button
                  v-for="method in paymentMethods"
                  :key="method.id"
                  type="button"
                  class="method-option"
                  :class="{ selected: method.id === activeProvider, unavailable: !method.available }"
                  :disabled="!method.available"
                  :aria-pressed="method.id === activeProvider"
                >
                  <span class="method-logo" :class="method.brandClass"><Icon :icon="method.icon" aria-hidden="true" /></span>
                  <span class="method-copy"><strong>{{ method.label }}</strong><small>{{ method.description }}</small></span>
                  <span v-if="method.id === activeProvider" class="selected-dot"><Check :size="13" aria-hidden="true" /></span>
                </button>
              </div>
            </section>
            <div class="trust-strip"><ShieldCheck :size="18" aria-hidden="true" />支付结果由服务端安全确认</div>
            <button type="button" class="pay-action" @click="openPayment">
              {{ paymentActionLabel }}<ExternalLink :size="17" aria-hidden="true" />
            </button>
          </template>
          <div v-else class="credential-placeholder">等待支付渠道返回凭据</div>
        </div>

        <p
          v-if="checkout?.provider === 'ALIPAY' && checkout.checkoutType === 'HTML_FORM' && checkout.action"
          class="payment-exit-hint"
        ><Info :size="14" aria-hidden="true" />支付宝将在新标签页打开；不想付款时关闭支付宝标签页，返回此页选择“稍后支付”或“取消订单”。</p>

        <div v-if="remainingSeconds > 0 && !terminal" class="countdown">
          <Clock3 :size="15" aria-hidden="true" />订单将在 <strong>{{ remainingText }}</strong> 后关闭
        </div>

        <p v-if="error" class="checkout-error" role="alert">{{ error }}</p>

        <div class="payment-actions">
          <button
            v-if="['CREATED', 'PENDING_PAYMENT', 'PAID', 'FULFILLING'].includes(order.status)"
            class="verify-payment"
            type="button"
            :disabled="actionLoading"
            @click="checkPayment"
          >{{ actionLoading ? '查询中…' : '我已完成支付，查询状态' }}</button>
          <RouterLink v-if="order.status === 'FULFILLED'" :to="{ path: `/billing/result/${order.orderNo}`, query: { returnTo } }">查看到账结果</RouterLink>
          <RouterLink v-if="order.status === 'CLOSED'" to="/pricing">返回套餐页</RouterLink>
          <button
            v-if="['CREATED', 'PENDING_PAYMENT'].includes(order.status)"
            class="secondary"
            type="button"
            :disabled="actionLoading"
            @click="payLater"
          >暂不支付，返回账单</button>
          <button
            v-if="['CREATED', 'PENDING_PAYMENT'].includes(order.status)"
            class="secondary cancel-order"
            type="button"
            :disabled="actionLoading"
            @click="cancelOrder"
          >取消订单</button>
        </div>

        <footer><ShieldCheck :size="14" aria-hidden="true" />支付结果由 Lyle 服务端确认</footer>
      </article>
    </section>
  </main>
</template>

<style scoped>
.checkout-page { width: 100%; min-width: 0; max-width: 1180px; margin: 0 auto; padding: 34px 18px 52px; }
.checkout-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 28px; }
.checkout-brand { display: flex; align-items: center; gap: 12px; }
.checkout-brand > a { color: var(--foreground); font-size: 20px; font-weight: 850; letter-spacing: -.04em; }
.checkout-brand > span { border-left: 1px solid var(--border); color: var(--muted-foreground); padding-left: 12px; font-size: 12px; }
.security-label { display: flex; align-items: center; gap: 7px; color: var(--muted-foreground); font-size: 12px; }
.security-label svg { color: var(--primary); }
.checkout-loading { border: 1px solid var(--border); border-radius: 16px; background: var(--surface); padding: 42px; text-align: center; }
.checkout-loading.danger { border-color: var(--danger-border); }
.checkout-layout { display: grid; grid-template-columns: minmax(0, 1.08fr) minmax(390px, .92fr); overflow: hidden; border: 1px solid var(--border); border-radius: 18px; background: var(--surface); box-shadow: 0 18px 44px rgb(15 23 42 / 7%); }
.order-summary, .payment-panel { min-height: 700px; background: var(--surface); padding: 36px 38px; }
.order-summary { display: flex; flex-direction: column; border-right: 1px solid var(--border); }
.summary-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; }
.summary-heading > div { min-width: 0; }
.eyebrow { margin: 0 0 10px; color: var(--primary); font-size: 11px; font-weight: 800; letter-spacing: .12em; }
.order-summary h1 { margin: 0; color: var(--foreground); font-size: 36px; font-weight: 780; letter-spacing: -.045em; }
.summary-heading p:not(.eyebrow) { max-width: 30rem; margin: 12px 0 0; color: var(--muted-foreground); font-size: 14px; line-height: 1.65; }
.intent-chip { flex: 0 0 auto; margin-top: 46px; border-radius: 8px; background: var(--surface-muted); color: var(--foreground); padding: 7px 10px; font-size: 12px; font-weight: 700; }
.order-summary dl { display: grid; gap: 0; margin: 34px 0 0; }
.order-summary dl div { display: flex; justify-content: space-between; gap: 16px; border-bottom: 1px solid var(--border); padding: 14px 0; }
.order-summary dt { color: var(--muted-foreground); font-size: 13px; }
.order-summary dd { margin: 0; color: var(--foreground); font-size: 13px; font-weight: 750; }
.order-summary ul { display: grid; gap: 14px; margin: 34px 0 0; padding: 0; list-style: none; }
.order-summary li { display: flex; gap: 10px; color: var(--muted-foreground); font-size: 13px; line-height: 1.5; }
.order-summary li svg { color: var(--success-strong); }
.summary-footer { margin-top: auto; padding-top: 34px; }
.order-number { display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto; align-items: center; gap: 8px; width: 100%; border: 0; border-top: 1px solid var(--border); background: transparent; color: var(--muted-foreground); padding: 20px 0 0; text-align: left; font-size: 11px; }
.order-number strong { overflow: hidden; color: var(--muted-foreground); font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }
.order-number em { color: var(--success-strong); font-style: normal; }
.refund-note { display: flex; align-items: flex-start; gap: 7px; margin: 12px 0 0; color: var(--muted-foreground); font-size: 11px; line-height: 1.5; }
.amount-row { display: flex; align-items: baseline; justify-content: space-between; margin-top: 26px; border-top: 1px solid var(--border); padding-top: 22px; }
.amount-row span { color: var(--muted-foreground); font-size: 15px; }
.amount-row strong { color: var(--foreground); font-size: 34px; letter-spacing: -.04em; }
.payment-panel { display: flex; flex-direction: column; background: color-mix(in srgb, var(--surface-muted) 34%, var(--surface)); }
.payment-status-row { display: flex; align-items: center; justify-content: space-between; min-height: 28px; }
.status-countdown { display: flex; align-items: center; gap: 6px; color: var(--muted-foreground); font-size: 11px; font-variant-numeric: tabular-nums; }
.payment-state { display: grid; justify-items: center; margin: 28px 0 22px; text-align: center; }
.payment-icon { display: grid; width: 64px; height: 64px; place-items: center; border-radius: 18px; background: var(--primary-soft); color: var(--primary); }
.payment-icon.success { background: var(--success-soft); color: var(--success-strong); }
.payment-state h2 { margin: 18px 0 7px; color: var(--foreground); font-size: 26px; letter-spacing: -.03em; }
.payment-state p { min-height: 42px; margin: 0; color: var(--muted-foreground); font-size: 13px; line-height: 1.6; }
.payment-credential { display: grid; gap: 14px; }
.sandbox-box { text-align: center; }
.sandbox-box strong { color: var(--warning-strong); }
.sandbox-box p { margin: 6px 0 0; color: var(--muted-foreground); font-size: 11px; line-height: 1.5; }
.wechat-qr { display: grid; justify-items: center; gap: 8px; text-align: center; }
.wechat-qr img { width: 224px; height: 224px; border: 8px solid white; border-radius: 8px; background: white; box-shadow: 0 1px 2px rgb(16 24 40 / 8%); }
.wechat-qr strong { color: var(--foreground); font-size: 13px; }
.wechat-qr span { color: var(--muted-foreground); font-size: 10px; line-height: 1.5; }
.credential-placeholder { display: grid; min-height: 118px; place-items: center; border: 1px dashed var(--border); border-radius: 12px; color: var(--muted-foreground); font-size: 12px; }
.payment-methods { display: grid; gap: 9px; }
.section-label { display: flex; align-items: center; justify-content: space-between; color: var(--foreground); font-size: 12px; font-weight: 750; }
.section-label small { color: var(--muted-foreground); font-size: 10px; font-weight: 500; }
.method-list { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; }
.method-option { position: relative; display: grid; grid-template-columns: 34px 1fr auto; align-items: center; gap: 10px; min-width: 0; border: 1px solid var(--border); border-radius: 11px; background: var(--surface); color: var(--foreground); padding: 11px; text-align: left; transition: border-color 140ms ease, box-shadow 140ms ease; }
.method-option.selected { border-color: color-mix(in srgb, var(--primary) 58%, white); box-shadow: 0 0 0 2px color-mix(in srgb, var(--primary) 10%, transparent); }
.method-option.unavailable { cursor: not-allowed; opacity: .5; }
.method-logo { display: grid; width: 34px; height: 34px; place-items: center; border-radius: 9px; color: white; font-size: 20px; }
.method-logo.alipay { background: #1677ff; }
.method-logo.wechat { background: #07c160; }
.method-copy { display: grid; gap: 3px; min-width: 0; }
.method-copy strong { font-size: 12px; }
.method-copy small { overflow: hidden; color: var(--muted-foreground); font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
.selected-dot { display: grid; width: 20px; height: 20px; place-items: center; border-radius: 999px; background: var(--primary); color: white; }
.trust-strip { display: flex; align-items: center; justify-content: center; gap: 8px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); color: var(--muted-foreground); padding: 12px; font-size: 11px; }
.trust-strip svg { color: var(--primary); }
.pay-action { display: flex; align-items: center; justify-content: center; gap: 10px; min-height: 52px; border: 0; border-radius: 10px; background: var(--primary); color: white; padding: 0 20px; font-size: 14px; font-weight: 750; cursor: pointer; box-shadow: 0 8px 18px color-mix(in srgb, var(--primary) 24%, transparent); transition: transform 140ms ease, box-shadow 140ms ease; }
.pay-action:hover { box-shadow: 0 11px 24px color-mix(in srgb, var(--primary) 30%, transparent); transform: translateY(-1px); }
.pay-action:focus-visible { outline: 3px solid color-mix(in srgb, var(--primary) 28%, transparent); outline-offset: 2px; }
.payment-exit-hint { display: flex; align-items: flex-start; gap: 7px; margin: 12px 0 0; border-radius: 9px; background: var(--primary-soft); color: var(--muted-foreground); padding: 10px 12px; font-size: 10px; line-height: 1.55; }
.payment-exit-hint svg { flex: 0 0 auto; margin-top: 1px; color: var(--primary); }
.countdown { display: flex; align-items: center; justify-content: center; gap: 6px; margin-top: 13px; color: var(--muted-foreground); font-size: 11px; }
.countdown strong { color: var(--primary); font-variant-numeric: tabular-nums; }
.checkout-error { border-radius: 8px; background: var(--danger-soft); color: var(--danger-strong); padding: 10px; font-size: 11px; }
.payment-actions { display: grid; gap: 8px; margin-top: auto; padding-top: 22px; }
.payment-actions button, .payment-actions a { display: grid; min-height: 42px; place-items: center; border: 1px solid transparent; border-radius: 9px; background: var(--primary); color: white; font-size: 12px; font-weight: 700; }
.payment-actions .verify-payment { border-color: var(--border); background: transparent; color: var(--muted-foreground); }
.payment-actions .secondary { border: 1px solid var(--border); background: var(--surface); color: var(--foreground); }
.payment-actions .cancel-order { min-height: 34px; border: 0; background: transparent; color: var(--danger-strong); }
.payment-panel footer { display: flex; justify-content: center; gap: 6px; margin-top: 16px; color: var(--muted-foreground); font-size: 10px; }
@media (max-width: 920px) {
  .checkout-page { width: 100%; max-width: 620px; padding: 24px 14px 44px; }
  .checkout-layout { display: flex; flex-direction: column-reverse; }
  .order-summary, .payment-panel { min-height: auto; padding: 28px; }
  .order-summary { border-top: 1px solid var(--border); border-right: 0; }
  .payment-state { margin-top: 20px; }
}
@media (max-width: 520px) {
  .checkout-page { padding: 18px 10px 36px; }
  .checkout-header { margin-bottom: 18px; }
  .checkout-brand > span, .security-label { display: none; }
  .order-summary, .payment-panel { padding: 22px 18px; }
  .summary-heading { display: block; }
  .intent-chip { display: inline-flex; margin-top: 14px; }
  .method-list { grid-template-columns: 1fr; }
}
</style>
