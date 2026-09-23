/**
 * Flywheel OS — Kiosk Check-in (shared store)
 */
(function () {
  "use strict";

  const CHECKIN_EARLY_MIN = 15;
  const SUCCESS_MS = 5000;

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function todayYMD(d = new Date()) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function formatTime(d) {
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function formatSlotRange(start, end) {
    return `${formatTime(start)} – ${formatTime(end)}`;
  }

  function maskName(name) {
    if (!name || name.length < 2) return name || "*";
    if (name.length === 2) return name[0] + "*";
    return name[0] + "*".repeat(name.length - 2) + name[name.length - 1];
  }

  function formatPhoneDisplay(digits) {
    if (!digits) return "010-";
    let d = digits;
    if (/^01[016789]/.test(d)) {
      if (d.length <= 3) return d;
      if (d.length <= 7) return d.slice(0, 3) + "-" + d.slice(3);
      return d.slice(0, 3) + "-" + d.slice(3, 7) + "-" + d.slice(7, 11);
    }
    if (d.length <= 3) return d;
    if (d.length <= 7) return d.slice(0, 3) + "-" + d.slice(3);
    return d.slice(0, 3) + "-" + d.slice(3, 7) + "-" + d.slice(7);
  }

  function normalizePhone(input) {
    const digits = String(input || "").replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 11) return null;
    if (!/^01[016789]\d{7,8}$/.test(digits)) return null;
    return digits;
  }

  function getBookings() {
    FlywheelStore.ensureSeeded();
    return FlywheelStore.load().bookings || [];
  }

  function isCheckedIn(bookingId) {
    const s = FlywheelStore.load();
    return !!(s.checkIns && s.checkIns[bookingId]);
  }

  function recordCheckin(bookingId, phone, extras) {
    FlywheelStore.update((draft) => {
      draft.checkIns[bookingId] = {
        at: new Date().toISOString(),
        phone: phone || "",
      };
      const b = draft.bookings.find((x) => x.id === bookingId);
      if (b) {
        b.status = "checked_in";
        if (extras) {
          if (extras.hasShootingAddon) b.hasShootingAddon = true;
          if (extras.shootingAddedAtKiosk) b.shootingAddedAtKiosk = true;
        }
      }
    });
    return Object.keys(FlywheelStore.load().checkIns || {}).length;
  }

  function resetDemo() {
    FlywheelStore.seedDemo();
  }

  let phoneDigits = "";
  let currentBooking = null;
  let successTimer = null;

  const $ = (sel) => document.querySelector(sel);
  const phoneDisplay = $("#phone-display");
  const btnLookup = $("#btn-lookup");
  const clockEl = $("#clock");
  const demoModal = $("#demo-modal");
  const demoList = $("#demo-list");

  function showScreen(id) {
    document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
    const el = document.getElementById(id);
    if (el) el.classList.add("active");
  }

  function updatePhoneUI() {
    const formatted = formatPhoneDisplay(phoneDigits);
    phoneDisplay.textContent = formatted || "010-";
    phoneDisplay.classList.toggle("empty", phoneDigits.length === 0);
    btnLookup.disabled = normalizePhone(phoneDigits) === null;
  }

  function pressKey(key) {
    if (key === "clear") phoneDigits = "";
    else if (key === "back") phoneDigits = phoneDigits.slice(0, -1);
    else if (/^\d$/.test(key)) {
      if (phoneDigits.length >= 11) return;
      phoneDigits += key;
    }
    updatePhoneUI();
  }

  $("#keypad").addEventListener("click", (e) => {
    const btn = e.target.closest(".key");
    if (!btn) return;
    btn.classList.add("pressed");
    setTimeout(() => btn.classList.remove("pressed"), 100);
    pressKey(btn.dataset.key);
  });

  document.addEventListener("keydown", (e) => {
    if (demoModal && !demoModal.hidden) return;
    if (!$("#screen-phone").classList.contains("active")) return;
    if (/^\d$/.test(e.key)) pressKey(e.key);
    else if (e.key === "Backspace") pressKey("back");
    else if (e.key === "Escape") pressKey("clear");
    else if (e.key === "Enter" && !btnLookup.disabled) doLookup();
  });

  function windowStatus(booking, now = new Date()) {
    const start = new Date(booking.slotStartISO || booking.slotStart);
    const end = new Date(booking.slotEndISO || booking.slotEnd);
    const openAt = new Date(start.getTime() - CHECKIN_EARLY_MIN * 60 * 1000);

    if (booking.status === "checked_in" || booking.status === "noshow" || isCheckedIn(booking.id)) {
      return { code: booking.status === "noshow" ? "late" : "already", start, end, openAt };
    }
    if (now < openAt) return { code: "early", start, end, openAt };
    if (now > end) return { code: "late", start, end, openAt };
    return { code: "ok", start, end, openAt };
  }

  function findBookingByPhone(digits) {
    const today = todayYMD();
    return getBookings().find(
      (b) => b.phone === digits && (b.date === today || !b.date)
    );
  }

  function showError(title, message) {
    $("#error-title").textContent = title;
    $("#error-message").textContent = message;
    showScreen("screen-error");
  }

  function doLookup() {
    const digits = normalizePhone(phoneDigits);
    if (!digits) {
      showError("번호 오류", "올바른 휴대폰 번호(01X)를 입력하세요. (10–11자리)");
      return;
    }

    const booking = findBookingByPhone(digits);
    if (!booking) {
      showError(
        "예약 없음",
        "오늘 네이버 예약이 없습니다.\n허브에서 「데모 예약 시드」 후 다시 시도해 주세요."
      );
      return;
    }

    const st = windowStatus(booking);

    if (st.code === "already") {
      showError(
        "이미 체크인됨",
        `${maskName(booking.name)} 님은 이미 체크인하셨습니다.\n중복 체크인은 불가합니다.`
      );
      return;
    }

    if (st.code === "early") {
      showError(
        "아직 체크인 시간이 아닙니다",
        `예약: ${formatSlotRange(st.start, st.end)}\n체크인 가능: ${formatTime(st.openAt)} 부터\n(시작 15분 전 ~ 종료까지)`
      );
      return;
    }

    if (st.code === "late") {
      showError(
        "체크인 시간이 지났습니다",
        `예약: ${formatSlotRange(st.start, st.end)}\n세션이 종료되어 체크인할 수 없습니다.\n다음 예약을 이용해 주세요.`
      );
      return;
    }

    currentBooking = booking;
    $("#confirm-name").textContent = maskName(booking.name);
    $("#confirm-slot").textContent = formatSlotRange(st.start, st.end);
    $("#confirm-phone").textContent = formatPhoneDisplay(booking.phone);

    const addonCb = $("#addon-shooting");
    const addonRow = $("#addon-row");
    const addonAlready = $("#addon-already");

    if (booking.hasShootingAddon) {
      addonRow.hidden = true;
      addonAlready.hidden = false;
      addonCb.checked = true;
      addonCb.disabled = true;
    } else {
      addonRow.hidden = false;
      addonAlready.hidden = true;
      addonCb.checked = false;
      addonCb.disabled = false;
    }

    showScreen("screen-confirm");
  }

  btnLookup.addEventListener("click", doLookup);

  $("#btn-error-back").addEventListener("click", () => showScreen("screen-phone"));
  $("#btn-confirm-back").addEventListener("click", () => {
    currentBooking = null;
    showScreen("screen-phone");
  });

  $("#btn-confirm").addEventListener("click", () => {
    if (!currentBooking) return;

    const addonCb = $("#addon-shooting");
    const extras = {};
    if (!currentBooking.hasShootingAddon && addonCb.checked) {
      extras.hasShootingAddon = true;
      extras.shootingAddedAtKiosk = true;
      currentBooking.hasShootingAddon = true;
      currentBooking.shootingAddedAtKiosk = true;
    }

    const count = recordCheckin(currentBooking.id, currentBooking.phone, extras);

    const name = maskName(currentBooking.name);
    const addonNote = currentBooking.hasShootingAddon ? " · 촬영 애드온" : "";
    $("#success-detail").textContent = `${name} 님, 좋은 운동 되세요${addonNote}`;
    $("#checkin-count").textContent = `오늘 크루 ${count}명 입장 · 체크인 ${count}명`;
    const crewFlash = document.getElementById("crew-flash");
    if (crewFlash) {
      crewFlash.textContent = `오늘 크루 ${count}명 입장`;
      crewFlash.hidden = false;
      crewFlash.classList.add("show");
      setTimeout(() => {
        crewFlash.classList.remove("show");
      }, 2800);
    }

    const door = $("#door-anim");
    door.classList.remove("open");
    showScreen("screen-success");
    requestAnimationFrame(() => {
      requestAnimationFrame(() => door.classList.add("open"));
    });

    $("#btn-success-home").hidden = true;
    clearTimeout(successTimer);
    successTimer = setTimeout(() => {
      $("#btn-success-home").hidden = false;
      goHome();
    }, SUCCESS_MS);
  });

  function goHome() {
    clearTimeout(successTimer);
    currentBooking = null;
    phoneDigits = "";
    updatePhoneUI();
    $("#door-anim").classList.remove("open");
    showScreen("screen-phone");
  }

  $("#btn-success-home").addEventListener("click", goHome);

  function tickClock() {
    const now = new Date();
    clockEl.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  }
  tickClock();
  setInterval(tickClock, 1000);

  function statusLabel(booking) {
    const st = windowStatus(booking);
    const map = {
      ok: { text: "체크인 가능", cls: "ok" },
      already: { text: "체크인 완료", cls: "done" },
      early: { text: "아직 이름", cls: "early" },
      late: { text: "시간 지남", cls: "late" },
    };
    return map[st.code] || map.ok;
  }

  function renderDemoList() {
    demoList.innerHTML = "";
    const bookings = getBookings();
    const sorted = [...bookings].sort(
      (a, b) => new Date(a.slotStartISO) - new Date(b.slotStartISO)
    );
    sorted.forEach((b) => {
      const st = windowStatus(b);
      const label = statusLabel(b);
      const li = document.createElement("li");
      li.innerHTML = `
        <span class="phone">${formatPhoneDisplay(b.phone)}</span>
        <span class="status ${label.cls}">${label.text}</span>
        <span class="meta">${maskName(b.name)} · ${formatSlotRange(st.start, st.end)}${b.hasShootingAddon ? " · 촬영" : ""}</span>
      `;
      li.addEventListener("click", () => {
        phoneDigits = b.phone;
        updatePhoneUI();
        demoModal.hidden = true;
        showScreen("screen-phone");
      });
      demoList.appendChild(li);
    });
  }

  $("#btn-demo-list").addEventListener("click", () => {
    renderDemoList();
    demoModal.hidden = false;
  });
  $("#btn-modal-close").addEventListener("click", () => { demoModal.hidden = true; });
  demoModal.addEventListener("click", (e) => {
    if (e.target === demoModal) demoModal.hidden = true;
  });
  $("#btn-reset").addEventListener("click", () => {
    resetDemo();
    goHome();
    alert("데모 데이터가 초기화되었습니다. (공유 스토어)");
  });

  FlywheelStore.ensureSeeded();
  updatePhoneUI();
  showScreen("screen-phone");
})();
