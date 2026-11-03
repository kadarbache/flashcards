/**
 * How often the speaker asks the server: once per word, however many times
 * it is tapped, including taps while the first request is still on its way.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";

import { createClipPlayer, type Clip } from "@/components/clip-player";

/** An audio element whose server answers when the test says so. */
class FakeClip extends EventTarget implements Clip {
  currentTime = 0;
  paused = true;
  plays = 0;
  private arrived = false;
  readonly url: string;
  private waiting: Array<{ resolve: () => void; reject: (error: unknown) => void }> = [];

  constructor(url: string) {
    super();
    this.url = url;
  }

  play(): Promise<void> {
    this.plays += 1;
    this.paused = false;
    if (this.arrived) {
      this.dispatchEvent(new Event("playing"));
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => this.waiting.push({ resolve, reject }));
  }

  pause() {
    this.paused = true;
    for (const play of this.waiting.splice(0)) play.reject(new DOMException("Paused", "AbortError"));
  }

  /** The server sends the clip. */
  arrive() {
    this.arrived = true;
    this.dispatchEvent(new Event("canplaythrough"));
    if (this.paused) return;
    this.dispatchEvent(new Event("playing"));
    for (const play of this.waiting.splice(0)) play.resolve();
  }

  /** The server sends an error instead. */
  fail() {
    this.dispatchEvent(new Event("error"));
    for (const play of this.waiting.splice(0)) play.reject(new DOMException("No clip", "NotSupportedError"));
  }
}

function setup(options: { maxClips?: number; now?: () => number } = {}) {
  const requests: FakeClip[] = [];
  const player = createClipPlayer({
    load: (url) => {
      const clip = new FakeClip(url);
      requests.push(clip);
      return clip;
    },
    ...options,
  });
  return { player, requests };
}

describe("createClipPlayer", () => {
  afterEach(() => mock.timers.reset());

  it("asks for a word once, then replays it from memory however often it is tapped", async () => {
    const { player, requests } = setup();

    const first = player.play("essence");
    assert.equal(first.waiting, true);
    assert.equal(requests[0].url, "/api/speech?text=essence");
    requests[0].arrive();
    assert.equal(await first.result, "played");

    for (let tap = 0; tap < 3; tap += 1) {
      requests[0].currentTime = 0.4;
      const again = player.play("essence");
      assert.equal(again.waiting, false);
      assert.equal(await again.result, "played");
      assert.equal(requests[0].currentTime, 0, "each replay starts from the beginning");
    }

    assert.equal(requests.length, 1, "four taps, one request");
    assert.equal(requests[0].plays, 4);
  });

  it("makes a tap during a slow first request wait for it, not send another", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    const { player, requests } = setup();

    const first = player.play("essence");
    mock.timers.tick(10_000);
    assert.equal(await first.result, "failed", "the device speaks instead");
    assert.equal(requests[0].paused, true, "so the clip cannot turn up and talk over it");

    const second = player.play("essence");
    assert.equal(second.waiting, true);
    requests[0].arrive();
    assert.equal(await second.result, "played");
    assert.equal(requests.length, 1);
  });

  it("keeps a clip that arrives after its tap gave up, for the next tap", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    const { player, requests } = setup();

    const first = player.play("essence");
    mock.timers.tick(10_000);
    await first.result;
    requests[0].arrive();

    const next = player.play("essence");
    assert.equal(next.waiting, false);
    assert.equal(await next.result, "played");
    assert.equal(requests.length, 1);
  });

  it("keeps a clip whose wait was called off, e.g. when the card moved on", async () => {
    const { player, requests } = setup();

    const tap = player.play("essence");
    tap.stop();
    assert.equal(await tap.result, "stopped");
    requests[0].arrive();

    assert.equal(player.play("essence").waiting, false);
    assert.equal(requests.length, 1);
  });

  it("asks again after a failure, since there is nothing to replay", async () => {
    const { player, requests } = setup();

    const first = player.play("essence");
    requests[0].fail();
    assert.equal(await first.result, "failed");

    player.play("essence").stop();
    assert.equal(requests.length, 2);
  });

  it("asks again when a request has gone unanswered for a minute", () => {
    let clock = 0;
    const { player, requests } = setup({ now: () => clock });

    player.play("essence").stop();
    clock = 30_000;
    player.play("essence").stop();
    assert.equal(requests.length, 1, "still on its way");
    clock = 61_000;
    player.play("essence").stop();
    assert.equal(requests.length, 2, "taken as lost");
  });

  it("keeps each word apart, and only the most recent ones", async () => {
    const { player, requests } = setup({ maxClips: 2 });

    for (const word of ["one", "two", "three"]) {
      const tap = player.play(word);
      requests.at(-1)?.arrive();
      await tap.result;
    }
    assert.equal(requests.length, 3);
    assert.equal(player.play("three").waiting, false);
    assert.equal(player.play("two").waiting, false);
    const evicted = player.play("one");
    evicted.stop();
    assert.equal(evicted.waiting, true, "the oldest made room");
  });
});
