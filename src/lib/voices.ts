/**
 * Choosing the most natural English voice a device offers for reading a word
 * aloud. Browsers speak with the system's default voice unless told
 * otherwise, and that is often the oldest and most robotic one installed,
 * while a far better one sits unused in the same list: Edge's "Natural"
 * voices, Chrome's Google voices, Apple's Enhanced and Premium downloads.
 *
 * Pure, so it can be tested against the lists real devices report.
 */

/** The parts of a SpeechSynthesisVoice the choice looks at. */
export interface VoiceLike {
  name: string;
  lang: string;
  localService: boolean;
  default: boolean;
}

/** Apple's joke and retro voices, and eSpeak: worse than anything else on offer. */
const ROBOTIC =
  /espeak|\b(albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|fred|junior|ralph|kathy|eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley)\b/i;

/** Well-liked voices, for a nudge among equals. Edge lists a child's voice (Ana) first otherwise. */
const LIKED = /\b(aria|jenny|ava|emma|andrew|brian|guy|samantha|alex|allison|karen|daniel|serena)\b/i;

/** How human a voice sounds, judged from what its name gives away. */
function tier(voice: VoiceLike): number {
  const name = voice.name;
  if (ROBOTIC.test(name)) return -1;
  if (/natural|neural/i.test(name)) return 5; // Edge's online voices: close to a person.
  if (/premium/i.test(name)) return 4; // Apple's best downloads.
  if (/enhanced/i.test(name)) return 3;
  if (/^google\b/i.test(name)) return 2; // Chrome's online voices.
  return voice.localService ? 0 : 1; // Online voices are usually the newer ones.
}

function accent(lang: string): number {
  if (lang === "en-us") return 6;
  if (lang === "en-gb") return 4;
  return 2;
}

function score(voice: VoiceLike, lang: string): number {
  return tier(voice) * 10 + accent(lang) + (LIKED.test(voice.name) ? 1 : 0) + (voice.default ? 0.5 : 0);
}

/**
 * The best English voice in `voices`, or null when there is none. American
 * English wins a tie, then British. `localOnly` keeps to voices that work
 * offline, for when an online one has just failed.
 */
export function pickVoice<V extends VoiceLike>(
  voices: readonly V[],
  { localOnly = false }: { localOnly?: boolean } = {},
): V | null {
  let best: V | null = null;
  let bestScore = -Infinity;
  for (const voice of voices) {
    // Android reports "en_US".
    const lang = voice.lang.replace("_", "-").toLowerCase();
    if (!lang.startsWith("en")) continue;
    if (localOnly && !voice.localService) continue;
    const value = score(voice, lang);
    if (value > bestScore) {
      best = voice;
      bestScore = value;
    }
  }
  return best;
}
