import IndicatorManager from './indicatorManager.js';

export class AxNavigation extends HTMLElement {
    static readonly ElementName = 'ax-navigation';
    private root = this.attachShadow({ mode: 'open' });
    public canvas: HTMLCanvasElement;
    public ctx: CanvasRenderingContext2D;
    private indicatorManager: IndicatorManager;
    private $currentItem?: AxNavigationItem;
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
    }
    connectedCallback() {
        this.addEventListener('click', this.handleClick);
    }
    constructor() {
        super();
        let defaultItem;
        this.root.innerHTML = `
<div id="out">
    <div id="in">
        <canvas></canvas>
        <nav>
            <slot></slot>
        </nav>
    </div>
</div>
<style>
    :host([block]) { display: block; }
    :host([inline-block]) { display: inline-block; }
    :host([flex]) { display: flex; }
    :host([inline-flex]) { display: inline-flex; }
    :host([grid]) { display: grid; }
    :host([inline-grid]) { display: inline-grid; }
    #out { display: contents; }
    #in { display: block; position: relative; }
    canvas { pointer-events: none; position: absolute; image-rendering: pixelated; }
    nav { display: flex; }
    :host([horizontal]) #in { margin-bottom: var(--navigation-indicator-width); }
    :host([vertical]) #in { margin-left: var(--navigation-indicator-width); margin-bottom: auto;}
    :host([horizontal]) canvas { width: 100%; height: var(--navigation-indicator-width); bottom: calc(var(--navigation-indicator-width) * -1); }
    :host([vertical]) canvas { width: var(--navigation-indicator-width); height: 100%; left: calc(var(--navigation-indicator-width) * -1); }
    :host([vertical]) nav { flex-direction: column; }
    :host([horizontal]) ::slotted(ax-navigation-item) { margin: 8px 16px; padding: 8px 0; margin-bottom: 0 !important; --navigation-private-indicator-height: var(--navigation-indicator-width); --navigation-private-indicator-width: 100%; --navigation-private-indicator-left: 0; --navigation-private-indicator-bottom: calc(var(--navigation-indicator-width) * -1);}
    :host([vertical]) ::slotted(ax-navigation-item) { margin: 16px 16px; padding: 0 8px; margin-left: 0 !important; --navigation-private-indicator-height: 100%; --navigation-private-indicator-width: var(--navigation-indicator-width); --navigation-private-indicator-left: calc(var(--navigation-indicator-width) * -1); --navigation-private-indicator-bottom: 0;}
</style>
`
        if (
            this.attributes.getNamedItem('vertical') === null 
            && this.attributes.getNamedItem('horizontal') === null
        ) {
            this.attributes.setNamedItem(document.createAttribute('horizontal'));
        } 
        
        this.indicatorManager = new IndicatorManager(this, this.$currentItem);
        this.canvas = this.root.querySelector('canvas')!;
        this.ctx = this.canvas.getContext('2d')!;
        defaultItem = this.querySelector(`${AxNavigationItem.ElementName}[default]`) as AxNavigationItem | null;

        this.$currentItem = defaultItem || this.querySelector(AxNavigationItem.ElementName) as AxNavigationItem | null || undefined;

        setTimeout(() => this.$currentItem && this.$currentItem.highlight(), 0);
    }
}

export class AxNavigationItem extends HTMLElement {
    static readonly ElementName = 'ax-navigation-item';
    private root = this.attachShadow({ mode: 'open' });
    public container!: AxNavigation | null;
    private $indicator: HTMLElement;
    adoptedCallback() {
        this.connectedCallback();
    }
    connectedCallback() {
        this.container = this.closest(AxNavigation.ElementName) as AxNavigation || null;
    }
    highlight() {
        this.$indicator.classList.add('show');
    }
    deHighlight() {
        this.$indicator.classList.remove('show');
    }
    constructor() {
        super();
        this.root.innerHTML = `
<div class="main">
    <div id="slot">
        <slot></slot>
    </div>
    <i></i>
</div>
<style>
    :host { display: inline-block; position: relative; box-sizing: border-box; cursor: default; user-select: none; }
    :host([block]) { display: block; }
    :host([inline-block]) { display: inline-block; }
    :host([flex]) { display: flex; }
    :host([inline-flex]) { display: inline-flex; }
    :host([grid]) { display: grid; }
    :host([inline-grid]) { display: inline-grid; }
    #main { min-width: 64px; min-height: 32px; overflow: visible; }
    #slot { width: 100%; height: 100%; box-sizing: border-box; }
    i { width: var(--navigation-private-indicator-width); height: var(--navigation-private-indicator-height); left: var(--navigation-private-indicator-left); bottom: var(--navigation-private-indicator-bottom); background: var(--navigation-indicator-color); position: absolute; visibility: hidden; }
    i.show { visibility: visible; }
</style>`;

        this.$indicator = this.root.querySelector('i')!;
    }
}
