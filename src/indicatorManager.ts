import BezierEasing from 'bezier-easing';
import { StyleBinding, StyleSchema } from '@ax-design/typed-om';
import type { PropertyValue } from '@ax-design/typed-om';
import { Values, shapeSpecFrom } from '@ax-design/surface/schema';
import { resolve, traceContour } from '@ax-design/shape';
import { AxNavigation, AxNavigationItem } from './CustomElements.js';
import { NAVIGATION_PROPERTIES, PAD_INNER, PAD_OUTER } from './schema.js';
import { along, directionOf, matrix } from './bar.js';
import type { Along, Box, Direction } from './bar.js';

const growAnimationFn = BezierEasing(0.7, 0, 1, 0.5);
const cutAnimationFn = BezierEasing(0.1, 0.9, 0.2, 1);
const animationBreakPoint = 0.3;

const navigationSchema = new StyleSchema(NAVIGATION_PROPERTIES);

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

    unobserve(): void {
        this.binding.unobserve();
    }

    // Paints the bar of the current item, coalesced to one frame. Skipped while a transition
    // owns the canvas.
    requestRest(): void {
        if (this.animationStartTime !== null) return;
        if (this.restHandle !== null) window.cancelAnimationFrame(this.restHandle);
        this.restHandle = window.requestAnimationFrame(() => {
            this.restHandle = null;
            this.paintRest();
        });
    }

    private cancelRest(): void {
        if (this.restHandle !== null) window.cancelAnimationFrame(this.restHandle);
        this.restHandle = null;
    }

    // The direction changed: the canvas box and the canonical space turn with it, so a running
    // transition is dropped and the indicator is drawn again where the current item is.
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
        this.requestRest();
    }

    switch($from: AxNavigationItem | undefined, $to: AxNavigationItem): void {
        const interrupting = this.animationStartTime != null;
        this.fromRect = interrupting ? this.lastRect : null;
        // Time the new transition from the start, so the new target gets the whole speed
        // instead of the time the interrupted transition had already used.
        this.animationStartTime = null;
        this.$from = $from;
        this.$to = $to;
        this.cancelRest();
        this.schedule();
    }

    private schedule(): void {
        if (this.frameHandle !== null) window.cancelAnimationFrame(this.frameHandle);
        this.frameHandle = window.requestAnimationFrame(this.paint.bind(this));
    }

    // Reads the style the indicator is drawn with. Called when a transition starts and when the
    // style changed, not once per frame: the shape properties do not move while the bar grows.
    private readStyle(): IndicatorStyle {
        this.values.values = this.binding.read();
        const direction = directionOf(this.$container);
        const width = this.binding.get('--navigation-indicator-width');
        const thickness = Math.max(0, typeof width === 'number' ? width : 2);
        // Outward features stick out of the bar: the canvas box and the space the layout keeps
        // free have to cover them. The overhang does not depend on how long the bar is, so one
        // measurement at the container's own length is enough and the pads stay put while the
        // bar grows.
        const host = this.$container.getBoundingClientRect();
        const nominal = Math.max(1, direction === 'vertical' ? host.height : host.width);
        const bounds = resolve(shapeSpecFrom(this.values, nominal, thickness)).bounds;
        const padInner = Math.max(0, -bounds.top);
        const padOuter = Math.max(0, bounds.bottom - thickness);
        this.setPad(PAD_INNER, padInner);
        this.setPad(PAD_OUTER, padOuter);
        return {
            speed: parseSpeed(this.$container),
            color: toCssColor(this.binding.get('--navigation-indicator-color')),
            thickness,
            direction,
            padInner,
            padOuter,
        };
    }

    private setPad(name: string, value: number): void {
        const text = value + 'px';
        if (this.$container.style.getPropertyValue(name) === text) return;
        this.$container.style.setProperty(name, text);
    }

    private styleNow(): IndicatorStyle {
        return (this.style = this.readStyle());
    }

    // The bar the current item occupies, with no transition running.
    paintRest(): void {
        if (this.animationStartTime !== null) return;
        const style = this.style || this.styleNow();
        const item = this.$container.currentItem;
        if (!item) {
            this.clear();
            return;
        }
        const box = this.$container.canvas.getBoundingClientRect();
        const span = along(item.getBoundingClientRect(), box, style.direction);
        this.draw(span.start, span.start + span.size, style);
    }

    private paint(time: number): void {
        this.frameHandle = null;
        if (!this.$from || !this.$to) return;
        if (this.animationStartTime === null) this.animationStartTime = time;
        const style = this.style || this.styleNow();
        const canvasBox = this.$container.canvas.getBoundingClientRect();
        const from = this.startBox(canvasBox, style.direction);
        const to = along(this.$to.getBoundingClientRect(), canvasBox, style.direction);
        const fromEnd = from.start + from.size;
        const toEnd = to.start + to.size;
        const reverse = from.start > to.start;
        const progress = (time - this.animationStartTime) / style.speed;
        const grow = progress < animationBreakPoint ? growAnimationFn(progress / animationBreakPoint) : 1;
        const cut = progress > animationBreakPoint ? cutAnimationFn((progress - animationBreakPoint) / (1 - animationBreakPoint)) : 0;
        // The leading end extends first (grow) and the trailing end follows (cut). Moving
        // forward the leading end is the far one, moving backward it is the near one.
        const lo = reverse
            ? from.start - (from.start - to.start) * grow
            : from.start + (to.start - from.start) * cut;
        const hi = reverse
            ? fromEnd - (fromEnd - toEnd) * cut
            : fromEnd + (toEnd - fromEnd) * grow;
        this.draw(lo, hi, style);
        // Remember what was drawn, in canvas coordinates, so an interrupted transition
        // continues from the drawn bar instead of from the item it started at. There is no
        // scroll offset to correct for: the canvas travels with the items.
        this.lastRect = { lo, hi };
        if (progress < 1) {
            this.schedule();
            return;
        }
        this.animationStartTime = null;
        this.lastRect = null;
        this.$from = undefined;
        this.$to = undefined;
        this.paintRest();
    }

    // The bar the transition starts from: either the part drawn by the interrupted transition
    // or the whole item it starts at.
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
    private draw(lo: number, hi: number, style: IndicatorStyle): void {
        const ctx = this.$container.ctx;
        const size = this.resize();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, size.width, size.height);
        const length = hi - lo;
        if (!(length > 0) || !(style.thickness > 0)) return;
        const shape = resolve(shapeSpecFrom(this.values, length, style.thickness));
        const dpr = window.devicePixelRatio || 1;
        const m = matrix(style.direction, style.thickness, style.padInner, style.padOuter, dpr);
        ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
        ctx.translate(lo, 0);
        ctx.fillStyle = style.color;
        ctx.beginPath();
        traceContour(ctx, shape.outline);
        ctx.fill();
    }
}

export default IndicatorManager;
