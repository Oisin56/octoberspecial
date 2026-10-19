// Test mailbox: accepts SMTP with any login and saves each message as JSON
import { SMTPServer } from "smtp-server";
import { simpleParser } from "mailparser";
import fs from "node:fs";
fs.mkdirSync("/var/tmp/ospg/mail", { recursive: true });
let n = 0;
new SMTPServer({
  authOptional: false,
  allowInsecureAuth: true,
  disabledCommands: ["STARTTLS"],
  onAuth(auth, _s, cb) { auth.username === "me@test.ie" && auth.password === "app-pass" ? cb(null, { user: auth.username }) : cb(new Error("Invalid login")); },
  async onData(stream, session, cb) {
    const m = await simpleParser(stream);
    fs.writeFileSync(`/var/tmp/ospg/mail/${Date.now()}-${++n}.json`, JSON.stringify({ to: session.envelope.rcptTo.map((r) => r.address), from: m.from?.text, subject: m.subject, html: m.html, text: m.text, headers: Object.fromEntries([...m.headers].map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)])) }));
    cb();
  },
}).listen(2525, "127.0.0.1", () => console.log("smtp on 2525"));
