import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { HALLS, NODES } from "../shared/catalog.js";

const baseURL = process.env.BASE_URL || "http://127.0.0.1:5173";
const output = new URL("../test-results/", import.meta.url);
await mkdir(output, { recursive: true });
const executablePath =
  process.env.CHROMIUM_PATH ||
  (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);
const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--enable-unsafe-swiftshader",
  ],
});
const errors = [];

function watch(page) {
  const state = {
    welcome: null,
    profile: null,
    world: null,
    channels: null,
    events: [],
    errors: [],
    sent: [],
  };
  let roster = new Map();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("websocket", (socket) => {
    socket.on("framereceived", ({ payload }) => {
      let message;
      try {
        message = JSON.parse(String(payload));
      } catch {
        return;
      }
      if (message.type === "welcome") state.welcome = message;
      if (message.type === "profile") state.profile = message.player;
      if (message.type === "world") state.world = message;
      if (message.type === "roster")
        roster = new Map(
          message.players.map((player) => [player.networkId, player]),
        );
      if (message.type === "frame") {
        const readiness = new Map(message.nodes);
        state.world = {
          channelId: message.channelId,
          now: message.now,
          players: message.players.map(([networkId, x, z, bowEndsAt]) => ({
            ...roster.get(networkId),
            x,
            z,
            bowEndsAt,
            bowing: bowEndsAt > message.now,
          })),
          nodes: NODES.map((node, index) => ({
            ...node,
            readyAt: readiness.get(index) || 0,
          })),
          rituals: message.rituals.map(([index, progress, target, round]) => ({
            hallId: HALLS[index].id,
            progress,
            target,
            round,
          })),
        };
      }
      if (message.type === "channels") state.channels = message.channels;
      if (message.type === "event") state.events.push(message);
      if (message.type === "error") state.errors.push(message);
    });
    socket.on("framesent", ({ payload }) => {
      try {
        state.sent.push(JSON.parse(String(payload)));
      } catch {
        /* Ignore Vite heartbeats. */
      }
    });
  });
  return state;
}

async function until(predicate, description, timeout = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${description}`);
}

function position(state) {
  return state.world?.players.find((player) => player.id === state.welcome?.id);
}

function inventoryCount(state) {
  return state.profile.inventory.reduce((sum, item) => sum + item.quantity, 0);
}

try {
  const firstContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const secondContext = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const first = await firstContext.newPage();
  const second = await secondContext.newPage();
  const one = watch(first);
  const two = watch(second);
  await first.goto(baseURL, { waitUntil: "networkidle" });
  await until(
    () => one.welcome && one.profile && one.world,
    "first player joins",
  );
  await first.getByText("염주 온라인", { exact: true }).first().waitFor();
  await first.locator("canvas").waitFor();
  await until(() => one.channels?.length === 10, "ten channel definitions");
  assert.ok(
    one.channels.every((channel) => channel.capacity === 108),
    "Each logical channel limits players to 108",
  );
  assert.ok(
    one.profile.inventory.length >= 3,
    "Starter inventory is available",
  );
  assert.ok(
    one.profile.equipped.beads.length > 0,
    "Starter necklace is equipped",
  );

  await second.goto(baseURL, { waitUntil: "networkidle" });
  await until(
    () => two.welcome && two.profile && two.world,
    "second player joins",
  );
  assert.notEqual(
    one.welcome.id,
    two.welcome.id,
    "Separate contexts receive distinct guest identities",
  );
  await until(
    () => one.world.players.some((player) => player.id === two.welcome.id),
    "first player sees second",
  );
  await until(
    () => two.world.players.some((player) => player.id === one.welcome.id),
    "second player sees first",
  );
  console.log(
    "PASS: rendered 3D game, ten 108-seat channels, and two real browser players",
  );

  await first.screenshot({
    path: new URL("desktop.png", output).pathname,
    fullPage: true,
  });

  await first.locator('[data-action="catalog"]').first().click();
  assert.equal(
    await first.locator("[data-catalog-item]").count(),
    16,
    "Catalog renders ten beads and six cords",
  );
  await first.keyboard.press("Escape");
  await first.getByRole("button", { name: "도움말", exact: true }).click();
  await first.getByRole("button", { name: /나의 산사 생활 시작하기/ }).click();
  await first.locator('[data-action="profile"]').first().click();
  await first.locator("#name-input").fill("고요한행자");
  await first.getByRole("button", { name: /이 이름으로 머무르기/ }).click();
  await until(
    () => one.profile.name === "고요한행자",
    "profile name changes on server",
  );
  await until(
    () =>
      two.world.players.find((player) => player.id === one.welcome.id)?.name ===
      "고요한행자",
    "other player sees updated name",
  );
  console.log(
    "PASS: complete item catalog, guide, and synchronized player rename",
  );

  await first.locator(".avatar-label.self").click();
  await first.locator(".showcase-list article").nth(1).waitFor();
  await first.waitForTimeout(1300);
  await first.getByRole("button", { name: "메뉴 닫기", exact: true }).click();
  assert.ok(
    await first.locator("#modal-backdrop").isHidden(),
    "Showcase close control remains usable after live refresh",
  );
  console.log("PASS: live necklace showcase and stable close control");

  await first.getByTestId("channel-button").click();
  assert.equal(
    await first.locator("[data-join-channel]").count(),
    10,
    "Channel picker renders all ten destinations",
  );
  await first.locator('[data-join-channel="2"]').click();
  await until(
    () => one.profile.channelId === 2 && one.world.channelId === 2,
    "channel switch through picker",
  );
  await until(
    () => !two.world.players.some((player) => player.id === one.welcome.id),
    "other channel hides switched player",
  );
  assert.ok(
    (await first.locator("#scene-name").textContent()).includes("송림사"),
    "Channel theme label updates",
  );
  await first.waitForTimeout(900); // Server intentionally throttles channel changes.
  await first.getByTestId("channel-button").click();
  await first.locator('[data-join-channel="1"]').click();
  await until(
    () => one.profile.channelId === 1 && one.world.channelId === 1,
    "return to original channel",
  );
  await until(
    () => two.world.players.some((player) => player.id === one.welcome.id),
    "player returns to peer world",
  );
  console.log(
    "PASS: channel picker, isolation, theme update, and returning presence",
  );

  const starterBeads = one.profile.equipped.beads.length;
  await first.getByTestId("inventory-button").click();
  await first.locator('[data-select-item="bamboo"]').click();
  await first
    .getByRole("button", { name: "염주알 한 알 빼기", exact: true })
    .click();
  await until(
    () => one.profile.equipped.beads.length === starterBeads - 1,
    "bead removal updates equipped profile",
  );
  await first.getByRole("button", { name: /염주알 끼우기/ }).click();
  await until(
    () => one.profile.equipped.beads.length === starterBeads,
    "bead equip updates equipped profile",
  );
  await first.keyboard.press("Escape");
  console.log(
    "PASS: inventory selection, bead removal, and re-equipping through UI",
  );

  const start = position(one);
  await first.keyboard.down("w");
  await first.waitForTimeout(900);
  await first.keyboard.up("w");
  await until(() => {
    const current = position(one);
    return current && Math.hypot(current.x - start.x, current.z - start.z) > 1;
  }, "keyboard movement reaches the authoritative world");
  console.log("PASS: keyboard movement synchronized through game server");

  const beforeGather = inventoryCount(one);
  const priorLootEvents = one.events.filter(
    (event) => event.kind === "loot",
  ).length;
  await first.getByTestId("gather-button").click();
  await until(
    () =>
      inventoryCount(one) > beforeGather &&
      one.events.filter((event) => event.kind === "loot").length >
        priorLootEvents,
    "gather UI travels and rewards player inventory with loot event",
    25_000,
  );
  console.log(
    "PASS: authoritative travel, resource gathering, and inventory reward",
  );

  const previousBows = one.profile.bowCount;
  const previousProgress = one.world.rituals.find(
    (ritual) => ritual.hallId === "main",
  ).progress;
  await first.getByTestId("bow-button").click();
  await until(
    () => one.profile.bowCount > previousBows,
    "bow UI travels and timed bow completes",
    25_000,
  );
  await until(
    () =>
      one.world.rituals.find((ritual) => ritual.hallId === "main").progress !==
      previousProgress,
    "cooperative ritual gains contribution",
  );
  console.log("PASS: timed bow and shared ritual contribution");

  const chat = `고요한 산사에서 ${Date.now()}`;
  await first.getByTestId("chat-input").fill(chat);
  await first.getByTestId("chat-send").click();
  await until(
    () =>
      two.events.some(
        (event) => event.kind === "chat" && event.message === chat,
      ),
    "chat arrives at another real browser",
  );
  await second.getByText(chat, { exact: true }).waitFor();
  console.log("PASS: real-time channel chat");

  const playerId = one.welcome.id;
  const savedInventory = inventoryCount(one);
  one.welcome = null;
  one.profile = null;
  await first.reload({ waitUntil: "networkidle" });
  await until(() => one.welcome && one.profile, "guest reconnect after reload");
  assert.equal(one.welcome.id, playerId, "Guest identity survives reload");
  assert.equal(
    inventoryCount(one),
    savedInventory,
    "Inventory survives reload",
  );
  console.log("PASS: guest identity and collected inventory survive reload");

  await first.setViewportSize({ width: 390, height: 844 });
  await first.waitForTimeout(800);
  await first.screenshot({
    path: new URL("mobile.png", output).pathname,
    fullPage: true,
  });
  assert.ok(
    await first.locator("canvas").isVisible(),
    "3D canvas remains visible on mobile",
  );
  const overflow = await first.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  assert.equal(
    overflow,
    false,
    "Mobile viewport has no horizontal document overflow",
  );
  assert.deepEqual(errors, [], "No browser JavaScript exceptions");
  console.log("PASS: mobile layout and no browser JavaScript exceptions");
  await firstContext.close();
  await secondContext.close();
  console.log(
    "All browser smoke checks passed. Screenshots: test-results/desktop.png, test-results/mobile.png",
  );
} catch (error) {
  console.error("Browser smoke failed:", error.message);
  if (errors.length) console.error("Browser exceptions:", errors.join("\n"));
  process.exitCode = 1;
} finally {
  await browser.close();
}
