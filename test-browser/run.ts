// Builds and runs the browser test.
// Usage: bun test-browser/run.ts [chromium|firefox|webkit|safari ...]
import { join } from 'node:path';

const dir = import.meta.dir;
const dist = join(dir, 'dist');
if (!process.env.SKIP_BUILD) {
    const result = await Bun.build({ entrypoints: [join(dir, 'page.html')], outdir: dist, conditions: ['source'] });
    if (!result.success) throw new Error(result.logs.join('\n'));
}
const server = Bun.serve({
    port: 0,
    fetch(req) {
        const path = new URL(req.url).pathname;
        const file = Bun.file(join(dist, path === '/' ? 'page.html' : path));
        return file.size ? new Response(file) : new Response('', { status: 404 });
    },
});

interface Driver {
    eval<T>(script: string): Promise<T>;
    close(): Promise<void>;
    // Playwright only: a real key press, and the accessibility snapshot of an element.
    key?(key: string): Promise<void>;
    snapshot?(selector: string): Promise<string>;
    // Playwright only: the reduced motion and forced colors preferences the page reads.
    emulate?(reducedMotion: string, forcedColors: string): Promise<void>;
}

async function playwright(name: string, url: string): Promise<Driver> {
    const pw = (await import('playwright')) as any;
    // AX_BROWSER_PATH points the run at a system build instead.
    const executablePath = process.env.AX_BROWSER_PATH;
    const browser = await pw[name].launch(executablePath ? { executablePath } : {});
    const page = await browser.newPage({ viewport: { width: 700, height: 900 } });
    await page.goto(url);
    // Playwright builds without an aria snapshot skip the check that needs one.
    const hasSnapshot = typeof page.locator('body').ariaSnapshot === 'function';
    return {
        eval: (script) => page.evaluate(script),
        key: (key) => page.keyboard.press(key),
        snapshot: hasSnapshot ? (selector) => page.locator(selector).ariaSnapshot() : undefined,
        emulate: (reducedMotion, forcedColors) =>
            page.emulateMedia({ reducedMotion: reducedMotion as 'reduce' | 'no-preference', forcedColors: forcedColors as 'active' | 'none' }),
        close: () => browser.close(),
    };
}

async function safari(url: string): Promise<Driver> {
    const port = 4463;
    const proc = Bun.spawn(['safaridriver', '-p', String(port)]);
    await Bun.sleep(1000);
    const call = async (method: string, path: string, body?: unknown) => {
        const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
        const json = (await res.json()) as { value: any };
        if (json.value && json.value.error) throw new Error(json.value.message);
        return json.value;
    };
    const sid = (await call('POST', '/session', { capabilities: {} })).sessionId;
    await call('POST', `/session/${sid}/window/rect`, { width: 700, height: 1000 });
    await call('POST', `/session/${sid}/url`, { url });
    return {
        eval: (script) => call('POST', `/session/${sid}/execute/sync`, { script: `return (${script})`, args: [] }),
        async close() {
            await call('DELETE', `/session/${sid}`);
            proc.kill();
        },
    };
}

// The page asks for steps the driver can take with a real browser: key presses and snapshots.
// Each step is acknowledged, whether or not this driver can take it, so the page never waits on
// a browser that cannot.
async function drive(d: Driver) {
    for (;;) {
        const state = await d.eval<{ result: any; step: string; ack: string }>('({ result: window.__result || null, step: window.__step || "", ack: window.__ack || "" })');
        if (state.result) return state.result;
        if (state.step && state.step !== state.ack) {
            if (state.step.startsWith('caps?')) {
                await d.eval(`(window.__caps = ${JSON.stringify({ keys: !!d.key, snapshot: !!d.snapshot, emulate: !!d.emulate })})`);
            } else if (state.step.startsWith('emulate:')) {
                // emulate:reduce/active sets reduced motion and forced colors; the page sends the values.
                const [reducedMotion, forcedColors] = state.step.slice('emulate:'.length).split('#')[0].split('/');
                if (d.emulate) await d.emulate(reducedMotion, forcedColors);
            } else if (state.step.startsWith('key:')) {
                // key:Tab#3 presses Tab; the number only keeps a repeated step distinct.
                const key = state.step.slice('key:'.length).split('#')[0];
                if (d.key) await d.key(key);
            } else if (state.step.startsWith('snap:')) {
                // snap:nav-tabs#4 leaves the snapshot of #nav-tabs in window.__snapshot.
                const id = state.step.slice('snap:'.length).split('#')[0];
                if (d.snapshot) {
                    const text = await d.snapshot('#' + id);
                    await d.eval(`(window.__snapshot = ${JSON.stringify(text)})`);
                }
            }
            await d.eval(`(window.__ack = ${JSON.stringify(state.step)})`);
        }
        await Bun.sleep(20);
    }
}

let failed = 0;
for (const name of process.argv.slice(2).length ? process.argv.slice(2) : ['chromium']) {
    const url = `http://127.0.0.1:${server.port}/`;
    const d = name === 'safari' ? await safari(url) : await playwright(name, url);
    let result: any;
    try {
        result = await drive(d);
    } finally {
        await d.close();
    }
    if (result.error) {
        console.log(`${name}: ERROR ${result.error}`);
        failed++;
        continue;
    }
    const bad = result.checks.filter((c: any) => !c.ok);
    failed += bad.length;
    console.log(`${name}: ${result.checks.length - bad.length}/${result.checks.length} passed`);
    for (const c of bad) console.log(`  FAIL ${c.name}: ${c.detail}`);
}
server.stop();
process.exit(failed ? 1 : 0);
