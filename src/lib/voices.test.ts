/**
 * Picking a voice, against the lists real browsers report.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { pickVoice, type VoiceLike } from "@/lib/voices";

function voice(name: string, lang: string, options: { online?: boolean; default?: boolean } = {}): VoiceLike {
  return { name, lang, localService: !options.online, default: options.default ?? false };
}

const named = (voices: VoiceLike[], options?: { localOnly?: boolean }) => pickVoice(voices, options)?.name ?? null;

describe("pickVoice", () => {
  it("takes Edge's natural voice, and not the child's one listed first", () => {
    const edge = [
      voice("Microsoft David - English (United States)", "en-US", { default: true }),
      voice("Microsoft Zira - English (United States)", "en-US"),
      voice("Microsoft Ana Online (Natural) - English (United States)", "en-US", { online: true }),
      voice("Microsoft Aria Online (Natural) - English (United States)", "en-US", { online: true }),
      voice("Microsoft Libby Online (Natural) - English (United Kingdom)", "en-GB", { online: true }),
      voice("Microsoft Denise Online (Natural) - French (France)", "fr-FR", { online: true }),
    ];
    assert.equal(named(edge), "Microsoft Aria Online (Natural) - English (United States)");
  });

  it("takes Chrome's Google voice over the old Windows default", () => {
    const chrome = [
      voice("Microsoft David - English (United States)", "en-US", { default: true }),
      voice("Microsoft Zira - English (United States)", "en-US"),
      voice("Google Deutsch", "de-DE", { online: true }),
      voice("Google US English", "en-US", { online: true }),
      voice("Google UK English Female", "en-GB", { online: true }),
    ];
    assert.equal(named(chrome), "Google US English");
  });

  it("takes Samantha on an iPhone, not the joke voices", () => {
    const iphone = [
      voice("Albert", "en-US"),
      voice("Bad News", "en-US"),
      voice("Eddy (English (US))", "en-US"),
      voice("Fred", "en-US"),
      voice("Samantha", "en-US", { default: true }),
      voice("Daniel", "en-GB"),
      voice("Karen", "en-AU"),
      voice("Moira", "en-IE"),
    ];
    assert.equal(named(iphone), "Samantha");
  });

  it("takes an Apple Premium voice once one is downloaded", () => {
    const iphone = [
      voice("Samantha", "en-US", { default: true }),
      voice("Ava (Enhanced)", "en-US"),
      voice("Ava (Premium)", "en-US"),
    ];
    assert.equal(named(iphone), "Ava (Premium)");
  });

  it("reads Android's en_US", () => {
    const android = [
      voice("Deutsch Deutschland", "de_DE", { default: true }),
      voice("English United Kingdom", "en_GB"),
      voice("English United States", "en_US"),
    ];
    assert.equal(named(android), "English United States");
  });

  it("keeps the default when nothing on the device is better", () => {
    const windows = [
      voice("Microsoft George - English (United Kingdom)", "en-GB", { default: true }),
      voice("Microsoft Hazel - English (United Kingdom)", "en-GB"),
      voice("Microsoft Susan - English (United Kingdom)", "en-GB"),
    ];
    assert.equal(named(windows), "Microsoft George - English (United Kingdom)");
  });

  it("keeps to the device's own voices when asked, for when an online one failed", () => {
    const chrome = [
      voice("Google US English", "en-US", { online: true }),
      voice("Microsoft Zira - English (United States)", "en-US"),
    ];
    assert.equal(named(chrome, { localOnly: true }), "Microsoft Zira - English (United States)");
  });

  it("finds nothing without an English voice", () => {
    assert.equal(named([voice("Thomas", "fr-FR", { default: true })]), null);
    assert.equal(named([]), null);
  });
});
