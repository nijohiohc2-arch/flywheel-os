/**
 * 플라이휠 OS · 관제 — shared store (flywheel.v0)
 */
(() => {
  "use strict";

  const SLOT_MINUTES = 45;
  const TICK_MS = 2000;
  const TZ = "Asia/Seoul";

  const state = {
    offsetMinutes: 0,
    focusedSlotId: null,
    slots: [],
    freedSeats: 0,
  };

  function nowMs() {
    return Date.now() + state.offsetMinutes * 60 * 1000;
  }

  function seoulParts(ms = nowMs()) {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const parts = Object.fromEntries(
      fmt.formatToParts(new Date(ms)).filter((p) => p.type !== "literal").map((p) => [p.type, p.value])
    );
    return {
      year: +parts.year,
      month: +parts.month,
      day: +parts.day,
      hour: +parts.hour === 24 ? 0 : +parts.hour,
      minute: +parts.minute,
      second: +parts.second,
    };
  }

  function formatClock(ms = nowMs()) {
    return new Intl.DateTimeFormat("ko-KR", {
      timeZone: TZ,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date(ms));
  }

  function formatHM(ms) {
    return new Intl.DateTimeFormat("ko-KR", {
      timeZone: TZ,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(ms));
  }

  function capacityForHour(hour, meta) {
    if (hour >= 18 && hour < 22) return meta.capacityPeak || 10;
    if (hour >= 12 && hour < 14) return meta.capacityPeak || 10;
    return meta.capacityOff || 8;
  }

  function isPeakHour(hour, meta) {
    return capacityForHour(hour, meta) === (meta.capacityPeak || 10);
  }

  function maskName(full) {
    if (!full || full.length < 2) return full;
    if (full.length === 2) return full[0] + "*";
    return full[0] + "*" + full.slice(-1);
  }

  function maskPhone(phone) {
    const digits = String(phone).replace(/\D/g, "");
    if (digits.length < 8) return "010-****-****";
    return `010-****-${digits.slice(-4)}`;
  }

  function graceMs(meta) {
    return (meta.noshowGraceMin || 5) * 60 * 1000;
  }

  /** Build slots from shared flat bookings */
  function rebuildFromStore() {
    const store = FlywheelStore.ensureSeeded();
    const meta = store.meta || {};
    const checkIns = store.checkIns || {};
    const bookings = store.bookings || [];

    // Group by slotStartISO (rounded to minute)
    const groups = new Map();
    bookings.forEach((b) => {
      const startMs = new Date(b.slotStartISO).getTime();
      const endMs = new Date(b.slotEndISO).getTime();
      const key = String(startMs);
      if (!groups.has(key)) {
        groups.set(key, { startMs, endMs, bookings: [] });
      }
      let status;
      if (checkIns[b.id] || b.status === "checked_in") status = "입장";
      else if (b.status === "noshow") status = "노쇼";
      else status = "예약";

      groups.get(key).bookings.push({
        id: b.id,
        name: b.name,
        phone: b.phone,
        status,
        shooting: !!b.hasShootingAddon,
        checkedInAt: checkIns[b.id] ? new Date(checkIns[b.id].at).getTime() : null,
        _raw: b,
      });
    });

    const slots = [...groups.values()]
      .sort((a, b) => a.startMs - b.startMs)
      .map((g) => {
        const hour = seoulParts(g.startMs).hour;
        const cap = capacityForHour(hour, meta);
        return {
          id: `slot-${g.startMs}`,
          startMs: g.startMs,
          endMs: g.endMs,
          capacity: cap,
          peak: isPeakHour(hour, meta),
          bookings: g.bookings,
          freedByNoshow: g.bookings.filter((b) => b.status === "노쇼").length,
        };
      });

    // If no slots somehow, keep empty
    state.slots = slots;
    state.freedSeats = slots.reduce((s, sl) => s + sl.freedByNoshow, 0);

    const t = nowMs();
    const current = slots.find((s) => t >= s.startMs && t < s.endMs);
    if (!state.focusedSlotId || !slots.find((s) => s.id === state.focusedSlotId)) {
      state.focusedSlotId = current ? current.id : (slots[0] && slots[0].id) || null;
    }
  }

  function evaluateNoShows() {
    const store = FlywheelStore.load();
    const meta = store.meta || {};
    const grace = graceMs(meta);
    const t = nowMs();
    const flipped = [];

    // Mutate shared store for bookings past grace without check-in
    FlywheelStore.update((draft) => {
      draft.bookings.forEach((b) => {
        if (b.status === "noshow" || draft.checkIns[b.id] || b.status === "checked_in") return;
        const startMs = new Date(b.slotStartISO).getTime();
        if (t > startMs + grace) {
          b.status = "noshow";
          flipped.push({
            booking: b,
            startMs,
          });
        }
      });
    });

    if (flipped.length) rebuildFromStore();
    return flipped;
  }

  function getFocusedSlot() {
    return state.slots.find((s) => s.id === state.focusedSlotId) || state.slots[0];
  }

  function slotPhase(slot, t = nowMs()) {
    if (t >= slot.endMs) return "past";
    if (t >= slot.startMs && t < slot.endMs) return "current";
    return "upcoming";
  }

  function bookingDisplayStatus(booking, slot, t = nowMs()) {
    const phase = slotPhase(slot, t);
    if (phase === "upcoming" && booking.status !== "노쇼" && booking.status !== "입장") return "예정";
    return booking.status;
  }

  function todayKpis() {
    let total = 0, checked = 0, waiting = 0, noshow = 0;
    const t = nowMs();
    state.slots.forEach((slot) => {
      slot.bookings.forEach((b) => {
        total++;
        const st = bookingDisplayStatus(b, slot, t);
        if (st === "입장") checked++;
        else if (st === "노쇼") noshow++;
        else if (st === "예약") waiting++;
      });
    });
    return { total, checked, waiting, noshow };
  }

  function shootingQueue() {
    const t = nowMs();
    const items = [];
    state.slots.forEach((slot) => {
      if (slotPhase(slot, t) === "past") return;
      slot.bookings.forEach((b) => {
        if (!b.shooting || b.status === "노쇼") return;
        items.push({ booking: b, slot, phase: slotPhase(slot, t) });
      });
    });
    let active = items.find((x) => x.booking.status === "입장");
    const queue = items.filter((x) => x !== active);
    return { active, queue };
  }

  function $(id) {
    return document.getElementById(id);
  }

  function showToast(title, body, type = "warn") {
    const stack = $("toastStack");
    const el = document.createElement("div");
    el.className = `toast ${type === "ok" ? "ok" : type === "info" ? "info" : ""}`;
    el.innerHTML = `<div class="toast-title">${title}</div><div class="toast-body">${body}</div>`;
    stack.appendChild(el);
    setTimeout(() => {
      el.style.opacity = "0";
      el.style.transition = "opacity 0.3s";
      setTimeout(() => el.remove(), 300);
    }, 4200);
  }

  function renderClock() {
    $("clock").textContent = formatClock(nowMs());
    const badge = $("offsetBadge");
    if (state.offsetMinutes !== 0) {
      badge.hidden = false;
      const sign = state.offsetMinutes > 0 ? "+" : "";
      badge.textContent = `오프셋 ${sign}${state.offsetMinutes}분`;
    } else {
      badge.hidden = true;
    }
  }

  function renderKpis() {
    const k = todayKpis();
    $("kpiTotal").textContent = String(k.total);
    $("kpiCheckedIn").textContent = String(k.checked);
    $("kpiWaiting").textContent = String(k.waiting);
    $("kpiNoShow").textContent = String(k.noshow);

    const slot = getFocusedSlot();
    if (!slot) {
      $("kpiRemain").textContent = "—";
      return;
    }
    const checked = slot.bookings.filter((b) => b.status === "입장").length;
    $("kpiRemain").textContent = String(Math.max(0, slot.capacity - checked));
  }

  function renderCurrentSlot() {
    const slot = getFocusedSlot();
    if (!slot) {
      $("bookingList").innerHTML = `<div class="empty-state">예약이 없습니다. 「데모 예약 시드」를 눌러 주세요.</div>`;
      return;
    }

    const t = nowMs();
    const phase = slotPhase(slot, t);
    $("currentSlotRange").textContent =
      `${formatHM(slot.startMs)} – ${formatHM(slot.endMs)}` +
      (phase === "current" ? " · 진행중" : phase === "past" ? " · 종료" : " · 예정");

    $("capacityValue").textContent = String(slot.capacity);
    const peakBadge = $("peakBadge");
    peakBadge.textContent = slot.peak ? "피크 10" : "오프피크 8";
    peakBadge.classList.toggle("offpeak", !slot.peak);

    const checked = slot.bookings.filter((b) => b.status === "입장").length;
    const remain = Math.max(0, slot.capacity - checked);
    $("checkedCount").textContent = String(checked);
    $("remainCount").textContent = String(remain);

    const freedBadge = $("freedBadge");
    if (slot.freedByNoshow > 0) {
      freedBadge.hidden = false;
      freedBadge.textContent = `노쇼 해방 ${slot.freedByNoshow}`;
    } else {
      freedBadge.hidden = true;
    }

    $("progressFill").style.width = `${slot.capacity ? Math.min(100, (checked / slot.capacity) * 100) : 0}%`;

    const list = $("bookingList");
    if (!slot.bookings.length) {
      list.innerHTML = `<div class="empty-state">이 슬롯에 예약이 없습니다.</div>`;
      return;
    }

    const order = { 입장: 0, 예약: 1, 노쇼: 2, 예정: 3 };
    const rows = [...slot.bookings].sort(
      (a, b) => (order[bookingDisplayStatus(a, slot, t)] ?? 9) - (order[bookingDisplayStatus(b, slot, t)] ?? 9)
    );

    list.innerHTML = rows
      .map((b, i) => {
        const st = bookingDisplayStatus(b, slot, t);
        return `
          <div class="booking-row" data-id="${b.id}">
            <div class="seat-no">${i + 1}</div>
            <div class="booking-info">
              <span class="booking-name">${maskName(b.name)}</span>
              <span class="booking-phone">${maskPhone(b.phone)}</span>
            </div>
            ${b.shooting ? `<span class="addon-chip">슈팅</span>` : `<span></span>`}
            <span class="status-badge ${st}">${st}</span>
          </div>`;
      })
      .join("");
  }

  function renderTimeline() {
    const t = nowMs();
    const el = $("timeline");
    if (!state.slots.length) {
      el.innerHTML = `<div class="empty-state">슬롯 없음</div>`;
      return;
    }
    el.innerHTML = state.slots
      .map((slot) => {
        const phase = slotPhase(slot, t);
        const checked = slot.bookings.filter((b) => b.status === "입장").length;
        const waiting = slot.bookings.filter((b) => bookingDisplayStatus(b, slot, t) === "예약").length;
        const noshow = slot.bookings.filter((b) => b.status === "노쇼").length;
        const tagLabel = phase === "current" ? "현재" : phase === "past" ? "지난" : "예정";
        const active = slot.id === state.focusedSlotId ? "active" : "";
        return `
          <button type="button" class="slot-card ${phase} ${active}" data-slot="${slot.id}">
            <span class="slot-time">${formatHM(slot.startMs)}–${formatHM(slot.endMs)}</span>
            <span class="slot-stats">정원 ${slot.capacity} · 입장 ${checked} · 대기 ${waiting} · 노쇼 ${noshow}</span>
            <span class="slot-tag ${phase}">${tagLabel}</span>
          </button>`;
      })
      .join("");

    el.querySelectorAll(".slot-card").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.focusedSlotId = btn.getAttribute("data-slot");
        renderAll();
      });
    });
  }

  function renderShooting() {
    const { active, queue } = shootingQueue();
    const activeEl = $("shootingActive");
    if (active) {
      activeEl.textContent = `${maskName(active.booking.name)} · ${maskPhone(active.booking.phone)}`;
      activeEl.classList.add("active");
    } else {
      activeEl.textContent = "없음";
      activeEl.classList.remove("active");
    }

    const qEl = $("shootingQueue");
    if (!queue.length && !active) {
      qEl.innerHTML = `<li style="justify-content:center;color:var(--text-dim)">슈팅 대기열 없음</li>`;
      return;
    }

    const all = [];
    if (active) all.push({ ...active, stateLabel: "사용중" });
    queue.forEach((x) => all.push({ ...x, stateLabel: "대기" }));

    qEl.innerHTML = all
      .map((x, i) => `
        <li>
          <span class="queue-left">
            <span class="queue-order">${i + 1}</span>
            ${maskName(x.booking.name)}
          </span>
          <span class="queue-state ${x.stateLabel}">${x.stateLabel}</span>
        </li>`)
      .join("");
  }

  function renderAll() {
    renderClock();
    renderKpis();
    renderCurrentSlot();
    renderTimeline();
    renderShooting();
  }

  function bindControls() {
    $("btnOffsetMinus5").addEventListener("click", () => { state.offsetMinutes -= 5; tick(true); });
    $("btnOffsetMinus1").addEventListener("click", () => { state.offsetMinutes -= 1; tick(true); });
    $("btnOffsetPlus1").addEventListener("click", () => { state.offsetMinutes += 1; tick(true); });
    $("btnOffsetPlus5").addEventListener("click", () => { state.offsetMinutes += 5; tick(true); });
    $("btnOffsetReset").addEventListener("click", () => {
      state.offsetMinutes = 0;
      tick(true);
      showToast("시계 오프셋 리셋", "실제 시각으로 복귀했습니다.", "info");
    });
    $("btnRegen").addEventListener("click", () => {
      state.offsetMinutes = 0;
      FlywheelStore.seedDemo();
      rebuildFromStore();
      renderAll();
      showToast("데모 예약 시드", "공유 스토어에 오늘 예약을 다시 넣었습니다.", "ok");
    });
    $("btnResetCheckins").addEventListener("click", () => {
      FlywheelStore.update((draft) => {
        draft.checkIns = {};
        draft.bookings.forEach((b) => {
          if (b.status === "checked_in" || b.status === "noshow") b.status = "reserved";
        });
        draft.sessionCommand = null;
      });
      rebuildFromStore();
      renderAll();
      showToast("체크인 초기화", "입장·노쇼를 예약으로 되돌렸습니다.", "info");
    });
    $("btnSessionStart").addEventListener("click", () => {
      const slot = getFocusedSlot();
      FlywheelStore.setSessionCommand("start", slot ? slot.id : null);
      showToast("세션 시작 신호", "세션 엔진에 start 명령을 보냈습니다.", "ok");
    });
  }

  function tick() {
    rebuildFromStore();
    const flipped = evaluateNoShows();
    renderAll();
    flipped.forEach(({ booking, startMs }) => {
      showToast(
        "노쇼 처리 · 좌석 해방",
        `${maskName(booking.name)} (${maskPhone(booking.phone)}) · ${formatHM(startMs)} 슬롯`,
        "warn"
      );
      requestAnimationFrame(() => {
        const row = document.querySelector(`.booking-row[data-id="${booking.id}"]`);
        if (row) {
          row.classList.add("flash-noshow");
          setTimeout(() => row.classList.remove("flash-noshow"), 1600);
        }
      });
    });
  }

  FlywheelStore.ensureSeeded();
  rebuildFromStore();
  bindControls();
  renderAll();
  tick();
  setInterval(() => tick(), TICK_MS);
  setInterval(() => renderClock(), 250);
  FlywheelStore.subscribe(() => {
    rebuildFromStore();
    renderAll();
  });
})();
