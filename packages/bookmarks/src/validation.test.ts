import { describe, expect, it } from 'vitest'
import { validateTagName } from './validation'

describe('bookmark validation', () => {
  it('trims and validates tag names', () => {
    expect(validateTagName('  工作  ')).toBe('工作')
    expect(() => validateTagName('')).toThrow('请输入标签名称。')
  })
})
