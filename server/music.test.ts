import { afterEach, describe, expect, it, vi } from "vitest";
import { JellyfinMusicProvider } from "./music";

afterEach(() => vi.unstubAllGlobals());

describe("JellyfinMusicProvider", () => {
  it("authenticates, searches audio, and builds a host stream URL", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ AccessToken: "test-token", User: { Id: "user-1" } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ Items: [{
        Id: "item-1", Name: "Dreams", Album: "Rumours", AlbumArtist: "Fleetwood Mac",
        ProductionYear: 1977, RunTimeTicks: 2400000000,
      }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const provider = new JellyfinMusicProvider("https://jellyfin.example/media", "alice", "secret");
    await provider.connect();
    const songs = await provider.searchSongs("Dreams");

    expect(fetchMock.mock.calls[0][0]).toBe("https://jellyfin.example/media/Users/AuthenticateByName");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ Username: "alice", Pw: "secret" });
    expect(songs[0]).toMatchObject({ title: "Dreams", artist: "Fleetwood Mac", releaseYear: 1977, provider: "jellyfin" });
    expect(fetchMock.mock.calls[1][0]).toContain("IncludeItemTypes=Audio");
    expect(fetchMock.mock.calls[1][1]?.headers).toMatchObject({ Authorization: expect.stringContaining('Token="test-token"') });
    expect(provider.getStreamUrl(songs[0]!)).toBe("https://jellyfin.example/media/Audio/item-1/stream?api_key=test-token");
  });

  it("rejects non-http server URLs", () => {
    expect(() => new JellyfinMusicProvider("javascript:alert(1)", "alice", "secret")).toThrow(/http/);
  });

  it("explains a 403 returned by Jellyfin", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ Message: "Remote login disabled" }), {
      status: 403, headers: { "Content-Type": "application/json" },
    })));
    const provider = new JellyfinMusicProvider("https://jellyfin.example", "alice", "secret");
    await expect(provider.connect()).rejects.toThrow(/remote access permission.*Remote login disabled/i);
  });
});
