import type { Drawing } from './drawing.ts'

/** Runtime validators for the shared drawing protocol. */
export type ValidationResult = { isError: false } | { isError: true; msg: string }

const success = (): ValidationResult => ({ isError: false })
const failure = (msg: string): ValidationResult => ({ isError: true, msg })

export function validateToolName(value: unknown): ValidationResult {
  if (
    value === 'create_image' ||
    value === 'query_image' ||
    value === 'edit_image' ||
    value === 'undo_image' ||
    value === 'redo_image'
  ) {
    return success()
  }

  return failure('tool name is not supported')
}

export function validatePoint(value: unknown): ValidationResult {
  if (!isRecord(value)) return failure('point must be an object')
  if (!isFiniteNumber(value.x) || !isFiniteNumber(value.y)) {
    return failure('point x and y must be finite numbers')
  }

  return success()
}

export function validateRect(value: unknown): ValidationResult {
  if (!isRecord(value)) return failure('rectangle must be an object')
  if (![value.x, value.y, value.w, value.h].every(isFiniteNumber)) {
    return failure('rectangle x, y, w, and h must be finite numbers')
  }

  return success()
}

export function validateRectSelection(value: unknown): ValidationResult {
  if (!isRecord(value) || value.type !== 'rect') return failure('selection type must be rect')
  return validateRect(value)
}

export function validateSelection(value: unknown): ValidationResult {
  if (!isRecord(value)) return failure('selection must be an object')
  if (value.type === 'all' || value.type === 'current') return success()
  if (value.type === 'rect') return validateRectSelection(value)

  return failure('selection type must be all, current, or rect')
}

export function validateImageInfo(value: unknown): ValidationResult {
  if (!isRecord(value)) return failure('image info must be an object')
  if (typeof value.imageId !== 'string') return failure('imageId must be a string')
  if (!isNonNegativeInteger(value.version)) return failure('version must be a non-negative integer')
  if (!isPositiveInteger(value.width) || !isPositiveInteger(value.height)) {
    return failure('width and height must be positive integers')
  }
  if (value.selection !== null) return validateRectSelection(value.selection)

  return success()
}

export function validateEditOperation(value: unknown): ValidationResult {
  if (!isRecord(value) || typeof value.op !== 'string') {
    return failure('operation must be an object with a string op')
  }

  const isValid = (() => {
    switch (value.op) {
      case 'fill':
        return isColor(value.color) && isOptionalFiniteNumber(value.opacity)
      case 'clear':
        return true
      case 'linear_gradient':
        return isLine(value) && isGradient(value)
      case 'radial_gradient':
        return (
          isFiniteNumber(value.cx) &&
          isFiniteNumber(value.cy) &&
          isFiniteNumber(value.radius) &&
          isGradient(value)
        )
      case 'rect':
      case 'ellipse':
        return (
          !validateRect(value).isError &&
          isShapeStyle(value) &&
          isOptionalFiniteNumber(value.opacity)
        )
      case 'polygon':
        return (
          isPointArray(value.points) && isShapeStyle(value) && isOptionalFiniteNumber(value.opacity)
        )
      case 'line':
        return (
          isLine(value) &&
          isColor(value.color) &&
          isOptionalFiniteNumber(value.radius) &&
          isOptionalFiniteNumber(value.opacity)
        )
      case 'brush':
        return (
          isPointArray(value.points) &&
          isColor(value.color) &&
          isOptionalFiniteNumber(value.radius) &&
          isOptionalFiniteNumber(value.opacity)
        )
      case 'replace_color':
        return isColor(value.from) && isColor(value.to) && isOptionalFiniteNumber(value.tolerance)
      case 'flood_fill':
        return (
          !validatePoint(value).isError &&
          isColor(value.color) &&
          isOptionalFiniteNumber(value.tolerance) &&
          isOptionalFiniteNumber(value.opacity)
        )
      case 'crop':
        return !validateRect(value).isError
      case 'resize':
        return isPositiveInteger(value.width) && isPositiveInteger(value.height)
      case 'flip':
        return value.axis === 'horizontal' || value.axis === 'vertical'
      default:
        return false
    }
  })()

  return isValid ? success() : failure(`invalid ${value.op} operation arguments`)
}

export function validateEditImageArguments(value: unknown): ValidationResult {
  if (!isRecord(value)) return failure('edit image arguments must be an object')
  if (!isNonNegativeInteger(value.expectedVersion)) {
    return failure('expectedVersion must be a non-negative integer')
  }

  const selectionResult = validateSelection(value.selection)
  if (selectionResult.isError) return selectionResult

  if (!Array.isArray(value.ops) || value.ops.length < 1 || value.ops.length > 32) {
    return failure('ops must contain between 1 and 32 operations')
  }

  for (const [index, operation] of value.ops.entries()) {
    const operationResult = validateEditOperation(operation)
    if (operationResult.isError) return failure(`ops[${index}]: ${operationResult.msg}`)
  }

  return success()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isColor(value: unknown): value is Drawing.Color {
  return typeof value === 'string' && /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isOptionalFiniteNumber(value: unknown): value is number | undefined {
  return value === undefined || isFiniteNumber(value)
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0
}

function isPointArray(value: unknown): value is Drawing.Point[] {
  return Array.isArray(value) && value.every((point) => !validatePoint(point).isError)
}

function isLine(value: Record<string, unknown>): boolean {
  return [value.x1, value.y1, value.x2, value.y2].every(isFiniteNumber)
}

function isShapeStyle(value: Record<string, unknown>): boolean {
  const hasFill = value.fill !== undefined
  const hasStroke = value.stroke !== undefined

  return (
    (hasFill || hasStroke) &&
    (value.fill === undefined || isColor(value.fill)) &&
    (value.stroke === undefined || isColor(value.stroke)) &&
    (value.strokeWidth === undefined || (hasStroke && isPositiveInteger(value.strokeWidth)))
  )
}

function isGradient(value: Record<string, unknown>): boolean {
  return (
    Array.isArray(value.colors) &&
    value.colors.length >= 2 &&
    value.colors.length <= 16 &&
    value.colors.every((colorStop) => !validateGradientColorStop(colorStop).isError) &&
    isOptionalFiniteNumber(value.opacity)
  )
}

function validateGradientColorStop(value: unknown): ValidationResult {
  if (!isRecord(value) || !isColor(value.color))
    return failure('gradient color must be a valid color')
  if (typeof value.offset !== 'string' || !isGradientOffset(value.offset)) {
    return failure('gradient offset must be between 0% and 100%')
  }

  return success()
}

function isGradientOffset(value: string): boolean {
  const match = /^(?:0|(?:[1-9]\d*)(?:\.\d+)?)%$/.exec(value)
  return match !== null && Number(match[0].slice(0, -1)) <= 100
}
