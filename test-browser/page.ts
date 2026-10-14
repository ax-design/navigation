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
    nav1.addEventListener('switch', (e: any) => {
        switched = true;
        switchedFrom = e.detail.from;
        switchedTo = e.detail.to;
    });

    item2.click();
    await frames(6);

    check('switch event fired on item click', switched && switchedFrom === item1 && switchedTo === item2);

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

    // The element carries the direction while the indicator runs. A style on the mark can run for
    // exactly as long as the movement, so its features are gone when the bar lands, instead of
    // catching up with it afterwards.
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
    await frames(16);
    const midFlight = painted(anim);
    const twoRight = animTwo.getBoundingClientRect().right - animBox.left;
    check(
        'the end feature is out in the middle of the movement',
        midFlight.right > twoRight + 4,
        'painted right ' + midFlight.right.toFixed(1) + ', item right ' + twoRight.toFixed(1)
    );

    // The animation brings the features back on its own, so nothing is left to retract after the
    // bar has landed.
    let backAtLanding = false;
    let stillOut = false;
    for (let i = 0; i < 60 && !backAtLanding; i++) {
        await frames(1);
        if (anim.hasAttribute('moving')) continue;
        const now = painted(anim);
        if (now.right > twoRight + 3) stillOut = true;
        backAtLanding = now.right <= twoRight + 3;
    }
    check(
        'the end feature is gone as soon as the bar lands',
        backAtLanding && !stillOut,
        'back at landing ' + backAtLanding + ', a frame was still out ' + stillOut
    );

    // Interrupting starts the movement over, and the animation on the mark starts over with it.
    animThree.click();
    await frames(6);
    animOne.click();
    await frames(16);
    const afterInterrupt = painted(anim);
    const oneLeft = animOne.getBoundingClientRect().left - animBox.left;
    check('the direction follows an interrupted movement', anim.getAttribute('moving') === 'backward', 'moving=' + anim.getAttribute('moving'));
    check(
        'the end feature is out again after a movement was interrupted',
        afterInterrupt.left < oneLeft - 4,
        'painted left ' + afterInterrupt.left.toFixed(1) + ', item left ' + oneLeft.toFixed(1)
    );
    await frames(120);
    const settled = painted(anim);
    check(
        'it settles on the item it moved to',
        Math.abs(settled.left - oneLeft) < 3 && !anim.hasAttribute('moving'),
        'painted left ' + settled.left.toFixed(1) + ', item left ' + oneLeft.toFixed(1) + ', moving ' + anim.hasAttribute('moving')
    );
    check('the same item is current after the moves', anim.currentItem === animOne, 'current ' + (anim.currentItem === animOne ? 'One' : 'other'));

    return { userAgent: navigator.userAgent, checks };
}

run().then(
    (r) => (window.__result = r),
    (e) => (window.__result = { error: String((e && e.stack) || e) })
);
