import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { defineTool, ToolArgsError } from '@deepseek-ai/dsh-tools'
import type { AskUserQuestionAnswer } from '@deepseek-ai/dsh-user-questions'
import type {} from '@deepseek-ai/dsh-user-questions'
import {
  validateCreateImageArguments,
  validateEditImageArguments,
  validateQueryImageArguments,
  validateVersionedImageArguments,
  type ValidationResult,
} from './shared/index.ts'
import type { Drawing } from './shared/index.ts'

export const name = 'drawing'
export const inject = ['tools', 'systemPrompt', 'userQuestions']

const EDIT_IMAGE_OPS_CONTEXT = `# edit_image operation manual

Use edit_image to submit one ordered batch of drawing operations. This reference describes the current protocol exactly; do not invent unsupported operations, fields, blend modes, filters, text, URLs, prompts, or Canvas code.

## Required request shape

Every request has { expectedVersion, selection, ops }.

- expectedVersion is the non-negative integer version of the image you intend to edit. Query the image state first when a current version is available; a real image host may reject a stale version.
- selection is one of { type: "all" }, { type: "current" }, or { type: "rect", x, y, w, h }. Use current for the user's active selection, rect for an explicitly known rectangle, and all only when the intended edit covers the whole image.
- ops contains 1 through 32 operation objects, which run in the listed order. Put dependent operations in the same call, for example fill before drawing shapes on top of it.

Coordinates are document-pixel coordinates. Every coordinate, rectangle value, radius, opacity, and tolerance must be a finite number (not NaN or Infinity). For a useful image edit, normally use non-negative x/y values and positive widths, heights, and radii. The protocol validator currently accepts any finite rectangle values, so do not rely on a renderer correcting an invalid or out-of-bounds geometry.

All colors must be a string in #RRGGBB or #RRGGBBAA form, for example #2563EB, #FFFFFF, or #00000080. Do not use named colors, rgb(), hsl(), shorthand hex, URLs, or variables.

Optional opacity, radius, and tolerance fields have no protocol-defined default or range beyond being finite numbers. Omit them when their renderer-specific behavior is not required; never assume opacity is automatically clamped to 0–1.

## Selection

- { type: "all" }: the entire image.
- { type: "current" }: the current selection supplied by the image host. It is valid syntactically even though its availability is determined by the host.
- { type: "rect", x, y, w, h }: an explicit rectangular selection. x/y identify its position; w/h identify its size.

## Paint and clear

- { op: "fill", color, opacity? }: fill the active selection with one color.
- { op: "clear" }: clear the active selection to transparent. It takes no other fields.
- { op: "flood_fill", x, y, color, tolerance?, opacity? }: fill the contiguous area reached from point { x, y } with color.
- { op: "replace_color", from, to, tolerance? }: replace occurrences matching from with to. This is a color replacement operation, not a spatial flood fill.

## Gradients

- { op: "linear_gradient", x1, y1, x2, y2, colors, opacity? }: draw a linear gradient from start point (x1, y1) to end point (x2, y2).
- { op: "radial_gradient", cx, cy, radius, colors, opacity? }: draw a radial gradient centered at (cx, cy) with radius.
- colors is required for both forms and contains 2 through 16 stops. Each stop is { color, offset }, where color is a valid hex color and offset is a percentage string from 0% to 100%, such as "0%", "50%", or "100%". Use numeric percentage strings only; do not pass a number, decimal fraction, px value, or CSS expression.

## Shapes and paths

- { op: "rect", x, y, w, h, fill?, stroke?, strokeWidth?, opacity? }: draw a rectangle.
- { op: "ellipse", x, y, w, h, fill?, stroke?, strokeWidth?, opacity? }: draw an ellipse fitted to the rectangle.
- { op: "polygon", points, fill?, stroke?, strokeWidth?, opacity? }: draw a polygon through points, where every point is { x, y }.
- For rect, ellipse, and polygon, provide at least one of fill or stroke. fill and stroke are colors. strokeWidth is allowed only when stroke is present and must be a positive integer. Prefer at least three points for a meaningful polygon; the current validator only verifies that every supplied point has finite x/y values.
- { op: "line", x1, y1, x2, y2, color, radius?, opacity? }: draw a colored line between two points.
- { op: "brush", points, color, radius?, opacity? }: draw a colored freehand path through points. Use at least two points for a visible path; each point is { x, y }.

## Canvas transforms

- { op: "crop", x, y, w, h }: crop to a rectangle.
- { op: "resize", width, height }: resize the image. width and height are required positive integers.
- { op: "flip", axis }: flip the image. axis must be exactly "horizontal" or "vertical".

Place crop, resize, and flip deliberately: later operations use the image state produced by earlier operations in the same ops array.

## Examples

Create a blue background then add a white outlined rectangle:
{ "expectedVersion": 7, "selection": { "type": "all" }, "ops": [{ "op": "fill", "color": "#2563EB" }, { "op": "rect", "x": 80, "y": 60, "w": 320, "h": 180, "stroke": "#FFFFFF", "strokeWidth": 4 }] }

Draw a filled triangle inside an explicit selection:
{ "expectedVersion": 8, "selection": { "type": "rect", "x": 0, "y": 0, "w": 512, "h": 512 }, "ops": [{ "op": "polygon", "points": [{ "x": 256, "y": 40 }, { "x": 80, "y": 400 }, { "x": 432, "y": 400 }], "fill": "#F59E0B" }] }

Fill the user-selected region with a two-stop gradient:
{ "expectedVersion": 9, "selection": { "type": "current" }, "ops": [{ "op": "linear_gradient", "x1": 0, "y1": 0, "x2": 0, "y2": 300, "colors": [{ "color": "#0EA5E9", "offset": "0%" }, { "color": "#312E81", "offset": "100%" }] }] }

## Before calling

1. Use only the operation names and fields documented above.
2. Check colors, required fields, finite numeric values, and the 1–32 operation limit.
3. Preserve the user's requested scope: prefer current for “this/selected area”; use all only for an explicitly whole-image request.
4. This plugin currently validates requests but does not render an image itself. Treat the protocol as a declared contract and do not claim visual output unless a rendering host reports it.
`

const output = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      ok: { type: 'boolean', required: true },
    },
  },
  render: (_args: unknown, value: { ok: boolean }) => [
    { type: 'text' as const, text: JSON.stringify(value) },
  ],
} as const

const queryOutput = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      imageId: { type: 'string', required: true },
      version: { type: 'integer', required: true },
      width: { type: 'integer', required: true },
      height: { type: 'integer', required: true },
      selection: {
        required: true,
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              type: { type: 'string', required: true, enum: ['rect'] },
              x: { type: 'number', required: true },
              y: { type: 'number', required: true },
              w: { type: 'number', required: true },
              h: { type: 'number', required: true },
            },
          },
          { type: 'null' },
        ],
      },
      bounds: {
        type: 'object',
        required: true,
        additionalProperties: false,
        properties: {
          x: { type: 'number', required: true },
          y: { type: 'number', required: true },
          w: { type: 'number', required: true },
          h: { type: 'number', required: true },
        },
      },
      alpha: {
        type: 'object',
        required: true,
        additionalProperties: false,
        properties: {
          opaque: { type: 'integer', required: true },
          transparent: { type: 'integer', required: true },
          partial: { type: 'integer', required: true },
        },
      },
      clipped: { type: 'boolean', required: true },
    },
  },
  render: (_args: unknown, value: unknown) => [
    { type: 'text' as const, text: JSON.stringify(value) },
  ],
} as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0
}

function isRect(value: unknown): value is Drawing.Rect {
  return (
    isRecord(value) &&
    [value.x, value.y, value.w, value.h].every(
      (part) => typeof part === 'number' && Number.isFinite(part),
    )
  )
}

function isQueryResult(value: unknown): value is Drawing.ImageResult {
  if (!isRecord(value) || typeof value.imageId !== 'string') return false
  if (!isNonNegativeInteger(value.version)) return false
  if (!isPositiveInteger(value.width) || !isPositiveInteger(value.height)) return false
  if (
    value.selection !== null &&
    !(isRecord(value.selection) && value.selection.type === 'rect' && isRect(value.selection))
  ) {
    return false
  }
  if (!isRect(value.bounds) || typeof value.clipped !== 'boolean' || !isRecord(value.alpha))
    return false
  return [value.alpha.opaque, value.alpha.transparent, value.alpha.partial].every(
    isNonNegativeInteger,
  )
}

function queryResult(answer: AskUserQuestionAnswer): Drawing.ImageResult {
  const raw = answer.answers.find((item) => item.id === 'drawing-query-image')?.custom
  if (raw === undefined) throw new Error('the drawing client returned no image result')
  let response: unknown
  try {
    response = JSON.parse(raw)
  } catch {
    throw new Error('the drawing client returned malformed image metadata')
  }
  if (!isRecord(response)) throw new Error('the drawing client returned invalid image metadata')
  if (response.ok === false && typeof response.error === 'string') throw new Error(response.error)
  if (response.ok !== true || !isQueryResult(response.value)) {
    throw new Error('the drawing client returned invalid image metadata')
  }
  return response.value
}

function completeAfterValidation(result: ValidationResult): { ok: true } {
  if (result.isError) throw new ToolArgsError([result.msg])
  return { ok: true }
}

export function apply(ctx: Context): void {
  ctx.systemPrompt.context({
    name: 'drawing:edit-image-ops',
    order: 100,
    text: EDIT_IMAGE_OPS_CONTEXT,
  })

  ctx.tools.register(
    defineTool({
      name: 'create_image',
      description:
        'Create a new drawing image. This server validates the request but does not render it.',
      parameters: {
        width: { type: 'integer', required: true, description: 'Image width in pixels.' },
        height: { type: 'integer', required: true, description: 'Image height in pixels.' },
        background: { type: 'string', description: 'transparent or a #RRGGBB/#RRGGBBAA color.' },
        replace: { type: 'boolean', description: 'Whether an existing image may be replaced.' },
      },
      output,
      async execute(args) {
        return completeAfterValidation(validateCreateImageArguments(args))
      },
      presentCall: (args) => ({
        card: 'generic',
        title: '创建图片',
        kind: 'other',
        rawInput: args,
      }),
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'query_image',
      description:
        'Query drawing image metadata from the current client-side drawing document. It never returns raw pixels.',
      parameters: {
        scope: { type: 'string', required: true, enum: ['summary', 'selection', 'region'] },
        bounds: {
          type: 'object',
          additionalProperties: true,
          description: 'Required for region scope: { x, y, w, h }.',
        },
      },
      output: queryOutput,
      async execute(args, exec) {
        completeAfterValidation(validateQueryImageArguments(args))
        const answer = await ctx.userQuestions.ask({
          questions: [
            {
              id: 'drawing-query-image',
              header: 'drawing:query-image',
              question: '读取当前绘图文档的结构化信息。',
              detail: JSON.stringify(args),
            },
          ],
          ...(exec.agent === undefined ? {} : { agent: exec.agent }),
          signal: exec.signal,
        })
        return queryResult(answer)
      },
      presentCall: (args) => ({
        card: 'generic',
        title: '查询图片',
        kind: 'other',
        rawInput: args,
      }),
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'edit_image',
      description:
        'Apply drawing operations. This server validates the request but does not render it.',
      parameters: {
        expectedVersion: { type: 'integer', required: true },
        selection: { type: 'object', additionalProperties: true, required: true },
        ops: {
          type: 'array',
          items: { type: 'object', additionalProperties: true },
          required: true,
        },
      },
      output,
      async execute(args) {
        return completeAfterValidation(validateEditImageArguments(args))
      },
      presentCall: (args) => ({
        card: 'generic',
        title: '编辑图片',
        kind: 'other',
        rawInput: args,
      }),
    }),
  )

  for (const [toolName, title] of [
    ['undo_image', '撤销图片编辑'],
    ['redo_image', '重做图片编辑'],
  ] as const) {
    ctx.tools.register(
      defineTool({
        name: toolName,
        description: `${title}。This server validates the request but does not modify an image.`,
        parameters: { expectedVersion: { type: 'integer', required: true } },
        output,
        async execute(args) {
          return completeAfterValidation(validateVersionedImageArguments(args))
        },
        presentCall: (args) => ({ card: 'generic', title, kind: 'other', rawInput: args }),
      }),
    )
  }
}
