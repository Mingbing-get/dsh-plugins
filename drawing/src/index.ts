import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-user-questions'
import { createImageTool } from './tools/create-image.ts'
import { editImageTool } from './tools/edit-image.ts'
import { createQueryImageTool } from './tools/query-image.ts'
import { redoImageTool } from './tools/redo-image.ts'
import { undoImageTool } from './tools/undo-image.ts'

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

export function apply(ctx: Context): void {
  ctx.systemPrompt.context({
    name: 'drawing:edit-image-ops',
    order: 100,
    text: EDIT_IMAGE_OPS_CONTEXT,
  })
  ctx.tools.register(createImageTool)
  ctx.tools.register(createQueryImageTool(ctx))
  ctx.tools.register(editImageTool)
  ctx.tools.register(undoImageTool)
  ctx.tools.register(redoImageTool)
}
