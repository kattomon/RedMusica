const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve('.');
const contentTypes = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname === '/uncached-document.html') {
        res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
        res.end('<!doctype html><h1>Other document</h1>');
        return;
    }
    const file = path.join(root, pathname === '/' ? 'index.html' : pathname.replace(/^\//, ''));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { res.writeHead(404); res.end('Not found'); return; }
    res.setHeader('Content-Type', contentTypes[path.extname(file)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.end(fs.readFileSync(file));
});

(async () => {
    await new Promise(resolve => server.listen(4175, '127.0.0.1', resolve));
    const browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto('http://127.0.0.1:4175/', { waitUntil: 'domcontentloaded' });

    const manifest = await page.evaluate(async () => (await fetch('./site.webmanifest?v=20260928-1')).json());
    assert.equal(manifest.name, 'RedMusica');
    assert.equal(manifest.display, 'standalone');
    assert.deepEqual(manifest.icons.filter(icon => icon.sizes !== 'any').map(icon => icon.sizes), ['192x192', '512x512']);
    for (const [name, size] of [['app-icon-192.png', 192], ['app-icon-512.png', 512]]) {
        const icon = fs.readFileSync(path.join(root, name));
        assert.equal(icon.readUInt32BE(16), size, `${name} width`);
        assert.equal(icon.readUInt32BE(20), size, `${name} height`);
    }

    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: 10000 });
    assert.equal(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)), true, 'the shell worker controls the installed web app');
    assert.equal(await page.evaluate(async () => (await caches.keys()).includes('redmusica-shell-v24')), true, 'the static app shell is cached');
    assert.equal(await page.evaluate(async () => Boolean(await (await caches.open('redmusica-shell-v24')).match('./pool.js?v=20261004-2'))), true, 'the current pool script is precached');
    assert.equal(await page.evaluate(async () => Boolean(await (await caches.open('redmusica-shell-v24')).match('./pool.css?v=20261004-1'))), true, 'the current pool styles are precached');
    assert.equal(await page.evaluate(async () => Boolean(await (await caches.open('redmusica-shell-v24')).match('./script.js?v=20261004-2'))), true, 'the current app loader is precached');
    assert.equal(await page.evaluate(async () => Boolean(await (await caches.open('redmusica-shell-v24')).match('./interface.js?v=20261003-3'))), true, 'the current navigation script is precached');
    assert.equal(await page.evaluate(async () => Boolean(await (await caches.open('redmusica-shell-v24')).match('./cloud.js?v=20261003-3'))), true, 'the current route script is precached');
    assert.equal(await page.evaluate(async () => Boolean(await (await caches.open('redmusica-shell-v24')).match('./supabase/functions/pool/engine.js?v=20261004-1'))), true, 'the current pool engine is precached');
    await page.evaluate(async () => {
        for(let version=1;version<=4;version++)await fetch('./layout.css?v=cache-test-'+version);
    });
    assert.equal(await page.evaluate(async () => (await (await caches.open('redmusica-shell-v24')).keys()).filter(key=>new URL(key.url).pathname.endsWith('/layout.css')).length),1,'only one cached version of each static file remains');
    await page.evaluate(async () => { await fetch('./README.md?cache-test=1'); });
    assert.equal(await page.evaluate(async () => Boolean(await (await caches.open('redmusica-shell-v24')).match('./README.md', { ignoreSearch: true }))), false, 'successful requests outside the static allowlist are not cached');

    await page.evaluate(() => {
        const prompt = new Event('beforeinstallprompt', { cancelable: true });
        prompt.prompt = () => { window.__installPromptCalled = true; };
        prompt.userChoice = Promise.resolve({ outcome: 'accepted' });
        window.dispatchEvent(prompt);
    });
    const installButton = page.locator('#instalarApp');
    await installButton.waitFor({ state: 'visible' });
    await installButton.click();
    await page.getByText('RedMusica se está instalando.').waitFor();
    assert.equal(await page.evaluate(() => window.__installPromptCalled), true);

    const navigation = await context.newPage();
    await navigation.goto('http://127.0.0.1:4175/radio.html?panel=1', { waitUntil: 'domcontentloaded' });
    assert.equal(await navigation.locator('h1').innerText(), 'Radio RedMusica');
    await navigation.goto('http://127.0.0.1:4175/uncached-document.html', { waitUntil: 'domcontentloaded' });
    assert.equal(await navigation.locator('h1').innerText(), 'Other document');

    await page.evaluate(() => {
        Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
        window.dispatchEvent(new Event('offline'));
    });
    await page.locator('#estadoConexion').waitFor({ state: 'visible' });
    await context.setOffline(true);
    await page.goto('http://127.0.0.1:4175/?seccion=memes', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
        Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
        window.dispatchEvent(new Event('offline'));
    });
    assert.equal(await page.locator('h1').innerText(), 'RedMusica', 'the cached app shell opens offline');
    assert.equal(await page.locator('#estadoConexion').isVisible(), true, 'offline use is clearly explained');
    await navigation.goto('http://127.0.0.1:4175/radio.html?panel=1&offline=1', { waitUntil: 'domcontentloaded' });
    assert.equal(await navigation.locator('h1').innerText(), 'Radio RedMusica', 'the radio retains its own offline document without replacing the home page');
    assert.equal(await page.evaluate(async () => (await fetch('./layout.css?v=uncached-offline')).ok), true, 'a new static version can use the retained version while offline');
    assert.deepEqual(pageErrors, [], 'PWA setup has no uncaught JavaScript errors');

    await browser.close();
    server.close();
    process.stdout.write('PASS PWA: standalone manifest, icons, install prompt, bounded static cache, excluded documents, separate offline home/radio and offline notice\n');
})().catch(error => { server.close(); console.error(error); process.exit(1); });
