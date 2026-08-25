import { describe, expect, it } from 'vitest'
import {
  formatCredits,
  formatBillingTime,
  ledgerLabel,
  orderStatusLabel,
  paymentProviderLabel,
  purchaseIntentLabel,
  refundStatusLabel,
  safeReturnTo
} from '@/domain/billing'

describe('V6.5 billing presentation rules', () => {
  it('formats integer credit micros without treating them as money', () => {
    expect(formatCredits(1_500_000)).toBe('1.5')
    expect(formatCredits(100_000_000)).toBe('100')
  })

  it('renders UTC ledger timestamps in Beijing time', () => {
    expect(formatBillingTime('2026-08-25T02:52:00')).toContain('10:52')
    expect(formatBillingTime('2026-08-25T02:52:00')).not.toContain('02:52')
  })

  it('keeps payment and commercial ledger language separate', () => {
    expect(orderStatusLabel('FULFILLED')).toBe('已完成')
    expect(ledgerLabel('USAGE_DEBIT')).toBe('AI 任务消耗')
    expect(ledgerLabel('REFUND_REVERSAL')).toBe('退款调整')
    expect(refundStatusLabel('SUCCEEDED')).toBe('退款成功')
    expect(refundStatusLabel('REVIEW_REQUIRED')).toBe('等待人工审核')
    expect(purchaseIntentLabel('NEW_PURCHASE')).toBe('新购')
    expect(paymentProviderLabel('MOCK')).toBe('开发沙箱')
    expect(purchaseIntentLabel('UNRECOGNIZED')).not.toContain('UNRECOGNIZED')
    expect(paymentProviderLabel('UNRECOGNIZED')).not.toContain('UNRECOGNIZED')
  })

  it('only accepts same-origin in-app return paths', () => {
    expect(safeReturnTo('/tasks?focus=7')).toBe('/tasks?focus=7')
    expect(safeReturnTo('//evil.example/steal', '/')).toBe('/')
    expect(safeReturnTo('https://evil.example/steal', '/')).toBe('/')
    expect(safeReturnTo('/login?redirect=/tasks', '/')).toBe('/')
  })
})
