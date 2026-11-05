# ⬢ Hexhold

A 3D island-settling board game for 2–4 friends, built with **three.js + TypeScript**.
It runs entirely in the browser, so you don't need a backend.

## How multiplayer works without a server
- The player who clicks **Create game** is the *host*. Their browser runs the rules and holds the game state.
- Friends enter their name and the 5-letter room code (or open the shared link), then **Join**.
- Messages travel through free public MQTT relay servers over secure WebSockets (ordinary web traffic,
  so firewalls and mobile networks don't block it). The game connects to several relays at once
  (EMQX, HiveMQ, Mosquitto) and drops duplicates, so it keeps working if one relay is down.
- The host must keep their tab open. If the host reloads, they can click **Resume game** and everyone re-joins
  with the same name and code.
- The relays are public: anyone who guesses a room code could read that room's messages. Fine for casual games.
- URL options: `?p2p` uses direct peer-to-peer (WebRTC) instead, `?tabs` plays across tabs of one browser
  with no network, and `?broker=wss://your-server/mqtt` (repeatable) uses your own MQTT servers.

## Languages
English and Arabic (with a full right-to-left layout). Each player picks their own language with the
button in the lobby or the top bar; it's remembered per browser and defaults to Arabic on Arabic devices.
Game messages travel as language-neutral codes (`src/game/msg.ts`), so players in the same game can use
different languages. All texts live in `src/i18n.ts`.

## Run locally
```bash
npm install
npm run dev        # open the printed URL; others on your Wi-Fi can use the Network URL
```
Add `?tabs` to the URL to play across several tabs of one browser without networking (handy for testing).

## Deploy (free static hosting)
```bash
npm run build      # outputs static files to dist/
```
Upload `dist/` to GitHub Pages, Netlify (drag & drop), Vercel, Cloudflare Pages, etc. It must be served over
HTTPS (all of those do), because WebRTC requires it.

## Rules summary
First to **10 points** wins. Settlements are worth 1 point and cities 2. Longest Road (5+) and Strongest Guard (3+ Guards)
are worth 2 each, and Monument cards 1 each. Roll the dice and tiles with that number produce resources. A 7 wakes the Raider:
players with more than 7 cards discard half, and the Raider blocks a tile and steals a card. Trade 4:1 with the bank, 3:1 or 2:1 at harbours,
or make offers to the other players. Press **?** in game for the full rules.

## Code map
| Path | What |
|---|---|
| `src/game/types.ts` | state, actions, costs |
| `src/game/board.ts` | hex/vertex/edge geometry, random board generation |
| `src/game/rules.ts` | the rules engine (pure reducer, runs on the host) |
| `src/net/` | MQTT relay (default), PeerJS and BroadcastChannel transports; host & client sessions |
| `src/render/scene.ts` | three.js island, pieces, click targets |
| `src/render/effects.ts` | particle bursts, animated ocean, clouds |
| `src/ui/hud.ts` | HTML overlay: hand, buttons, trading, dialogs |
| `src/ui/chat.ts` | in-game chat, speech bubbles, emoji reactions |
| `src/i18n.ts` | English & Arabic texts, language switching, right-to-left |
| `scripts/simulate.ts` | `npm test` plays 300 random games to check the rules |
