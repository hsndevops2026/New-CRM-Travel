import { describe, expect, it } from 'vitest'
import { PASSWORD_MIN_LENGTH, passwordChecks } from './passwordRules'

describe('passwordChecks', () => {
  it('fails both while empty', () => {
    expect(passwordChecks('', '').map((c) => c.ok)).toEqual([false, false])
  })
  it('passes length at exactly the minimum, not one below', () => {
    expect(passwordChecks('x'.repeat(PASSWORD_MIN_LENGTH), '')[0].ok).toBe(true)
    expect(passwordChecks('x'.repeat(PASSWORD_MIN_LENGTH - 1), '')[0].ok).toBe(false)
  })
  it('matches only when the two are identical and not empty', () => {
    expect(passwordChecks('abcdefgh', 'abcdefgh')[1].ok).toBe(true)
    expect(passwordChecks('abcdefgh', 'abcdefgH')[1].ok).toBe(false)
    expect(passwordChecks('', '')[1].ok).toBe(false)
  })
})
