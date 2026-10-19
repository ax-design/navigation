import BezierEasing from 'bezier-easing';
import { StyleBinding, StyleSchema } from '@ax-design/typed-om';
import type { PropertyValue } from '@ax-design/typed-om';
import { Values, shapeSpecFrom } from '@ax-design/surface/schema';
import { resolve, traceContour } from '@ax-design/shape';
import { AxNavigation, AxNavigationItem } from './CustomElements.js';
import {
    ARRIVAL_PROPERTY,
    FOLLOW_PROPERTY,
    LEAD_PROPERTY,
    NAVIGATION_PROPERTIES,
    PAD_INNER,
    PAD_OUTER,
    TRAIL_PROPERTY,
} from './schema.js';
import { along, directionOf, matrix } from './bar.js';
import type { Along, Box, Direction } from './bar.js';

const growAnimationFn = BezierEasing(0.7, 0, 1, 0.5);
const cutAnimationFn = BezierEasing(0.1, 0.9, 0.2, 1);
const animationBreakPoint = 0.3;
// A shape that a style keeps changing is followed for this long at most, counted from the frame
// the first change is seen. The numbers are compared instead of listening for transition events,
// which engines do not report the same way for custom properties.
const SHAPE_FOLLOW_LIMIT = 5000;
// An end is asked for its deformation while it still has this much of its travel to do; when its
// travel is practically over the spring is released.
const DEFORM_TRAVEL = 0.85;
// The trailing end follows the leading one: it is asked for while the leading end is more than
// half deformed, so the two overlap instead of waiting for the tail to start moving.
const FOLLOW_HALF = 0.5;

const navigationSchema = new StyleSchema(NAVIGATION_PROPERTIES);
const FORCED_QUERY = '(forced-colors: active)';

type Moving = 'forward' | 'backward';

// One end's deformation and the spring that drives it.
interface Deform {
    value: number;
    velocity: number;
    stiffness: number;
    damping: number;
}

interface IndicatorStyle {
    speed: number;
    color: string;
    thickness: number;
    direction: Direction;
    padInner: number;
    padOuter: number;
}

interface Rect {
    lo: number;
    hi: number;
}

function toCssColor(value: PropertyValue): string {
    if (Array.isArray(value)) {
        return 'rgba(' + value[0] + ', ' + value[1] + ', ' + value[2] + ', ' + value[3] + ')';
    }
    if (typeof value === 'string') return value;
    return 'rgb(0, 0, 0)';
}

// A media query of the environment, or null where the engine has no matchMedia. A query an engine
// does not know never matches, so an old engine simply takes the default path.
function mediaQuery(query: string): MediaQueryList | null {
    return typeof window.matchMedia === 'function' ? window.matchMedia(query) : null;
}

// Read per switch, so a change of the preference applies to the next movement without a reload.
function prefersReducedMotion(): boolean {
    const query = mediaQuery('(prefers-reduced-motion: reduce)');
    return !!query && query.matches;
}

// Engines before addEventListener on a query only have addListener, so both are tried.
function listenQuery(query: MediaQueryList, handler: () => void): void {
    if (typeof query.addEventListener === 'function') query.addEventListener('change', handler);
    else if (typeof query.addListener === 'function') query.addListener(handler);
}

function unlistenQuery(query: MediaQueryList, handler: () => void): void {
    if (typeof query.removeEventListener === 'function') query.removeEventListener('change', handler);
    else if (typeof query.removeListener === 'function') query.removeListener(handler);
}

// The margins the canvas keeps on either side of the bar, to 0.01 px, so a resolved bound that
// carries rounding error does not move the layout.
function roundPad(value: number): number {
    return Math.max(0, Math.round(value * 100) / 100);
}

function parseSpeed(element: Element, fallback = 600): number {
    const text = getComputedStyle(element).getPropertyValue('--navigation-indicator-speed').trim();
    if (!text) return fallback;
    if (text.endsWith('ms')) {
        const val = parseFloat(text);
        return isNaN(val) ? fallback : val;
    }
    if (text.endsWith('s')) {
        const val = parseFloat(text);
        return isNaN(val) ? fallback : val * 1000;
    }
    const val = parseFloat(text);
    return isNaN(val) ? fallback : val;
}

class IndicatorManager {
    private readonly $container: AxNavigation;
    private readonly binding: StyleBinding;
    private readonly values: Values;
    private style: IndicatorStyle | null;
    private animationStartTime: number | null;
    private frameHandle: number | null;
    private restHandle: number | null;
    private followHandle: number | null;
    private followUntil: number;
    // The shape numbers of the last paint, to tell whether a style is still changing them.
    private shapeKey: string;
    private readonly lead: Deform;
    private readonly trail: Deform;
    private deformHandle: number | null;
    private lastStep: number;
    // The part of the bar drawn when the previous transition was interrupted, in canvas
    // coordinates, so the next one continues from where the drawn one ended.
    private fromRect: Rect | null;
    private lastRect: Rect | null;
    private $from?: AxNavigationItem;
    private $to?: AxNavigationItem;
    // Watched while the element is connected, so the bar is painted again when forced colors start
    // or end.
    private forcedQuery: MediaQueryList | null;
    private readonly onForcedChange = (): void => {
        this.style = null;
        this.requestRest();
    };

    constructor($container: AxNavigation) {
        this.$container = $container;
        this.binding = new StyleBinding(navigationSchema, $container, $container.root);
        this.values = new Values(navigationSchema.specs);
        this.style = null;
        this.animationStartTime = null;
        this.frameHandle = null;
        this.restHandle = null;
        this.followHandle = null;
        this.followUntil = 0;
        this.shapeKey = '';
        this.lead = { value: 0, velocity: 0, stiffness: 400, damping: 32 };
        this.trail = { value: 0, velocity: 0, stiffness: 400, damping: 32 };
        this.deformHandle = null;
        this.lastStep = 0;
        this.fromRect = null;
        this.lastRect = null;
        this.$from = $container.currentItem;
        this.forcedQuery = null;
    }

    // The resting indicator follows style changes. The detector reports them from the shadow
    // root, including one report right after attaching.
    observe(): void {
        this.binding.observe(() => {
            this.style = null;
            this.requestRest();
        });
        this.watchForced();
    }

    // Detaching drops a movement that is in flight: without this the element would come back
    // with an animation that never ends and a mark that never goes away.
    unobserve(): void {
        this.binding.unobserve();
        this.unwatchForced();
        this.stop();
    }

    private watchForced(): void {
        this.unwatchForced();
        const query = mediaQuery(FORCED_QUERY);
        if (!query) return;
        this.forcedQuery = query;
        listenQuery(query, this.onForcedChange);
    }

    private unwatchForced(): void {
        if (!this.forcedQuery) return;
        unlistenQuery(this.forcedQuery, this.onForcedChange);
        this.forcedQuery = null;
    }

    // In forced colors the browser keeps the palette from the page and does not recolor a canvas,
    // so the bar takes the Highlight color, which only an element with that color can resolve.
    private indicatorColor(): string {
        const forced = mediaQuery(FORCED_QUERY);
        if (forced && forced.matches) {
            const highlight = getComputedStyle(this.$container.highlightProbe).color;
            if (highlight) return highlight;
        }
        return toCssColor(this.binding.get('--navigation-indicator-color'));
    }

    private stop(): void {
        if (this.frameHandle !== null) window.cancelAnimationFrame(this.frameHandle);
        this.frameHandle = null;
        this.cancelRest();
        this.stopFollow();
        this.animationStartTime = null;
        this.fromRect = null;
        this.lastRect = null;
        this.$from = this.$container.currentItem;
        this.$to = undefined;
        this.stopDeform();
        this.markMoving(null);
        this.resetDeform();
    }

    // Paints the bar of the current item, coalesced to one frame. Skipped while a movement owns
    // the canvas.
    requestRest(): void {
        if (this.animationStartTime !== null) return;
        if (this.restHandle !== null) window.cancelAnimationFrame(this.restHandle);
        this.restHandle = window.requestAnimationFrame(() => {
            this.restHandle = null;
            this.refreshRest();
        });
    }

    private cancelRest(): void {
        if (this.restHandle !== null) window.cancelAnimationFrame(this.restHandle);
        this.restHandle = null;
    }

    // The element carries the direction of the movement while the indicator runs, so a style can
    // follow it instead of guessing how long it lasts. An interrupted movement keeps it, so such
    // a style does not restart in the middle of one.
    private markMoving(moving: Moving | null, restart = false): void {
        if (moving === null) {
            if (this.$container.hasAttribute('moving')) this.$container.removeAttribute('moving');
            return;
        }
        const current = this.$container.getAttribute('moving');
        if (current === moving && !restart) return;
        if (current === moving) {
            // A movement that was interrupted starts over, so a style that runs on the mark
            // has to start over with it: dropping the mark and reading a layout property makes
            // the style system see the change before the mark comes back.
            this.$container.removeAttribute('moving');
            void this.$container.offsetWidth;
        }
        this.$container.setAttribute('moving', moving);
    }

    // Forward is toward the end of the item order: right in a horizontal navigation, down in a
    // vertical one, which is the direction the canonical bar space counts in.
    private isForward($from: AxNavigationItem, $to: AxNavigationItem): boolean {
        const from = $from.getBoundingClientRect();
        const to = $to.getBoundingClientRect();
        return directionOf(this.$container) === 'vertical' ? to.top >= from.top : to.left >= from.left;
    }

    // The direction changed: the canvas box and the canonical space turn with it, so a running
    // movement is dropped and the indicator is drawn again where the current item is.
    directionChanged(): void {
        if (this.frameHandle !== null) window.cancelAnimationFrame(this.frameHandle);
        this.frameHandle = null;
        this.style = null;
        this.animationStartTime = null;
        this.fromRect = null;
        this.lastRect = null;
        this.$from = this.$container.currentItem;
        this.$to = undefined;
        this.cancelRest();
        this.stopFollow();
        this.stopDeform();
        this.markMoving(null);
        this.resetDeform();
        this.requestRest();
    }

    switch($from: AxNavigationItem | undefined, $to: AxNavigationItem): void {
        // As in WinUI with animations off, the indicator is not moved: it is drawn on the new item.
        if (prefersReducedMotion()) {
            this.jump($to);
            return;
        }
        const interrupting = this.animationStartTime != null;
        this.fromRect = interrupting ? this.lastRect : null;
        // Time the new movement from the start, so the new target gets the whole speed instead of
        // the time the interrupted one had already used.
        this.animationStartTime = null;
        this.$from = $from;
        this.$to = $to;
        // Nothing to move from: the indicator is simply drawn where it belongs. The style is read
        // first, so the times a movement is animated on are written before the mark appears.
        this.lastStep = 0;
        if ($from) {
            if (!this.style) this.styleNow();
            this.markMoving(this.isForward($from, $to) ? 'forward' : 'backward', interrupting);
        }
        this.cancelRest();
        this.schedule();
    }

    // Draws the indicator at rest on an item at once. A movement in flight is dropped, springs and
    // mark included, so nothing is left running; the item is passed because the current one is
    // only set after the switch.
    private jump($to: AxNavigationItem): void {
        if (this.frameHandle !== null) window.cancelAnimationFrame(this.frameHandle);
        this.frameHandle = null;
        this.animationStartTime = null;
        this.fromRect = null;
        this.lastRect = null;
        this.$from = this.$container.currentItem;
        this.$to = undefined;
        this.cancelRest();
        this.stopDeform();
        this.markMoving(null);
        this.resetDeform();
        this.paintRest($to);
    }

    private schedule(): void {
        if (this.frameHandle !== null) window.cancelAnimationFrame(this.frameHandle);
        this.frameHandle = window.requestAnimationFrame(this.paint.bind(this));
    }

    // Reads the style the indicator is drawn with, including the margins an outward feature
    // needs. Called when a movement starts and when the style changed; the shape numbers
    // themselves are read again on every paint, because a style can animate them.
    private readStyle(): IndicatorStyle {
        this.values.values = this.binding.read();
        const direction = directionOf(this.$container);
        const speed = parseSpeed(this.$container);
        const thickness = Math.max(0, this.readNumber('--navigation-indicator-width', 2));
        // The two parts of a movement, as times a style can animate on.
        this.setTime(ARRIVAL_PROPERTY, speed * animationBreakPoint);
        this.setTime(FOLLOW_PROPERTY, speed * (1 - animationBreakPoint));
        // How hard each end's deformation follows its own travel.
        const stiffness = this.readNumber('--navigation-indicator-deform-stiffness', 400);
        const damping = this.readNumber('--navigation-indicator-deform-damping', 32);
        this.readDeformParameters(this.lead, 'lead', stiffness, damping);
        this.readDeformParameters(this.trail, 'trail', stiffness, damping);
        // Outward features stick out of the bar: the canvas box and the space the layout keeps
        // free have to cover them. The overhang does not depend on how long the bar is, so one
        // measurement at the container's own length is enough.
        const host = this.$container.getBoundingClientRect();
        const nominal = Math.max(1, direction === 'vertical' ? host.height : host.width);
        const bounds = resolve(shapeSpecFrom(this.values, nominal, thickness)).bounds;
        const padInner = roundPad(-bounds.top);
        const padOuter = roundPad(bounds.bottom - thickness);
        this.setPad(PAD_INNER, padInner);
        this.setPad(PAD_OUTER, padOuter);
        return {
            speed,
            color: this.indicatorColor(),
            thickness,
            direction,
            padInner,
            padOuter,
        };
    }

    private readNumber(name: string, fallback: number): number {
        const value = this.binding.get(name);
        return typeof value === 'number' ? value : fallback;
    }

    private setPad(name: string, value: number): void {
        const text = value + 'px';
        if (this.$container.style.getPropertyValue(name) === text) return;
        this.$container.style.setProperty(name, text);
    }

    private setTime(name: string, value: number): void {
        const text = Math.max(0, Math.round(value)) + 'ms';
        if (this.$container.style.getPropertyValue(name) === text) return;
        this.$container.style.setProperty(name, text);
    }

    // One end's deformation, written for a style to shape a feature with. It is the response of
    // a spring, not a curve of the movement.
    private setDeform(name: string, value: number): void {
        const text = String(Math.round(value * 1000) / 1000);
        if (this.$container.style.getPropertyValue(name) !== text) this.$container.style.setProperty(name, text);
    }

    private writeDeform(): void {
        this.setDeform(LEAD_PROPERTY, this.lead.value);
        this.setDeform(TRAIL_PROPERTY, this.trail.value);
    }

    private resetDeform(): void {
        this.lead.value = 0;
        this.lead.velocity = 0;
        this.trail.value = 0;
        this.trail.velocity = 0;
        this.writeDeform();
    }

    // Seconds since the last step, capped so a stalled frame cannot throw the springs off.
    private stepTime(time: number): number {
        const dt = this.lastStep > 0 ? Math.min(0.05, (time - this.lastStep) / 1000) : 1 / 60;
        this.lastStep = time;
        return dt > 0 ? dt : 1 / 60;
    }

    // One step of a damped follower toward its target. Substepped so a stiff spring stays stable.
    private stepDeform(deform: Deform, target: number, dt: number): void {
        const steps = Math.max(1, Math.min(8, Math.ceil(dt * 240)));
        const h = dt / steps;
        for (let i = 0; i < steps; i++) {
            const a = deform.stiffness * (target - deform.value) - deform.damping * deform.velocity;
            deform.velocity += a * h;
            deform.value += deform.velocity * h;
        }
    }

    private deformActive(): boolean {
        return (
            Math.abs(this.lead.value) > 0.01 ||
            Math.abs(this.lead.velocity) > 0.05 ||
            Math.abs(this.trail.value) > 0.01 ||
            Math.abs(this.trail.velocity) > 0.05
        );
    }

    // A movement ends with the springs still settling, so they keep running on their own until
    // they are back at rest.
    private continueDeform(): void {
        if (this.deformHandle !== null || this.animationStartTime !== null) return;
        if (!this.deformActive()) {
            // Settled: leave the numbers exactly at rest instead of at the last small value.
            this.resetDeform();
            return;
        }
        this.deformHandle = window.requestAnimationFrame((time) => {
            this.deformHandle = null;
            if (this.animationStartTime !== null) return;
            const dt = this.stepTime(time);
            this.stepDeform(this.lead, 0, dt);
            this.stepDeform(this.trail, 0, dt);
            this.writeDeform();
            this.paintRest();
            this.continueDeform();
        });
    }

    private stopDeform(): void {
        if (this.deformHandle !== null) window.cancelAnimationFrame(this.deformHandle);
        this.deformHandle = null;
    }

    // The stiffness and damping of one end: its own value unless it is the -1 sentinel, which
    // means "use the general one".
    private readDeformParameters(deform: Deform, part: string, stiffness: number, damping: number): void {
        const ownStiffness = this.readNumber('--navigation-indicator-' + part + '-stiffness', -1);
        const ownDamping = this.readNumber('--navigation-indicator-' + part + '-damping', -1);
        deform.stiffness = Math.max(0, ownStiffness < 0 ? stiffness : ownStiffness);
        deform.damping = Math.max(0, ownDamping < 0 ? damping : ownDamping);
    }

    private styleNow(): IndicatorStyle {
        return (this.style = this.readStyle());
    }

    private refreshRest(): void {
        if (this.paintRest()) this.followShape();
    }

    // Draws the bar of the current item with the numbers read now, and answers whether they
    // changed since the last paint.
    private paintRest(item: AxNavigationItem | undefined = this.$container.currentItem): boolean {
        if (this.animationStartTime !== null) return false;
        const style = this.style || this.styleNow();
        this.values.values = this.binding.read();
        const changed = this.takeShapeKey();
        if (!item) {
            this.clear();
            return changed;
        }
        const box = this.$container.canvas.getBoundingClientRect();
        const span = along(item.getBoundingClientRect(), box, style.direction);
        this.draw(span.start, span.start + span.size, style, style.thickness);
        return changed;
    }

    private takeShapeKey(): boolean {
        const key = JSON.stringify(this.values.values);
        if (key === this.shapeKey) return false;
        this.shapeKey = key;
        return true;
    }

    // Repaints the resting bar while its shape numbers keep changing, so a feature a style
    // animates keeps moving on the canvas after the indicator has arrived.
    private followShape(): void {
        if (this.followHandle !== null) return;
        if (this.followUntil === 0) this.followUntil = performance.now() + SHAPE_FOLLOW_LIMIT;
        this.followHandle = window.requestAnimationFrame(() => {
            this.followHandle = null;
            if (this.animationStartTime !== null || performance.now() >= this.followUntil || !this.paintRest()) {
                this.followUntil = 0;
                return;
            }
            this.followShape();
        });
    }

    private stopFollow(): void {
        if (this.followHandle !== null) window.cancelAnimationFrame(this.followHandle);
        this.followHandle = null;
        this.followUntil = 0;
    }

    private paint(time: number): void {
        this.frameHandle = null;
        if (!this.$from || !this.$to) {
            this.markMoving(null);
            this.resetDeform();
            return;
        }
        if (this.animationStartTime === null) this.animationStartTime = time;
        const style = this.style || this.styleNow();
        const progress = (time - this.animationStartTime) / style.speed;
        const grow = progress < animationBreakPoint ? growAnimationFn(progress / animationBreakPoint) : 1;
        const cut = progress > animationBreakPoint ? cutAnimationFn((progress - animationBreakPoint) / (1 - animationBreakPoint)) : 0;
        // The leading end is asked for its deformation while it still has travel to do; the
        // trailing end follows the leading one, so it starts growing once the head is past half of
        // its deformation and starts shrinking again once the head is half way back. Written
        // before the shape is read, so a frame draws the deformation of that frame.
        const dt = this.stepTime(time);
        this.stepDeform(this.lead, grow < DEFORM_TRAVEL ? 1 : 0, dt);
        this.stepDeform(this.trail, this.lead.value > FOLLOW_HALF ? 1 : 0, dt);
        this.writeDeform();
        // The shape numbers are read again on every frame, because a style can shape them.
        this.values.values = this.binding.read();
        const thickness = Math.max(0, this.readNumber('--navigation-indicator-width', style.thickness));
        const canvasBox = this.$container.canvas.getBoundingClientRect();
        const from = this.startBox(canvasBox, style.direction);
        const to = along(this.$to.getBoundingClientRect(), canvasBox, style.direction);
        const fromEnd = from.start + from.size;
        const toEnd = to.start + to.size;
        const reverse = from.start > to.start;
        // The drawn bar decides the direction, which is not the same as from-to when a movement
        // was interrupted behind its target.
        this.markMoving(reverse ? 'backward' : 'forward');
        // The leading end extends first (grow) and the trailing end follows (cut). Moving forward
        // the leading end is the far one, moving backward it is the near one.
        const lo = reverse
            ? from.start - (from.start - to.start) * grow
            : from.start + (to.start - from.start) * cut;
        const hi = reverse
            ? fromEnd - (fromEnd - toEnd) * cut
            : fromEnd + (toEnd - fromEnd) * grow;
        this.draw(lo, hi, style, thickness);
        // Remember what was drawn, in canvas coordinates, so an interrupted movement continues
        // from the drawn bar instead of from the item it started at. There is no scroll offset to
        // correct for: the canvas travels with the items.
        this.lastRect = { lo, hi };
        if (progress < 1) {
            this.schedule();
            return;
        }
        this.animationStartTime = null;
        this.lastRect = null;
        this.$from = undefined;
        this.$to = undefined;
        this.markMoving(null);
        this.refreshRest();
        // The springs are still settling: they run on until they are back at rest.
        this.continueDeform();
    }

    // The bar the movement starts from: either the part drawn by the interrupted movement or the
    // whole item it starts at.
    private startBox(canvasBox: Box, direction: Direction): Along {
        if (this.fromRect) {
            return { start: this.fromRect.lo, size: this.fromRect.hi - this.fromRect.lo };
        }
        const span = along(this.$from!.getBoundingClientRect(), canvasBox, direction);
        return { start: span.start, size: span.size };
    }

    // The canvas is sized in device pixels rather than by CSS, so the shape is drawn at the
    // resolution of the screen.
    private resize(): { width: number; height: number } {
        const canvas = this.$container.canvas;
        const box = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const width = Math.max(1, Math.round(box.width * dpr));
        const height = Math.max(1, Math.round(box.height * dpr));
        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
        }
        return { width, height };
    }

    private clear(): void {
        const size = this.resize();
        const ctx = this.$container.ctx;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, size.width, size.height);
    }

    // Draws the bar from lo to hi, in canonical coordinates relative to the canvas box.
    private draw(lo: number, hi: number, style: IndicatorStyle, thickness: number): void {
        const length = hi - lo;
        if (!(length > 0) || !(thickness > 0)) {
            this.clear();
            return;
        }
        const shape = resolve(shapeSpecFrom(this.values, length, thickness));
        // A feature that grows outward needs room on the canvas. The margins are written before
        // the box is measured, so the drawing and the box use the same ones.
        this.growPads(style, shape.bounds.top, shape.bounds.bottom, thickness);
        const size = this.resize();
        const ctx = this.$container.ctx;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, size.width, size.height);
        const dpr = window.devicePixelRatio || 1;
        const m = matrix(style.direction, thickness, style.padInner, style.padOuter, dpr);
        ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
        ctx.translate(lo, 0);
        ctx.fillStyle = style.color;
        ctx.beginPath();
        traceContour(ctx, shape.outline);
        ctx.fill();
    }

    // A growing feature can need more room than the style asked for. The margins only ever grow,
    // so a movement never takes the layout back and forth.
    private growPads(style: IndicatorStyle, top: number, bottom: number, thickness: number): void {
        const padInner = Math.max(style.padInner, roundPad(-top));
        const padOuter = Math.max(style.padOuter, roundPad(bottom - thickness));
        if (padInner === style.padInner && padOuter === style.padOuter) return;
        style.padInner = padInner;
        style.padOuter = padOuter;
        this.setPad(PAD_INNER, padInner);
        this.setPad(PAD_OUTER, padOuter);
    }
}

export default IndicatorManager;
