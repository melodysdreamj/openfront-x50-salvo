// ==UserScript==
// @name         OpenFront x50 Nuke + Structure Max (private/사설 로비용)
// @namespace    of-x50-salvo
// @version      2.9.0
// @description  사설로비용 — x50 원자 살포 · 구조물 대량 업그레이드 · SAM 인식 수소타격(I: 커서 150타일 내 SAM 레벨합×1.2 → 수소 → 후속)
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
    hotkeyStrike: "KeyI",       // 한큐 수소타격 — SAM 전량 분석 → 필요 원자 전량 → 수소 1발 → 3~5% 추가
    salvoAmount: 1000,          // 1회 발수 (50발 단위로 올림)
    salvoBatch: 10,             // 창당 인텐트 수 (서버 초당 한도 = 10)
    salvoBatchPeriodMs: 1150,   // 창 간격 = 1,000ms(서버 초당 창) + 여유 150ms
    salvoMaxAmount: 50000,      // 1회 발수 안전 상한 (오설정 방지)
    salvoQueueMaxItems: 50,     // 대기열 최대 건수 (연타 상한)
    salvoStopOnGold: true,      // 골드 소진 시 남은 대기열 중단 (버려질 인텐트 방지)
    salvoWaitForReload: false,  // 발사관 소진 시: false=중단 / true=재장전(9초) 대기 후 자동 재개

    // ── SAM 인식 살포 (v2.5) ──
    // 목표를 지키는 '적 SAM'이 있으면 수소타격으로 전환:
    //   ① 시뮬레이터로 필요 원자 C를 계산하고, 거기에 랜덤 5~50발을 가산한
    //      '총량'으로 다시 시뮬레이션한다 (수소 타이밍은 그 총량 기준으로 유지)
    //   ② '회복이 하나도 없는 사각창'에 도착하도록 역산한 시각에 수소 1발
    //      (수소는 SAM 최우선 표적 — 원자와 같이 오면 먼저 요격된다)
    //   ③ 그후 원자 수십발 + 수소 몇발을 랜덤 간격으로 더 뿌린다
    // SAM이 없으면 기존과 동일하게 salvoAmount 대로 원자만 쏜다.
    salvoSamAware: true,    // Z 살포를 SAM 인식 모드로
    // ── v2.8: 단순 모드 ──
    //   복잡한 경로·타이밍 시뮬레이터 대신 '커서 150타일 내 SAM 레벨 합 × 1.2'로 발사량을 정한다.
    //   (Z는 수소를 섞지 않고 예전처럼 최대 속도로 순수 원자 살포 — salvoSamAware 무시)
    samSimpleMode: true,    // true=단순 규칙 / false=기존 정밀 시뮬레이터
    samSimpleRange: 150,    // 커서 기준 SAM 수집 반경 (타일)
    samSimpleMult: 1.5,     // ΣLv × 이 배수 = 발사량 (50% 더)
    samZPure: true,         // Z 살포는 수소 미포함 · 순수 원자 최대속도
    samHydroCount: 1,       // (구) 마지막에 쏘는 수소 수 — samHydroEvery 사용 시 무시
    // ── v2.9: 원자 N발마다 수소를 '섞어' 쏜다 ──
    //   마지막에 한 번만 쏘면 서버 창이 꽉 찼을 때 드롭(짤림)된다.
    //   살포 중간중간 섞으면 창에 여유가 있을 때 나가므로 안전하다.
    samHydroEvery: 200,     // 원자 200발마다 수소 1발 (0=끔)
    samHydroEveryJitter: 20,// 발수 지터 (200±20 → 인텐트 경계와 정렬 · 티 제거)
    samRangeExtra: 0,       // SAM 참여 판정 직선 여유 (0 = 경로 판정만. 내 사일로를 못 읽으면 150 안전여유)
    samCap: 20000,          // 시뮬레이터 1회 계획의 원자 상한 (오설정 방지)

    // ── 랜덤성 (v2.6) — '정확히 계산된 발수'는 자동화 티가 난다 ──
    //   게임 리뷰에서 부정 사용으로 보이지 않도록 발수·순서·간격에 무작위성을 준다.
    //   ① 필요 원자에 가산하는 랜덤 폭 (이 총량으로 시뮬 → 수소 타이밍 유지)
    //   ② 수소 발사 후 후속 산개: 원자 수십발 + 수소 몇발 (간격도 랜덤)
    samJitterMin: 5,        // ① 가산 하한 (발) — 랜덤 성분
    samJitterMax: 50,       // ① 가산 상한 (발)
    //   ①-2 여유율 — '날아가는 동안 적이 SAM을 증원(건설·업그레이드)할 가능성' 대비.
    //        여유분 = max(필요량 × 이 %, 랜덤 5~50발)  → 둘 중 큰 쪽을 쓴다.
    //        (작은 규모에선 랜덤이, 큰 규모에선 10%가 지배한다)
    samReservePct: 10,
    samAfterMin: 20,        // ② 후속 원자 하한 (수십발)
    samAfterMax: 90,        // ② 후속 원자 상한 (수십발)
    samAfterHydroMin: 1,    // ② 후속 수소 하한 (몇발)
    samAfterHydroMax: 3,    // ② 후속 수소 상한 (몇발)
    samAfterGapMinMs: 350,  // ② 후속 간격 하한 (ms)
    samAfterGapMaxMs: 1600, // ② 후속 간격 상한 (ms)

    // ── 코너 HUD (v2.5) ──
    // ① 서버 리밋: '초당 한도의 80% 이상'을 쓸 수 있게 되는 시점까지 카운트다운
    // ② 타깃 타격 가능성: 커서 위치 적 SAM 용량 + 내 사일로/골드로
    //    '소진 원자 + 수소 1발 + 추가분'이 가능한지 상시 표기
    hud: true,               // 화면 모서리 상태 패널
    hudCorner: "bottom-left",// top-left | top-right | bottom-left | bottom-right
    hudUsablePct: 80,        // '사용 가능' 기준 — 서버 초당 한도의 이 비율
    hudHover: true,          // 커서 위치 타깃의 타격 가능성 표시

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
    // 한 번의 클릭에서 '한 서버창(1초)'에 몰아 보낼 최대 인텐트 수.
    //   서버 초당 한도는 10건인데 X(+500=10건)를 다 몰아쓰면 그 1초 동안
    //   창을 독점해 Z 살포·수소·MIRV·다른 업그레이드가 전부 대기한다.
    //   6으로 두면 창에 4건 여유를 남기고 나머지는 다음 창에서 이어간다
    //   (체감 소요는 +500에 약 1.2초 — 게임 클라이언트도 창을 꽉 채우지 않는다).
    upgradeBurstPerWindow: 6,
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
  // ── 소유자 판정 (v2.8.3) ──
  //   게임 내부는 smallID(숫자)로 플레이어를 비교한다. PlayerView.id()는 문자열(클라이언트 ID)이라
  //   직접 비교하면 어긋날 수 있다. 두 값을 모두 시도하고, 판독 실패는 '내 것 아님'으로 본다.
  function isOwnedByMe(u, me) {
    try {
      if (!u || !me) return false;
      const o = (typeof u.owner === "function") ? u.owner() : null;
      if (!o) return false;
      let oS = null, mS = null;
      try { if (typeof o.smallID === "function") oS = o.smallID(); } catch (e) {}
      try { if (typeof me.smallID === "function") mS = me.smallID(); } catch (e) {}
      if (oS !== null && oS !== 0 && mS !== null && oS === mS) return true;
      if (typeof o.id === "function" && typeof me.id === "function") {
        try { return o.id() === me.id(); } catch (e) {}
      }
    } catch (e) {}
    return false;
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
  let lastMouseMoveAt = 0;
  window.addEventListener(
    "mousemove",
    (e) => { lastMouse = { x: e.clientX, y: e.clientY }; lastMouseMoveAt = Date.now(); },
    { passive: true },
  );

  function computeCursorTile() {
    try {
      const game = getGameView();
      const tf = getTransform();
      if (!game || !tf) return null;
      const w = tf.screenToWorldCoordinates(lastMouse.x, lastMouse.y);
      if (!w) return null;
      // 좌표 유효성: 정수화 후 검사 (게임은 정수 타일만 허용)
      const ix = Math.floor(w.x), iy = Math.floor(w.y);
      if (!Number.isFinite(ix) || !Number.isFinite(iy)) return null;
      if (typeof game.isValidCoord === "function" && !game.isValidCoord(ix, iy)) return null;
      let t;
      try { t = game.ref(ix, iy); } catch (e) { return null; }   // ref는 범위 밖이면 예외를 던진다
      if (t === undefined || t === null) return null;
      if (typeof game.isValidRef === "function" && !game.isValidRef(t)) return null;
      return t;
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
  let salvoDone = 0;          // 이번 연속 살포에서 다 나간 원자 누적 (토스트용)
  let salvoHydroDone = 0;     // 이번 연속 살포에서 나간 수소 누적
  let salvoItemsDone = 0;     // 다 나간 건수
  let salvoDryWaits = 0;      // 발사관 재장전 대기 횟수 (salvoWaitForReload 모드)
  let salvoHydro = null;      // 수소타격에서 예약된 수소 1발 {tile, fireTick, fireAt, armedAt, bus, ctor, fired, armed}
  let salvoHydroTimer = null; // 수소 발사 대기 타이머 (armHydroTimer)
  let salvoFollow = null;     // 후속 산개 {tile, bus, ctor, atomsLeft, hydrosLeft, atoms0, hydros0, started, timer}
  let lastStrike = null;      // 마지막 SAM 뚫기 계획 (디버그·HUD용)

  function salvoPending() {
    return salvoQueue.reduce((a, it) => a + (it.total - it.sent), 0);
  }

  function salvoState() {
    if (salvoQueue.length === 0 && salvoHydro === null && salvoFollow === null) return null;
    const fLeft = salvoFollow ? (salvoFollow.atomsLeft + salvoFollow.hydrosLeft) : 0;
    return {
      items: salvoQueue.length,
      remaining: salvoPending(),
      hydroPending: (salvoHydro ? 1 : 0) + (salvoFollow ? salvoFollow.hydrosLeft : 0),
      hydroFinished: salvoHydroDone,
      finished: salvoDone,
      followLeft: fLeft,
      total: salvoDone + salvoPending() + (salvoHydro ? 1 : 0) + fLeft,
    };
  }

  function salvoClear(msg) {
    // 큐가 비고 타이머도 없어도, 이번 연속 살포에서 이미 발사한 게 있으면
    // '진행 중이던 작업'이므로 완료/중단 토스트를 띄운다.
    const wasRunning = salvoQueue.length > 0 || salvoTimer !== null || salvoDone > 0 || salvoHydro !== null || salvoHydroDone > 0 || salvoFollow !== null;
    if (salvoTimer !== null) { clearTimeout(salvoTimer); salvoTimer = null; }
    if (salvoHydroTimer !== null) { clearTimeout(salvoHydroTimer); salvoHydroTimer = null; }
    let fDrop = 0;
    if (salvoFollow !== null) { if (salvoFollow.timer !== null) clearTimeout(salvoFollow.timer); fDrop = salvoFollow.atomsLeft + salvoFollow.hydrosLeft; salvoFollow = null; }
    if (!wasRunning) return;
    const finished = salvoDone, items = salvoItemsDone, dropped = salvoPending();
    const hFin = salvoHydroDone, hDrop = (salvoHydro ? 1 : 0) + fDrop;
    const hTxt = hFin > 0 ? ` + 수소 ${hFin}발` : "";
    salvoQueue = []; salvoHydro = null;
    salvoDone = 0; salvoItemsDone = 0; salvoDryWaits = 0; salvoHydroDone = 0; lastStrike = null;
    if (msg) {
      toast(`${msg} — ${finished.toLocaleString()}발${hTxt} 발사됨${(dropped + hDrop) > 0 ? ` · 대기 ${(dropped + hDrop).toLocaleString()}발 폐기` : ""}`, "#ffaa00");
    } else {
      toast(`☢️ 대량 발사 완료 — ${finished.toLocaleString()}발${hTxt} (${items}건)`, "#7ee787");
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

  function hydroCostPerBomb() {
    // 수소폭탄 1발 단가. null = 확인 불가 / 0n = 무료(무한골드 로비)
    try {
      const g = getGameView();
      if (!g) return null;
      const me = typeof g.myPlayer === "function" ? g.myPlayer() : null;
      const cfg = typeof g.config === "function" ? g.config() : null;
      if (!me || !cfg) return null;
      try { if (typeof cfg.infiniteGold === "function" && cfg.infiniteGold()) return 0n; } catch (e) {}
      const info = typeof cfg.unitInfo === "function" ? cfg.unitInfo("Hydrogen Bomb") : null;
      if (info && typeof info.cost === "function") {
        try {
          const c = info.cost(g, me);
          if (c !== null && c !== undefined) return toBig(c);
        } catch (e) {}
      }
      return 5000000n;   // Config.ts: HydrogenBomb = 5,000,000
    } catch (e) { return null; }
  }

  // ═════════════════════════════════════════════
  // SAM 뚫기 시뮬레이터 — 수소타격 계획 (v2.5)
  //
  // 게임 소스로 확정한 모델:
  //  · SAM 슬롯 = 레벨. 요격 후 90틱(9.0초) 점유, 1개씩 회복(FIFO).
  //    → '사각창' = 모든 슬롯이 점유된 채 회복이 없는 구간.
  //      수소가 이 창 안에 도착하면 어떤 슬롯도 요격할 수 없다.
  //  · 폭탄 교전창 = [도착 − 18.333ms×사거리, 도착 − 200ms].
  //    수소는 SAM의 최우선 표적이라 이 창에 빈 슬롯이 '한 번이라도'
  //    생기면 요격된다 → 도착 시각을 사각창 한가운데로 역산한다.
  //  · 사일로 발사관(레벨): 같은 사일로 연속 발사는 1틱씩 밀리고(체인),
  //    배정은 '쿨다운 아닌 가장 가까운 사일로'가 받는다.
  //    → 사일로 기수(=병렬성)가 도착 분산을 좌우한다.
  //  · 전송: 창(1,150ms)당 최대 10건 × 50발. 관 부족분은 부분 발사(드롭 0).
  //
  // 수소타격 3단계 (새 키 I):
  //   ① 목표를 커버하는 모든 SAM을 분석해 필요 원자 C를 시뮬로 계산 → 전량 발사
  //   ② C파동의 사각창에 도착하도록 역산한 시각에 수소 1발
  //   ③ 그후 원자 3~5%(랜덤) 추가 벌크
  // ═════════════════════════════════════════════
  // ── 시뮬 코어 (순수 계산 — 게임 객체 미사용) ──
  //   게임 소스로 확정한 규칙:
  //     · 핵은 사일로→목표를 '3차 베지어(포물선)'로 난다 — 방향 설정(정/역)에 따라
  //       위(-y)로 솟거나 아래(+y)로 처진다. 같은 사일로라도 목표가 다르면 궤적이 다르다.
  //     · SAM이 핵을 격추하려면 그 순간 핵이 ① 목표 150타일 이내 '또는' 발사 사일로
  //       150타일 이내(targetable)이고 ② SAM 사거리 이내이며 ③ SAM 미사일이 먼저 도착해야 한다.
  //     · 따라서 '어느 SAM이 이 타격에 참여하는가'는 직선거리가 아니라 궤적 형상이 결정한다.
  const SIMC = { TICK: 100, CD_T: 90, SPEED_T: 10, SAM_MSL: 12, TGT_R: 150, END_MS: 200, WIN: 1150, PER: 50 };
  let stH2LastGap = null;   // H2가 격추되는 지점 진단 (실패 사유 설명용)

  function samRangeAtLevel(level) {
    try {
      const g = getGameView();
      const cfg = g && typeof g.config === "function" ? g.config() : null;
      if (cfg && typeof cfg.samRange === "function") {
        const r = cfg.samRange(level);
        if (Number.isFinite(r) && r > 0) return r;
      }
    } catch (e) {}
    return 150 - 480 / (Math.max(1, level) + 5);   // Config.ts 폴백
  }

  // 지도 높이 (베지어 제어점 클램프용) — 못 읽으면 0 (클램프 생략)
  function simMapH() {
    try {
      const g = getGameView();
      if (g && typeof g.height === "function") {
        const h = g.height();
        if (Number.isFinite(h) && h > 1) return h;
      }
    } catch (e) {}
    return 0;
  }

  // ── 경로: 사일로→목표 3차 베지어 (게임 getParabolaControlPoints와 동일 규칙) ──
  //   dirUp=true → 위로 솟음 / false → 아래로 처짐.  누적 호장(cum)을 함께 돌려준다.
  function stPath(sx, sy, tx, ty, dirUp, n, mapH) {
    const dx = tx - sx, dy = ty - sy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const h = Math.max(dist / 3, 50);          // PARABOLA_MIN_HEIGHT = 50
    const hm = dirUp ? -1 : 1;
    let c1x = sx + dx / 4, c1y = sy + dy / 4 + hm * h;
    let c2x = sx + dx * 3 / 4, c2y = sy + dy * 3 / 4 + hm * h;
    if (mapH > 0) {                            // 게임과 동일하게 제어점을 지도 안으로 클램프
      if (c1y < 0) c1y = 0; else if (c1y > mapH - 1) c1y = mapH - 1;
      if (c2y < 0) c2y = 0; else if (c2y > mapH - 1) c2y = mapH - 1;
    }
    // 샘플링: 요격은 '목표 150 이내 or 사일로 150 이내'에서만 가능하므로
    //   양 끝 구간을 3배 밀집 샘플링한다 (중간 구간은 요격 불가라 듬성해도 무방).
    // 경로 샘플: 기본 3중(촘촘), 대규모에선 호출부가 n을 낮춘다.
    //   (요격 경계는 '목표/사일로 150 이내' 구간에서 결정되므로 그쪽만 촘촘하면 충분)
    const N = n || 48;
    const ts = [0];
    for (let i = 0; i < N; i++) {
      const a = i / N, b = (i + 1) / N;
      ts.push(a + (b - a) / 3);
      ts.push(a + (b - a) * 2 / 3);
      ts.push(b);
    }
    ts.sort((a, b) => a - b);
    const pts = new Array(ts.length);
    let arc = 0, lx = sx, ly = sy;
    for (let i = 0; i < ts.length; i++) {
      const t = ts[i], mt = 1 - t;
      const x = mt * mt * mt * sx + 3 * mt * mt * t * c1x + 3 * mt * t * t * c2x + t * t * t * tx;
      const y = mt * mt * mt * sy + 3 * mt * mt * t * c1y + 3 * mt * t * t * c2y + t * t * t * ty;
      if (i > 0) { const ax = x - lx, ay = y - ly; arc += Math.sqrt(ax * ax + ay * ay); }
      pts[i] = { x: x, y: y, cum: arc };
      lx = x; ly = y;
    }
    const flightT = Math.max(1, Math.ceil(arc / SIMC.SPEED_T));
    return { pts, arc, flightT, flightMs: flightT * SIMC.TICK, dist };
  }

  // ── SAM별 '격추 가능 구간' (발사 시각=0 기준 상대 ms) ──
  //   경로점 하나하나에 대해 세 조건을 검사해 만족하는 연속 구간을 뽑는다.
  //   out: { samIndex → [{s,e}] }
  // ── SAM별 '격추 가능 구간' (발사 시각=0 기준 상대 ms) ──
  //   게임(SAMLauncherExecution)의 판정을 그대로 옮긴다:
  //     ① computeInterceptionTile: 경로를 따라가며
  //        - 그 지점이 요격 가능(targetable: 목표 150 or 사일로 150 이내)
  //        - SAM 사거리 이내
  //        - nukeTicks(그 지점까지 남은 핵 비행 틱) >= samTicks(SAM 미사일 도달 틱)
  //        이면 그 틱에 발사한다 → 교전 성립.
  //     ② checkDetonationInterception: 마지막 타일(폭발 직전)도 별도로 검사한다
  //        (경로 끝에서 급격히 가까워지는 경우를 잡기 위함).
  //   샘플을 촘촘히(경로 전체를 1타일 간격에 가깝게) 훑어 경계를 놓치지 않는다.
  function stEngage(path, sams, sx, sy, tx, ty, out) {
    const pts = path.pts, arc = path.arc, fT = path.flightT, fMs = path.flightMs;
    const R2 = SIMC.TGT_R * SIMC.TGT_R;
    for (let si = 0; si < sams.length; si++) {
      const S = sams[si];
      const r = (S.rng && S.rng > 0) ? S.rng : 150;
      const r2 = r * r;
      let s0 = -1, e0 = -1, list = null;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const dT = (p.x - tx) * (p.x - tx) + (p.y - ty) * (p.y - ty);
        const dS = (p.x - sx) * (p.x - sx) + (p.y - sy) * (p.y - sy);
        let ok = false;
        if (dT <= R2 || dS <= R2) {                       // 요격 가능 지점 (targetable)
          const ddx = p.x - S.x, ddy = p.y - S.y;
          if (ddx * ddx + ddy * ddy <= r2) {              // SAM 사거리 이내
            const mdist = Math.abs(ddx) + Math.abs(ddy);
            const samT = Math.ceil(mdist / SIMC.SAM_MSL);
            const nukeT = ((arc - p.cum) / arc) * fT;     // 남은 비행 틱
            // 게임과 동일: 핵의 남은 비행이 SAM 미사일 도달보다 길거나 같아야 발사 가능
            //   (여유 2틱을 둔다 — 폭발 직전엔 판정이 촘촘해 실전 오차를 흡수)
            if (nukeT >= samT - 2) ok = true;
          }
        }
        if (ok) { if (s0 < 0) s0 = p.cum; e0 = p.cum; }
        else if (s0 >= 0) { (list || (list = [])).push({ s: s0, e: e0 }); s0 = -1; }
      }
      if (s0 >= 0) (list || (list = [])).push({ s: s0, e: e0 });
      if (list) {
        const ivs = [];
        for (let k = 0; k < list.length; k++) {
          const a = (list[k].s / arc) * fMs, b = (list[k].e / arc) * fMs;
          if (ivs.length && a <= ivs[ivs.length - 1].e + 200) { if (b > ivs[ivs.length - 1].e) ivs[ivs.length - 1].e = b; }
          else ivs.push({ s: a, e: b });
          // 마지막 지점까지 계속: 구간을 최소 폭(300ms)으로 보정 — 실전 요격은 순간적
        }
        for (let k = 0; k < ivs.length; k++) { if (ivs[k].e - ivs[k].s < 300) ivs[k].e = ivs[k].s + 300; }
        out[si] = ivs;
      }
    }
    return out;
  }

  // 구간 목록 병합 (정렬 + 겹침/근접 병합)
  function stMergeIvs(list) {
    if (!list || !list.length) return null;
    list.sort((a, b) => a.s - b.s);
    const out = [{ s: list[0].s, e: list[0].e }];
    for (let i = 1; i < list.length; i++) {
      const iv = list[i], last = out[out.length - 1];
      if (iv.s <= last.e + 60) { if (iv.e > last.e) last.e = iv.e; }
      else out.push({ s: iv.s, e: iv.e });
    }
    return out;
  }

  // 목표 지역을 '실제로 위협하는' 적 SAM 집계. null = 읽기 불가(계획 생략)
  //   참여 판정 = 목표 근처 직선(사거리) '또는' 내 사일로→목표 궤적상 격추 가능 구간 존재
  function samDefenders(tile) {
    try {
      const g = getGameView();
      if (!g || typeof g.units !== "function" || typeof g.x !== "function" || typeof g.y !== "function") return null;
      const me = typeof g.myPlayer === "function" ? g.myPlayer() : null;
      if (!me || typeof me.id !== "function") return null;
      const t = (tile === undefined || tile === null) ? computeCursorTile() : tile;
      if (t === null || t === undefined) return null;
      let tx, ty;
      try { tx = g.x(t); ty = g.y(t); } catch (e) { return null; }
      if (!Number.isFinite(tx) || !Number.isFinite(ty)) return null;
      const list = g.units("SAM Launcher");
      if (!list || typeof list.length !== "number") return null;
      // 내 사일로 위치 (궤적 계산용)
      let silPos = [];
      try {
        const sil = mySilos(t);
        if (sil) for (let i = 0; i < sil.length; i++) if (Number.isFinite(sil[i].x) && Number.isFinite(sil[i].y)) silPos.push(sil[i]);
      } catch (e) {}
      // 1차 후보 필터: 궤적·목표 어디에도 닿을 수 없는 SAM은 제외
      const cand = [];
      const rej = [];   // 진단용: 왜 제외됐는지
      for (let i = 0; i < list.length; i++) {
        const u = list[i];
        try {
          const o = (typeof u.owner === "function") ? u.owner() : null;
          if (!o || typeof o.id !== "function") continue;
          { let eq = false;
            try { let oS = null, mS = null;
              if (typeof o.smallID === "function") oS = o.smallID();
              if (typeof me.smallID === "function") mS = me.smallID();
              if (oS !== null && oS !== 0 && mS !== null && oS === mS) eq = true;
              if (!eq && typeof o.id === "function" && typeof me.id === "function") eq = (o.id() === me.id());
            } catch (e) {}
            if (eq) continue; }
          if (typeof o.isFriendly === "function" && o.isFriendly(me)) { rej.push({ id: u.id ? u.id() : "?", why: "friendly" }); continue; }
          if (typeof u.isUnderConstruction === "function" && u.isUnderConstruction()) { rej.push({ id: u.id ? u.id() : "?", why: "building" }); continue; }
          const lv = Math.max(1, (typeof u.level === "function" ? (u.level() || 1) : 1));
          const rng = samRangeAtLevel(lv);
          const ut = u.tile();
          const ux = g.x(ut), uy = g.y(ut);
          const dT = Math.sqrt((ux - tx) * (ux - tx) + (uy - ty) * (uy - ty));
          let dS = Infinity;
          for (let si = 0; si < silPos.length; si++) {
            const dd = Math.sqrt((ux - silPos[si].x) * (ux - silPos[si].x) + (uy - silPos[si].y) * (uy - silPos[si].y));
            if (dd < dS) dS = dd;
          }
          // 요격점은 목표 150 or 사일로 150 이내여야 하므로, (rng+150) 밖이면 불가
          const lim = rng + 150 + 60;
          if (dT > lim && dS > lim) { rej.push({ id: u.id ? u.id() : "?", why: "far", dT: Math.round(dT), dS: Math.round(dS), lim: Math.round(lim) }); continue; }
          cand.push({ lv, rng, x: ux, y: uy, dT, dS });
        } catch (e) {}
      }
      const out = [];
      if (!cand.length) return { n: 0, sumLevel: 0, maxRange: 150, defs: [], _diag: { total: list.length, rej, cand: 0, silN: silPos.length, tx, ty } };
      if (silPos.length) {
        // 궤적 기반 참여 판정 — 사일로별로 1회
        const dirUp = getRocketDirectionUp();
        const mapH = simMapH();
        const mask = new Uint8Array(cand.length);
        const sN2 = silPos.length > 40 ? 16 : (silPos.length > 20 ? 24 : 32);
        for (let pi = 0; pi < silPos.length; pi++) {
          const P = stPath(silPos[pi].x, silPos[pi].y, tx, ty, dirUp, sN2, mapH);
          const ivs = stEngage(P, cand, silPos[pi].x, silPos[pi].y, tx, ty, {});
          for (const kk in ivs) mask[kk | 0] = 1;
        }
        for (let i = 0; i < cand.length; i++) {
          if (!mask[i]) continue;
          const c = cand[i];
          out.push({ d: c.dT, lv: c.lv, rng: c.rng, x: c.x, y: c.y, via: c.dT <= c.rng ? "target" : "path" });
        }
      } else {
        // 사일로를 못 읽으면 보수적으로: 목표 기준 사거리 + 여유(150)
        for (let i = 0; i < cand.length; i++) {
          const c = cand[i];
          if (c.dT <= c.rng + 150) out.push({ d: c.dT, lv: c.lv, rng: c.rng, x: c.x, y: c.y, via: "target" });
        }
      }
      if (!out.length) return { n: 0, sumLevel: 0, maxRange: 150, defs: [] };
      let sumLevel = 0, maxRange = 0, nPath = 0;
      for (let k = 0; k < out.length; k++) {
        sumLevel += out[k].lv;
        if (out[k].rng > maxRange) maxRange = out[k].rng;
        if (out[k].via === "path") nPath++;
      }
      return { n: out.length, sumLevel, maxRange: maxRange > 0 ? maxRange : 150, defs: out, nPath };
    } catch (e) { return null; }
  }

  // 내 사일로(발사관) 목록 — [{dist, level, x, y}] · null = 읽기 불가
  function mySilos(tile) {
    try {
      const g = getGameView();
      if (!g || typeof g.units !== "function" || typeof g.x !== "function" || typeof g.y !== "function") return null;
      const me = typeof g.myPlayer === "function" ? g.myPlayer() : null;
      if (!me || typeof me.id !== "function") return null;
      const t = (tile === undefined || tile === null) ? computeCursorTile() : tile;
      if (t === null || t === undefined) return null;
      const tx = g.x(t), ty = g.y(t);
      if (!Number.isFinite(tx) || !Number.isFinite(ty)) return null;
      const list = g.units("Missile Silo") || [];
      const out = [];
      // 게임 내부는 smallID(숫자)로 소유자를 비교한다 — id()는 문자열(클라이언트 ID).
      let mySmall = null, myId = null;
      try { if (typeof me.smallID === "function") mySmall = me.smallID(); } catch (e) {}
      try { if (typeof me.id === "function") myId = me.id(); } catch (e) {}
      for (let i = 0; i < list.length; i++) {
        const u = list[i];
        try {
          const o = typeof u.owner === "function" ? u.owner() : null;
          if (!o) continue;
          let ok = false;
          let oSmall = null;
          try { if (typeof o.smallID === "function") oSmall = o.smallID(); } catch (e) {}
          if (oSmall !== null && oSmall !== 0 && mySmall !== null && oSmall === mySmall) ok = true;
          if (!ok && myId !== null) { try { if (typeof o.id === "function" && o.id() === myId) ok = true; } catch (e) {} }
          if (!ok) continue;
          if (typeof u.isUnderConstruction === "function" && u.isUnderConstruction()) continue;
          const ut = u.tile();
          const ux = g.x(ut), uy = g.y(ut);
          const dx = ux - tx, dy = uy - ty;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (!Number.isFinite(d)) continue;
          out.push({ dist: d, level: Math.max(1, (typeof u.level === "function" ? (u.level() || 1) : 1)), x: ux, y: uy });
        } catch (e) {}
      }
      return out;
    } catch (e) { return null; }
  }

  // ═════════════════════════════════════════════
  // v2.8 단순 모드 — 커서 지점 150타일 내 적 SAM 전부 수집
  //
  //   복잡한 경로/타이밍 시뮬 없이 '레벨 합'만 본다:
  //     발사량 = ceil(ΣLv × samSimpleMult)   (기본 1.2 = 20% 더)
  //   수소는 원자 살포 후 1발, 그 뒤 원자·수소 몇 발 더.
  //   ※ 사거리 밖·경로 밖 SAM도 포함한다(보수적 = 더 많이 쏨).
  // ═════════════════════════════════════════════
  function samsNear(tile, range) {
    try {
      const g = getGameView();
      if (!g || typeof g.units !== "function" || typeof g.x !== "function" || typeof g.y !== "function") return null;
      const me = typeof g.myPlayer === "function" ? g.myPlayer() : null;
      if (!me || typeof me.id !== "function") return null;
      const t = (tile === undefined || tile === null) ? computeCursorTile() : tile;
      if (t === null || t === undefined) return null;
      let tx, ty;
      try { tx = g.x(t); ty = g.y(t); } catch (e) { return null; }
      if (!Number.isFinite(tx) || !Number.isFinite(ty)) return null;
      const R = Number.isFinite(range) && range > 0 ? range : (CFG.samSimpleRange | 0) || 150;
      const R2 = R * R;
      const list = g.units("SAM Launcher") || [];
      const out = [];
      let sumLevel = 0, skipped = 0, mine = 0, building = 0;
      // ── 내 식별자 (게임 내부는 smallID(숫자)로 비교한다 — id()는 문자열) ──
      let mySmall = null, myId = null;
      try { if (typeof me.smallID === "function") mySmall = me.smallID(); } catch (e) {}
      try { if (typeof me.id === "function") myId = me.id(); } catch (e) {}
      for (let i = 0; i < list.length; i++) {
        const u = list[i];
        // ── 반경 안이면 '무조건' 카운트한다 (오탐 방지 최우선) ──
        //   제외는 단 두 가지뿐: ① 내 SAM ② 아군 SAM
        //   건설 중·소유자 판독 실패 등은 전부 '포함'(보수적 = 더 많이 쏨)
        let ux = null, uy = null, d = null;
        try {
          const ut = u.tile();
          ux = g.x(ut); uy = g.y(ut);
          if (Number.isFinite(ux) && Number.isFinite(uy)) {
            const dx = ux - tx, dy = uy - ty;
            d = Math.sqrt(dx * dx + dy * dy);
            if (d > R) continue;                        // 반경 밖만 제외
          } else { skipped++; }                          // 좌표 못 읽음 → 포함
        } catch (e) { skipped++; }                       // 타일 못 읽음 → 포함
        // ── 내 것/아군인가? ──
        //   주의: owner()는 ① 무주지(smallID 0)면 TerraNullius를 반환하고
        //         ② 못 찾으면 예외를 던진다. 둘 다 '적 취급'으로 포함해야 한다.
        let isMine = false;
        try {
          const o = typeof u.owner === "function" ? u.owner() : null;
          if (o) {
            // smallID 비교 (게임 내부와 동일 기준)
            let oSmall = null;
            try { if (typeof o.smallID === "function") oSmall = o.smallID(); } catch (e) {}
            if (oSmall !== null && oSmall !== 0 && mySmall !== null && oSmall === mySmall) isMine = true;
            // id() 비교 (문자열) — 둘 다 있을 때만
            if (!isMine && myId !== null) {
              try { if (typeof o.id === "function" && o.id() === myId) isMine = true; } catch (e) {}
            }
            // 아군 판정 — 단, 무주지(ZF)나 isPlayer()가 아닌 객체는 아군이 아니다
            if (!isMine && typeof o.isPlayer === "function") {
              try {
                const pl = o.isPlayer();
                if (pl && typeof o.isFriendly === "function" && o.isFriendly(me)) isMine = true;
              } catch (e) {}
            } else if (!isMine && typeof o.isFriendly === "function") {
              // isPlayer가 없으면 isFriendly만으로 판단 (기존 동작)
              try { if (o.isFriendly(me)) isMine = true; } catch (e) {}
            }
          }
        } catch (e) {}   // 판독 예외 → 포함(적 취급)
        if (isMine) { mine++; continue; }
        try { if (typeof u.isUnderConstruction === "function" && u.isUnderConstruction()) building++; } catch (e) {}
        const lv = Math.max(1, (typeof u.level === "function" ? (u.level() || 1) : 1));
        sumLevel += lv;
        out.push({ lv, x: ux, y: uy, d, rng: samRangeAtLevel(lv) });
      }
      return { n: out.length, sumLevel, defs: out, range: R, tx, ty, skipped, mine, building, total: list.length };
    } catch (e) { return null; }
  }

  // ── 단순 판정 (v2.8.1) ──
  //   ① 9초 내 발사: 사일로 체인(1발/틱=10발/초)으로 다 나가는가 + 관 부족으로 멈추지 않는가
  //   ② 수소 착탄: 원자가 적 SAM 슬롯(ΣLv)을 전부 채우면 수소는 막히지 않는다
  //   ※ 게임 물리: SAM슬롯 1개 = 미사일 1발 = 90틱(9초) 점유. 사일로도 관 1개당 9초 점유.
  function simpleVerdict(ana, shots, tile) {
    if (!ana || !(ana.sumLevel > 0) || !(shots > 0)) return null;
    // ── 내 사일로 (관 수·거리)
    let tubes = 0, siloN = 0, dMin = Infinity, dMax = 0;
    try {
      const silos = mySilos(tile);
      if (silos && silos.length) {
        siloN = silos.length;
        for (let i = 0; i < silos.length; i++) {
          tubes += Math.max(1, silos[i].level | 0);
          const d = silos[i].dist;
          if (Number.isFinite(d)) { if (d < dMin) dMin = d; if (d > dMax) dMax = d; }
        }
      }
    } catch (e) {}
    // ── 게임 발사 규칙: nukeSpawn 은 '가장 가까운 준비된 사일로'를 고른다.
    //   → 관이 충분하면 가까운 사일로 몇 기만 쓰고 먼 사일로는 안 쓴다.
    //   (사일로 목록을 거리순으로 보고, 필요한 만큼만 사용)
    let usedN = siloN, dUsedMin = dMin, dUsedMax = dMin;
    if (siloN > 0) {
      const ds = [];
      try {
        const silos = mySilos(tile) || [];
        for (let i = 0; i < silos.length; i++) {
          const d = silos[i].dist;
          if (Number.isFinite(d)) ds.push({ d, lv: Math.max(1, silos[i].level | 0) });
        }
      } catch (e) {}
      ds.sort((a, b) => a.d - b.d);
      if (ds.length) {
        dUsedMin = ds[0].d;
        // 가까운 사일로부터 관을 채워나가, 발수를 감당할 만큼만 사용
        let acc = 0, k = 0;
        while (k < ds.length && acc < shots) { acc += ds[k].lv; k++; }
        usedN = Math.max(1, k);
        dUsedMax = ds[usedN - 1].d;
      }
    }
    // ── ① 발사(런치) 시간 — 사용 사일로 체인: 1기당 최대 10발/초
    const rate = 10 * Math.max(1, usedN);
    const launchSec = siloN > 0 ? shots / rate : null;
    const tubeOk = siloN > 0 ? shots <= tubes : false;
    // ── ② 도착 분산 — '사용된' 사일로 거리차 ÷ 핵 속도(100타일/초)
    const flySpread = (Number.isFinite(dUsedMin) && dUsedMax > dUsedMin) ? (dUsedMax - dUsedMin) / 100 : 0;
    const flyNear = Number.isFinite(dUsedMin) ? dUsedMin / 100 : 0;
    // 전체 공격 창 = 발사 시간 + 도착 분산 (마지막 폭탄이 떨어지기까지)
    const arriveSpan = (launchSec || 0) + flySpread;
    const in9 = tubeOk && arriveSpan <= 9;
    // ── ③ 수소 착탄 — 게임 물리(단순 모델)
    //   · 적 SAM 총 슬롯 = ΣLv. 미사일 1발이 슬롯 1개를 90틱(9초) 점유한다.
    //   · 원자로 슬롯을 전부 채우면 그 순간 수소는 요격되지 않는다.
    //   · 단 그 '전부 점유' 상태는 9초만 유지된다 → 공격 창이 9초 안이어야 한다.
    const slots = ana.sumLevel;
    const enough = shots >= slots;          // 슬롯을 채울 만큼 원자가 있는가
    const h2Pass = enough && in9;           // 창 안에 다 들어가야 수소가 산다
    return { tubes, siloN, usedN, launchSec, tubeOk, arriveSpan, flySpread, flyNear, in9,
             slots, enough, h2Pass, shots, samSL: ana.sumLevel, samN: ana.n,
             dUsedMin: Number.isFinite(dUsedMin) ? dUsedMin : null,
             dUsedMax: Number.isFinite(dUsedMax) ? dUsedMax : null };
  }

  // 판정 문자열 (HUD·토스트 공용)
  function verdictText(v) {
    if (!v) return "";
    let t9;
    if (v.siloN === 0) t9 = "⏱ 사일로 없음 → 건설 필요";
    else if (!v.tubeOk) t9 = `⏱ 관 부족 ❌ (내관Σ${v.tubes} < ${v.shots.toLocaleString()}발 · 사일로 증설)`;
    else if (v.in9) t9 = `⏱ 9초 내 ✅ (${v.shots.toLocaleString()}발 · 약 ${v.arriveSpan.toFixed(1)}초 · 사일로 ${v.usedN}/${v.siloN}기)`;
    else t9 = `⏱ 9초 초과 ⚠️ (약 ${v.arriveSpan.toFixed(1)}초 — 사일로 기수↑ 또는 가까운 사일로)`;
    let h2;
    if (!v.enough) h2 = `💧 수소 위험 ⚠️ (원자 ${v.shots.toLocaleString()} < 적 슬롯 ${v.slots} · 원자 부족)`;
    else if (!v.in9) h2 = `💧 수소 위험 ⚠️ (슬롯은 채우나 창이 9초 초과)`;
    else h2 = `💧 수소 착탄 ✅ (원자 ${v.shots.toLocaleString()} ≥ 적 슬롯 ${v.slots})`;
    return t9 + "\n" + h2;
  }

  // 단순 모드 발사량: ΣLv × 1.2 (최소 1)
  function simpleShots(ana) {
    if (!ana || !(ana.sumLevel > 0)) return 0;
    const mult = Number.isFinite(CFG.samSimpleMult) && CFG.samSimpleMult > 0 ? CFG.samSimpleMult : 1.2;
    return Math.max(1, Math.ceil(ana.sumLevel * mult));
  }

  // ── 발사 스트림: 원자 (C+E)발 — 창 스케줄·관 회복·체인 정밀 모델 ──
  //   shiftAt = max(발사틱+90, 앞 발사 shiftAt+1) · dep = max(체인, 발사틱+1)
  //   반환 { arr(도착,정렬), arrSilo, arrL(발사ms), h, qs, drops, tMainMs }
  //   최적화: 사일로를 '거리순'으로 미리 정렬하고, 각 사일로의 체인·관 상태를
  //   O(1)로 유지한다(증분 갱신). 발사마다 전 사일로를 다시 훑지 않는다.
  function stStream(silos, C, E, hTick) {
    const st = silos.map((x, idx) => ({ idx, d: x.dist, lv: Math.max(1, x.level | 0), q: [], out: 0, lastLt: -1, lastDep: 0, free: Math.max(1, x.level | 0) }))
                     .sort((a, b) => a.d - b.d);          // 거리 오름차순 = 배정 우선순위
    const NS = st.length;
    const total = C + E, intents = Math.ceil(total / SIMC.PER);
    const rec = [];
    let h = null, hDone = (hTick === undefined || hTick === null || hTick < 0);
    let sent = 0, drops = 0, tMainMs = 0;

    // 회복 반영 (그 사일로만, O(회복 수))
    function refresh(s, t) {
      while (s.out < s.q.length && s.q[s.out].shiftAt <= t) {
        s.out++;
        s.free++;
      }
    }
    function fireAt(si, t) {
      const s = st[si];
      refresh(s, t);
      // 체인: 마지막 발사 이후 1틱 뒤 또는 t+1 중 늦은 것 (큐가 비면 lastDep 유지)
      let dep = s.lastDep + 1 > t + 1 ? s.lastDep + 1 : t + 1;
      s.lastDep = dep;
      s.lastLt = t;
      const prevShift = s.q.length ? s.q[s.q.length - 1].shiftAt : 0;
      s.q.push({ lt: t, shiftAt: Math.max(t + SIMC.CD_T, prevShift + 1) });
      s.free--;
      return { dep: dep, si: s.idx, L: t * SIMC.TICK };
    }
    // 빈 관이 있는 '가장 가까운' 사일로 — 거리순이라 앞에서 첫 히트
    function pickAndFire(t) {
      for (let i = 0; i < NS; i++) {
        const s = st[i];
        if (s.free > 0) return fireAt(i, t);
        if (s.q.length > s.out && s.q[s.out].shiftAt <= t) { refresh(s, t); if (s.free > 0) return fireAt(i, t); }
      }
      return null;
    }
    for (let j = 0; j < intents; j++) {
      const sendMs = Math.floor(j / 10) * SIMC.WIN + (j % 10) * 5;
      const t = Math.floor(sendMs / SIMC.TICK);
      if (!hDone && t >= hTick) {
        const r = pickAndFire(hTick);
        h = r ? { F: hTick * SIMC.TICK, dep: r.dep, si: r.si, L: r.L, fail: false } : { F: hTick * SIMC.TICK, fail: true };
        hDone = true;
      }
      const nB = Math.min(SIMC.PER, total - sent);
      if (sent < C && sent + nB >= C) tMainMs = sendMs;
      for (let b = 0; b < nB; b++) {
        const r = pickAndFire(t);
        if (!r) { drops++; continue; }
        rec.push(r);
      }
      sent += nB;
    }
    if (!hDone) {
      const r = pickAndFire(hTick);
      h = r ? { F: hTick * SIMC.TICK, dep: r.dep, si: r.si, L: r.L, fail: false } : { F: hTick * SIMC.TICK, fail: true };
    }
    rec.sort((a, b) => a.dep - b.dep || a.L - b.L);
    // qs: 원본 silos 인덱스 순으로 재배치 (호출부가 silos[i] / siloData[i]와 짝지어 쓴다)
    const qs = new Array(silos.length);
    for (let i = 0; i < NS; i++) qs[st[i].idx] = st[i].q;
    return {
      rec,
      arr: rec.map((r) => r.dep),
      arrSilo: rec.map((r) => r.si),
      arrL: rec.map((r) => r.L),
      h, qs, drops, tMainMs: tMainMs || 0,
    };
  }

  // dep(틱) → 도착 ms (경로 호장 기반 비행시간)
  function arrMs(depTick, flightMs) { return depTick * SIMC.TICK + flightMs; }

  // ── 틱 스윕: 격추 시뮬 ──
  //   bombs: [{a(도착ms), ivs(절대ms 격추가능구간들)}] — a 오름차순
  //   각 틱: 빈 슬롯이 있고 '격추 가능 구간 중'인 폭탄이 있으면 '가장 임박한(구간끝이 이른)' 것부터 격추.
  //   슬롯은 90틱(9s) 점유 후 1개씩 회복.
  //   반환 { runs(전 슬롯 점유·무회복 구간 = 사각창), maxBusy, kills }
  //   ivsFn(bomb) → 그 폭탄의 절대 격추구간 목록 (필요할 때 계산)
  function stDeadRuns(sams, bombs, ivsFn) {
    const SL = sams.sumLevel, n = bombs.length;
    if (!n || !(SL > 0)) return { runs: [], maxBusy: 0, kills: 0 };
    // 이벤트(진입/이탈) 정렬
    const ivsCache = new Array(n);
    for (let b = 0; b < n; b++) ivsCache[b] = ivsFn ? ivsFn(bombs[b]) : (bombs[b].ivs || null);
    const evs = [];
    for (let b = 0; b < n; b++) {
      const ivs = ivsCache[b];
      if (!ivs) continue;
      for (let k = 0; k < ivs.length; k++) {
        if (ivs[k].e <= ivs[k].s) continue;
        evs.push({ t: ivs[k].s, b, k, ty: 1 });
        evs.push({ t: ivs[k].e, b, k, ty: -1 });
      }
    }
    evs.sort((a, b) => a.t - b.t);
    const tEnd = bombs[n - 1].a + 9000 + 1000;
    const nT = Math.ceil(tEnd / SIMC.TICK) + 2;
    const dead = new Uint8Array(n);
    const curK = new Int32Array(n).fill(-1);
    const heap = [];                          // 최소 힙 {e, b, k}
    function hpush(e, b, k) {
      heap.push({ e, b, k });
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p].e <= heap[i].e) break;
        const tmp = heap[p]; heap[p] = heap[i]; heap[i] = tmp; i = p;
      }
    }
    function hpop() {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          if (l < heap.length && heap[l].e < heap[m].e) m = l;
          if (r < heap.length && heap[r].e < heap[m].e) m = r;
          if (m === i) break;
          const tmp = heap[m]; heap[m] = heap[i]; heap[i] = tmp; i = m;
        }
      }
      return top;
    }
    const ends = new Float64Array(n + 8);
    const runs = [];
    let busy = 0, eHead = 0, eTail = 0, pe = 0, inPool = 0, maxBusy = 0, kills = 0, cur = null;
    for (let i = 0; i <= nT; i++) {
      const t = i * SIMC.TICK;
      while (eHead < eTail && ends[eHead] <= t) { eHead++; busy--; }
      const freeBefore = SL - busy;
      while (pe < evs.length && evs[pe].t <= t) {
        const ev = evs[pe++];
        if (dead[ev.b]) continue;
        if (ev.ty === 1) {
          if (curK[ev.b] < 0) {
            curK[ev.b] = ev.k; inPool++;
            hpush(ivsCache[ev.b][ev.k].e, ev.b, ev.k);
          }
        } else {
          if (curK[ev.b] === ev.k) { curK[ev.b] = -1; inPool--; }
        }
      }
      let k = freeBefore < inPool ? freeBefore : inPool;
      if (k < 0) k = 0;
      while (k > 0) {
        let victim = -1;
        while (heap.length) {
          const top = hpop();
          const b = top.b;
          if (dead[b]) continue;
          if (curK[b] !== top.k) continue;
          if (ivsCache[b][top.k].e < t - SIMC.TICK) continue;
          victim = b; break;
        }
        if (victim < 0) break;
        dead[victim] = 1; inPool--; busy++; kills++; k--;
        ends[eTail++] = t + 9000;
      }
      if (busy > maxBusy) maxBusy = busy;
      if (freeBefore === 0) { if (!cur) cur = { s: t, e: t }; else cur.e = t; }
      else if (cur) { runs.push(cur); cur = null; }
    }
    if (cur) runs.push(cur);
    return { runs, maxBusy, kills };
  }

  // ── 계획 ──
  //   opt: { tx, ty, dirUp, cap, margin, bonus, bonusScan, bonusMin, bonusMax, maxBonusTry, mults }
  //   ① 필요 원자 C(가산 포함) ② 사각창 안에 '수소 격추구간 전체가 덮이는' 발사틱
  function stPlan(sams, silos, opt) {
    opt = opt || {};
    if (!sams || !sams.n || !sams.sumLevel || !silos || !silos.length) return { ok: false, why: "input" };
    const SL = sams.sumLevel;
    const tx = Number.isFinite(opt.tx) ? opt.tx : null;
    const ty = Number.isFinite(opt.ty) ? opt.ty : null;
    const dirUp = (opt.dirUp !== undefined) ? !!opt.dirUp : getRocketDirectionUp();
    const mapH = simMapH();
    const defs = (sams.defs && sams.defs.length) ? sams.defs : null;
    // ── 사일로별 경로 + 격추구간 (궤적 기반) ──
    //   경로는 '위치'만의 함수 → 좌표 키로 캐시 (같은 타깃 반복 호출 대비)
    const siloData = [];
    for (let i = 0; i < silos.length; i++) {
      const s = silos[i];
      const sx = Number.isFinite(s.x) ? s.x : (tx !== null ? tx + s.dist : null);
      const sy = Number.isFinite(s.y) ? s.y : (ty !== null ? ty : null);
      let P = null, uni = null, nPart = 0;
      if (sx !== null && tx !== null && defs) {
        // 사일로가 많을수록 샘플을 줄인다 (비용 ∝ 사일로수 × 샘플수)
        const sN = silos.length > 40 ? 16 : (silos.length > 20 ? 24 : 36);
        P = stPath(sx, sy, tx, ty, dirUp, sN, mapH);
        const ivs = stEngage(P, defs, sx, sy, tx, ty, {});
        const all = [];
        for (const kk in ivs) { nPart++; const L2 = ivs[kk]; for (let z = 0; z < L2.length; z++) all.push(L2[z]); }
        uni = stMergeIvs(all);
      }
      siloData.push({ sx, sy, P, uni, nPart });
    }
    const usePaths = !!(defs && tx !== null && siloData.length && siloData[0].P);
    // 폴백(경로 불가): 기존 직선 모델 — lead = 18.333×maxRange 단일 구간
    const leadFallback = Math.round(18.333 * (sams.maxRange || 150));
    const cap = Math.min(opt.cap || 20000, 20000);
    const m = (opt.margin === undefined) ? 150 : opt.margin;

    // 폭탄별 격추구간 — 배열을 매번 새로 만들지 않는다.
    //   · usePaths: 사일로별 uni(발사 기준 상대 ms)를 그대로 쓰고, 절대 시각은 소비측에서 더한다
    //     → bombs[]는 {a(도착ms), si(사일로), L(발사ms)}만 (수천 개라도 가볍다)
    //   · 폴백: 사일로별 직선 구간을 1회 만들어 재사용
    const fallbackIvs = {};
    function bombsOf(stream) {
      const rec = stream.rec, n2 = rec.length;
      const out = new Array(n2);
      for (let b = 0; b < n2; b++) {
        const r = rec[b];
        const sd = siloData[r.si];
        const fm = (sd && sd.P) ? sd.P.flightMs : ((silos[r.si] && silos[r.si].dist ? silos[r.si].dist : 300) * 10);
        out[b] = { a: r.dep * SIMC.TICK + fm, si: r.si, L: r.L };
      }
      out.sort((x, y) => x.a - y.a);
      return out;
    }
    // 폭탄의 절대 격추구간 목록 (소비측에서 필요할 때만 계산)
    function ivsOf(bomb) {
      const sd = siloData[bomb.si];
      if (usePaths && sd && sd.uni) {
        const out = new Array(sd.uni.length);
        for (let z = 0; z < sd.uni.length; z++) out[z] = { s: bomb.L + sd.uni[z].s, e: bomb.L + sd.uni[z].e };
        return out;
      }
      const key = bomb.si;
      if (!fallbackIvs[key]) fallbackIvs[key] = [{ s: -leadFallback, e: -SIMC.END_MS }];   // 도착 기준 상대
      const fb = fallbackIvs[key], out = new Array(fb.length);
      for (let z = 0; z < fb.length; z++) out[z] = { s: bomb.a + fb[z].s, e: bomb.a + fb[z].e };
      return out;
    }

    // 규모 적응 배수: 큰 타격일수록 1.0~1.6배면 충분 (4.5배까지 보면 계산이 수십 배로 는다)
    const mults = opt.mults || (SL >= 1500 ? [1.0, 1.4]
                              : SL >= 600 ? [1.0, 1.3, 1.6]
                              : [1.0, 1.15, 1.3, 1.5, 1.75, 2.0, 2.5, 3.0, 3.5, 4.5]);
    const budgetMs = (opt.budgetMs | 0) || 30;    // 탐색 시간 상한 (프레임 보호)
    const tStart = Date.now();
    const bonusReq = Math.max(0, opt.bonus | 0);
    const bonusList = [bonusReq];
    if (opt.bonusScan !== false) {
      const bLo = Math.max(1, opt.bonusMin | 0 || 5), bHi = Math.max(bLo, opt.bonusMax | 0 || 50);
      for (let b = bLo; b <= bHi; b += (bHi - bLo > 20 ? 7 : 3)) { if (b !== bonusReq) bonusList.push(b); }
      if (bonusList.length > 1) bonusList.push(bLo);
    }
    // 규모 적응: ΣLv가 크면 조합을 줄인다 (계산 시간이 조합 수에 비례).
    //   작은 규모는 촘촘히(정확), 큰 규모는 거칠게(빠르게) — HUD 반응성 우선.
    const scaleCap = SL >= 400 ? 1 : (SL >= 200 ? 2 : (SL >= 90 ? 3 : 99));
    const wantTry = Math.max(1, Math.min(bonusList.length, opt.maxBonusTry | 0 || bonusList.length));
    const bonusTrials = Math.min(wantTry, scaleCap);
    let anyRuns = false, maxRunLen = 0, bestRunAt = null, anyTubeFail = false, firstC = null;
    let lastMaxBusy = 0, lastKills = 0, lastFired = 0, lastDrops = 0, lastH2Gap = null;
    let overBudget = false;
    for (let bi = 0; bi < bonusTrials; bi++) {
      if (Date.now() - tStart > budgetMs) { overBudget = true; break; }
      // 규모가 크면 후보 배수를 줄인다 (비용 ∝ 후보수 × C)
      const useMults = (SL >= 200 && mults.length > 3)
        ? mults.filter((m, i) => i === 0 || i === Math.floor(mults.length / 2) || i === mults.length - 1)
        : mults;
      // C = 필요량 + 여유분,  여유분 = max(필요량의 reservePct%, 랜덤 발수)
      //   · 10%  : 날아가는 동안 적이 SAM을 증원할 가능성 대비 (큰 규모에서 지배)
      //   · 랜덤 : '딱 맞는 발수'는 자동화 티 → 발수에 무작위성 부여 (작은 규모에서 지배)
      const rp = Math.max(0, opt.reservePct === undefined ? (CFG.samReservePct | 0) : (opt.reservePct | 0));
      const Cs = [], seen = {}, resv = {};
      for (let i = 0; i < useMults.length; i++) {
        const need = Math.max(1, Math.ceil(sams.sumLevel * useMults[i]));
        const pctPart = Math.ceil(need * rp / 100);
        const reserve = Math.max(pctPart, bonusList[bi]);
        let v = need + reserve;
        if (v < 5) v = 5;
        if (v > cap) v = cap;
        if (!seen[v]) { seen[v] = 1; Cs.push(v); resv[v] = reserve; }
        if (v >= cap) break;
      }
      if (firstC === null) firstC = Cs[0];
      for (let ci = 0; ci < Cs.length; ci++) {
        if (Date.now() - tStart > budgetMs) { overBudget = true; break; }
        const C = Cs[ci];
        const reserveUse = (resv[C] !== undefined) ? resv[C] : bonusList[bi];
        const base = stStream(silos, C, 0, -1);
        const bombs = bombsOf(base);
        const D = stDeadRuns(sams, bombs, (bm) => ivsOf(bm));
        lastKills = D.kills; lastFired = bombs.length;
        if (base.drops > 0) lastDrops = base.drops;   // 관 부족 → 서버가 버릴 발수
        for (let ri = 0; ri < D.runs.length; ri++) {
          const ln = D.runs[ri].e - D.runs[ri].s;
          if (ln > maxRunLen) { maxRunLen = ln; bestRunAt = { C, run: D.runs[ri] }; }
        }
        if (D.maxBusy > lastMaxBusy) lastMaxBusy = D.maxBusy;
        if (!D.runs.length) continue;
        anyRuns = true;
        // 수소 창 탐색: 사각창 안에서 '수소 격추구간 전체가 덮이는' 발사틱
        const h2 = stFindH2(siloData, silos, base, usePaths, defs, leadFallback, D.runs, m);
        if (!h2) { anyTubeFail = true; if (stH2LastGap) lastH2Gap = stH2LastGap; continue; }
        return { ok: true, C, extra: 0, FT: h2.FT, F: h2.FT * SIMC.TICK, Dh: h2.arr,
                 runS: h2.run.s, runE: h2.run.e, score: h2.score, lead: leadFallback, SL,
                 atomReserve: reserveUse, atomNeed: C - reserveUse, reservePct: rp,
                 maxRunLen, hd: h2.dist, drops: base.drops, bonusUsed: reserveUse,
                 kills: D.kills, fired: bombs.length, passed: bombs.length - D.kills,
                 siloUsed: h2.si, h2Ivs: h2.ivs, usePaths };
      }
    }
    // 실패 사유: 관이 모자라 발사 자체가 안 되면 'tubes'가 가장 먼저다
    let why;
    if (overBudget && !anyRuns) why = "timeout";     // 예산 초과(정밀 재시도 필요)
    else if (lastDrops > 0) why = "tubes";
    else if (anyRuns && maxRunLen >= leadFallback + 2 * m) why = anyTubeFail ? "tubes" : "no-window";
    else if (!anyRuns) why = lastMaxBusy < SL ? "spread" : "no-gap";
    else why = "short-run";
    return { ok: false, why, SL, lead: leadFallback, maxRunLen, maxBusy: lastMaxBusy,
             needLen: leadFallback + 2 * m, bestRunAt, C: firstC || 5, kills: lastKills, fired: lastFired,
             drops: lastDrops, usePaths, nPath: sams.nPath || 0,
             h2Gap: lastH2Gap, defense: stDefenseSummary(sams, silos, siloData, usePaths) };
  }

  // 수소 발사 틱 탐색 — 각 사각창에 대해, H2의 '격추구간 전체'가 그 창에 덮이는 FT를 찾는다.
  //   (격추구간이 겹치면 → 어느 순간엔 빈 슬롯이 있어 격추됨 → 실패)
  function stFindH2(siloData, silos, base, usePaths, defs, leadFallback, runs, m) {
    if (!runs || !runs.length) return null;
    let maxFly = 0;
    for (let i = 0; i < siloData.length; i++) {
      const P = siloData[i].P;
      const fm = P ? P.flightMs : silos[i].dist * 10;
      if (fm > maxFly) maxFly = fm;
    }
    for (let ri = 0; ri < runs.length; ri++) {
      const run = runs[ri];
      if (run.e - run.s < 400) continue;
      // FT 범위: H2 도착이 사각창 안에 (도착 = dep*100+flightMs)
      const lo = Math.max(1, Math.floor((run.s - maxFly) / 100) - 1);
      const hi = Math.floor((run.e) / 100) + 1;
      const hi2 = Math.min(hi, lo + (silos.length > 24 ? 420 : 1200));   // 대규모는 스캔 폭 축소
      // 사일로별 관 회복 포인터 (FT 증가에 따라 전진)
      const qs = base.qs;
      const pIn = new Array(silos.length).fill(0), pOut = new Array(silos.length).fill(0);
      const lastLt = new Array(silos.length).fill(-1);
      for (let i = 0; i < silos.length; i++) {
        const q = qs[i];
        while (pIn[i] < q.length && q[pIn[i]].lt <= lo) { lastLt[i] = q[pIn[i]].lt; pIn[i]++; }
        while (pOut[i] < pIn[i] && q[pOut[i]].shiftAt <= lo) pOut[i]++;
      }
      // 사일로를 거리순으로 미리 정렬 → FT마다 '가장 가까운 빈 관'을 앞에서 찾는다.
      const order = []; for (let i = 0; i < silos.length; i++) order.push(i);
      order.sort((a, b) => silos[a].dist - silos[b].dist);
      // FT 스텝 3틱 (300ms) — 수소 창 정렬은 창 단위(1,150ms)라 이 오차는 무해
      const FT_STEP = (silos.length > 24 ? 3 : 1);
      for (let FT = lo; FT <= hi2; FT += FT_STEP) {
        let bestSi = -1, bestDist = Infinity, bestDep = 0;
        var lastGap = null;   // H2가 격추되는 지점(진단용)
        stH2LastGap = null;
        for (let oi = 0; oi < order.length; oi++) {
          const i = order[oi];
          const q = qs[i], lv = Math.max(1, silos[i].level | 0);
          while (pIn[i] < q.length && q[pIn[i]].lt <= FT) { lastLt[i] = q[pIn[i]].lt; pIn[i]++; }
          while (pOut[i] < pIn[i] && q[pOut[i]].shiftAt <= FT) pOut[i]++;
          if (pIn[i] - pOut[i] >= lv) continue;              // 빈 관 없음
          const dep = ((lastLt[i] + 1 > FT + 1) ? lastLt[i] + 1 : FT + 1);
          bestDist = silos[i].dist; bestSi = i; bestDep = dep;
          break;                                             // 거리순이므로 첫 히트가 최근접
        }
        if (bestSi < 0) continue;
        const sd = siloData[bestSi];
        const fm = (usePaths && sd.P) ? sd.P.flightMs : silos[bestSi].dist * 10;
        const arrT = bestDep * SIMC.TICK + fm;
        if (arrT < run.s || arrT > run.e) continue;
        // ── H2 생존 판정 ──
        //   H2도 SAM의 표적이다(최우선). 격추되려면 'H2의 교전 가능 구간' 중
        //   어느 순간에든 '빈 슬롯'이 있어야 한다(그 순간 발사된다).
        //   → H2의 교전구간 전체가 사각창(전 슬롯 점유·무회복) 안에 들어야 통과.
        let ok = true, ivsAbs = null, h2Gap = null;
        if (usePaths && sd.uni) {
          ivsAbs = [];
          for (let z = 0; z < sd.uni.length; z++) {
            const a = bestDep * SIMC.TICK + sd.uni[z].s, b = bestDep * SIMC.TICK + sd.uni[z].e;
            ivsAbs.push({ s: a, e: b });
            if (a < run.s - 60 || b > run.e + 60) {
              ok = false;
              if (!h2Gap) h2Gap = { s: Math.round(a), e: Math.round(b), why: a < run.s ? "창 이전" : "창 이후" };
              break;
            }
          }
        }
        if (!ok) { lastGap = h2Gap; continue; }
        const score = Math.min(arrT - run.s, run.e - arrT);
        stH2LastGap = null;
        return { FT, dep: bestDep, si: bestSi, arr: arrT, run, score, dist: bestDist, ivs: ivsAbs, gap: null };
      }
    }
    return null;
  }

  // 방어 요약 — 각 SAM의 '방어 가능량'(슬롯 + 비행 중 회복)과 도착 분포를 계산한다.
  //   · 슬롯(Σ레벨) = 동시 요격 가능 수 (버스트 흡수)
  //   · 회복 = 9초마다 1개 → 도착이 길게 늘어질수록 방어량이 커진다
  //   · 창 W초 동안의 격추 상한 = Σ레벨 + SAM수 × floor(W/9s)
  //   반환: { sumLevel, n, capW(창별 상한), defenseCap, arrSpan, verdict }
  function stDefenseSummary(sams, silos, siloData, usePaths) {
    try {
      if (!sams || !sams.n) return null;
      const SL = sams.sumLevel;
      // 도착 스팬 추정: 가장 먼 사일로의 비행시간 + 전송 시간(50발/초 × C)
      let maxFly = 0, minFly = Infinity;
      for (let i = 0; i < siloData.length; i++) {
        const P2 = siloData[i].P;
        const fm = P2 ? P2.flightMs : (silos[i] ? silos[i].dist * 10 : 0);
        if (fm > maxFly) maxFly = fm;
        if (fm < minFly) minFly = fm;
      }
      if (!Number.isFinite(minFly)) minFly = 0;
      // 각 SAM: 슬롯 합 + 9초당 회복 수
      const perSam = [];
      let recovery = 0;
      for (let i = 0; i < sams.defs.length; i++) {
        const d = sams.defs[i];
        perSam.push({ lv: d.lv, rng: d.rng, via: d.via,
                      slots: d.lv, recoveryPer9s: 1 });
        recovery += 1;
      }
      return { sumLevel: SL, n: sams.n, nPath: sams.nPath || 0,
               slots: SL, recoveryPer9s: recovery,
               maxFlyMs: maxFly, minFlyMs: minFly, perSam };
    } catch (e) { return null; }
  }

  // 창 W(초) 동안 방어 상한 = Σ레벨 + SAM수 × floor(W/9)
  function samKillCeiling(sams, Wsec) {
    if (!sams || !sams.n) return 0;
    return sams.sumLevel + sams.n * Math.floor(Wsec / 9);
  }

  // HUD/계획용: 타깃 요약 — 필요 원자·비용·사일로·가능성·경로 분석 결과
  function strikeSummary(tile, light) {
    try {
      const ana = samDefenders(tile);
      if (ana === null) return { k: "na" };
      if (ana.n === 0) {
        return { k: "no-sam" };
      }
      const silos = mySilos(tile);
      let tx = null, ty = null;
      try {
        const g = getGameView();
        const t2 = (tile === undefined || tile === null) ? computeCursorTile() : tile;
        if (g && t2 !== null && t2 !== undefined) { tx = g.x(t2); ty = g.y(t2); }
      } catch (e) {}
      const j0 = Math.max(0, CFG.samJitterMin | 0), j1 = Math.max(j0, CFG.samJitterMax | 0);
      const sum = { k: "plan", samN: ana.n, samSL: ana.sumLevel, maxRange: ana.maxRange,
                    nPath: ana.nPath || 0, jitterMin: j0, jitterMax: j1 };
      if (!silos || !silos.length) {
        return Object.assign(sum, { ok: false, why: "no-silo", C: Math.max(5, Math.ceil(ana.sumLevel * 1.25)) });
      }
      // 여유분 = max(필요량×pct%, 랜덤 발수) — 시뮬레이터가 need에 대해 다시 계산한다.
      //   (경량 HUD는 대표값, I 키는 무작위 — 어느 쪽이든 max 규칙은 stPlan이 적용)
      const bonus = j0 + Math.round(Math.random() * (j1 - j0));
      // 경량(HUD)은 후보 1개·짧은 예산 — 정밀(I 키)은 더 넓게 본다
      // 경량(HUD)도 배수를 3개 보고 예산 18ms — 표시값이 실제와 크게 어긋나지 않게.
      const p = stPlan(ana, silos, { cap: CFG.samCap || 20000, margin: 120, bonus, bonusScan: !light,
                                     bonusMin: j0, bonusMax: j1, maxBonusTry: light ? 1 : 6,
                                     mults: light ? [1.0, 1.25, 1.6] : undefined,
                                     budgetMs: light ? 18 : 80,
                                     tx, ty, dirUp: getRocketDirectionUp() });
      let C, plan = null;
      if (p && p.ok) { C = p.C; plan = p; }
      else { C = Math.max(5, Math.ceil(ana.sumLevel * 1.25 + bonus)); }
      let nd = null;
      if (!(p && p.ok) && !light) {
        try { nd = stSilosNeeded(ana, silos, { cap: Math.min(CFG.samCap || 20000, 8000), tx, ty }); } catch (e) {}
      }
      const c1 = atomCostPerBomb(), c5 = hydroCostPerBomb();
      let need = null, goldOk = null;
      if (c1 !== null && c5 !== null) {
        const fh = Math.max(0, CFG.samAfterHydroMax | 0);
        if (c1 === 0n && c5 === 0n) { need = 0n; goldOk = true; }
        else {
          need = toBig(c1) * BigInt(C) + toBig(c5) * BigInt(1 + fh);
          const gold = myGold();
          if (gold !== null) goldOk = gold >= need;
        }
      }
      let tubesOwned = 0, siloN = silos.length, maxSiloLv = 0;
      for (let i = 0; i < silos.length; i++) {
        tubesOwned += silos[i].level;
        if (silos[i].level > maxSiloLv) maxSiloLv = silos[i].level;
      }
      const ready = readyTubes();
      // 방어량(이 타격에 참여하는 SAM들의 총 격추능력) — 창 9초 기준
      const ceil9 = samKillCeiling(ana, 9);
      return Object.assign(sum, {
        ok: !!(p && p.ok), why: plan ? null : (p ? p.why : "sim"),
        C, plan, bonus,
        atomNeed: plan ? plan.atomNeed : null,       // 수소 사각창에 필요한 최소 원자수
        atomReserve: plan ? plan.atomReserve : null, // 여유분 (max(10%, 랜덤))
        reservePct: plan ? plan.reservePct : null,
        tubesOwned, siloN, ready, maxSiloLv,
        goldNeed: need, goldOk,
        need: nd,
        maxRunLen: plan ? plan.maxRunLen : (p ? p.maxRunLen : null),
        runNeedLen: p ? p.needLen : null,
        maxBusy: p ? p.maxBusy : null,
        kills: p ? p.kills : null, fired: p ? p.fired : null, passed: p ? p.passed : null,
        usePaths: p ? p.usePaths : null,
        // ── 방어/수소 판정 요약 ──
        ceil9,                            // 9초 창 격추 상한 (ΣLv + SAM수)
        h2Gap: p ? p.h2Gap : null,        // 첫 수소가 격추되는 지점(있으면 실패)
        h2Ok: !!(p && p.ok),              // 첫 수소 통과 여부 = 계획 성립 여부
        defense: p ? p.defense : null,
        goldFree: (c1 === 0n && c5 === 0n),
      });
    } catch (e) { return { k: "na" }; }
  }

  // 필요 사일로 추정 — '기수 늘리기(분산)'가 정답인 경우가 많다
  //   한 사일로에 관이 몰리면 같은 사일로 연속 발사가 1틱씩 밀려(체인) 발사가 늘어지고,
  //   도착이 흩어져 사각창이 안 생긴다. → 레벨을 낮추고 기수를 늘리는 방향을 먼저 시도.
  function stSilosNeeded(sams, silos, opt) {
    opt = opt || {};
    if (!silos || !silos.length) return { ok: false };
    const tStart = Date.now();
    const totalBudget = (opt.budgetMs | 0) || 45;      // 전체 예산 (수십 회 시뮬 방지)
    let minLv = Infinity;
    for (let i = 0; i < silos.length; i++) if (silos[i].level < minLv) minLv = silos[i].level;
    const lvCap = Math.max(5, Math.min(minLv === Infinity ? 50 : minLv, 50));
    const lightOpt = { cap: opt.cap || 8000, margin: 150, maxBonusTry: 1, mults: [1.25],
                       budgetMs: 12, tx: opt.tx, ty: opt.ty };
    // 사일로가 많으면 '기수 늘리기' 스캔을 축소 (곱셈 폭발 방지)
    const spreadMults = silos.length > 24 ? [2] : [2, 4];
    for (let sm = 0; sm < spreadMults.length; sm++) {
      if (Date.now() - tStart > totalBudget) return { ok: false, timeout: true };
      const mult = spreadMults[sm];
      const s2 = [];
      let tubes = 0;
      for (let i = 0; i < silos.length; i++) {
        const lv = Math.min(999, Math.max(5, Math.min(silos[i].level, lvCap)));
        for (let r = 0; r < mult; r++) { s2.push({ dist: silos[i].dist, level: lv, x: silos[i].x, y: silos[i].y }); tubes += lv; }
      }
      const p = stPlan(sams, s2, lightOpt, tStart);
      if (p && p.ok) return { ok: true, mode: "spread", mult, siloN: s2.length, lvEach: lvCap, tubes, C: p.C };
    }
    const ladder = opt.ladder || [1.5, 2];
    for (let i = 0; i < ladder.length; i++) {
      if (Date.now() - tStart > totalBudget) return { ok: false, timeout: true };
      const s2 = [];
      let tubes = 0;
      for (let j = 0; j < silos.length; j++) {
        const lv = Math.min(999, Math.ceil(silos[j].level * ladder[i]));
        s2.push({ dist: silos[j].dist, level: lv, x: silos[j].x, y: silos[j].y });
        tubes += lv;
      }
      const p = stPlan(sams, s2, lightOpt, tStart);
      if (p && p.ok) return { ok: true, mode: "level", lvMult: ladder[i], siloN: s2.length, tubes, C: p.C };
    }
    return { ok: false };
  }

  // Z 1회 = CFG.salvoAmount(기본 1,000발)을 대기열에 추가.
  // 이미 돌고 있으면 '이어서' 추가되며, 건과 건 사이에 빈틈이 없다.
  function startSalvo(opts) {
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

    // ── SAM 인식: 적 SAM이 목표를 지키면 '수소타격 계획'으로 전환 ──
    //   ① 필요 원자 C + 랜덤 5~50발 = 총량 → '그 총량으로' 시뮬(수소 타이밍 유지)
    //   ② 사각창 도착 수소 1발  ③ 그후 원자 수십발 + 수소 몇발(랜덤 간격) 산개
    // v2.8: Z 살포는 '순수 원자 최대속도' — SAM 인식·수소 혼합을 하지 않는다.
    //   (수소가 섞이면 서버 창·발사관을 나눠 써서 살포 속도가 떨어진다)
    const forceStrike = !!(opts && opts.forceSam) && !CFG.samZPure;   // samZPure=true면 Z는 항상 순수
    let plan0 = null, total = 0;
    if (forceStrike || (CFG.salvoSamAware && !CFG.samZPure)) {
      const ana = samDefenders(tile);
      if (ana && ana.n > 0) {
        const silos = mySilos(tile);
        if (silos && silos.length) {
          // ① 랜덤 가산 — '딱 맞는 발수'는 티가 나므로 5~50발을 얹는다.
          const j0 = Math.max(0, CFG.samJitterMin | 0), j1 = Math.max(j0, CFG.samJitterMax | 0);
          const bonus = j0 + Math.round(Math.random() * (j1 - j0));
          let tx2 = null, ty2 = null;
          try { const g2 = getGameView(); if (g2 && typeof g2.x === "function") { tx2 = g2.x(tile); ty2 = g2.y(tile); } } catch (e) {}
          const rp0 = Math.max(0, CFG.samReservePct | 0);
          const p = stPlan(ana, silos, { cap: CFG.samCap || 20000, margin: 120, bonus: bonus,
                                          bonusMin: j0, bonusMax: j1, reservePct: rp0, tx: tx2, ty: ty2,
                                          dirUp: getRocketDirectionUp() });
          // 폴백(시뮬 실패): 필요량 + max(10%, 랜덤)
          const needF = Math.ceil(ana.sumLevel * 1.25);
          const C = (p && p.ok) ? p.C : Math.max(5, needF + Math.max(Math.ceil(needF * rp0 / 100), bonus));
          const fT = (p && p.ok) ? Math.max(1, p.FT) : Math.ceil((Math.ceil(C / 50) / 10) * 11.5) + 8;
          // ③ 후속 산개량 (이번에 뽑아 고정 — 예약 시 사용)
          const a0 = Math.max(0, CFG.samAfterMin | 0), a1 = Math.max(a0, CFG.samAfterMax | 0);
          const h0 = Math.max(0, CFG.samAfterHydroMin | 0), h1 = Math.max(h0, CFG.samAfterHydroMax | 0);
          const afterAtoms = a0 + Math.round(Math.random() * (a1 - a0));
          const afterHydros = h0 + Math.round(Math.random() * (h1 - h0));
          const g0 = Math.max(120, CFG.samAfterGapMinMs | 0), g1 = Math.max(g0, CFG.samAfterGapMaxMs | 0);
          const gapMs = g0 + Math.round(Math.random() * (g1 - g0));
          plan0 = {
            ok: !!(p && p.ok), why: (p && p.ok) ? null : (p ? p.why : "sim"),
            C: C, bonus: bonus, fireTick: fT,
            atomNeed: (p && p.ok) ? p.atomNeed : null,
            atomReserve: (p && p.ok) ? p.atomReserve : null,
            reservePct: (p && p.ok) ? p.reservePct : null,
            Dh: (p && p.ok) ? p.Dh : null, sumLevel: ana.sumLevel, n: ana.n,
            drops: (p && p.ok) ? p.drops : null, maxRunLen: p ? p.maxRunLen : null,
            kills: p ? p.kills : null, fired: p ? p.fired : null, passed: p ? p.passed : null,
            usePaths: p ? p.usePaths : null, nPath: ana.nPath || 0,
            afterAtoms: afterAtoms, afterHydros: afterHydros, afterGapMs: gapMs,
          };
          total = C;
        }
      }
    }
    if (plan0 === null) {
      total = Math.max(per, Math.min(Math.ceil((CFG.salvoAmount || per) / per) * per, cap));
    } else {
      total = Math.max(per, Math.min(total, cap));
      plan0 = Object.assign({}, plan0, { totalAtoms: total });
      lastStrike = plan0;
    }
    const intents = Math.ceil(total / per);

    // hydroEvery: 원자 N발마다 수소 섞기 — Z 살포(samZPure)는 0(순수 원자)
    const hEvery = CFG.samZPure ? 0 : Math.max(0, CFG.samHydroEvery | 0);
    salvoQueue.push({ tile, total, sent: 0, bus, ctor,
                      hydroEvery: hEvery, hydroSent: 0, hydroJit: 0,
                      hydroMax: hEvery > 0 ? Math.max(1, Math.floor(total / hEvery) - 1) : 0 });

    // 수소타격이면: 수소 1발 + 후속 산개를 '예약'한다.
    //   수소 발사 시각은 '첫 원자 배치가 나간 시점'부터 세는 상대 틱이다
    //   → 발사창 정리 대기(waitMs)로 시작이 밀려도 사각창 정렬이 유지된다.
    //   후속 산개는 수소가 나간 뒤 시작된다 (수소 발사 성공 시 트리거).
    //   이미 예약된 게 있으면 덮어쓰지 않는다 (연타 시 첫 계획 유지).
    if (plan0 && (CFG.samHydroCount | 0) > 0 && (salvoHydro === null || salvoHydro.fired)) {
      salvoHydro = { tile: tile, fireTick: Math.max(0, plan0.fireTick | 0), fireAt: null,
                     bus: bus, ctor: ctor, fired: false, armed: false, armedAt: null };
      // 진행 중인 후속 산개가 있으면 덮어쓰지 않는다 (타이머 유실 방지)
      if (salvoFollow === null) {
        salvoFollow = { tile: tile, bus: bus, ctor: ctor,
                        atomsLeft: Math.max(0, plan0.afterAtoms | 0),
                        hydrosLeft: Math.max(0, plan0.afterHydros | 0),
                        atoms0: Math.max(0, plan0.afterAtoms | 0),
                        hydros0: Math.max(0, plan0.afterHydros | 0),
                        started: false, timer: null };
      }
      const how = plan0.ok ? "사각창 역산" : "근사(사각창 미확보)";
      const waste = (plan0.drops | 0) > 0 ? ` · 관부족 낭비 ${plan0.drops}발` : "";
      const killTxt = (plan0.fired !== null && plan0.fired !== undefined)
        ? ` · 격추예상 ${plan0.kills}/${plan0.fired}발(통과 ${plan0.passed})` : "";
      const pathTxt = plan0.nPath > 0 ? ` · 경로상 SAM ${plan0.nPath}기 포함` : "";
      const aft = (plan0.afterAtoms | 0) + (plan0.afterHydros | 0) > 0
        ? ` → 수소 1발 → 원자 ${plan0.afterAtoms}·수소 ${plan0.afterHydros}발 산개` : "";
      const _n = plan0.atomNeed, _r = plan0.atomReserve, _p = plan0.reservePct;
      const needTxt = (_n !== null && _n !== undefined && _r !== null && _r !== undefined)
        ? `(필요 ${_n.toLocaleString()}+여유 ${_r}${(_p && _r === Math.ceil(_n * _p / 100)) ? `=${_p}%` : ""})`
        : `(필요+여유 ${plan0.bonus})`;
      toast(`🎯 수소타격 — 원자 ${plan0.C.toLocaleString()}발${needTxt}${aft} (${how}${waste}${killTxt}${pathTxt})`, "#7ee787");
    }

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

  // 새 키(I): 한큐 수소타격 — 목표를 커버하는 적 SAM을 전량 분석해
  //   필요 원자 C를 계산하고, C 전량 → 사각창 수소 1발 → 추가 3~5%를 한 번에 건다.
  //   (SAM이 없으면 일반 살포와 동일하게 동작하고 안내 토스트만 띄운다)
  // 새 키(I) — 수소타격 한큐.
  //   발동 조건: '첫 수소가 실제로 들어갈 수 있다'고 계산될 때만 발동한다.
  //   (궤적·발사시각·SAM 충전·방어량을 모두 시뮬해 첫 수소 통과가 확인된 경우)
  //   불가하면 사유를 알려주고 발동하지 않는다 — 격추될 수소를 낭비하지 않는다.
  let lastStrikeCheck = null;
  // ═════════════════════════════════════════════
  // I 키 — 수소타격 (v2.8 단순 규칙)
  //
  //   ① 커서 150타일 내 적 SAM 전부 수집 → ΣLv
  //   ② 발사량 = ΣLv × 1.2 (20% 더)  ← 원자 살포
  //   ③ 그 뒤 수소 1발
  //   ④ 후속: 원자 몇 발 + 수소 몇 발
  //
  //   SAM이 없으면 수소 1발만. 발사관·골드 가드만 확인한다.
  // ═════════════════════════════════════════════
  function startStrike() {
    let tile = null, ana = null;
    try {
      tile = computeCursorTile();
      if (tile === null) { toast("❌ 타깃 위에 커서를 올린 뒤 누르세요", "#ffaa00"); return; }
      // 지형 제한 없음 — 게임 nukeSpawn 은 산(isImpassable)만 막는다. 바다도 발사 가능.
      ana = CFG.samSimpleMode ? samsNear(tile) : samDefenders(tile);
    } catch (e) {
      toast("⚠️ SAM 정보를 읽을 수 없음 — 확인 실패", "#ffaa00");
      return;
    }
    if (ana === null) { toast("⚠️ SAM 정보를 읽을 수 없음 — 잠시 후 재시도", "#ffaa00"); return; }

    const bus0 = getEventBus(), ctor0 = findNukeEventCtor();
    if (!bus0 || !ctor0) { toast("❌ 경로 없음 — 게임 시작 후 다시 시도", "#ff5555"); return; }

    // 발사관 가드 (준비된 관이 0이면 서버가 전부 버린다)
    let ready0 = null;
    try {
      const g0 = getGameView();
      const me0 = g0 && typeof g0.myPlayer === "function" ? g0.myPlayer() : null;
      if (me0 && typeof me0.readyMissileCount === "function") ready0 = me0.readyMissileCount();
    } catch (e) {}
    if (ready0 === 0) { toast("❌ 준비된 발사관 없음 (사일로 쿨다운 해제 후 재시도)", "#ffaa00"); return; }

    // ── SAM 없음 → 수소 1발만
    if (!(ana.n > 0) || !(ana.sumLevel > 0)) {
      if ((CFG.samHydroCount | 0) <= 0) { toast("ℹ️ 커버하는 적 SAM 없음 — 수소 미사용 설정", "#ffd166"); return; }
      try {
        bus0.emit(new ctor0("Hydrogen Bomb", tile, getRocketDirectionUp(), undefined));
        rateUse();
        toast("💧 방어 SAM 없음 — 수소 1발 발사", "#7ee787");
      } catch (e) {
        console.warn("[x50] 수소 emit 실패:", e);
        toast("❌ 수소 발사 실패 (콘솔 확인)", "#ff5555");
      }
      return;
    }

    // ── 발사량 = ΣLv × mult (기본 1.2)
    const shots = simpleShots(ana);
    const afterA = Math.max(0, (CFG.samAfterMin | 0) + Math.round(Math.random() * Math.max(0, (CFG.samAfterMax | 0) - (CFG.samAfterMin | 0))));
    const afterH = Math.max(0, (CFG.samAfterHydroMin | 0) + Math.round(Math.random() * Math.max(0, (CFG.samAfterHydroMax | 0) - (CFG.samAfterHydroMin | 0))));
    const gap0 = Math.max(120, CFG.samAfterGapMinMs | 0), gap1 = Math.max(gap0, CFG.samAfterGapMaxMs | 0);
    const gapMs = gap0 + Math.round(Math.random() * (gap1 - gap0));
    const cap = Math.min(CFG.samCap || 20000, 100000);
    const total = Math.max(1, Math.min(shots, cap));

    // 원자 살포 등록 (기존 대기열 사용 — 창·관·골드 가드 그대로)
    if (salvoQueue.length >= (CFG.salvoQueueMaxItems || 50)) {
      toast(`⚠️ 대기열 가득 (${salvoQueue.length}건) — 조금 기다린 뒤 다시 누르세요`, "#ffaa00");
      return;
    }
    const hEvery2 = Math.max(0, CFG.samHydroEvery | 0);
    // 끝자락 제외: floor(total/간격) - 1 (잔여가 간격의 절반 이상일 때만 유효)
    const hMax2 = hEvery2 > 0 ? Math.max(1, Math.floor(total / hEvery2) - 1) : (CFG.samHydroCount | 0);
    salvoQueue.push({ tile, total, sent: 0, bus: bus0, ctor: ctor0,
                      hydroEvery: hEvery2, hydroSent: 0, hydroJit: 0, hydroMax: hMax2 });
    lastStrike = { mode: "simple", sumLevel: ana.sumLevel, n: ana.n, shots: total,
                   mult: CFG.samSimpleMult, tile, hydroEvery: hEvery2, hydroMax: hMax2 };

    // 후속 산개 예약 (수소는 이제 살포 중간에 섞이므로 마지막 별도 예약 없음 — v2.9)
    if (salvoFollow === null && (afterA + afterH) > 0) {
      salvoFollow = { tile: tile, bus: bus0, ctor: ctor0,
                      atomsLeft: afterA, hydrosLeft: afterH,
                      atoms0: afterA, hydros0: afterH,
                      started: false, timer: null, gapMs: gapMs };
    }

    const v0 = simpleVerdict(ana, total, tile);
    const hEvT = Math.max(0, CFG.samHydroEvery | 0);
    const hCntT = hEvT > 0 ? Math.ceil(total / hEvT) : 1;
    toast(`🎯 수소타격 — SAM ${ana.n}기 ΣLv${ana.sumLevel} → 원자 ${total.toLocaleString()}발 + 💧${hCntT}발(200발마다) → 후속 ☢${afterA} 💧${afterH}`
        + (v0 ? `  [${v0.in9 ? "9초내 OK" : "9초초과"}] [${v0.h2Pass ? "수소착탄 OK" : "수소위험"}]` : ""), "#7ee787");
    if (v0 && !v0.h2Pass) {
      const msg = v0.enough ? "슬롯은 채우나 창이 9초 초과 — 사일로 기수 늘리기" : `원자 부족 (${total} < 적슬롯 ${v0.slots}) — 재시도 권장`;
      toast(`⚠️ ${msg}`, "#ffaa00");
    }

    // 발사 시작 (대기열 펌프 — 창 회전 게이트·버스트 상한·골드/관 가드 전부 적용)
    if (salvoTimer === null) {
      try { salvoPump(); } catch (e) { console.warn("[x50] 살포 시작 실패:", e); }
    }
  }

  // 수소 발사 예약 — 계획된 틱(fireTick×100ms)에 맞춰 발사한다.
  //   · 기준점(armedAt) = 첫 원자 배치가 나간 시각 (시뮬의 t=0과 동일)
  //   · 발사 시점에 빈 발사관이 없으면 300ms 간격으로 최대 8회(~2.4초) 재시도
  //     (시뮬레이터가 '빈 관이 있는 틱'을 골라줬으므로 보통 즉시 발사된다)
  function armHydroTimer() {
    if (salvoHydroTimer !== null) { clearTimeout(salvoHydroTimer); salvoHydroTimer = null; }
    if (!salvoHydro || salvoHydro.fired) return;
    if (salvoHydro.fireAt === null) {
      const base = salvoHydro.armedAt || Date.now();
      salvoHydro.fireTick = Math.max(0, salvoHydro.fireTick | 0);
      salvoHydro.fireAt = base + salvoHydro.fireTick * 100;
      salvoHydro.armed = true;
    }
    let tries = 0;
    const tick = () => {
      salvoHydroTimer = null;
      if (!salvoHydro || salvoHydro.fired) return;
      // ── 단순 모드: 원자 살포(대기열)가 '전부' 나간 뒤 수소를 쏜다 ──
      //   (원자로 SAM 슬롯을 소진시킨 다음 수소가 들어가야 막히지 않는다)
      if (salvoHydro.afterQueue) {
        if (salvoQueue.length > 0 || salvoTimer !== null) {
          salvoHydroTimer = setTimeout(tick, 120);
          return;
        }
      }
      const now = Date.now();
      if (now < salvoHydro.fireAt) {
        salvoHydroTimer = setTimeout(tick, Math.max(30, Math.min(500, salvoHydro.fireAt - now)));
        return;
      }
      // 서버 초당 창에 여유가 없으면 잠깐 기다린다 (드롭 방지 — 수소는 1건)
      try {
        const now2 = Date.now();
        RL.secWindow = RL.secWindow.filter((x) => now2 - x < 1000);
        if (RL.secWindow.length >= RL.perSecond) {
          tries++;
          if (tries <= 60) { salvoHydroTimer = setTimeout(tick, 120); return; }
          toast("💧 수소 발사 취소 — 서버 창 포화", "#ffaa00");
          salvoHydro = null;
          salvoFollow = null;
          const done1 = salvoQueue.length === 0 && salvoTimer === null;
          if (done1) salvoClear(null);
          return;
        }
      } catch (e) {}
      const ready = readyTubes();
      if (ready === 0) {
        tries++;
        if (tries <= 60) { salvoHydroTimer = setTimeout(tick, 300); return; }
        toast("💧 수소 발사 취소 — 발사관 없음", "#ffaa00");
        salvoHydro = null;
        salvoFollow = null;
        const done0 = salvoQueue.length === 0 && salvoTimer === null;
        if (done0) salvoClear(null);
        return;
      }
      try {
        salvoHydro.bus.emit(new salvoHydro.ctor("Hydrogen Bomb", salvoHydro.tile, getRocketDirectionUp(), undefined));
        rateUse();
        salvoHydro.fired = true;
        salvoHydroDone++;
        const done = salvoQueue.length === 0 && salvoTimer === null;
        if (!done) toast("💧 수소 1발 발사 — 계획 사각창 도착", "#7ee787");
        salvoHydro = null;
        // 수소가 나갔다 → 후속 산개(원자 수십발·수소 몇발) 시작
        try { armFollow(); } catch (e) {}
        if (done && !salvoFollow) { salvoClear(null); return; }
      } catch (e) {
        console.warn("[x50] 수소 emit 실패:", e);
        toast("❌ 수소 발사 실패 (콘솔 확인)", "#ff5555");
        salvoHydro = null;
      }
    };
    const now = Date.now();
    salvoHydroTimer = setTimeout(tick, Math.max(0, Math.min(500, (salvoHydro.fireAt - now))));
  }

    // ── 후속 산개 (v2.6) ──
  // 수소가 사각창에 꽂힌 뒤, 원자 수십발과 수소 몇발을 '랜덤 간격'으로 더 뿌린다.
  //   목적: 딱 계산된 발수·순서로 끝나면 자동화 티가 난다 → 발수·순서·간격에
  //   무작위성을 주어 사람이 두드린 것처럼 보이게 한다.
  //   · 각 발은 서버 창(초당 10건·분당 150건) 여유를 확인하고 보낸다 (드롭 0)
  //   · 원자/수소 순서는 매 스텝 확률적으로 고른다 (완전 고정 순서 회피)
  //   · 마지막 발까지 끝나면 완료 토스트
  function salvoFollowTick() {
    if (salvoFollow) salvoFollow.timer = null;
    const F = salvoFollow;
    if (!F) return;
    // 서버 창에 여유가 없으면 잠깐 쉰다
    try {
      const now = Date.now();
      RL.secWindow = RL.secWindow.filter((x) => now - x < 1000);
      if (RL.secWindow.length >= RL.perSecond - 1) {
        F.timer = setTimeout(salvoFollowTick, 160 + Math.round(Math.random() * 240));
        return;
      }
    } catch (e) {}
    const totalLeft = F.atomsLeft + F.hydrosLeft;
    if (totalLeft <= 0) {
      const done = salvoQueue.length === 0 && salvoTimer === null && salvoHydro === null;
      salvoFollow = null;
      if (done) salvoClear(null);
      return;
    }
    // 골드 가드 — 원자 1발 값도 없으면 이후는 서버가 전부 버린다 (낭비 방지)
    try {
      const c1 = atomCostPerBomb();
      if (c1 && c1 > 0n) {
        const gold = myGold();
        if (gold !== null && gold < c1) { salvoClear("💰 골드 소진"); return; }
      }
    } catch (e) {}
    // 이번 스텝: 원자(50발 단위, 남은 양 이하) 또는 수소 1발을 확률적으로 선택
    const pAtom = F.hydrosLeft <= 0 ? 1 : (F.atomsLeft <= 0 ? 0 : 0.72);
    const pickAtom = Math.random() < pAtom;
    try {
      if (pickAtom) {
        const amt = Math.min(SALVO_MAX_PER_INTENT, Math.max(1, F.atomsLeft));
        F.bus.emit(new F.ctor("Atom Bomb", F.tile, getRocketDirectionUp(), amt));
        rateUse();
        F.atomsLeft -= amt;
        salvoDone += amt;
      } else {
        const ready = readyTubes();
        if (ready === 0) { F.timer = setTimeout(salvoFollowTick, 300); return; }
        F.bus.emit(new F.ctor("Hydrogen Bomb", F.tile, getRocketDirectionUp(), undefined));
        rateUse();
        F.hydrosLeft--;
        salvoHydroDone++;
      }
    } catch (e) {
      console.warn("[x50] 후속 산개 emit 실패:", e);
      salvoFollow = null;
      return;
    }
    const g0 = Math.max(120, CFG.samAfterGapMinMs | 0), g1 = Math.max(g0, CFG.samAfterGapMaxMs | 0);
    const gap = g0 + Math.round(Math.random() * (g1 - g0));
    F.timer = setTimeout(salvoFollowTick, gap);
  }

  // 수소가 나간 직후 호출 — 후속 산개 시작
  function armFollow() {
    if (!salvoFollow || salvoFollow.started) return;
    if (salvoFollow.atomsLeft + salvoFollow.hydrosLeft <= 0) { salvoFollow = null; return; }
    salvoFollow.started = true;
    const g0 = Math.max(120, CFG.samAfterGapMinMs | 0), g1 = Math.max(g0, CFG.samAfterGapMaxMs | 0);
    const first = g0 + Math.round(Math.random() * (g1 - g0));
    salvoFollow.timer = setTimeout(salvoFollowTick, first);
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
      // 마지막 인텐트는 남은 양만큼만 보낸다 (50발 단위 강제 없음 → 총량 정확)
      const amtSent = Math.min(per, item.total - item.sent);
      if (amtSent <= 0) { salvoQueue.shift(); salvoItemsDone++; continue; }
      try {
        item.bus.emit(new item.ctor("Atom Bomb", item.tile, getRocketDirectionUp(), amtSent));
        rateUse();                  // 수동 발사와 같은 카운터 공유 (서로 간섭 방지)
      } catch (e) {
        console.warn("[x50] 대량 발사 emit 실패:", e);
        salvoClear("❌ 대량 발사 중단 (emit 실패 — 콘솔 확인)");
        return;
      }
      item.sent += amtSent;
      salvoDone += amtSent;
      n++;
      // ── v2.9: 원자 N발마다 수소 1발 섞기 ──
      //   마지막에 몰아 쏘면 서버 창 포화로 드롭되므로 살포 중간에 끼워 넣는다.
      //   · 임계값은 '절대 위치' = (보낸 수소+1) × 간격  → 누적 드리프트 없음, 간격 균일
      //   · 끝자락(잔여 < 간격/2)에는 넣지 않는다 → 마지막에 몰려 짤리는 현상 방지
      //   · 창이 꽉 찼으면 건너뛰지 않고 다음 원자 인텐트에서 재시도 (누락 방지)
      if (item.hydroEvery > 0 && item.hydroSent < item.hydroMax) {
        // 임계값을 '원자 인텐트 경계(50발)'에 맞춘다 → 간격이 균일해진다.
        //   예: 200발마다면 인텐트 4건(=200발)마다 정확히 1발. 지터는 ±소폭.
        const jit = Math.max(0, CFG.samHydroEveryJitter | 0);
        const per50 = 50;
        const base = Math.round(((item.hydroSent + 1) * item.hydroEvery) / per50) * per50;
        const target = base + item.hydroJit;
        const remain = item.total - item.sent;
        if (item.sent >= target && remain >= item.hydroEvery / 2) {
          let room = true;
          try {
            const nw = Date.now();
            RL.secWindow = RL.secWindow.filter((x) => nw - x < 1000);
            if (RL.secWindow.length >= RL.perSecond) room = false;
          } catch (e) {}
          if (room) {
            try {
              item.bus.emit(new item.ctor("Hydrogen Bomb", item.tile, getRocketDirectionUp(), undefined));
              rateUse();
              item.hydroSent++;
              salvoHydroDone++;
              n++;
              // 다음 수소용 지터를 새로 뽑는다 (누적 아님 — 매번 독립)
              //   인텐트 경계와 어긋나지 않게 50 배수로 스냅
              item.hydroJit = jit > 0 ? Math.round(((Math.random() * 2 - 1) * jit) / 50) * 50 : 0;
            } catch (e) {
              console.warn("[x50] 수소 섞기 실패:", e);
            }
          }
          // room === false → 임계값 유지, 다음 인텐트에서 재시도
        }
      }
      // 첫 원자 인텐트가 나간 순간 = 시뮬레이터의 t=0 → 수소 발사 시각의 기준점.
      // (armedAt이 이미 있으면 건드리지 않는다 — 연타/재개 시 첫 기준 유지)
      if (salvoHydro && !salvoHydro.armed && salvoHydro.armedAt === null) {
        salvoHydro.armedAt = Date.now();
        try { armHydroTimer(); } catch (e) {}
      }
      if (item.sent >= item.total) {   // 이 건 완료 → 같은 창에서 다음 건으로 '즉시' 이어감
        salvoQueue.shift();
        salvoItemsDone++;
      }
    }

    if (salvoQueue.length === 0) {
      // (v2.9) 수소는 살포 중간에 섞이므로 '마지막 수소 대기'가 없다.
      //   대신 후속 산개가 아직 시작 안 됐으면 여기서 시작한다 (원자 살포 완료 시점).
      if (salvoFollow && !salvoFollow.started) { try { armFollow(); } catch (e) {} }
      // 후속 산개(원자 수십발·수소 몇발)가 남아 있으면 그쪽 타이머가 마무리한다.
      //   단 'started'가 아니면(아직 시작 전) 지금 시작하고 보류 — 무한 대기 방지.
      if (salvoFollow) {
        if (!salvoFollow.started) { try { armFollow(); } catch (e) {} }
        if (salvoFollow) return;
      }
      salvoClear(null); return;
    }
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
        try { return isOwnedByMe(u, me); } catch (e) { return false; }
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
  // 이번 서버창(1초)에서 '업그레이드가' 쓴 인텐트 수.
  //   여러 클릭(다중 구조물)이 각자 펌프를 돌려도 합계가 상한을 넘지 않게 한다
  //   → X(+500=10건)를 눌러도 창에 여유가 남아 Z 살포·수소가 굶지 않는다.
  let upSentTimes = [];
  function upRoomNow() {
    const now = Date.now();
    while (upSentTimes.length && now - upSentTimes[0] > 1000) upSentTimes.shift();
    const cap = Math.max(1, Math.min(CFG.upgradeBurstPerWindow | 0 || 6, RL.perSecond));
    return Math.max(0, cap - upSentTimes.length);
  }

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

      // 이번 창 몫: 서버 여유 · 업그레이드 전용 상한 · 남은 양 중 최소
      const burst = Math.min(room, upRoomNow(), remaining - sent);
      let n = 0;
      while (n < burst && sent < remaining) {
        const amt = Math.min(perIntent, remaining - sent);
        if (amt <= 0) break;
        try {
          bus.emit(new ctor(unitId, type, amt));
          rateUse();
          upSentTimes.push(Date.now());
        } catch (e) {
          console.warn("[x50] 업그레이드 emit 실패:", e);
          toast("❌ 업그레이드 발송 실패", "#ff5555");
          return;
        }
        sent += amt;
        n++;
      }
      if (sent < remaining) {
        // 이번 창에서 업그레이드 몫을 다 썼다 → 창 회전까지 기다린다.
        //   (60ms 재시도로는 결국 창을 다 먹어 독점이 그대로 재현된다 — 실측 확인)
        const last = upSentTimes.length ? upSentTimes[upSentTimes.length - 1] : Date.now();
        const wait2 = Math.max(60, last + 1050 - Date.now());
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
        try { return isOwnedByMe(u, me); } catch (e) { return false; }
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

      // 대량 살포·수소타격은 반복 입력을 무시한다 (연사는 내부 스케줄이 담당)
      if (e.repeat && e.code === CFG.hotkeySalvo) return;
      if (e.repeat && e.code === CFG.hotkeyStrike) return;
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
      } else if (e.code === CFG.hotkeyStrike) {
        stop();
        startStrike();
      } else if (e.code === "Escape" && (salvoQueue.length > 0 || salvoTimer !== null || salvoFollow !== null)) {
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

  // ═════════════════════════════════════════════
  // 코너 HUD (v2.5)
  //
  // ① 서버 리밋 카운트다운 — '미사일의 80% 이상을 쓸 수 있게' 되는 시점까지.
  //    · 초당 한도(10건) 기준: 최근 1초 사용량이 80%(8건) 미만이면 '사용 가능(100%)'.
  //    · 남은 초가 있으면 "리밋 해제까지 N.N초"로 표시하고, 해제되면 초록으로 전환.
  //    · 분당 한도(150건)도 같이 본다 — 분당이 모자라면 그쪽이 지배한다.
  // ② 타깃 타격 가능성 — 커서가 가리키는 지역의 적 SAM을 분석해
  //    '소진 원자 C + 수소 1발 + 추가 3~5%'가 내 사일로·골드로 가능한지 상시 표기.
  //    (SAM이 없으면 '방어 없음', 분석 불가면 '—')
  // ═════════════════════════════════════════════
  let hudEl = null, hudTimer = null, hudCache = null, hudCacheAt = 0, hudCacheTile = null;
  let hudCacheBrief = false;    // 현재 캐시가 '이동 중 요약'인가 (정밀 아님)
  let hudPreciseTimer = null;   // 디바운스된 정밀 계산 예약
  // 커서가 멈추면 그 타일을 정밀 계산하도록 예약한다 (중복 예약은 취소)
  function schedulePrecise(tile) {
    if (hudPreciseTimer !== null) clearTimeout(hudPreciseTimer);
    hudPreciseTimer = setTimeout(() => {
      hudPreciseTimer = null;
      try {
        if (computeCursorTile() !== tile) return;   // 그새 커서가 더 움직였으면 생략
        hudCacheAt = 0; hudCacheTile = null;        // 강제 재계산 유도
        hudTick();
      } catch (e) {}
    }, 380);
  }

  function hudEnsure() {
    if (hudEl) return hudEl;
    try {
      hudEl = document.createElement("div");
      hudEl.style.cssText = [
        "position:fixed", "z-index:999998", "pointer-events:none",
        "padding:8px 10px", "border-radius:8px",
        "font:600 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace",
        "color:#e6edf3", "background:rgba(13,17,23,.78)",
        "border:1px solid rgba(110,118,129,.4)", "white-space:pre",
        "text-shadow:0 1px 2px rgba(0,0,0,.6)", "display:none",
      ].join(";");
      const c = CFG.hudCorner || "bottom-left";
      if (c === "top-left") hudEl.style.cssText += ";top:8px;left:8px";
      else if (c === "top-right") hudEl.style.cssText += ";top:8px;right:8px";
      else if (c === "bottom-right") hudEl.style.cssText += ";bottom:8px;right:8px";
      else hudEl.style.cssText += ";bottom:8px;left:8px";
      document.body.appendChild(hudEl);
    } catch (e) { hudEl = null; }
    return hudEl;
  }

  // 서버 리밋 상태 — '한도의 80%를 다시 쓸 수 있게' 되는 시점까지의 남은 시간.
  //   · 기준: 지금 남은 여유가 초당 8건(10×80%)·분당 120건(150×80%) 이상이면
  //     '사용 가능(여유 80%↑)' — 다시 충분히 쏠 수 있는 상태.
  //   · 여유가 그보다 적으면, 오래된 사용 기록이 1초/1분 창을 벗어나 여유가
  //     80%까지 회복되는 시각을 카운트다운한다.
  //   → 두 한도 중 더 늦게 회복되는 쪽이 실제 대기 시간.
  function hudRateState() {
    const now = Date.now();
    RL.secWindow = RL.secWindow.filter((t) => now - t < 1000);
    RL.minWindow = RL.minWindow.filter((t) => now - t < 60000);
    const usable = Math.max(1, Math.min(100, CFG.hudUsablePct || 80)) / 100;
    const secCap = RL.perSecond, minCap = RL.perMinute;
    const secWant = Math.max(1, Math.floor(secCap * usable));   // 회복해야 할 최소 여유 (8)
    const minWant = Math.max(1, Math.floor(minCap * usable));   // (120)
    const secUsed = RL.secWindow.length, minUsed = RL.minWindow.length;
    const secRoom = Math.max(0, secCap - secUsed);
    const minRoom = Math.max(0, minCap - minUsed);
    // 여유가 80%까지 회복되려면 만료돼야 할 건수 → 그중 마지막 건이 창을 벗어나는 시각
    let secLeft = 0, minLeft = 0;
    const secNeed = secUsed - (secCap - secWant);
    if (secNeed > 0 && RL.secWindow.length > 0) {
      const idx = Math.min(secNeed - 1, RL.secWindow.length - 1);
      secLeft = Math.max(0, (RL.secWindow[idx] + 1000 - now) / 1000);
    }
    const minNeed = minUsed - (minCap - minWant);
    if (minNeed > 0 && RL.minWindow.length > 0) {
      const idx = Math.min(minNeed - 1, RL.minWindow.length - 1);
      minLeft = Math.max(0, (RL.minWindow[idx] + 60000 - now) / 1000);
    }
    const left = Math.max(secLeft, minLeft);
    const ok = secRoom >= secWant && minRoom >= minWant;
    return { secUsed, secCap, minUsed, minCap, secWant, minWant,
             secRoom, minRoom, ok, secLeft, minLeft, left };
  }

  // 금액 표기 (억/만 단위 축약)
  function fmtGold(v) {
    try {
      const n = Number(toBig(v));
      if (!Number.isFinite(n)) return String(v);
      if (n >= 1e8) return (n / 1e8).toFixed(1) + "억";
      if (n >= 1e4) return (n / 1e4).toFixed(1) + "만";
      return n.toLocaleString();
    } catch (e) { return String(v); }
  }

  function hudTargetLine() {
    try {
      if (!CFG.hudHover) return "🎯 —";
      const now = Date.now();
      const tileNow = computeCursorTile();
      if (tileNow === null) { hudCache = "🎯 커서를 영토에"; hudCacheTile = null; return hudCache; }
      // ── 디바운스: 커서가 '멈춘 뒤'에만 정밀 계산한다 ──
      //   정밀 계획은 규모에 따라 30~80ms까지 걸릴 수 있어, 커서가 움직이는 동안
      //   계산하면 프레임이 끊긴다. → 이동 중에는 가벼운 요약만 보여주고,
      //   멈추고 350ms 뒤에 한 번 정밀 계산한다 (타일별 캐시로 재방문은 즉시).
      const moving = (now - lastMouseMoveAt) < 350;
      if (hudCache && hudCacheTile === tileNow) {
        // 같은 타일 재방문/머무름: 캐시가 유효하면 그대로, 아니면 정밀 갱신
        if (now - hudCacheAt < 2500 && !(moving && hudCacheBrief)) return hudCache;
      } else if (moving) {
        // 이동 중: 가벼운 요약 (SAM 수·ΣLv·방어량) + '계산 중' 안내, 정밀 계산은 예약
        let brief = null;
        try {
          const ana = CFG.samSimpleMode ? samsNear(tileNow) : samDefenders(tileNow);
          if (ana === null) brief = "🎯 —";
          else if (ana.n === 0) {
            let extra = "";
            try {
              const all = (getGameView().units("SAM Launcher") || []).length;
              if (all > 0) extra = ` (지도에 SAM ${all}기)`;
            } catch (e) {}
            brief = "🎯 방어 없음 — I=수소 1발" + extra;
          }
          else brief = `🎯 SAM ${ana.n}기 ΣLv${ana.sumLevel} · 계산 중…`;
        } catch (e) { brief = "🎯 계산 중…"; }
        hudCache = brief; hudCacheBrief = true; hudCacheTile = tileNow;
        schedulePrecise(tileNow);   // 커서가 멈추면 이 타일을 정밀 계산
        return hudCache;
      } else if (hudCache && now - hudCacheAt < 600) {
        return hudCache;
      }
      hudCacheAt = now; hudCacheTile = tileNow; hudCacheBrief = false;
      const tile = tileNow;
      if (tile === null) { hudCache = "🎯 커서를 영토에"; return hudCache; }
      // ── 단순 모드 HUD (v2.8.4) ──
      //   반드시 strikeSummary(경로 기반)보다 '먼저' 처리한다.
      //   strikeSummary는 samDefenders(궤적 판정)를 쓰므로 단순 모드와 결과가 다르고,
      //   no-sam으로 조기 반환해 아래 단순 분기에 도달하지 못하는 버그가 있었다.
      if (CFG.samSimpleMode) {
        const sn = samsNear(tile);
        const afS = (CFG.samAfterMin | 0) + (CFG.samAfterMax | 0) + (CFG.samAfterHydroMin | 0) + (CFG.samAfterHydroMax | 0) > 0
          ? `+후속 ☢${CFG.samAfterMin}~${CFG.samAfterMax} 💧${CFG.samAfterHydroMin}~${CFG.samAfterHydroMax}` : "";
        if (!sn || sn.n === 0) {
          let hint = "";
          try {
            const all = (getGameView().units("SAM Launcher") || []).length;
            if (all > 0) hint = ` (지도에 ${all}기 — 반경 밖/아군)`;
          } catch (e) {}
          hudCache = `🎯 SAM 없음 (${CFG.samSimpleRange}타일 내) — I=수소 1발${hint}`;
          return hudCache;
        }
        const shots = simpleShots(sn);
        const v = simpleVerdict(sn, shots, tile);
        const hEv = Math.max(0, CFG.samHydroEvery | 0);
        const hCnt = hEv > 0 ? Math.ceil(shots / hEv) : 0;
        const hydroTxt = hEv > 0 ? `☢ ${shots.toLocaleString()}발(×${CFG.samSimpleMult}) + 💧${hCnt}발(200발마다)`
                                 : `☢ ${shots.toLocaleString()}발(×${CFG.samSimpleMult})`;
        hudCache = `🎯 SAM ${sn.n}기 ΣLv${sn.sumLevel} (${sn.range}타일 내)\n`
                 + `${hydroTxt} → ${afS}`
                 + (v ? "\n" + verdictText(v) : "");
        return hudCache;
      }
      // HUD도 '정밀에 가깝게' — 표시값이 실제 발사량과 어긋나면 오해를 준다.
      //   경량 모드는 배수 1개라 큰 규모에서 필요량을 과대(1.25배) 표시했다.
      //   예산은 짧게(18ms) 유지해 프레임 보호.
      const a = strikeSummary(tile, true);   // light=true (내부에서 예산 관리)
      if (a.k === "na") { hudCache = "🎯 —"; return hudCache; }
      if (a.k === "no-sam") {
        // SAM이 실제로 존재하는데 0기로 나오면 계산 문제 → 진단 힌트를 함께 표시
        let extra = "";
        try {
          const all = (getGameView().units("SAM Launcher") || []).length;
          if (all > 0) extra = ` (지도에 SAM ${all}기 있음 — 경로 밖/아군)`;
        } catch (e) {}
        hudCache = "🎯 방어 없음 — I=수소 1발" + extra;
        return hudCache;
      }
      if (a.k !== "plan") { hudCache = "🎯 —"; return hudCache; }
      const jt = (a.jitterMin !== undefined && a.jitterMax !== undefined) ? `${a.jitterMin}~${a.jitterMax}` : "";
      // 여유분 표기: max(필요×10%, 랜덤 5~50) — '날아가는 동안 SAM 증원' 대비
      let l1;
      if (a.atomNeed !== null && a.atomNeed !== undefined && a.atomReserve !== null && a.atomReserve !== undefined) {
        const pctPart = (a.reservePct || 0) > 0 ? Math.ceil(a.atomNeed * a.reservePct / 100) : 0;
        const how = (pctPart > 0 && a.atomReserve === pctPart) ? `${a.reservePct}%` : (jt ? `랜덤${jt}` : "여유");
        l1 = `🎯 SAM ${a.samN}기 ΣLv${a.samSL} · 필요 ☢ ${a.atomNeed.toLocaleString()}발 +여유 ${a.atomReserve}(${how}) = ${a.C.toLocaleString()}`;
      } else {
        l1 = `🎯 SAM ${a.samN}기 ΣLv${a.samSL} · 필요 ☢ ${a.C.toLocaleString()}발${jt ? " +여유 " + jt : ""}`;
      }
      const af = (CFG.samAfterMin | 0) + (CFG.samAfterMax | 0) + (CFG.samAfterHydroMin | 0) + (CFG.samAfterHydroMax | 0) > 0
        ? ` +후속 ☢${CFG.samAfterMin}~${CFG.samAfterMax} 💧${CFG.samAfterHydroMin}~${CFG.samAfterHydroMax}` : "";
      // 🏭 사일로: 필요(실패 시 추정) vs 보유
      let l2;
      const own = a.tubesOwned !== undefined && a.tubesOwned !== null
        ? `보유 ${a.siloN}기·관Σ${a.tubesOwned}` + (a.ready !== null && a.ready !== undefined ? `(장전${a.ready})` : "")
        : "보유 —";
      const nd = a.need;
      const needMsg = nd && nd.ok
        ? (nd.mode === "spread"
            ? `필요: 사일로 ${nd.siloN}기(각 Lv${nd.lvEach}·관Σ${nd.tubes}) — 분산 건설`
            : `필요: 관Σ${nd.tubes} (×${nd.lvMult}, ${nd.siloN}기)`)
        : null;
      if (a.why === "no-silo") l2 = `🏭 사일로 없음 → 건설 필요 (${own})`;
      else if (a.ok) l2 = `🏭 가능 ✓ (${own})`;
      else if (a.why === "spread") {
        const mb = (a.maxBusy !== null && a.maxBusy !== undefined) ? `동시점유 ${a.maxBusy}/${a.sumLevel}` : "";
        l2 = `🏭 불가: ${mb} (파동 얕음) → ${needMsg || "사일로 늘리기"} (${own})`;
      }
      else if (a.why === "no-gap") {
        l2 = `🏭 불가: 슬롯이 계속 회복 → ${needMsg || "사일로 병렬성 ↑"} (${own})`;
      }
      else if (a.why === "short-run") {
        const ml = (a.maxRunLen !== null && a.maxRunLen !== undefined) ? `사각창 ${(a.maxRunLen / 1000).toFixed(1)}s` : "";
        l2 = `🏭 불가: ${ml} 부족 → ${needMsg || "사일로 병렬성 ↑"} (${own})`;
      }
      else if (a.why === "tubes") {
        l2 = `🏭 불가: 수소 넣을 빈 관 없음 → ${needMsg || "사일로 ↑"} (${own})`;
      }
      else l2 = `🏭 불가(${a.why || "창"}) ${needMsg || ""} (${own})`;
      // 💧 수소 타격 가능성 — '첫 수소가 실제로 들어가는가'가 핵심 판정
      let l3;
      if (a.ok) {
        const d = a.defense;
        const defTxt = a.ceil9 ? `적 방어 9초당 ${a.ceil9}발` : "";
        l3 = "💧 첫 수소 통과 ✓" + (defTxt ? ` · ${defTxt}` : "") + (af ? " ·" + af : "");
      } else {
        const g = a.h2Gap;
        const whyTxt = g ? `첫 수소 ${g.why} 격추` : `수소타격 불가(${a.why || "창"})`;
        const defTxt = a.ceil9 ? ` · 적 방어 9초당 ${a.ceil9}발` : "";
        l3 = `💧 ${whyTxt}${defTxt}` + (af ? " ·" + af : "");
      }
      // 💰 비용: 필요 vs 보유
      let l4 = "";
      if (a.goldNeed !== null && a.goldNeed !== undefined) {
        const needStr = a.goldNeed === 0n ? "무료" : fmtGold(a.goldNeed);
        const gold = myGold();
        const ownStr = gold === null ? "" : " / 보유 " + (toBig(gold) === 0n ? "∞(치트)" : fmtGold(gold));
        l4 = `💰 필요 ${needStr}${ownStr}` + (a.goldOk === false ? " ❌부족" : a.goldOk === true ? " ✅" : "");
      }
      hudCache = [l1, l2, l3, l4].filter(Boolean).join("\n");
      return hudCache;
    } catch (e) { return "🎯 —"; }
  }

    function hudTick() {
    hudTimer = null;
    try {
      if (!CFG.hud) return;
      const el = hudEnsure();
      if (!el) return;
      const r = hudRateState();
      const bar = r.ok ? "🟢" : "🔴";
      let rate = `${bar} 서버 ${r.secUsed}/${r.secCap}·초  ${r.minUsed}/${r.minCap}·분`;
      if (!r.ok) {
        rate += `\n⏳ 리밋 해제까지 ${r.left.toFixed(1)}초 (80%↑)`;
      } else {
        rate += "\n✅ 사용 가능 (80%↑)";
      }
      el.textContent = rate + "\n" + hudTargetLine();
      el.style.display = "block";
    } catch (e) {}
    hudTimer = setTimeout(hudTick, 200);
  }

  function hudStart() {
    if (hudTimer !== null) return;
    hudTimer = setTimeout(hudTick, 200);
  }

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
      samDefenders, mySilos, samRangeAtLevel, stPlan, stStream, stDeadRuns, stPath, stEngage,
      samsNear, simpleShots, simpleVerdict, verdictText,
      samDiag: (tile) => {
        // 진단: 커서 반경 내 SAM 판독 상태 (게임 F12 콘솔에서 __x50.samDiag())
        try {
          const g = getGameView();
          const t0 = (tile === undefined || tile === null) ? computeCursorTile() : tile;
          if (t0 === null || t0 === undefined) return "커서 좌표 없음 (영토 위에 커서를)";
          const myId = g.myPlayer() ? g.myPlayer().id() : "?";
          const all = g.units("SAM Launcher") || [];
          const sn = samsNear(t0);
          const lines = [];
          lines.push(`목표 tile=${t0} (${g.x(t0)},${g.y(t0)}) · 반경 ${CFG.samSimpleRange}`);
          lines.push(`나: ${myId}`);
          lines.push(`전체 SAM: ${all.length}기`);
          if (sn) {
            lines.push(`반경 내 적 SAM: ${sn.n}기 ΣLv${sn.sumLevel} → 발사 ${simpleShots(sn)}발 (×${CFG.samSimpleMult})`);
            lines.push(`  제외: 내것 ${sn.mine}기 · 판독실패 ${sn.skipped}기 · 건설중(포함) ${sn.building}기`);
            sn.defs.slice(0, 6).forEach((d) => lines.push(`  포함: (${d.x},${d.y}) Lv${d.lv} d=${d.d == null ? "?" : d.d.toFixed(0)}`));
          } else lines.push("samsNear=null (게임 뷰 없음)");
          // 전체 SAM 목록 (왜 빠졌는지 판독)
          lines.push("전체 목록(첫 8기):");
          all.slice(0, 8).forEach((u) => {
            try {
              const ut = u.tile();
              const ux = g.x(ut), uy = g.y(ut);
              const d = Math.hypot(ux - g.x(t0), uy - g.y(t0)).toFixed(0);
              const o = u.owner();
              lines.push(`  (${ux},${uy}) Lv${u.level()} 거리${d} owner=${o ? o.id() : "?"}${o && o.id() === myId ? " ←나" : ""}`);
            } catch (e) { lines.push(`  판독오류: ${e.message}`); }
          });
          return lines.join("\n");
        } catch (e) { return "진단 오류: " + e.message; }
      },
      stSilosNeeded, strikeSummary, fmtGold, hudRateState, hudTick, hudTargetLine, startStrike,
      lastStrikeRef: () => lastStrike, salvoHydroRef: () => salvoHydro,
      requestUpgrade, requestUpgradeBig: () => requestUpgrade(true),
      salvoState, salvoQueue: () => salvoQueue.slice(), salvoPending,
      salvoFollowRef: () => salvoFollow, armFollow,
      atomCostPerBomb, myGold, readyTubes,
      findNukeEventCtor, findUpgradeEventCtor, getGameView, getEventBus,
      targetFor, unitLevel, goalLevel, addFor,
    };
  } catch (e) {}

  // ── 코너 HUD 시작 ──
  try { if (CFG.hud) hudStart(); } catch (e) {}

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
