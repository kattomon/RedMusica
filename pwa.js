'use strict';

(() => {
    const installButton = document.getElementById('instalarApp');
    const installStatus = document.getElementById('estadoInstalacion');
    const offlineStatus = document.getElementById('estadoConexion');
    if (!installButton || !installStatus || !offlineStatus) return;

    let installPrompt = null;
    const isInstalled = () => navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
    const isAppleMobile = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    if (!isInstalled() && isAppleMobile) {
        installButton.hidden = false;
        installButton.textContent = 'Cómo instalar';
    }

    window.addEventListener('beforeinstallprompt', event => {
        event.preventDefault();
        installPrompt = event;
        if (!isInstalled()) {
            installButton.hidden = false;
            installButton.textContent = 'Instalar RedMusica';
        }
    });

    installButton.addEventListener('click', async () => {
        if (installPrompt) {
            installPrompt.prompt();
            const choice = await installPrompt.userChoice;
            installStatus.textContent = choice?.outcome === 'accepted'
                ? 'RedMusica se está instalando.'
                : 'Puedes instalarla cuando quieras desde el menú del navegador.';
            installPrompt = null;
            installButton.hidden = true;
            installStatus.hidden = false;
            return;
        }

        installStatus.textContent = isAppleMobile
            ? 'En Safari, toca Compartir y elige “Añadir a pantalla de inicio”. Luego abre RedMusica desde el icono.'
            : 'Abre el menú del navegador y elige “Instalar RedMusica” o “Añadir a pantalla de inicio”.';
        installStatus.hidden = false;
    });

    window.addEventListener('appinstalled', () => {
        installButton.hidden = true;
        installStatus.textContent = 'RedMusica quedó instalada en este dispositivo.';
        installStatus.hidden = false;
    });

    const updateConnectionStatus = () => { offlineStatus.hidden = navigator.onLine; };
    window.addEventListener('online', updateConnectionStatus);
    window.addEventListener('offline', updateConnectionStatus);
    updateConnectionStatus();

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./service-worker.js').catch(() => {});
    }
})();
