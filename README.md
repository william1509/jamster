# Side A

A mobile first, real time music timeline party game. Side A currently runs with a small mock song deck and simulated playback so a room can play without any music account. A host opens a room, shares its four character code or join link, and starts each round. Players submit title, artist, and year from their phones; the song is revealed when everyone has locked in or the host reveals early.

## Spotify compatibility

Spotify playlist import reads track metadata only; Side A does not play Spotify audio. The host connects a Spotify account with read-only playlist permissions, then imports a playlist they own or can access as a collaborator. Spotify requires the app's redirect URI to be registered in the Spotify Developer Dashboard. Set `SPOTIFY_CLIENT_ID` and `SPOTIFY_REDIRECT_URI` in `.env`; for local development the redirect URI is `http://localhost:3001/api/spotify/callback`. The imported track title, artist, release year, and Spotify link are saved with the Side A playlist. Spotify links are shown with the answer when a round is revealed.

The `MusicProvider` interface in `server/music.ts` isolates catalog lookup and playback from game state. `MockMusicProvider` keeps the game playable without audio. `JellyfinMusicProvider` searches a Jellyfin library. The backend relays the selected audio only to the host browser; players do not receive the stream.

## Use Jellyfin

1. Copy `.env.example` to `.env` and set `JELLYFIN_URL`, `JELLYFIN_USERNAME`, and `JELLYFIN_PASSWORD`. The backend authenticates to Jellyfin when it starts. If Jellyfin runs in another Compose service on the same Docker network, use its service URL, such as `http://jellyfin:8096`. If it runs on the Docker host, Compose defaults to `http://host.docker.internal:8096`. For `npm run dev` outside Docker, use a URL the host Node process can reach, often `http://localhost:8096`.
2. Start the whole stack with `docker compose up --build`, then open `http://localhost:3001`. Compose initializes the PostgreSQL schema automatically. For local development, start Postgres with Compose, run `npm install`, then run `npm run db:push` once before `npm run dev`.
3. Manage playlists from the landing screen before hosting: create and rename playlists, add or remove tracks, and review each playlist's items. Playlist names and tracks persist in PostgreSQL across games and app restarts. When hosting, select one of your saved playlists in game configuration. Each round draws only from that list.
4. Start a round. The app server reads the Jellyfin stream and relays it to the host browser. Playback is capped at one minute per round, with a countdown timer. Player devices never receive the stream or Jellyfin credentials.

Playback depends on Jellyfin being reachable from the app server and the host browser being able to reach the app server. Jellyfin can transcode some files, but supported formats vary. The backend holds the Jellyfin access token in memory and does not send it to browsers. The host receives a short lived, random app stream ticket. Use HTTPS for public deployments and keep Jellyfin credentials in `.env`; never commit that file.

The integration uses Jellyfin's `Users/AuthenticateByName`, `Items` search, and `/Audio/{itemId}/stream` endpoints. See the [Jellyfin API documentation](https://api.jellyfin.org/) for API details.

## Deploy on another machine

1. Build and publish the image from the project directory. Replace the example Docker Hub name with your account/repository:

   ```sh
   docker login
   docker buildx build --platform linux/amd64,linux/arm64 -t your-dockerhub-username/sidea:latest --push .
   ```

2. On the target machine, install Docker Engine and the Docker Compose plugin. Copy `docker-compose.yml` and `.env.example` there, then create the deployment environment file and set a unique database password:

   ```sh
   cp .env.example .env
   ```

   Set `POSTGRES_PASSWORD` to a long random hex value. For example, generate one with `openssl rand -hex 24`. Compose constructs the database URL for the app from the PostgreSQL settings. Keep `.env` private and out of source control.
   Also set `DOCKERHUB_IMAGE` to the image repository you pushed, such as `your-dockerhub-username/sidea`. Set `IMAGE_TAG` to the published tag.
3. Pull and start the app and database:

   ```sh
   docker compose pull
   docker compose up -d
   ```

4. Open `http://<server-address>:3001` from devices that can reach the machine. Set `APP_PORT` in `.env` to choose another host port. PostgreSQL's optional host port binding is restricted to loopback; app traffic uses the private Compose network. Playlists persist in the `sidea-data` volume.

For a public deployment, terminate HTTPS at a reverse proxy and forward requests, including WebSocket upgrades, to the app's port. Set `SPOTIFY_REDIRECT_URI` to the public HTTPS address ending in `/api/spotify/callback` and register that exact address in Spotify's developer dashboard. Configure `JELLYFIN_URL`, `JELLYFIN_USERNAME`, and `JELLYFIN_PASSWORD` if Jellyfin imports are needed. Rooms and current games are held in memory and are cleared when the app container restarts.

To release an update, push a new image tag, change `IMAGE_TAG` on the target machine, then run `docker compose pull && docker compose up -d`. Use `docker compose logs -f app` to inspect startup and runtime logs.

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

`PORT` selects the Node server port. `DATABASE_URL` is the Prisma PostgreSQL connection string used for saved playlists. `SPOTIFY_CLIENT_ID` and `SPOTIFY_REDIRECT_URI` configure read-only playlist import; no Spotify client secret or playback credentials are used.

## Current MVP limits

- Rooms, players, and scores are held in server memory; named playlists and their Jellyfin and Spotify track metadata persist in PostgreSQL.
- Mock songs use simulated playback; Jellyfin tracks stream through the backend to the host browser.
- The built-in Starter Mix has been removed. A game cannot start until a saved playlist with at least one song is selected. Songs repeat only after every song in the selected playlist has been used.
- Song playback has a one minute maximum per round; the answer is revealed automatically when every connected player has locked in, and the host can also reveal early.
- The host chooses 1 to 30 rounds before the first round starts.
- A correct song title earns up to 1,000 points, scaled linearly by round time remaining. A correct artist earns 200 points, and an exact release year earns 200 points.
- Room codes are four characters; sessions use cryptographically generated IDs.
