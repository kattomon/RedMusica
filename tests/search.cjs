const { chromium, webkit, devices } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const file = path.join(process.cwd(), pathname === '/' ? 'index.html' : pathname);
    if (!fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(fs.readFileSync(file));
});
(async () => {
    await new Promise(resolve => server.listen(4175, '127.0.0.1', resolve));
    for (const engine of [chromium, webkit]) {
        const browser = await engine.launch();
        try {
            const page = await browser.newPage(engine === webkit ? { ...devices['iPhone 13'], serviceWorkers: 'block' } : { serviceWorkers: 'block' });
            const errors = [], requests = [];
            page.on('pageerror', error => errors.push(error.message));
            await page.route('**/config.js?*', route => route.fulfill({ contentType: 'text/javascript', body: 'window.REDMUSICA_CONFIG={};' }));
            await page.route('https://coverartarchive.org/**', route => route.fulfill({ status: 404, body: '' }));
            await page.route('https://itunes.apple.com/**', route => route.fulfill({ contentType: 'text/javascript', body: new URL(route.request().url()).searchParams.get('callback')+'({"results":[]})' }));
            let fail = false;
            await page.route('https://musicbrainz.org/**', route => {
                const url = new URL(route.request().url());
                requests.push(url);
                if (fail) return route.fulfill({ status: 503, body: '' });
                const empty = url.searchParams.get('query').includes('inexistente');
                const offset = Number(url.searchParams.get('offset'));
                const length = empty ? 0 : offset === 0 ? 20 : 1;
                const results = Array.from({ length }, (_, i) => ({
                    id: `00000000-0000-4000-8000-${String(offset + i).padStart(12, '0')}`,
                    title: offset + i === 0 ? 'Deseo, carne y voluntad' : 'Lanzamiento ' + (offset + i),
                    'artist-credit': [{ name: 'Candelabro' }], 'primary-type': i % 2 ? 'Single' : 'Album', 'first-release-date': '2025-10-01'
                }));
                return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ count: empty ? 0 : 21, 'release-groups': results }) });
            });
            await page.goto('http://127.0.0.1:4175/?seccion=musica');
            await page.waitForFunction(() => typeof consultarCampo === 'function');
            async function search() { await page.locator('#botonBuscar').click(); await page.waitForFunction(() => !document.querySelector('#botonBuscar').disabled); }
            await search(); assert.equal(requests.length, 0);
            await page.locator('#buscarArtista').fill('Candelabro'); await search();
            assert.equal(requests.at(-1).searchParams.get('query'), 'artist:"Candelabro"');
            assert.equal(await page.locator('.tarjeta-album').count(), 20);
            await page.locator('#masResultados').click(); await page.waitForFunction(() => document.querySelectorAll('.tarjeta-album').length === 21);
            assert.equal(requests.at(-1).searchParams.get('offset'), '20');
            assert.equal(await page.locator('#masResultados').isVisible(), false);
            await page.locator('#buscarAlbum').fill('Deseo carne'); await search();
            assert.equal(requests.at(-1).searchParams.get('query'), 'artist:"Candelabro" AND releasegroup:"Deseo" AND releasegroup:"carne"');
            assert.equal(requests.at(-1).searchParams.get('offset'), '0');
            await page.locator('.boton-elegir').first().click();
            assert.equal(await page.locator('#tituloAlbum').innerText(), 'Deseo, carne y voluntad');
            assert.equal(await page.locator('#artistaAlbum').innerText(), 'Candelabro');
            await page.locator('#buscarArtista').fill(''); await page.locator('#buscarAlbum').fill('inexistente'); await search();
            assert.equal(await page.locator('.tarjeta-album').count(), 0);
            assert.match(await page.locator('#estadoBusqueda').innerText(), /No se encontraron/);
            await page.locator('#buscarAlbum').fill('OR " : \\'); fail = true; await search();
            assert.match(await page.locator('#estadoBusqueda').innerText(), /No se pudo/);
            fail = false; await search(); assert.equal(await page.locator('.tarjeta-album').count(), 20);
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
            assert.deepEqual(errors, []);
            console.log(engine.name(), 'PASS search: artist, combined, album, pagination, empty, error/retry, selection, mobile, no JS errors');
        } finally { await browser.close(); }
    }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
