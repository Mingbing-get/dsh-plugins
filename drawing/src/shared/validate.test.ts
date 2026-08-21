import { describe, expect, it } from 'vitest'

import { validateEditOperation } from './validate.ts'

describe('validateEditOperation', () => {
  it('accepts filled, outlined, and filled-and-outlined shapes', () => {
    expect(
      validateEditOperation({
        op: 'rect',
        x: 1,
        y: 2,
        w: 3,
        h: 4,
        fill: '#123456',
      }).isError,
    ).toBe(false)
    expect(
      validateEditOperation({
        op: 'ellipse',
        x: 1,
        y: 2,
        w: 3,
        h: 4,
        stroke: '#123456',
        strokeWidth: 2,
      }).isError,
    ).toBe(false)
    expect(
      validateEditOperation({
        op: 'polygon',
        points: [
          { x: 0, y: 0 },
          { x: 4, y: 0 },
          { x: 2, y: 3 },
        ],
        fill: '#ffffff',
        stroke: '#000000',
        strokeWidth: 1,
      }).isError,
    ).toBe(false)
  })

  it('rejects shapes without a style or with an invalid stroke width', () => {
    expect(validateEditOperation({ op: 'rect', x: 1, y: 2, w: 3, h: 4 }).isError).toBe(true)
    expect(
      validateEditOperation({
        op: 'ellipse',
        x: 1,
        y: 2,
        w: 3,
        h: 4,
        stroke: '#123456',
        strokeWidth: 0,
      }).isError,
    ).toBe(true)
    expect(
      validateEditOperation({
        op: 'polygon',
        points: [{ x: 0, y: 0 }],
        fill: '#ffffff',
        strokeWidth: 1,
      }).isError,
    ).toBe(true)
  })
})
