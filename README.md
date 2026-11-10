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

## Spectators & voice chat
- Anyone who joins with the room code after the game has started (or when 4 players are already in)
  becomes a **spectator**: they see the live board, log, animations and chat, can chat, but can't act.
  A player who drops out and rejoins with the same name gets their seat back.
- **Voice chat** is off by default. Tap 🎤 to go live, tap again to mute; 🔊/🔇 silences everyone else.
  Speech is sent in short pieces through the same relay as the game (no extra servers, works where the
  game works), so expect about a second of delay — like a walkie-talkie. The browser asks for microphone
  permission the first time.

## Playing together
- **Reactions:** tap 😀, pick an emoji, then tap a player or any spot on the island to throw it
  (tomatoes leave a splat for a few seconds).
- **Counter-offers:** answer a trade offer with your own terms; the whole table sees the counters and the
  player who offered can accept one.
- **Presence:** each panel shows what that player is doing (trading…, typing…, picking a road spot…), and
  everyone sees where the active player is pointing on the board.

## Sound
All sound effects are synthesized in the browser with the Web Audio API (no audio files): dice rattle and
bounces, a rumble on 7s, card flicks, building knocks and chimes, coins for trades, a swish for steals, turn
chimes, award and victory fanfares, chat pops, reaction whooshes and splats, soft button clicks, and a quiet
ocean ambience in the 3D view. 🔔/🔕 in the top bar turns sound on or off (remembered).

## Game recap
When someone wins, a recap opens (reopen it any time with 📊): final standings with a points breakdown, every
player's revealed hand and fortune cards, a dice chart (each total vs. how often it should come up, most
rolled, sevens, never rolled), points over time, fun awards (luckiest, robber baron, most robbed, trade master,
road builder, knight commander…) and a full stats table. The rules engine records these numbers as the game is
played (`stats` in the game state).

## Two board views
The 3D island is the default. The 🗺️ button in the top bar switches to a **classic flat board**: illustrated,
printed-style tiles (our own artwork, painted in code) in a sea frame on a wooden table, seen from straight above.
🧊 switches back. Everything (building, dice, animations, reactions) works in both; the choice is remembered.

## Install as an app
The site is a Progressive Web App: on Android/desktop Chrome or Edge use the **📲 Install app** button in the
lobby (or the browser menu); on iPhone/iPad open it in Safari → Share → **Add to Home Screen**. It then opens
full screen from the home screen like a normal app.

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
| `src/render/tiles.ts` | detailed terrain tiles (forests, windmills, mountains, mines, oasis…) |
| `src/render/island.ts` | beach, shallows, surf, palms, lighthouse, boats, seagulls |
| `src/render/classic.ts` | the classic flat board view: painted tiles, sea frame, table |
| `src/render/social.ts` | thrown emoji reactions and other players' pointers |
| `src/render/effects.ts` | particle bursts, animated ocean, clouds |
| `src/ui/hud.ts` | HTML overlay: hand, buttons, trading, dialogs |
| `src/ui/voice.ts` | walkie-talkie voice chat over the relay |
| `src/ui/recap.ts` | post-game recap: standings, final hands, charts, awards, stats |
| `src/ui/sound.ts` | synthesized sound effects and ocean ambience |
| `src/ui/chat.ts` | in-game chat, speech bubbles, emoji reactions |
| `src/i18n.ts` | English & Arabic texts, language switching, right-to-left |
| `scripts/simulate.ts` | `npm test` plays 300 random games to check the rules |
