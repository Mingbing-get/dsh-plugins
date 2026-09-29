/** Stylesheet for the floating intervention panel (injected once per page). */

export const styles = `
.dsh-task-panel{position:fixed;right:18px;bottom:18px;z-index:1300;display:flex;flex-direction:column;align-items:flex-end;gap:10px;pointer-events:none}
.dsh-task-panel>*{pointer-events:auto}
.dsh-task-card{display:flex;flex-direction:column;width:min(92vw,420px);max-height:64vh;overflow:hidden;color:var(--dsw-alias-label-primary,#19242a);background:var(--dsw-alias-bg-base,#fff);border:1px solid var(--dsw-alias-border-l2,#ced8d8);border-radius:14px;box-shadow:0 18px 48px color-mix(in srgb,var(--dsw-alias-label-primary,#19242a) 22%,transparent);animation:dsh-task-appear .16s ease-out}
.dsh-task-card-head{display:flex;align-items:center;gap:8px;min-height:42px;padding:0 8px 0 14px;border-bottom:1px solid var(--dsw-alias-border-l2,#ced8d8);cursor:grab;touch-action:none}
.dsh-task-card-head:active{cursor:grabbing}
.dsh-task-card-title{font:700 13px/1.2 ui-rounded,"PingFang SC",sans-serif}
.dsh-task-card-sub{margin-left:auto;color:var(--dsw-alias-label-secondary,#60666e);font:600 11px/1.2 ui-rounded,"PingFang SC",sans-serif;font-variant-numeric:tabular-nums}
.dsh-task-icon{display:grid;place-items:center;width:26px;height:26px;padding:0;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary,#60666e);font:16px/1 ui-rounded,"PingFang SC",sans-serif;cursor:pointer}
.dsh-task-icon:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary,#19242a) 8%,transparent);color:var(--dsw-alias-label-primary,#19242a)}
.dsh-task-body{min-height:0;overflow:auto;padding:10px 12px 14px}
.dsh-task-summary{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
.dsh-task-chip{border:1px solid var(--dsw-alias-border-l2,#ced8d8);border-radius:999px;padding:3px 8px;color:var(--dsw-alias-label-secondary,#60666e);font:600 11px/1.2 ui-rounded,"PingFang SC",sans-serif}
.dsh-task-chip b{color:var(--dsw-alias-label-primary,#19242a)}
.dsh-task-empty{color:var(--dsw-alias-label-secondary,#60666e);font:12px/1.5 ui-rounded,"PingFang SC",sans-serif;padding:6px 2px}
.dsh-task-item{display:flex;flex-direction:column;gap:6px;padding:10px;border:1px solid var(--dsw-alias-border-l2,#ced8d8);border-radius:10px;background:var(--dsw-alias-bg-base,#fff)}
.dsh-task-item+.dsh-task-item{margin-top:8px}
.dsh-task-item.dsh-task-failed{border-color:color-mix(in srgb,#c0392b 45%,var(--dsw-alias-border-l2,#ced8d8));background:color-mix(in srgb,#c0392b 6%,var(--dsw-alias-bg-base,#fff))}
.dsh-task-item.dsh-task-blocked{border-color:color-mix(in srgb,#c98a00 45%,var(--dsw-alias-border-l2,#ced8d8));background:color-mix(in srgb,#c98a00 7%,var(--dsw-alias-bg-base,#fff))}
.dsh-task-item-head{display:flex;align-items:center;gap:8px}
.dsh-task-item-title{font:700 12px/1.3 ui-rounded,"PingFang SC",sans-serif}
.dsh-task-item-time{margin-left:auto;color:var(--dsw-alias-label-secondary,#60666e);font:500 10px/1.2 ui-rounded,"PingFang SC",sans-serif;font-variant-numeric:tabular-nums}
.dsh-task-item-where{margin:0;color:var(--dsw-alias-label-secondary,#60666e);font:600 10px/1.3 ui-rounded,"PingFang SC",sans-serif;letter-spacing:.02em;opacity:.85}
.dsh-task-item-message{color:var(--dsw-alias-label-secondary,#60666e);font:12px/1.5 ui-rounded,"PingFang SC",sans-serif;word-break:break-word}
.dsh-task-item-actions{display:flex;gap:6px}
.dsh-task-action{border:1px solid color-mix(in srgb,#0c5568 35%,var(--dsw-alias-border-l2,#ced8d8));border-radius:7px;background:var(--dsw-alias-bg-base,#fff);color:#0c5568;padding:4px 10px;font:700 11px/1.2 ui-rounded,"PingFang SC",sans-serif;cursor:pointer}
.dsh-task-action:hover:not(:disabled){background:#e6f4f3;border-color:#0c5568}
.dsh-task-action:disabled{opacity:.5;cursor:default}
.dsh-task-action-danger{color:#c0392b;border-color:color-mix(in srgb,#c0392b 35%,var(--dsw-alias-border-l2,#ced8d8))}
.dsh-task-action-danger:hover:not(:disabled){background:color-mix(in srgb,#c0392b 10%,transparent);border-color:#c0392b}
.dsh-task-badge{display:inline-flex;align-items:center;gap:8px;border:1px solid color-mix(in srgb,#0c5568 35%,var(--dsw-alias-border-l2,#ced8d8));border-radius:999px;background:var(--dsw-alias-bg-base,#fff);color:#0c5568;padding:7px 14px;font:700 12px/1.2 ui-rounded,"PingFang SC",sans-serif;box-shadow:0 6px 18px color-mix(in srgb,var(--dsw-alias-label-primary,#19242a) 16%,transparent);cursor:pointer}
.dsh-task-badge:hover{background:#e6f4f3;border-color:#0c5568}
.dsh-task-badge.dsh-task-alert{border-color:#c0392b;color:#c0392b;background:color-mix(in srgb,#c0392b 8%,var(--dsw-alias-bg-base,#fff))}
.dsh-task-count{display:grid;place-items:center;min-width:17px;height:17px;border-radius:999px;background:#c0392b;color:#fff;font:700 10px/1 ui-rounded,"PingFang SC",sans-serif;padding:0 4px}
.dsh-task-error{margin:0 0 10px;padding:8px 10px;border-radius:8px;background:color-mix(in srgb,#c0392b 10%,transparent);color:#c0392b;font:12px/1.5 ui-rounded,"PingFang SC",sans-serif}
.dsh-task-features{margin-top:10px;padding-top:10px;border-top:1px dashed var(--dsw-alias-border-l2,#ced8d8);color:var(--dsw-alias-label-secondary,#60666e);font:11px/1.6 ui-rounded,"PingFang SC",sans-serif;white-space:pre-wrap}
@keyframes dsh-task-appear{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@media(prefers-reduced-motion:reduce){.dsh-task-card{animation:none}}
`

/** Inject the stylesheet; returns the disposer that removes it. */
export function installStyles(): () => void {
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-task-plugin'
  tag.textContent = styles
  document.head.appendChild(tag)
  return () => tag.remove()
}
