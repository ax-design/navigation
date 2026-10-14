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
}

async function playwright(name: string, url: string): Promise<Driver> {
    const pw = (await import('playwright')) as any;
    const browser = await pw[name].launch();
    const page = await browser.newPage({ viewport: { width: 700, height: 900 } });
    await page.goto(url);
    return {
        eval: (script) => page.evaluate(script),
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

async function drive(d: Driver) {
    for (;;) {
        const state = await d.eval<{ result: any }>('({ result: window.__result || null })');
        if (state.result) return state.result;
        await Bun.sleep(50);
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
