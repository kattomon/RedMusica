const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve('.');
const contentTypes = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
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

    const manifest = await page.evaluate(async () => (await (await fetch('./site.webmanifest')).json()));
    assert.equal(manifest.name, 'RedMusica');
    assert.equal(manifest.display, 'standalone');
    assert.deepEqual(manifest.icons.filter(icon => icon.sizes !== 'any').map(icon => icon.sizes), ['192x192', '512x512']);
    for (const [name, size] of [['app-icon-192.png', 192], ['app-icon-512.png', 512]]) {
        const icon = fs.readFileSync(path.join(root, name));
        assert.equal(icon.readUInt32BE(16), size, `${name} width`);
        assert.equal(icon.readUInt32BE(20), size, `${name} height`);
    }

    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    assert.equal(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)), true, 'the shell worker controls the installed web app');
    assert.equal(await page.evaluate(async () => (await caches.keys()).includes('redmusica-shell-v1')), true, 'the static app shell is cached');

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
    assert.deepEqual(pageErrors, [], 'PWA setup has no uncaught JavaScript errors');

    await browser.close();
    server.close();
    process.stdout.write('PASS PWA: standalone manifest, Android/iPhone icons, install prompt, static shell cache and offline notice\n');
})().catch(error => { server.close(); console.error(error); process.exit(1); });
