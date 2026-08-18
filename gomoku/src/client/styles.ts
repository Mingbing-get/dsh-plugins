export const styles = `
.dsh-gomoku-tool-row{display:flex;align-items:center;gap:9px;min-height:30px;padding:2px 0;color:var(--dsw-alias-label-secondary,#666);font:13px/1.4 ui-serif,"Songti SC",serif}
.dsh-gomoku-tool-mark{width:10px;height:10px;border-radius:50%;background:#a34030;box-shadow:0 0 0 3px color-mix(in srgb,#a34030 13%,transparent)}
.dsh-gomoku-tool-title{color:var(--dsw-alias-label-primary,#222);font-weight:600}
.dsh-gomoku-tool-status{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-gomoku-show{flex:none;margin-left:auto;border:1px solid var(--dsw-alias-border-l2,#d4d0c8);border-radius:999px;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-secondary,#555);padding:4px 10px;font:600 11px/1.2 ui-serif,serif;cursor:pointer}
.dsh-gomoku-show:hover:not(:disabled){border-color:#a34030;color:#8e3327;background:color-mix(in srgb,#a34030 6%,var(--dsw-alias-bg-base,#fff))}
.dsh-gomoku-show:disabled{opacity:.46;cursor:default}
.dsh-gomoku-window{--ink:#201b15;position:fixed;z-index:1200;display:flex;flex-direction:column;width:max-content;max-width:min(92vw,760px);max-height:88vh;overflow:hidden;color:var(--ink);background:radial-gradient(circle at 10% 0%,rgba(255,255,255,.64),transparent 34%),linear-gradient(145deg,#f7efd9,#e7d2aa);border:1px solid rgba(78,52,25,.4);border-radius:18px;box-shadow:0 24px 70px rgba(0,0,0,.32),0 4px 14px rgba(64,38,14,.18),inset 0 1px rgba(255,255,255,.72);animation:dsh-gomoku-rise .22s cubic-bezier(.2,.8,.2,1)}
.dsh-gomoku-window[data-centered=true]{left:50%;top:50%;transform:translate(-50%,-50%)}
.dsh-gomoku-window:before{content:"五子";position:absolute;right:20px;top:8px;color:rgba(78,42,25,.06);font:700 92px/1 serif;letter-spacing:-.18em;pointer-events:none}
.dsh-gomoku-header{position:relative;display:flex;align-items:flex-start;justify-content:space-between;gap:24px;padding:18px 20px 13px;border-bottom:1px solid rgba(86,58,28,.16);cursor:grab;touch-action:none;user-select:none}
.dsh-gomoku-header:active{cursor:grabbing}
.dsh-gomoku-kicker{margin:0 0 3px;color:#9b3d2d;font:600 10px/1.2 ui-serif,serif;letter-spacing:.2em;text-transform:uppercase}
.dsh-gomoku-title{margin:0;font:600 23px/1.2 "Songti SC","Noto Serif CJK SC",serif;letter-spacing:.08em}
.dsh-gomoku-meta{margin:5px 0 0;color:rgba(32,27,21,.6);font:12px/1.45 ui-serif,serif}
.dsh-gomoku-header-actions{display:flex;align-items:center;gap:8px}
.dsh-gomoku-turn{display:flex;align-items:center;gap:7px;padding:7px 10px;border:1px solid rgba(83,55,25,.2);border-radius:999px;background:rgba(255,255,255,.3);font:600 11px/1 ui-serif,serif}
.dsh-gomoku-turn:before{content:"";width:8px;height:8px;border-radius:50%;background:#171411;box-shadow:0 0 0 2px rgba(255,255,255,.65)}
.dsh-gomoku-close{display:grid;place-items:center;width:28px;height:28px;padding:0;border:1px solid rgba(83,55,25,.18);border-radius:50%;background:rgba(255,255,255,.24);color:#704733;font:18px/1 serif;cursor:pointer}
.dsh-gomoku-close:hover{background:rgba(151,54,41,.1);color:#96382c}
.dsh-gomoku-body{min-height:0;overflow:auto;padding:18px 20px 10px}
.dsh-gomoku-board-wrap{position:relative;width:max-content;margin:auto;padding:16px;background:linear-gradient(135deg,#d9a454,#bd7930);border:1px solid rgba(73,39,13,.5);border-radius:8px;box-shadow:0 10px 28px rgba(75,44,15,.22),inset 0 0 35px rgba(255,231,168,.25)}
.dsh-gomoku-board{display:grid;width:max-content;background:#ca8e42;border-top:1px solid rgba(56,31,12,.7);border-left:1px solid rgba(56,31,12,.7)}
.dsh-gomoku-cell{position:relative;display:grid;place-items:center;width:var(--cell);height:var(--cell);padding:0;border:0;border-right:1px solid rgba(56,31,12,.72);border-bottom:1px solid rgba(56,31,12,.72);border-radius:0;background:transparent;cursor:pointer}
.dsh-gomoku-cell:not(:disabled):hover{background:rgba(255,246,204,.32)}
.dsh-gomoku-cell:not(:disabled):hover:after{content:"";width:64%;height:64%;border-radius:50%;background:rgba(30,25,20,.23)}
.dsh-gomoku-cell:focus-visible{z-index:2;outline:3px solid #a52f24;outline-offset:-2px}
.dsh-gomoku-stone{width:76%;height:76%;border-radius:50%;pointer-events:none}
.dsh-gomoku-stone[data-color=black]{background:radial-gradient(circle at 34% 28%,#555,#181716 38%,#050505 78%);box-shadow:0 2px 4px rgba(0,0,0,.48)}
.dsh-gomoku-stone[data-color=white]{background:radial-gradient(circle at 34% 28%,#fff,#eee8dc 50%,#cfc5b5 100%);box-shadow:0 2px 5px rgba(0,0,0,.32),inset 0 0 0 1px rgba(80,60,40,.18)}
.dsh-gomoku-stone[data-last=true]{box-shadow:0 0 0 2px #a53225,0 2px 5px rgba(0,0,0,.4)}
.dsh-gomoku-footer{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:11px 20px 15px;color:rgba(32,27,21,.58);font:11px/1.5 ui-serif,serif}
.dsh-gomoku-error{color:#a52f24}
@keyframes dsh-gomoku-rise{from{opacity:0;transform:translateY(10px) scale(.985)}to{opacity:1;transform:none}}
.dsh-gomoku-window[data-centered=true]{animation-name:dsh-gomoku-rise-centered}@keyframes dsh-gomoku-rise-centered{from{opacity:0;transform:translate(-50%,calc(-50% + 10px)) scale(.985)}to{opacity:1;transform:translate(-50%,-50%)}}
@media(max-width:640px){.dsh-gomoku-window{max-width:96vw;max-height:92vh;border-radius:14px}.dsh-gomoku-header,.dsh-gomoku-body,.dsh-gomoku-footer{padding-left:12px;padding-right:12px}.dsh-gomoku-board-wrap{padding:9px}.dsh-gomoku-turn{display:none}}
@media(prefers-reduced-motion:reduce){.dsh-gomoku-window{animation:none}}
`

export function installStyles(): () => void {
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-gomoku-plugin'
  tag.textContent = styles
  document.head.appendChild(tag)
  return () => { tag.remove() }
}
