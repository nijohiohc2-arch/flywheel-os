/**
 * 플라이휠 무인 서킷 — 세션 엔진 (GYM DISPLAY)
 * Work 40s + Move 20s · 시계방향 스테이션 · Web Speech (ko-KR)
 * Amplified "crew together" feel
 */
(function () {
  "use strict";

  const ALL_STATIONS = [
    { id: "S1", name: "스쿼트" },
    { id: "S2", name: "푸시" },
    { id: "S3", name: "풀" },
    { id: "S4", name: "런지" },
    { id: "S5", name: "코어" },
    { id: "S6", name: "스윙" },
    { id: "S7", name: "민첩" },
    { id: "S8", name: "밸런스" },
    { id: "S9", name: "컨디션" },
    { id: "S10", name: "슈팅", optional: true },
  ];

  const PHASE_LABEL = {
    idle: "대기",
    warmup: "워밍업",
    work: "운동",
    move: "이동",
    cooldown: "쿨다운",
    done: "완료",
  };

  const AVATAR_MARKS = ["💪", "🔥", "⚡", "🏃", "✨", "🎯", "👊", "🌟"];

  /** @type {object} */
  const state = {
    phase: "idle",
    remainingMs: 0,
    lap: 0,
    totalLaps: 3,
    stationIndex: -1,
    running: false,
    muted: false,
    timeline: [],
    timelineIndex: -1,
    lastTick: 0,
    rafId: null,
    settingsLocked: false,
    crew: [],
    crewFromStore: false,
    crewMoveCueCount: 0,
    lastCrewMoveAt: 0,
    energy: 0,
    energyMax: 100,
    completedStations: 0,
    lastLapShown: 0,
  };

  const els = {
    app: document.getElementById("app"),
    phaseBadge: document.getElementById("phaseBadge"),
    lapLabel: document.getElementById("lapLabel"),
    muteBtn: document.getElementById("muteBtn"),
    countdown: document.getElementById("countdown"),
    currentId: document.getElementById("currentId"),
    currentName: document.getElementById("currentName"),
    nextId: document.getElementById("nextId"),
    nextName: document.getElementById("nextName"),
    cueLine: document.getElementById("cueLine"),
    ringCenterName: document.getElementById("ringCenterName"),
    stationNodes: document.getElementById("stationNodes"),
    startBtn: document.getElementById("startBtn"),
    pauseBtn: document.getElementById("pauseBtn"),
    skipBtn: document.getElementById("skipBtn"),
    resetBtn: document.getElementById("resetBtn"),
    workSec: document.getElementById("workSec"),
    moveSec: document.getElementById("moveSec"),
    laps: document.getElementById("laps"),
    warmupMin: document.getElementById("warmupMin"),
    cooldownMin: document.getElementById("cooldownMin"),
    includeS10: document.getElementById("includeS10"),
    settingsPanel: document.getElementById("settingsPanel"),
    opsBanner: document.getElementById("opsBanner"),
    crewAvatars: document.getElementById("crewAvatars"),
    crewCount: document.getElementById("crewCount"),
    crewEnergyFill: document.getElementById("crewEnergyFill"),
    crewMarqueeInner: document.getElementById("crewMarqueeInner"),
    crewGhosts: document.getElementById("crewGhosts"),
    momentOverlay: document.getElementById("momentOverlay"),
    momentBanner: document.getElementById("momentBanner"),
    momentTitle: document.getElementById("momentTitle"),
    momentSub: document.getElementById("momentSub"),
    momentChips: document.getElementById("momentChips"),
  };

  function getSettings() {
    return {
      workSec: clampNum(els.workSec.value, 5, 180, 40),
      moveSec: clampNum(els.moveSec.value, 5, 120, 20),
      laps: clampNum(els.laps.value, 1, 20, 3),
      warmupMin: clampNum(els.warmupMin.value, 0, 30, 3),
      cooldownMin: clampNum(els.cooldownMin.value, 0, 30, 2),
      includeS10: els.includeS10.checked,
    };
  }

  function clampNum(v, min, max, fallback) {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function activeStations() {
    const includeS10 = els.includeS10.checked;
    return ALL_STATIONS.filter((s) => !s.optional || includeS10);
  }

  function buildTimeline(cfg) {
    const stations = activeStations();
    const timeline = [];
    const warmupMs = Math.round(cfg.warmupMin * 60 * 1000);
    const cooldownMs = Math.round(cfg.cooldownMin * 60 * 1000);
    const workMs = cfg.workSec * 1000;
    const moveMs = cfg.moveSec * 1000;

    if (warmupMs > 0) {
      timeline.push({
        phase: "warmup",
        durationMs: warmupMs,
        lap: 0,
        stationIndex: -1,
        speak: `워밍업을 시작합니다. ${cfg.warmupMin}분입니다.`,
        cue: "전신 워밍업 · 가볍게 몸을 풀어 주세요",
      });
    }

    for (let lap = 1; lap <= cfg.laps; lap++) {
      for (let i = 0; i < stations.length; i++) {
        const st = stations[i];
        const nextIdx = i + 1 < stations.length ? i + 1 : 0;
        const nextSt = stations[nextIdx];
        const isLastOfLap = i === stations.length - 1;
        const isLastOverall = lap === cfg.laps && isLastOfLap;

        timeline.push({
          phase: "work",
          durationMs: workMs,
          lap,
          stationIndex: i,
          speak: `${st.id} ${st.name}. 운동 시작. ${cfg.workSec}초.`,
          cue: `${st.name} · ${cfg.workSec}초 집중`,
        });

        if (!isLastOverall) {
          const nextLabel = isLastOfLap
            ? `랩 ${lap} 완료. 다음 랩, ${stations[0].id} ${stations[0].name}으로 이동.`
            : `다음, ${nextSt.id} ${nextSt.name}으로 이동.`;
          timeline.push({
            phase: "move",
            durationMs: moveMs,
            lap,
            stationIndex: i,
            nextStationIndex: isLastOfLap ? 0 : nextIdx,
            nextLap: isLastOfLap ? lap + 1 : lap,
            speak: nextLabel + ` ${cfg.moveSec}초.`,
            cue: isLastOfLap
              ? `랩 ${lap} 완료 → 다음 랩 ${stations[0].id} ${stations[0].name}`
              : `이동 → ${nextSt.id} ${nextSt.name}`,
          });
        }
      }
    }

    if (cooldownMs > 0) {
      timeline.push({
        phase: "cooldown",
        durationMs: cooldownMs,
        lap: cfg.laps,
        stationIndex: -1,
        speak: `쿨다운을 시작합니다. ${cfg.cooldownMin}분입니다. 호흡을 가다듬으세요.`,
        cue: "쿨다운 · 스트레칭과 호흡 정리",
      });
    }

    timeline.push({
      phase: "done",
      durationMs: 0,
      lap: cfg.laps,
      stationIndex: -1,
      speak: "세션이 끝났습니다. 수고하셨습니다!",
      cue: "세션 완료 · 수고하셨습니다!",
    });

    return timeline;
  }

  /* —— Crew together (ghost / real check-ins) —— */
  const VIRTUAL_CREW_POOL = [
    "민수", "서연", "지훈", "유진", "하늘", "도윤", "세린", "예준", "채원", "태호",
    "하준", "소율", "건우", "지아", "시우",
  ];

  function maskNick(name) {
    if (!name) return "크*";
    const s = String(name).trim();
    if (s.length <= 1) return s + "*";
    return s[0] + "*";
  }

  function initialOf(name) {
    const s = String(name || "?").trim();
    return s[0] || "?";
  }

  function loadCrewRoster() {
    const stations = activeStations();
    const nStations = Math.max(stations.length, 1);
    let members = [];
    let fromStore = false;

    if (typeof FlywheelStore !== "undefined") {
      try {
        const s = FlywheelStore.load();
        const checkIns = s.checkIns || {};
        const ids = Object.keys(checkIns);
        if (ids.length > 0) {
          fromStore = true;
          members = ids.map((id) => {
            const b = (s.bookings || []).find((x) => x.id === id);
            return { name: b ? b.name : "크루", real: true };
          });
        }
      } catch (_) {}
    }

    // Always keep 4–6 visible so solo never feels empty
    const targetCount = Math.min(6, Math.max(4, members.length || 5));
    if (members.length < targetCount) {
      const used = new Set(members.map((m) => m.name));
      let i = 0;
      while (members.length < targetCount && i < VIRTUAL_CREW_POOL.length) {
        const n = VIRTUAL_CREW_POOL[i++];
        if (used.has(n)) continue;
        used.add(n);
        members.push({ name: n, real: false });
      }
    }
    if (members.length > 6) members = members.slice(0, 6);

    state.crew = members.map((m, i) => ({
      nick: maskNick(m.name),
      initial: initialOf(m.name),
      mark: AVATAR_MARKS[i % AVATAR_MARKS.length],
      real: m.real,
      offset: ((i + 1) % nStations) || nStations - 1,
      name: m.name,
    }));
    state.crewFromStore = fromStore;
    if (els.crewCount) els.crewCount.textContent = String(state.crew.length);
    return state.crew;
  }

  function currentStationIndexForCrew() {
    const step = state.timeline[state.timelineIndex];
    if (!step) return 0;
    if (step.phase === "work" || step.phase === "move") {
      return Math.max(0, step.stationIndex);
    }
    return 0;
  }

  function renderCrewStage() {
    if (!els.crewAvatars) return;
    if (!state.crew || state.crew.length === 0) loadCrewRoster();
    const stations = activeStations();
    const cur = currentStationIndexForCrew();
    const n = stations.length || 1;

    els.crewAvatars.innerHTML = "";
    if (els.crewCount) els.crewCount.textContent = String(state.crew.length);

    state.crew.forEach((c) => {
      const stIdx = (cur + c.offset) % n;
      const st = stations[stIdx];
      const isActivePhase =
        state.phase === "work" && stIdx === cur;

      const el = document.createElement("div");
      el.className =
        "crew-avatar" +
        (c.real ? "" : " ghost") +
        (isActivePhase ? " active-phase" : "");
      el.innerHTML =
        '<div class="crew-avatar-circle" title="' +
        c.nick +
        '">' +
        (c.real ? c.initial : c.mark) +
        "</div>" +
        '<span class="crew-avatar-nick">' +
        c.nick +
        "</span>" +
        '<span class="crew-avatar-station">' +
        (st ? st.id + " " + st.name : "—") +
        "</span>";
      els.crewAvatars.appendChild(el);
    });

    renderCrewGhostsOnRing(cur, stations);
  }

  function renderCrewGhostsOnRing(curIdx, stations) {
    if (!els.crewGhosts) return;
    const n = stations.length;
    if (!n) {
      els.crewGhosts.innerHTML = "";
      return;
    }
    const cx = 200;
    const cy = 200;
    const r = 150;
    const isMove = state.phase === "move";

    // Reuse existing nodes for slide animation when possible
    const existing = Array.from(els.crewGhosts.querySelectorAll(".crew-ghost-dot"));
    state.crew.forEach((c, idx) => {
      const i = (curIdx + c.offset) % n;
      const angle = -Math.PI / 2 + (i / n) * Math.PI * 2;
      const rr = r + 36;
      const x = cx + rr * Math.cos(angle);
      const y = cy + rr * Math.sin(angle);
      const isActive = state.phase === "work" && i === curIdx;

      let g = existing[idx];
      if (!g) {
        g = document.createElementNS("http://www.w3.org/2000/svg", "g");
        g.classList.add("crew-ghost-dot");
        g.innerHTML =
          '<circle r="14" />' +
          '<text text-anchor="middle" class="ghost-nick"></text>' +
          '<title></title>';
        els.crewGhosts.appendChild(g);
      }
      g.classList.toggle("active-phase", isActive);
      g.classList.toggle("sliding", isMove);
      const circ = g.querySelector("circle");
      const txt = g.querySelector("text");
      const title = g.querySelector("title");
      if (circ) {
        circ.setAttribute("cx", x.toFixed(1));
        circ.setAttribute("cy", y.toFixed(1));
      }
      if (txt) {
        txt.setAttribute("x", x.toFixed(1));
        txt.setAttribute("y", (y + 4).toFixed(1));
        txt.textContent = c.nick.replace("*", "");
      }
      if (title) title.textContent = c.nick + (stations[i] ? " · " + stations[i].id + " " + stations[i].name : "");
    });
    // Remove extras
    while (els.crewGhosts.children.length > state.crew.length) {
      els.crewGhosts.removeChild(els.crewGhosts.lastChild);
    }
  }

  /* —— Marquee billboard —— */
  let marqueeIdx = 0;
  let marqueeTimer = null;

  function buildMarqueeLines() {
    const stations = activeStations();
    const cur = currentStationIndexForCrew();
    const count = state.crew.length;
    const lines = [];
    lines.push("크루 " + count + "명과 같은 타이머");
    if (state.phase === "move") {
      lines.push("다 같이 이동!");
    }
    state.crew.slice(0, 4).forEach((c) => {
      const stIdx = (cur + c.offset) % Math.max(stations.length, 1);
      const st = stations[stIdx];
      if (st) lines.push(st.id + "에서 " + c.nick + " 운동 중");
    });
    if (state.lap >= 1) {
      lines.push("랩 " + state.lap + " — 크루 페이스 유지");
    }
    if (state.phase === "work") lines.push("집중! 크루도 같이 운동 중");
    if (state.phase === "warmup") lines.push("워밍업 · 크루와 몸 풀기");
    if (state.phase === "cooldown") lines.push("쿨다운 · 오늘 같이 돈 크루");
    if (state.phase === "idle") lines.push("혼자여도 짐 체크인 느낌");
    lines.push("같은 타이머 · 같은 박자");
    return lines;
  }

  function rotateMarquee() {
    if (!els.crewMarqueeInner) return;
    const lines = buildMarqueeLines();
    els.crewMarqueeInner.classList.add("fade");
    els.crewMarqueeInner.classList.remove("enter");
    setTimeout(() => {
      marqueeIdx = (marqueeIdx + 1) % lines.length;
      els.crewMarqueeInner.textContent = lines[marqueeIdx];
      els.crewMarqueeInner.classList.remove("fade");
      els.crewMarqueeInner.classList.add("enter");
    }, 260);
  }

  function startMarquee() {
    if (marqueeTimer) clearInterval(marqueeTimer);
    if (els.crewMarqueeInner) {
      const lines = buildMarqueeLines();
      els.crewMarqueeInner.textContent = lines[0];
    }
    marqueeTimer = setInterval(rotateMarquee, 3000);
  }

  /* —— Moment overlays —— */
  let momentTimer = null;

  function showMoment(kind, title, sub, chips, durationMs) {
    if (!els.momentOverlay) return;
    clearTimeout(momentTimer);
    els.momentOverlay.hidden = false;
    els.momentOverlay.className = "moment-overlay kind-" + (kind || "start");
    els.momentTitle.textContent = title || "";
    els.momentSub.textContent = sub || "";
    els.momentChips.innerHTML = "";
    if (chips && chips.length) {
      chips.forEach((c) => {
        const span = document.createElement("span");
        span.className = "moment-chip";
        span.textContent = c;
        els.momentChips.appendChild(span);
      });
    }
    const ms = durationMs || 2000;
    momentTimer = setTimeout(() => {
      els.momentOverlay.hidden = true;
    }, ms);
  }

  function bumpEnergy(amount) {
    state.energy = Math.min(state.energyMax, state.energy + (amount || 8));
    if (els.crewEnergyFill) {
      const pct = Math.round((state.energy / state.energyMax) * 100);
      els.crewEnergyFill.style.width = pct + "%";
    }
  }

  function resetEnergy() {
    state.energy = 0;
    state.completedStations = 0;
    if (els.crewEnergyFill) els.crewEnergyFill.style.width = "0%";
  }

  /* —— Station ring SVG —— */
  function renderRing() {
    const stations = activeStations();
    const n = stations.length;
    const cx = 200;
    const cy = 200;
    const r = 150;
    els.stationNodes.innerHTML = "";

    stations.forEach((st, i) => {
      const angle = -Math.PI / 2 + (i / n) * Math.PI * 2;
      const x = cx + r * Math.cos(angle);
      const y = cy + r * Math.sin(angle);
      const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      g.classList.add("station-node");
      g.dataset.index = String(i);
      g.innerHTML = `
        <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="22" />
        <text x="${x.toFixed(1)}" y="${(y + 5).toFixed(1)}" text-anchor="middle">${st.id.replace("S", "")}</text>
      `;
      els.stationNodes.appendChild(g);
    });
    updateRingHighlight();
  }

  function updateRingHighlight() {
    const stations = activeStations();
    const nodes = els.stationNodes.querySelectorAll(".station-node");
    const step = state.timeline[state.timelineIndex];
    let currentIdx = -1;
    let nextIdx = -1;

    if (step) {
      if (step.phase === "work") {
        currentIdx = step.stationIndex;
        nextIdx = (step.stationIndex + 1) % stations.length;
        if (step.stationIndex === stations.length - 1 && step.lap === state.totalLaps) {
          nextIdx = -1;
        }
      } else if (step.phase === "move") {
        currentIdx = step.stationIndex;
        nextIdx = step.nextStationIndex;
      }
    }

    nodes.forEach((node) => {
      const i = Number(node.dataset.index);
      node.classList.remove("active", "next", "dim");
      if (state.phase === "warmup" || state.phase === "cooldown" || state.phase === "idle" || state.phase === "done") {
        node.classList.add("dim");
      } else if (i === currentIdx) {
        node.classList.add("active");
      } else if (i === nextIdx) {
        node.classList.add("next");
      }
    });
    renderCrewStage();
  }

  /* —— Speech —— */
  function speak(text) {
    if (state.muted || !text || !window.speechSynthesis) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "ko-KR";
      u.rate = 1.05;
      u.pitch = 1;
      const voices = window.speechSynthesis.getVoices();
      const ko = voices.find((v) => v.lang.startsWith("ko"));
      if (ko) u.voice = ko;
      window.speechSynthesis.speak(u);
    } catch (_) {
      /* ignore */
    }
  }

  if (window.speechSynthesis) {
    window.speechSynthesis.onvoiceschanged = function () {};
  }

  /* —— Display —— */
  function formatTime(ms) {
    const totalSec = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function flashPhase(phase) {
    els.app.classList.remove("flash-work", "flash-move", "flash-warmup", "flash-cooldown");
    if (phase === "work" || phase === "move" || phase === "warmup" || phase === "cooldown") {
      els.app.classList.add("flash-" + phase);
      setTimeout(() => els.app.classList.remove("flash-" + phase), 400);
    }
  }

  function updateDisplay() {
    const stations = activeStations();
    const step = state.timeline[state.timelineIndex];

    els.phaseBadge.textContent = PHASE_LABEL[state.phase] || state.phase;
    els.phaseBadge.dataset.phase = state.phase;

    els.countdown.textContent =
      state.phase === "idle" || state.phase === "done"
        ? state.phase === "done"
          ? "00:00"
          : "--:--"
        : formatTime(state.remainingMs);

    els.countdown.className = "countdown";
    if (state.phase !== "idle" && state.phase !== "done") {
      els.countdown.classList.add("phase-" + state.phase);
    }
    if (state.remainingMs > 0 && state.remainingMs <= 5000 && state.running) {
      els.countdown.classList.add("urgent");
    }

    if (state.phase === "work" && step && step.stationIndex >= 0) {
      const st = stations[step.stationIndex];
      els.currentId.textContent = st.id;
      els.currentName.textContent = st.name;
      els.ringCenterName.textContent = st.name;
      const nextI = step.stationIndex + 1;
      if (nextI < stations.length) {
        els.nextId.textContent = stations[nextI].id;
        els.nextName.textContent = stations[nextI].name;
      } else if (step.lap < state.totalLaps) {
        els.nextId.textContent = stations[0].id;
        els.nextName.textContent = stations[0].name + " (다음 랩)";
      } else {
        els.nextId.textContent = "—";
        els.nextName.textContent = "쿨다운";
      }
      els.lapLabel.textContent = `랩 ${step.lap} / ${state.totalLaps}`;
    } else if (state.phase === "move" && step) {
      const st = stations[step.stationIndex];
      els.currentId.textContent = st.id;
      els.currentName.textContent = st.name + " 완료";
      const ni = step.nextStationIndex;
      const nextLap = step.nextLap || step.lap;
      if (ni != null && stations[ni]) {
        els.nextId.textContent = stations[ni].id;
        els.nextName.textContent = stations[ni].name;
        els.ringCenterName.textContent = "→ " + stations[ni].name;
      }
      els.lapLabel.textContent = `랩 ${step.lap} / ${state.totalLaps}` + (nextLap !== step.lap ? ` → ${nextLap}` : "");
    } else if (state.phase === "warmup") {
      els.currentId.textContent = "WU";
      els.currentName.textContent = "워밍업";
      els.nextId.textContent = stations[0] ? stations[0].id : "—";
      els.nextName.textContent = stations[0] ? stations[0].name : "—";
      els.ringCenterName.textContent = "워밍업";
      els.lapLabel.textContent = `랩 — / ${state.totalLaps}`;
    } else if (state.phase === "cooldown") {
      els.currentId.textContent = "CD";
      els.currentName.textContent = "쿨다운";
      els.nextId.textContent = "—";
      els.nextName.textContent = "세션 종료";
      els.ringCenterName.textContent = "쿨다운";
      els.lapLabel.textContent = `랩 ${state.totalLaps} / ${state.totalLaps}`;
    } else if (state.phase === "done") {
      els.currentId.textContent = "OK";
      els.currentName.textContent = "세션 완료";
      els.nextId.textContent = "—";
      els.nextName.textContent = "—";
      els.ringCenterName.textContent = "완료";
      els.lapLabel.textContent = `랩 ${state.totalLaps} / ${state.totalLaps}`;
    } else {
      els.currentId.textContent = "—";
      els.currentName.textContent = "세션 대기";
      els.nextId.textContent = "—";
      els.nextName.textContent = "—";
      els.ringCenterName.textContent = "—";
      els.lapLabel.textContent = `랩 — / ${getSettings().laps}`;
    }

    if (step && step.cue) {
      els.cueLine.textContent = step.cue;
    } else if (state.phase === "idle") {
      els.cueLine.textContent = "시작을 누르면 워밍업이 시작됩니다.";
    }

    updateRingHighlight();
    updateButtons();
  }

  function updateButtons() {
    const running = state.running;
    const active = state.phase !== "idle" && state.phase !== "done";
    els.startBtn.disabled = running || state.phase === "done";
    els.startBtn.textContent = active && !running ? "재개" : "시작";
    els.pauseBtn.disabled = !running;
    els.skipBtn.disabled = !active || state.phase === "done";
    els.resetBtn.disabled = state.phase === "idle" && !running;

    const inputs = [els.workSec, els.moveSec, els.laps, els.warmupMin, els.cooldownMin, els.includeS10];
    inputs.forEach((el) => {
      el.disabled = active || running;
    });
  }

  /* —— Engine loop —— */
  function enterStep(index) {
    if (index >= state.timeline.length) {
      finishSession();
      return;
    }
    const prev = state.timeline[state.timelineIndex];
    state.timelineIndex = index;
    const step = state.timeline[index];
    const prevPhase = state.phase;
    const prevLap = state.lap;

    state.phase = step.phase;
    state.remainingMs = step.durationMs;
    state.lap = step.lap;
    state.stationIndex = step.stationIndex;
    flashPhase(step.phase);
    speak(step.speak);
    updateDisplay();

    // Crew moments (overlays always show; mute only suppresses voice)
    if (index === 0 || (prevPhase === "idle" && step.phase !== "idle")) {
      showMoment(
        "start",
        "크루 세션 시작",
        "크루 " + state.crew.length + "명과 같은 타이머",
        state.crew.slice(0, 4).map((c) => c.nick),
        2200
      );
      bumpEnergy(5);
    }

    if (step.phase === "move") {
      showMoment("move", "크루 이동!", step.cue || "다음 스테이션으로", null, 1800);
      state.crewMoveCueCount = (state.crewMoveCueCount || 0) + 1;
      if (!state.muted && state.crewMoveCueCount % 2 === 0) {
        // occasional extra voice — speak() already ran station cue; light touch
      }
      bumpEnergy(6);
      state.completedStations++;
    }

    // Lap cheer only when advancing to a new lap (2+), not the first work step
    if (
      step.phase === "work" &&
      step.lap >= 2 &&
      step.lap !== prevLap &&
      step.stationIndex === 0
    ) {
      showMoment(
        "lap",
        "랩 " + step.lap + " — 같이 가자",
        "크루 페이스 유지",
        null,
        2000
      );
      bumpEnergy(12);
    }

    if (step.phase === "done") {
      state.energy = state.energyMax;
      if (els.crewEnergyFill) els.crewEnergyFill.style.width = "100%";
      showMoment(
        "end",
        "오늘 같이 돈 크루",
        "수고하셨습니다 · 크루 " + state.crew.length + "명",
        state.crew.map((c) => c.nick + (c.real ? "" : " · 고스트")),
        2800
      );
      state.running = false;
      stopLoop();
      updateButtons();
    }
  }

  function finishSession() {
    state.phase = "done";
    state.running = false;
    state.remainingMs = 0;
    stopLoop();
    speak("세션이 끝났습니다. 수고하셨습니다!");
    state.energy = state.energyMax;
    if (els.crewEnergyFill) els.crewEnergyFill.style.width = "100%";
    showMoment(
      "end",
      "오늘 같이 돈 크루",
      "수고하셨습니다 · 크루 " + state.crew.length + "명",
      state.crew.map((c) => c.nick),
      2800
    );
    updateDisplay();
  }

  function tick(now) {
    if (!state.running) return;
    if (!state.lastTick) state.lastTick = now;
    const dt = now - state.lastTick;
    state.lastTick = now;
    state.remainingMs -= dt;

    if (state.remainingMs <= 0) {
      enterStep(state.timelineIndex + 1);
    } else {
      updateDisplay();
    }

    if (state.running) {
      state.rafId = requestAnimationFrame(tick);
    }
  }

  function startLoop() {
    stopLoop();
    state.lastTick = 0;
    state.rafId = requestAnimationFrame(tick);
  }

  function stopLoop() {
    if (state.rafId != null) {
      cancelAnimationFrame(state.rafId);
      state.rafId = null;
    }
    state.lastTick = 0;
  }

  function startSession() {
    if (state.phase !== "idle" && state.phase !== "done" && !state.running) {
      state.running = true;
      startLoop();
      updateButtons();
      return;
    }
    if (state.running) return;

    const cfg = getSettings();
    els.workSec.value = cfg.workSec;
    els.moveSec.value = cfg.moveSec;
    els.laps.value = cfg.laps;
    els.warmupMin.value = cfg.warmupMin;
    els.cooldownMin.value = cfg.cooldownMin;

    state.totalLaps = cfg.laps;
    state.timeline = buildTimeline(cfg);
    state.timelineIndex = -1;
    state.running = true;
    state.lastLapShown = 0;
    resetEnergy();
    loadCrewRoster();
    renderRing();
    enterStep(0);
    if (state.phase !== "done") startLoop();
  }

  function pauseSession() {
    if (!state.running) return;
    state.running = false;
    stopLoop();
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    updateButtons();
    els.cueLine.textContent = "일시정지 · 재개하려면 시작";
  }

  function skipPhase() {
    if (state.phase === "idle" || state.phase === "done") return;
    const wasRunning = state.running;
    enterStep(state.timelineIndex + 1);
    if (state.phase !== "done" && wasRunning) {
      state.running = true;
      startLoop();
    } else if (state.phase !== "done" && !wasRunning) {
      state.running = false;
      stopLoop();
      updateButtons();
    }
  }

  function resetSession() {
    state.running = false;
    stopLoop();
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    state.phase = "idle";
    state.remainingMs = 0;
    state.lap = 0;
    state.stationIndex = -1;
    state.timeline = [];
    state.timelineIndex = -1;
    resetEnergy();
    if (els.momentOverlay) els.momentOverlay.hidden = true;
    renderRing();
    updateDisplay();
    els.cueLine.textContent = "시작을 누르면 워밍업이 시작됩니다.";
  }

  function toggleMute() {
    state.muted = !state.muted;
    els.muteBtn.classList.toggle("muted", state.muted);
    els.muteBtn.textContent = state.muted ? "🔇" : "🔊";
    els.muteBtn.setAttribute("aria-label", state.muted ? "음성 켜기" : "음성 음소거");
    if (state.muted && window.speechSynthesis) window.speechSynthesis.cancel();
  }

  /* —— Bind —— */
  els.startBtn.addEventListener("click", startSession);
  els.pauseBtn.addEventListener("click", pauseSession);
  els.skipBtn.addEventListener("click", skipPhase);
  els.resetBtn.addEventListener("click", resetSession);
  els.muteBtn.addEventListener("click", toggleMute);
  els.includeS10.addEventListener("change", () => {
    if (state.phase === "idle") renderRing();
  });

  document.addEventListener("keydown", (e) => {
    if (e.target.matches("input, textarea, summary")) return;
    if (e.code === "Space") {
      e.preventDefault();
      if (state.running) pauseSession();
      else startSession();
    } else if (e.code === "KeyN") {
      skipPhase();
    } else if (e.code === "KeyR") {
      resetSession();
    } else if (e.code === "KeyM") {
      toggleMute();
    }
  });

  /* —— Shared store: sessionCommand from ops —— */
  let lastHandledCommandAt = null;
  let pendingAutoStart = null;

  function handleSessionCommand(cmd) {
    if (!cmd || !cmd.type) return;
    if (cmd.at && cmd.at === lastHandledCommandAt) return;

    if (cmd.type === "start") {
      if (state.running) {
        lastHandledCommandAt = cmd.at;
        FlywheelStore.ackSessionCommand();
        return;
      }
      lastHandledCommandAt = cmd.at;
      if (els.opsBanner) {
        els.opsBanner.hidden = false;
        els.opsBanner.textContent = "관제에서 시작 신호 — 시작 누르기 (1초 후 자동 시작)";
      }
      if (pendingAutoStart) clearTimeout(pendingAutoStart);
      pendingAutoStart = setTimeout(() => {
        pendingAutoStart = null;
        if (els.opsBanner) els.opsBanner.hidden = true;
        if (!state.running) startSession();
        FlywheelStore.ackSessionCommand();
      }, 1000);
    } else if (cmd.type === "pause") {
      lastHandledCommandAt = cmd.at;
      pauseSession();
      FlywheelStore.ackSessionCommand();
    } else if (cmd.type === "reset") {
      lastHandledCommandAt = cmd.at;
      resetSession();
      FlywheelStore.ackSessionCommand();
    }
  }

  function pollCommand() {
    if (typeof FlywheelStore === "undefined") return;
    const s = FlywheelStore.load();
    if (s.sessionCommand) handleSessionCommand(s.sessionCommand);
  }

  // Init
  loadCrewRoster();
  renderRing();
  updateDisplay();
  startMarquee();
  pollCommand();
  if (typeof FlywheelStore !== "undefined") {
    FlywheelStore.subscribe(() => {
      pollCommand();
      loadCrewRoster();
      renderCrewStage();
    });
  }
  setInterval(pollCommand, 1500);
})();
