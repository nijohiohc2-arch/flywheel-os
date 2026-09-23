/**
 * 플라이휠 무인 서킷 — 세션 엔진 (GYM DISPLAY)
 * Work 40s + Move 20s · 시계방향 스테이션 · Web Speech (ko-KR)
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

  /** @type {{ phase: string, remainingMs: number, lap: number, stationIndex: number, running: boolean, muted: boolean, timeline: object[], timelineIndex: number }} */
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

  /* —— Station ring SVG —— */
  function renderRing() {
    const stations = activeStations();
    const n = stations.length;
    const cx = 200;
    const cy = 200;
    const r = 150;
    els.stationNodes.innerHTML = "";

    stations.forEach((st, i) => {
      // Clockwise from top (-90°)
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
    state.timelineIndex = index;
    const step = state.timeline[index];
    state.phase = step.phase;
    state.remainingMs = step.durationMs;
    state.lap = step.lap;
    state.stationIndex = step.stationIndex;
    flashPhase(step.phase);
    speak(step.speak);
    updateDisplay();

    if (step.phase === "done") {
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
      // Resume
      state.running = true;
      startLoop();
      updateButtons();
      return;
    }
    if (state.running) return;

    const cfg = getSettings();
    // Sync inputs to clamped values
    els.workSec.value = cfg.workSec;
    els.moveSec.value = cfg.moveSec;
    els.laps.value = cfg.laps;
    els.warmupMin.value = cfg.warmupMin;
    els.cooldownMin.value = cfg.cooldownMin;

    state.totalLaps = cfg.laps;
    state.timeline = buildTimeline(cfg);
    state.timelineIndex = -1;
    state.running = true;
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
      // Stay paused on next phase
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

  // Keyboard shortcuts for gym operator
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
        // Already running — ack and ignore
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
  renderRing();
  updateDisplay();
  pollCommand();
  if (typeof FlywheelStore !== "undefined") {
    FlywheelStore.subscribe(() => pollCommand());
  }
  setInterval(pollCommand, 1500);
})();
