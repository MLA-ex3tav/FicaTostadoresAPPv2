// Evita flash de tema incorrecto al cargar (script síncrono en <head>).
(function () {
  try {
    var stored = localStorage.getItem("fica-theme");
    var theme =
      stored === "light" || stored === "dark"
        ? stored
        : window.matchMedia("(prefers-color-scheme: light)").matches
          ? "light"
          : "dark";
    document.documentElement.setAttribute("data-theme", theme);
  } catch (_) {}
})();
