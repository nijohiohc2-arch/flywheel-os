/**
 * Flywheel OS — shared localStorage store (flywheel.v0)
 * Same origin across / /kiosk/ /ops/ /session/ → shared state
 */
(function (global) {
  "use strict";

  const KEY = "flywheel.v0";
  const META_DEFAULT = { capacityPeak: 10, capacityOff: 8, noshowGraceMin: 5 };

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function todayYMD(d = new Date()) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function relativeSlot(offsetMin, durationMin = 45) {
    const start = new Date(Date.now() + offsetMin * 60 * 1000);
    start.setSeconds(0, 0);
    const end = new Date(start.getTime() + durationMin * 60 * 1000);
    return { slotStart: start, slotEnd: end };
  }

  function defaultState() {
    return {
      bookings: [],
      checkIns: {},
      sessionCommand: null,
      meta: { ...META_DEFAULT },
      seededAt: null,
      date: todayYMD(),
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return defaultState();
      const data = JSON.parse(raw);
      if (!data || typeof data !== "object") return defaultState();
      if (data.date && data.date !== todayYMD()) {
        // New day — keep meta, clear operational data
        return {
          ...defaultState(),
          meta: { ...META_DEFAULT, ...(data.meta || {}) },
        };
      }
      return {
        bookings: Array.isArray(data.bookings) ? data.bookings : [],
        checkIns: data.checkIns && typeof data.checkIns === "object" ? data.checkIns : {},
        sessionCommand: data.sessionCommand || null,
        meta: { ...META_DEFAULT, ...(data.meta || {}) },
        seededAt: data.seededAt || null,
        date: data.date || todayYMD(),
      };
    } catch {
      return defaultState();
    }
  }

  function save(state) {
    const next = {
      bookings: state.bookings || [],
      checkIns: state.checkIns || {},
      sessionCommand: state.sessionCommand || null,
      meta: { ...META_DEFAULT, ...(state.meta || {}) },
      seededAt: state.seededAt || null,
      date: state.date || todayYMD(),
    };
    localStorage.setItem(KEY, JSON.stringify(next));
    // Same-tab notify (storage event only fires cross-tab)
    try {
      window.dispatchEvent(new CustomEvent("flywheel:store", { detail: next }));
    } catch (_) {}
    return next;
  }

  function update(mutator) {
    const cur = load();
    const draft = {
      bookings: cur.bookings.slice(),
      checkIns: { ...cur.checkIns },
      sessionCommand: cur.sessionCommand,
      meta: { ...cur.meta },
      seededAt: cur.seededAt,
      date: cur.date,
    };
    mutator(draft);
    return save(draft);
  }

  function buildDemoBookings() {
    const samples = [
      { id: "b1", name: "김민수", phone: "01012345678", offset: -5, hasShootingAddon: false },
      { id: "b2", name: "이서연", phone: "01098765432", offset: 20, hasShootingAddon: true },
      { id: "b3", name: "박지훈", phone: "01055551234", offset: -50, hasShootingAddon: false },
      { id: "b4", name: "최유진", phone: "01022223333", offset: -10, hasShootingAddon: true },
      { id: "b5", name: "정하늘", phone: "01044445555", offset: 5, hasShootingAddon: false },
      { id: "b6", name: "한도윤", phone: "01077778888", offset: 90, hasShootingAddon: false },
      { id: "b7", name: "오세린", phone: "01033334444", offset: -2, hasShootingAddon: false },
      { id: "b8", name: "강예준", phone: "01066667777", offset: 40, hasShootingAddon: true },
      { id: "b9", name: "윤채원", phone: "01011112222", offset: -8, hasShootingAddon: false },
      { id: "b10", name: "신태호", phone: "01088889999", offset: -3, hasShootingAddon: true },
    ];

    return samples.map((b) => {
      const { slotStart, slotEnd } = relativeSlot(b.offset);
      return {
        id: b.id,
        name: b.name,
        phone: b.phone,
        date: todayYMD(),
        slotStartISO: slotStart.toISOString(),
        slotEndISO: slotEnd.toISOString(),
        hasShootingAddon: b.hasShootingAddon,
        status: "reserved", // reserved | checked_in | noshow
        shootingAddedAtKiosk: false,
      };
    });
  }

  /** Seed (or re-seed) demo bookings; clears check-ins & session command */
  function seedDemo() {
    const bookings = buildDemoBookings();
    return save({
      bookings,
      checkIns: {},
      sessionCommand: null,
      meta: { ...META_DEFAULT },
      seededAt: new Date().toISOString(),
      date: todayYMD(),
    });
  }

  function ensureSeeded() {
    const s = load();
    if (!s.bookings || s.bookings.length === 0) return seedDemo();
    return s;
  }

  function recordCheckIn(bookingId, phone) {
    return update((draft) => {
      draft.checkIns[bookingId] = {
        at: new Date().toISOString(),
        phone: phone || "",
      };
      const b = draft.bookings.find((x) => x.id === bookingId);
      if (b) b.status = "checked_in";
    });
  }

  function markNoShow(bookingId) {
    return update((draft) => {
      const b = draft.bookings.find((x) => x.id === bookingId);
      if (b && b.status === "reserved" && !draft.checkIns[bookingId]) {
        b.status = "noshow";
      }
    });
  }

  function setSessionCommand(type, slotId) {
    return update((draft) => {
      draft.sessionCommand = {
        type: type, // 'start' | 'pause' | 'reset'
        at: new Date().toISOString(),
        slotId: slotId || null,
      };
    });
  }

  function ackSessionCommand() {
    return update((draft) => {
      draft.sessionCommand = null;
    });
  }

  function counts() {
    const s = load();
    const bookings = s.bookings || [];
    let reserved = 0;
    let checkedIn = 0;
    let noshow = 0;
    bookings.forEach((b) => {
      if (s.checkIns[b.id] || b.status === "checked_in") checkedIn++;
      else if (b.status === "noshow") noshow++;
      else reserved++;
    });
    return {
      total: bookings.length,
      reserved,
      checkedIn,
      noshow,
      waiting: reserved,
    };
  }

  function subscribe(handler) {
    const onStorage = (e) => {
      if (e.key === KEY || e.key === null) handler(load());
    };
    const onCustom = (e) => handler(e.detail || load());
    window.addEventListener("storage", onStorage);
    window.addEventListener("flywheel:store", onCustom);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("flywheel:store", onCustom);
    };
  }

  global.FlywheelStore = {
    KEY,
    load,
    save,
    update,
    seedDemo,
    ensureSeeded,
    recordCheckIn,
    markNoShow,
    setSessionCommand,
    ackSessionCommand,
    counts,
    subscribe,
    todayYMD,
    buildDemoBookings,
  };
})(typeof window !== "undefined" ? window : globalThis);
