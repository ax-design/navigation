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
        return file.size ? new Response(file) : new Response('Not found', { status: 404 });
    },
});
console.log(`Demo running at ${server.url}`);
