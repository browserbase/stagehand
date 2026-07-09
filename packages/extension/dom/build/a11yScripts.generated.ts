/*
 * AUTO-GENERATED FILE. DO NOT EDIT.
 * Run `pnpm run build-dom-scripts` to regenerate.
 */
export const a11yScriptBootstrap =
  'if (!globalThis.__stagehandA11yScripts) { var __stagehandA11yScriptsFactory=(()=>{var i=Object.defineProperty;var a=Object.getOwnPropertyDescriptor;var f=Object.getOwnPropertyNames;var p=Object.prototype.hasOwnProperty;var N=(o,t)=>{for(var n in t)i(o,n,{get:t[n],enumerable:!0})},h=(o,t,n,d)=>{if(t&&typeof t=="object"||typeof t=="function")for(let u of f(t))!p.call(o,u)&&u!==n&&i(o,u,{get:()=>t[u],enumerable:!(d=a(t,u))||d.enumerable});return o};var E=o=>h(i({},"__esModule",{value:!0}),o);var b={};N(b,{documentHasFocusStrict:()=>g,getBoundingRectLite:()=>w,getScrollOffsets:()=>y,nodeToAbsoluteXPath:()=>$,resolveDeepActiveElement:()=>T});function y(){try{let o=window.scrollX??window.pageXOffset??document.documentElement?.scrollLeft??0,t=window.scrollY??window.pageYOffset??document.documentElement?.scrollTop??0;return{sx:Number(o)||0,sy:Number(t)||0}}catch{return{sx:0,sy:0}}}function w(){try{let o=this.getBoundingClientRect();return{left:Number(o?.left??0)||0,top:Number(o?.top??0)||0}}catch{return{left:0,top:0}}}function T(){try{return(t=>{let n=t.activeElement??null;for(;n&&n.shadowRoot&&n.shadowRoot.activeElement;)n=n.shadowRoot.activeElement;return n??null})(document)}catch{return null}}function $(){return(t=>{try{let n=e=>{if(!e||!e.parentNode)return 1;let l=1,m=`${e.nodeType}:${(e.nodeName||"").toLowerCase()}`;for(let c=e.previousSibling;c;c=c.previousSibling)`${c.nodeType}:${(c.nodeName||"").toLowerCase()}`===m&&(l+=1);return l},d=e=>{if(!e||e.nodeType===Node.DOCUMENT_NODE)return"";if(e.nodeType===Node.DOCUMENT_FRAGMENT_NODE)return"//";if(e.nodeType===Node.TEXT_NODE)return`text()[${n(e)}]`;if(e.nodeType===Node.COMMENT_NODE)return`comment()[${n(e)}]`;let l=(e.nodeName||"").toLowerCase();return`${l.includes(":")?`*[name()=\'${l}\']`:l}[${n(e)}]`},u=[],s=t;for(;s;){if(s.nodeType===Node.DOCUMENT_FRAGMENT_NODE){u.push("//"),s=s.host??null;continue}let e=d(s);e&&u.push(e),s=s.parentNode}u.reverse();let r="";for(let e of u)e==="//"?r=r?r.endsWith("/")?`${r}/`:`${r}//`:"//":r=r?r.endsWith("/")?`${r}${e}`:`${r}/${e}`:`/${e}`;return r||"/"}catch{return"/"}})(this)}function g(){try{return document.hasFocus()===!0}catch{return!1}}return E(b);})();\n  globalThis.__stagehandA11yScripts = __stagehandA11yScriptsFactory;\n}';
export const a11yScriptSources = {
  documentHasFocusStrict: "function h(){try{return document.hasFocus()===!0}catch{return!1}}",
  getBoundingRectLite:
    "function f(){try{let r=this.getBoundingClientRect();return{left:Number(r?.left??0)||0,top:Number(r?.top??0)||0}}catch{return{left:0,top:0}}}",
  getScrollOffsets:
    "function a(){try{let r=window.scrollX??window.pageXOffset??document.documentElement?.scrollLeft??0,s=window.scrollY??window.pageYOffset??document.documentElement?.scrollTop??0;return{sx:Number(r)||0,sy:Number(s)||0}}catch{return{sx:0,sy:0}}}",
  nodeToAbsoluteXPath:
    'function N(){return(s=>{try{let n=e=>{if(!e||!e.parentNode)return 1;let u=1,d=`${e.nodeType}:${(e.nodeName||"").toLowerCase()}`;for(let l=e.previousSibling;l;l=l.previousSibling)`${l.nodeType}:${(l.nodeName||"").toLowerCase()}`===d&&(u+=1);return u},i=e=>{if(!e||e.nodeType===Node.DOCUMENT_NODE)return"";if(e.nodeType===Node.DOCUMENT_FRAGMENT_NODE)return"//";if(e.nodeType===Node.TEXT_NODE)return`text()[${n(e)}]`;if(e.nodeType===Node.COMMENT_NODE)return`comment()[${n(e)}]`;let u=(e.nodeName||"").toLowerCase();return`${u.includes(":")?`*[name()=\'${u}\']`:u}[${n(e)}]`},c=[],o=s;for(;o;){if(o.nodeType===Node.DOCUMENT_FRAGMENT_NODE){c.push("//"),o=o.host??null;continue}let e=i(o);e&&c.push(e),o=o.parentNode}c.reverse();let t="";for(let e of c)e==="//"?t=t?t.endsWith("/")?`${t}/`:`${t}//`:"//":t=t?t.endsWith("/")?`${t}${e}`:`${t}/${e}`:`/${e}`;return t||"/"}catch{return"/"}})(this)}',
  resolveDeepActiveElement:
    "function p(){try{return(s=>{let n=s.activeElement??null;for(;n&&n.shadowRoot&&n.shadowRoot.activeElement;)n=n.shadowRoot.activeElement;return n??null})(document)}catch{return null}}",
} as const;
export const a11yScriptGlobalRefs = {
  documentHasFocusStrict: "globalThis.__stagehandA11yScripts.documentHasFocusStrict",
  getBoundingRectLite: "globalThis.__stagehandA11yScripts.getBoundingRectLite",
  getScrollOffsets: "globalThis.__stagehandA11yScripts.getScrollOffsets",
  nodeToAbsoluteXPath: "globalThis.__stagehandA11yScripts.nodeToAbsoluteXPath",
  resolveDeepActiveElement: "globalThis.__stagehandA11yScripts.resolveDeepActiveElement",
} as const;
export type A11yScriptName = keyof typeof a11yScriptSources;
