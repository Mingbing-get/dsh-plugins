import { describe, expect, it } from 'vitest'
import { DrawingError, createDocument, edit, undo } from '../src/raster.ts'

describe('raster document', () => {
  it('limits an edit to its requested selection and makes it one history entry', () => {
    const doc = createDocument(8, 8, 'transparent')
    edit(doc, { x: 2, y: 3, w: 3, h: 2 }, [{ op: 'fill', color: '#ff0000' }])
    expect(doc.version).toBe(2)
    expect(Array.from(doc.pixels.slice((3 * 8 + 2) * 4, (3 * 8 + 3) * 4))).toEqual([255, 0, 0, 255])
    expect(Array.from(doc.pixels.slice(0, 4))).toEqual([0, 0, 0, 0])
    undo(doc)
    expect(doc.version).toBe(3)
    expect(Array.from(doc.pixels)).toEqual(Array(8 * 8 * 4).fill(0))
  })

  it('rolls back the entire transaction if any operation is invalid', () => {
    const doc = createDocument(4, 4, '#112233')
    const before = doc.pixels.slice()
    expect(() => edit(doc, { x: 0, y: 0, w: 4, h: 4 }, [
      { op: 'fill', color: '#ffffff' },
      { op: 'fill', color: 'not-a-color' },
    ])).toThrow(DrawingError)
    expect(doc.version).toBe(1)
    expect(Array.from(doc.pixels)).toEqual(Array.from(before))
  })

  it('keeps transforms atomic and restores their previous dimensions on undo', () => {
    const doc = createDocument(3, 2, 'transparent')
    edit(doc, { x: 0, y: 0, w: 3, h: 2 }, [{ op: 'rect', x: 0, y: 0, w: 1, h: 1, color: '#ff0000' }])
    edit(doc, { x: 0, y: 0, w: 3, h: 2 }, [{ op: 'flip', axis: 'horizontal' }, { op: 'crop', x: 1, y: 0, w: 2, h: 2 }])
    expect([doc.width, doc.height]).toEqual([2, 2])
    expect(Array.from(doc.pixels.slice(4, 8))).toEqual([255, 0, 0, 255])
    undo(doc)
    expect([doc.width, doc.height]).toEqual([3, 2])
  })

  it('keeps flood fill within its selection boundary', () => {
    const doc = createDocument(5, 3, '#000000')
    edit(doc, { x: 1, y: 0, w: 3, h: 3 }, [{ op: 'flood_fill', x: 2, y: 1, color: '#00ff00' }])
    expect(Array.from(doc.pixels.slice((1 * 5 + 2) * 4, (1 * 5 + 3) * 4))).toEqual([0, 255, 0, 255])
    expect(Array.from(doc.pixels.slice((1 * 5) * 4, (1 * 5 + 1) * 4))).toEqual([0, 0, 0, 255])
  })

  it('reports malformed operation payloads as drawing errors without committing', () => {
    const doc = createDocument(4, 4, 'transparent')
    expect(() => edit(doc, { x: 0, y: 0, w: 4, h: 4 }, undefined as never)).toThrow('ops must be an array')
    expect(() => edit(doc, { x: 0, y: 0, w: 4, h: 4 }, [{ op: 'rotate' } as never])).toThrow('unsupported operation: rotate')
    expect(() => edit(doc, { x: 0, y: 0, w: 4, h: 4 }, [{ op: 'flip', axis: 'diagonal' } as never])).toThrow('flip axis must be horizontal or vertical')
    expect(doc.version).toBe(1)
  })
})
