import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { DatabaseSync } from "node:sqlite";
import { randomBytes, randomUUID, createHash, randomInt } from "node:crypto";
import { mkdirSync, existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CHANNELS,
  CHANNEL_CAPACITY,
  ITEMS,
  HALLS,
  NODES,
  SPAWN,
  calculateStats,
} from "../shared/catalog.js";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const finitePoint = (p) =>
  typeof p.x === "number" &&
  typeof p.z === "number" &&
  Number.isFinite(p.x) &&
  Number.isFinite(p.z);
const safeName = (value) =>
  [
    ...String(value ?? "")
      .normalize("NFC")
      .replace(/[<>\x00-\x1f\x7f]/g, "")
      .trim(),
  ]
    .slice(0, 12)
    .join("");
const publicPlayer = (p) => ({
  id: p.id,
  name: p.name,
  x: +p.x.toFixed(2),
  z: +p.z.toFixed(2),
  bowing: Boolean(p.bow),
  bowEndsAt: p.bow?.endsAt ?? 0,
  necklace: p.equipped.beads.slice(0, 8),
  beadCount: p.equipped.beads.length,
  cordId: p.equipped.cordId,
});

// Grade values are relative weights inside this channel's eligible pool, not percentages.
export function rollChannelItem(
  channel,
  kind,
  random = () => randomInt(1_000_000) / 1_000_000,
) {
  const weights = {
    common: 52,
    uncommon: 27,
    rare: 14,
    epic: 5.8,
    legendary: 1.2,
  };
  const ids =
    kind === "cord" ? channel.dropPools.cordIds : channel.dropPools.beadIds;
  const weighted = ids.map((id) => ({
    id,
    weight: weights[ITEMS[id].grade] * (channel.favored.includes(id) ? 3 : 1),
  }));
  let pick = random() * weighted.reduce((sum, entry) => sum + entry.weight, 0);
  for (const entry of weighted) {
    pick -= entry.weight;
    if (pick <= 0) return entry.id;
  }
  return weighted.at(-1).id;
}

export function createGameServer(options = {}) {
  const dbPath =
    options.dbPath ?? resolve(process.env.DATA_DIR || "data", "yumju.sqlite");
  if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(
    "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS players (token_hash TEXT PRIMARY KEY, id TEXT NOT NULL UNIQUE, profile TEXT NOT NULL, updated_at INTEGER NOT NULL);",
  );
  const loadPlayer = db.prepare(
    "SELECT profile FROM players WHERE token_hash=?",
  );
  const savePlayer = db.prepare(
    "INSERT INTO players(token_hash,id,profile,updated_at) VALUES(?,?,?,?) ON CONFLICT(token_hash) DO UPDATE SET profile=excluded.profile,updated_at=excluded.updated_at",
  );
  const capacity = options.capacity ?? CHANNEL_CAPACITY;
  const ritualTarget = options.ritualTarget ?? 108;
  const random = options.random ?? (() => randomInt(1_000_000) / 1_000_000);
  const channels = new Map(
    CHANNELS.map((channel) => [
      channel.id,
      {
        ...channel,
        players: new Map(),
        chat: [],
        nodes: NODES.map((node) => ({ ...node, readyAt: 0 })),
        rituals: HALLS.map((hall) => ({
          hallId: hall.id,
          progress: 0,
          target: ritualTarget,
          round: 1,
          participants: new Set(),
        })),
      },
    ]),
  );
  const activeIds = new Map();
  const connections = new Set();
  let closed = false;
  let nextNetworkId = 1;

  const send = (ws, data) => {
    if (ws.readyState !== WebSocket.OPEN || ws.bufferedAmount >= 262144)
      return false;
    ws.send(typeof data === "string" ? data : JSON.stringify(data));
    return true;
  };
  const error = (ws, code, message) =>
    send(ws, { type: "error", code, message });
  const event = (ws, kind, title, message, extra = {}) =>
    send(ws, { type: "event", kind, title, message, ...extra });
  const broadcast = (channel, data) => {
    for (const player of channel.players.values()) send(player.ws, data);
  };
  const persist = (p) =>
    savePlayer.run(
      p.tokenHash,
      p.id,
      JSON.stringify({
        id: p.id,
        name: p.name,
        inventory: p.inventory,
        equipped: p.equipped,
        bowCount: p.bowCount,
        gatherCount: p.gatherCount,
        channelId: p.channelId,
      }),
      Date.now(),
    );
  const profile = (p) =>
    send(p.ws, {
      type: "profile",
      player: {
        id: p.id,
        name: p.name,
        channelId: p.channelId,
        x: p.x,
        z: p.z,
        inventory: Object.entries(p.inventory).map(([itemId, quantity]) => ({
          itemId,
          quantity,
        })),
        equipped: p.equipped,
        stats: calculateStats(p.equipped),
        bowCount: p.bowCount,
        gatherCount: p.gatherCount,
      },
    });
  const channelList = () => ({
    type: "channels",
    channels: CHANNELS.map((c) => ({
      ...c,
      count: channels.get(c.id).players.size,
      capacity,
    })),
  });
  const sendChannels = () => {
    const list = channelList();
    for (const ws of connections) send(ws, list);
  };
  function refreshRoster(p) {
    p.rosterVersion = (p.rosterVersion ?? 0) + 1;
    p.roster = {
      networkId: p.networkId,
      id: p.id,
      name: p.name,
      necklace: p.equipped.beads.slice(0, 8),
      beadCount: p.equipped.beads.length,
      cordId: p.equipped.cordId,
    };
  }
  // Compute rounded public coordinates and shared compact state once per channel/tick.
  function buildSnapshot(channel) {
    return {
      rows: [...channel.players.values()].map((p) => {
        const state = publicPlayer(p);
        return {
          player: p,
          state,
          roster: p.roster,
          key: `${p.networkId}:${p.rosterVersion}`,
          compact: [p.networkId, state.x, state.z, state.bowEndsAt],
        };
      }),
      nodes: channel.nodes.map((node, index) => [index, node.readyAt]),
      rituals: channel.rituals.map((ritual, index) => [
        index,
        ritual.progress,
        ritual.target,
        ritual.round,
      ]),
      legacyRituals: channel.rituals.map(
        ({ participants, ...ritual }) => ritual,
      ),
      packets: new Map(),
    };
  }
  function sendWorld(p, now = Date.now(), snapshot = null) {
    const channel = channels.get(p.channelId);
    const view = snapshot ?? buildSnapshot(channel);
    const visible = view.rows.filter(
      (row) => row.player.id === p.id || distance(row.player, p) <= 85,
    );
    const signature = visible.map((row) => row.key).join(",");
    const version = p.ws.gameProtocol;
    if (version === 2 && p.ws.rosterSignature !== signature) {
      // Never send a frame for unknown network IDs if backpressure skipped its roster.
      if (
        !send(p.ws, {
          type: "roster",
          players: visible.map((row) => row.roster),
        })
      )
        return;
      p.ws.rosterSignature = signature;
    }
    const packetKey = `${version}:${signature}`;
    let packet = view.packets.get(packetKey);
    if (!packet) {
      packet = JSON.stringify(
        version === 2
          ? {
              type: "frame",
              channelId: p.channelId,
              now,
              players: visible.map((row) => row.compact),
              nodes: view.nodes,
              rituals: view.rituals,
            }
          : {
              type: "world",
              channelId: p.channelId,
              now,
              players: visible.map((row) => row.state),
              nodes: channel.nodes,
              rituals: view.legacyRituals,
            },
      );
      view.packets.set(packetKey, packet);
    }
    send(p.ws, packet);
  }
  function award(p, ids, source) {
    const counts = {};
    for (const id of ids) {
      p.inventory[id] = (p.inventory[id] ?? 0) + 1;
      counts[id] = (counts[id] ?? 0) + 1;
    }
    persist(p);
    profile(p);
    const items = Object.entries(counts).map(([itemId, quantity]) => ({
      itemId,
      quantity,
    }));
    event(
      p.ws,
      "loot",
      "새로운 인연을 만났어요",
      items
        .map(({ itemId, quantity }) => `${ITEMS[itemId].name} ×${quantity}`)
        .join(" · "),
      { items, source },
    );
  }
  const rollItem = (channel, kind) => rollChannelItem(channel, kind, random);
  function finishBow(p, now) {
    const channel = channels.get(p.channelId);
    const hallId = p.bow.hallId;
    p.bow = null;
    p.bowCount += 1;
    const ritual = channel.rituals.find((r) => r.hallId === hallId);
    ritual.progress += 1;
    ritual.participants.add(p.id);
    event(
      p.ws,
      "bow-complete",
      "한 번의 절, 하나의 마음",
      "함께하는 108배에 마음을 더했어요.",
      { hallId },
    );
    if (random() < calculateStats(p.equipped).dropRate)
      award(p, [rollItem(channel, random() < 0.22 ? "cord" : "bead")], "bow");
    else {
      persist(p);
      profile(p);
    }
    if (ritual.progress >= ritual.target) {
      const participants = [...ritual.participants]
        .map((id) => channel.players.get(id))
        .filter(Boolean);
      broadcast(channel, {
        type: "event",
        kind: "ritual",
        title: "108개의 마음이 모였습니다",
        message: `${HALLS.find((h) => h.id === hallId).name}의 함께하는 수행이 완성됐어요. 참여한 모든 행자에게 염주알과 띠가 전해집니다.`,
        hallId,
      });
      for (const participant of participants)
        award(
          participant,
          [rollItem(channel, "bead"), rollItem(channel, "cord")],
          "ritual",
        );
      ritual.progress = 0;
      ritual.round += 1;
      ritual.participants.clear();
    }
  }
  function join(ws, message) {
    const channelId =
      message.channelId === undefined
        ? (ws.player?.channelId ?? 1)
        : message.channelId;
    if (!Number.isInteger(channelId) || !channels.has(channelId))
      return error(ws, "CHANNEL_INVALID", "올바른 채널을 선택해 주세요.");
    const destination = channels.get(channelId);
    if (ws.player?.channelId === channelId) {
      profile(ws.player);
      sendWorld(ws.player);
      return;
    }
    if (destination.players.size >= capacity)
      return error(
        ws,
        "CHANNEL_FULL",
        "이 채널은 108명의 인연으로 가득 찼어요. 다른 채널을 선택해 주세요.",
      );
    let p = ws.player;
    let token;
    if (!p) {
      const supplied =
        typeof message.token === "string" &&
        /^[a-f0-9]{64}$/.test(message.token)
          ? message.token
          : null;
      const stored = supplied ? loadPlayer.get(hash(supplied)) : null;
      const saved = stored ? JSON.parse(stored.profile) : null;
      if (saved && activeIds.has(saved.id))
        return error(
          ws,
          "SESSION_ACTIVE",
          "이 행자는 다른 창에서 수행 중이에요. 다른 창을 닫고 다시 연결해 주세요.",
        );
      token = saved ? supplied : randomBytes(32).toString("hex");
      p = {
        id: saved?.id ?? randomUUID(),
        tokenHash: hash(token),
        name:
          saved?.name ??
          (safeName(message.name) || `행자${randomInt(1000, 9999)}`),
        inventory: saved?.inventory ?? { hemp: 1, bamboo: 3, pine: 2 },
        equipped: saved?.equipped ?? {
          cordId: "hemp",
          beads: ["bamboo", "bamboo", "bamboo", "pine", "pine"],
        },
        bowCount: saved?.bowCount ?? 0,
        gatherCount: saved?.gatherCount ?? 0,
        ws,
        lastGather: 0,
        lastChat: 0,
        bow: null,
      };
      p.networkId = nextNetworkId++;
      refreshRoster(p);
      ws.player = p;
      activeIds.set(p.id, p);
      clearTimeout(ws.joinTimeout);
      send(ws, { type: "welcome", id: p.id, token });
    } else {
      const previous = channels.get(p.channelId);
      previous.players.delete(p.id);
      for (const ritual of previous.rituals) ritual.participants.delete(p.id);
    }
    ws.rosterSignature = null;
    p.channelId = channelId;
    p.x = SPAWN.x;
    p.z = SPAWN.z;
    p.target = { ...SPAWN };
    p.bow = null;
    destination.players.set(p.id, p);
    persist(p);
    profile(p);
    sendWorld(p);
    sendChannels();
    event(
      ws,
      "system",
      `${destination.name}에 오신 것을 환영해요`,
      `${destination.theme}에서 나만의 염주를 엮어 보세요.`,
    );
    for (const chat of destination.chat.slice(-10)) send(ws, chat);
  }
  function handle(ws, data) {
    let message;
    try {
      message = JSON.parse(data.toString());
    } catch {
      return error(ws, "MESSAGE_INVALID", "메시지를 읽을 수 없어요.");
    }
    if (!message || typeof message !== "object" || Array.isArray(message))
      return;
    const now = Date.now();
    const refill = (now - ws.bucketAt) * 0.04;
    ws.bucket = Math.min(60, ws.bucket + refill);
    ws.bucketAt = now;
    if (ws.bucket < 1) return;
    ws.bucket -= 1;
    if (message.type === "join") {
      if (!ws.gameProtocolSelected) {
        ws.gameProtocol = message.protocol === 2 ? 2 : 1;
        ws.gameProtocolSelected = true;
      }
      if (now - ws.lastJoin < 250)
        return error(ws, "JOIN_RATE", "잠시 뒤 다시 채널을 선택해 주세요.");
      ws.lastJoin = now;
      return join(ws, message);
    }
    const p = ws.player;
    if (!p) return error(ws, "JOIN_REQUIRED", "먼저 사찰에 입장해 주세요.");
    const channel = channels.get(p.channelId);
    if (message.type === "move") {
      if (!finitePoint(message))
        return error(ws, "MOVE_INVALID", "올바른 위치로 이동해 주세요.");
      p.target = {
        x: Math.max(-70, Math.min(70, message.x)),
        z: Math.max(-70, Math.min(70, message.z)),
      };
      if (p.bow && distance(p, p.target) > 0.7) {
        p.bow = null;
        event(ws, "system", "잠시 숨을 고릅니다", "움직여서 수행이 멈췄어요.");
      }
      return;
    }
    if (message.type === "gather") {
      const node = channel.nodes.find((n) => n.id === message.nodeId);
      if (!node)
        return error(ws, "NODE_INVALID", "그곳에는 채집할 것이 없어요.");
      if (distance(p, node) > 7)
        return error(ws, "TOO_FAR", "선물 가까이 다가가 주세요.");
      if (p.bow) return error(ws, "BUSY", "수행을 마친 뒤 채집해 주세요.");
      if (node.readyAt > now)
        return error(ws, "NODE_RESTING", "자연이 다시 선물을 준비하고 있어요.");
      if (now - p.lastGather < 1500)
        return error(ws, "SLOW_DOWN", "잠시 숨을 고른 뒤 다시 채집해 주세요.");
      node.readyAt = now + 25000;
      p.lastGather = now;
      p.gatherCount += 1;
      const ids = [rollItem(channel, random() < 0.23 ? "cord" : "bead")];
      if (random() < calculateStats(p.equipped).gatherBonus)
        ids.push(rollItem(channel, "bead"));
      award(p, ids, "gather");
      return;
    }
    if (message.type === "bow") {
      const hall = HALLS.find((h) => h.id === message.hallId);
      if (!hall)
        return error(ws, "HALL_INVALID", "수행할 법당을 선택해 주세요.");
      if (distance(p, hall) > hall.radius)
        return error(ws, "TOO_FAR", `${hall.name} 앞마당으로 다가가 주세요.`);
      if (p.bow) return error(ws, "BUSY", "이미 마음을 모으고 있어요.");
      const durationMs =
        options.bowDurationMs ?? calculateStats(p.equipped).bowDurationMs;
      p.target = { x: p.x, z: p.z };
      p.bow = { hallId: hall.id, endsAt: now + durationMs };
      event(
        ws,
        "bow-start",
        "마음을 모으는 중",
        `${hall.name}에서 정성스러운 절을 올립니다.`,
        { hallId: hall.id, durationMs },
      );
      return;
    }
    if (message.type === "equip") {
      const cord = ITEMS[message.cordId];
      if (!cord || cord.kind !== "cord" || !p.inventory[cord.id])
        return error(ws, "ITEM_NOT_OWNED", "보유한 염주띠를 선택해 주세요.");
      if (!Array.isArray(message.beads) || message.beads.length > cord.slots)
        return error(
          ws,
          "SLOTS_FULL",
          `이 띠에는 염주알을 ${cord.slots}개까지 엮을 수 있어요.`,
        );
      const required = {};
      for (const id of message.beads) {
        if (
          typeof id !== "string" ||
          !Object.hasOwn(ITEMS, id) ||
          ITEMS[id].kind !== "bead"
        )
          return error(ws, "ITEM_INVALID", "염주알을 선택해 주세요.");
        required[id] = (required[id] ?? 0) + 1;
      }
      if (
        Object.entries(required).some(
          ([id, count]) => count > (p.inventory[id] ?? 0),
        )
      )
        return error(
          ws,
          "ITEM_NOT_OWNED",
          "보유한 수량보다 많은 염주알을 엮을 수 없어요.",
        );
      p.equipped = { cordId: cord.id, beads: [...message.beads] };
      refreshRoster(p);
      persist(p);
      profile(p);
      event(
        ws,
        "system",
        "나만의 염주를 엮었어요",
        `${cord.name}에 ${message.beads.length}개의 마음을 담았습니다.`,
      );
      return;
    }
    if (message.type === "rename") {
      const name = safeName(message.name);
      if ([...name].length < 2)
        return error(ws, "NAME_INVALID", "이름은 2~12자로 적어 주세요.");
      p.name = name;
      refreshRoster(p);
      persist(p);
      profile(p);
      return;
    }
    if (message.type === "chat") {
      if (typeof message.text !== "string") return;
      const text = message.text
        .normalize("NFC")
        .replace(/[\x00-\x1f\x7f]/g, "")
        .trim()
        .slice(0, 160);
      if (!text) return;
      if (now - p.lastChat < 1200)
        return error(
          ws,
          "CHAT_RATE",
          "다른 행자의 말에도 잠시 귀 기울여 주세요.",
        );
      p.lastChat = now;
      const chat = {
        type: "event",
        kind: "chat",
        title: p.name,
        name: p.name,
        playerId: p.id,
        message: text,
      };
      channel.chat.push(chat);
      if (channel.chat.length > 30) channel.chat.shift();
      broadcast(channel, chat);
    }
  }

  const distRoot = resolve(options.distDir ?? "dist");
  const mime = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".webp": "image/webp",
    ".woff2": "font/woff2",
    ".ico": "image/x-icon",
  };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/api/health") {
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      return res.end(
        JSON.stringify({
          status: "ok",
          channels: channels.size,
          capacityPerChannel: capacity,
          players: activeIds.size,
          persistence: "sqlite",
        }),
      );
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405);
      return res.end();
    }
    let requestPath;
    try {
      requestPath = decodeURIComponent(url.pathname);
    } catch {
      res.writeHead(400);
      return res.end();
    }
    let file = resolve(distRoot, "." + requestPath);
    if (!file.startsWith(distRoot + sep) && file !== distRoot) {
      res.writeHead(403);
      return res.end();
    }
    if (!existsSync(file) || !statSync(file).isFile())
      file = resolve(distRoot, "index.html");
    if (!existsSync(file)) {
      res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("개발 모드: npm run dev / Production: npm run build");
    }
    res.writeHead(200, {
      "Content-Type": mime[extname(file)] ?? "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control":
        extname(file) === ".html" ? "no-cache" : "public,max-age=3600",
    });
    return res.end(req.method === "HEAD" ? undefined : readFileSync(file));
  });
  const wss = new WebSocketServer({
    server,
    path: "/ws",
    maxPayload: 4096,
    perMessageDeflate: false,
  });
  wss.on("connection", (ws) => {
    connections.add(ws);
    ws.bucket = 60;
    ws.bucketAt = Date.now();
    ws.lastJoin = 0;
    ws.alive = true;
    ws.gameProtocol = 1;
    ws.gameProtocolSelected = false;
    ws.rosterSignature = null;
    ws.joinTimeout = setTimeout(() => {
      if (!ws.player) ws.close(1008, "Join required");
    }, 15000);
    ws.on("pong", () => {
      ws.alive = true;
    });
    ws.on("message", (data) => {
      try {
        handle(ws, data);
      } catch (e) {
        console.error("Game message failed:", e.message);
        error(
          ws,
          "SERVER_ERROR",
          "잠시 연결이 흔들렸어요. 다시 시도해 주세요.",
        );
      }
    });
    ws.on("error", () => {});
    ws.on("close", () => {
      clearTimeout(ws.joinTimeout);
      connections.delete(ws);
      const p = ws.player;
      if (p) {
        persist(p);
        channels.get(p.channelId).players.delete(p.id);
        activeIds.delete(p.id);
        for (const channel of channels.values())
          for (const ritual of channel.rituals)
            ritual.participants.delete(p.id);
        sendChannels();
      }
    });
    send(ws, channelList());
  });
  let lastTick = Date.now();
  const tick = setInterval(() => {
    const now = Date.now();
    const dt = Math.min(0.25, (now - lastTick) / 1000);
    lastTick = now;
    for (const p of activeIds.values()) {
      if (p.bow) {
        if (now >= p.bow.endsAt) finishBow(p, now);
      } else {
        const d = distance(p, p.target),
          step = calculateStats(p.equipped).moveSpeed * dt;
        if (d > 0.03) {
          const ratio = Math.min(1, step / d);
          p.x += (p.target.x - p.x) * ratio;
          p.z += (p.target.z - p.z) * ratio;
        }
      }
    }
    for (const channel of channels.values()) {
      if (!channel.players.size) continue;
      const snapshot = buildSnapshot(channel);
      for (const p of channel.players.values()) sendWorld(p, now, snapshot);
    }
  }, 100);
  const channelTimer = setInterval(sendChannels, 5000);
  const heartbeat = setInterval(() => {
    for (const ws of connections) {
      if (!ws.alive) ws.terminate();
      else {
        ws.alive = false;
        ws.ping();
      }
    }
  }, 30000);
  async function listen(
    port = options.port ?? Number(process.env.PORT || 3001),
    host = options.host ?? "0.0.0.0",
  ) {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => {
        server.off("error", reject);
        resolve();
      });
    });
    return server.address();
  }
  async function close() {
    if (closed) return;
    closed = true;
    clearInterval(tick);
    clearInterval(channelTimer);
    clearInterval(heartbeat);
    for (const ws of connections) {
      clearTimeout(ws.joinTimeout);
      if (ws.player) persist(ws.player);
      ws.terminate();
    }
    await new Promise((resolve) => wss.close(resolve));
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    db.close();
  }
  return { server, wss, listen, close, channels };
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  const game = createGameServer();
  game
    .listen()
    .then((address) =>
      console.log(
        `Yumju server listening on ${address.port} · 10 channels / 108 players each`,
      ),
    );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => game.close().then(() => process.exit(0)));
}
