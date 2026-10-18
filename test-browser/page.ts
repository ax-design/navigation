import { register, AxNavigation, AxNavigationItem } from '../src/index.js';

interface Check {
    name: string;
    ok: boolean;
    detail: string;
}
declare global {
    interface Window {
        __result?: unknown;
        __step?: string;
        __ack?: string;
        __caps?: { keys: boolean; snapshot: boolean };
        __snapshot?: string;
    }
}

const checks: Check[] = [];
const check = (name: string, ok: boolean, detail = '') => checks.push({ name, ok, detail });
const frames = (n: number) =>
    new Promise<void>((resolve) => {
        const step = () => (n-- <= 0 ? resolve() : requestAnimationFrame(step));
        requestAnimationFrame(step);
    });

// The extent of the pixels the indicator actually painted, in CSS pixels relative to the
// canvas, plus how many pixels are solid enough to count.
interface Painted {
    count: number;
    left: number;
    top: number;
    right: number;
    bottom: number;
}

function painted(nav: AxNavigation): Painted {
    const canvas = nav.canvas;
    const data = nav.ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const dpr = window.devicePixelRatio || 1;
    let count = 0;
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < canvas.width; x++) {
            if (data[(y * canvas.width + x) * 4 + 3] > 8) {
                count++;
                if (x < left) left = x;
                if (x > right) right = x;
                if (y < top) top = y;
                if (y > bottom) bottom = y;
            }
        }
    }
    return {
        count,
        left: left / dpr,
        top: top / dpr,
        right: (right + 1) / dpr,
        bottom: (bottom + 1) / dpr,
    };
}

const near = (a: number, b: number, tolerance = 1.5) => Math.abs(a - b) <= tolerance;

const $nav = (id: string) => document.getElementById(id) as AxNavigation;
const $item = (id: string) => document.getElementById(id) as AxNavigationItem;
const $el = (id: string) => document.getElementById(id) as HTMLElement;
const attr = (el: Element, name: string) => el.getAttribute(name);
const activeId = () => (document.activeElement ? document.activeElement.id : '');

// Asks the driver for a step a page cannot take by itself, a key press or a snapshot, and waits
// until the driver has taken it. Each request is numbered, so a repeated one is a new request.
let requests = 0;
async function request(step: string): Promise<void> {
    window.__step = step + '#' + requests++;
    while (window.__ack !== window.__step) await new Promise((resolve) => setTimeout(resolve, 10));
}
const press = (key: string) => request('key:' + key);

interface Switched {
    from: string;
    to: string;
    reason: string;
}
// The switch events a navigation fires, as the ids of the items and the reason.
function track(nav: AxNavigation): Switched[] {
    const log: Switched[] = [];
    nav.addEventListener('switch', (e: any) =>
        log.push({ from: e.detail.from ? e.detail.from.id : '', to: e.detail.to.id, reason: e.detail.reason })
    );
    return log;
}

// Whether the last key press was prevented by a handler, read after every handler has run.
let lastPrevented = false;
window.addEventListener('keydown', (e) => (lastPrevented = e.defaultPrevented));
// The alpha of one device pixel, addressed in the canvas' own CSS pixels.
const solid = (nav: AxNavigation, x: number, y: number) => {
    const dpr = window.devicePixelRatio || 1;
    return nav.ctx.getImageData(Math.floor(x * dpr), Math.floor(y * dpr), 1, 1).data[3] > 8;
};

function probeNav(vertical: boolean): AxNavigation {
    const nav = document.createElement(AxNavigation.ElementName) as AxNavigation;
    if (vertical) nav.setAttribute('vertical', '');
    nav.innerHTML = '<ax-navigation-item>One</ax-navigation-item><ax-navigation-item>Two</ax-navigation-item>';
    nav.style.setProperty('--navigation-indicator-speed', '1ms');
    document.body.appendChild(nav);
    return nav;
}

async function capabilities(): Promise<{ keys: boolean; snapshot: boolean }> {
    await request('caps?');
    return window.__caps || { keys: false, snapshot: false };
}

// Mode detection: from the items, overridden by the mode attribute, and kept in step with the
// items as they change. A none navigation warns, once.
async function modeChecks() {
    check('mode: links when an item holds a link', $nav('nav-links').effectiveMode === 'links', $nav('nav-links').effectiveMode);
    check('mode: tabs when the items hold only text', $nav('nav1').effectiveMode === 'tabs', $nav('nav1').effectiveMode);
    check('mode: none when an item holds a button', $nav('nav-button').effectiveMode === 'none', $nav('nav-button').effectiveMode);

    const warnings: string[] = [];
    const warn = console.warn;
    console.warn = (...args: unknown[]) => {
        warnings.push(String(args[0]));
    };
    try {
        const dyn = document.createElement(AxNavigation.ElementName) as AxNavigation;
        dyn.innerHTML = '<ax-navigation-item>One</ax-navigation-item><ax-navigation-item>Two</ax-navigation-item>';
        document.body.appendChild(dyn);
        await frames(2);
        check('mode: a navigation of plain text starts as tabs', dyn.effectiveMode === 'tabs', dyn.effectiveMode);

        dyn.setAttribute('mode', 'links');
        const forced = dyn.effectiveMode;
        dyn.setAttribute('mode', 'none');
        const none = dyn.effectiveMode;
        dyn.setAttribute('mode', 'unknown');
        const unknown = dyn.effectiveMode;
        dyn.removeAttribute('mode');
        check(
            'mode: the attribute names the mode, and any other value detects it',
            forced === 'links' && none === 'none' && unknown === 'tabs' && dyn.effectiveMode === 'tabs',
            forced + ' ' + none + ' ' + unknown
        );

        // The mode follows the children: a control arriving makes it none, and leaving brings it back.
        const hold = document.createElement(AxNavigationItem.ElementName) as AxNavigationItem;
        hold.innerHTML = '<button>Ask</button>';
        dyn.appendChild(hold);
        await frames(2);
        const withButton = dyn.effectiveMode;
        // The roles follow the mode too, so the host is checked as well as the mode it reports.
        const roleWithButton = attr(dyn, 'role');
        hold.remove();
        await frames(2);
        const afterRemoval = dyn.effectiveMode;
        const roleAfterRemoval = attr(dyn, 'role');
        dyn.appendChild(hold);
        await frames(2);
        check(
            'mode: re-detected when the children change',
            withButton === 'none' && roleWithButton === null && afterRemoval === 'tabs' && roleAfterRemoval === 'tablist' && dyn.effectiveMode === 'none',
            withButton + ' ' + afterRemoval + ' ' + roleWithButton + ' ' + roleAfterRemoval
        );
        const once = warnings.filter((text) => text.indexOf('ax-navigation:') === 0).length;
        check('mode: none warns once for the element', once === 1, 'warnings ' + once);

        // An explicit none is a choice the author made, so it does not warn.
        const quiet = document.createElement(AxNavigation.ElementName) as AxNavigation;
        quiet.setAttribute('mode', 'none');
        quiet.innerHTML = '<ax-navigation-item><button>Ask</button></ax-navigation-item>';
        document.body.appendChild(quiet);
        await frames(2);
        check('mode: an explicit none does not warn', warnings.length === 1, 'warnings ' + warnings.length);
    } finally {
        console.warn = warn;
    }
}

// Roles and states for each mode, on the fixtures and in the accessibility tree.
async function roleChecks() {
    const links = $nav('nav-links');
    check(
        'links: the host is a navigation, labelled by the author',
        attr(links, 'role') === 'navigation' && attr(links, 'aria-label') === 'Site sections',
        attr(links, 'role') + ' / ' + attr(links, 'aria-label')
    );
    check(
        'links: the items are list items',
        ['l1', 'l2', 'l3'].every((id) => attr($el(id), 'role') === 'listitem'),
        ''
    );
    check(
        'links: only the current item carries aria-current on its link',
        attr($el('l1a'), 'aria-current') === 'page' && !$el('l2a').hasAttribute('aria-current') && !$el('l3a').hasAttribute('aria-current'),
        ''
    );
    const linkContainer = links.root.querySelector('[part="items"]') as HTMLElement;
    check(
        'links: the shadow container is a list, and there is no nav landmark in the shadow',
        attr(linkContainer, 'role') === 'list' && !links.root.querySelector('nav'),
        ''
    );

    const tabs = $nav('nav1');
    check('tabs: the host is a tablist', attr(tabs, 'role') === 'tablist', String(attr(tabs, 'role')));
    check('tabs: the host orientation is horizontal', attr(tabs, 'aria-orientation') === 'horizontal', String(attr(tabs, 'aria-orientation')));
    check('tabs: a vertical navigation has a vertical orientation', attr($nav('nav-vertical-tabs'), 'aria-orientation') === 'vertical', '');
    const tabsTwo = $nav('nav-tabs');
    check(
        'tabs: the items are tabs, and the current one is selected',
        attr($el('t1'), 'role') === 'tab' && attr($el('t1'), 'aria-selected') === 'true' && attr($el('t3'), 'aria-selected') === 'false',
        ''
    );
    check(
        'tabs: the roving item is the one in the Tab order',
        attr($el('t1'), 'tabindex') === '0' && attr($el('t3'), 'tabindex') === '-1',
        attr($el('t1'), 'tabindex') + ' ' + attr($el('t3'), 'tabindex')
    );
    check(
        'tabs: a disabled item is aria-disabled and out of the Tab order',
        attr($el('t2'), 'aria-disabled') === 'true' && attr($el('t2'), 'tabindex') === '-1',
        ''
    );
    const tabsContainer = tabsTwo.root.querySelector('[part="items"]') as HTMLElement;
    check('tabs: the shadow container has no list role', !tabsContainer.hasAttribute('role'), '');

    const none = $nav('nav-button');
    check(
        'none: the host and the items get no role or tab stop',
        !none.hasAttribute('role') && !$el('b1').hasAttribute('role') && !$el('b1').hasAttribute('tabindex') && !$el('b2').hasAttribute('tabindex'),
        ''
    );
    check(
        'the current item is marked with the current attribute in every mode',
        $el('t1').hasAttribute('current') && $el('l1').hasAttribute('current') && $el('b1').hasAttribute('current') && !$el('t3').hasAttribute('current'),
        ''
    );
    check(
        'an author role on an item stays, and its selection is still written',
        attr($el('a1'), 'role') === 'menuitem' && attr($el('a1'), 'aria-selected') === 'true' && attr($nav('nav-authored'), 'role') === 'menubar',
        ''
    );
}

// The accessibility tree shows the roles and states the attributes give, where the browser builds one.
async function snapshotChecks() {
    await request('snap:nav-tabs');
    const tabsTree = window.__snapshot || '';
    check(
        'snapshot: the tabs are a tablist, with the selected one marked',
        /tablist "Sections"/.test(tabsTree) && /tab "Alpha" \[selected\]/.test(tabsTree) && /tab "Beta" \[disabled\]/.test(tabsTree),
        tabsTree.replace(/\n/g, ' | ')
    );
    await request('snap:nav-links');
    const linksTree = window.__snapshot || '';
    check(
        'snapshot: the links are a labelled navigation of list items',
        /navigation "Site sections"/.test(linksTree) && /list:/.test(linksTree) && /listitem/.test(linksTree) && /link "Alpha"/.test(linksTree),
        linksTree.replace(/\n/g, ' | ')
    );
}

// The author's attributes are never written over, and a mode change takes away only what the
// component wrote.
async function authorChecks() {
    const nav = document.createElement(AxNavigation.ElementName) as AxNavigation;
    nav.setAttribute('role', 'group');
    nav.innerHTML =
        '<ax-navigation-item id="x1">One</ax-navigation-item><ax-navigation-item id="x2" tabindex="7">Two</ax-navigation-item>';
    document.body.appendChild(nav);
    await frames(2);
    const x1 = $item('x1');
    const x2 = $item('x2');
    check('author: the role of the host is kept', attr(nav, 'role') === 'group', String(attr(nav, 'role')));
    check('author: the tabindex the author set is kept', attr(x2, 'tabindex') === '7', String(attr(x2, 'tabindex')));

    nav.setAttribute('mode', 'links');
    await frames(1);
    check('mode change: the host keeps the author role', attr(nav, 'role') === 'group', String(attr(nav, 'role')));
    check('mode change: the authored tabindex is kept', attr(x2, 'tabindex') === '7', String(attr(x2, 'tabindex')));
    check('mode change: the component roles are replaced', attr(x1, 'role') === 'listitem' && !x1.hasAttribute('aria-selected'), String(attr(x1, 'role')));

    x1.setAttribute('role', 'menuitem');
    nav.setAttribute('mode', 'none');
    await frames(1);
    check('mode change: a role the author changed is kept', attr(x1, 'role') === 'menuitem', String(attr(x1, 'role')));
    check('mode change: none removes the roles the component wrote', attr(x2, 'role') === null, String(attr(x2, 'role')));
    check('mode change: the authored attributes are all still there', attr(nav, 'role') === 'group' && attr(x2, 'tabindex') === '7', '');
    nav.remove();
}

// Tabs mode from the keyboard: one Tab stop, arrows move focus without selecting, Enter and Space
// select, and the keys stay on the navigation's own items.
async function keyboardChecks() {
    const tabs = $nav('nav-tabs');
    const log = track(tabs);
    const t1 = $item('t1');
    const t3 = $item('t3');
    const before = $el('before-tabs');
    const after = $el('after-tabs');

    before.focus();
    await press('Tab');
    check('keyboard: Tab lands on the current item', document.activeElement === t1, activeId());
    await press('ArrowRight');
    check('keyboard: ArrowRight moves focus past the disabled item', document.activeElement === t3, activeId());
    check('keyboard: arrows move focus and do not select', tabs.currentItem === t1 && log.length === 0, 'log ' + log.length);
    check('keyboard: the arrow of the tabs is prevented', lastPrevented, '');
    await press('ArrowRight');
    check('keyboard: focus stops at the last item, with no wrap', document.activeElement === t3, activeId());
    await press('Home');
    check('keyboard: Home focuses the first enabled item', document.activeElement === t1, activeId());
    await press('End');
    check('keyboard: End focuses the last enabled item', document.activeElement === t3, activeId());

    await press('Enter');
    check(
        'keyboard: Enter selects the focused item once, with reason keyboard',
        tabs.currentItem === t3 && log.length === 1 && log[0].reason === 'keyboard' && log[0].from === 't1' && log[0].to === 't3',
        JSON.stringify(log)
    );
    await press('Home');
    await press('Space');
    check(
        'keyboard: Space selects the focused item once, with reason keyboard',
        tabs.currentItem === t1 && log.length === 2 && log[1].reason === 'keyboard',
        JSON.stringify(log)
    );

    // Space scrolls a page that can scroll, unless the tabs keep it.
    const spacer = document.createElement('div');
    spacer.style.height = '3000px';
    document.body.appendChild(spacer);
    window.scrollTo(0, 0);
    t3.focus();
    await press('Space');
    const scrolled = window.scrollY;
    spacer.remove();
    window.scrollTo(0, 0);
    check('keyboard: Space does not scroll the page', scrolled === 0 && tabs.currentItem === t3, 'scrolled ' + scrolled);

    // Tab leaves the navigation, and Shift+Tab comes back to the Tab stop.
    await press('Tab');
    check('keyboard: Tab leaves the navigation', document.activeElement === after, activeId());
    after.focus();
    await press('Shift+Tab');
    check('keyboard: Shift+Tab returns to the Tab stop', document.activeElement === t3, activeId());

    // Modified keys are the browser's, and keys pressed outside the navigation are not ours.
    await press('Control+ArrowLeft');
    check('keyboard: a key with Control is left alone', document.activeElement === t3 && !lastPrevented, activeId());
    before.focus();
    await press('ArrowRight');
    check('keyboard: keys outside the navigation are left alone', document.activeElement === before && tabs.currentItem === t3, activeId());

    // A control inside the navigation that is not an item keeps its own keys.
    const field = $el('nav-field');
    field.focus();
    await press('ArrowRight');
    check('keyboard: a control inside the navigation keeps its keys', document.activeElement === field && !lastPrevented, activeId());

    // Vertical: ArrowUp and ArrowDown move focus, and the other arrows are the page's.
    const v1 = $item('v1');
    const v2 = $item('v2');
    const v3 = $item('v3');
    v1.focus();
    await press('ArrowDown');
    check('vertical: ArrowDown moves focus to the next item', document.activeElement === v2, activeId());
    await press('ArrowRight');
    check('vertical: ArrowRight is not prevented', document.activeElement === v2 && !lastPrevented, activeId());
    await press('ArrowDown');
    await press('ArrowDown');
    check('vertical: focus stops at the last item', document.activeElement === v3, activeId());
    await press('ArrowUp');
    check('vertical: ArrowUp moves focus back', document.activeElement === v2, activeId());

    // Right to left, the horizontal arrows swap.
    const r1 = $item('r1');
    const r2 = $item('r2');
    r1.focus();
    await press('ArrowLeft');
    check('rtl: ArrowLeft moves focus to the next item', document.activeElement === r2, activeId());
    await press('ArrowRight');
    check('rtl: ArrowRight moves focus back', document.activeElement === r1, activeId());

    // Links: the keys are the page's, Tab moves between the links, and a click moves aria-current.
    const links = $nav('nav-links');
    const linkLog = track(links);
    $el('l1a').focus();
    await press('ArrowRight');
    check('links: arrow keys are not prevented', document.activeElement === $el('l1a') && !lastPrevented, activeId());
    await press('Tab');
    check('links: Tab moves between the links', document.activeElement === $el('l2a'), activeId());
    $item('l2').click();
    await frames(3);
    check(
        'links: a click moves aria-current to the clicked link',
        attr($el('l2a'), 'aria-current') === 'page' && !$el('l1a').hasAttribute('aria-current'),
        ''
    );
    check('links: a click switches with reason pointer', linkLog.length === 1 && linkLog[0].reason === 'pointer', JSON.stringify(linkLog));

    // selection-follows-focus: the arrow selects, with reason keyboard.
    const follow = $nav('nav-follow');
    const followLog = track(follow);
    $el('s1').focus();
    await press('ArrowRight');
    check(
        'selection-follows-focus: ArrowRight selects with reason keyboard',
        follow.currentItem === $item('s2') && followLog.length === 1 && followLog[0].reason === 'keyboard',
        JSON.stringify(followLog)
    );
}

// select() and the currentItem setter: the indicator moves, the semantics follow, the event
// carries reason api, and a refused call changes nothing.
async function selectChecks() {
    const tabs = $nav('nav-tabs');
    const log = track(tabs);
    const t1 = $item('t1');
    const t2 = $item('t2');
    const t3 = $item('t3');
    tabs.select(t1);
    log.length = 0;

    const selected = tabs.select(t3);
    await frames(90);
    check('select: returns true and makes the item current', selected && tabs.currentItem === t3, String(selected));
    check(
        'select: fires switch with reason api',
        log.length === 1 && log[0].reason === 'api' && log[0].from === 't1' && log[0].to === 't3',
        JSON.stringify(log)
    );
    check(
        'select: the semantics follow the selection',
        attr(t3, 'aria-selected') === 'true' && attr(t1, 'aria-selected') === 'false' && attr(t3, 'tabindex') === '0',
        ''
    );
    const bar = painted(tabs);
    const canvasLeft = tabs.canvas.getBoundingClientRect().left;
    check(
        'select: the indicator moves to the item',
        near(bar.left, t3.getBoundingClientRect().left - canvasLeft, 2),
        'bar at ' + bar.left.toFixed(1) + ', item at ' + (t3.getBoundingClientRect().left - canvasLeft).toFixed(1)
    );
    check('select: a disabled item is refused', tabs.select(t2) === false && log.length === 1, '');
    check('select: the current item is refused', tabs.select(t3) === false && log.length === 1, '');
    check(
        'select: an item of another navigation is refused',
        tabs.select($item('item1')) === false && log.length === 1 && tabs.currentItem === t3,
        ''
    );
    check(
        'select: focus moves to the item when asked',
        tabs.select(t1, { focus: true }) && document.activeElement === t1 && log.length === 2 && log[1].reason === 'api',
        activeId()
    );
    tabs.currentItem = t3;
    check(
        'the currentItem setter selects with reason api',
        tabs.currentItem === t3 && log.length === 3 && log[2].reason === 'api',
        JSON.stringify(log)
    );

    const links = $nav('nav-links');
    links.select($item('l3'), { focus: true });
    check(
        'links: focus moves to the link of the selected item',
        document.activeElement === $el('l3a') && attr($el('l3a'), 'aria-current') === 'page',
        activeId()
    );
}

async function run() {
    register();
    register(); // idempotent check
    await frames(6);

    const nav1 = document.getElementById('nav1') as AxNavigation;
    const item1 = document.getElementById('item1') as AxNavigationItem;
    const item2 = document.getElementById('item2') as AxNavigationItem;

    check('elements registered', !!customElements.get(AxNavigation.ElementName) && !!customElements.get(AxNavigationItem.ElementName));
    check('canvas created', !!nav1.canvas && !!nav1.ctx);

    let switched = false;
    let switchedFrom: any = null;
    let switchedTo: any = null;
    let switchedReason = '';
    nav1.addEventListener('switch', (e: any) => {
        switched = true;
        switchedFrom = e.detail.from;
        switchedTo = e.detail.to;
        switchedReason = e.detail.reason;
    });

    item2.click();
    await frames(6);

    check('switch event fired on item click', switched && switchedFrom === item1 && switchedTo === item2);
    check('click-driven switch has reason pointer', switchedReason === 'pointer', 'reason ' + switchedReason);

    const vnav = document.getElementById('nav-vertical') as AxNavigation;
    const vitem1 = document.getElementById('vitem1') as AxNavigationItem;
    const vitem2 = document.getElementById('vitem2') as AxNavigationItem;

    let vSwitched = false;
    vnav.addEventListener('switch', (e: any) => {
        if (e.detail.from === vitem1 && e.detail.to === vitem2) {
            vSwitched = true;
        }
    });

    vitem2.click();
    await frames(6);
    check('switch event fired in vertical navigation', vSwitched);

    // A resting indicator is painted by the canvas, for the item that is current.
    const probe = probeNav(false);
    await frames(10);
    const first = probe.querySelector(AxNavigationItem.ElementName) as AxNavigationItem;
    const restBox = painted(probe);
    const firstRect = first.getBoundingClientRect();
    const probeRect = probe.getBoundingClientRect();
    check('resting indicator is painted on the canvas', restBox.count > 0, 'count ' + restBox.count);
    check(
        'resting bar spans the current item at the indicator thickness',
        near(restBox.right - restBox.left, firstRect.width, 2) && near(restBox.bottom - restBox.top, 2, 1.5),
        'bar ' + (restBox.right - restBox.left).toFixed(1) + 'x' + (restBox.bottom - restBox.top).toFixed(1) + ', item ' + firstRect.width.toFixed(1)
    );
    check(
        'resting bar sits against the edge of the content',
        near(restBox.bottom, probe.canvas.getBoundingClientRect().height, 1.5),
        'bar bottom ' + restBox.bottom.toFixed(1) + ' of ' + probe.canvas.getBoundingClientRect().height.toFixed(1)
    );

    // Surface shape properties drive the shape: rounding and a thicker bar.
    probe.style.setProperty('--navigation-indicator-width', '12px');
    probe.style.setProperty('--ax-radius', '6px');
    await frames(10);
    const rounded = painted(probe);
    const canvasBox = probe.canvas.getBoundingClientRect();
    check(
        'a thicker bar reaches twelve pixels',
        near(rounded.bottom - rounded.top, 12, 1.5),
        'height ' + (rounded.bottom - rounded.top).toFixed(1)
    );
    const cornerSolid = solid(probe, rounded.left, rounded.top);
    const centreSolid = solid(probe, rounded.left + 6, rounded.top + 6);
    check(
        'rounded corners leave the corner of the bar empty and its centre solid',
        !cornerSolid && centreSolid,
        'corner ' + cornerSolid + ', centre ' + centreSolid
    );
    check('the canvas still covers the whole bar', near(rounded.bottom, canvasBox.height, 1.5), 'bottom ' + rounded.bottom.toFixed(1) + ', canvas ' + canvasBox.height.toFixed(1));

    // A general edge property reaches the side through the fallback css, and an outward
    // feature grows the canvas and the reserved space with it.
    probe.style.setProperty('--ax-edge-top-kind', 'arc');
    probe.style.setProperty('--ax-edge-top-depth', '4px');
    probe.style.setProperty('--ax-edge-top-span', '60%');
    await frames(10);
    const bumped = painted(probe);
    check(
        'the general edge property reaches the side and sticks out',
        near(bumped.bottom - bumped.top, 16, 2),
        'height ' + (bumped.bottom - bumped.top).toFixed(1) + ' (bar 12 + arc 4)'
    );

    // Vertical navigation: the same shape, drawn into the strip left of the content.
    const vprobe = probeNav(true);
    await frames(10);
    const vfirst = vprobe.querySelector(AxNavigationItem.ElementName) as AxNavigationItem;
    const vBox = painted(vprobe);
    const vFirstRect = vfirst.getBoundingClientRect();
    check(
        'vertical indicator is a strip at the thickness and the item length',
        near(vBox.right - vBox.left, 2, 1.5) && near(vBox.bottom - vBox.top, vFirstRect.height, 2),
        'strip ' + (vBox.right - vBox.left).toFixed(1) + 'x' + (vBox.bottom - vBox.top).toFixed(1) + ', item ' + vFirstRect.height.toFixed(1)
    );
    check(
        'vertical strip sits left of the content',
        near(vBox.left + vBox.right, vprobe.canvas.getBoundingClientRect().width, 1.5),
        'strip right ' + vBox.right.toFixed(1) + ' of ' + vprobe.canvas.getBoundingClientRect().width.toFixed(1)
    );

    // The element carries the direction while the indicator runs, and the time each part of the
    // movement takes, so a feature can live inside the part whose end carries it.
    const anim = document.createElement(AxNavigation.ElementName) as AxNavigation;
    anim.className = 'animated-shape';
    anim.innerHTML = '<ax-navigation-item>One</ax-navigation-item><ax-navigation-item>Two</ax-navigation-item><ax-navigation-item>Three</ax-navigation-item>';
    document.body.appendChild(anim);
    await frames(8);
    const anims = anim.querySelectorAll(AxNavigationItem.ElementName);
    const animOne = anims[0] as AxNavigationItem;
    const animTwo = anims[1] as AxNavigationItem;
    const animThree = anims[2] as AxNavigationItem;
    const animBox = anim.canvas.getBoundingClientRect();
    check('a settled indicator does not carry the moving mark', !anim.hasAttribute('moving'));

    animTwo.click();
    check('the indicator carries the direction while it runs', anim.getAttribute('moving') === 'forward', 'moving=' + anim.getAttribute('moving'));
    // A registered time computes in seconds, a registered length in pixels.
    const timeMs = (name: string) => {
        const text = getComputedStyle(anim).getPropertyValue(name).trim();
        return text.endsWith('ms') ? parseFloat(text) : parseFloat(text) * 1000;
    };
    const computedNumber = (name: string) => parseFloat(getComputedStyle(anim).getPropertyValue(name)) || 0;
    const arrival = timeMs('--navigation-indicator-arrival');
    const follow = timeMs('--navigation-indicator-follow');
    check(
        'the element publishes the time of each part of the movement',
        arrival > 0 && Math.abs(arrival + follow - 600) < 2,
        'arrival ' + arrival + ', follow ' + follow
    );

    // The point grows over the leading end's travel and settles again after it, with the spring
    // the element drives. It rides the head, which is still on its way, so it never reaches past
    // the target's far edge.
    const twoRight = animTwo.getBoundingClientRect().right - animBox.left;
    let pointOut = 0;
    let leadPeak = 0;
    for (let i = 0; i < 24; i++) {
        await frames(1);
        const depth = computedNumber('--ax-edge-right-depth');
        const lead = computedNumber('--navigation-indicator-lead');
        if (depth > pointOut) pointOut = depth;
        if (lead > leadPeak) leadPeak = lead;
    }
    check('the point is out while the leading end travels', pointOut > 4, 'longest ' + pointOut.toFixed(1) + 'px');
    check('the element drives the deformation of an end', leadPeak > 0.6, 'reached ' + leadPeak.toFixed(2));

    // The notch belongs to the trailing end, and the bar is plain once it has arrived.
    let backAtLanding = false;
    for (let i = 0; i < 60 && !backAtLanding; i++) {
        await frames(1);
        if (anim.hasAttribute('moving')) continue;
        backAtLanding = painted(anim).right <= twoRight + 3;
    }
    check('the bar is plain when it lands', backAtLanding);
    const leadAtLanding = computedNumber('--navigation-indicator-lead');
    const trailAtLanding = computedNumber('--navigation-indicator-trail');
    check(
        'the deformation of each end is released by the time the bar lands',
        Math.abs(leadAtLanding) < 0.5 && Math.abs(trailAtLanding) < 0.5,
        'lead ' + leadAtLanding.toFixed(2) + ', trail ' + trailAtLanding.toFixed(2)
    );
    check(
        'the deformation rests at zero while the bar stands',
        computedNumber('--navigation-indicator-lead') === 0 && computedNumber('--navigation-indicator-trail') === 0,
        'lead ' + computedNumber('--navigation-indicator-lead') + ', trail ' + computedNumber('--navigation-indicator-trail')
    );

    // Interrupting starts the movement over, and the animation on it starts over with it.
    animThree.click();
    await frames(6);
    animOne.click();
    await frames(6);
    const afterInterrupt = painted(anim);
    const oneLeft = animOne.getBoundingClientRect().left - animBox.left;
    check('the direction follows an interrupted movement', anim.getAttribute('moving') === 'backward', 'moving=' + anim.getAttribute('moving'));
    const pointAfterInterrupt = computedNumber('--ax-edge-left-depth');
    check(
        'the point is out again after a movement was interrupted',
        pointAfterInterrupt > 4,
        'leading depth ' + pointAfterInterrupt.toFixed(1) + ', painted left ' + afterInterrupt.left.toFixed(1)
    );
    await frames(120);
    const settled = painted(anim);
    check(
        'it settles on the item it moved to',
        Math.abs(settled.left - oneLeft) < 3 && !anim.hasAttribute('moving'),
        'painted left ' + settled.left.toFixed(1) + ', item left ' + oneLeft.toFixed(1) + ', moving ' + anim.hasAttribute('moving')
    );
    check('the same item is current after the moves', anim.currentItem === animOne, 'current ' + (anim.currentItem === animOne ? 'One' : 'other'));

    await modeChecks();
    await roleChecks();
    // The snapshot is taken before any key moves the selection, so Alpha is the one selected.
    const caps = await capabilities();
    if (caps.snapshot) await snapshotChecks();
    await authorChecks();
    if (caps.keys) await keyboardChecks();
    if (caps.keys) await selectChecks();

    return { userAgent: navigator.userAgent, checks };
}

run().then(
    (r) => (window.__result = r),
    (e) => (window.__result = { error: String((e && e.stack) || e) })
);
