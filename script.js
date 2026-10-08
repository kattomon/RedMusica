// Keep the existing local demo available until the shared backend is configured.
(async function () {
    function cargarScript(src) {
        return new Promise(function (resolve, reject) {
            const script = document.createElement("script");
            script.src = src;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }
    try {
        await cargarScript("covers.js?v=20260927-18");
        await cargarScript("search.js?v=20260927-18");
        const config = window.REDMUSICA_CONFIG;
        if (config && config.supabaseUrl && config.supabasePublishableKey) {
            await cargarScript("vendor/supabase-2.117.2.js");
            await cargarScript("cloud.js?v=20261008-2");
            await cargarScript("admin.js?v=20260930-1");
            await cargarScript("blackjack.js?v=20260928-1");
            await cargarScript("pool.js?v=20261004-2").catch(() => {});
            await cargarScript("bachillerato.js?v=20261003-1").catch(() => {});
            await cargarScript("naipes.js?v=20261003-1").catch(() => {});
            await cargarScript("cancion.js?v=20261003-2").catch(() => {});
        } else {
            await cargarScript("local.js?v=20260927-18");
        }
    } catch (error) {
        document.getElementById("estadoPerfil").textContent = "No se pudo cargar la aplicación. Recarga la página para intentarlo de nuevo.";
    }
})();
