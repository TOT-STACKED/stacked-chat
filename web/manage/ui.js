import { h } from './dom.js';
import { initials } from './lib.js';

/** Stacked's own icon set (assets/icon-*.png). One place that says which icon means what. */
export const ICONS = {
  home: 'screen', knowledge: 'shield', people: 'people', insights: 'chart', settings: 'box', billing: 'till',
  communicate: 'wifi', training: 'food-safety', operations: 'truck', empty: 'box', rewards: 'jar',
};

export function tile(name, size = 40) {
  return h('span', { class: 'tile', style: `width:${size}px;height:${size}px` },
    h('img', { src: `assets/icon-${ICONS[name] || name}.png`, alt: '', width: size, height: size }));
}

export const logo = () => h('span', { class: 'logo' }, h('img', { src: 'assets/logo-stacked.png', alt: 'Stacked', height: 24 }));

const PALETTE = [['#FFF3CC', '#7A5900'], ['#DCCBF8', '#241660'], ['#D5F5B4', '#244106'], ['#FBC4DD', '#85003A'], ['#CFE7FA', '#0F4C8A'], ['#FFE0C9', '#9A3E0A']];
/** Round initials in a colour that is the same for the same text every time. */
export function avatar(text, { square = false, size = 32 } = {}) {
  let n = 0; for (const c of String(text)) n = (n * 31 + c.charCodeAt(0)) >>> 0;
  const [bg, fg] = PALETTE[n % PALETTE.length];
  return h('span', { class: `avatar ${square ? 'sq' : ''}`, 'aria-hidden': 'true', style: `background:${bg};color:${fg};width:${size}px;height:${size}px;font-size:${Math.round(size * 0.38)}px` }, initials(String(text)));
}

/** Title, one-line explanation and the main action: the same top of every screen. */
export function pageHeader({ icon, title, sub, actions }) {
  return h('div', { class: 'ph' },
    icon ? tile(icon, 48) : null,
    h('div', { class: 't' }, h('h1', { class: 'disp', text: title }), sub ? h('span', { class: 'sub', text: sub }) : null),
    actions ? h('div', { class: 'actions' }, actions) : null);
}

export const badge = (text, cls) => h('span', { class: `badge ${cls || ''}`, text });
