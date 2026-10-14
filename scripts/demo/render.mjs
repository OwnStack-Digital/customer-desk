// Render caption PNGs, assemble H.264 video, mix narration audio-only, then mux.

import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const { chromium } = await import(
  process.env.PLAYWRIGHT_PATH
    ? pathToFileURL(process.env.PLAYWRIGHT_PATH).href
    : "playwright"
);
const build = resolve(
  process.env.DEMO_BUILD_DIR || join(tmpdir(), "bos-video-demo"),
);
const out = resolve(process.env.DEMO_OUTPUT_DIR || "artifacts/demo");
for (const dir of ["clips", "caps"])
  await mkdir(`${build}/${dir}`, { recursive: true });
await mkdir(out, { recursive: true });
const shots = JSON.parse(await readFile(`${build}/recorded.json`, "utf8"));
const voices = JSON.parse(await readFile(`${build}/voice.json`, "utf8"));
const run = (args) =>
  execFileSync("ffmpeg", ["-y", "-v", "warning", ...args], {
    stdio: ["ignore", "ignore", "pipe"],
  });
const duration = (file) =>
  Number(
    execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        file,
      ],
      { encoding: "utf8" },
    ).trim(),
  );
const escapeHtml = (s) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
for (const shot of shots) {
  await page.setContent(
    `<style>body{margin:0;background:transparent;font-family:Arial,sans-serif}.cap{position:absolute;left:32px;bottom:26px;background:#244d43f2;color:#fff;padding:17px 24px;border-radius:12px;box-shadow:0 4px 16px #0002;font-size:24px;display:flex;gap:20px;align-items:center}.n{font-size:12px;letter-spacing:2px;color:#c6ded3;border-right:1px solid #749589;padding-right:20px}.tag{position:absolute;right:28px;top:23px;color:#365f53;background:#f1f7f1ed;border:1px solid #d0e0d6;border-radius:7px;padding:9px 13px;font-size:12px;letter-spacing:1.5px}</style><div class="tag">LIVE AI · LOCAL DEMO</div><div class="cap"><span class="n">OWNSTACK / ${String(shot.id).padStart(2, "0")}</span><span>${escapeHtml(shot.title)}</span></div>`,
  );
  await page.screenshot({
    path: `${build}/caps/${shot.id}.png`,
    omitBackground: true,
  });
}
await page.setContent(
  `<style>body{margin:0;background:#234f43;color:#f3f5ed;font-family:Arial,sans-serif}.wrap{height:900px;display:flex;justify-content:center;flex-direction:column;padding:0 140px;box-sizing:border-box}.logo{font-weight:700;font-size:34px;letter-spacing:-1px}.label{color:#a4cabc;letter-spacing:4px;font-size:14px;margin-top:64px}h1{font-size:74px;line-height:1.13;letter-spacing:-3px;margin:25px 0 20px;font-weight:600}.sub{font-size:25px;color:#cae0d4;line-height:1.6}.foot{position:absolute;bottom:56px;left:140px;color:#a4cabc;font-size:15px;letter-spacing:.4px}</style><div class="wrap"><div class="logo">ownstack.</div><div class="label">BUSINESS OPERATIONS, WITH YOU IN CONTROL</div><h1>AI handles preparation.<br>You own the decision.</h1><div class="sub">Quotes. Customer requests. Human review.</div></div><div class="foot">Local demo · Live AI · Synthetic customer data · No email delivery</div>`,
);
await page.screenshot({ path: `${build}/caps/end.png` });
await browser.close();
const timeline = [];
let start = 0;
for (const shot of shots) {
  const rawDuration = duration(shot.raw);
  const trim = Math.max(0, rawDuration - shot.duration);
  const clip = `${build}/clips/${String(shot.id).padStart(2, "0")}.mp4`;
  const frames = Math.ceil(shot.duration * 30);
  const seconds = frames / 30;
  const args = [
    "-ss",
    String(trim),
    "-i",
    shot.raw,
    "-loop",
    "1",
    "-i",
    `${build}/caps/${shot.id}.png`,
  ];
  let graph = "[0:v]fps=30,setsar=1[v];[v][1:v]overlay=0:0";
  if (shot.id === 9) {
    args.push("-loop", "1", "-i", `${build}/caps/end.png`);
    graph += `[captioned];[captioned][2:v]overlay=0:0:enable='gte(t,${Math.max(0, seconds - 6)})'`;
  }
  args.push(
    "-filter_complex",
    graph,
    "-frames:v",
    String(frames),
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    "19",
    "-pix_fmt",
    "yuv420p",
    clip,
  );
  run(args);
  const voice = voices.find((v) => v.id === shot.id);
  if (0.35 + voice.duration > seconds)
    throw new Error(`Voice overruns scene ${shot.id}`);
  timeline.push({
    ...shot,
    clip,
    start,
    seconds,
    voiceStart: start + 0.35,
    voiceEnd: start + 0.35 + voice.duration,
    voice,
  });
  start += seconds;
  console.log(
    `Scene ${shot.id}: ${seconds.toFixed(2)}s, VO ${timeline.at(-1).voiceStart.toFixed(2)}–${timeline.at(-1).voiceEnd.toFixed(2)}`,
  );
}
await writeFile(
  `${build}/concat.txt`,
  timeline.map((s) => `file '${s.clip}'`).join("\n"),
);
run([
  "-f",
  "concat",
  "-safe",
  "0",
  "-i",
  `${build}/concat.txt`,
  "-c",
  "copy",
  `${build}/silent.mp4`,
]);
// Never mix voices in the same graph as the video stream: avoids displaced AAC packets.
const inputs = [];
const filters = [];
for (let i = 0; i < timeline.length; i++) {
  const t = timeline[i];
  inputs.push("-i", t.voice.file);
  filters.push(
    `[${i}:a]aresample=48000,loudnorm=I=-16:TP=-1.5:LRA=11,aformat=sample_rates=48000:channel_layouts=stereo,adelay=${Math.round(t.voiceStart * 1000)}|${Math.round(t.voiceStart * 1000)}[a${i}]`,
  );
}
filters.push(
  `${timeline.map((_, i) => `[a${i}]`).join("")}amix=inputs=${timeline.length}:duration=longest:normalize=0,apad=whole_dur=${start}[mix]`,
);
run([
  ...inputs,
  "-filter_complex",
  filters.join(";"),
  "-map",
  "[mix]",
  "-t",
  String(start),
  "-c:a",
  "pcm_s16le",
  `${build}/voice-track.wav`,
]);
const final = `${out}/ownstack-demo.mp4`;
run([
  "-i",
  `${build}/silent.mp4`,
  "-i",
  `${build}/voice-track.wav`,
  "-map",
  "0:v:0",
  "-map",
  "1:a:0",
  "-c:v",
  "copy",
  "-c:a",
  "aac",
  "-b:a",
  "192k",
  "-movflags",
  "+faststart",
  "-shortest",
  final,
]);
await writeFile(`${build}/timeline.json`, JSON.stringify(timeline, null, 2));
// Sentence-length accessibility subtitles, aligned proportionally within each spoken scene.
const time = (s) => {
  const ms = Math.round(s * 1000);
  return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
};
let index = 1;
const subtitles = [];
for (const t of timeline) {
  const sentences = t.voice.text.match(/[^.!?]+[.!?]+|[^.!?]+$/g);
  const total = sentences.reduce((n, s) => n + s.length, 0);
  let pos = t.voiceStart;
  for (const line of sentences) {
    const end = pos + (t.voice.duration * line.length) / total;
    subtitles.push(
      `${index++}\n${time(pos)} --> ${time(end)}\n${line.trim()}\n`,
    );
    pos = end;
  }
}
await writeFile(`${out}/ownstack-demo.srt`, subtitles.join("\n"));
console.log(
  `Rendered ${final} (${duration(final).toFixed(2)} seconds). Check each final audio segment with verify.py.`,
);
