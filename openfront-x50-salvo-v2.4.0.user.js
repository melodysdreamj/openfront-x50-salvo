// ==UserScript==
// @name         OpenFront x50 Nuke + Structure Max (private/사설 로비용)
// @namespace    of-x50-salvo
// @version      2.4.0
// @description  Z: 원자폭탄 1,000발씩 — 연달아 누르면 누른 위치별로 대기열에 쌓여 끊김 없이 최대 속력 연속 발사 (Esc 중단 / 골드·발사관 소진 시 자동 중단) / H: 원자폭탄 50발 / G: xMax / J: 수소 1발 / M: MIRV(탄두 350발) / V 한 번 누르면 무장 유지 — 구조물을 계속 클릭하며 현재 레벨 +50씩 누적 업그레이드 (사일로는 +30). X = 같은 방식으로 +500씩 (사일로는 +300) — 반영 대기 없이 서버 최대 속력(초당 10건)으로 1초대에 완료. N → 바다 클릭: 군함 10척 건조. 키를 누르고 있으면 서버 감당 속도(초당10·분당150)로 자동 반복 발사. 사설·연습 로비 전용. 데이터 수집 없음.
// @author       local build
// @match        https://openfront.io/*
// @match        https://*.openfront.io/*
// @grant        none
// @run-at       document-start
// @license      MIT
// ==/UserScript==

(function () {
  "use strict";

  // ─────────────────────────────────────────────
  // 설정
  // ─────────────────────────────────────────────
  const CFG = {
    // ── 핵 ──
    amount: 50,             // 원자폭탄 인텐트 1개당 발수 (서버 상한 50)
    hotkey: "KeyH",         // 50발 살포 (H)
    hotkeyHydro: "KeyJ",    // 수소폭탄 1발 (J)
    hotkeyMirv: "KeyM",     // MIRV 1발 — 탄두 최대 350발 자동 생성 (M)
    hotkeyMax: "KeyG",      // 준비된 사일로 전부 소진 = xMax (G)

    // ── 대량 살포 (Z) ──
    // 한 번 누르면 원자폭탄을 지정 발수만큼 '서버가 허용하는 최대 속력'으로 쏟아붓는다.
    // 연달아 누르면 누른 위치별로 대기열에 쌓여, 끊김 없이 최대 속력으로 이어서 나간다.
    hotkeySalvo: "KeyZ",        // 1,000발씩 — 연타하면 대기열로 계속
    salvoAmount: 1000,          // 1회 발수 (50발 단위로 올림)
    salvoBatch: 10,             // 창당 인텐트 수 (서버 초당 한도 = 10)
    salvoBatchPeriodMs: 1150,   // 창 간격 = 1,000ms(서버 초당 창) + 여유 150ms
    salvoMaxAmount: 50000,      // 1회 발수 안전 상한 (오설정 방지)
    salvoQueueMaxItems: 50,     // 대기열 최대 건수 (연타 상한)
    salvoStopOnGold: true,      // 골드 소진 시 남은 대기열 중단 (버려질 인텐트 방지)
    salvoWaitForReload: false,  // 발사관 소진 시: false=중단 / true=재장전(9초) 대기 후 자동 재개

    // ── 구조물 업그레이드 ──
    hotkeyUpgrade: "KeyV",  // 무장 (V) → 구조물 클릭: +50
    addLevels: 50,          // 클릭할 때마다 "현재 레벨 + 이 값"까지 올림
    mode: "add",            // "add" = 현재+addLevels / "set" = 절대 목표
    targetLevel: 50,        // mode:"set" 일 때의 절대 목표 레벨
    // 구조물별 예외 — 지정한 타입은 addLevels 대신 이 값을 쓴다
    // (mode "add" 에서는 addLevelsByType, "set" 에서는 targetLevels 가 적용됨)
    targetLevels: {},
    addLevelsByType: {
      "Missile Silo": 30,   // 사일로는 클릭당 +30 고정 (레벨 = 발사관 수)
    },

    // ── 구조물 업그레이드 大 (X) ─-
    // V(소량)와 같은 방식이지만 한 번에 훨씬 많이 올린다. 50씩 나눠 여러 인텐트로
    // 보내므로 서버 스키마 상한(50)은 그대로 지킨다.
    hotkeyUpgradeBig: "KeyX",   // 무장 (X) → 구조물 클릭: +500
    addLevelsBig: 500,          // 클릭당 레벨 증가 (大)
    addLevelsByTypeBig: {
      "Missile Silo": 300,      // 사일로는 +300 (발사관 수라 과하면 곤란)
    },

    // 업그레이드 가능한 구조물 (DefensePost는 게임상 업그레이드 불가)
    upgradableTypes: ["City", "Factory", "Port", "Missile Silo", "SAM Launcher"],

    // ── 군함 대량 건조 ──
    // 군함은 서버가 amount 를 무시한다(단일 생성) → 인텐트를 N번 반복 발송한다.
    hotkeyWarship: "KeyN",  // 무장 (N) → 바다 클릭: 설정한 척수만큼 건조
    warshipCount: 10,       // 한 번에 띄울 척수 (최대 warshipMaxCount)
    warshipMaxCount: 50,    // 안전 상한
    warshipDelayMs: 120,    // 인텐트 사이 간격(ms) — 초당 10개 제한 대응

    // 키를 누르고 있을 때 반복 발사 (서버가 감당하는 속도로 자동 제한)
    // true  = 누르고 있으면 한도 내에서 계속 발사
    // false = 한 번 누를 때만 1회 (연타는 직접)
    holdRepeat: true,

    chunkDelayMs: 300,      // (v2.4부터 미사용 — 고속 발송으로 대체. 호환용)
    swallowGameKeys: true,  // H/G/J/V/N 를 게임에 전달하지 않음 (G는 게임 기본 '지상 공격'과 겹침)
    toastMs: 2600,
  };
  // ─────────────────────────────────────────────

  const TYPE_KO = {
    "City": "도시",
    "Factory": "공장",
    "Port": "항구",
    "Missile Silo": "미사일 사일로",
    "SAM Launcher": "SAM 발사대",
    "Defense Post": "디펜스 포스트",
  };
  function koName(type) { return TYPE_KO[type] || type; }

  // ── 상태 ──
  let lastMouse = { x: 0, y: 0 };
  let armed = false;
  let armedMode = null;   // "upgrade" | "upgradeBig" | "warship"
  let idleTimer = null;
  let suppressUp = false;
  let suppressTimer = null;
  let lastBlockToast = 0;   // 한도 안내 토스트 스로틀
  // 대량 살포 상태는 '대량 살포 (Z)' 섹션의 salvoQueue / salvoTimer / salvoDone 참조

  // ── 게임 컨텍스트 획득: DOM에서 직접 읽기 ──
  function getBuildMenu() {
    try { return document.querySelector("build-menu"); } catch (e) { return null; }
  }
  function getOverlay() {
    try { return document.querySelector("player-info-overlay"); } catch (e) { return null; }
  }
  function getGameView() {
    try {
      const bm = getBuildMenu();
      if (bm && bm.game && typeof bm.game.myPlayer === "function") return bm.game;
      const ov = getOverlay();
      if (ov && ov.game && typeof ov.game.myPlayer === "function") return ov.game;
    } catch (e) {}
    return null;
  }
  function getTransform() {
    try {
      const bm = getBuildMenu();
      if (bm && bm.transformHandler && typeof bm.transformHandler.screenToWorldCoordinates === "function")
        return bm.transformHandler;
      const ov = getOverlay();
      if (ov && ov.transformHandler && typeof ov.transformHandler.screenToWorldCoordinates === "function")
        return ov.transformHandler;
    } catch (e) {}
    return null;
  }
  function getEventBus() {
    try {
      const bm = getBuildMenu();
      if (bm && bm.eventBus && typeof bm.eventBus.emit === "function") return bm.eventBus;
      const ov = getOverlay();
      if (ov && ov.eventBus && typeof ov.eventBus.emit === "function") return ov.eventBus;
    } catch (e) {}
    return null;
  }

  // ── 인텐트 이벤트 클래스 획득 ──
  // 이벤트 버스의 listeners(Map) 키가 곧 실제 이벤트 생성자다.
  // 배포본은 클래스명이 난독화되므로, 이름이 안 맞으면 프로퍼티 구조로 식별한다
  // (프로퍼티명은 minify 후에도 보존된다).
  let cachedNukeCtor = null;
  function findNukeEventCtor() {
    if (cachedNukeCtor) return cachedNukeCtor;
    const bus = getEventBus();
    if (!bus) return null;
    try {
      const lm = bus.listeners;
      if (lm && typeof lm.entries === "function") {
        for (const [ctor] of lm.entries()) {
          try {
            if (typeof ctor !== "function") continue;
            if (ctor.name === "BuildUnitIntentEvent") {
              cachedNukeCtor = ctor;
              console.log("[x50] 핵 인텐트 클래스 확보 (이름 매칭)");
              return cachedNukeCtor;
            }
          } catch (e) {}
        }
        for (const [ctor] of lm.entries()) {
          try {
            if (typeof ctor !== "function") continue;
            const src = String(ctor);
            if (
              src.includes("unit") && src.includes("tile") &&
              (src.includes("amount") || src.includes("rocketDirectionUp")) &&
              src.length < 600
            ) {
              cachedNukeCtor = ctor;
              console.log("[x50] 핵 인텐트 클래스 확보 (구조 매칭)");
              return cachedNukeCtor;
            }
          } catch (e) {}
        }
      }
    } catch (e) {}
    return null;
  }

  let cachedUpCtor = null;
  function findUpgradeEventCtor() {
    if (cachedUpCtor) return cachedUpCtor;
    const bus = getEventBus();
    if (!bus) return null;
    try {
      const lm = bus.listeners;
      if (lm && typeof lm.entries === "function") {
        for (const [ctor] of lm.entries()) {
          try {
            if (typeof ctor !== "function") continue;
            if (ctor.name === "SendUpgradeStructureIntentEvent") {
              cachedUpCtor = ctor;
              console.log("[x50] 업그레이드 클래스 확보 (이름 매칭)");
              return cachedUpCtor;
            }
          } catch (e) {}
        }
        for (const [ctor] of lm.entries()) {
          try {
            if (typeof ctor !== "function") continue;
            const src = String(ctor);
            // unitId + unitType 동시 보유는 업그레이드 인텐트 고유
            // (BuildUnit=unit/tile, DeleteUnit=unitId만, MoveWarship=unitIds/tile)
            if (src.includes("unitId") && src.includes("unitType") && src.length < 600) {
              cachedUpCtor = ctor;
              console.log("[x50] 업그레이드 클래스 확보 (구조 매칭)");
              return cachedUpCtor;
            }
          } catch (e) {}
        }
      }
    } catch (e) {}
    return null;
  }

  // ── 커서 타일 ──
  window.addEventListener(
    "mousemove",
    (e) => { lastMouse = { x: e.clientX, y: e.clientY }; },
    { passive: true },
  );

  function computeCursorTile() {
    try {
      const game = getGameView();
      const tf = getTransform();
      if (!game || !tf) return null;
      const w = tf.screenToWorldCoordinates(lastMouse.x, lastMouse.y);
      if (!w) return null;
      if (typeof game.isValidCoord === "function" && !game.isValidCoord(w.x, w.y))
        return null;
      const t = game.ref(w.x, w.y);
      return t === undefined ? null : t;
    } catch (e) {
      return null;
    }
  }

  function getRocketDirectionUp() {
    try {
      const bm = getBuildMenu();
      const up = bm && bm.uiState && bm.uiState.rocketDirectionUp;
      return up !== undefined ? !!up : true;
    } catch (e) { return true; }
  }

  // ═════════════════════════════════════════════
  // 핵 발사
  // 정식 UI(라디얼 x1/x5/x50)와 동일한 이벤트 경로만 사용한다.
  // (소켓 직송 금지 — 서버는 바이너리(zbin)만 디코드하며, 디코드 실패 시 즉시 kick)
  // ═════════════════════════════════════════════
  function dispatchNuke(unit, amount) {
    const tile = computeCursorTile();
    if (tile === null) {
      toast("❌ 타깃 위에 커서를 올린 뒤 누르세요", "#ffaa00");
      return;
    }
    const bus = getEventBus();
    const ctor = findNukeEventCtor();
    if (!bus || !ctor) {
      toast("❌ 경로 없음 — 게임 시작 후 다시 시도", "#ff5555");
      return;
    }
    try {
      bus.emit(new ctor(unit, tile, getRocketDirectionUp(), amount));
      rateUse();
      const label = unit === "Atom Bomb" ? `☢️ 원자 ${amount}발` : "💧 수소 1발";
      toast(`✓ ${label}`, "#ffd166");
    } catch (e) {
      console.warn("[x50] 핵 emit 실패:", e);
      toast("❌ 발사 실패 (콘솔 확인)", "#ff5555");
    }
  }

  function fireAtoms(amount) { dispatchNuke("Atom Bomb", amount); }
  function fireHydro() { dispatchNuke("Hydrogen Bomb", undefined); }
  function fireMax() {
    try {
      const game = getGameView();
      const me = game && game.myPlayer ? game.myPlayer() : null;
      if (me && typeof me.readyMissileCount === "function") {
        const n = me.readyMissileCount();
        if (n <= 0) {
          toast("❌ 준비된 발사관 없음", "#ffaa00");
          return;
        }
        // 인텐트 1개당 상한 50발
        let remaining = n;
        const first = Math.min(remaining, CFG.amount);
        fireAtoms(first);
        remaining -= first;
        if (remaining > 0) {
          toast(`☢️ 준비 ${n}발 — ${first}발 발사, 남은 ${remaining}발은 다시 누르세요`, "#ffd166");
        }
        return;
      }
    } catch (e) {}
    fireAtoms(CFG.amount);
  }

  // ═════════════════════════════════════════════
  // 대량 살포 (Z) — 1,000발 × 연타 대기열, 서버 허용 최대 속력으로 끊김 없이
  //
  // 서버 규칙 (src/server/ClientMsgRateLimiter.ts):
  //   인텐트 초당 10건 AND 분당 150건. 초과분은 통보 없이 버려진다.
  //   원자 1건 = amount 50발(스키마 상한) → 이론 최대 초당 500발.
  //
  // 왜 '균등 간격'이 아니라 '배치'인가 (실측 근거):
  //   · limiter 의 초당 창은 고정 창이 아니라 '게으른 창'이다 —
  //     마지막 리셋 이후 첫 요청이 1초를 넘겼을 때만 리셋된다.
  //   · 균등 100ms 간격(초당 10건)은 여유가 0이라 지터에 취약:
  //     실측 5회 중 2회 드롭(1.0%), 소요 6.00초.
  //   · 배치(10건 몰아쏘고 1,150ms 대기)는 실측 드롭 0건, 소요 5.75초.
  //   → 배치가 더 빠르고 안전하다 (마지막 배치는 대기 없이 끝나기 때문).
  //
  // 연타 대기열 (v2.1.0):
  //   Z 를 누를 때마다 '누른 시점의 커서 위치'로 CFG.salvoAmount(기본 1,000발)가
  //   대기열에 쌓인다. 펌프는 대기열이 빌 때까지 창마다 10건씩 계속 내보내므로
  //   건과 건 사이에 빈틈이 없다 → 5곳을 연타하면 5,000발을 한 번에 쏜 것과 같은
  //   속력으로 이어진다. Esc 는 대기열까지 전부 중단한다.
  //
  // 자동 중단 가드 (v2.2.0):
  //   · 골드: 서버는 '폭탄 1발 단위'로 골드를 검사한다(canBuildUnitType: _gold < cost).
  //     1발 값도 없으면 이후 인텐트는 전부 조용히 버려진다
  //     → 남은 대기열을 폐기하고 중단 (💰 골드 소진).
  //   · 발사관: 장전된 관이 0이면 보내는 인텐트가 전부 버려진다
  //     → 기본은 중단 (🧨 발사관 소진).
  //       CFG.salvoWaitForReload=true 면 재장전(9초)을 기다렸다가 자동 재개.
  //   · 서버 분당 한도(150건): 남은 초만큼 대기했다가 자동 재개.
  //     이때 이번 창은 '남은 여유'만큼만 보내 조용한 드롭을 막는다.
  //   ※ 세 검사 모두 '읽을 수 있을 때만' 적용한다 — 못 읽으면 서버 판정에 맡긴다.
  // ═════════════════════════════════════════════
  const SALVO_MAX_PER_INTENT = 50;   // 서버 스키마 상한

  let salvoQueue = [];        // [{tile, total, sent, bus, ctor}] — 누른 순서대로 쌓인다
  let salvoTimer = null;      // 창 간 대기 타이머
  let salvoDone = 0;          // 이번 연속 살포에서 다 나간 누적 발수 (토스트용)
  let salvoItemsDone = 0;     // 다 나간 건수
  let salvoDryWaits = 0;      // 발사관 재장전 대기 횟수 (salvoWaitForReload 모드)

  function salvoPending() {
    return salvoQueue.reduce((a, it) => a + (it.total - it.sent), 0);
  }

  function salvoState() {
    if (salvoQueue.length === 0) return null;
    return {
      items: salvoQueue.length,
      remaining: salvoPending(),
      finished: salvoDone,
      total: salvoDone + salvoPending(),
    };
  }

  function salvoClear(msg) {
    // 큐가 비고 타이머도 없어도, 이번 연속 살포에서 이미 발사한 게 있으면
    // '진행 중이던 작업'이므로 완료/중단 토스트를 띄운다.
    const wasRunning = salvoQueue.length > 0 || salvoTimer !== null || salvoDone > 0;
    if (salvoTimer !== null) { clearTimeout(salvoTimer); salvoTimer = null; }
    if (!wasRunning) return;
    const finished = salvoDone, items = salvoItemsDone, dropped = salvoPending();
    salvoQueue = [];
    salvoDone = 0; salvoItemsDone = 0; salvoDryWaits = 0;
    if (msg) {
      toast(`${msg} — ${finished.toLocaleString()}발 발사됨${dropped > 0 ? ` · 대기 ${dropped.toLocaleString()}발 폐기` : ""}`, "#ffaa00");
    } else {
      toast(`☢️ 대량 발사 완료 — ${finished.toLocaleString()}발 (${items}건)`, "#7ee787");
    }
  }

  // Esc/중단용 별칭 (기존 이름 유지)
  function salvoStop(msg) { salvoClear(msg); }

  function salvoBatchSize() { return Math.max(1, Math.min(CFG.salvoBatch || 10, RL.perSecond)); }
  function salvoPeriodMs() { return Math.max(1000, CFG.salvoBatchPeriodMs || 1150); }

  // ── 살포 가드용 조회 (골드 / 발사관) ──
  // 전부 '읽기 전용'이다. 읽을 수 없으면 null을 돌려주고 검사를 생략한다
  // (잘못 읽고 멈추는 것보다, 서버 자체 판정에 맡기는 편이 안전).
  function atomCostPerBomb() {
    // 원자폭탄 1발 단가. null = 확인 불가(검사 생략) / 0n = 무료(무한골드 로비)
    try {
      const g = getGameView();
      if (!g) return null;
      const me = typeof g.myPlayer === "function" ? g.myPlayer() : null;
      const cfg = typeof g.config === "function" ? g.config() : null;
      if (!me || !cfg) return null;
      try { if (typeof cfg.infiniteGold === "function" && cfg.infiniteGold()) return 0n; } catch (e) {}
      const info = typeof cfg.unitInfo === "function" ? cfg.unitInfo("Atom Bomb") : null;
      if (info && typeof info.cost === "function") {
        try {
          const c = info.cost(g, me);
          if (c !== null && c !== undefined) return toBig(c);
        } catch (e) {}
      }
      return 750000n;   // Config.ts: AtomBomb = 750,000 (표준 단가)
    } catch (e) { return null; }
  }

  function myGold() {
    // 내 골드 (BigInt). 읽기 실패 시 null
    try {
      const g = getGameView();
      const me = g && typeof g.myPlayer === "function" ? g.myPlayer() : null;
      if (me && typeof me.gold === "function") return toBig(me.gold());
    } catch (e) {}
    return null;
  }

  function readyTubes() {
    // 지금 장전돼 있는 발사관 수 (사일로 레벨 합 − 재장전 중). 읽기 실패 시 null
    try {
      const g = getGameView();
      const me = g && typeof g.myPlayer === "function" ? g.myPlayer() : null;
      if (me && typeof me.readyMissileCount === "function") return me.readyMissileCount();
    } catch (e) {}
    return null;
  }

  // Z 1회 = CFG.salvoAmount(기본 1,000발)을 대기열에 추가.
  // 이미 돌고 있으면 '이어서' 추가되며, 건과 건 사이에 빈틈이 없다.
  function startSalvo() {
    const tile = computeCursorTile();
    if (tile === null) { toast("❌ 타깃 위에 커서를 올린 뒤 누르세요", "#ffaa00"); return; }
    const bus = getEventBus();
    const ctor = findNukeEventCtor();
    if (!bus || !ctor) { toast("❌ 경로 없음 — 게임 시작 후 다시 시도", "#ff5555"); return; }

    if (salvoQueue.length >= (CFG.salvoQueueMaxItems || 50)) {
      toast(`⚠️ 대기열 가득 (${salvoQueue.length}건) — 조금 기다린 뒤 다시 누르세요`, "#ffaa00");
      return;
    }

    const idle = salvoQueue.length === 0 && salvoTimer === null;

    // 준비된 발사관이 0이고 대기열도 비었을 때만 시작을 거부한다.
    // (이미 돌고 있는 중에는 9초 재장전으로 곧 풀리므로 그대로 받는다)
    if (idle) {
      let ready = null;
      try {
        const g = getGameView();
        const me = g && typeof g.myPlayer === "function" ? g.myPlayer() : null;
        if (me && typeof me.readyMissileCount === "function") ready = me.readyMissileCount();
      } catch (e) {}
      if (ready === 0) {
        toast("❌ 준비된 발사관 없음 (사일로 쿨다운 해제 후 재시도)", "#ffaa00");
        return;
      }
      // 골드가 '원자 1발' 값도 안 되면 시작해도 아무것도 안 나간다 → 시작 거부
      if (CFG.salvoStopOnGold) {
        const c1 = atomCostPerBomb();
        if (c1 && c1 > 0n) {
          const g1 = myGold();
          if (g1 !== null && g1 < c1) {
            toast("❌ 골드 소진 — 원자폭탄을 살 수 없음", "#ffaa00");
            return;
          }
        }
      }
    }

    // 발수 → 인텐트 수 (50발 단위로 올림)
    const per = SALVO_MAX_PER_INTENT;
    const cap = Math.min(CFG.salvoMaxAmount || 50000, 100000);
    const total = Math.max(per, Math.min(Math.ceil((CFG.salvoAmount || per) / per) * per, cap));
    const intents = Math.ceil(total / per);

    salvoQueue.push({ tile, total, sent: 0, bus, ctor });

    if (!idle) {
      toast(`➕ ${total.toLocaleString()}발 추가 — 대기열 ${salvoQueue.length}건 · 남은 ${salvoPending().toLocaleString()}발`, "#ffd166");
      return;
    }

    const period = salvoPeriodMs();
    const batches = Math.ceil(intents / salvoBatchSize());
    const estSec = ((batches - 1) * period / 1000).toFixed(1);

    // 첫 배치 대기 계산:
    //   서버의 초당 창은 '게으른 창'이라, 마지막 초당 버킷 리셋 뒤 1초가 지나야
    //   새 창이 열린다. 그 리셋 시점이 '창의 첫 요청'이다.
    //   → 마지막으로 보낸 인텐트 시각 + 1초 뒤가 가장 안전하다.
    //   분당 한도(150건)도 함께 본다: 남은 여유가 없으면 분 경계까지 기다린다.
    let waitMs = 0;
    try {
      const now = Date.now();
      RL.secWindow = RL.secWindow.filter((t) => now - t < 1000);
      RL.minWindow = RL.minWindow.filter((t) => now - t < 60000);
      if (RL.secWindow.length > 0) {
        const last = RL.secWindow[RL.secWindow.length - 1];
        waitMs = Math.max(0, (period - 150) - (now - last));
      }
      const minRoom = RL.perMinute - 5 - RL.minWindow.length;
      if (minRoom <= 0) {
        const oldest = RL.minWindow[0];
        waitMs = Math.max(waitMs, 60000 - (now - oldest));
      }
    } catch (e) {}

    if (waitMs > 50) {
      toast(`⏳ 발사창 정리 중 — ${(waitMs / 1000).toFixed(1)}초 후 시작 (총 ${total.toLocaleString()}발)`, "#ffaa00");
      salvoTimer = setTimeout(salvoPump, waitMs);
      return;
    }
    toast(`☢️ 대량 발사 시작 — ${total.toLocaleString()}발 / ${intents}건 · 약 ${estSec}초`, "#ffd166");
    salvoPump();
  }

  // 창마다 최대 10건씩 내보낸다. 건이 끝나면 같은 창 안에서 '즉시' 다음 건으로
  // 이어가므로, 연타로 쌓인 대기열도 빈틈 없이 최대 속력으로 소진된다.
  function salvoPump() {
    salvoTimer = null;
    if (salvoQueue.length === 0) return;

    // 분당 한도(150건)에 걸리면 분 경계까지 기다린다.
    // (초당 창만 지키면 1분 뒤 조용히 버려지는 것을 막는다)
    let minuteRoom = null;   // 이번 분 창에서 더 보낼 수 있는 인텐트 수 (null=확인 불가)
    try {
      const now = Date.now();
      RL.minWindow = RL.minWindow.filter((t) => now - t < 60000);
      minuteRoom = RL.perMinute - 5 - RL.minWindow.length;
      if (minuteRoom <= 0) {
        const wait = 60000 - (now - (RL.minWindow[0] || now)) + 50;
        toast(`⏳ 서버 분당 한도(${RL.perMinute}건) — 남은 ${Math.ceil(wait / 1000)}초 대기 후 자동 재개`, "#ffaa00");
        salvoTimer = setTimeout(salvoPump, Math.max(1000, wait));
        return;
      }
    } catch (e) {}

    const per = SALVO_MAX_PER_INTENT;

    // 창 회전 게이트 (v2.4): 최근 1초 안에 다른 발송(업그레이드 X 등)이 있었다면
    // 그 창이 닫힐 때까지 기다린다 → 두 작업이 창을 나눠 써서 드롭 0.
    try {
      const now2 = Date.now();
      RL.secWindow = RL.secWindow.filter((x) => now2 - x < 1000);
      if (RL.secWindow.length > 0) {
        const wait = RL.secWindow[RL.secWindow.length - 1] + 1050 - now2;
        if (wait > 0) { salvoTimer = setTimeout(salvoPump, wait); return; }
      }
    } catch (e) {}

    // ── 발사관 가드 ──
    // 장전된 관이 0이면 지금 보내는 인텐트는 서버에서 전부 버려진다(조용히).
    //   기본(false): 남은 대기열을 폐기하고 중단
    //   salvoWaitForReload=true: 재장전(9초)을 기다렸다가 자동 재개
    const ready = readyTubes();
    if (ready === 0) {
      if (CFG.salvoWaitForReload) {
        salvoDryWaits++;
        if (salvoDryWaits <= 15) {
          if (salvoDryWaits === 1) toast("⏳ 발사관 재장전 대기 — 장전되면 자동 재개", "#ffaa00");
          salvoTimer = setTimeout(salvoPump, 1000);
          return;
        }
        salvoClear("🧨 발사관 재장전 대기 초과");
        return;
      }
      salvoClear("🧨 발사관 소진");
      return;
    }
    salvoDryWaits = 0;

    // 한 창이 관 수보다 많은 인텐트를 보내면 남는 폭탄은 버려진다
    //   → 이번 창은 '관이 감당할 만큼'만 보낸다 (레이트 예산 보존)
    let batch = salvoBatchSize();
    if (ready !== null) batch = Math.min(batch, Math.max(1, Math.ceil(ready / per)));

    // 분당 한도의 '남은 여유'도 이번 창의 상한이다
    //   → 한도 직전에 몰아 보내 조용히 버려지는 것을 막는다
    if (minuteRoom !== null && minuteRoom < batch) batch = Math.max(1, minuteRoom);

    // ── 골드 가드 ──
    // 서버는 폭탄 '1발 단위'로 골드를 검사한다(canBuildUnitType: _gold < cost).
    //   → 보유 골드가 1발 값보다 적으면 앞으로 나갈 폭탄은 전부 무효이므로 중단.
    //   무한골드 로비(cost 0)나 조회 불가(null)면 검사하지 않는다.
    const costPerBomb = CFG.salvoStopOnGold ? atomCostPerBomb() : 0n;

    let n = 0;
    while (n < batch && salvoQueue.length > 0) {
      if (costPerBomb && costPerBomb > 0n) {
        const gold = myGold();
        if (gold !== null && gold < costPerBomb) { salvoClear("💰 골드 소진"); return; }
      }
      const item = salvoQueue[0];
      try {
        item.bus.emit(new item.ctor("Atom Bomb", item.tile, getRocketDirectionUp(), per));
        rateUse();                  // 수동 발사와 같은 카운터 공유 (서로 간섭 방지)
      } catch (e) {
        console.warn("[x50] 대량 발사 emit 실패:", e);
        salvoClear("❌ 대량 발사 중단 (emit 실패 — 콘솔 확인)");
        return;
      }
      item.sent += per;
      salvoDone += per;
      n++;
      if (item.sent >= item.total) {   // 이 건 완료 → 같은 창에서 다음 건으로 '즉시' 이어감
        salvoQueue.shift();
        salvoItemsDone++;
      }
    }

    if (salvoQueue.length === 0) { salvoClear(null); return; }
    toast(`☢️ 대량 발사 누적 ${salvoDone.toLocaleString()}발 · 남은 ${salvoPending().toLocaleString()}발 (대기열 ${salvoQueue.length}건)`, "#ffd166");
    salvoTimer = setTimeout(salvoPump, salvoPeriodMs());
  }

  // ═════════════════════════════════════════════
  // MIRV 발사 (M)
  //
  // 게임/서버 소스 검증 (v1.9.0):
  //   {type:"build_unit", unit:"MIRV"} 인텐트 1건 →
  //   서버 MirvExecution 이 탄두를 스스로 생성한다 (warheadCount = 350).
  //   · 탄두 최대 350발 = 인텐트 1건. 원자 50발(인텐트 1건)의 7배.
  //   · 사일로 슬롯은 1개만 소모 (원자 350발이면 슬롯 350개 필요).
  //   · 탄두는 반경 1500타일에 최소간격 55로 산개 (지역 폭격 — 정밀 조준 불가).
  //   · 비용 = 25M + 15M × (게임 전체 MIRV 발사횟수). 무한골드 치트면 0원.
  //   · 타깃은 '소유자 있는 영토'여야 한다 (바다·무주지 불가).
  // ═════════════════════════════════════════════
  let lastMirvWarn = 0;
  function mirvWarn(msg) {
    const now = Date.now();
    if (now - lastMirvWarn < 1500) return;   // 누르고 있을 때 경고 스팸 방지
    lastMirvWarn = now;
    toast(msg, "#ffaa00");
  }

  function fireMirv() {
    const tile = computeCursorTile();
    if (tile === null) {
      toast("❌ 타깃 위에 커서를 올린 뒤 누르세요", "#ffaa00");
      return;
    }
    const game = getGameView();
    const bus = getEventBus();
    const ctor = findNukeEventCtor();
    const me = game && typeof game.myPlayer === "function" ? game.myPlayer() : null;
    if (!bus || !ctor || !me) {
      toast("❌ 경로 없음 — 게임 시작 후 다시 시도", "#ff5555");
      return;
    }

    // 타깃 검증 — MIRV는 '소유자 있는 영토'에만 떨어진다
    try {
      if (typeof game.hasOwner === "function" && !game.hasOwner(tile)) {
        mirvWarn("❌ MIRV는 영토에만 — 커서를 영토 위로");
        return;
      }
    } catch (e) {}

    // 발사관 검증 — 서버는 '준비된 사일로'(쿨다운 아님)를 요구한다
    try {
      if (typeof me.readyMissileCount === "function" && me.readyMissileCount() <= 0) {
        mirvWarn("❌ 준비된 발사관 없음");
        return;
      }
    } catch (e) {}

    // 골드 검증.
    //   비용 = 25M + 15M × (게임 전체 MIRV 발사횟수), 무한골드 치트면 0원.
    //   주의: 정확한 누적 비용은 game.stats() 를 요구하는데 GameView 엔 그게 없다.
    //   → 정확값을 못 읽으면 '최소 비용(기본 25M)'만 검사한다 (과차단 방지).
    try {
      const cfg = typeof game.config === "function" ? game.config() : null;
      const info = cfg && typeof cfg.unitInfo === "function" ? cfg.unitInfo("MIRV") : null;
      let cost = null;
      if (info && typeof info.cost === "function") {
        try { cost = info.cost(game, me); } catch (e) { cost = null; }   // stats() 없음 → 폴백
      }
      if (cost === null) {
        let ig = false;
        try { ig = !!(cfg && typeof cfg.infiniteGold === "function" && cfg.infiniteGold()); } catch (e) {}
        if (!ig) cost = 25000000n;   // 기본가 — 누적분은 서버가 판정
      }
      if (cost !== null && typeof me.gold === "function" && me.gold() < cost) {
        mirvWarn("❌ 골드 부족 — MIRV 최소 " + Math.round(Number(cost) / 1e6) + "M 필요");
        return;
      }
    } catch (e) {}

    try {
      // 게임 라디얼 메뉴와 동일 규칙: MIRV는 rocketDirectionUp·amount 없이 보낸다
      bus.emit(new ctor("MIRV", tile, undefined, undefined));
      rateUse();
      toast("🚀 MIRV 발사 — 탄두 최대 350발", "#ff8c66");
    } catch (e) {
      console.warn("[x50] MIRV emit 실패:", e);
      toast("❌ MIRV 발사 실패 (콘솔 확인)", "#ff5555");
    }
  }

  // ═════════════════════════════════════════════
  // 구조물 업그레이드 (V 무장 → 구조물 클릭)
  //
  // 게임 소스 검증 경로:
  //   SendUpgradeStructureIntentEvent(unitId, unitType, amount)
  //   → {type:"upgrade_structure", unit, unitId, amount(1~50)}
  //   → 서버 UpgradeStructureExecution: amount회 연속 레벨업.
  //     골드가 바닥나면 그 지점에서 중단(거부 아님), 엔진 레벨 상한 없음.
  //   ※ 정식 라디얼 메뉴(x1/x5/x10/xMax)와 가운데클릭 자동업그레이드가 쓰는 바로 그 경로.
  //
  // 대상 선택은 게임의 공식 판정(buildables → canUpgrade)을 그대로 사용한다
  // → 반경 15타일 내 '업그레이드 가능한' 최근접 구조물 1개 (게임 가운데클릭과 동일 규칙).
  //
  // 발송 속도 (v2.4): 서버는 인텐트 1건(≤50레벨)을 '한 틱에' 전부 적용한다
  //   (UpgradeStructureExecution.init — amount회 동기 실행).
  //   → 유일한 병목은 인텐트 전송 속도(초당 10건)다.
  //
  //   '여유만큼 즉시, 꽉 차면 회전 대기' (v2.4 방식):
  //     · 창에 여유가 있으면 → 그만큼 지금 바로 (여러 번 클릭해도 안 막힘)
  //     · 창이 꽉 찼으면 → 첫 발송 + 1.05초(창 회전 + 여유)까지 대기 후 몰아쓰기
  //   +500 = 10건 = 한 창 → 즉시(네트워크 왕복 수준). +5,000은 창당 500레벨로
  //   서버가 허용하는 최대 속력 그대로. 살포 Z·수동 발사와 창을 나눠 쓴다.
  // ═════════════════════════════════════════════
  function toBig(v) {
    try { return typeof v === "bigint" ? v : BigInt(Math.round(Number(v) || 0)); }
    catch (e) { return BigInt(0); }
  }

  function targetFor(type) {
    try {
      const t = CFG.targetLevels && CFG.targetLevels[type];
      if (typeof t === "number" && t > 0) return t;
    } catch (e) {}
    return CFG.targetLevel;
  }

  // big=true 면 "大" 프리셋(addLevelsByTypeBig / addLevelsBig)을 쓴다.
  function addFor(type, big) {
    try {
      const tbl = big ? CFG.addLevelsByTypeBig : CFG.addLevelsByType;
      const a = tbl && tbl[type];
      if (typeof a === "number" && a > 0) return a;
    } catch (e) {}
    return big ? CFG.addLevelsBig : CFG.addLevels;
  }

  // 이번 클릭의 목표 레벨을 계산한다.
  //   mode "add" → 현재 레벨 + addFor(type[, big])   (예: Lv50에서 눌러도 Lv100까지)
  //   mode "set" → targetFor(type)                    (절대 목표, 이미 넘었으면 그대로)
  function goalLevel(type, currentLevel, big) {
    if (CFG.mode === "set") return targetFor(type);
    return currentLevel + addFor(type, big);
  }

  // 유닛 레벨 조회 — game.unit(id) 우선, 실패 시 전체 유닛 스캔 폴백.
  // (레벨을 못 읽으면 목표를 초과해 업그레이드할 수 있으므로 반드시 확보한다)
  function unitLevel(unitId, type) {
    try {
      const g = getGameView();
      if (!g) return null;
      if (typeof g.unit === "function") {
        const u = g.unit(unitId);
        if (u && typeof u.level === "function") {
          const lv = u.level();
          if (typeof lv === "number") return lv;
        }
      }
      if (typeof g.units === "function") {
        const pool = type ? g.units(type) : g.units();
        for (const u of pool) {
          try {
            if (u.id() === unitId && typeof u.level === "function") {
              const lv = u.level();
              if (typeof lv === "number") return lv;
            }
          } catch (e) {}
        }
      }
    } catch (e) {}
    return null;
  }

  // 내 소유 구조물 중 해당 타입, 반경 내 최근접
  function nearestOwn(game, me, tile, types, maxDist) {
    try {
      const list = game.units(...types).filter((u) => {
        try { return u.owner().id() === me.id(); } catch (e) { return false; }
      });
      let best = null, bestD = Infinity;
      for (const u of list) {
        const d = game.manhattanDist(tile, u.tile());
        if (d < bestD) { bestD = d; best = u; }
      }
      if (best && bestD <= maxDist) return { unit: best, dist: bestD };
    } catch (e) {}
    return null;
  }

  // ── 업그레이드 고속 발송 (v2.4) ──
  // 서버는 인텐트 1건(amount≤50레벨)을 '한 틱에' 전부 적용한다:
  //   UpgradeStructureExecution.init() — for(amount회) upgradeUnit() 동기 실행.
  //   → 500레벨의 유일한 병목은 '인텐트 전송 속도 = 서버 초당 10건'이다.
  // (구버전은 청크마다 서버 반영을 기다리며 300ms씩 쉬어 500레벨에 수 초가 걸렸다)
  //
  // 안전 원칙:
  //   · 목표는 '절대 레벨'(클릭 시점 lv0 + N) — 반영 지연 중 겹쳐 눌러도 초과 계산 없음.
  //   · 보낸 총량은 (목표 - lv0)을 넘지 않는다.
  //   · 서버 초당 한도(10건)에 여유 1을 두고 스스로 페이싱한다 (드롭 0).
  //   · 골드로 감당 가능한 만큼만 사전 절단 (최종 판정은 서버).
  //   · 레벨을 못 읽으면 중단 (추측 금지).
  function fireUpgrade(unitId, type, row, me, bus, ctor, big) {
    const lv0 = unitLevel(unitId, type);
    if (lv0 === null) {
      toast(`⚠️ ${koName(type)} 레벨 확인 실패 — 중단 (게임 로드 후 재시도)`, "#ffaa00");
      return;
    }
    const target = goalLevel(type, lv0, big);
    if (target <= lv0) {
      toast(`ℹ️ ${koName(type)} 이미 Lv ${lv0} (목표 ${target})`, "#ffd166");
      return;
    }
    let remaining = target - lv0;
    let cappedByGold = false;

    // 골드 상한 — upgradeCosts[k-1] = k회 연속 업그레이드의 누적 비용
    try {
      const costs = row && row.upgradeCosts;
      if (costs && costs.length > 0) {
        const gold = toBig(me.gold());
        const priceable = Math.min(remaining, costs.length);
        let k = priceable;
        while (k > 0 && toBig(costs[k - 1]) > gold) k--;
        if (k <= 0) {
          toast(`💰 골드 부족 — ${koName(type)} 다음 강화 불가`, "#ff5555");
          return;
        }
        if (k < priceable) { cappedByGold = true; remaining = k; }
      }
    } catch (e) {}

    const perIntent = Math.min(CFG.amount, 50);   // 서버 스키마 상한
    const t0 = lv0;
    const startedAt = Date.now();
    let sent = 0;
    let timer = null;

    // 발송이 끝난 뒤 반영을 지켜보고 결과를 알린다 (발사 자체는 이미 끝났다)
    function finish() {
      let tries = 0;
      const wantLv = t0 + sent;
      const report = (nowLv) => {
        const gained = (nowLv === null ? t0 : nowLv) - t0;
        const tail = cappedByGold ? " (골드 한도)" : "";
        if (gained > 0) toast(`✅ ${koName(type)} Lv ${t0} → ${nowLv} (+${gained})${tail}`, "#7ee787");
        else toast(`⚠️ ${koName(type)} 반영 없음 — Lv ${t0} 유지 (골드·건설상태 확인)`, "#ffaa00");
      };
      const poll = () => {
        const nowLv = unitLevel(unitId, type);
        if (nowLv !== null && nowLv >= wantLv) { report(nowLv); return; }
        if (++tries >= 25) { report(nowLv); return; }   // 최대 ~5초 대기
        timer = setTimeout(poll, 200);
      };
      poll();
    }

    // 창당 몰아쓰기 발송 (서버 초당 한도 10건을 최대 속력으로)
    function pump() {
      timer = null;
      if (sent >= remaining) { finish(); return; }

      const now = Date.now();
      RL.secWindow = RL.secWindow.filter((x) => now - x < 1000);
      RL.minWindow = RL.minWindow.filter((x) => now - x < 60000);

      // 분당 한도(150건)가 바닥이면 분 경계까지 대기
      if (RL.minWindow.length >= RL.perMinute - 5) {
        const waitMs = Math.max(1100, RL.minWindow[0] + 60000 - now + 60);
        const ts = Date.now();
        if (ts - lastBlockToast > 3000) {
          lastBlockToast = ts;
          toast(`⏳ 서버 분당 한도 — ${Math.ceil(waitMs / 1000)}초 후 자동 재개`, "#ffaa00");
        }
        timer = setTimeout(pump, waitMs);
        return;
      }

      // 창에 '남은 여유'만큼 지금 바로 보낸다.
      //   · 창이 비었거나 여유가 있으면 → 즉시 (여러 번 클릭해도 안 막힘)
      //   · 창이 꽉 찼으면 → 그 창이 닫힐 때까지(첫 발송 + 1.05초) 대기 후 몰아쓰기
      //  (살포 Z·수동 발사와 창을 나눠 쓰므로 어느 쪽도 버려지지 않는다)
      const room = RL.perSecond - RL.secWindow.length;
      if (room <= 0) {
        const waitMs = Math.max(40, RL.secWindow[0] + 1050 - now);
        if (Date.now() - startedAt > 180000) {
          toast(`⏳ 서버 한도 대기 초과 — 중단 (남은 ${remaining - sent}레벨)`, "#ffaa00");
          return;
        }
        const ts = Date.now();
        if (ts - lastBlockToast > 3000) {
          lastBlockToast = ts;
          toast(`⏳ 서버 초당 한도 — ${Math.ceil(waitMs / 1000)}초 후 자동 재개`, "#ffaa00");
        }
        timer = setTimeout(pump, waitMs);
        return;
      }

      // 이번 창 몫: 여유만큼 (최대 10건 = 500레벨)
      const burst = Math.min(room, remaining - sent);
      let n = 0;
      while (n < burst && sent < remaining) {
        const amt = Math.min(perIntent, remaining - sent);
        if (amt <= 0) break;
        try {
          bus.emit(new ctor(unitId, type, amt));
          rateUse();
        } catch (e) {
          console.warn("[x50] 업그레이드 emit 실패:", e);
          toast("❌ 업그레이드 발송 실패", "#ff5555");
          return;
        }
        sent += amt;
        n++;
      }
      if (sent < remaining) {
        // 창을 다 썼으면 회전까지, 아니면 짧게 재시도
        const wait2 = RL.secWindow.length >= RL.perSecond
          ? Math.max(40, RL.secWindow[0] + 1050 - Date.now())
          : 40;
        timer = setTimeout(pump, wait2);
        return;
      }
      finish();
    }

    toast(`🚀 ${koName(type)} +${remaining} 요청 (Lv ${t0} → ${t0 + remaining})${cappedByGold ? " — 골드 한도" : ""}`, "#ffd166");
    pump();
  }

  // ═════════════════════════════════════════════
  // 군함 대량 건조 (N 무장 → 바다 클릭)
  //
  // 게임 소스 검증:
  //   ConstructionExecution 의 amount 루프는 핵(AtomBomb/HydrogenBomb)에만 있다.
  //   Warship 케이스는 `new WarshipExecution(...)` 한 번만 호출 → amount 무시됨.
  //   따라서 여러 척을 띄우려면 build_unit 인텐트를 N번 반복 발송해야 한다.
  //   건조 위치는 서버가 정한다(warshipSpawn): 클릭한 바다와 같은 수역에 있는
  //   내 항구 중 가장 가까운 항구 타일. 항구가 없으면 건조되지 않는다.
  //   비용은 보유 수 기준 (n+1)×25만, 4척 넘으면 100만 고정.
  // ═════════════════════════════════════════════
  function requestWarships() {
    const game = getGameView();
    const bus = getEventBus();
    if (!game || !bus) { toast("❌ 게임 시작 후 사용하세요", "#ff5555"); return; }
    const me = game.myPlayer();
    if (!me) { toast("❌ 플레이어 정보 없음", "#ff5555"); return; }
    const ctor = findNukeEventCtor();   // build_unit 인텐트와 동일 클래스
    if (!ctor) { toast("❌ 건조 경로 없음 (게임 시작 후 재시도)", "#ff5555"); return; }
    const tile = computeCursorTile();
    if (tile === null) { toast("❌ 커서 위치 인식 실패", "#ff5555"); return; }

    // 바다인지 확인 (군함은 물에만 건조 가능)
    try {
      if (typeof game.isLand === "function" && game.isLand(tile)) {
        toast("❌ 바다를 클릭하세요 (군함은 육지에 못 띄웁니다)", "#ffaa00");
        setArmed(false);   // 실패했으면 무장 해제
        return;
      }
    } catch (e) {}

    // 항구 보유 확인 — 없으면 서버가 조용히 실패한다
    let portCount = 0;
    try {
      portCount = game.units("Port").filter((u) => {
        try { return u.owner().id() === me.id(); } catch (e) { return false; }
      }).length;
    } catch (e) {}
    if (portCount === 0) {
      toast("❌ 항구가 없습니다 — 군함은 항구에서만 건조됩니다", "#ff5555");
      setArmed(false);   // 실패했으면 무장을 풀어 사용자가 상태를 알 수 있게
      return;
    }

    const want = Math.max(1, Math.min(CFG.warshipCount | 0, CFG.warshipMaxCount));
    const baseDelay = Math.max(110, CFG.warshipDelayMs | 0);   // 초당 10개 제한(100ms) 대비 여유

    // 분당·초당 한도에 여유가 없으면 잠시 기다렸다가 다시 시도한다
    const room = rateDelayFor(want);
    if (room.allowed <= 0) {
      const wait = room.waitSec || rateGate() || 1;
      // 초당 한도는 짧게 기다리면 풀리므로 자동 재시도 (분당 소진은 길어서 포기)
      if (wait <= 3) {
        toast(`⏳ 서버 한도 — ${wait}초 후 자동 재시도`, "#ffd166");
        setTimeout(() => { try { requestWarships(); } catch (e) {} }, wait * 1000 + 80);
      } else {
        toast(`⏳ 서버 한도 소진 — 약 ${wait}초 후 다시 시도하세요`, "#ffaa00");
        setArmed(false);
      }
      return;
    }
    const count = room.allowed;
    // 남은 분당 여유에 맞춰 간격을 늘린다 (최소 간격 유지)
    const minGap = Math.ceil(60000 / Math.max(1, RL.perMinute - 5));
    const delay = Math.max(baseDelay, minGap);
    if (count < want) {
      toast(`🚢 한도로 ${want}척 중 ${count}척만 건조합니다`, "#ffd166");
    }

    let sent = 0;
    for (let i = 0; i < count; i++) {
      setTimeout(() => {
        try {
          // amount 는 서버가 군함에 대해 무시하므로 1로 보낸다
          bus.emit(new ctor("Warship", tile, undefined, 1));
          rateUse();
          sent++;
          if (sent === count) {
            toast(`🚢 군함 ${count}척 건조 요청 완료 (항구 ${portCount}곳)`, "#7ee787");
          }
        } catch (e) {
          console.warn("[x50] 군함 건조 emit 실패:", e);
          toast("❌ 군함 건조 발송 실패", "#ff5555");
        }
      }, i * delay);
    }
    if (count > 1) toast(`🚢 군함 ${count}척 건조 시작…`, "#7ee787");
  }

  // ═════════════════════════════════════════════
  // 인텐트 속도 제한 (서버와 동일한 규칙을 클라이언트에서 미리 계산)
  //
  // 게임 서버(ClientMsgRateLimiter): 초당 10개 AND 분당 150개.
  // 둘 다 통과해야 하며, 초과분은 통보 없이 조용히 버려진다(킥 아님).
  // 분당 버킷은 시간이 아니라 '분 경계'에서 리셋되므로, 소진하면
  // 최대 60초간 아무것도 안 먹히는 것처럼 보인다.
  //   → 여기서 미리 세어 한도에 닿으면 발사를 막고 남은 시간을 알려준다.
  // ═════════════════════════════════════════════
  const RL = {
    perSecond: 10,
    perMinute: 150,
    secWindow: [],     // 최근 1초간 인텐트 타임스탬프
    minWindow: [],     // 최근 1분간 인텐트 타임스탬프
  };

  // 발사 가능 여부 판정. 반환값 = 기다려야 할 초 (0이면 지금 가능)
  function rateGate() {
    const now = Date.now();
    RL.secWindow = RL.secWindow.filter((t) => now - t < 1000);
    RL.minWindow = RL.minWindow.filter((t) => now - t < 60000);

    // 서버가 여유를 갖도록 살짝 남긴다 (초당 1개·분당 5개)
    if (RL.secWindow.length >= RL.perSecond - 1) {
      const oldest = RL.secWindow[0];
      return Math.max(1, Math.ceil((1000 - (now - oldest)) / 1000));
    }
    if (RL.minWindow.length >= RL.perMinute - 5) {
      const oldest = RL.minWindow[0];
      return Math.max(1, Math.ceil((60000 - (now - oldest)) / 1000));
    }
    return 0;
  }

  function rateUse() {
    const now = Date.now();
    RL.secWindow.push(now);
    RL.minWindow.push(now);
  }

  // 여러 인텐트를 순차 발송할 때 남은 여유를 반환한다 (군함 건조 등).
  // 초당·분당 둘 다 고려한다: 초당은 간격으로, 분당은 총량으로 제한.
  function rateDelayFor(count) {
    const now = Date.now();
    RL.secWindow = RL.secWindow.filter((t) => now - t < 1000);
    RL.minWindow = RL.minWindow.filter((t) => now - t < 60000);
    const secRoom = Math.max(0, RL.perSecond - 1 - RL.secWindow.length);
    const minRoom = Math.max(0, RL.perMinute - 5 - RL.minWindow.length);
    // 초당 여유가 있으면 그만큼은 즉시 보낼 수 있다 (간격으로 분산)
    // 초당 여유가 0이면 이번엔 보내지 않는다 (1초 뒤 재시도 유도)
    return {
      secRoom, minRoom,
      allowed: Math.min(count, minRoom, secRoom > 0 ? count : 0),
      waitSec: secRoom > 0 ? 0 : (RL.secWindow.length ? Math.max(1, Math.ceil((1000 - (now - RL.secWindow[0])) / 1000)) : 0),
    };
  }

  function requestUpgrade(big) {
    const game = getGameView();
    const bus = getEventBus();
    if (!game || !bus) { toast("❌ 게임 시작 후 사용하세요", "#ff5555"); return; }
    const me = game.myPlayer();
    if (!me) { toast("❌ 플레이어 정보 없음", "#ff5555"); return; }
    const ctor = findUpgradeEventCtor();
    if (!ctor) { toast("❌ 업그레이드 경로 없음 (게임 시작 후 재시도)", "#ff5555"); return; }
    const tile = computeCursorTile();
    if (tile === null) { toast("❌ 커서 위치 인식 실패", "#ff5555"); return; }

    const types = CFG.upgradableTypes;
    const maxDist = 15; // 게임 structureMinDist와 동일

    // 폴백: 게임 판정을 못 쓸 때 직접 최근접 탐색
    const direct = () => {
      const hit = nearestOwn(game, me, tile, types, maxDist);
      if (hit) { fireUpgrade(hit.unit.id(), hit.unit.type(), null, me, bus, ctor, big); return; }
      const dp = nearestOwn(game, me, tile, ["Defense Post"], maxDist);
      if (dp) { toast("ℹ️ 디펜스 포스트는 업그레이드할 수 없습니다", "#ffaa00"); return; }
      toast(`❌ 반경 ${maxDist}타일 내 업그레이드 가능한 내 구조물 없음`, "#ffaa00");
    };

    // 1순위: 게임 공식 판정 (buildables → canUpgrade = 업그레이드 대상 유닛 id)
    let p = null;
    try {
      if (typeof me.buildables === "function") p = me.buildables(tile, types);
      else if (typeof me.actions === "function") p = me.actions(tile, types);
    } catch (e) { p = null; }

    if (!p || typeof p.then !== "function") { direct(); return; }

    p.then((res) => {
      const arr = Array.isArray(res) ? res : (res && res.buildableUnits) || [];
      // canUpgrade가 살아있는 행들 중 클릭 지점에서 가장 가까운 구조물 선택
      let bestId = null, bestType = null, bestRow = null, bestD = Infinity;
      for (const row of arr) {
        if (!row || row.canUpgrade === false) continue;
        let d = Infinity;
        try {
          // game.unit(id) 없으면 전체 유닛에서 찾는다
          let u = null;
          if (typeof game.unit === "function") u = game.unit(row.canUpgrade);
          if (!u) {
            for (const cand of game.units(row.type)) {
              try { if (cand.id() === row.canUpgrade) { u = cand; break; } } catch (e) {}
            }
          }
          if (u) d = game.manhattanDist(tile, u.tile());
        } catch (e) {}
        if (d < bestD) { bestD = d; bestId = row.canUpgrade; bestType = row.type; bestRow = row; }
      }
      if (bestId !== null) { fireUpgrade(bestId, bestType, bestRow, me, bus, ctor, big); return; }

      // 업그레이드 대상이 없음 → 사유를 정확히 안내
      const hit = nearestOwn(game, me, tile, types, maxDist);
      if (hit) {
        try {
          if (typeof hit.unit.isUnderConstruction === "function" && hit.unit.isUnderConstruction()) {
            toast(`⏳ ${koName(hit.unit.type())} 건설 중 — 완료 후 다시 시도`, "#ffaa00");
            return;
          }
        } catch (e) {}
        // 골드 부족 여부 판정
        let row = null;
        for (const r of arr) { if (r && r.type === hit.unit.type()) { row = r; break; } }
        if (row && row.cost !== undefined && toBig(row.cost) > toBig(me.gold())) {
          toast(`❌ 골드 부족 — ${koName(hit.unit.type())} 다음 강화에 ${String(row.cost)} 필요`, "#ff5555");
          return;
        }
        fireUpgrade(hit.unit.id(), hit.unit.type(), row, me, bus, ctor, big);
        return;
      }
      const dp = nearestOwn(game, me, tile, ["Defense Post"], maxDist);
      if (dp) { toast("ℹ️ 디펜스 포스트는 업그레이드할 수 없습니다", "#ffaa00"); return; }
      toast(`❌ 반경 ${maxDist}타일 내 업그레이드 가능한 내 구조물 없음`, "#ffaa00");
    }).catch(() => { try { direct(); } catch (e) {} });
  }

  // ── 무장 상태 클릭 가로채기 (캡처 단계 → 게임보다 먼저) ──
  // 무장은 클릭해도 풀리지 않는다 — V/N을 다시 누르거나 Esc 로만 해제.
  // (여러 구조물을 연속으로 올릴 때 매번 키를 다시 누르지 않도록)
  window.addEventListener("pointerdown", (e) => {
    if (!armed) return;
    if (e.button !== 0) return;
    lastMouse = { x: e.clientX, y: e.clientY };
    const mode = armedMode;   // 이번 클릭 처리 후에도 유지
    suppressUp = true;
    clearTimeout(suppressTimer);
    // pointerup이 유실돼도 다음 클릭이 삼켜지지 않도록 자동 해제
    suppressTimer = setTimeout(() => { suppressUp = false; }, 1500);
    try { e.preventDefault(); e.stopPropagation(); } catch (err) {}
    try {
      if (mode === "warship") requestWarships();
      else requestUpgrade(mode === "upgradeBig");
    } catch (err) {}
    scheduleIdleDisarm();   // 연속 작업 중에는 무장 유지
  }, true);

  window.addEventListener("pointerup", (e) => {
    if (!suppressUp) return;
    suppressUp = false;
    clearTimeout(suppressTimer);
    try { e.preventDefault(); e.stopPropagation(); } catch (err) {}
  }, true);

  function setArmed(v, mode) {
    armed = v;
    armedMode = v ? (mode || "upgrade") : null;
    clearTimeout(idleTimer);
    if (v) {
      if (armedMode === "warship") {
        toast(`🚢 군함 무장 ON — 바다를 클릭하면 ${CFG.warshipCount}척 건조 (N/Esc: 해제)`, "#7ee787");
      } else if (armedMode === "upgradeBig") {
        const silo = (CFG.addLevelsByTypeBig && CFG.addLevelsByTypeBig["Missile Silo"]) || CFG.addLevelsBig;
        toast(`🚀 업그레이드(大) 무장 ON — 클릭당 +${CFG.addLevelsBig} (사일로 +${silo}) (X/Esc: 해제)`, "#7ee787");
      } else {
        toast("🎯 업그레이드 무장 ON — 구조물을 계속 클릭하세요 (V/Esc: 해제)", "#7ee787");
      }
      scheduleIdleDisarm();
    } else {
      toast("⚪ 무장 해제", "#ffaa00");
    }
  }

  // 무장은 유지되지만, 오래 방치하면 실수 클릭을 막기 위해 자동 해제한다.
  // 업그레이드를 할 때마다 타이머가 갱신되므로 연속 작업 중에는 풀리지 않는다.
  const IDLE_DISARM_MS = 90000;
  function scheduleIdleDisarm() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (!armed) return;
      armed = false;
      toast("⌛ 무장 자동 해제 (90초 미사용)", "#ffaa00");
    }, IDLE_DISARM_MS);
  }

  // ── 키 입력 ──
  function isTypingTarget(el) {
    if (!el) return false;
    return (
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      (el && el.isContentEditable)
    );
  }
  window.addEventListener(
    "keydown",
    (e) => {
      if (isTypingTarget(e.target)) return;

      // ── 반복 입력 처리 ──
      // 키를 누르고 있으면 OS auto-repeat(초당 ~30회)이 들어온다.
      // 이를 그대로 보내면 서버 한도(초당 10·분당 150)를 태워 먹통이 되므로,
      // '서버가 감당하는 속도'로 눌러주는 것과 같게 만든다:
      //   - 한 번 누름(repeat 아님) → 즉시 1회
      //   - 누르고 있음(repeat)     → 한도에 여유가 있는 동안 계속 발사
      // 초당 한도는 rateGate() 가, 분당 한도도 함께 검사한다.
      const isFireKey =
        e.code === CFG.hotkey || e.code === CFG.hotkeyMax ||
        e.code === CFG.hotkeyHydro || e.code === CFG.hotkeyMirv;

      // 대량 살포는 반복 입력을 무시한다 (연사는 내부 스케줄이 담당)
      if (e.repeat && e.code === CFG.hotkeySalvo) return;
      if (e.repeat && isFireKey && !CFG.holdRepeat) return;   // holdRepeat 끄면 반복 무시

      const stop = () => {
        e.preventDefault();
        if (CFG.swallowGameKeys) { try { e.stopPropagation(); } catch (err) {} }
      };

      // 서버 한도에 여유가 없으면 건너뛴다 (토스트는 3초에 한 번만)
      const gate = () => {
        const wait = rateGate();
        if (wait > 0) {
          const now = Date.now();
          if (now - lastBlockToast > 3000) {
            lastBlockToast = now;
            toast(`⏳ 서버 한도 — ${wait}초 후 자동 재개 (계속 누르고 계셔도 됩니다)`, "#ffaa00");
          }
          return false;
        }
        return true;
      };

      if (e.code === CFG.hotkey) {
        stop();
        if (gate()) fireAtoms(CFG.amount);
      } else if (e.code === CFG.hotkeyMax) {
        stop();
        if (gate()) fireMax();
      } else if (e.code === CFG.hotkeyHydro) {
        stop();
        if (gate()) fireHydro();
      } else if (e.code === CFG.hotkeyMirv) {
        stop();
        if (gate()) fireMirv();
      } else if (e.code === CFG.hotkeySalvo) {
        stop();
        startSalvo();
      } else if (e.code === "Escape" && (salvoQueue.length > 0 || salvoTimer !== null)) {
        e.preventDefault();
        salvoStop("⚪ 대량 발사 중단");
      } else if (e.code === CFG.hotkeyUpgrade) {
        stop();
        setArmed(armedMode !== "upgrade", "upgrade");
      } else if (e.code === CFG.hotkeyUpgradeBig) {
        stop();
        setArmed(armedMode !== "upgradeBig", "upgradeBig");
      } else if (e.code === CFG.hotkeyWarship) {
        stop();
        setArmed(armedMode !== "warship", "warship");
      } else if (e.code === "Escape" && armed) {
        e.preventDefault();
        setArmed(false);
      }
    },
    true,
  );

  // ── 토스트 ──
  let toastEl = null;
  let toastTimer = null;
  function toast(msg, color) {
    try {
      if (!toastEl) {
        toastEl = document.createElement("div");
        toastEl.style.cssText = [
          "position:fixed","top:64px","left:50%","transform:translateX(-50%)",
          "z-index:999999","padding:10px 18px","border-radius:8px",
          "font:600 14px/1.4 -apple-system,sans-serif","color:#fff",
          "background:rgba(20,20,24,.92)","border:1px solid rgba(255,255,255,.15)",
          "box-shadow:0 4px 16px rgba(0,0,0,.4)","pointer-events:none","white-space:nowrap",
        ].join(";");
        document.body.appendChild(toastEl);
      }
      toastEl.textContent = msg;
      toastEl.style.borderLeft = `4px solid ${color || "#ffd166"}`;
      toastEl.style.display = "block";
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        if (toastEl) toastEl.style.display = "none";
      }, CFG.toastMs);
    } catch (e) {}
  }

  // ── 디버그용 노출 (F12 콘솔: __x50) ──
  try {
    window.__x50 = {
      CFG, setArmed, requestUpgrade, requestWarships, rateGate, rateDelayFor, rateUse, RL,
      fireAtoms, fireHydro, fireMax, fireMirv, startSalvo, salvoStop,
      requestUpgrade, requestUpgradeBig: () => requestUpgrade(true),
      salvoState, salvoQueue: () => salvoQueue.slice(), salvoPending,
      atomCostPerBomb, myGold, readyTubes,
      findNukeEventCtor, findUpgradeEventCtor, getGameView, getEventBus,
      targetFor, unitLevel, goalLevel, addFor,
    };
  } catch (e) {}

  // ── 상태 로그 ──
  const readyTimer = setInterval(() => {
    const bus = getEventBus();
    if (!bus) return;
    const nuke = findNukeEventCtor();
    const up = findUpgradeEventCtor();
    if (nuke) {
      clearInterval(readyTimer);
      console.log(
        `[x50] 준비 완료 — Z: ${CFG.salvoAmount.toLocaleString()}발 (연타=대기열) / H: 원자50발 / G: xMax / J: 수소 / M: MIRV / V→구조물: +${CFG.addLevels}Lv / X→구조물: +${CFG.addLevelsBig}Lv / N→바다: 군함 ${CFG.warshipCount}척` +
        `${up ? "" : " (업그레이드 경로 미확인)"}`,
      );
    }
  }, 1000);
  setTimeout(() => clearInterval(readyTimer), 120000);
})();
