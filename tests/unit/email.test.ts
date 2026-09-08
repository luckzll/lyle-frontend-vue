import { describe, expect, it } from 'vitest'
import { isValidEmail, normalizeEmail, maskEmail } from '../../src/domain/email'
describe('provider-neutral email', () => {
  it.each(['user@qq.com','user@163.com','user@126.com','user@gmail.com','user@outlook.com','dev@company.example','name+tag@gmail.com'])('accepts %s', email => expect(isValidEmail(email)).toBe(true))
  it.each(["user@qq.co'm",'user@ qq.com','user@','user@@qq.com','a..b@qq.com','.a@qq.com','a.@qq.com'])('rejects %s', email => expect(isValidEmail(email)).toBe(false))
  it('normalizes and masks', () => { expect(normalizeEmail('  User@QQ.COM ')).toBe('user@qq.com'); expect(maskEmail('user@qq.com')).toBe('us***@qq.com') })
})
