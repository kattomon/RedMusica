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
        await cargarScript("search.js?v=20260926-3");
        const config = window.REDMUSICA_CONFIG;
        if (config && config.supabaseUrl && config.supabasePublishableKey) {
            await cargarScript("vendor/supabase-2.117.2.js");
            await cargarScript("cloud.js?v=20260926-3");
        } else {
            await cargarScript("local.js?v=20260926-3");
        }
    } catch (error) {
        document.getElementById("estadoPerfil").textContent = "No se pudo cargar la aplicación. Recarga la página para intentarlo de nuevo.";
    }
})();
