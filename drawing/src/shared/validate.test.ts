import { describe, expect, it } from 'vitest'

import {
  validateCreateImageArguments,
  validateEditOperation,
  validateQueryImageArguments,
  validateVersionedImageArguments,
} from './validate.ts'

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
    expect(
      validateEditOperation({
        op: 'organic_blob',
        points: [
          { x: 0, y: 0 },
          { x: 4, y: 0 },
          { x: 2, y: 3 },
        ],
        smoothness: 0.8,
        fill: '#ffffff',
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
    expect(
      validateEditOperation({
        op: 'organic_blob',
        points: [
          { x: 0, y: 0 },
          { x: 4, y: 0 },
        ],
        fill: '#ffffff',
      }).isError,
    ).toBe(true)
    expect(
      validateEditOperation({
        op: 'organic_blob',
        points: [
          { x: 0, y: 0 },
          { x: 4, y: 0 },
          { x: 2, y: 3 },
        ],
        smoothness: 1.1,
        fill: '#ffffff',
      }).isError,
    ).toBe(true)
  })
})

describe('tool argument validators', () => {
  it('validates create image arguments', () => {
    expect(validateCreateImageArguments({ width: 1, height: 1 }).isError).toBe(false)
    expect(validateCreateImageArguments({ width: 0, height: 1 }).isError).toBe(true)
    expect(validateCreateImageArguments({ width: 1, height: 1, background: 'white' }).isError).toBe(
      true,
    )
  })

  it('requires bounds for region image queries', () => {
    expect(validateQueryImageArguments({ scope: 'summary' }).isError).toBe(false)
    expect(validateQueryImageArguments({ scope: 'region' }).isError).toBe(true)
    expect(
      validateQueryImageArguments({ scope: 'region', bounds: { x: 0, y: 0, w: 1, h: 1 } }).isError,
    ).toBe(false)
  })

  it('validates versioned image arguments', () => {
    expect(validateVersionedImageArguments({ expectedVersion: 0 }).isError).toBe(false)
    expect(validateVersionedImageArguments({ expectedVersion: -1 }).isError).toBe(true)
  })
})
