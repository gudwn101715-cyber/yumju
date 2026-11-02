import "./style.css";
import { createWorld } from "./world.js";
import {
  CHANNELS,
  ITEMS,
  ITEM_LIST,
  HALLS,
  NODES,
  GRADES,
} from "../shared/catalog.js";
import { icon } from "./icons.js";

const $ = (selector) => document.querySelector(selector);
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const storage = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {}
  },
};
let profile = null,
  snapshot = null,
  channels = CHANNELS.map((c) => ({ ...c, count: 0, capacity: 108 }));
let selectedHall = "main",
  socket,
  connected = false,
  reconnectTimer,
  pendingAction = null,
  autoBow = false;
let modal = null,
  bagFilter = "all",
  chosenItem = "bamboo",
  muted = true,
  audio = null;
let lastAutoBow = 0,
  lastError = "",
  lastErrorTime = 0,
  lastUiFrame = 0;
let roster = new Map();
const activity = [],
  chat = [];
const currentChannel = () =>
  channels.find((c) => c.id === profile?.channelId) || channels[0];
const ownPlayer = () =>
  snapshot?.players.find((p) => p.id === profile?.id) || profile;
const pct = (n) => `${Math.round((n || 0) * 100)}%`;

function beadArt(item, size = "", necklace = false) {
  if (!item) return "";
  if (item.kind === "cord" || necklace) {
    const colors = necklace
      ? (profile?.equipped.beads || []).map((id) => ITEMS[id].color)
      : [];
    return `<span class="bead-art cord-art ${size}" style="--wood:${item.color}"><svg viewBox="0 0 90 90" aria-hidden="true"><circle cx="45" cy="39" r="27" fill="none" stroke="${item.color}" stroke-width="${necklace ? 1.5 : 5}"/>${Array.from(
      { length: necklace ? Math.max(12, colors.length) : 0 },
      (_, i) => {
        const a = (i / Math.max(12, colors.length)) * Math.PI * 2;
        return `<circle cx="${45 + Math.cos(a) * 27}" cy="${39 + Math.sin(a) * 27}" r="5.8" fill="${colors[i] || "#d3c8ae"}" stroke="#66573d" stroke-opacity=".14"/>`;
      },
    ).join(
      "",
    )}<path d="M45 66v13m-4-3 4 6 4-6" fill="none" stroke="${item.color}" stroke-width="3" stroke-linecap="round"/><circle cx="45" cy="67" r="4" fill="${item.color}"/></svg></span>`;
  }
  return `<span class="bead-art ${size}" style="--wood:${item.color}"><i></i></span>`;
}

$("#app").innerHTML = `
  <header class="topbar">
    <a class="brand" href="/" aria-label="염주 온라인 홈"><span class="brand-mark">${icon("sun")}</span><div><strong>염주 <span>온라인</span></strong><small>YEOMJU ONLINE</small></div></a>
    <nav class="main-nav" aria-label="주 메뉴"><button class="active" data-action="explore">${icon("temple")}<span>산사 둘러보기</span></button><button data-action="inventory" data-testid="inventory-button">${icon("beads")}<span>나의 염주</span></button><button data-action="catalog">${icon("book")}<span>인연 도감</span></button></nav>
    <div class="header-actions"><span class="version-tag">EARLY ACCESS <b>v0.1</b></span><button class="icon-button" data-action="sound" aria-label="산사 소리 켜기" title="산사 소리">${icon("mute")}</button><button class="icon-button" data-action="guide" aria-label="도움말" title="도움말">${icon("help")}</button><span class="header-divider"></span><button class="avatar-button" data-action="profile" aria-label="나그네 이름 변경">나</button></div>
  </header>
  <div class="app-layout">
    <aside class="left-sidebar">
      <div class="sidebar-intro"><span class="eyebrow"><i></i> A MOMENT OF STILLNESS</span><h1>마음을 잇는<br>작은 인연.</h1><p>잠시 쉬어가도 괜찮아요.<br>이곳에서는 모든 걸음이 수행이니까요.</p></div>
      <button class="channel-card" data-action="channels" data-testid="channel-button"><span class="channel-card-top"><span class="channel-icon">${icon("leaf")}</span><span><small>지금 머무는 산사</small><strong id="channel-name">청연사 <em>CH. 01</em></strong></span>${icon("down")}</span><span class="channel-card-bottom"><span><i class="status-dot"></i><b id="channel-count">연결 중</b></span><span>채널 변경 ${icon("arrow")}</span></span></button>
      <section class="journey"><div class="section-label">나의 발걸음 <span>YOUR JOURNEY</span></div><div class="journey-row"><span class="journey-icon">${icon("bow")}</span><div><strong>마음을 내려놓는 시간</strong><small>법당에서 절 올리기</small></div><b id="bow-count">0<span> 배</span></b></div><div class="journey-row"><span class="journey-icon">${icon("leaf")}</span><div><strong>산사가 건네는 선물</strong><small>산책하며 재료 수집하기</small></div><b id="gather-count">0<span> 회</span></b></div></section>
      <div class="sidebar-note"><span class="note-symbol">“</span><p>한 알의 염주에 마음을 담고,<br>함께하는 인연을 엮어보세요.</p><span class="note-line"></span><small>마음을 모으는 곳, 염주 온라인</small></div>
      <button class="guide-link" data-action="guide">${icon("book")}<span>처음 오셨나요?<b>산사 생활 안내</b></span>${icon("arrow")}</button>
      <div class="visitor-card"><div class="visitor-avatar">${icon("leaf")}</div><div><strong id="visitor-name">고요한 나그네</strong><small><span class="status-dot" id="connection-dot"></span><span id="connection-status">산사에 들어가는 중</span></small></div><button class="icon-button" data-action="profile" aria-label="이름 바꾸기">${icon("chevron")}</button></div>
    </aside>
    <main class="main-column">
      <section class="world-panel" aria-label="3D 사찰 게임 화면">
        <div id="world"></div>
        <div class="scene-vignette"></div>
        <div class="scene-heading"><div><span class="scene-location">${icon("pin")} <span id="scene-theme">대나무 숲</span><span class="tiny-divider"></span>고요한 오후</span><h2 id="scene-name">청연사 <span>淸緣寺</span></h2></div><span class="live-badge"><i class="status-dot"></i> LIVE <span id="live-count">0 / 108</span></span></div>
        <div class="map-wrap"><div class="mini-map" aria-label="산사 지도"><svg id="minimap" viewBox="0 0 140 140"><rect x="0" y="0" width="140" height="140" rx="15" fill="#e7e9d9"/><path d="M18 35Q42 12 63 22T123 18M11 113Q45 95 31 70T18 35M113 122q-29-29-8-49T123 18" fill="none" stroke="#c5ceb4" stroke-width="14"/><path d="M70 122V50m0 25H35m35-25h36" fill="none" stroke="#faf7e9" stroke-width="9"/><rect x="58" y="41" width="24" height="17" rx="2" fill="#66816a"/><rect x="25" y="65" width="17" height="12" rx="2" fill="#91a18a"/><rect x="98" y="33" width="17" height="12" rx="2" fill="#91a18a"/><ellipse cx="108" cy="78" rx="17" ry="14" fill="#b3cdbe"/><circle id="map-player" cx="70" cy="95" r="4" fill="#fff" stroke="#486d52" stroke-width="2"/></svg><span>N</span></div><small>청연사 전경</small></div>
        <div class="scene-welcome" id="scene-welcome"><span>${icon("wind")}</span><div><strong>어서 오세요, 나그네님</strong><p>바람을 따라, 나만의 염주를 만나보세요.</p></div><button class="icon-button" data-action="dismiss-welcome" aria-label="환영 알림 닫기">${icon("close")}</button></div>
        <div class="target-indicator" id="target-indicator" hidden>${icon("pin")} <span></span><button data-action="cancel-target" aria-label="이동 취소">${icon("close")}</button></div>
        <div class="scene-bottom"><div class="controls-hint"><span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 이동</span><i></i><span>바닥을 클릭해 걸어가기</span></div><div class="scene-actions"><button class="scene-action" data-action="gather" data-testid="gather-button">${icon("leaf")}<span>재료 줍기</span><kbd>E</kbd></button><button class="scene-action primary-action" data-action="bow" data-testid="bow-button">${icon("bow")}<span>절 올리기</span><kbd>SPACE</kbd></button></div></div>
        <div class="loading-scene" id="loading-scene"><span class="loading-lotus">${icon("sun")}</span><strong>고요한 산사로 향하는 중</strong><small>잠시 마음을 가다듬어 주세요</small></div>
      </section>
      <section class="necklace-panel"><div class="necklace-heading"><span class="eyebrow">MY PRAYER BEADS</span><h3>나의 작은 우주</h3><p id="necklace-summary">염주 한 알에 담긴 나의 이야기</p><button data-action="inventory">염주 엮기 ${icon("arrow")}</button></div><div class="necklace-preview" id="necklace-preview"></div><div class="necklace-stats"><div>${icon("wind")}<span>이동 속도</span><b id="stat-move">+0%</b></div><div>${icon("bow")}<span>절 속도</span><b id="stat-bow">+0%</b></div><div>${icon("spark")}<span>절 획득 확률</span><b id="stat-drop">30%</b></div></div></section>
      <footer class="main-footer"><span><i class="status-dot"></i> 마음이 머무는 곳, 염주 온라인</span><span>작은 인연이 모여 하나의 염주가 됩니다.</span></footer>
    </main>
    <aside class="right-sidebar">
      <section class="ritual-section"><div class="section-label">함께 올리는 마음 <span class="live-pill">진행 중</span></div><div class="hall-tabs" role="group" aria-label="법당 선택">${HALLS.map((h) => `<button data-hall="${h.id}" class="${h.id === "main" ? "active" : ""}">${h.name}</button>`).join("")}</div><div class="ritual-illustration"><span class="ritual-rays"></span><span class="temple-illustration">${icon("temple")}</span><span class="ritual-dot one"></span><span class="ritual-dot two"></span></div><h3>백여덟 번의 정성</h3><p>우리의 마음이 하나로 모이면<br>산사가 특별한 인연을 선물해요.</p><div class="ritual-numbers"><strong id="ritual-progress">0 <span>/ 108 배</span></strong><small id="ritual-round">첫 번째 인연</small></div><div class="progress-track"><span id="ritual-bar"></span></div><div class="ritual-reward">${icon("gift")}<span>함께한 나그네 모두에게 <b>염주알 + 염주띠</b></span></div><button class="solid-button" data-action="bow" id="ritual-button">${icon("temple")} 법당으로 걸어가기 ${icon("arrow")}</button><label class="auto-bow"><input type="checkbox" id="auto-bow"/><span class="toggle"></span>마음을 이어서 올리기 <span class="auto-caption">자동 절</span></label></section>
      <section class="drops-section"><div class="section-label">이 산사의 인연<button data-action="catalog">도감 보기 ${icon("chevron")}</button></div><p class="section-subtitle" id="drop-subtitle">대나무 숲에서 만날 수 있어요</p><div id="featured-drops"></div><div class="drop-note">${icon("spark")} 드물게 더 귀한 인연을 만날 수 있어요</div></section>
      <section class="chat-section"><div class="section-label"><span>${icon("chat")} 산사의 이야기</span><span id="chat-online">0명</span></div><div class="chat-messages" id="chat-messages" role="log" aria-live="polite"><div class="chat-system">이곳에서 만난 인연에 따뜻한 인사를 건네보세요.</div></div><form id="chat-form" autocomplete="off"><input id="chat-input" data-testid="chat-input" aria-label="채널 채팅" placeholder="따뜻한 한마디를 남겨보세요" maxlength="160"/><button aria-label="채팅 보내기" data-testid="chat-send">${icon("send")}</button></form></section>
    </aside>
  </div>
  <div class="toasts" id="toasts" aria-live="polite"></div>
  <div class="modal-backdrop" id="modal-backdrop" hidden><section class="modal" id="modal" role="dialog" aria-modal="true" aria-label="게임 메뉴"></section></div>
`;

let world;
try {
  world = createWorld($("#world"), {
    onMoveTarget: (pos) => {
      pendingAction = null;
      autoBow = false;
      $("#auto-bow").checked = false;
      updateTarget();
      send({ type: "move", ...pos });
    },
    onInteract: ({ kind, id }) => (kind === "hall" ? goHall(id) : goGather(id)),
    onSelectHall: (id) => selectHall(id),
    onReady: () => $("#loading-scene")?.classList.add("loaded"),
  });
  world.setSelectedHall(selectedHall);
} catch (error) {
  console.error(error);
  $("#loading-scene").innerHTML =
    `${icon("help")}<strong>3D 화면을 시작할 수 없어요</strong><p>WebGL을 지원하는 브라우저에서 하드웨어 가속을 켜 주세요.</p>`;
}

function send(message) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
    return true;
  }
  toast("산사와 연결 중이에요. 잠시 후 다시 시도해 주세요.", "연결 대기");
  return false;
}
function connect() {
  clearTimeout(reconnectTimer);
  socket = new WebSocket(
    `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`,
  );
  socket.onopen = () => {
    roster.clear();
    socket.send(
      JSON.stringify({
        type: "join",
        protocol: 2,
        token: storage.get("yeomju-token") || undefined,
        channelId: Number(storage.get("yeomju-channel")) || 1,
      }),
    );
  };
  socket.onmessage = ({ data }) => {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (msg.type === "roster") {
      roster = new Map(msg.players.map((p) => [p.networkId, p]));
      return;
    }
    if (msg.type === "frame") {
      msg = {
        type: "world",
        channelId: msg.channelId,
        now: msg.now,
        players: msg.players
          .filter(([id]) => roster.has(id))
          .map(([id, x, z, bowEndsAt]) => ({
            ...roster.get(id),
            x,
            z,
            bowEndsAt,
            bowing: bowEndsAt > msg.now,
          })),
        nodes: msg.nodes.map(([i, readyAt]) => ({ ...NODES[i], readyAt })),
        rituals: msg.rituals.map(([i, progress, target, round]) => ({
          hallId: HALLS[i].id,
          progress,
          target,
          round,
        })),
      };
    }
    if (msg.type === "welcome") {
      storage.set("yeomju-token", msg.token);
      connected = true;
      renderConnection();
    }
    if (msg.type === "profile") {
      const changedChannel =
        profile && profile.channelId !== msg.player.channelId;
      profile = msg.player;
      storage.set("yeomju-channel", profile.channelId);
      world?.setSelf(profile);
      renderProfile();
      if (changedChannel) {
        snapshot = null;
        autoBow = false;
        $("#auto-bow").checked = false;
        pendingAction = null;
        updateTarget();
        chat.length = 0;
        renderChat();
        toast(
          `${currentChannel().theme}의 인연이 기다리고 있어요.`,
          `${currentChannel().name}에 도착했어요`,
        );
      }
      if (modal === "inventory") renderInventory();
    }
    if (msg.type === "world") {
      snapshot = msg;
      world?.setWorld(msg);
      updateLiveWorld();
    }
    if (msg.type === "channels") {
      channels = msg.channels;
      renderChannel();
      if (modal === "channels") renderChannels();
    }
    if (msg.type === "event") {
      if (msg.kind === "chat") {
        chat.push({ name: msg.name, text: msg.message });
        if (chat.length > 50) chat.shift();
        renderChat();
      } else if (msg.kind === "loot" || msg.kind === "ritual") {
        toast(
          msg.items
            ?.map((i) => `${ITEMS[i.itemId]?.name || i.itemId} ×${i.quantity}`)
            .join(" · ") || msg.message,
          msg.title,
          msg.kind === "ritual" ? "spark" : "leaf",
        );
        activity.push(msg);
        if (activity.length > 12) activity.shift();
      } else if (msg.kind === "bow-complete") {
        if (!autoBow)
          toast(
            msg.message || "정성스러운 절 한 번을 올렸어요.",
            msg.title || "마음을 담아 1배",
            "bow",
          );
      } else if (msg.kind === "system" && msg.message) {
        chat.push({ system: msg.message });
        if (chat.length > 50) chat.shift();
        renderChat();
      }
    }
    if (msg.type === "error") {
      if (msg.message !== lastError || Date.now() - lastErrorTime > 2500) {
        toast(msg.message, "잠깐만요", "help");
        lastError = msg.message;
        lastErrorTime = Date.now();
      }
      if (["OUT_OF_RANGE", "TOO_FAR"].includes(msg.code)) pendingAction = null;
      if (msg.code === "CHANNEL_FULL") openModal("channels");
    }
  };
  socket.onclose = () => {
    connected = false;
    renderConnection();
    pendingAction = null;
    autoBow = false;
    $("#auto-bow").checked = false;
    reconnectTimer = setTimeout(connect, 2500);
  };
  socket.onerror = () => socket.close();
}
connect();

function renderConnection() {
  $("#connection-status").textContent = connected
    ? "산사와 연결됨"
    : "산사에 다시 연결 중";
  $("#connection-dot").classList.toggle("offline", !connected);
}
function renderChannel() {
  const c = currentChannel();
  $("#channel-name").innerHTML =
    `${esc(c.name)} <em>CH. ${String(c.id).padStart(2, "0")}</em>`;
  $("#channel-count").textContent = `${c.count} / ${c.capacity} 명`;
  $("#scene-theme").textContent = c.theme;
  $("#scene-name").innerHTML =
    `${esc(c.name)} <span>${["淸緣寺", "松林寺", "蓮華寺", "白雲寺", "丹楓寺", "月精寺", "香林寺", "雪山寺", "金剛寺", "菩提寺"][c.id - 1]}</span>`;
  $(".map-wrap>small").textContent = `${c.name} 전경`;
  $("#live-count").textContent = `${c.count} / ${c.capacity}`;
  $("#chat-online").textContent = `${c.count}명`;
  $("#drop-subtitle").textContent = `${c.theme}에서 만날 수 있어요`;
  const pool = c.dropPools
    ? [...c.dropPools.beadIds, ...c.dropPools.cordIds]
    : c.favored;
  const featured = [
    ...new Set([
      ...c.favored,
      ...pool.filter((id) => GRADES[ITEMS[id].grade].rank >= 3),
      ...pool,
    ]),
  ].slice(0, 3);
  $("#featured-drops").innerHTML = featured
    .map((id) => {
      const i = ITEMS[id];
      return `<button class="drop-row" data-item="${i.id}">${beadArt(i, "small")}<span><strong>${i.name}</strong><small>${i.kind === "bead" ? "염주알" : "염주띠"} <i>·</i> ${i.kind === "cord" ? `${i.slots}알 수용` : i.material}</small></span><span class="grade-tag" style="--grade:${GRADES[i.grade].color}">${GRADES[i.grade].name}</span></button>`;
    })
    .join("");
}
function renderProfile() {
  if (!profile) return;
  $("#visitor-name").textContent = profile.name;
  $(".avatar-button").textContent = Array.from(profile.name)[0];
  $("#bow-count").innerHTML = `${profile.bowCount}<span> 배</span>`;
  $("#gather-count").innerHTML = `${profile.gatherCount}<span> 회</span>`;
  $("#stat-move").textContent = `+${pct(profile.stats.moveBonus)}`;
  $("#stat-bow").textContent = `+${pct(profile.stats.bowBonus)}`;
  $("#stat-drop").textContent = pct(profile.stats.dropRate);
  const eq = profile.equipped;
  $("#necklace-summary").textContent =
    `${ITEMS[eq.cordId].name} · ${eq.beads.length} / ${profile.stats.slots}알`;
  $("#necklace-preview").innerHTML =
    `<div class="bead-string">${Array.from({ length: Math.min(profile.stats.slots, 12) }, (_, i) => (eq.beads[i] ? `<button data-item="${eq.beads[i]}" title="${ITEMS[eq.beads[i]].name}">${beadArt(ITEMS[eq.beads[i]], "tiny")}</button>` : '<span class="empty-bead"></span>')).join("")}${profile.stats.slots > 12 ? `<small>+${profile.stats.slots - 12}</small>` : ""}</div><div class="string-caption"><i></i>${eq.beads.length ? "작은 인연들이 하나로 이어지고 있어요" : "빈자리에 나만의 인연을 엮어보세요"}<i></i></div>`;
  renderChannel();
}
function updateLiveWorld() {
  const self = ownPlayer();
  if (!self) return;
  const hall = HALLS.find((h) => h.id === selectedHall);
  const near = Math.hypot(self.x - hall.x, self.z - hall.z) < hall.radius - 1;
  $("#ritual-button").innerHTML = self.bowing
    ? `${icon("bow")} 정성을 담아 절하는 중…`
    : near
      ? `${icon("bow")} 마음을 담아 절 올리기 ${icon("arrow")}`
      : `${icon("temple")} 법당으로 걸어가기 ${icon("arrow")}`;
  const r = snapshot.rituals.find((r) => r.hallId === selectedHall);
  if (r) {
    $("#ritual-progress").innerHTML =
      `${r.progress} <span>/ ${r.target} 배</span>`;
    $("#ritual-bar").style.width = `${(r.progress / r.target) * 100}%`;
    $("#ritual-round").textContent = `${r.round}번째 인연`;
  }
  $("#map-player").setAttribute("cx", String(70 + self.x * 0.69));
  $("#map-player").setAttribute("cy", String(70 + self.z * 0.69));
  const bowBtn = $('[data-testid="bow-button"]');
  bowBtn.classList.toggle("bowing", !!self.bowing);
  bowBtn.querySelector("span").textContent = self.bowing
    ? "마음을 모으는 중"
    : "절 올리기";
  if (pendingAction) {
    const target =
      pendingAction.kind === "hall"
        ? HALLS.find((h) => h.id === pendingAction.id)
        : NODES.find((n) => n.id === pendingAction.id);
    const radius = pendingAction.kind === "hall" ? target.radius - 2 : 5.5;
    if (Math.hypot(self.x - target.x, self.z - target.z) < radius) {
      const action = pendingAction;
      pendingAction = null;
      updateTarget();
      if (action.kind === "hall") {
        send({ type: "move", x: self.x, z: self.z });
        setTimeout(() => send({ type: "bow", hallId: action.id }), 150);
        lastAutoBow = Date.now() + 300;
      } else send({ type: "gather", nodeId: action.id });
    }
  }
  if (
    autoBow &&
    !pendingAction &&
    !self.bowing &&
    near &&
    Date.now() - lastAutoBow > 700
  ) {
    lastAutoBow = Date.now();
    send({ type: "bow", hallId: selectedHall });
  }
  if (modal === "showcase" && Date.now() - lastUiFrame > 1000) {
    renderShowcase();
    lastUiFrame = Date.now();
  }
}
function selectHall(id) {
  selectedHall = id;
  world?.setSelectedHall(id);
  document
    .querySelectorAll("[data-hall]")
    .forEach((el) => el.classList.toggle("active", el.dataset.hall === id));
  if (snapshot) updateLiveWorld();
}
function updateTarget() {
  const el = $("#target-indicator");
  el.hidden = !pendingAction;
  if (pendingAction) {
    const target =
      pendingAction.kind === "hall"
        ? HALLS.find((h) => h.id === pendingAction.id)
        : NODES.find((n) => n.id === pendingAction.id);
    el.querySelector("span").textContent = `${target.name}(으)로 걸어가는 중`;
  }
}
function goHall(id = selectedHall) {
  if (!profile) return toast("산사에 연결한 뒤 시작할 수 있어요.", "연결 중");
  selectHall(id);
  const h = HALLS.find((h) => h.id === id),
    self = ownPlayer();
  if (Math.hypot(self.x - h.x, self.z - h.z) < h.radius - 1) {
    send({ type: "bow", hallId: id });
    lastAutoBow = Date.now();
    return;
  }
  pendingAction = { kind: "hall", id };
  updateTarget();
  send({ type: "move", x: h.x, z: h.z + 8 });
}
function goGather(id) {
  if (!profile) return;
  const self = ownPlayer();
  const node = id
    ? NODES.find((n) => n.id === id)
    : NODES.filter(
        (n) =>
          !(snapshot?.nodes.find((s) => s.id === n.id)?.readyAt > Date.now()),
      ).sort(
        (a, b) =>
          Math.hypot(self.x - a.x, self.z - a.z) -
          Math.hypot(self.x - b.x, self.z - b.z),
      )[0];
  if (!node)
    return toast(
      "숲이 다시 선물을 준비하고 있어요. 조금만 기다려 주세요.",
      "잠시 쉬어가기",
    );
  if (Math.hypot(self.x - node.x, self.z - node.z) < 6.5)
    send({ type: "gather", nodeId: node.id });
  else {
    pendingAction = { kind: "node", id: node.id };
    updateTarget();
    send({ type: "move", x: node.x, z: node.z });
  }
}
function toast(message, title = "산사의 소식", symbol = "leaf") {
  const el = document.createElement("div");
  el.className = "toast";
  el.innerHTML = `<span>${icon(symbol)}</span><div><strong>${esc(title)}</strong><p>${esc(message)}</p></div>`;
  $("#toasts").append(el);
  while ($("#toasts").children.length > 4)
    $("#toasts").firstElementChild.remove();
  setTimeout(() => el.remove(), 5200);
}
function renderChat() {
  const el = $("#chat-messages");
  el.innerHTML = chat.length
    ? chat
        .map((m) =>
          m.system
            ? `<div class="chat-system">${esc(m.system)}</div>`
            : `<div class="chat-message"><b>${esc(m.name)}</b><span>${esc(m.text)}</span></div>`,
        )
        .join("")
    : '<div class="chat-system">이곳에서 만난 인연에 따뜻한 인사를 건네보세요.</div>';
  el.scrollTop = el.scrollHeight;
}

function openModal(type) {
  modal = type;
  $("#modal-backdrop").hidden = false;
  $("#modal").className = `modal modal-${type}`;
  if (type === "inventory") renderInventory();
  else if (type === "catalog") renderCatalog();
  else if (type === "channels") renderChannels();
  else if (type === "showcase") renderShowcase();
  else if (type === "profile") renderName();
  else renderGuide();
  $("#modal").querySelector("button,input")?.focus();
}
function modalHeader(eyebrow, title, desc = "") {
  return `<header class="modal-header"><span class="eyebrow">${eyebrow}</span><h2>${title}</h2>${desc ? `<p>${desc}</p>` : ""}<button class="icon-button modal-close" data-action="close-modal" aria-label="메뉴 닫기">${icon("close")}</button></header>`;
}
function closeModal() {
  modal = null;
  $("#modal-backdrop").hidden = true;
}
function itemStats(item) {
  return Object.entries(item.stats)
    .map(
      ([k, v]) =>
        `<span>${icon({ move: "wind", bow: "bow", drop: "spark", gather: "leaf" }[k])}${{ move: "이동 속도", bow: "절 속도", drop: "절 획득 확률", gather: "추가 수집 확률" }[k]}<b>+${pct(v)}</b></span>`,
    )
    .join("");
}
function renderInventory() {
  if (!profile) {
    $("#modal").innerHTML =
      modalHeader("MY PRAYER BEADS", "나의 염주") +
      '<p class="empty-state">산사와 연결하고 있어요.</p>';
    return;
  }
  const selected = ITEMS[chosenItem] || ITEMS.bamboo;
  const inv = profile.inventory.filter(
    (i) => bagFilter === "all" || ITEMS[i.itemId].kind === bagFilter,
  );
  const count = (id) =>
    profile.inventory.find((i) => i.itemId === id)?.quantity || 0;
  const equipped = profile.equipped.beads.filter(
    (id) => id === selected.id,
  ).length;
  $("#modal").innerHTML =
    modalHeader(
      "MY PRAYER BEADS",
      "인연을 하나씩, 마음을 엮어요.",
      "모은 염주알을 띠에 꿰어 나만의 염주를 완성하세요.",
    ) +
    `<div class="inventory-layout"><div class="inventory-bag"><div class="filter-tabs">${[
      ["all", "모든 인연"],
      ["bead", "염주알"],
      ["cord", "염주띠"],
    ]
      .map(
        ([v, n]) =>
          `<button data-bag-filter="${v}" class="${bagFilter === v ? "active" : ""}">${n}</button>`,
      )
      .join(
        "",
      )}<span>${profile.inventory.length}종 보유</span></div><div class="inventory-grid">${inv
      .map(({ itemId, quantity }) => {
        const i = ITEMS[itemId];
        return `<button class="inventory-item ${chosenItem === itemId ? "selected" : ""}" data-select-item="${itemId}" style="--grade:${GRADES[i.grade].color}"><small class="item-quantity">×${quantity}</small>${beadArt(i)}<span>${i.name}</span><small class="item-grade">${GRADES[i.grade].name}</small>${profile.equipped.cordId === itemId || profile.equipped.beads.includes(itemId) ? '<span class="equipped-check">장착</span>' : ""}</button>`;
      })
      .join(
        "",
      )}</div><div class="bag-bottom">${icon("lock")} 장착한 재료는 사라지지 않아요. 자유롭게 바꿔보세요.</div></div><aside class="item-detail" style="--grade:${GRADES[selected.grade].color}"><span class="grade-tag">${GRADES[selected.grade].name} · ${selected.kind === "bead" ? "염주알" : "염주띠"}</span>${beadArt(selected, "large")}<h3>${selected.name}</h3><p>${selected.description}</p><div class="material-info"><span>소재 <b>${selected.material}</b></span><span>게임 내 강도 <b>${selected.strength} / 10</b></span>${selected.slots ? `<span>염주알 수용량 <b>${selected.slots}알</b></span>` : ""}</div><div class="item-stat-list">${itemStats(selected)}</div><div class="detail-actions">${selected.kind === "bead" ? `<button class="solid-button" data-action="equip-bead" ${equipped >= count(selected.id) || profile.equipped.beads.length >= profile.stats.slots ? "disabled" : ""}>${icon("beads")} 염주알 끼우기${equipped ? ` (${equipped}알 장착 중)` : ""}</button>${equipped ? '<button class="outline-button" data-action="remove-bead">염주알 한 알 빼기</button>' : ""}` : `<button class="solid-button" data-action="equip-cord" ${selected.id === profile.equipped.cordId ? "disabled" : ""}>${icon("beads")} ${selected.id === profile.equipped.cordId ? "지금 사용 중인 띠예요" : "이 염주띠로 엮기"}</button>`}</div></aside></div><div class="equipped-summary">${beadArt(ITEMS[profile.equipped.cordId], "small", true)}<div><strong>${ITEMS[profile.equipped.cordId].name}</strong><span>${profile.equipped.beads.length} / ${profile.stats.slots}알 장착</span></div><div class="equipped-mini-beads">${
      profile.equipped.beads
        .slice(0, 12)
        .map((id) => beadArt(ITEMS[id], "tiny"))
        .join("") || "<span>아직 엮은 염주알이 없어요</span>"
    }</div></div>`;
}
function renderCatalog() {
  const owned = new Set(profile?.inventory.map((i) => i.itemId));
  $("#modal").innerHTML =
    modalHeader(
      "COLLECTION OF CONNECTIONS",
      "모든 인연에는 이야기가 있어요.",
      "소박 · 정갈 · 귀한 · 진귀 · 명품, 다섯 등급의 염주알과 염주띠를 만나보세요.",
    ) +
    `<div class="catalog-note">${icon("leaf")} 등급은 게임 속 희소성과 가공 난이도를 함께 반영합니다. 실제 목재의 절대적인 강도 순위는 아니에요.</div><div class="catalog-grid">${ITEM_LIST.map((i) => `<button class="catalog-item ${owned.has(i.id) ? "discovered" : ""}" data-catalog-item="${i.id}" style="--grade:${GRADES[i.grade].color}">${beadArt(i)}<span class="grade-tag">${GRADES[i.grade].name}</span><strong>${i.name}</strong><small>${i.slots ? `${i.slots}알 수용` : `강도 ${i.strength} / 10`} · ${owned.has(i.id) ? "인연을 만났어요" : "아직 만나지 못한 인연"}</small><div>${itemStats(i)}</div></button>`).join("")}</div>`;
}
function renderChannels() {
  $("#modal").innerHTML =
    modalHeader(
      "TEN PLACES, TEN CONNECTIONS",
      "어느 산사에 머무를까요?",
      "열 곳의 산사, 저마다 다른 풍경과 인연. 한 산사에는 최대 108명이 함께해요.",
    ) +
    `<div class="channel-grid">${channels.map((c) => `<button class="channel-option ${profile?.channelId === c.id ? "selected" : ""}" data-join-channel="${c.id}" ${c.count >= c.capacity && profile?.channelId !== c.id ? "disabled" : ""} style="--theme:${c.color}"><div class="channel-landscape"><span class="channel-number">CH. ${String(c.id).padStart(2, "0")}</span>${icon("temple")}<span class="landscape-hill"></span><span class="landscape-hill second"></span></div><div class="channel-option-body"><strong>${c.name}<span>${c.theme}</span></strong><p>${c.subtitle}</p><div class="channel-items">${c.favored.map((id) => `<span>${beadArt(ITEMS[id], "micro")}${ITEMS[id].name}</span>`).join("")}</div><div class="channel-occupancy"><span><i class="status-dot"></i>${c.count} / ${c.capacity}명</span><b>${profile?.channelId === c.id ? "머무는 중" : c.count >= c.capacity ? "가득 찼어요" : "방문하기 " + icon("arrow")}</b></div></div></button>`).join("")}</div>`;
}
function renderGuide() {
  $("#modal").innerHTML =
    modalHeader(
      "A GUIDE TO TEMPLE LIFE",
      "천천히, 나의 속도로.",
      "경쟁하지 않아도 괜찮아요. 이 산사에서는 작은 정성도 소중한 인연이 됩니다.",
    ) +
    `<div class="guide-grid">${[
      [
        "pin",
        "01",
        "산사를 거닐어요",
        "바닥을 클릭하거나 WASD·방향키로 이동해요. 마우스 휠로 풍경을 가까이 볼 수도 있어요.",
      ],
      [
        "leaf",
        "02",
        "작은 선물을 찾아요",
        "반짝이는 채집 지점을 클릭하거나 E를 누르면 가까운 재료를 찾아 걸어갑니다. 채집 지점은 잠시 쉬었다 다시 채워져요.",
      ],
      [
        "bow",
        "03",
        "마음을 모아 절해요",
        "법당을 선택하고 Space 또는 절 올리기를 누르세요. 자동 절을 켜면 멈추기 전까지 수행을 이어가요. 이동하면 절이 중단됩니다.",
      ],
      [
        "beads",
        "04",
        "나만의 염주를 엮어요",
        "나의 염주에서 염주띠와 염주알을 장착해요. 같은 염주알도 가진 수만큼 꿸 수 있어요. 띠가 좋을수록 많은 알을 담습니다.",
      ],
      [
        "people",
        "05",
        "함께하면 특별해요",
        "같은 법당에서 108배를 채우면 기여하고 접속 중인 모두에게 염주알과 띠가 선물됩니다. 이웃을 클릭해 염주도 구경해보세요.",
      ],
      [
        "spark",
        "06",
        "새로운 인연을 만나요",
        "10개 채널마다 특정 재료가 더 잘 나와요. 채널은 언제든 바꿀 수 있고, 모은 재료와 장비는 그대로 함께합니다.",
      ],
    ]
      .map(
        ([i, n, t, d]) =>
          `<article><span>${icon(i)}<small>${n}</small></span><h3>${t}</h3><p>${d}</p></article>`,
      )
      .join(
        "",
      )}</div><p class="privacy-note">이 버전은 브라우저에 저장된 나그네 열쇠로 기록을 이어갑니다. 브라우저 데이터를 지우거나 다른 기기를 쓰면 새 나그네로 시작해요.</p><button class="solid-button guide-start" data-action="close-modal">나의 산사 생활 시작하기 ${icon("arrow")}</button>`;
}
function renderName() {
  $("#modal").innerHTML =
    modalHeader(
      "MY LITTLE NAME",
      "어떤 이름으로 만날까요?",
      "산사에서 다른 나그네에게 보여줄 이름을 정해주세요.",
    ) +
    `<form id="name-form"><label for="name-input">나그네 이름</label><input id="name-input" value="${esc(profile?.name || "고요한 나그네")}" minlength="2" maxlength="12" required autocomplete="nickname"/><small>2~12자 · 따뜻하고 정갈한 이름을 사용해주세요.</small><button class="solid-button" type="submit">이 이름으로 머무르기 ${icon("arrow")}</button></form>`;
}
function renderShowcase() {
  const content = (snapshot?.players || [])
    .map(
      (p) =>
        `<article><div class="visitor-avatar">${icon("leaf")}</div><div><strong>${esc(p.name)} ${p.id === profile?.id ? "<em>나</em>" : ""}</strong><small>${p.bowing ? "정성을 모아 절하는 중" : "산사를 거니는 중"} · ${ITEMS[p.cordId]?.name || "삼베 염주띠"} · ${p.beadCount ?? p.necklace?.length ?? 0}알</small><div>${(p.necklace || []).map((id) => beadArt(ITEMS[id], "tiny")).join("") || '<span class="empty-text">아직 염주를 엮고 있어요</span>'}${p.beadCount > 8 ? `<span class="empty-text">+${p.beadCount - 8}알</span>` : ""}</div></div></article>`,
    )
    .join("");
  const existing = $("#modal .showcase-list");
  if (existing) {
    existing.innerHTML = content;
    return;
  }
  $("#modal").innerHTML =
    modalHeader(
      "OUR PRAYER BEADS",
      "인연이 모이는 산사",
      "지금 가까이 머무는 나그네들의 염주를 구경해보세요.",
    ) + `<div class="showcase-list">${content}</div>`;
}

document.addEventListener("click", (e) => {
  const action = e.target.closest("[data-action]")?.dataset.action;
  if (
    action === "inventory" ||
    action === "catalog" ||
    action === "channels" ||
    action === "guide" ||
    action === "profile"
  )
    openModal(action);
  if (action === "explore") closeModal();
  if (action === "close-modal") closeModal();
  if (action === "bow") goHall();
  if (action === "gather") goGather();
  if (action === "dismiss-welcome") $("#scene-welcome").remove();
  if (action === "cancel-target") {
    pendingAction = null;
    autoBow = false;
    $("#auto-bow").checked = false;
    const self = ownPlayer();
    if (self) send({ type: "move", x: self.x, z: self.z });
    updateTarget();
  }
  if (action === "sound") toggleSound();
  if (action === "equip-bead" && profile)
    send({
      type: "equip",
      cordId: profile.equipped.cordId,
      beads: [...profile.equipped.beads, chosenItem],
    });
  if (action === "remove-bead" && profile) {
    const beads = [...profile.equipped.beads];
    const i = beads.indexOf(chosenItem);
    if (i >= 0) beads.splice(i, 1);
    send({ type: "equip", cordId: profile.equipped.cordId, beads });
  }
  if (action === "equip-cord" && profile)
    send({
      type: "equip",
      cordId: chosenItem,
      beads: profile.equipped.beads.slice(0, ITEMS[chosenItem].slots),
    });
  const hall = e.target.closest("[data-hall]")?.dataset.hall;
  if (hall) selectHall(hall);
  const filter = e.target.closest("[data-bag-filter]")?.dataset.bagFilter;
  if (filter) {
    bagFilter = filter;
    renderInventory();
  }
  const item = e.target.closest("[data-select-item]")?.dataset.selectItem;
  if (item) {
    chosenItem = item;
    renderInventory();
  }
  const inspect = e.target.closest("[data-item]")?.dataset.item;
  if (inspect) {
    chosenItem = inspect;
    bagFilter = "all";
    if (profile?.inventory.some((i) => i.itemId === inspect))
      openModal("inventory");
    else openModal("catalog");
  }
  const catalog = e.target.closest("[data-catalog-item]")?.dataset.catalogItem;
  if (catalog) {
    const i = ITEMS[catalog];
    const places = CHANNELS.filter((c) =>
      [...c.dropPools.beadIds, ...c.dropPools.cordIds].includes(catalog),
    )
      .map((c) => c.name)
      .join(" · ");
    toast(
      `${i.description} 만날 수 있는 산사: ${places}`,
      `${i.name} · ${GRADES[i.grade].name}`,
    );
  }
  const join = e.target.closest("[data-join-channel]")?.dataset.joinChannel;
  if (join) {
    if (Number(join) !== profile?.channelId)
      send({
        type: "join",
        token: storage.get("yeomju-token") || undefined,
        channelId: Number(join),
      });
    closeModal();
  }
  if (e.target === $("#modal-backdrop")) closeModal();
  if (e.target.closest(".avatar-label") && !e.target.closest("[data-action]"))
    openModal("showcase");
});
document.addEventListener("submit", (e) => {
  if (e.target.id === "chat-form") {
    e.preventDefault();
    const input = $("#chat-input");
    if (input.value.trim()) send({ type: "chat", text: input.value.trim() });
    input.value = "";
  }
  if (e.target.id === "name-form") {
    e.preventDefault();
    send({ type: "rename", name: $("#name-input").value.trim() });
    closeModal();
  }
});
$("#auto-bow").addEventListener("change", (e) => {
  autoBow = e.target.checked;
  if (autoBow) goHall();
});
const keys = new Set();
const movementKeys = [
  "w",
  "a",
  "s",
  "d",
  "arrowup",
  "arrowleft",
  "arrowdown",
  "arrowright",
];
function updateKeys() {
  let x =
    (keys.has("d") || keys.has("arrowright") ? 1 : 0) -
    (keys.has("a") || keys.has("arrowleft") ? 1 : 0);
  let z =
    (keys.has("s") || keys.has("arrowdown") ? 1 : 0) -
    (keys.has("w") || keys.has("arrowup") ? 1 : 0);
  world?.setMoveInput({ x, z });
}
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeModal();
    return;
  }
  if (e.target.matches("input,textarea") || modal) return;
  const k = e.key.toLowerCase();
  if (movementKeys.includes(k)) {
    e.preventDefault();
    keys.add(k);
    pendingAction = null;
    autoBow = false;
    $("#auto-bow").checked = false;
    updateTarget();
    updateKeys();
  }
  if (e.code === "Space") {
    e.preventDefault();
    if (!e.repeat) goHall();
  }
  if (k === "e" && !e.repeat) goGather();
  if (k === "i" && !e.repeat) openModal("inventory");
});
document.addEventListener("keyup", (e) => {
  keys.delete(e.key.toLowerCase());
  updateKeys();
});
window.addEventListener("blur", () => {
  keys.clear();
  updateKeys();
});
function toggleSound() {
  muted = !muted;
  const btn = $('[data-action="sound"]');
  btn.innerHTML = icon(muted ? "mute" : "volume");
  btn.setAttribute("aria-label", muted ? "산사 소리 켜기" : "산사 소리 끄기");
  if (!muted) {
    try {
      audio ||= new (window.AudioContext || window.webkitAudioContext)();
      audio.resume();
      const strike = () => {
        if (muted) return;
        [220, 440, 660].forEach((f, i) => {
          const o = audio.createOscillator(),
            g = audio.createGain();
          o.frequency.value = f;
          o.type = "sine";
          g.gain.setValueAtTime(0.025 / (i + 1), audio.currentTime);
          g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 5);
          o.connect(g);
          g.connect(audio.destination);
          o.start();
          o.stop(audio.currentTime + 5);
        });
      };
      strike();
      clearInterval(window.__templeBell);
      window.__templeBell = setInterval(strike, 18000);
      toast("은은한 종소리와 함께 잠시 쉬어가세요.", "산사의 소리");
    } catch {
      muted = true;
      toast("이 브라우저에서는 소리를 재생할 수 없어요.", "소리 안내");
    }
  } else clearInterval(window.__templeBell);
}
renderChannel();
