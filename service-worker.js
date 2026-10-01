'use strict';

const SHELL_CACHE = 'redmusica-shell-v13';
const SHELL_FILES = [
    './',
    './index.html',
    './style.css?v=20260930-54',
    './layout.css?v=20260929-1',
    './sections.css?v=20260929-1',
    './admin-ui.css?v=20260929-1',
    './pool.css?v=20261001-2',
    './interface.js?v=20261001-1',
    './site.webmanifest?v=20260929-1',
    './app-icon.svg',
    './app-icon-192.png',
    './app-icon-512.png',
    './config.js?v=20260927-18',
    './radio-panel.js?v=20260929-2',
    './radio.html',
    './radio.js?v=20260929-2',
    './script.js?v=20261001-2',
    './pwa.js?v=20260928-1',
    './covers.js?v=20260927-18',
    './search.js?v=20260927-18',
    './vendor/supabase-2.117.2.js',
    './cloud.js?v=20261001-1',
    './admin.js?v=20260930-1',
    './blackjack.js?v=20260928-1',
    './pool.js?v=20261001-3',
    './supabase/functions/pool/engine.js?v=20260930-1',
    './local.js?v=20260927-18'
];
const STATIC_PATHS = new Set(SHELL_FILES.map(file => new URL(file, self.registration.scope).pathname));
const DOCUMENT_PATHS = new Map([
    ['./', './index.html'],
    ['./index.html', './index.html'],
    ['./radio.html', './radio.html']
].map(([path, document]) => [new URL(path, self.registration.scope).pathname, document]));
let cacheWrites = Promise.resolve();
function saveStatic(request, response) {
    // Only one version per static file; arbitrary URLs and user content are never cached here.
    const url = new URL(typeof request === 'string' ? request : request.url, self.registration.scope);
    if (!STATIC_PATHS.has(url.pathname)) return Promise.resolve();
    cacheWrites = cacheWrites.catch(() => {}).then(async () => {
        const cache = await caches.open(SHELL_CACHE);
        await cache.put(request, response);
        const keys = await cache.keys();
        await Promise.all(keys.filter(key => new URL(key.url).pathname === url.pathname && key.url !== url.href).map(key => cache.delete(key)));
    });
    return cacheWrites;
}

self.addEventListener('install', event => {
    event.waitUntil((async () => {
        const cache = await caches.open(SHELL_CACHE);
        await cache.addAll(SHELL_FILES);
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.filter(key => key.startsWith('redmusica-shell-') && key !== SHELL_CACHE).map(key => caches.delete(key)));
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', event => {
    const request = event.request;
    if (request.method !== 'GET') return;
    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;

    if (request.mode === 'navigate') {
        const documentPath = DOCUMENT_PATHS.get(url.pathname);
        if (!documentPath) return;
        event.respondWith((async () => {
            try {
                const response = await fetch(request);
                if (response.ok) {
                    await saveStatic(documentPath, response.clone());
                }
                return response;
            } catch {
                return (await caches.match(documentPath)) || Response.error();
            }
        })());
        return;
    }

    if (!STATIC_PATHS.has(url.pathname)) return;
    event.respondWith((async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        try {
            const response = await fetch(request);
            if (response.ok && response.type === 'basic') {
                await saveStatic(request, response.clone());
            }
            return response;
        } catch {
            return (await caches.match(request, { ignoreSearch: true })) || Response.error();
        }
    })());
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    event.waitUntil((async () => {
        const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        const app = windows.find(client => new URL(client.url).origin === self.location.origin && new URL(client.url).pathname.startsWith(self.registration.scope.replace(self.location.origin, '')));
        if (app) {
            const target = event.notification.data?.url;
            if (target && typeof app.navigate === 'function') await app.navigate(new URL(target, self.registration.scope).href);
            await app.focus();
            return;
        }
        await self.clients.openWindow(self.registration.scope);
    })());
});

self.addEventListener('push', event => {
    event.waitUntil((async () => {
        const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        // RedMusica only shows alerts while the user still has the app open.
        if (!windows.length) return;
        let data = {};
        try { data = event.data?.json() || {}; } catch { data = { body: event.data?.text() || '' }; }
        const title = String(data.title || 'RedMusica').slice(0, 80);
        const body = String(data.body || 'Tienes una novedad en RedMusica.').slice(0, 180);
        await self.registration.showNotification(title, {
            body,
            icon: './app-icon-192.png',
            badge: './app-icon-192.png',
            tag: data.tag ? String(data.tag).slice(0, 100) : 'redmusica-notificacion',
            data: { url: typeof data.url === 'string' ? data.url : './' }
        });
    })());
});
