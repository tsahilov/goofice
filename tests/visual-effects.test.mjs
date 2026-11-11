import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVisualEffects } from '../visual-effects.mjs';
import { readFileSync } from 'node:fs';
function fixture() {
 const animations = [], classes = new Set();
 let resize;
 const preference = { matches: false, addEventListener: (_, listener) => preference.change = listener };
 const makeElement = () => ({ attrs: {}, children: [], classList: { add() {} }, setAttribute(k,v) { this.attrs[k]=v; }, append(child) { this.children.push(child); }, animate(frames,timing) { const animation = { frames,timing,cancelled:false,cancel() { this.cancelled=true; } }; animations.push(animation); return animation; } });
 globalThis.matchMedia = () => preference;
 globalThis.ResizeObserver = class { constructor(callback) { resize=callback; } observe() {} unobserve() {} };
 globalThis.document = { createElementNS: makeElement };
 globalThis.getComputedStyle = () => ({ borderTopLeftRadius: '10px' });
 const card = { dataset: { date:'2030-01-01' }, classList: { contains:name=>classes.has(name) }, width:180,height:130, getBoundingClientRect() { return {width:this.width,height:this.height}; }, append(svg) { this.svg=svg; } };
 const effects = createVisualEffects({ querySelector: () => card }, null);
 effects.identity('alan'); effects.attach(card);
 return { effects, card, animations, preference, classes, resize: () => resize([{target:card}]), rect: () => card.svg.children[0] };
}
test('restored/remote selection does not draw; confirmed local add draws dash, not opacity', () => {
 const f=fixture(); f.classes.add('is-selected'); f.effects.sync(f.card,true);
 assert.equal(f.animations.length,0);
 f.effects.confirmed(f.card.dataset.date,'alan',true);
 assert.deepEqual(f.animations[0].frames,[{strokeDashoffset:'1000'},{strokeDashoffset:'0'}]);
 assert.equal(f.animations[0].timing.duration,380);
 f.animations[0].onfinish(); assert.equal(f.animations[0].cancelled,true);
});
test('confirmation before snapshot waits; subsequent refreshes do not replay', () => {
 const f=fixture();f.effects.confirmed(f.card.dataset.date,'alan',true);assert.equal(f.animations.length,0);
 f.classes.add('is-selected');f.effects.sync(f.card,true);f.effects.sync(f.card,true);assert.equal(f.animations.length,1);
});
test('removal and fast re-add cancel the old draw without residual animation', () => {
 const f=fixture();f.classes.add('is-selected');f.effects.confirmed(f.card.dataset.date,'alan',true);
 f.effects.confirmed(f.card.dataset.date,'alan',false);assert.ok(f.animations[0].cancelled);
 f.effects.confirmed(f.card.dataset.date,'alan',true);assert.equal(f.animations.length,2);assert.equal(f.animations[1].cancelled,false);
 f.effects.sync(f.card,false);assert.ok(f.animations[1].cancelled);
});
test('switching participant clears active and pending draws; existing marks stay static', () => {
 const f=fixture();f.classes.add('is-selected');f.effects.confirmed(f.card.dataset.date,'alan',true);
 f.effects.identity('dasha');assert.ok(f.animations[0].cancelled);f.effects.sync(f.card,true);assert.equal(f.animations.length,1);
 f.classes.delete('is-selected');f.effects.confirmed(f.card.dataset.date,'dasha',true);
 f.effects.identity('alan');f.effects.sync(f.card,true);assert.equal(f.animations.length,1);
});
test('contour follows size changes with constant radius and no scaling stroke', () => {
 const f=fixture();f.resize();assert.equal(f.rect().attrs.width,179);assert.equal(f.rect().attrs.height,129);assert.equal(f.rect().attrs.rx,9.5);assert.equal(f.rect().attrs['vector-effect'],'non-scaling-stroke');
 f.card.height=200;f.resize();assert.equal(f.rect().attrs.height,199);
 f.effects.resetCards();f.classes.add('is-selected');f.effects.confirmed(f.card.dataset.date,'alan',true);assert.equal(f.animations.length,0);
});
test('reduced motion suppresses new drawings and cancels running drawings immediately', () => {
 const f=fixture();f.classes.add('is-selected');f.preference.matches=true;f.effects.confirmed(f.card.dataset.date,'alan',true);assert.equal(f.animations.length,0);
 f.preference.matches=false;f.effects.confirmed(f.card.dataset.date,'alan',true);f.preference.matches=true;f.preference.change();assert.ok(f.animations[0].cancelled);
 const css=readFileSync(new URL('../styles.css',import.meta.url),'utf8');assert.match(css,/@media \(prefers-reduced-motion: reduce\)/);assert.match(css,/animation: none !important;\s*transition: none !important;/);
});
