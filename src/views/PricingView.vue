<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Check, CreditCard, ShieldCheck } from '@lucide/vue'
import type { CatalogProduct } from '@/api/billing'
import { formatCredits, safeReturnTo } from '@/domain/billing'
import { useBillingStore } from '@/stores/billing'

const store = useBillingStore()
const route = useRoute()
const router = useRouter()
const loading = ref(true)
const buying = ref('')
const error = ref('')

const plans = computed(() => store.catalog.filter((item) => item.productType === 'PLAN'))
const creditPacks = computed(() => store.catalog.filter((item) => item.productType === 'CREDIT_PACK'))
const returnTo = computed(() => safeReturnTo(route.query.returnTo, '/settings/billing'))

onMounted(async () => {
  try {
    await Promise.all([store.loadCatalog(), store.loadDashboard()])
  } catch {
    error.value = '套餐暂时无法加载，请稍后重试。'
  } finally {
    loading.value = false
  }
})

function pendingOrder(product: CatalogProduct) {
  return store.orders.find((order) =>
    order.priceVersionCode === product.priceVersionCode
    && ['CREATED', 'PENDING_PAYMENT'].includes(order.status)
  )
}

function isCurrent(product: CatalogProduct) {
  return product.productType === 'PLAN' && store.account?.plan.code === product.productCode
}

function cta(product: CatalogProduct) {
  if (isCurrent(product) && store.account?.plan.code === 'FREE') return '当前套餐'
  if (!store.account?.checkoutEnabled) return '支付暂未开放'
  if (pendingOrder(product)) return '继续支付'
  if (isCurrent(product)) return '续期套餐'
  if (product.productType === 'CREDIT_PACK') return '购买额度包'
  return store.account?.plan.code === 'FREE' ? '升级到 Pro' : '续期套餐'
}

async function choose(product: CatalogProduct) {
  if ((isCurrent(product) && store.account?.plan.code === 'FREE') || !store.account?.checkoutEnabled) return
  const existing = pendingOrder(product)
  if (existing) {
    await router.push({ path: `/checkout/${existing.orderNo}`, query: { returnTo: returnTo.value } })
    return
  }
  buying.value = product.priceVersionCode
  error.value = ''
  try {
    const intent = product.productType === 'CREDIT_PACK'
      ? 'ADD_ON'
      : store.account?.plan.code === 'FREE'
        ? 'NEW_PURCHASE'
        : 'RENEWAL'
    const order = await store.createOrder(product.priceVersionCode, intent)
    await router.push({ path: `/checkout/${order.orderNo}`, query: { returnTo: returnTo.value } })
  } catch (exception: any) {
    error.value = exception?.response?.data?.message || '订单创建失败，请先检查套餐是否仍可售。'
  } finally {
    buying.value = ''
  }
}
</script>

<template>
  <section class="pricing-page" aria-labelledby="pricing-title">
    <header class="pricing-hero">
      <p class="eyebrow">Lyle 套餐</p>
      <h1 id="pricing-title">选择适合你的 Lyle</h1>
      <p>单周期预付，不自动续费。AI 额度仅用于使用 Lyle 的 AI 能力，不可转让或提现。</p>
      <div v-if="store.account" class="current-summary">
        当前为 <strong>{{ store.account.plan.name }}</strong>
        <span>可用 {{ formatCredits(store.account.availableCreditMicros) }} AI 额度</span>
      </div>
    </header>

    <p v-if="error" class="pricing-alert" role="alert">{{ error }}</p>

    <section
      v-if="store.account && !store.account.checkoutEnabled"
      class="checkout-notice"
      role="status"
      aria-live="polite"
    >
      <ShieldCheck :size="20" aria-hidden="true" />
      <div>
        <strong>支付功能尚未开放</strong>
        <span>套餐和价格可正常查看，现有套餐与 AI 额度不受影响。支付渠道完成平台配置并通过验收后再开放购买。</span>
      </div>
    </section>

    <section v-if="loading" class="pricing-loading" aria-live="polite">正在加载已发布价格…</section>
    <section v-else-if="!plans.length && !creditPacks.length" class="pricing-empty">
      <CreditCard :size="28" aria-hidden="true" />
      <h2>套餐正在准备中</h2>
      <p>管理员发布价格版本后会显示在这里；页面不会使用占位价格创建订单。</p>
      <RouterLink to="/settings/billing">查看当前额度</RouterLink>
    </section>
    <template v-else>
      <section class="plan-grid" aria-label="主套餐">
        <article
          v-for="(product, index) in plans"
          :key="product.priceVersionCode"
          class="plan-card"
          :class="{ featured: index === 1 && !isCurrent(product), current: isCurrent(product) }"
        >
          <span v-if="isCurrent(product)" class="plan-tag">当前套餐</span>
          <span v-else-if="index === 1" class="plan-tag">推荐</span>
          <h2>{{ product.name }}</h2>
          <p class="plan-description">{{ product.description }}</p>
          <p class="plan-price">{{ product.amount.formatted }}</p>
          <p class="plan-period">{{ product.validityDays ? `${product.validityDays} 天有效` : '按已发布规则生效' }} · 单周期预付</p>
          <strong class="plan-credit">{{ formatCredits(product.includedCreditMicros) }} AI 额度</strong>
          <ul>
            <li v-for="benefit in product.benefits.slice(0, 5)" :key="benefit">
              <Check :size="16" aria-hidden="true" />{{ benefit }}
            </li>
          </ul>
          <button
            type="button"
            :disabled="(isCurrent(product) && store.account?.plan.code === 'FREE') || buying === product.priceVersionCode || !store.account?.checkoutEnabled"
            @click="choose(product)"
          >{{ buying === product.priceVersionCode ? '正在创建订单…' : cta(product) }}</button>
        </article>
      </section>

      <section v-if="creditPacks.length" class="credit-section" aria-labelledby="credit-pack-title">
        <div>
          <p class="eyebrow">一次性购买</p>
          <h2 id="credit-pack-title">额度包</h2>
          <p>在有效期内增加可用 AI 额度，不改变你的主套餐。</p>
        </div>
        <div class="credit-grid">
          <article v-for="product in creditPacks" :key="product.priceVersionCode" class="credit-card">
            <div>
              <strong>{{ product.name }}</strong>
              <span>{{ product.validityDays ? `${product.validityDays} 天有效` : '按发布规则有效' }}</span>
            </div>
            <p>{{ formatCredits(product.includedCreditMicros) }} AI 额度</p>
            <strong>{{ product.amount.formatted }}</strong>
            <button
              type="button"
              :disabled="buying === product.priceVersionCode || !store.account?.checkoutEnabled"
              @click="choose(product)"
            >{{ buying === product.priceVersionCode ? '创建中…' : cta(product) }}</button>
          </article>
        </div>
      </section>
    </template>

    <footer class="pricing-notes">
      <div><ShieldCheck :size="18" aria-hidden="true" /><span><strong>服务端计价</strong>订单金额与权益以已发布价格快照为准。</span></div>
      <div><CreditCard :size="18" aria-hidden="true" /><span><strong>支付可恢复</strong>页面关闭后可从套餐与账单继续待支付订单。</span></div>
    </footer>
  </section>
</template>

<style scoped>
.pricing-page { width: 100%; min-width: 0; max-width: 1120px; margin: 0 auto; padding: 48px 20px 64px; }
.pricing-hero { max-width: 720px; margin: 0 auto 30px; text-align: center; }
.eyebrow { margin: 0 0 8px; color: var(--primary); font-size: 11px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; }
.pricing-hero h1 { margin: 0; color: var(--foreground); font-size: clamp(32px, 5vw, 48px); letter-spacing: -.045em; }
.pricing-hero > p:not(.eyebrow) { color: var(--muted-foreground); line-height: 1.7; }
.current-summary { display: inline-flex; flex-wrap: wrap; justify-content: center; gap: 6px 12px; border: 1px solid var(--border); border-radius: 999px; background: var(--surface); padding: 8px 14px; color: var(--muted-foreground); font-size: 12px; }
.current-summary strong { color: var(--foreground); }
.pricing-alert, .pricing-loading, .pricing-empty { border: 1px solid var(--border); border-radius: 12px; background: var(--surface); padding: 24px; text-align: center; }
.pricing-alert { border-color: var(--danger-border); background: var(--danger-soft); color: var(--danger-strong); }
.checkout-notice { display: flex; gap: 10px; align-items: flex-start; margin: 0 0 20px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface-muted); padding: 14px 16px; color: var(--muted-foreground); font-size: 12px; line-height: 1.6; }
.checkout-notice svg { flex: 0 0 auto; color: var(--primary); }
.checkout-notice div { display: grid; gap: 2px; }
.checkout-notice strong { color: var(--foreground); font-size: 13px; }
.pricing-empty { display: grid; justify-items: center; gap: 8px; color: var(--muted-foreground); }
.pricing-empty h2, .pricing-empty p { margin: 0; }
.plan-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(270px, 1fr)); gap: 16px; align-items: stretch; }
.plan-card { position: relative; display: flex; flex-direction: column; min-height: 470px; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); padding: 25px; box-shadow: var(--shadow-sm); }
.plan-card.featured { border-color: var(--primary); box-shadow: 0 0 0 1px var(--primary), var(--shadow-md); }
.plan-card.current { background: var(--surface-muted); }
.plan-tag { position: absolute; top: 16px; right: 16px; border-radius: 999px; background: var(--primary-soft); color: var(--primary); padding: 4px 9px; font-size: 10px; font-weight: 800; }
.plan-card h2 { margin: 0 0 6px; font-size: 22px; }
.plan-description, .plan-period { color: var(--muted-foreground); font-size: 12px; }
.plan-price { margin: 22px 0 0; font-size: 36px; font-weight: 800; letter-spacing: -.04em; }
.plan-period { margin: 2px 0 18px; }
.plan-credit { color: var(--primary); }
.plan-card ul { display: grid; gap: 10px; margin: 20px 0 26px; padding: 0; list-style: none; }
.plan-card li { display: flex; gap: 8px; align-items: flex-start; color: var(--muted-foreground); font-size: 13px; }
.plan-card li svg { flex: 0 0 auto; color: var(--success-strong); }
.plan-card button, .credit-card button { min-height: 42px; margin-top: auto; border: 0; border-radius: 8px; background: var(--primary); color: white; padding: 0 16px; font-weight: 750; }
.plan-card button:disabled, .credit-card button:disabled { background: var(--surface-muted); color: var(--muted-foreground); cursor: not-allowed; }
.credit-section { display: grid; gap: 16px; margin-top: 38px; }
.credit-section h2, .credit-section p { margin: 0; }
.credit-section > div:first-child > p:last-child { color: var(--muted-foreground); }
.credit-grid { display: grid; gap: 10px; }
.credit-card { display: grid; grid-template-columns: minmax(180px, 1.2fr) 1fr auto auto; align-items: center; gap: 18px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); padding: 16px 18px; }
.credit-card div { display: grid; gap: 3px; }
.credit-card span { color: var(--muted-foreground); font-size: 11px; }
.credit-card p { color: var(--primary); font-weight: 700; }
.credit-card button { min-width: 132px; margin: 0; }
.pricing-notes { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-top: 34px; }
.pricing-notes div { display: flex; gap: 10px; border-top: 1px solid var(--border); padding-top: 16px; color: var(--muted-foreground); font-size: 12px; }
.pricing-notes strong { display: block; color: var(--foreground); }
@media (max-width: 720px) {
  .pricing-page { width: 100%; max-width: 520px; padding: 28px 12px 48px; }
  .pricing-hero { margin-bottom: 22px; }
  .pricing-hero h1 { font-size: clamp(28px, 9vw, 36px); }
  .plan-grid { grid-template-columns: minmax(0, 1fr); }
  .plan-card { min-height: 0; padding: 22px 18px; }
  .credit-card { grid-template-columns: 1fr auto; }
  .credit-card p, .credit-card > strong { margin: 0; }
  .credit-card button { grid-column: 1 / -1; width: 100%; }
  .pricing-notes { grid-template-columns: 1fr; }
}
</style>
