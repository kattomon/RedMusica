const { chromium, webkit, devices } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
(async () => {
    for (const engine of [chromium, webkit]) {
        const browser = await engine.launch();
        try {
            const page = await browser.newPage({ ...(engine === webkit ? devices['iPhone 13'] : {}), ...(process.env.LIVE_COVERS && engine === webkit ? { ignoreHTTPSErrors: true } : {}) });
            const errors = []; let requests = 0;
            page.on('pageerror', e => errors.push(e.message));
            if (process.env.LIVE_COVERS) {
                page.on('requestfailed', r => console.log('Request failed:', r.url(), r.failure()));
                page.on('console', m => { if (m.type() === 'error') console.log(m.text()); });
            }
            await page.route('https://coverartarchive.org/**', r => r.fulfill({ status: 404, body: '' }));
            if (!process.env.LIVE_COVERS) {
                await page.route('https://itunes.apple.com/**', async r => {
                    requests++;
                    const term = new URL(r.request().url()).searchParams.get('term');
                    await r.fulfill({ contentType: 'text/javascript', body: new URL(r.request().url()).searchParams.get('callback') + '(' + JSON.stringify({ results: [
                        { artistName: 'Otro artista', collectionName: 'Amor Entre Sábanas', artworkUrl100: 'https://is1-ssl.mzstatic.com/wrong.jpg', collectionViewUrl: 'https://music.apple.com/cl/album/wrong/1' },
                        ...(term.includes('La Noche') ? [{ artistName: 'La Noche', collectionName: 'Amor Entre Sábanas', artworkUrl100: 'https://is1-ssl.mzstatic.com/right.jpg', collectionViewUrl: 'https://music.apple.com/cl/album/right/2' }] : [])
                    ] }) + ')' });
                });
                await page.route('https://*.mzstatic.com/**', r => r.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6fSAAAAAASUVORK5CYII=', 'base64') }));
                await page.route('https://tools.applemediaservices.com/**', r => r.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"/>' }));
            }
            await page.setContent('<img id="cover"><img id="second"><img id="missing">');
            await page.addScriptTag({ path: 'covers.js' });
            await page.evaluate(() => asignarPortada(document.querySelector('#cover'), 'https://coverartarchive.org/release-group/f6a18125-c2ab-4936-bb56-e03dda3a3ea6/front-500', 'Amor entre sábanas', 'La Noche'));
            await page.waitForFunction(() => { const img = document.querySelector('#cover'); return img.src.includes('mzstatic.com') && img.complete && img.naturalWidth > 0; }, null, { timeout: 30000 });
            assert.match(await page.locator('.fuente-portada').getAttribute('href'), /music\.apple\.com/);
            if (!process.env.LIVE_COVERS) {
                assert.match(await page.locator('#cover').getAttribute('src'), /right\.jpg/);
                await page.evaluate(() => asignarPortada(document.querySelector('#second'), 'https://coverartarchive.org/missing', 'Amor entre sabanas', 'La Noche'));
                await page.waitForFunction(() => document.querySelector('#second').src.includes('right.jpg'));
                assert.equal(requests, 1);
                await page.evaluate(async () => { ultimaConsultaPortada = 0; const found = await buscarPortadaAlternativa('Amor entre sábanas', 'Distinto'); if (found) throw Error('Wrong artist matched'); });
                await page.evaluate(() => { asignarPortada(document.querySelector('#missing'), 'https://coverartarchive.org/missing', 'Amor entre sábanas', 'La Noche'); asignarPortada(document.querySelector('#missing'), portadaAlternativa, 'Nuevo disco', 'Otro'); });
                assert.match(await page.locator('#missing').getAttribute('src'), /^data:/);
            }
            assert.deepEqual(errors, []);
            console.log(engine.name(), process.env.LIVE_COVERS ? 'PASS real La Noche fallback cover loaded' : 'PASS covers: exact artist/title, accents, deduplication, missing cover, stale selection');
        } finally { await browser.close(); }
    }
})().catch(e => { console.error(e); process.exitCode = 1; });
