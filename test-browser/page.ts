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

    return { userAgent: navigator.userAgent, checks };
}

run().then(
    (r) => (window.__result = r),
    (e) => (window.__result = { error: String((e && e.stack) || e) })
);
