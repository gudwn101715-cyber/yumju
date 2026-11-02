import test from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGameServer, rollChannelItem } from "./index.js";
import { calculateStats, ITEMS, CHANNELS } from "../shared/catalog.js";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function connect(port, message = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const messages = [];
  ws.on("message", (value) => messages.push(JSON.parse(value.toString())));
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  const client = {
    ws,
    messages,
    send: (message) => ws.send(JSON.stringify(message)),
    async wait(predicate, timeout = 5000) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const i = messages.findIndex(predicate);
        if (i >= 0) return messages.splice(i, 1)[0];
        await delay(15);
      }
      throw new Error(
        `Timed out waiting for ${predicate.toString()}. Last messages: ${JSON.stringify(messages.slice(-3))}`,
      );
    },
    close: () =>
      new Promise((resolve) => {
        if (ws.readyState === WebSocket.CLOSED) resolve();
        else {
          ws.once("close", resolve);
          ws.close();
        }
      }),
  };
  client.send({ type: "join", ...message });
  return client;
}
async function setup(t, options = {}) {
  const game = createGameServer({ port: 0, dbPath: ":memory:", ...options });
  t.after(() => game.close());
  const { port } = await game.listen();
  return { game, port };
}

test("item stats honor cord capacity and all 10 channels have distinct themed drops", () => {
  assert.equal(CHANNELS.length, 10);
  assert.equal(new Set(CHANNELS.map((c) => c.theme)).size, 10);
  assert.equal(ITEMS.vajra.slots, 36);
  const base = calculateStats({ cordId: "hemp", beads: [] });
  const built = calculateStats({
    cordId: "silk",
    beads: ["sandalwood", "ebony", "lignum"],
  });
  assert.ok(built.dropRate > base.dropRate);
  assert.ok(built.bowDurationMs < base.bowDurationMs);
  assert.ok(built.moveSpeed > base.moveSpeed);
  assert.equal(
    calculateStats({ cordId: "hemp", beads: Array(100).fill("ebony") })
      .bowDurationMs,
    calculateStats({ cordId: "hemp", beads: Array(8).fill("ebony") })
      .bowDurationMs,
  );
});

test("atomic channel capacity and independent channels, plus duplicate-session rejection", async (t) => {
  const { port } = await setup(t, { capacity: 2 });
  const a = await connect(port, { name: "첫행자" });
  const identity = await a.wait((m) => m.type === "welcome");
  const b = await connect(port, { name: "둘행자" });
  await b.wait((m) => m.type === "welcome");
  const full = await connect(port);
  assert.equal(
    (await full.wait((m) => m.type === "error")).code,
    "CHANNEL_FULL",
  );
  full.send({ type: "join", channelId: 2 });
  assert.equal((await full.wait((m) => m.type === "error")).code, "JOIN_RATE");
  await delay(270);
  full.send({ type: "join", channelId: 2 });
  assert.equal(
    (await full.wait((m) => m.type === "profile")).player.channelId,
    2,
  );
  const duplicate = await connect(port, {
    token: identity.token,
    channelId: 2,
  });
  assert.equal(
    (await duplicate.wait((m) => m.type === "error")).code,
    "SESSION_ACTIVE",
  );
  const health = await (
    await fetch(`http://127.0.0.1:${port}/api/health`)
  ).json();
  assert.equal(health.players, 3);
  await Promise.all([a.close(), b.close(), full.close(), duplicate.close()]);
});

test("server owns movement, distance checks, gathering cooldown and equipment quantity", async (t) => {
  const { port } = await setup(t, { random: () => 0.5 });
  const a = await connect(port, { name: "숲행자" });
  await a.wait((m) => m.type === "profile");
  a.send({ type: "gather", nodeId: "bamboo-east" });
  assert.equal((await a.wait((m) => m.type === "error")).code, "TOO_FAR");
  a.send({ type: "move", x: 999, z: 999 });
  await delay(200);
  const limited = await a.wait((m) => m.type === "world" && m.players[0].x > 0);
  assert.ok(
    limited.players[0].x < 5,
    "movement target must not teleport a player",
  );
  a.send({ type: "move", x: 24, z: 20 });
  await a.wait(
    (m) =>
      m.type === "world" &&
      Math.hypot(m.players[0].x - 24, m.players[0].z - 20) < 6,
    4500,
  );
  a.send({ type: "gather", nodeId: "bamboo-east" });
  const loot = await a.wait((m) => m.type === "event" && m.kind === "loot");
  assert.equal(loot.items.length, 1);
  assert.ok(
    [
      ...CHANNELS[0].dropPools.beadIds,
      ...CHANNELS[0].dropPools.cordIds,
    ].includes(loot.items[0].itemId),
  );
  a.send({ type: "gather", nodeId: "bamboo-east" });
  assert.equal((await a.wait((m) => m.type === "error")).code, "NODE_RESTING");
  a.send({ type: "equip", cordId: "hemp", beads: Array(8).fill("lignum") });
  assert.equal(
    (await a.wait((m) => m.type === "error")).code,
    "ITEM_NOT_OWNED",
  );
  a.send({ type: "equip", cordId: "hemp", beads: Array(9).fill("bamboo") });
  assert.equal((await a.wait((m) => m.type === "error")).code, "SLOTS_FULL");
  a.send({ type: "equip", cordId: "hemp", beads: ["pine", "pine"] });
  const equipped = await a.wait(
    (m) => m.type === "profile" && m.player.equipped.beads.length === 2,
  );
  assert.equal(equipped.player.stats.slots, 8);
  await a.close();
});

test("cooperative timed bows award a bead AND cord to every connected contributor", async (t) => {
  const { port } = await setup(t, {
    ritualTarget: 2,
    bowDurationMs: 50,
    random: () => 0.5,
  });
  const a = await connect(port, { name: "함께행자" });
  const b = await connect(port, { name: "나란행자" });
  await a.wait((m) => m.type === "profile");
  await b.wait((m) => m.type === "profile");
  for (const c of [a, b]) c.send({ type: "move", x: 0, z: -2 });
  for (const c of [a, b])
    await c.wait(
      (m) => m.type === "world" && m.players.some((p) => p.z <= 1),
      4000,
    );
  a.send({ type: "bow", hallId: "main" });
  await a.wait((m) => m.type === "event" && m.kind === "bow-complete");
  b.send({ type: "bow", hallId: "main" });
  for (const c of [a, b]) {
    const loot = await c.wait(
      (m) => m.type === "event" && m.kind === "loot" && m.source === "ritual",
    );
    assert.equal(loot.items.length, 2);
    assert.deepEqual(
      new Set(loot.items.map((i) => ITEMS[i.itemId].kind)),
      new Set(["bead", "cord"]),
    );
  }
  const world = await a.wait(
    (m) => m.type === "world" && m.rituals[0].round === 2,
  );
  assert.equal(world.rituals[0].progress, 0);
  await Promise.all([a.close(), b.close()]);
});

test("SQLite preserves player identity, counters and equipped beads after process restart", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "yumju-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const dbPath = join(directory, "game.sqlite");
  const first = createGameServer({ dbPath, port: 0 });
  t.after(() => first.close());
  const firstAddress = await first.listen();
  const a = await connect(firstAddress.port, { name: "다시온행자" });
  const identity = await a.wait((m) => m.type === "welcome");
  await a.wait((m) => m.type === "profile");
  a.send({ type: "equip", cordId: "hemp", beads: ["pine"] });
  await a.wait(
    (m) => m.type === "profile" && m.player.equipped.beads.length === 1,
  );
  await a.close();
  await first.close();
  const second = createGameServer({ dbPath, port: 0 });
  t.after(() => second.close());
  const secondAddress = await second.listen();
  const b = await connect(secondAddress.port, { token: identity.token });
  const restored = await b.wait((m) => m.type === "profile");
  assert.equal(restored.player.id, identity.id);
  assert.equal(restored.player.name, "다시온행자");
  assert.deepEqual(restored.player.equipped.beads, ["pine"]);
  assert.equal(
    restored.player.inventory.find((i) => i.itemId === "bamboo").quantity,
    3,
  );
  await b.close();
});

test("default server admits exactly 108 simultaneous players and rejects the 109th", async (t) => {
  const { port } = await setup(t);
  const clients = await Promise.all(
    Array.from({ length: 108 }, (_, index) =>
      connect(port, { name: `행자${index + 1}` }),
    ),
  );
  await Promise.all(
    clients.map((client) => client.wait((m) => m.type === "welcome")),
  );
  const extra = await connect(port, { name: "다음행자" });
  assert.equal(
    (await extra.wait((m) => m.type === "error")).code,
    "CHANNEL_FULL",
  );
  const health = await (
    await fetch(`http://127.0.0.1:${port}/api/health`)
  ).json();
  assert.equal(health.players, 108);
  assert.equal(health.capacityPerChannel, 108);
  await Promise.all([...clients, extra].map((client) => client.close()));
});

test("channel drop eligibility differs by theme and every collectible is obtainable somewhere", () => {
  const obtainable = new Set();
  const signatures = new Set();
  for (const channel of CHANNELS) {
    signatures.add(JSON.stringify(channel.dropPools));
    for (const kind of ["bead", "cord"]) {
      const ids =
        kind === "bead" ? channel.dropPools.beadIds : channel.dropPools.cordIds;
      assert.ok(ids.length >= 2);
      for (const id of ids) {
        assert.equal(ITEMS[id].kind, kind);
        obtainable.add(id);
      }
      for (const value of [0, 0.25, 0.5, 0.75, 0.99, 0.999999]) {
        assert.ok(
          ids.includes(rollChannelItem(channel, kind, () => value)),
          "reward must stay inside the channel pool",
        );
      }
    }
  }
  assert.equal(signatures.size, 10);
  assert.deepEqual(obtainable, new Set(Object.keys(ITEMS)));
  assert.ok(!CHANNELS[0].dropPools.beadIds.includes("ebony"));
  assert.ok(CHANNELS[7].dropPools.beadIds.includes("ebony"));
});

test("displayed equipment bonuses equal the effective movement, bow and drop caps", () => {
  const stats = calculateStats({
    cordId: "vajra",
    beads: Array(36).fill("bodhi"),
  });
  assert.equal(stats.moveBonus, 0.65);
  assert.equal(stats.moveSpeed, 10 * (1 + stats.moveBonus));
  assert.equal(stats.bowDurationMs, Math.round(3000 / (1 + stats.bowBonus)));
  assert.equal(stats.dropBonus, 0.5);
  assert.equal(stats.dropRate, 0.3 + stats.dropBonus);
});

test("v2 sends compact frames and updates visible roster only when player metadata changes", async (t) => {
  const { port } = await setup(t);
  const a = await connect(port, { name: "압축행자", protocol: 2 });
  const identity = await a.wait((m) => m.type === "welcome");
  const firstRoster = await a.wait((m) => m.type === "roster");
  const self = firstRoster.players.find((p) => p.id === identity.id);
  assert.ok(Number.isInteger(self.networkId));
  const firstFrame = await a.wait((m) => m.type === "frame");
  assert.deepEqual(firstFrame.players[0], [self.networkId, 0, 25, 0]);
  assert.equal(firstFrame.nodes[0].length, 2);
  assert.equal(firstFrame.rituals[0].length, 4);
  await delay(240);
  assert.equal(
    a.messages.filter((m) => m.type === "roster").length,
    0,
    "unchanged roster is not repeated each tick",
  );
  assert.equal(
    a.messages.filter((m) => m.type === "world").length,
    0,
    "v2 receives no legacy world snapshots",
  );
  const b = await connect(port, { name: "옛방식행자" });
  const otherIdentity = await b.wait((m) => m.type === "welcome");
  assert.equal(
    (await b.wait((m) => m.type === "world")).players.length,
    2,
    "default v1 remains compatible",
  );
  const joinedRoster = await a.wait(
    (m) => m.type === "roster" && m.players.length === 2,
  );
  assert.ok(joinedRoster.players.some((p) => p.id === otherIdentity.id));
  a.send({ type: "rename", name: "바뀐행자" });
  const renamed = await a.wait(
    (m) => m.type === "roster" && m.players.some((p) => p.name === "바뀐행자"),
  );
  assert.equal(
    renamed.players.find((p) => p.id === identity.id).networkId,
    self.networkId,
  );
  a.send({ type: "equip", cordId: "hemp", beads: ["pine"] });
  const equipped = await a.wait(
    (m) =>
      m.type === "roster" &&
      m.players.some((p) => p.id === identity.id && p.beadCount === 1),
  );
  assert.deepEqual(
    equipped.players.find((p) => p.id === identity.id).necklace,
    ["pine"],
  );
  await delay(260);
  a.send({ type: "join", channelId: 2 });
  const switched = await a.wait((m) => m.type === "frame" && m.channelId === 2);
  assert.equal(
    switched.players[0][0],
    self.networkId,
    "channel switch preserves session network ID and v2",
  );
  const switchedRoster = await a.wait(
    (m) => m.type === "roster" && m.players.length === 1,
  );
  assert.equal(switchedRoster.players[0].id, identity.id);
  await Promise.all([a.close(), b.close()]);
});
