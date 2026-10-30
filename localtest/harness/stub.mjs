// Local stand-in for Supabase (REST proxy + storage) and the Claude API.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";

const FILES = "/var/tmp/ospg/files";
fs.mkdirSync(FILES, { recursive: true });
let promptN = 0;

function proxy(req, res, target) {
  const p = http.request(
    { host: "127.0.0.1", port: 3000, path: target, method: req.method, headers: { ...req.headers, host: "127.0.0.1:3000" } },
    (r) => {
      res.writeHead(r.statusCode, r.headers);
      r.pipe(res);
    },
  );
  req.pipe(p);
  p.on("error", (e) => {
    res.writeHead(502);
    res.end(String(e));
  });
}

function body(req) {
  return new Promise((ok) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => ok(Buffer.concat(chunks)));
  });
}

/** A stored file, with byte ranges (video seeking) */
function serveFile(req, res, f) {
  if (!fs.existsSync(f)) {
    res.writeHead(404);
    return res.end();
  }
  const buf = fs.readFileSync(f);
  const ext = f.split(".").pop();
  const ct = { webm: "video/webm", mp4: "video/mp4", mov: "video/quicktime", mp3: "audio/mpeg", jpg: "image/jpeg", png: "image/png", json: "application/json" }[ext] ?? "application/octet-stream";
  const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), buf.length - 1) : buf.length - 1;
    res.writeHead(206, { "access-control-allow-origin": "*", "content-type": ct, "accept-ranges": "bytes", "content-range": `bytes ${start}-${end}/${buf.length}`, "content-length": end - start + 1 });
    return res.end(buf.subarray(start, end + 1));
  }
  res.writeHead(200, { "access-control-allow-origin": "*", "content-type": ct, "accept-ranges": "bytes", "content-length": buf.length });
  return res.end(req.method === "HEAD" ? undefined : buf);
}

// ---- fake Postmark: the API the site sends through. Each email is saved like the test mailbox saves one
const PM_STATE = "/var/tmp/ospg/postmark.json";
const pmState = () => (fs.existsSync(PM_STATE) ? JSON.parse(fs.readFileSync(PM_STATE, "utf8")) : { streams: [{ ID: "outbound", Name: "Default Transactional Stream", MessageStreamType: "Transactional" }, { ID: "broadcast", Name: "Default Broadcast Stream", MessageStreamType: "Broadcasts", SubscriptionManagementConfiguration: { UnsubscribeHandlingType: "Postmark" } }], webhooks: [], fail: {}, n: 0 });
const pmSave = (st) => fs.writeFileSync(PM_STATE, JSON.stringify(st));
async function postmark(req, res, u) {
  const send = (code, o) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
  const st = pmState();
  // test controls
  if (u.pathname === "/__pmreset") { fs.rmSync(PM_STATE, { force: true }); return send(200, { ok: true }); }
  if (u.pathname === "/__pmfail") { st.fail[u.searchParams.get("to")] = Number(u.searchParams.get("code") ?? 406); pmSave(st); return send(200, { ok: true }); }
  if (u.pathname === "/__pmnocustom") { st.noCustom = true; pmSave(st); return send(200, { ok: true }); }
  if (u.pathname === "/__pmstate") return send(200, st);
  if (req.headers["x-postmark-server-token"] !== "local-postmark-token") return send(401, { ErrorCode: 10, Message: "The Server Token you provided in the X-Postmark-Server-Token request header was invalid." });
  const p = u.pathname.replace(/^\/postmark/, "");
  const raw = req.method === "GET" ? null : JSON.parse((await body(req)).toString() || "null");
  if (p === "/server") return send(200, { ID: 1, Name: "Local stand-in" });
  if (p === "/message-streams" && req.method === "GET") return send(200, { MessageStreams: st.streams, TotalCount: st.streams.length });
  if (p === "/message-streams" && req.method === "POST") { st.streams.push({ ...raw }); pmSave(st); return send(200, raw); }
  let m = p.match(/^\/message-streams\/([^/]+)$/);
  if (m && req.method === "PATCH") {
    const s = st.streams.find((x) => x.ID === decodeURIComponent(m[1]));
    if (!s) return send(404, { ErrorCode: 1226, Message: "The message stream was not found." });
    if (raw.SubscriptionManagementConfiguration?.UnsubscribeHandlingType === "Custom" && st.noCustom) return send(422, { ErrorCode: 1235, Message: "Custom unsubscribe handling isn't enabled for this account." });
    Object.assign(s, raw); pmSave(st); return send(200, s);
  }
  if (p.match(/^\/message-streams\/[^/]+\/suppressions\/delete$/)) { st.reactivated = [...(st.reactivated ?? []), ...raw.Suppressions.map((x) => x.EmailAddress)]; pmSave(st); return send(200, { Suppressions: raw.Suppressions.map((x) => ({ EmailAddress: x.EmailAddress, Status: "Deleted", Message: null })) }); }
  if (p === "/webhooks" && req.method === "GET") return send(200, { Webhooks: st.webhooks.filter((w) => !u.searchParams.get("MessageStream") || w.MessageStream === u.searchParams.get("MessageStream")) });
  if (p === "/webhooks" && req.method === "POST") { const w = { ID: st.webhooks.length + 1, ...raw }; st.webhooks.push(w); pmSave(st); return send(200, w); }
  m = p.match(/^\/webhooks\/(\d+)$/);
  if (m && req.method === "PUT") { const w = st.webhooks.find((x) => x.ID === Number(m[1])); Object.assign(w, raw); pmSave(st); return send(200, w); }
  const one = (msg) => {
    const to = String(msg.To).toLowerCase();
    if (st.fail[to]) { const code = st.fail[to]; delete st.fail[to]; return { ErrorCode: code, Message: code === 406 ? `You tried to send to recipient(s) that have been marked as inactive. Found inactive addresses: ${to}.` : "Failed", To: msg.To }; }
    if (!st.streams.some((s) => s.ID === msg.MessageStream)) return { ErrorCode: 1235, Message: `The message stream for the provided 'ID' was not found: ${msg.MessageStream}`, To: msg.To };
    const id = `pm-${Date.now()}-${++st.n}`;
    const headers = Object.fromEntries((msg.Headers ?? []).map((h) => [h.Name.toLowerCase(), h.Value]));
    if (msg.ReplyTo) headers["reply-to"] = msg.ReplyTo;
    fs.mkdirSync("/var/tmp/ospg/mail", { recursive: true });
    fs.writeFileSync(`/var/tmp/ospg/mail/${Date.now()}-pm${st.n}.json`, JSON.stringify({ to: [to], from: msg.From, subject: msg.Subject, html: msg.HtmlBody, text: msg.TextBody, headers, stream: msg.MessageStream, tag: msg.Tag, metadata: msg.Metadata, messageId: id, attachments: (msg.Attachments ?? []).map((a) => ({ filename: a.Name, contentType: a.ContentType, size: Buffer.from(a.Content, "base64").length, content: Buffer.from(a.Content, "base64").toString("utf8").slice(0, 20000) })) }));
    return { ErrorCode: 0, Message: "OK", MessageID: id, To: msg.To, SubmittedAt: new Date().toISOString() };
  };
  if (p === "/email" && req.method === "POST") { const r = one(raw); pmSave(st); return send(r.ErrorCode ? 422 : 200, r); }
  if (p === "/email/batch" && req.method === "POST") { const r = raw.map(one); pmSave(st); return send(200, r); }
  return send(404, { ErrorCode: 404, Message: "stub: not found " + p });
}

http
  .createServer(async (req, res) => {
    const u = new URL(req.url, "http://x");
    if (u.pathname.startsWith("/rest/v1/")) return proxy(req, res, req.url.replace("/rest/v1", ""));
    if (u.pathname.startsWith("/postmark/") || u.pathname.startsWith("/__pm")) return postmark(req, res, u);

    // storage: two buckets, "media" (public) and "media-private" (locked: read with signed links only)
    const fileOf = (bucket, key) => path.join(FILES, bucket === "media-private" ? "__private__" : "", decodeURIComponent(key));
    const BK = "(media|media-private)";
    let m = u.pathname.match(new RegExp(`^/storage/v1/object/upload/sign/${BK}/(.+)$`));
    if (m && req.method === "POST") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ url: `/object/upload/sign/${m[1]}/${m[2]}?token=tok123` }));
    }
    if (m && req.method === "PUT") {
      let b = await body(req);
      // Supabase accepts multipart form uploads: keep only the file part
      const ct = req.headers["content-type"] || "";
      const bm = ct.match(/boundary=(.+)$/);
      if (bm) {
        const boundary = Buffer.from("--" + bm[1]);
        const parts = [];
        let i = b.indexOf(boundary);
        while (i !== -1) {
          const j = b.indexOf(boundary, i + boundary.length);
          if (j === -1) break;
          parts.push(b.subarray(i + boundary.length + 2, j - 2));
          i = j;
        }
        const filePart = parts.find((p) => p.subarray(0, 300).toString().includes("filename=")) ?? parts[parts.length - 1];
        const hdrEnd = filePart.indexOf("\r\n\r\n");
        b = filePart.subarray(hdrEnd + 4);
      }
      const f = fileOf(m[1], m[2]);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, b);
      res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
      return res.end(JSON.stringify({ Key: `${m[1]}/${m[2]}` }));
    }
    // signed links to read (createSignedUrls / createSignedUrl), and reading through them
    m = u.pathname.match(new RegExp(`^/storage/v1/object/sign/${BK}$`));
    if (m && req.method === "POST") {
      const b = JSON.parse((await body(req)).toString() || "{}");
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify((b.paths || []).map((p) => ({ path: p, signedURL: `/object/sign/${m[1]}/${p}?token=signed-${b.expiresIn}`, error: null }))));
    }
    m = u.pathname.match(new RegExp(`^/storage/v1/object/sign/${BK}/(.+)$`));
    if (m && req.method === "POST") {
      const b = JSON.parse((await body(req)).toString() || "{}");
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ signedURL: `/object/sign/${m[1]}/${m[2]}?token=signed-${b.expiresIn}` }));
    }
    if (m && (req.method === "GET" || req.method === "HEAD")) {
      if (!/^signed-/.test(u.searchParams.get("token") || "")) { res.writeHead(400); return res.end(); }
      return serveFile(req, res, fileOf(m[1], m[2]));
    }
    if (u.pathname === "/storage/v1/object/copy" && req.method === "POST") {
      const b = JSON.parse((await body(req)).toString() || "{}");
      const from = fileOf(b.bucketId, b.sourceKey), to = fileOf(b.destinationBucket || b.bucketId, b.destinationKey);
      if (!fs.existsSync(from)) { res.writeHead(404, { "content-type": "application/json" }); return res.end(JSON.stringify({ message: "Object not found" })); }
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ Key: `${b.destinationBucket || b.bucketId}/${b.destinationKey}` }));
    }
    // storage.list(prefix) and storage.remove([paths]) (supabase-js)
    m = u.pathname.match(new RegExp(`^/storage/v1/object/list/${BK}$`));
    if (m && req.method === "POST") {
      const b = JSON.parse((await body(req)).toString() || "{}");
      const dir = fileOf(m[1], b.prefix || "");
      const names = fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.name !== "__private__").map((d) => ({ name: d.name, id: d.isFile() ? "f-" + d.name : null })) : [];
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(names.slice(b.offset || 0, (b.offset || 0) + (b.limit || 100))));
    }
    m = u.pathname.match(new RegExp(`^/storage/v1/object/${BK}$`));
    if (m && req.method === "DELETE") {
      const b = JSON.parse((await body(req)).toString() || "{}");
      const gone = [];
      for (const k of b.prefixes || []) { const f = fileOf(m[1], k); if (fs.existsSync(f)) { fs.unlinkSync(f); gone.push({ name: k }); } }
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(gone));
    }
    // direct server-side upload (supabase-js storage.upload) and download
    let dm = u.pathname.match(new RegExp(`^/storage/v1/object/${BK}/(.+)$`));
    if (dm && (req.method === "POST" || req.method === "PUT")) {
      const b = await body(req);
      const f = fileOf(dm[1], dm[2]);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, b);
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ Key: `${dm[1]}/${dm[2]}`, Id: "x" }));
    }
    if (dm && req.method === "GET") {
      const f = fileOf(dm[1], dm[2]);
      if (!fs.existsSync(f)) { res.writeHead(404, { "content-type": "application/json" }); return res.end(JSON.stringify({ statusCode: "404", error: "not_found", message: "Object not found" })); }
      res.writeHead(200, { "content-type": "application/octet-stream" });
      return res.end(fs.readFileSync(f));
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "*",
        "access-control-allow-headers": "*",
      });
      return res.end();
    }
    m = u.pathname.match(/^\/storage\/v1\/object\/(?:public|authenticated)\/media\/(.+)$/);
    if (m) return serveFile(req, res, path.join(FILES, m[1]));

    // ---- fake ElevenLabs Music
    if (u.pathname === "/v1/music") {
      const b = JSON.parse((await body(req)).toString());
      fs.appendFileSync("/var/tmp/ospg/music.log", JSON.stringify({ key: req.headers["xi-api-key"], body: b }) + "\n");
      if (globalThis.musicFail) { res.writeHead(403, { "content-type": "application/json" }); return res.end('{"detail":"missing_permissions"}'); }
      res.writeHead(200, { "content-type": "audio/mpeg" });
      return res.end(Buffer.from("ID3fake-composed-music"));
    }
    // ---- fake ElevenLabs
    if (u.pathname === "/v1/speech-to-text" && req.method === "POST") {
      const raw = await body(req);
      const bm = (req.headers["content-type"] || "").match(/boundary=(.+)$/);
      const fields = {};
      let audioBytes = 0;
      if (bm) {
        for (const part of raw.toString("latin1").split("--" + bm[1])) {
          const name = part.match(/name="([^"]+)"/)?.[1];
          if (!name) continue;
          const val = part.slice(part.indexOf("\r\n\r\n") + 4).replace(/\r\n$/, "");
          if (name === "file") audioBytes = val.length;
          else (fields[name] ??= []).push(val);
        }
      }
      fs.appendFileSync("/var/tmp/ospg/stt.log", JSON.stringify({ fields, audioBytes }) + "\n");
      if (globalThis.sttJson && (fields.keyterms ?? []).length > 1) {
        res.writeHead(422, { "content-type": "application/json" });
        return res.end('{"detail":"keyterms must be a JSON array"}');
      }
      if (fields.cloud_storage_url) {
        // A clip's sound (an interview or a prediction): words with their times
        const said = "Well I reckon Neil wins this by ten points no question. He has been practising all week and the putter is red hot.";
        const words = said.split(" ").map((w, i) => ({ text: w, start: 0.5 + i * 0.5, end: 0.9 + i * 0.5, type: "word" }));
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ text: said, language_code: "en", words }));
      }
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ text: "neil lipped out on the birdy putt", language_code: "en" }));
    }
    if (u.pathname === "/v1/sound-generation" && req.method === "POST") {
      const b = JSON.parse((await body(req)).toString());
      fs.appendFileSync("/var/tmp/ospg/sfx.log", JSON.stringify(b) + "\n");
      const mp3 = Buffer.alloc(17600); mp3[0] = 0xff; mp3[1] = 0xfb;
      res.writeHead(200, { "content-type": "audio/mpeg" });
      return res.end(mp3);
    }
    if (u.pathname.startsWith("/v1/text-to-speech/")) {
      const b = JSON.parse((await body(req)).toString());
      fs.appendFileSync("/var/tmp/ospg/tts.log", JSON.stringify({ voice: u.pathname.split("/").pop(), key: req.headers["xi-api-key"], text: b.text, model: b.model_id }) + "\n");
      if (globalThis.noV3 && b.model_id === "eleven_v3") { res.writeHead(400, { "content-type": "application/json" }); return res.end('{"detail":"model not available on your plan"}'); }
      // Like ElevenLabs' smaller plans: more than 2 at once is refused; /__tts429?n= refuses the next n
      globalThis.ttsBusy = (globalThis.ttsBusy ?? 0) + 1;
      globalThis.ttsPeak = Math.max(globalThis.ttsPeak ?? 0, globalThis.ttsBusy);
      try {
        if (globalThis.ttsBusy > 2 || (globalThis.tts429 ?? 0) > 0) {
          if ((globalThis.tts429 ?? 0) > 0) globalThis.tts429--;
          fs.appendFileSync("/var/tmp/ospg/tts429.log", "429\n");
          res.writeHead(429, { "content-type": "application/json" });
          return res.end('{"detail":{"status":"too_many_concurrent_requests"}}');
        }
        await new Promise((ok) => setTimeout(ok, 250));
        // A 128 kbit/s mp3 as long as the line takes to say at 2 words a second (a slowish commentator)
        const words = String(b.text).replace(/\[[a-z ]+\]\s*/gi, "").trim().split(/\s+/).length;
        const secs = words / 2 + 0.3;
        // a real (quiet) mp3 at 128 kbit/s, so a browser can decode and time it like a real recording
        const mp3 = await new Promise((ok, no) => execFile("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", `sine=frequency=180:sample_rate=44100:duration=${secs}`, "-af", "volume=0.05", "-ac", "1", "-c:a", "libmp3lame", "-b:a", "128k", "-f", "mp3", "-"], { encoding: "buffer", maxBuffer: 1e7 }, (e, out) => (e ? no(e) : ok(out))));
        res.writeHead(200, { "content-type": "audio/mpeg" });
        return res.end(mp3);
      } finally {
        globalThis.ttsBusy--;
      }
    }
    // ---- fake Veo (Gemini API)
    if (u.pathname.includes(":predictLongRunning")) {
      const b = JSON.parse((await body(req)).toString());
      fs.appendFileSync("/var/tmp/ospg/veo.log", JSON.stringify({ key: req.headers["x-goog-api-key"], body: b }) + "\n");
      globalThis.veoPolls = 0;
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ name: "models/veo/operations/op1" }));
    }
    if (u.pathname === "/v1beta/models/veo/operations/op1") {
      globalThis.veoPolls = (globalThis.veoPolls ?? 0) + 1;
      res.writeHead(200, { "content-type": "application/json" });
      if (globalThis.veoPolls < 2) return res.end(JSON.stringify({ name: "op1", done: false }));
      return res.end(JSON.stringify({ name: "op1", done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: "http://127.0.0.1:54321/veo-file.mp4" } }] } } }));
    }
    if (u.pathname === "/veo-file.mp4" && globalThis.veoFetchFail) { globalThis.veoFetchFail = false; res.writeHead(503); return res.end("busy"); }
    if (u.pathname.startsWith("/rendered/") && u.pathname.endsWith(".jpg")) {
      res.writeHead(200, { "content-type": "image/jpeg" });
      return res.end(fs.readFileSync("/var/tmp/ospg/files/still.jpg"));
    }
    if (u.pathname.startsWith("/rendered/") && fs.existsSync("/var/tmp/ospg/vid/film.webm")) {
      res.writeHead(200, { "content-type": "video/webm" });
      return res.end(fs.readFileSync("/var/tmp/ospg/vid/film.webm"));
    }
    if (u.pathname === "/veo-file.mp4" || u.pathname.startsWith("/rendered/")) {
      const dir = path.join(FILES, "video/october-special-2026");
      // any uploaded mp4 will do; on a fresh workspace, the stand-in clip
      const mp4 = fs.existsSync(dir) && fs.readdirSync(dir).find((f) => f.endsWith(".mp4"));
      res.writeHead(200, { "content-type": "video/mp4" });
      return res.end(fs.readFileSync(mp4 ? path.join(dir, mp4) : "/var/tmp/ospg/social/clip1.mp4"));
    }
    // ---- fake Shotstack: fetch every asset and refuse the edit if any fails
    if (u.pathname === "/__tts429") { globalThis.tts429 = Number(u.searchParams.get("n") ?? 1); globalThis.ttsPeak = 0; res.writeHead(200); return res.end("ok"); }
    if (u.pathname === "/__ttspeak") { res.writeHead(200); return res.end(String(globalThis.ttsPeak ?? 0)); }
    if (u.pathname === "/__sttjson") { globalThis.sttJson = true; res.writeHead(200); return res.end("ok"); }
    if (u.pathname === "/__badplan") { globalThis.badPlan = true; res.writeHead(200); return res.end("ok"); }
    if (u.pathname.startsWith("/golfapi/")) {
      globalThis.golfCalls = (globalThis.golfCalls ?? 0) + 1;
      fs.appendFileSync("/var/tmp/ospg/golfapi.log", u.pathname + u.search + " " + (req.headers.authorization || "") + "\n");
      const send = (o) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ apiRequestsLeft: String(25 - globalThis.golfCalls), ...o })); };
      if (u.pathname === "/golfapi/clubs" && /nowhere/i.test(u.searchParams.get("name") || "")) return send({ numClubs: 0, clubs: [] });
      if (u.pathname === "/golfapi/clubs") return send({ numClubs: 1, clubs: [{ clubID: "141520611", clubName: "Birr Golf Club", city: "Birr", country: "Ireland", latitude: 53.09, longitude: -7.9, courses: [{ courseID: "012141520611", courseName: "Birr", numHoles: 18, hasGPS: 1 }] }] });
      if (u.pathname.startsWith("/golfapi/courses/")) {
        const white = { teeName: "White", courseRatingMen: 71.2, slopeMen: 128, length1: 360, length2: 380, length3: 160, length4: 480, length5: 350, length6: 370, length7: 150, length8: 340, length9: 470, length10: 360, length11: 380, length12: 160, length13: 480, length14: 350, length15: 370, length16: 150, length17: 340, length18: 470 };
        const yellow = { teeName: "Yellow", courseRatingMen: 69.8, slopeMen: 124 };
        for (let h = 1; h <= 18; h++) yellow[`length${h}`] = white[`length${h}`] - 15;
        return send({ courseID: "012141520611", courseName: "Birr", numHoles: 18, lengthUnit: "m", parsMen: [4,4,3,5,4,4,3,4,5,4,4,3,5,4,4,3,4,5], indexesMen: [5,1,15,9,11,3,17,13,7,6,2,16,10,12,4,18,14,8], tees: [white, yellow] });
      }
      if (u.pathname.startsWith("/golfapi/coordinates/")) {
        const c = []; const lat0 = 53.0897, lng0 = -7.8957;
        for (let h = 1; h <= 18; h++) {
          const la = lat0 + (h % 6) * 0.002, ln = lng0 + Math.floor((h - 1) / 6) * 0.004;
          c.push({ poi: 12, location: 2, hole: h, latitude: la, longitude: ln });
          c.push({ poi: 11, location: 2, hole: h, latitude: la + 0.0002, longitude: ln });
          for (const [loc, d] of [[1, 0.0030], [2, 0.00315], [3, 0.0033]]) c.push({ poi: 1, location: loc, hole: h, latitude: la + d, longitude: ln + 0.001 });
          c.push({ poi: 2, location: 2, hole: h, latitude: la + 0.0031, longitude: ln + 0.0013 });
          if (h % 4 === 0) c.push({ poi: 4, location: 2, hole: h, latitude: la + 0.0015, longitude: ln + 0.0004 });
        }
        return send({ numCoordinates: c.length, coordinates: c });
      }
    }
    if (u.pathname === "/__nov3") { globalThis.noV3 = true; res.writeHead(200); return res.end("ok"); }
    if (u.pathname === "/v1/voices") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ voices: [{ voice_id: "commentator01", name: "Seamus", labels: { accent: "Irish", gender: "male", age: "old" }, preview_url: "http://127.0.0.1:54321/veo-file.mp4" }, { voice_id: "Xb7hH8MSUJpSbSDYk0k2", name: "Alice", labels: { accent: "British", gender: "female", age: "middle-aged" }, preview_url: "http://127.0.0.1:54321/veo-file.mp4" }, { voice_id: "pundit02", name: "Niamh", labels: { accent: "Irish", gender: "female", age: "young" }, preview_url: "http://127.0.0.1:54321/veo-file.mp4" }] })); }
    if (u.pathname === "/__veofetchfail") { globalThis.veoFetchFail = true; res.writeHead(200); return res.end("ok"); }
    if (u.pathname === "/__failnext") { globalThis.failNext = true; res.writeHead(200); return res.end("ok"); }
    if (u.pathname === "/edit/stage/render" && req.method === "POST") {
      const edit = JSON.parse((await body(req)).toString());
      const id = "render-" + Date.now();
      fs.writeFileSync(`/var/tmp/ospg/edit-${id}.json`, JSON.stringify(edit, null, 2));
      const srcs = [];
      for (const tr of edit.timeline.tracks) for (const c of tr.clips) srcs.push(c.asset.src);
      if (edit.timeline.soundtrack) srcs.push(edit.timeline.soundtrack.src);
      const problems = [];
      for (const src of srcs) {
        try {
          const r = await fetch(src);
          const ct = r.headers.get("content-type") || "";
          if (!r.ok) problems.push(`${r.status} ${src.slice(0, 120)}`);
          else if (src.includes("/api/director/card") && !ct.includes("image/png")) problems.push(`not png: ${src.slice(0, 80)}`);
        } catch (e) {
          problems.push(`fetch failed ${src.slice(0, 80)}`);
        }
      }
      if (problems.length) {
        res.writeHead(400, { "content-type": "application/json" });
        return res.end(JSON.stringify({ success: false, message: "asset problems", problems }));
      }
      globalThis.renders = { ...(globalThis.renders ?? {}), [id]: 0 };
      if (globalThis.failNext) { globalThis.failing = { ...(globalThis.failing ?? {}), [id]: true }; globalThis.failNext = false; }
      // Like Shotstack: call back when the render is finished (unless told to stay quiet)
      if (edit.callback && !globalThis.noCallback) {
        setTimeout(() => {
          globalThis.renders[id] = 5;
          fs.appendFileSync("/var/tmp/ospg/callback.log", `${id} ${edit.callback}\n`);
          fetch(edit.callback, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, status: "done" }) }).catch(() => null);
        }, 2500);
      }
      res.writeHead(201, { "content-type": "application/json" });
      return res.end(JSON.stringify({ success: true, message: "Created", response: { id, message: "Render Successfully Queued" } }));
    }
    let rm = u.pathname.match(/^\/edit\/stage\/render\/(.+)$/);
    if (rm) {
      const n = (globalThis.renders[rm[1]] = (globalThis.renders[rm[1]] ?? 0) + 1);
      res.writeHead(200, { "content-type": "application/json" });
      if (n >= 2 && globalThis.failing?.[rm[1]]) return res.end(JSON.stringify({ success: true, response: { id: rm[1], status: "failed", error: "Asset could not be downloaded: clip-7.mp4 (403)" } }));
      return res.end(JSON.stringify({ success: true, response: n < 2 ? { id: rm[1], status: "rendering" } : { id: rm[1], status: "done", url: `http://127.0.0.1:54321/rendered/${rm[1]}.mp4`, poster: `http://127.0.0.1:54321/rendered/${rm[1]}.jpg` } }));
    }

    // fake Claude
    if (u.pathname === "/v1/messages") {
      const b = JSON.parse((await body(req)).toString());
      promptN++;
      // Content may be blocks (text + images): flatten for the stub's checks
      const blocks = Array.isArray(b.messages[0].content) ? b.messages[0].content : null;
      if (blocks) {
        const imgs = blocks.filter((x) => x.type === "image").length;
        fs.writeFileSync("/var/tmp/ospg/plan-images.json", JSON.stringify({ images: imgs, labels: blocks.filter((x) => x.type === "text" && x.text.startsWith("CLIP ")).map((x) => x.text) }));
        b.messages[0].content = blocks.map((x) => (x.type === "text" ? x.text : "[image]")).join("\n");
      }
      // The fact check's calls are kept apart, so "the last prompt" is still the writer's
      const checking = b.tools?.some((t) => t.name === "report_problems" || t.name === "fix_lines");
      fs.writeFileSync(`/var/tmp/ospg/${checking ? "check" : "prompt"}-${promptN}.txt`, `MODEL ${b.model}\nSYSTEM\n${b.system}\n\nUSER\n${b.messages[0].content}`);
      const said = String(b.messages[0].content);
      const reply = (text, extra = {}) => { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ id: "msg", type: "message", role: "assistant", model: b.model, content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 }, ...extra })); };
      // The fact check: a sentence with WRONGFACT in it doesn't match. The fix puts it right, unless it's STUBBORN.
      if (b.tools?.some((t) => t.name === "report_problems")) {
        const only = said.match(/Check ONLY sentences ([\d, ]+);/)?.[1]?.split(",").map((x) => Number(x.trim()));
        const lines = [...said.split("THE SENTENCES\n")[1].matchAll(/^(\d+)\. (.*)$/gm)].map((m) => ({ n: Number(m[1]), text: m[2] }));
        const problems = lines.filter((l) => /WRONGFACT/.test(l.text) && (!only || only.includes(l.n))).map((l) => ({ n: l.n, why: "the card doesn't say that" }));
        fs.appendFileSync("/var/tmp/ospg/factchecks.log", JSON.stringify({ n: promptN, lines: lines.length, only: only ?? null, problems }) + "\n");
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ id: "msg_" + promptN, type: "message", role: "assistant", model: b.model, stop_reason: "tool_use", usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "tool_use", id: "tu_" + promptN, name: "report_problems", input: { problems } }] }));
      }
      if (b.tools?.some((t) => t.name === "fix_lines")) {
        const lines = [...said.split("These sentences don't match the facts:\n")[1].matchAll(/^(\d+)\. (.*)$/gm)].map((m) => ({ n: Number(m[1]), text: /STUBBORN/.test(m[2]) ? m[2] : m[2].replace(/WRONGFACT ?/g, "") }));
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ id: "msg_" + promptN, type: "message", role: "assistant", model: b.model, stop_reason: "tool_use", usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "tool_use", id: "tu_" + promptN, name: "fix_lines", input: { lines } }] }));
      }
      // Course research (research.ts): find, map the club's site, read pages in batches, look for more
      if (said.includes("Find the web pages that describe this golf course: its holes and its history")) {
        fs.appendFileSync("/var/tmp/ospg/research.log", "find " + JSON.stringify(b.tools ?? null) + "\n");
        globalThis.lastCard = Object.fromEntries([...said.matchAll(/(\d+): par (\d)/g)].map((m) => [m[1], Number(m[2])]));
        if (said.includes("Nowhere")) return reply(JSON.stringify({ official: "", pages: [] }));
        if (said.includes("Slowcourse")) { await new Promise((r) => setTimeout(r, 4000)); return reply(JSON.stringify({ official: "", pages: [{ url: "https://example.com/course-guide", kind: "holes" }] })); }
        if (!said.includes("Birr")) return reply(JSON.stringify({ official: "", pages: [{ url: "https://example.com/course-guide", kind: "holes" }] }));
        return reply("Found: " + JSON.stringify({ official: "https://birrgolfclub.ie/", pages: [
          { url: "https://www.top100golfcourses.com/birr", kind: "review" },
          { url: "https://wrongcourse.example.org/birr-links", kind: "holes" },
        ] }));
      }
      if (said.includes("Find the course pages on the website of")) {
        fs.appendFileSync("/var/tmp/ospg/research.log", "map " + JSON.stringify(b.tools ?? null) + "\n");
        const pages = Array.from({ length: 18 }, (_, i) => ({ url: `https://birrgolfclub.ie/course/hole-${i + 1}`, kind: "hole", hole: i + 1 }));
        pages.push({ url: "https://birrgolfclub.ie/history", kind: "history" }, { url: "https://elsewhere.example.com/x", kind: "course" });
        return reply(JSON.stringify({ pages }));
      }
      if (said.includes("Find more web pages about the golf course")) {
        fs.appendFileSync("/var/tmp/ospg/research.log", "more\n");
        return reply(JSON.stringify({ pages: [] }));
      }
      if (said.includes("OUR SCORECARD (hole: par, lengths from each tee)") && /Read th(is page|ese pages) and report/.test(said)) {
        const pages = [...said.matchAll(/PAGE: (\S+)/g)].map((m) => m[1]);
        fs.appendFileSync("/var/tmp/ospg/research.log", "read " + pages.join(" ") + " " + JSON.stringify((b.tools ?? []).map((t) => t.allowed_domains)) + "\n");
        const c = globalThis.lastCard || {};
        const holes = {};
        for (const pg of pages) {
          const m = pg.match(/hole-(\d+)$/);
          // The club gives lengths from the white tees (longer than the card's first tee): still kept
          if (m && Number(m[1]) !== 13) holes[m[1]] = { par: c[m[1]], length: { 3: 175, 4: 390, 5: 520 }[c[m[1]]] ?? null, unit: "yards", note: `Club note for hole ${m[1]}.` };
        }
        if (pages.some((x) => x.includes("/history"))) return reply(JSON.stringify({ sameCourse: true, overview: "", history: "Founded in 1893; the course was laid out on eskers in the 1900s.", signature: "", holes: {} }));
        if (pages.some((x) => x.includes("top100"))) return reply(JSON.stringify({ sameCourse: true, overview: "Parkland in the Midlands, laid out on glacial eskers.", history: "", signature: "The 7th from its elevated tee.", holes: { 13: { par: c[13], length: null, note: "Review note for hole 13." } } }));
        if (pages.some((x) => x.includes("wrongcourse"))) {
          for (let h = 1; h <= 18; h++) holes[h] = { par: c[h] === 3 ? 5 : 3, length: 400, unit: "yards", note: `Wrong course ${h}` };
          return reply(JSON.stringify({ sameCourse: true, overview: "A seaside links.", holes }));
        }
        if (pages.some((x) => x.includes("example.com/course-guide"))) return reply(JSON.stringify({ sameCourse: true, overview: "A test course on the cliffs.", holes: { 6: { par: c[6], length: null, note: "Drive over the cliffs." } } }));
        if (!Object.keys(holes).length) return reply("Couldn't read it.");
        return reply(JSON.stringify({ sameCourse: true, overview: "", history: "", signature: "", holes }));
      }
      if (said.includes("Find web pages that describe this golf course HOLE BY HOLE")) {
        fs.writeFileSync("/var/tmp/ospg/guide-search.json", JSON.stringify({ tools: b.tools ?? null }));
        if (said.includes("Nowhere")) return reply(JSON.stringify({ pages: [] }));
        globalThis.lastCard = Object.fromEntries([...said.matchAll(/(\d+): par (\d)/g)].map((m) => [m[1], Number(m[2])]));
        if (!said.includes("Birr")) return reply(JSON.stringify({ pages: [{ url: "https://example.com/course-guide", official: true, why: "the club's guide" }] }));
        if (said.includes("Slowcourse")) { await new Promise((r) => setTimeout(r, 200)); return reply("I couldn't find anything useful."); }
        return reply("Found these: " + JSON.stringify({ pages: [
          { url: "https://example.com/review", official: false, why: "a review" },
          { url: "https://birrgolfclub.ie/course-guide", official: true, why: "the club's own guide" },
          { url: "https://wrongcourse.example.org/birr-links", official: false, why: "similar name" },
        ] }));
      }
      if (said.includes("Read this page and report")) {
        const page = (said.match(/PAGE: (\S+)/) || [])[1] || "";
        fs.appendFileSync("/var/tmp/ospg/guide-reads.log", page + " " + JSON.stringify(b.tools ?? null) + "\n");
        const pars = [4,4,3,5,4,4,3,4,5,4,4,3,5,4,4,3,4,5];
        const holes = {};
        if (page.includes("birrgolfclub")) {
          // Holes 1-12 from the club, with lengths in metres; hole 12 has the wrong par (so it's dropped)
          for (let h = 1; h <= 12; h++) holes[h] = { par: h === 12 ? 4 : pars[h - 1], length: 360, unit: "metres", note: `Club note for hole ${h}.` };
          holes[3] = { par: 3, length: 160, unit: "metres", note: "Short hole over the stream." };
          holes[7] = { par: 3, length: 150, unit: "metres", note: "Elevated tee to a two-tier green." };
          holes[9] = { par: 5, length: 470, unit: "metres", note: "Long par 5 doglegging left." };
          return reply(JSON.stringify({ sameCourse: true, overview: "Parkland course in the Midlands, laid out on glacial eskers.", signature: "The 7th from its elevated tee.", holes }));
        }
        if (page.includes("example.com/course-guide")) {
          const c = globalThis.lastCard || {};
          return reply(JSON.stringify({ sameCourse: true, overview: "A test course on the cliffs.", signature: "The 6th over the sea.", holes: { 6: { par: c[6], length: null, note: "Drive over the cliffs." }, 19: { par: 4, note: "bogus hole" }, 7: { par: c[7], note: "" } } }));
        }
        if (page.includes("example.com/review")) {
          // A review that knows 13-18 (and has a made-up par on hole 1 that's ignored: the club already covered it)
          for (let h = 13; h <= 18; h++) holes[h] = { par: pars[h - 1], length: null, unit: null, note: `Review note for hole ${h}.` };
          return reply(JSON.stringify({ sameCourse: true, overview: "", signature: "", holes }));
        }
        if (page.includes("wrongcourse")) {
          for (let h = 1; h <= 18; h++) holes[h] = { par: 4, length: 400, unit: "yards", note: `Wrong course ${h}` };
          return reply(JSON.stringify({ sameCourse: true, overview: "A seaside links.", signature: "", holes }));
        }
        return reply("Nothing there.");
      }
      if (String(b.messages[0].content).includes("Research this golf course")) {
        fs.writeFileSync("/var/tmp/ospg/guide-req.json", JSON.stringify({ tools: b.tools ?? null }));
        const guide = { overview: "A test course on the cliffs.", signature: "The 6th over the sea.", holes: { "6": "Drive over the cliffs.", "19": "bogus hole", "7": "" }, sources: ["https://example.com/course-guide", "not a url"], warnings: "Card numbering matches." };
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ id: "msg", type: "message", role: "assistant", model: b.model, content: [{ type: "text", text: "Here it is: " + JSON.stringify(guide) }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } }));
      }
      if (/short marketing emails for MyGolfBroadcast/.test(String(b.system))) {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ id: "msg_" + promptN, type: "message", role: "assistant", model: b.model, stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 10 },
          content: [{ type: "text", text: JSON.stringify({ subject: "A spring offer on your film", headline: "Your trip, as a film", paragraphs: ["Hi {first name}, this spring a highlights film of your trip costs less.", "The offer runs to the end of April."], button: "See the offer" }) }] }));
      }
      if (/You correct speech-to-text/.test(String(b.system))) {
        const t = String(b.messages[0].content).split("Transcript: ")[1] ?? "";
        const fixed = t.replace(/^neil/, "Neil").replace("birdy", "birdie") + ".";
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ id: "msg", type: "message", role: "assistant", model: b.model, content: [{ type: "text", text: fixed }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } }));
      }
      if (/You tighten lines/.test(String(b.system))) {
        const out = {};
        for (const m of String(b.messages[0].content).matchAll(/^(\S+:(?:voice|payoff)) \([^)]*\): (.*)$/gm)) {
          const tag = m[2].match(/^\[[a-z ]+\]\s*/i)?.[0] ?? "";
          out[m[1]] = tag + m[2].slice(tag.length).split(/\s+/).slice(0, 2).join(" ").replace(/[,.]$/, "") + ".";
        }
        fs.appendFileSync("/var/tmp/ospg/tighten.log", JSON.stringify(out) + "\n");
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ id: "msg", type: "message", role: "assistant", model: b.model, content: [{ type: "text", text: JSON.stringify(out) }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } }));
      }
      if (/film editor|highlights package/.test(String(b.system))) {
        if (b.messages.length > 1) fs.writeFileSync("/var/tmp/ospg/plan-retry.txt", String(b.messages.at(-1).content));
        if (globalThis.badPlan) {
          globalThis.badPlan = false;
          res.writeHead(200, { "content-type": "application/json" });
          return res.end(JSON.stringify({ id: "msg", type: "message", role: "assistant", model: b.model, content: [{ type: "text", text: 'Here is the plan: {"mood": "epic", "chapters": [{"round": 1, "clips": [' }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } }));
        }
        const clips = JSON.parse(b.messages[0].content.match(/AVAILABLE CLIPS \(JSON\)[^\n]*\n(\[.*\])/)[1]);
        const asides = JSON.parse(b.messages[0].content.match(/OFF-COURSE CLIPS \(JSON\)[^\n]*\n(\[.*\])/)?.[1] ?? "[]");
        const wide = String(b.messages[0].content).match(/filmed wide: ([^.]+)\./)?.[1]?.split(", ") ?? [];
        const tagged = b.messages[0].content.includes("delivery tag");
        const rounds = [...new Set(clips.map((c) => c.round))];
        const aside = (a) => ({ id: a.id, caption: `${a.people.join(" & ") || a.by} · ${a.type.toLowerCase()}`, intro: a.type === "Prediction" ? "Before a ball was struck, a bold call." : "Afterwards, a word from the winner.", in: 0, out: 6 });
        const plan = {
          buildUp: asides.filter((a) => a.when === "before Round 1").map(aside),
          focus: Object.fromEntries(wide.map((id) => [id.trim(), 0.3])),
          subtitle: "Seven rounds, one grudge",
          openingVoice: "Seven rounds. Two men. One very long week in the wind.",
          closingVoice: "And so it ends, as it began: in an argument about putts.",
          chapters: rounds.map((r) => ({ round: r, intro: `Round ${r}, and the nerves are showing.`, resultVoice: "The points are banked.", afterClips: asides.filter((a) => a.round === r && a.when !== "before Round 1").map(aside), clips: clips.filter((c) => c.round === r).map((c, i) => ({ id: c.id, caption: `Hole ${c.hole} · ${c.by}`, sub: c.tags.join(", ") || "Shot of the day", setup: i === 1 ? "Downhill, twelve feet, left to right, for the half and a share of the hole" : tagged ? "[whispers] Watch this." : "Watch this.", payoff: "In it goes!", replay: c.tags.includes("chip-in"), replayLine: c.tags.includes("chip-in") ? "Watch it drop." : "" })) })),
          veo: [{ place: "opening", prompt: "Slow drone glide over a misty parkland fairway at dawn" }],
        };
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ id: "msg", type: "message", role: "assistant", model: b.model, content: [{ type: "text", text: JSON.stringify(plan) }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } }));
      }
      const task = b.messages[0].content.match(/Write a(n)? ([A-Z -]+)/)?.[2] ?? "PIECE";
      const content0 = String(b.messages[0].content);
      // Mirror the real API for this model: forced tool choice is rejected
      if (b.tool_choice && ["tool", "any"].includes(b.tool_choice.type)) {
        res.writeHead(400, { "content-type": "application/json" });
        return res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: 'tool_choice: type "tool" and "any" are not supported for this model.' } }));
      }
      // Sometimes answer in plain text instead of the tool
      if (content0.includes("PLAINTEXT")) {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ id: "msg_" + promptN, type: "message", role: "assistant", model: b.model, stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "text", text: "Title: Ignored\n\n## Round One\n\nA **plain** answer with no tool." }] }));
      }
      if (b.tools?.some((t) => t.name === "publish_article") && !content0.includes("BROKENJSON")) {
        fs.writeFileSync("/var/tmp/ospg/last-tools.json", JSON.stringify({ tools: b.tools, tool_choice: b.tool_choice }));
        const md = content0.includes("MARKDOWN");
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ id: "msg_" + promptN, type: "message", role: "assistant", model: b.model, stop_reason: "tool_use", usage: { input_tokens: 1, output_tokens: 1 },
          content: [{ type: "tool_use", id: "tu_" + promptN, name: "publish_article", input: {
            title: md ? "**Heath** and heartache" : `Test ${task.trim().toLowerCase()} #${promptN}`,
            body: md
              ? "## The Week Ahead\n\n**Oisin** arrives with the *edge*.\n\n- Neil has a new driver"
              : content0.includes("FACTTEST")
                ? `First paragraph of the ${task.trim().toLowerCase()}. Neil holed a WRONGFACT 40-footer on the 3rd.\n\nPaddy made a STUBBORN WRONGFACT eagle on the 9th. Second paragraph with more detail.`
                : `First paragraph of the ${task.trim().toLowerCase()}.\n\nSecond paragraph with more detail.`,
            ...(b.tools.find((t) => t.name === "publish_article").input_schema.properties.storylines ? { storylines: ["Neil's driver", "Paddy's lead let slip"] } : {}),
          } }] }));
      }
      if (content0.includes("BROKENJSON")) {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ id: "msg_" + promptN, type: "message", role: "assistant", model: b.model, stop_reason: "max_tokens", usage: { input_tokens: 1, output_tokens: 1 },
          content: [{ type: "text", text: '{"title": "A \\"quoted\\" week", "body": "Opening para.\\n\\nSecond para, cut off mid' }] }));
      }
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(
        JSON.stringify({
          id: "msg_" + promptN,
          type: "message",
          role: "assistant",
          model: b.model,
          content: [{ type: "text", text: JSON.stringify({ title: `Test ${task.trim().toLowerCase()} #${promptN}`, body: `First paragraph of the ${task.trim().toLowerCase()}.\n\nSecond paragraph with more detail.` }) }],
          stop_reason: "end_turn",
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      );
    }
    res.writeHead(404);
    res.end("stub: not found " + u.pathname);
  })
  .listen(54321, () => console.log("stub on 54321"));
