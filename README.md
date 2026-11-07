 Jamster

A mobile first, real time music timeline party game. Jamster currently runs with a small mock song deck and simulated playback so a room can play without any music account. A host opens a room, shares its six character code or join link, starts each round, then reveals the song. Players submit title, artist, and year from their phones; scores are calculated on the server.

The `MusicProvider` interface in `server/music.ts` isolates catalog lookup and playback from game state. `MockMusicProvider` keeps the game playable without audio. `JellyfinMusicProvider` searches a Jellyfin library. The backend relays the selected audio only to the host browser; players do not receive the stream.

## Use Jellyfin

1. Copy `.env.example` to `.env` and set `JELLYFIN_URL`, `JELLYFIN_USERNAME`, and `JELLYFIN_PASSWORD`. The backend authenticates to Jellyfin when it starts. If Jellyfin runs in another Compose service on the same Docker network, use its service URL, such as `http://jellyfin:8096`. If it runs on the Docker host, Compose defaults to `http://host.docker.internal:8096`. For `npm run dev` outside Docker, use a URL the host Node process can reach, often `http://localhost:8096`.
2. Start the whole stack with `docker compose up --build`, then open `http://localhost:3001`. Compose initializes the PostgreSQL schema automatically. For local development, start Postgres with Compose, run `npm install`, then run `npm run db:push` once before `npm run dev`.
3. Choose Admin and log in (or create the initial admin account), then manage playlists or create a game. Guests choose Guest and enter the room code. Saved playlists appear in every new game. The admin can create a named playlist, select it, search Jellyfin, and add tracks; playlist names and tracks persist in PostgreSQL across games and app restarts. The selected playlist is locked when the first round begins; every round draws only from that list. A built in Starter Mix is available without Jellyfin.
4. Start a round. The app server reads the Jellyfin stream and relays it to the host browser. Playback is capped at one minute per round, with a countdown timer. Player devices never receive the stream or Jellyfin credentials.

Playback depends on Jellyfin being reachable from the app server and the host browser being able to reach the app server. Jellyfin can transcode some files, but supported formats vary. The backend holds the Jellyfin access token in memory and does not send it to browsers. The host receives a short lived, random app stream ticket. Use HTTPS for public deployments and keep Jellyfin credentials in `.env`; never commit that file.

### Public deployment security

- Before first admin setup, set `ADMIN_SETUP_SECRET` in `.env` to a random value at least 32 characters long (for example, generate one with `openssl rand -hex 32`). The initial account form requires this secret and an admin password of at least 12 characters. The secret is only needed for initial account creation; the password is stored as a salted scrypt hash. Store the setup secret privately, then remove it from `.env` and recreate/restart the app after setup. The single admin account is stored in PostgreSQL.
- Admins must log in before hosting or managing playlists. Other users can join with the room code as guests. Admin login is limited to ten attempts per client address per minute.
- The Compose app port binds to `127.0.0.1` by default so a host reverse proxy can reach it without exposing the Node port directly. Terminate HTTPS at the proxy, forward WebSocket upgrades, and make the proxy overwrite `Host`, `X-Forwarded-Proto`, and `X-Forwarded-For` with the public request values. If the proxy runs in another container, attach it to the app's Docker network, route to `app:3001`, and remove the app's `ports` mapping so it is not published on the host. Set `TRUSTED_PROXY_ADDRESSES` to the app-side IP address(es) of the proxy; only those peers are trusted to supply forwarded headers.
- The browser session token is a bearer credential stored in local storage. Anyone who obtains it can resume that player's seat; the host token grants control of that game. Room codes are six characters and room joins are rate limited.

The integration uses Jellyfin's `Users/AuthenticateByName`, `Items` search, and `/Audio/{itemId}/universal` endpoint to provide browser-compatible audio. See the [Jellyfin API documentation](https://api.jellyfin.org/) for API details.

## Run locally

Prerequisites: Node.js 20+ and npm, plus PostgreSQL for persistent playlists. Active room state remains in memory (restarting the backend clears rooms).

1. Start Docker Desktop (if using the bundled database), then copy `.env.example` to `.env`.
2. Run `npm install`.
3. Start the database: `docker compose up -d postgres`, wait until it is healthy, then initialize the schema with `npm run db:push`. If using a separately installed PostgreSQL, make sure it is running at the host and port in `DATABASE_URL` instead.
4. Run `npm run dev`.
5. Open `http://localhost:5173`. Create a room, then open its join link in other browsers or phones.

The API/WebSocket server runs on port 3001. `npm run build` creates the production frontend bundle. Configure a production reverse proxy to serve the frontend and forward `/socket.io` to the Node server with WebSocket upgrades enabled. Use HTTPS for public deployments.

## Tests

Run `npm test` for scoring normalization and year-tolerance tests. Playlist data is stored in PostgreSQL; active rooms and scores remain in memory.

## Configuration

`PORT` selects the Node server port. `DATABASE_URL` is the Prisma PostgreSQL connection string used for saved playlists

## Current MVP limits

- Rooms, players, and scores are held in server memory; named playlists and their Jellyfin tracks persist in PostgreSQL.
- Mock songs use simulated playback; Jellyfin tracks stream through the backend to the host browser.
- Playlist editing ends when the first round starts. Songs repeat only after every song in the selected playlist has been used.
- Song playback has a one minute maximum per round; answer submission remains open until the host reveals.
- Ten rounds maximum, chosen from the included mock deck.
- Year answers within one year receive the year point.
- Room codes are six characters; sessions use cryptographically generated IDs and private bearer tokens.

