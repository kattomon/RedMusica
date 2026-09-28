'use strict';

const SHELL_CACHE = 'redmusica-shell-v3';
const SHELL_FILES = [
    './',
    './index.html',
    './style.css?v=20260928-41',
    './site.webmanifest?v=20260928-1',
    './app-icon.svg',
    './app-icon-192.png',
    './app-icon-512.png',
    './config.js?v=20260927-18',
    './radio-panel.js?v=20260928-1',
    './radio.html',
    './radio.js?v=20260927-22',
    './script.js?v=20260928-3',
    './pwa.js?v=20260928-1',
    './covers.js?v=20260927-18',
    './search.js?v=20260927-18',
    './vendor/supabase-2.117.2.js',
    './cloud.js?v=20260928-2',
    './admin.js?v=20260927-19',
    './blackjack.js?v=20260928-1',
    './local.js?v=20260927-18'
];

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
        event.respondWith((async () => {
            try {
                const response = await fetch(request);
                if (response.ok) {
                    const cache = await caches.open(SHELL_CACHE);
                    await cache.put('./index.html', response.clone());
                }
                return response;
            } catch {
                return (await caches.match('./index.html')) || Response.error();
            }
        })());
        return;
    }

    event.respondWith((async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        try {
            const response = await fetch(request);
            if (response.ok && response.type === 'basic') {
                const cache = await caches.open(SHELL_CACHE);
                await cache.put(request, response.clone());
            }
            return response;
        } catch {
            return Response.error();
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
