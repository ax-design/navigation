import { SHAPE } from '@ax-design/surface/schema';
import IndicatorManager from './indicatorManager.js';

export class AxNavigation extends HTMLElement {
    static readonly ElementName = 'ax-navigation';

    static get observedAttributes(): string[] {
        return ['vertical', 'horizontal'];
    }

    public root = this.attachShadow({ mode: 'open' });
    public canvas: HTMLCanvasElement;
    public ctx: CanvasRenderingContext2D;
    private indicatorManager!: IndicatorManager;
    private $currentItem?: AxNavigationItem;
    private resizeObserver: ResizeObserver | null = null;
    private $slot: HTMLSlotElement | null = null;
    // The inner box, not the host, is what sizes and positions the canvas. The host is often
    // display: inline, an element whose observed box does not follow the layout, so it cannot be
    // the only thing watched.
    private $in!: HTMLDivElement;

    // The window resizes even when neither watched box does: the page can reflow around the
    // element, and a browser zoom changes the device pixel ratio the canvas is sized by.
    private onWindowResize = () => this.indicatorManager.requestRest();

    // Only the first arrival matters: a later change must not take the highlight away from the
    // item the user selected.
    private onSlotChange = () => {
        const current = this.$currentItem;
        if (current && current.isConnected) return;
        this.$currentItem = undefined;
        this.resolveCurrentItem();
        this.indicatorManager.requestRest();
    };

    get currentItem(): AxNavigationItem | undefined {
        return this.resolveCurrentItem();
    }

    // The items may arrive after the constructor: an element built with createElement has none
    // yet, and one whose children change gets its first item later. The first item, or the one
    // marked default, becomes current when there is none.
    private resolveCurrentItem(): AxNavigationItem | undefined {
        if (this.$currentItem) return this.$currentItem;
        const marked = this.querySelector(AxNavigationItem.ElementName + '[default]') as AxNavigationItem | null;
        this.$currentItem =
            marked || (this.querySelector(AxNavigationItem.ElementName) as AxNavigationItem | null) || undefined;
        return this.$currentItem;
    }

    handleClick = (event: MouseEvent) => {
        if (!event.target) return;
        const $target = event.target as HTMLElement;
        const $item = $target.closest(AxNavigationItem.ElementName) as AxNavigationItem;

        if (!$item) return;
        if ($item.container !== this) return;
        if ($item === this.$currentItem) return;

        this.indicatorManager.switch(this.$currentItem, $item);
        const switchEvent = new CustomEvent('switch', { detail: { from: this.$currentItem, to: $item } });
        this.dispatchEvent(switchEvent);
        this.$currentItem = $item;
    };

    // Vertical and horizontal swap the canvas box and the canonical bar space, so the indicator
    // is drawn again.
    attributeChangedCallback(): void {
        if (!this.indicatorManager) return;
        this.indicatorManager.directionChanged();
    }

    connectedCallback() {
        // A navigation without either attribute is horizontal. This cannot happen in the
        // constructor: a custom element constructor must not put attributes on the element it
        // builds, or document.createElement fails with NotSupportedError.
        if (
            this.attributes.getNamedItem('vertical') === null
            && this.attributes.getNamedItem('horizontal') === null
        ) {
            this.attributes.setNamedItem(document.createAttribute('horizontal'));
        }
        this.addEventListener('click', this.handleClick);
        if (!this.$slot) {
            this.$slot = this.root.querySelector('slot');
            if (this.$slot) this.$slot.addEventListener('slotchange', this.onSlotChange);
        }
        this.resolveCurrentItem();
        // The detector reports style changes, including one report right after attaching; the
        // resize observer catches the layout changes the detector cannot see. The inner box is
        // watched besides the host, because the host can be inline and never report a change
        // while the bar the canvas is laid out on does.
        this.indicatorManager.observe();
        if (!this.resizeObserver) {
            this.resizeObserver = new ResizeObserver(() => this.indicatorManager.requestRest());
            this.resizeObserver.observe(this);
            this.resizeObserver.observe(this.$in);
        }
        window.addEventListener('resize', this.onWindowResize);
        this.indicatorManager.requestRest();
    }

    disconnectedCallback() {
        this.removeEventListener('click', this.handleClick);
        window.removeEventListener('resize', this.onWindowResize);
        this.indicatorManager.unobserve();
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }
    }

    constructor() {
        super();
        let defaultItem;
        this.root.innerHTML = [
            '<div id="out">',
            '    <div id="in">',
            '        <canvas></canvas>',
            '        <nav>',
            '            <slot></slot>',
            '        </nav>',
            '    </div>',
            '</div>',
            '<style>',
            // The shape properties are written on the host, so the fallback that passes a
            // general property to each side belongs in this shadow root.
            SHAPE.fallbackCss || '',
            // The canvas covers the bar plus whatever an outward decoration needs on either
            // side of it: the inner pad is toward the content, the outer pad away from it.
            '    :host { --navigation-private-indicator-cross: calc(var(--navigation-indicator-width, 2px) + var(--navigation-private-indicator-pad-inner, 0px) + var(--navigation-private-indicator-pad-outer, 0px)); --navigation-private-indicator-outer: calc(var(--navigation-indicator-width, 2px) + var(--navigation-private-indicator-pad-outer, 0px)); }',
            '    :host([block]) { display: block; }',
            '    :host([inline-block]) { display: inline-block; }',
            '    :host([flex]) { display: flex; }',
            '    :host([inline-flex]) { display: inline-flex; }',
            '    :host([grid]) { display: grid; }',
            '    :host([inline-grid]) { display: inline-grid; }',
            '    #out { display: contents; }',
            '    #in { display: block; position: relative; }',
            '    canvas { pointer-events: none; position: absolute; }',
            '    nav { display: flex; }',
            '    :host([horizontal]) #in { margin-bottom: var(--navigation-private-indicator-outer); }',
            '    :host([vertical]) #in { margin-left: var(--navigation-private-indicator-outer); margin-bottom: auto; }',
            '    :host([horizontal]) canvas { width: 100%; height: var(--navigation-private-indicator-cross); bottom: calc(var(--navigation-private-indicator-outer) * -1); }',
            '    :host([vertical]) canvas { width: var(--navigation-private-indicator-cross); height: 100%; left: calc(var(--navigation-private-indicator-outer) * -1); }',
            '    :host([vertical]) nav { flex-direction: column; }',
            '    :host([horizontal]) ::slotted(ax-navigation-item) { margin: 8px 16px; padding: 8px 0; margin-bottom: 0 !important; }',
            '    :host([vertical]) ::slotted(ax-navigation-item) { margin: 16px 16px; padding: 0 8px; margin-left: 0 !important; }',
            '</style>',
        ].join('\n');
        this.canvas = this.root.querySelector('canvas')!;
        this.ctx = this.canvas.getContext('2d')!;
        this.$in = this.root.querySelector('#in')!;
        defaultItem = this.querySelector(AxNavigationItem.ElementName + '[default]') as AxNavigationItem | null;
        this.$currentItem = defaultItem || (this.querySelector(AxNavigationItem.ElementName) as AxNavigationItem | null) || undefined;
        this.indicatorManager = new IndicatorManager(this);
    }
}

export class AxNavigationItem extends HTMLElement {
    static readonly ElementName = 'ax-navigation-item';
    private root = this.attachShadow({ mode: 'open' });
    public container!: AxNavigation | null;

    adoptedCallback() {
        this.connectedCallback();
    }

    connectedCallback() {
        this.container = (this.closest(AxNavigation.ElementName) as AxNavigation) || null;
    }

    disconnectedCallback() {
        this.container = null;
    }

    constructor() {
        super();
        this.root.innerHTML = [
            '<div class="main">',
            '    <div id="slot">',
            '        <slot></slot>',
            '    </div>',
            '</div>',
            '<style>',
            '    :host { display: inline-block; position: relative; box-sizing: border-box; cursor: default; user-select: none; }',
            '    :host([block]) { display: block; }',
            '    :host([inline-block]) { display: inline-block; }',
            '    :host([flex]) { display: flex; }',
            '    :host([inline-flex]) { display: inline-flex; }',
            '    :host([grid]) { display: grid; }',
            '    :host([inline-grid]) { display: inline-grid; }',
            '    #main { min-width: 64px; min-height: 32px; overflow: visible; }',
            '    #slot { width: 100%; height: 100%; box-sizing: border-box; }',
            '</style>',
        ].join('\n');
    }
}
