/**
 * Flywheel OS — viewport mode toggle
 * Persists flywheel.viewport = "mobile" | "desktop"
 * On desktop widths: Mobile adds html.force-mobile (real layout ~390px).
 * On real phones (<700px): leave natural CSS; do not double-constrain.
 * Toggle mounts on <html> so body transform containment does not trap it.
 */
(function () {
  "use strict";

  var KEY = "flywheel.viewport";
  var MQ = window.matchMedia("(max-width: 700px)");

  function isRealPhone() {
    return MQ.matches;
  }

  function readPref() {
    try {
      var v = localStorage.getItem(KEY);
      return v === "mobile" ? "mobile" : "desktop";
    } catch (e) {
      return "desktop";
    }
  }

  function writePref(mode) {
    try {
      localStorage.setItem(KEY, mode);
    } catch (e) { /* ignore */ }
  }

  function apply(mode) {
    var useMobile = mode === "mobile" && !isRealPhone();
    document.documentElement.classList.toggle("force-mobile", useMobile);
    var desk = document.getElementById("fwModeDesktop");
    var mob = document.getElementById("fwModeMobile");
    if (desk) {
      desk.classList.toggle("active", mode === "desktop");
      desk.setAttribute("aria-pressed", mode === "desktop" ? "true" : "false");
    }
    if (mob) {
      mob.classList.toggle("active", mode === "mobile");
      mob.setAttribute("aria-pressed", mode === "mobile" ? "true" : "false");
    }
  }

  function ensureToggle() {
    if (document.getElementById("fwViewportToggle")) return;
    var el = document.createElement("div");
    el.className = "fw-viewport-toggle";
    el.id = "fwViewportToggle";
    el.setAttribute("role", "group");
    el.setAttribute("aria-label", "화면 보기");
    el.innerHTML =
      '<button type="button" id="fwModeDesktop" aria-pressed="false">데스크톱</button>' +
      '<button type="button" id="fwModeMobile" aria-pressed="false">모바일</button>';
    /* Mount on <html> so body { transform } does not contain the toggle */
    document.documentElement.appendChild(el);
    document.getElementById("fwModeDesktop").addEventListener("click", function () {
      writePref("desktop");
      apply("desktop");
    });
    document.getElementById("fwModeMobile").addEventListener("click", function () {
      writePref("mobile");
      apply("mobile");
    });
  }

  function boot() {
    ensureToggle();
    apply(readPref());
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  if (typeof MQ.addEventListener === "function") {
    MQ.addEventListener("change", function () {
      apply(readPref());
    });
  } else if (typeof MQ.addListener === "function") {
    MQ.addListener(function () {
      apply(readPref());
    });
  }
})();
