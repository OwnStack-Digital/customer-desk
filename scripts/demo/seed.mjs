// Seeds only a disposable local demo. Never point this at production.
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

if (!process.env.DEMO_INGRESS_KEY)
  throw new Error("Supply DEMO_INGRESS_KEY for the disposable demo API");
const api = process.env.DEMO_API_URL || "http://127.0.0.1:43101";
if (!["127.0.0.1", "localhost"].includes(new URL(api).hostname))
  throw new Error("Local demo only");
const out = resolve(
  process.env.DEMO_BUILD_DIR || join(tmpdir(), "bos-video-demo"),
);
const examples = [
  [
    "quote",
    "Emma Wilson",
    "emma@example.test",
    "Quote for my home in Balmain",
    "Hi, could I please get a quote for a one-time occupied home clean: 3 bedrooms, 2 bathrooms, 1 kitchen and 1 living area? We live in Balmain. Thanks, Emma.",
  ],
  [
    "faq",
    "Oliver Chen",
    "oliver@example.test",
    "Your hours and service areas",
    "Hi, what are your opening hours, and which service areas do you cover? Thanks, Oliver.",
  ],
  [
    "service",
    "Mia Thompson",
    "mia@example.test",
    "Please reschedule my clean",
    "Hi, please reschedule my home clean from Thursday to Friday morning. My address is 12 Demo Street, Balmain. Can you confirm availability? Thanks, Mia.",
  ],
  [
    "complaint",
    "Noah Patel",
    "noah@example.test",
    "Unhappy with the last clean",
    "I am unhappy with the last clean. The kitchen surfaces were missed. Please have a manager contact me to resolve this complaint.",
  ],
  [
    "other",
    "Ava Martin",
    "ava@example.test",
    "A question for your team",
    "Could your team sponsor our local community fundraiser? Please let me know who I should speak with.",
  ],
  [
    "noise",
    "Newsletter",
    "noreply@example.test",
    "Monthly newsletter - unsubscribe",
    "This automated newsletter is not a customer request. To unsubscribe, update your subscription preferences.",
  ],
];
await mkdir(out, { recursive: true });
const manifest = {};
for (const [key, name, address, subject, text] of examples) {
  const payload = {
    mailboxId: "mbx_harbour_pine",
    sourceMessageId: `video-${Date.now()}-${key}`,
    messageId: `<video-${Date.now()}-${key}@example.test>`,
    from: { address, name },
    to: ["hello@harbourandpine.example"],
    subject,
    text,
    receivedAt: new Date().toISOString(),
  };
  const response = await fetch(`${api}/inbound/emails`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.DEMO_INGRESS_KEY}`,
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok)
    throw new Error(`Seed ${key}: ${response.status} ${await response.text()}`);
  manifest[key] = { ...(await response.json()), subject };
  console.log(key, JSON.stringify(manifest[key]));
  await writeFile(`${out}/seed.json`, JSON.stringify(manifest, null, 2));
}
