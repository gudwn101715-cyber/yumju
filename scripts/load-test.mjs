import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";

// A localhost transport baseline, not a browser-rendering or Internet capacity proof.
if (process.argv.includes("--server")) {
  const { createGameServer } = await import("../server/index.js");
  const game = createGameServer({
    dbPath: ":memory:",
    port: 0,
    host: "127.0.0.1",
  });
  const address = await game.listen();
  let cpuStart,
    memoryPeak = process.memoryUsage().rss,
    sample;
  process.on("message", async (message) => {
    if (message.type === "measure") {
      cpuStart = process.cpuUsage();
      memoryPeak = process.memoryUsage().rss;
      sample = setInterval(() => {
        memoryPeak = Math.max(memoryPeak, process.memoryUsage().rss);
      }, 100);
      process.send({ type: "measuring" });
    }
    if (message.type === "metrics") {
      clearInterval(sample);
      process.send({
        type: "metrics",
        cpu: process.cpuUsage(cpuStart),
        rssBytes: process.memoryUsage().rss,
        peakRssBytes: memoryPeak,
      });
    }
    if (message.type === "close") {
      clearInterval(sample);
      await game.close();
      process.exit(0);
    }
  });
  process.send({ type: "ready", port: address.port });
} else {
  const protocol = process.env.PROTOCOL === "2" ? 2 : 1;
  const clients = [];
  const child = fork(fileURLToPath(import.meta.url), ["--server"], {
    stdio: ["ignore", "inherit", "inherit", "ipc"],
  });
  let mover;
  const waitFor = (type) =>
    new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.off("message", listener);
        reject(new Error(`Server ${type} timed out`));
      }, 15000);
      function listener(message) {
        if (message.type === type) {
          clearTimeout(timeout);
          child.off("message", listener);
          resolve(message);
        }
      }
      child.on("message", listener);
    });
  const percentile = (values, p) =>
    [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * p)];
  const mib = (bytes) => +(bytes / 1024 / 1024).toFixed(1);
  let measuring = false,
    worldBytes = 0,
    rosterBytes = 0,
    movementMessages = 0;
  const intervals = [],
    deliveryDelays = [],
    errors = [];
  try {
    const { port } = await waitFor("ready");
    await Promise.all(
      Array.from(
        { length: 108 },
        (_, index) =>
          new Promise((resolve, reject) => {
            const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
            const client = {
              ws,
              id: null,
              networkId: null,
              worldCount: 0,
              previousTime: null,
              moved: false,
              disconnected: false,
            };
            clients.push(client);
            const timeout = setTimeout(
              () => reject(new Error(`Client ${index} join timed out`)),
              15000,
            );
            ws.on("open", () =>
              ws.send(
                JSON.stringify({
                  type: "join",
                  protocol,
                  channelId: 1,
                  name: `검증${index + 1}`,
                }),
              ),
            );
            ws.on("error", reject);
            ws.on("close", () => {
              client.disconnected = true;
            });
            ws.on("message", (data) => {
              const message = JSON.parse(data);
              if (message.type === "error") errors.push(message.code);
              if (message.type === "welcome") client.id = message.id;
              if (message.type === "profile") {
                clearTimeout(timeout);
                resolve();
              }
              if (message.type === "roster") {
                client.networkId =
                  message.players.find((player) => player.id === client.id)
                    ?.networkId ?? client.networkId;
                if (measuring) rosterBytes += data.length;
              }
              if (!["world", "frame"].includes(message.type) || !measuring)
                return;
              client.worldCount += 1;
              worldBytes += data.length;
              if (client.previousTime !== null)
                intervals.push(message.now - client.previousTime);
              client.previousTime = message.now;
              deliveryDelays.push(Date.now() - message.now);
              const self =
                message.type === "frame"
                  ? message.players.find(
                      (player) => player[0] === client.networkId,
                    )
                  : message.players.find((player) => player.id === client.id);
              const x = message.type === "frame" ? self?.[1] : self?.x;
              const z = message.type === "frame" ? self?.[2] : self?.z;
              if (self && Math.hypot(x, z - 25) > 3) client.moved = true;
            });
          }),
      ),
    );
    // All start together, moving among nearby destinations (AoI includes the crowd).
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const measurementReady = waitFor("measuring");
    child.send({ type: "measure" });
    await measurementReady;
    measuring = true;
    const startedAt = Date.now();
    let tick = 0;
    mover = setInterval(() => {
      tick += 1;
      for (let index = 0; index < clients.length; index += 1) {
        const angle = (index / clients.length) * Math.PI * 2 + tick * 0.025;
        clients[index].ws.send(
          JSON.stringify({
            type: "move",
            x: Math.cos(angle) * 25,
            z: Math.sin(angle) * 25,
          }),
        );
        movementMessages += 1;
      }
    }, 100);
    await new Promise((resolve) => setTimeout(resolve, 10000));
    clearInterval(mover);
    measuring = false;
    const durationMs = Date.now() - startedAt;
    const metricsReady = waitFor("metrics");
    child.send({ type: "metrics" });
    const metrics = await metricsReady;
    assert.deepEqual(errors, [], "No server protocol errors during load");
    assert.ok(
      clients.every((client) => !client.disconnected),
      "Every client remains connected",
    );
    assert.ok(
      clients.every((client) => client.worldCount >= 50),
      "Every client receives meaningful ongoing snapshots",
    );
    assert.ok(
      clients.every((client) => client.moved),
      "Every client moves through authoritative simulation",
    );
    const report = {
      scope:
        "One local Node server process, one 108-player channel, separate Node client process; in-memory SQLite; no browser rendering or Internet latency.",
      protocol,
      durationMs,
      connectedClients: clients.length,
      configuredMovementMessagesPerSecond: 1080,
      actualMovementMessagesPerSecond: +(
        movementMessages /
        (durationMs / 1000)
      ).toFixed(1),
      worldFrames: clients.reduce((sum, client) => sum + client.worldCount, 0),
      minimumWorldFramesPerClient: Math.min(
        ...clients.map((client) => client.worldCount),
      ),
      snapshotIntervalMs: {
        p50: percentile(intervals, 0.5),
        p95: percentile(intervals, 0.95),
        max: Math.max(...intervals),
      },
      serverToClientDelayMs: {
        p50: percentile(deliveryDelays, 0.5),
        p95: percentile(deliveryDelays, 0.95),
        max: Math.max(...deliveryDelays),
      },
      aggregateWorldMiBPerSecond: +(
        mib(worldBytes) /
        (durationMs / 1000)
      ).toFixed(2),
      aggregateRosterMiBPerSecond: +(
        mib(rosterBytes) /
        (durationMs / 1000)
      ).toFixed(2),
      aggregateWorldAndRosterMiBPerSecond: +(
        mib(worldBytes + rosterBytes) /
        (durationMs / 1000)
      ).toFixed(2),
      serverRssMiB: mib(metrics.rssBytes),
      serverPeakRssMiB: mib(metrics.peakRssBytes),
      serverCpuSeconds: +(
        (metrics.cpu.user + metrics.cpu.system) /
        1e6
      ).toFixed(3),
      disconnectedClients: clients.filter((client) => client.disconnected)
        .length,
      note: "A short development baseline; does not certify 1,080-player production capacity or persistent-disk performance.",
    };
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error("Local load verification failed:", error.message);
    process.exitCode = 1;
  } finally {
    clearInterval(mover);
    for (const client of clients) client.ws.terminate();
    if (child.connected) child.send({ type: "close" });
    const cleanup = setTimeout(() => child.kill("SIGTERM"), 3000);
    child.once("exit", () => clearTimeout(cleanup));
  }
}
