# YUMJU realtime protocol

Connect `/ws` (Vite proxies this to port 3001). All messages are JSON objects with `type`.

Client messages:

- `join {token?, name?, channelId?}`: channel integer 1–10, default 1. Token persisted in localStorage; absent token creates a player. Calling join again switches channel atomically. Names 2–12 visible characters.
- `move {x,z}`: sets movement target, not a teleport. Server advances at the equipped movement speed, 10Hz, within [-70,70].
- `gather {nodeId}`: stand within 7 world units of a ready resource node.
- `bow {hallId}`: stand within hall radius; timed single bow. Movement interrupts. On completion, one contribution and chance for a personal drop; at 108, current connected contributors receive a bead AND a cord. Frontend may implement repeat by sending again after bow completion.
- `equip {cordId, beads:[itemId...]}`: replaces loadout; all items must be owned, duplicates consume owned quantity, bead count <= cord slots. Cord and beads are not destroyed.
- `chat {text}`: channel message, max 160 characters.
- `rename {name}`: updates visible name.

Server messages:

- `welcome {id,token}`: store token securely as the local guest identity; no account or cross-device auth in this prototype.
- `profile {player}`: player has id,name,channelId,x,z,inventory:[{itemId,quantity}],equipped:{cordId,beads:[itemId]},stats:{moveSpeed,bowDurationMs,dropRate,gatherBonus,slots,moveBonus,bowBonus,dropBonus},bowCount,gatherCount. Sent on join, loot, equip, completed bow/gather, rename.
- `world {channelId, players, nodes, rituals, now}`: 10Hz snapshot. players:[{id,name,x,z,bowing,bowEndsAt,necklace:[itemId],cordId}], nodes:[{...NODES,readyAt}], rituals:[{hallId,progress,target:108,round}]. Other players farther than 85 world units are omitted. World self position remains authoritative. readyAt epoch ms; 0 means ready.
- `channels {channels}`: all 10 shared channel definitions plus count,capacity (108). Join and every 5s.
- `event {kind,title,message,items?,hallId?,durationMs?,name?,playerId?}`: kinds loot,bow-start,bow-complete,ritual,chat,system. items:[{itemId,quantity}].
- `error {code,message}`: localized actionable reason.

Shared constants: `CHANNELS, ITEMS` (object by id), `ITEM_LIST`, `HALLS`, `NODES`, `SPAWN`, `GRADES`, `WORLD_SIZE`, `CHANNEL_CAPACITY`, `calculateStats`, `gradeLabel`, `itemName`.

The server owns inventory, speed, channel limits, random drops, cooldowns and ritual contributions. Client clock/position/inventory never grants rewards. Current channel world is in memory; player inventory/loadouts/counters persist in `data/yumju.sqlite`. Tokens are random bearer guest identities, stored as SHA256 hashes by SQLite. Do not expose tokens in chat or logs.

Channel metadata now includes `dropPools: {beadIds:[itemId...],cordIds:[itemId...]}`. These are exclusive eligibility lists; `favored`/`featuredItems` are the subset with 3× relative weight. Grade weights are normalized within the eligible pool and are not absolute item drop percentages. Rapid joins (<250ms) emit explicit `JOIN_RATE` instead of silently ignoring the action. Displayed move/bow/drop bonuses are clamped to their effective caps.

## Compact protocol v2

The first `join` may include `protocol:2`. Omission selects the legacy v1 `world` snapshots. The selected version is retained for the connection, including channel switches that omit the field. The browser client uses v2.

- `roster {players:[{networkId,id,name,necklace,beadCount,cordId}]}`: full currently visible roster, sent only when visible membership or public name/equipment changes. It always precedes any frame referencing a newly visible ID. `networkId` is a process-local monotonically assigned integer, not an identity credential. It remains the same when the player switches channels but changes on reconnect.
- `frame {channelId,now,players:[[networkId,x,z,bowEndsAt]],nodes:[[nodeIndex,readyAt]],rituals:[[hallIndex,progress,target,round]]}`: 10Hz numeric state. A positive future bowEndsAt means bowing. Indices refer to the shared NODES and HALLS order. Merge player metadata by networkId from the most recent roster to reconstruct a world view.

Roster and frame delivery share the same ordered WebSocket stream. Under send-buffer backpressure, the server does not mark a skipped roster as known and skips its frame. Public positions are rounded once per player per channel tick. Frames are serialized once per identical visible roster, reusing the payload for observers with the same view.
