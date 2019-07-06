import BezierEasing from 'bezier-easing';
import { AxNavigation, AxNavigationItem } from './CustomElements';

const growAnimationFn = BezierEasing(0.7, 0, 1, 0.5);
const cutAnimationFn = BezierEasing(0.1, 0.9, 0.2, 1);
const animationBreakPoint = 0.3;

interface IndicatorStyle {
  speed: number,
  color: string,
  width: number
}

class IndicatorManager {
  private readonly $container: AxNavigation;
  private animationStartTime: number | null;
  private forceStopAnimation: boolean;
  private $from?: AxNavigationItem;
  private $to?: AxNavigationItem;

  constructor($container: AxNavigation, $defaultHighlight?: AxNavigationItem) {
    this.$container = $container;
    this.animationStartTime = null;
    this.forceStopAnimation = false;
    this.$from = $defaultHighlight;
  }
  private getIndicatorStyle(): IndicatorStyle {
    const computedStyle = this.$container.computedStyleMap();

    return {
      speed: computedStyle.get('--navigation-indicator-speed').value as number * 1000,
      color: computedStyle.get('--navigation-indicator-color').toString() as string,
      width: computedStyle.get('--navigation-indicator-width').value as number
    }
  }
  switch($from: AxNavigationItem | undefined, $to: AxNavigationItem) {
    this.$from = $from;
    this.$to = $to;
    this.forceStopAnimation = this.animationStartTime != null;
    window.requestAnimationFrame(this.paintCanvas.bind(this));
  }
  private paintCanvas(time: number) {
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

      const fromBox = this.$from.getBoundingClientRect();
      const toBox = this.$to.getBoundingClientRect();

      const $canvas = this.$container.canvas;
      const ctx = this.$container.ctx;

      if (!this.forceStopAnimation) {
        const reverse = fromBox[negSide] > toBox[negSide];

        let progress, growProgress, cutProgress
          , barStart, barLength, cutStart, cutLength;

        $canvas.width = canvasBox.width;
        $canvas.height = canvasBox.height;

        progress = animationTime / speed;
        growProgress = progress < animationBreakPoint ? growAnimationFn(progress / animationBreakPoint) : 1;
        cutProgress = progress > animationBreakPoint ? cutAnimationFn((progress - animationBreakPoint) / (1 - animationBreakPoint)) : 0;

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

        if (progress < 1) {
          window.requestAnimationFrame(this.paintCanvas.bind(this));
          return;
        }
      }

      this.animationStartTime = null;
      this.forceStopAnimation = false;

      ctx.clearRect(0, 0, canvasBox.width, canvasBox.height);
      this.$to && this.$to.highlight();

      this.$from = undefined;
      this.$to = undefined;
    }
  }
}

export default IndicatorManager;
