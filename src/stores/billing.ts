import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  createBillingOrder,
  getBillingAccount,
  getBillingCatalog,
  getBillingLedger,
  getBillingOrders,
  type BillingAccount,
  type BillingLedgerEntry,
  type BillingOrder,
  type CatalogProduct
} from '@/api/billing'

type PurchaseIntent = 'NEW_PURCHASE' | 'RENEWAL' | 'ADD_ON'

export const useBillingStore = defineStore('billing', () => {
  const catalog = ref<CatalogProduct[]>([])
  const account = ref<BillingAccount | null>(null)
  const orders = ref<BillingOrder[]>([])
  const ledger = ref<BillingLedgerEntry[]>([])
  const activeOrder = ref<BillingOrder | null>(null)
  const status = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const inFlightOrders = new Map<string, Promise<BillingOrder>>()
  let accountRequest: Promise<BillingAccount> | null = null

  async function loadCatalog() {
    catalog.value = (await getBillingCatalog()).data
    return catalog.value
  }

  async function loadAccount() {
    if (accountRequest) return accountRequest
    accountRequest = getBillingAccount()
      .then((response) => {
        account.value = response.data
        return response.data
      })
      .finally(() => {
        accountRequest = null
      })
    return accountRequest
  }

  async function loadDashboard() {
    status.value = 'loading'
    try {
      const [accountResponse, ordersResponse, ledgerResponse] = await Promise.all([
        loadAccount(),
        getBillingOrders(50),
        getBillingLedger(undefined, 50)
      ])
      account.value = accountResponse
      orders.value = ordersResponse.data
      ledger.value = ledgerResponse.data
      status.value = 'ready'
    } catch (error) {
      status.value = 'error'
      throw error
    }
  }

  function orderRequestStorageKey(priceVersionCode: string, intent: PurchaseIntent) {
    return `lyle.billing.order-request.${priceVersionCode}.${intent}`
  }

  function stableRequestId(priceVersionCode: string, intent: PurchaseIntent) {
    const key = orderRequestStorageKey(priceVersionCode, intent)
    const existing = sessionStorage.getItem(key)
    if (existing) return existing
    const requestId = crypto.randomUUID()
    sessionStorage.setItem(key, requestId)
    return requestId
  }

  function createOrder(priceVersionCode: string, intent: PurchaseIntent) {
    const key = `${priceVersionCode}:${intent}`
    const pending = inFlightOrders.get(key)
    if (pending) return pending
    const requestId = stableRequestId(priceVersionCode, intent)
    const promise = createBillingOrder({
      priceVersionCode,
      purchaseIntent: intent,
      clientRequestId: requestId
    }).then((response) => {
      activeOrder.value = response.data
      sessionStorage.removeItem(orderRequestStorageKey(priceVersionCode, intent))
      return response.data
    }).finally(() => {
      inFlightOrders.delete(key)
    })
    inFlightOrders.set(key, promise)
    return promise
  }

  return {
    catalog,
    account,
    orders,
    ledger,
    activeOrder,
    status,
    loadCatalog,
    loadAccount,
    loadDashboard,
    createOrder
  }
})
