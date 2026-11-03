/*
 * The service worker. It does four small things:
 *
 * 1. Keeps a copy of the build files (scripts, styles, fonts, icons). Their
 *    names change with every build, so a cached copy is never stale.
 * 2. Keeps every word the AI voice has read, so a word is asked for once on
 *    this device and plays from here after that, even offline.
 * 3. Shows the offline page when a page load fails because there is no
 *    network.
 * 4. Shows reminder notifications, and opens the app when one is tapped.
 *
 * Pages themselves are never cached. They hold your cards and stats, which
 * must always be live, and they sit behind the sign-in.
 */

const VERSION = "v1";
const STATIC_CACHE = `flashcards-static-${VERSION}`;
const PAGE_CACHE = `flashcards-pages-${VERSION}`;
/** Not versioned: the words already heard should outlive an app update. */
const VOICE_CACHE = "flashcards-voice";
const OFFLINE_URL = "/offline";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(PAGE_CACHE)
      .then((cache) => cache.add(new Request(OFFLINE_URL, { cache: "reload" })))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("flashcards-") && ![STATIC_CACHE, PAGE_CACHE, VOICE_CACHE].includes(key))
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function isBuildFile(url) {
  return url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/");
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

// --- the AI voice's clips ----------------------------------------------------

/** About a second of sound each, some 50 KB: 2,000 words is about 100 MB. */
const MAX_CLIPS = 2000;
/** Clips being fetched, by URL, so the audio player's several requests for one share a single fetch. */
const clipsOnTheWay = new Map();

function isVoiceClip(url) {
  return url.pathname === "/api/speech";
}

/**
 * The clip from the network, kept if it is one. An error, or the sign-in page
 * after a lapsed session, is passed on and not kept, so the next tap asks again.
 */
function fetchClip(url) {
  let pending = clipsOnTheWay.get(url);
  if (!pending) {
    pending = (async () => {
      const response = await fetch(url, { credentials: "same-origin" });
      const type = response.headers.get("content-type") || "";
      if (response.ok && type.startsWith("audio/")) {
        const cache = await caches.open(VOICE_CACHE);
        await cache.put(url, response.clone());
        trimClips(cache).catch(() => {});
      }
      return response;
    })().finally(() => clipsOnTheWay.delete(url));
    clipsOnTheWay.set(url, pending);
  }
  return pending.then((response) => response.clone());
}

/** Drop the oldest clips once there are more than MAX_CLIPS. */
async function trimClips(cache) {
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_CLIPS))) await cache.delete(key);
}

/**
 * The part of `response` a "Range: bytes=start-end" header asks for. Audio
 * players ask for ranges, and Safari will not play a clip answered without one.
 */
async function withRange(response, range) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(range || "");
  if (!response.ok || !match || (match[1] === "" && match[2] === "")) return response;

  const body = await response.arrayBuffer();
  const size = body.byteLength;
  let start;
  let end;
  if (match[1] === "") {
    // "bytes=-500": the last 500 bytes.
    start = Math.max(0, size - Number(match[2]));
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  }
  if (start >= size || start > end) {
    return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
  }
  return new Response(body.slice(start, end + 1), {
    status: 206,
    headers: {
      "content-type": response.headers.get("content-type") || "audio/wav",
      "content-length": String(end - start + 1),
      "content-range": `bytes ${start}-${end}/${size}`,
      "accept-ranges": "bytes",
    },
  });
}

async function voiceClip(request) {
  const url = new URL(request.url);
  url.hash = "";
  const cache = await caches.open(VOICE_CACHE);
  const saved = await cache.match(url.href, { ignoreVary: true });
  const response = saved || (await fetchClip(url.href));
  return withRange(response, request.headers.get("range"));
}

// --- pages -------------------------------------------------------------------

async function networkOrOffline(request) {
  try {
    return await fetch(request);
  } catch {
    const offline = await caches.match(OFFLINE_URL);
    return offline ?? Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (isBuildFile(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (isVoiceClip(url)) {
    event.respondWith(voiceClip(request));
    return;
  }
  if (request.mode === "navigate") {
    event.respondWith(networkOrOffline(request));
  }
  // Everything else (data requests, Server Actions, the rest of the API) goes
  // straight to the network untouched.
});

// --- reminders ---------------------------------------------------------------

self.addEventListener("push", (event) => {
  let message = {};
  try {
    message = event.data ? event.data.json() : {};
  } catch {
    message = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(message.title || "Flashcards", {
      body: message.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      // One reminder at a time: a new one replaces the last instead of piling up.
      tag: "flashcards-reminder",
      renotify: true,
      data: { url: message.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      // Reuse an open window of the app if there is one.
      for (const client of windows) {
        if (client.url.startsWith(self.location.origin) && "focus" in client) {
          return client.focus().then((focused) => focused.navigate(target));
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
