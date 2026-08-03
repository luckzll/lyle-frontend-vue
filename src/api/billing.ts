import { http } from './http'

export type BillingAmount = {
  currency: string
  payableMinor: number
  paidMinor: number
  formatted: string
}

export type CatalogProduct = {
  productCode: string
  productType: 'PLAN' | 'CREDIT_PACK'
  name: string
  description?: string | null
  priceVersionCode: string
  amount: BillingAmount
  includedCreditMicros: number
  validityDays?: number | null
  benefits: string[]
  sellUntil?: string | null
}

export type BillingPlan = {
  code: string
  name: string
  status: string
  benefits: string[]
  validFrom?: string | null
  expiresAt?: string | null
  orderNo?: string | null
}

export type BillingAccount = {
  status: string
  plan: BillingPlan
  availableCreditMicros: number
  totalGrantedCreditMicros: number
  totalConsumedCreditMicros: number
  nextExpiryAt?: string | null
  commercialQuotaEnforced: boolean
  settlementMode: 'SHADOW' | 'ACTIVE'
  checkoutEnabled: boolean
}

export type BillingLedgerEntry = {
  entryType: string
  direction: 'CREDIT' | 'DEBIT'
  creditMicros: number
  balanceAfterMicros: number
  sourceType: string
  sourceId: string
  occurredAt: string
  expiresAt?: string | null
  metadata: Record<string, unknown>
}

export type BillingProductSnapshot = {
  productCode: string
  productType: 'PLAN' | 'CREDIT_PACK'
  name: string
  description?: string | null
  priceVersionCode: string
  includedCreditMicros: number
  validityDays?: number | null
  benefits: string[]
}

export type BillingOrderStatus =
  | 'CREATED'
  | 'PENDING_PAYMENT'
  | 'PAID'
  | 'FULFILLING'
  | 'FULFILLED'
  | 'CLOSED'
  | 'CANCELLED'
  | 'REFUNDING'
  | 'REFUNDED'

export type BillingOrder = {
  orderNo: string
  status: BillingOrderStatus
  orderType: 'NEW_PURCHASE' | 'RENEWAL' | 'ADD_ON'
  productCode: string
  priceVersionCode: string
  product: BillingProductSnapshot
  amount: BillingAmount
  paymentNo?: string | null
  paymentStatus?: string | null
  paymentProvider?: string | null
  refundStatus?: string | null
  expiresAt: string
  paidAt?: string | null
  fulfilledAt?: string | null
  createdAt: string
}

export type CheckoutSession = {
  orderNo: string
  orderStatus: BillingOrderStatus
  paymentNo?: string | null
  paymentStatus?: string | null
  provider: string
  checkoutType: string
  action?: string | null
  expiresAt: string
  sandbox: boolean
}

export type BillingRefund = {
  refundNo: string
  orderNo: string
  status: string
  amount: BillingAmount
  reasonCode: string
  reasonNote?: string | null
  product: BillingProductSnapshot
  succeededAt?: string | null
  createdAt: string
}

export function getBillingCatalog() {
  return http.get<CatalogProduct[]>('/billing/catalog')
}

export function getBillingAccount() {
  return http.get<BillingAccount>('/billing/account')
}

export function getBillingLedger(type?: string, limit = 50) {
  return http.get<BillingLedgerEntry[]>('/billing/account/ledger', {
    params: { ...(type ? { type } : {}), limit }
  })
}

export function getBillingOrders(limit = 50) {
  return http.get<BillingOrder[]>('/billing/orders', { params: { limit } })
}

export function getBillingOrder(orderNo: string) {
  return http.get<BillingOrder>(`/billing/orders/${encodeURIComponent(orderNo)}`)
}

export function createBillingOrder(payload: {
  priceVersionCode: string
  purchaseIntent: 'NEW_PURCHASE' | 'RENEWAL' | 'ADD_ON'
  clientRequestId: string
}) {
  return http.post<BillingOrder>('/billing/orders', payload)
}

export function createCheckout(orderNo: string) {
  return http.post<CheckoutSession>(`/billing/orders/${encodeURIComponent(orderNo)}/checkout`)
}

export function getBillingOrderStatus(orderNo: string) {
  return http.get<BillingOrder>(`/billing/orders/${encodeURIComponent(orderNo)}/status`)
}

export function closeBillingOrder(orderNo: string) {
  return http.post<BillingOrder>(`/billing/orders/${encodeURIComponent(orderNo)}/close`)
}

export function getBillingRefunds() {
  return http.get<BillingRefund[]>('/billing/refunds')
}
