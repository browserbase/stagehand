/*
 * AUTO-GENERATED FILE. DO NOT EDIT.
 * Run `pnpm run build-dom-scripts` to regenerate.
 */
export const screenshotScriptSources = {
  resolveMaskRect:
    'function h(r){function u(t,e){try{return t&&typeof t.closest=="function"?t.closest(e):null}catch{return null}}function s(t,e){try{return!!t&&typeof t.matches=="function"&&t.matches(e)}catch{return!1}}function c(t){let e=u(t,"dialog[open]");if(e)return e;let l=u(t,"[popover]");return l&&s(l,":popover-open")?l:null}if(!this||typeof this.getBoundingClientRect!="function")return null;let n=this.getBoundingClientRect();if(!n)return null;let i=window.getComputedStyle(this);if(!i||i.visibility==="hidden"||i.display==="none"||n.width<=0||n.height<=0)return null;let o=c(this);if(o){let t=o.getBoundingClientRect();if(!t)return null;let e=null;if(r)try{let l=o.getAttribute("data-stagehand-mask-root");l&&l.startsWith(r)?e=l:(e=r+"_root_"+Math.random().toString(36).slice(2),o.setAttribute("data-stagehand-mask-root",e))}catch{e=null}return{x:n.left-t.left-(o.clientLeft||0)+(o.scrollLeft||0),y:n.top-t.top-(o.clientTop||0)+(o.scrollTop||0),width:n.width,height:n.height,rootToken:e}}return{x:n.left+window.scrollX,y:n.top+window.scrollY,width:n.width,height:n.height,rootToken:null}}',
} as const;
export type ScreenshotScriptName = keyof typeof screenshotScriptSources;
