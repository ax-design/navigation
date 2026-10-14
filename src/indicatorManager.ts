import BezierEasing from 'bezier-easing';
import { AxNavigation, AxNavigationItem } from './CustomElements.js';
import { StyleBinding, StyleSchema } from '@ax-design/typed-om';
import type { PropertyValue } from '@ax-design/typed-om';
import { NAVIGATION_PROPERTIES } from './schema.js';

const growAnimationFn = BezierEasing(0.7, 0, 1, 0.5);
const cutAnimationFn = BezierEasing(0.1, 0.9, 0.2, 1);
const animationBreakPoint = 0.3;

// When a transition is interrupted the curve is not restarted: the two ends continue from the
// segment already on screen, each with its own time constant, and the trailing end is held for a
// moment first. That is what keeps the staggered "lead end reaches out, trail end follows" shape
// of the original choreography. All three ratios scale with speed, so --navigation-indicator-speed
// stays the single duration knob.
const FOLLOW_LEAD_TAU = 0.05;   // lead end, ~30ms at 600ms: moves at once, no dead stop
const FOLLOW_TRAIL_TAU = 0.22;  // trail end, ~132ms at 600ms: catches up afterwards
const FOLLOW_TRAIL_HOLD = 0.13; // trail end held ~78ms at 600ms: this is the "reach out" part

interface IndicatorStyle {
  speed: number;
  color: string;
  width: number;
}

const navigationSchema = new StyleSchema(NAVIGATION_PROPERTIES);

function toCssColor(value: PropertyValue): string {
  if (Array.isArray(value)) {
    return `rgba(${value[0]}, ${value[1]}, ${value[2]}, ${value[3]})`;
  }
  if (typeof value === 'string') {
    return value;
  }
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
  private animationStartTime: number | null;
  private frameHandle: number | null;
  // Segment painted during the interrupted transition (canvas coordinates), used as the
  // starting point of the next one.
  private fromRect: { lo: number; hi: number } | null;
  private lastRect: { lo: number; hi: number } | null;
  // Normalized progress of each end towards its target after an interruption (0 = just left the
  // segment, 1 = arrived). lead drives the leading end, trail the trailing one. This is a
  // first-order follow, so it holds no velocity state and the motion always heads for the item
  // that was clicked last.
  private follow: { lead: number; trail: number; start: number } | null;
  private followTime: number;
  private $from?: AxNavigationItem;
  private $to?: AxNavigationItem;

  constructor($container: AxNavigation, $defaultHighlight?: AxNavigationItem) {
    this.$container = $container;
    this.animationStartTime = null;
    this.frameHandle = null;
    this.fromRect = null;
    this.lastRect = null;
    this.follow = null;
    this.followTime = -1;
    this.$from = $defaultHighlight;
    this.binding = new StyleBinding(navigationSchema, $container, $container.root);
  }

  // Cancel the queued frame before scheduling the next one, so only one chain runs at a time.
  private schedule(): void {
    if (this.frameHandle !== null) window.cancelAnimationFrame(this.frameHandle);
    this.frameHandle = window.requestAnimationFrame(this.paintCanvas.bind(this));
  }

  private getIndicatorStyle(): IndicatorStyle {
    this.binding.read();
    const widthVal = this.binding.get('--navigation-indicator-width');
    const colorVal = this.binding.get('--navigation-indicator-color');

    return {
      speed: parseSpeed(this.$container),
      color: toCssColor(colorVal),
      width: typeof widthVal === 'number' ? widthVal : 2,
    };
  }

  switch($from: AxNavigationItem | undefined, $to: AxNavigationItem) {
    const interrupting = this.animationStartTime != null;
    // An interrupted transition continues from the segment on screen instead of clearing and
    // jumping; only this path switches to the damped follow.
    this.fromRect = interrupting ? this.lastRect : null;
    this.follow = interrupting && this.lastRect ? { lead: 0, trail: 0, start: -1 } : null;
    this.followTime = -1;
    // Restart the clock: inheriting the elapsed time of the previous transition would complete
    // the new one on its first frame.
    this.animationStartTime = null;
    this.$from = $from;
    this.$to = $to;
    this.schedule();
  }

  // fromRect is stored in canvas coordinates; restore it to viewport coordinates through the
  // current canvas offset so that a scroll mid-transition does not leave the start behind.
  private resolveFromBox(
    negSide: 'left' | 'top',
    posSide: 'right' | 'bottom',
    indicatorSize: 'width' | 'height',
    canvasBox: DOMRect,
  ): { [key: string]: number } {
    if (this.fromRect) {
      const lo = canvasBox[negSide] + this.fromRect.lo;
      const hi = canvasBox[negSide] + this.fromRect.hi;
      return { [negSide]: lo, [posSide]: hi, [indicatorSize]: hi - lo };
    }
    const r = this.$from!.getBoundingClientRect();
    return { [negSide]: r[negSide], [posSide]: r[posSide], [indicatorSize]: r[indicatorSize] };
  }

  private paintCanvas(time: number) {
    this.frameHandle = null;

    // With no transition pending, return without touching any state. Otherwise animationStartTime
    // would be set to a non-null value that nothing ever clears, and every later switch would read
    // it as "a transition is in flight".
    if (!this.$from || !this.$to) return;

    if (this.animationStartTime === null) this.animationStartTime = time;

    const canvasBox = this.$container.canvas.getBoundingClientRect();

    if (this.$from && this.$to) {
      this.$from.deHighlight();

      const animationTime = time - this.animationStartTime;
      const { speed, color } = this.getIndicatorStyle();
      const direction = this.$container.hasAttribute('vertical');

      const negSide = direction ? 'top' : 'left';
      const posSide = direction ? 'bottom' : 'right';
      const indicatorSize = direction ? 'height' : 'width';

      const fromBox = this.resolveFromBox(negSide, posSide, indicatorSize, canvasBox);
      const toBox = this.$to.getBoundingClientRect();

      const $canvas = this.$container.canvas;
      const ctx = this.$container.ctx;

      const reverse = fromBox[negSide] > toBox[negSide];
      // The end travelling towards the target is the lead end, the other one the trail end.
      const leadFrom = reverse ? fromBox[negSide] : fromBox[posSide];
      const leadTo = reverse ? toBox[negSide] : toBox[posSide];
      const trailFrom = reverse ? fromBox[posSide] : fromBox[negSide];
      const trailTo = reverse ? toBox[posSide] : toBox[negSide];

      let progress, growProgress, cutProgress
        , barStart, barLength, cutStart, cutLength;

      $canvas.width = canvasBox.width;
      $canvas.height = canvasBox.height;

      progress = animationTime / speed;

      if (this.follow) {
        const follow = this.follow;
        if (this.followTime < 0) this.followTime = time;
        // Advance by the real frame interval, capped so a backgrounded tab does not jump there
        // in a single step.
        const dt = Math.min(64, time - this.followTime);
        this.followTime = time;
        if (follow.start < 0) follow.start = time;
        if (dt > 0) {
          follow.lead += (1 - follow.lead) * (1 - Math.exp(-dt / (speed * FOLLOW_LEAD_TAU)));
          if (time - follow.start > speed * FOLLOW_TRAIL_HOLD) {
            follow.trail += (1 - follow.trail) * (1 - Math.exp(-dt / (speed * FOLLOW_TRAIL_TAU)));
          }
        }
        growProgress = follow.lead;
        cutProgress = follow.trail;
      } else {
        growProgress = progress < animationBreakPoint ? growAnimationFn(progress / animationBreakPoint) : 1;
        cutProgress = progress > animationBreakPoint ? cutAnimationFn((progress - animationBreakPoint) / (1 - animationBreakPoint)) : 0;
      }

      if (!reverse) {
        cutStart = barStart = fromBox[negSide] - canvasBox[negSide];
        barLength = fromBox[indicatorSize] + (toBox[posSide] - fromBox[posSide]) * growProgress;
        cutLength = (toBox[negSide] - fromBox[negSide]) * cutProgress;
      } else {
        barStart = fromBox[negSide] - canvasBox[negSide] - (fromBox[negSide] - toBox[negSide]) * growProgress;
        cutStart = fromBox[posSide] - canvasBox[negSide] - (fromBox[posSide] - toBox[posSide]) * cutProgress;
        barLength = (fromBox[negSide] - toBox[negSide]) * growProgress + fromBox[indicatorSize];
        cutLength = (fromBox[posSide] - toBox[posSide]) * cutProgress;
      }

      ctx.fillStyle = color;
      ctx.clearRect(0, 0, canvasBox.width, canvasBox.height);

      if (!direction) {
        ctx.fillRect(barStart, 0, barLength, canvasBox.height);
        ctx.clearRect(cutStart, 0, cutLength, canvasBox.height);
      } else {
        ctx.fillRect(0, barStart, canvasBox.width, barLength);
        ctx.clearRect(0, cutStart, canvasBox.width, cutLength);
      }

      // Remember what was actually painted this frame (canvas coordinates) so the next
      // interruption can continue from it.
      this.lastRect = reverse
        ? { lo: barStart, hi: cutStart }
        : { lo: barStart + cutLength, hi: barStart + barLength };

      const stillAnimating = this.follow
        ? Math.abs(leadTo - leadFrom) * (1 - growProgress) > 0.5 || Math.abs(trailTo - trailFrom) * (1 - cutProgress) > 0.5
        : progress < 1;

      if (stillAnimating) {
        this.schedule();
        return;
      }

      this.animationStartTime = null;
      this.lastRect = null;
      this.follow = null;

      ctx.clearRect(0, 0, canvasBox.width, canvasBox.height);
      this.$to && this.$to.highlight();

      this.$from = undefined;
      this.$to = undefined;
    }
  }
}

export default IndicatorManager;
