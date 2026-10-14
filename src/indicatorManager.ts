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

const navigationSchema = new StyleSchema(NAVIGATION_PROPERTIES);

type Moving = 'forward' | 'backward';

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
    // The part of the bar drawn when the previous transition was interrupted, in canvas
    // coordinates, so the next one continues from where the drawn one ended.
    private fromRect: Rect | null;
    private lastRect: Rect | null;
    private $from?: AxNavigationItem;
    private $to?: AxNavigationItem;

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
        this.fromRect = null;
        this.lastRect = null;
        this.$from = $container.currentItem;
    }

    // The resting indicator follows style changes. The detector reports them from the shadow
    // root, including one report right after attaching.
    observe(): void {
        this.binding.observe(() => {
            this.style = null;
            this.requestRest();
        });
    }

    // Detaching drops a movement that is in flight: without this the element would come back
    // with an animation that never ends and a mark that never goes away.
    unobserve(): void {
        this.binding.unobserve();
        this.stop();
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
        this.markMoving(null);
        this.clearBells();
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
        this.markMoving(null);
        this.clearBells();
        this.requestRest();
    }

    switch($from: AxNavigationItem | undefined, $to: AxNavigationItem): void {
        const interrupting = this.animationStartTime != null;
        this.fromRect = interrupting ? this.lastRect : null;
        // Time the new movement from the start, so the new target gets the whole speed instead of
        // the time the interrupted one had already used.
        this.animationStartTime = null;
        this.$from = $from;
        this.$to = $to;
        // Nothing to move from: the indicator is simply drawn where it belongs. The style is read
        // first, so the times a movement is animated on are written before the mark appears.
        if ($from) {
            if (!this.style) this.styleNow();
            this.markMoving(this.isForward($from, $to) ? 'forward' : 'backward', interrupting);
        }
        this.cancelRest();
        this.schedule();
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
            color: toCssColor(this.binding.get('--navigation-indicator-color')),
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

    // The deformation of one end of the movement: greatest half way through the travel of that
    // end, zero while it stands and when it has arrived.
    private setBell(name: string, value: number): void {
        const text = String(Math.round(value * 1000) / 1000);
        if (this.$container.style.getPropertyValue(name) !== text) this.$container.style.setProperty(name, text);
    }

    private clearBells(): void {
        this.setBell(LEAD_PROPERTY, 0);
        this.setBell(TRAIL_PROPERTY, 0);
    }

    private styleNow(): IndicatorStyle {
        return (this.style = this.readStyle());
    }

    private refreshRest(): void {
        if (this.paintRest()) this.followShape();
    }

    // Draws the bar of the current item with the numbers read now, and answers whether they
    // changed since the last paint.
    private paintRest(): boolean {
        if (this.animationStartTime !== null) return false;
        const style = this.style || this.styleNow();
        this.values.values = this.binding.read();
        const changed = this.takeShapeKey();
        const item = this.$container.currentItem;
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
            this.clearBells();
            return;
        }
        if (this.animationStartTime === null) this.animationStartTime = time;
        const style = this.style || this.styleNow();
        const progress = (time - this.animationStartTime) / style.speed;
        const grow = progress < animationBreakPoint ? growAnimationFn(progress / animationBreakPoint) : 1;
        const cut = progress > animationBreakPoint ? cutAnimationFn((progress - animationBreakPoint) / (1 - animationBreakPoint)) : 0;
        // The two ends as deformations a style can shape a feature with. Each is zero once its end
        // has arrived, so an end lands plain. They are written before the shape is read, so the
        // frame draws the deformation of the frame it belongs to.
        this.setBell(LEAD_PROPERTY, 4 * grow * (1 - grow));
        this.setBell(TRAIL_PROPERTY, 4 * cut * (1 - cut));
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
