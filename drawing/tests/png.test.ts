import { describe, expect, it } from 'vitest'
import { encodePng } from '../src/png.ts'

describe('PNG encoder', () => {
  it('emits a PNG signature and encoded IDAT payload', () => {
    const png = encodePng(1, 1, Uint8ClampedArray.of(255, 0, 0, 255))
    expect(Array.from(png.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    expect(new TextDecoder().decode(png)).toContain('IHDR')
    expect(new TextDecoder().decode(png)).toContain('IDAT')
  })
})
