import { SHAPE } from '@ax-design/surface/schema';
import IndicatorManager from './indicatorManager.js';
import { directionOf } from './bar.js';

export type NavigationMode = 'links' | 'tabs' | 'none';
export type SwitchReason = 'pointer' | 'keyboard' | 'api';

// What can take focus inside an item. An item holding one of these keeps its own semantics, so
// the navigation does not claim the item as a tab.
const FOCUSABLE = 'a, button, input, select, textarea, [tabindex], [contenteditable]';

// The attributes the component wrote on each element, with the value it wrote. An attribute
// whose value is no longer that one has been set by the author, so it is never touched again.
const written = new WeakMap<Element, Map<string, string>>();

function writeAttribute(element: Element, name: string, value: string | null): void {
    const current = element.getAttribute(name);
    const own = written.get(element);
    const ours = current !== null && own !== undefined && own.get(name) === current;
    if (current !== null && !ours) {
        if (own) own.delete(name);
        return;
    }
    if (value === null) {
        if (ours) element.removeAttribute(name);
        if (own) own.delete(name);
        return;
    }
    if (current !== value) element.setAttribute(name, value);
    const record = own || new Map<string, string>();
    record.set(name, value);
    written.set(element, record);
}

// Takes back what the component wrote on an element, and nothing the author wrote.
function releaseAttributes(element: Element): void {
    const own = written.get(element);
    if (!own) return;
    for (const name of Array.from(own.keys())) writeAttribute(element, name, null);
}

// The nearest enabled item from an index, moving by step, without wrapping around the ends.
function enabledAt(items: AxNavigationItem[], from: number, step: number): AxNavigationItem | undefined {
    for (let i = from + step; i >= 0 && i < items.length; i += step) {
        if (!items[i].hasAttribute('disabled')) return items[i];
    }
    return undefined;
}

export class AxNavigation extends HTMLElement {
    static readonly ElementName = 'ax-navigation';

    static get observedAttributes(): string[] {
        return ['vertical', 'horizontal', 'mode'];
    }

    public root = this.attachShadow({ mode: 'open' });
    public canvas: HTMLCanvasElement;
    public ctx: CanvasRenderingContext2D;
    private indicatorManager!: IndicatorManager;
    private $currentItem?: AxNavigationItem;
    // The item the Tab key stops on in tabs mode. Arrow keys move it along with the focus.
    private $roving?: AxNavigationItem;
    private resizeObserver: ResizeObserver | null = null;
    private $slot: HTMLSlotElement | null = null;
    // The inner box, not the host, is what sizes and positions the canvas. The host is often
    // display: inline, an element whose observed box does not follow the layout, so it cannot be
    // the only thing watched.
    private $in!: HTMLDivElement;
    private $items!: HTMLElement;
    private warnedNone = false;

    // The window resizes even when neither watched box does: the page can reflow around the
    // element, and a browser zoom changes the device pixel ratio the canvas is sized by.
    private onWindowResize = () => this.indicatorManager.requestRest();

    // Only the first arrival matters: a later change must not take the highlight away from the
    // item the user selected. The roles follow every change, the mode is detected from the items.
    private onChildrenChange = () => {
        const current = this.$currentItem;
        if (!current || !this.contains(current)) {
            this.$currentItem = undefined;
            this.resolveCurrentItem();
            this.indicatorManager.requestRest();
        }
        this.applySemantics();
    };

    // Items and their links can change with no slot change to report, such as a link gaining an
    // href or an item being disabled, so the subtree is watched as well.
    private observer = new MutationObserver(() => this.onChildrenChange());

    get currentItem(): AxNavigationItem | undefined {
        return this.resolveCurrentItem();
    }

    set currentItem(item: AxNavigationItem | undefined) {
        if (item) this.select(item);
    }

    // The mode the element works in: the mode attribute when it names one, otherwise what the
    // items hold.
    get effectiveMode(): NavigationMode {
        return this.explicitMode() || this.detectMode();
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

    // The items of this navigation, not those of a navigation nested inside one of its items.
    private items(): AxNavigationItem[] {
        const found = Array.from(this.querySelectorAll(AxNavigationItem.ElementName)) as AxNavigationItem[];
        return found.filter((item) => item.closest(AxNavigation.ElementName) === this);
    }

    private explicitMode(): NavigationMode | null {
        const value = this.getAttribute('mode');
        return value === 'links' || value === 'tabs' || value === 'none' ? value : null;
    }

    // Links when an item has a link, tabs when nothing in an item can take focus, and none when
    // the items hold controls of their own.
    private detectMode(): NavigationMode {
        const items = this.items();
        if (items.some((item) => item.querySelector('a[href]') !== null)) return 'links';
        if (items.some((item) => item.querySelector(FOCUSABLE) !== null)) return 'none';
        return 'tabs';
    }

    // Makes an item current. Returns false, and does nothing, when the item is not one of this
    // navigation's, is disabled, or is already current.
    select(item: AxNavigationItem, options: { focus?: boolean } = {}): boolean {
        if (!this.commit(item, 'api')) return false;
        if (options.focus) this.focusItem(item);
        return true;
    }

    // Every way an item becomes current goes through here, so the indicator, the roles and the
    // switch event all agree. The current item is set before the event, so a listener reads the
    // new one.
    private commit(item: AxNavigationItem | undefined, reason: SwitchReason): boolean {
        const from = this.resolveCurrentItem();
        if (!item || item === from || item.hasAttribute('disabled') || this.items().indexOf(item) < 0) return false;
        this.indicatorManager.switch(from, item);
        this.$currentItem = item;
        this.$roving = item;
        this.applySemantics();
        this.dispatchEvent(new CustomEvent('switch', { detail: { from, to: item, reason } }));
        return true;
    }

    private focusItem(item: AxNavigationItem): void {
        const link = this.effectiveMode === 'links' ? (item.querySelector('a[href]') as HTMLElement | null) : null;
        (link || item).focus();
    }

    // The Tab stop: the item focus last moved to, else the current item, else the first enabled one.
    private rovingItem(items: AxNavigationItem[], current: AxNavigationItem | undefined): AxNavigationItem | undefined {
        const usable = (item: AxNavigationItem | undefined) =>
            !!item && items.indexOf(item) >= 0 && !item.hasAttribute('disabled');
        if (usable(this.$roving)) return this.$roving;
        if (usable(current)) return current;
        return items.filter((item) => !item.hasAttribute('disabled'))[0];
    }

    // Writes the roles and states of the effective mode. The attributes the author set stay.
    private applySemantics(): void {
        if (!this.isConnected) return;
        const explicit = this.explicitMode();
        const mode = explicit || this.detectMode();
        if (mode === 'none' && !explicit && !this.warnedNone) {
            this.warnedNone = true;
            console.warn(
                'ax-navigation: some items hold their own controls, so the items get no roles and no keyboard handling. ' +
                    'Set mode to "links" or "tabs" to choose the semantics, or to "none" to silence this warning.'
            );
        }
        const vertical = directionOf(this) === 'vertical';
        const items = this.items();
        const current = this.resolveCurrentItem();
        const roving = mode === 'tabs' ? this.rovingItem(items, current) : undefined;

        writeAttribute(this, 'role', mode === 'links' ? 'navigation' : mode === 'tabs' ? 'tablist' : null);
        writeAttribute(this, 'aria-orientation', mode === 'tabs' ? (vertical ? 'vertical' : 'horizontal') : null);
        // The shadow container is the list only where the items are list items.
        if (mode === 'links') this.$items.setAttribute('role', 'list');
        else this.$items.removeAttribute('role');

        for (const item of items) {
            const isCurrent = item === current;
            writeAttribute(item, 'current', isCurrent ? '' : null);
            writeAttribute(item, 'role', mode === 'tabs' ? 'tab' : mode === 'links' ? 'listitem' : null);
            writeAttribute(item, 'aria-selected', mode === 'tabs' ? String(isCurrent) : null);
            writeAttribute(item, 'aria-disabled', mode === 'tabs' && item.hasAttribute('disabled') ? 'true' : null);
            writeAttribute(item, 'tabindex', mode === 'tabs' ? (item === roving ? '0' : '-1') : null);
            const link = item.querySelector('a[href]');
            if (link) writeAttribute(link, 'aria-current', mode === 'links' && isCurrent ? 'page' : null);
        }
    }

    // Moves focus along the items, and selects too when the navigation follows its focus. Only
    // the keys of the navigation's own items are handled, so a widget inside an item keeps them.
    private handleKeyDown = (event: KeyboardEvent) => {
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        const source = event.composedPath()[0] as Element | undefined;
        if (!source || source.localName !== AxNavigationItem.ElementName) return;
        if (source.closest(AxNavigation.ElementName) !== this) return;
        if (this.effectiveMode !== 'tabs') return;

        const item = source as AxNavigationItem;
        const key = event.key;
        if (key === 'Enter' || key === ' ' || key === 'Spacebar') {
            // Space would scroll the page; a held key would select over and over.
            event.preventDefault();
            if (!event.repeat) this.commit(item, 'keyboard');
            return;
        }

        const items = this.items();
        let to: AxNavigationItem | undefined;
        if (key === 'Home') {
            to = enabledAt(items, -1, 1);
        } else if (key === 'End') {
            to = enabledAt(items, items.length, -1);
        } else {
            // Horizontal bars run toward the end of the order with ArrowRight, unless the page is
            // right to left. The other axis is left to the page.
            const rtl = getComputedStyle(this).direction === 'rtl';
            const step = directionOf(this) === 'vertical'
                ? key === 'ArrowDown' ? 1 : key === 'ArrowUp' ? -1 : 0
                : key === 'ArrowRight' ? (rtl ? -1 : 1) : key === 'ArrowLeft' ? (rtl ? 1 : -1) : 0;
            if (!step) return;
            to = enabledAt(items, items.indexOf(item), step);
        }
        // Handled even at an end of the list, so the page does not scroll there.
        event.preventDefault();
        if (!to) return;
        this.$roving = to;
        this.applySemantics();
        to.focus();
        if (this.hasAttribute('selection-follows-focus')) this.commit(to, 'keyboard');
    };

    handleClick = (event: MouseEvent) => {
        if (!event.target) return;
        const $target = event.target as HTMLElement;
        const $item = $target.closest(AxNavigationItem.ElementName) as AxNavigationItem;

        if (!$item) return;
        if ($item.container !== this) return;
        this.commit($item, 'pointer');
    };

    // Vertical and horizontal swap the canvas box and the canonical bar space, so the indicator
    // is drawn again. The mode is re-applied for any change, as the orientation role follows it.
    attributeChangedCallback(name: string): void {
        if (!this.indicatorManager) return;
        if (name !== 'mode') this.indicatorManager.directionChanged();
        this.applySemantics();
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
        this.addEventListener('keydown', this.handleKeyDown);
        if (!this.$slot) {
            this.$slot = this.root.querySelector('slot');
            if (this.$slot) this.$slot.addEventListener('slotchange', this.onChildrenChange);
        }
        this.resolveCurrentItem();
        this.observer.observe(this, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['href', 'disabled'],
        });
        this.applySemantics();
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
        this.removeEventListener('keydown', this.handleKeyDown);
        this.observer.disconnect();
        window.removeEventListener('resize', this.onWindowResize);
        this.indicatorManager.unobserve();
        releaseAttributes(this);
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
            '        <div part="items" role="list">',
            '            <slot></slot>',
            '        </div>',
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
            '    [part="items"] { display: flex; }',
            '    :host([horizontal]) #in { margin-bottom: var(--navigation-private-indicator-outer); }',
            '    :host([vertical]) #in { margin-left: var(--navigation-private-indicator-outer); margin-bottom: auto; }',
            '    :host([horizontal]) canvas { width: 100%; height: var(--navigation-private-indicator-cross); bottom: calc(var(--navigation-private-indicator-outer) * -1); }',
            '    :host([vertical]) canvas { width: var(--navigation-private-indicator-cross); height: 100%; left: calc(var(--navigation-private-indicator-outer) * -1); }',
            '    :host([vertical]) [part="items"] { flex-direction: column; }',
            '    :host([horizontal]) ::slotted(ax-navigation-item) { margin: 8px 16px; padding: 8px 0; margin-bottom: 0 !important; }',
            '    :host([vertical]) ::slotted(ax-navigation-item) { margin: 16px 16px; padding: 0 8px; margin-left: 0 !important; }',
            '</style>',
        ].join('\n');
        this.canvas = this.root.querySelector('canvas')!;
        this.ctx = this.canvas.getContext('2d')!;
        this.$in = this.root.querySelector('#in')!;
        this.$items = this.root.querySelector('[part="items"]') as HTMLElement;
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

    // The roles and states go with the item; the navigation writes them again if it comes back.
    disconnectedCallback() {
        this.container = null;
        releaseAttributes(this);
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
