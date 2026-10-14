import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const server = Bun.serve({
    port: Number(process.env.PORT || 3000),
    fetch(req) {
        let pathname = new URL(req.url).pathname;
        if (pathname === '/' || pathname === '/index.html') {
            pathname = '/docs/demo/index.html';
        }
        const file = Bun.file(join(root, pathname.startsWith('/') ? pathname.slice(1) : pathname));
        if (!file.size) return new Response('Not found', { status: 404 });
        // Never let a browser keep a bundle or a demo page from an earlier run: the demo is served
        // from a working tree whose build changes as the component does.
        return new Response(file, { headers: { 'Cache-Control': 'no-store' } });
    },
});
console.log(`Demo running at ${server.url}`);
