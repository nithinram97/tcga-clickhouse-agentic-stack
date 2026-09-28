#!/usr/bin/env node
/**
 * text-to-qr v2 — pack a large text (or any) file into QR codes and restore it.
 *
 *   split    file -> numbered static QR PNGs (print them / scan one by one)
 *   animate  file -> looping animated GIF of fountain-coded QR frames
 *            (receiver can start anywhere and miss frames — it just needs "enough")
 *   join     PNG folder / .gif / single PNG -> original file (auto-detects mode)
 *
 * Improvements over v1:
 *   - raw binary in QR byte mode (no base64 → ~33% more data per code)
 *   - Brotli (quality 11, text mode) instead of deflate
 *   - error-correction level L by default (~20% more capacity than M)
 *
 * Usage:
 *   npx tsx text-to-qr.ts split   big.txt --out qr_out [--chunk 1200] [--ec L] [--scale 6]
 *   npx tsx text-to-qr.ts animate big.txt --out qr_anim [--block 600] [--fps 5] [--repair 0.5] [--png]
 *   npx tsx text-to-qr.ts join    qr_out            --out restored.txt
 *   npx tsx text-to-qr.ts join    qr_anim/anim.gif  --out restored.txt
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { extname, join as pathJoin } from "node:path";
import { brotliCompressSync, brotliDecompressSync, constants as zc } from "node:zlib";
import QRCode from "qrcode";
import { PNG } from "pngjs";

// jsqr and omggif ship CommonJS; require() keeps them working under any TS module setting
const require = createRequire(import.meta.url);
const jsQR: typeof import("jsqr").default = require("jsqr");
const { GifReader, GifWriter }: typeof import("omggif") = require("omggif");

type EcLevel = "L" | "M" | "Q" | "H";

// ─────────────────────────── binary packet format ───────────────────────────
// Every QR holds one packet (big-endian):
//   0  "QT"        magic
//   2  u8  2       format version
//   3  u8  kind    0 = sequential chunk, 1 = fountain frame
//   4  4 bytes     file id (first 4 bytes of SHA-256 of the ORIGINAL file)
//   8  u8  flags   bit0 = payload is Brotli-compressed
// kind 0:  9 u16 index (1-based), 11 u16 total                       → header 13
// kind 1:  9 u16 K (blocks), 11 u16 block size, 13 u32 data length,
//         17 u32 seed                                                → header 21

const MAGIC = Buffer.from("QT");
const FORMAT = 2;
const SEQ_HEADER = 13;
const FTN_HEADER = 21;
const QR_MAX_BYTES: Record<EcLevel, number> = { L: 2953, M: 2331, Q: 1663, H: 1273 };

interface Common { fileId: string; brotli: boolean; payload: Buffer }
interface SeqPacket extends Common { kind: 0; index: number; total: number }
interface FtnPacket extends Common { kind: 1; k: number; blockSize: number; dataLen: number; seed: number }
type Packet = SeqPacket | FtnPacket;

function baseHeader(kind: 0 | 1, fileId: Buffer, brotli: boolean, size: number): Buffer {
  const h = Buffer.alloc(size);
  MAGIC.copy(h, 0);
  h.writeUInt8(FORMAT, 2);
  h.writeUInt8(kind, 3);
  fileId.copy(h, 4, 0, 4);
  h.writeUInt8(brotli ? 1 : 0, 8);
  return h;
}

function seqPacket(fileId: Buffer, brotli: boolean, index: number, total: number, payload: Buffer): Buffer {
  const h = baseHeader(0, fileId, brotli, SEQ_HEADER);
  h.writeUInt16BE(index, 9);
  h.writeUInt16BE(total, 11);
  return Buffer.concat([h, payload]);
}

function ftnPacket(fileId: Buffer, brotli: boolean, k: number, blockSize: number, dataLen: number,
                   seed: number, payload: Buffer): Buffer {
  const h = baseHeader(1, fileId, brotli, FTN_HEADER);
  h.writeUInt16BE(k, 9);
  h.writeUInt16BE(blockSize, 11);
  h.writeUInt32BE(dataLen, 13);
  h.writeUInt32BE(seed, 17);
  return Buffer.concat([h, payload]);
}

function parsePacket(buf: Buffer): Packet | null {
  if (buf.length < SEQ_HEADER || !buf.subarray(0, 2).equals(MAGIC) || buf[2] !== FORMAT) return null;
  const common = { fileId: buf.subarray(4, 8).toString("hex"), brotli: (buf[8] & 1) === 1 };
  if (buf[3] === 0) {
    return { ...common, kind: 0, index: buf.readUInt16BE(9), total: buf.readUInt16BE(11),
             payload: buf.subarray(SEQ_HEADER) };
  }
  if (buf[3] === 1 && buf.length >= FTN_HEADER) {
    return { ...common, kind: 1, k: buf.readUInt16BE(9), blockSize: buf.readUInt16BE(11),
             dataLen: buf.readUInt32BE(13), seed: buf.readUInt32BE(17), payload: buf.subarray(FTN_HEADER) };
  }
  return null;
}

// ─────────────────────────── compression ───────────────────────────

function pack(raw: Buffer): { data: Buffer; brotli: boolean; fileId: Buffer } {
  const fileId = createHash("sha256").update(raw).digest().subarray(0, 4);
  const compressed = brotliCompressSync(raw, {
    params: {
      [zc.BROTLI_PARAM_QUALITY]: 11,
      [zc.BROTLI_PARAM_MODE]: zc.BROTLI_MODE_TEXT,
      [zc.BROTLI_PARAM_LGWIN]: 24,
      [zc.BROTLI_PARAM_SIZE_HINT]: raw.length,
    },
  });
  // tiny or already-compressed input: store as-is if Brotli doesn't help
  return compressed.length < raw.length
    ? { data: compressed, brotli: true, fileId }
    : { data: raw, brotli: false, fileId };
}

function unpack(data: Buffer, brotli: boolean, fileId: string): Buffer {
  const raw = brotli ? brotliDecompressSync(data) : data;
  const actual = createHash("sha256").update(raw).digest().subarray(0, 4).toString("hex");
  if (actual !== fileId) throw new Error("Checksum mismatch — restored data is corrupted.");
  return raw;
}

// ─────────────────────────── QR rendering ───────────────────────────

interface Bitmap { dim: number; px: Uint8Array } // px: 1 = dark module pixel, 0 = white

function renderQr(bytes: Buffer, ec: EcLevel, scale: number, margin = 4): Bitmap {
  let qr = QRCode.create([{ data: bytes, mode: "byte" }], { errorCorrectionLevel: ec });
  // jsQR can't read version-23 symbols (phones/zxing can) — bump to 24 so our own decoder works too
  if (qr.version === 23) qr = QRCode.create([{ data: bytes, mode: "byte" }], { errorCorrectionLevel: ec, version: 24 });
  const { size, data } = qr.modules;
  const dim = (size + margin * 2) * scale;
  const px = new Uint8Array(dim * dim);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!data[y * size + x]) continue;
      const top = (y + margin) * scale;
      const left = (x + margin) * scale;
      for (let dy = 0; dy < scale; dy++) px.fill(1, (top + dy) * dim + left, (top + dy) * dim + left + scale);
    }
  }
  return { dim, px };
}

function writePng(file: string, bmp: Bitmap): void {
  const png = new PNG({ width: bmp.dim, height: bmp.dim });
  for (let i = 0; i < bmp.px.length; i++) {
    const v = bmp.px[i] ? 0 : 255;
    png.data[i * 4] = png.data[i * 4 + 1] = png.data[i * 4 + 2] = v;
    png.data[i * 4 + 3] = 255;
  }
  writeFileSync(file, PNG.sync.write(png));
}

function writeGif(file: string, frames: Bitmap[], fps: number): void {
  const dim = Math.max(...frames.map((f) => f.dim));
  const buf = Buffer.alloc(frames.length * (dim * dim + 4096) + 4096); // generous; 1-bit LZW shrinks a lot
  const gif = new GifWriter(buf, dim, dim, { loop: 0, palette: [0xffffff, 0x000000] });
  const delay = Math.max(2, Math.round(100 / fps)); // GIF delay is in 1/100 s
  const canvas = new Uint8Array(dim * dim);
  for (const f of frames) {
    canvas.fill(0);
    const off = Math.floor((dim - f.dim) / 2);
    for (let y = 0; y < f.dim; y++) canvas.set(f.px.subarray(y * f.dim, (y + 1) * f.dim), (y + off) * dim + off);
    // omggif's types say number[], but it only indexes the array — a Uint8Array works and is far lighter
    gif.addFrame(0, 0, dim, dim, canvas as unknown as number[], { delay });
  }
  writeFileSync(file, buf.subarray(0, gif.end()));
}

function decodeRgba(rgba: Uint8Array | Uint8ClampedArray, w: number, h: number): Buffer | null {
  const clamped = rgba instanceof Uint8ClampedArray ? rgba : new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.length);
  const res = jsQR(clamped, w, h, { inversionAttempts: "attemptBoth" });
  return res ? Buffer.from(res.binaryData) : null;
}

/** Yields raw QR payloads from a PNG, a GIF (every frame) or a folder of them. */
function* readQrPayloads(input: string): Generator<{ source: string; data: Buffer | null }> {
  const files = statSync(input).isDirectory()
    ? readdirSync(input).filter((f) => /\.(png|gif)$/i.test(f)).sort().map((f) => pathJoin(input, f))
    : [input];

  for (const file of files) {
    const ext = extname(file).toLowerCase();
    if (ext === ".png") {
      const png = PNG.sync.read(readFileSync(file));
      yield { source: file, data: decodeRgba(png.data, png.width, png.height) };
    } else if (ext === ".gif") {
      const reader = new GifReader(new Uint8Array(readFileSync(file)));
      const rgba = new Uint8Array(reader.width * reader.height * 4);
      for (let i = 0; i < reader.numFrames(); i++) {
        reader.decodeAndBlitFrameRGBA(i, rgba);
        yield { source: `${file}#${i + 1}`, data: decodeRgba(rgba, reader.width, reader.height) };
      }
    }
  }
}

// ─────────────────────────── fountain code (systematic, random-linear repair) ───────────────────────────
// Seeds 0..K-1 carry block[seed] unchanged; seeds ≥ K carry the XOR of a
// pseudo-random set of ~2·log2(K)+6 blocks (the seed alone reproduces the set).
// Any ~K + a few distinct frames — in any order, with any gaps — recover the
// file: easy cases resolve instantly by peeling, the rest by GF(2) elimination.

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function neighbors(seed: number, k: number): number[] {
  if (seed < k) return [seed];
  const rand = mulberry32(Math.imul(seed, 2654435761));
  const degree = Math.min(k, 2 * Math.ceil(Math.log2(k + 1)) + 6);
  const picked = new Set<number>();
  while (picked.size < degree) picked.add(Math.floor(rand() * k));
  return [...picked];
}

function xorInto(target: Buffer, src: Buffer): void {
  for (let i = 0; i < target.length; i++) target[i] ^= src[i];
}

class FountainDecoder {
  private blocks: (Buffer | null)[];
  private pending: { idx: Set<number>; data: Buffer }[] = [];
  private received: { seed: number; data: Buffer }[] = [];
  private seeds = new Set<number>();
  solved = 0;

  constructor(readonly k: number, readonly blockSize: number, readonly dataLen: number) {
    this.blocks = new Array<Buffer | null>(k).fill(null);
  }

  get done(): boolean { return this.solved === this.k; }

  add(seed: number, payload: Buffer): void {
    if (this.done || this.seeds.has(seed) || payload.length !== this.blockSize) return;
    this.seeds.add(seed);
    this.received.push({ seed, data: Buffer.from(payload) });
    this.pending.push({ idx: new Set(neighbors(seed, this.k)), data: Buffer.from(payload) });
    this.propagate();
  }

  private propagate(): void {
    let changed = true;
    while (changed) {
      changed = false;
      const next: typeof this.pending = [];
      for (const p of this.pending) {
        for (const i of [...p.idx]) {
          const b = this.blocks[i];
          if (b) { xorInto(p.data, b); p.idx.delete(i); }
        }
        if (p.idx.size === 1) {
          const [i] = p.idx;
          this.blocks[i] = p.data;
          this.solved++;
          changed = true;
        } else if (p.idx.size > 1) {
          next.push(p);
        }
      }
      this.pending = next;
    }
  }

  /** Peeling can stall even when the frames hold enough information; Gauss–Jordan over GF(2) finishes the job. */
  private eliminate(): void {
    const words = Math.ceil(this.k / 32);
    const rows = this.received.map(({ seed, data }) => {
      const bits = new Uint32Array(words);
      for (const i of neighbors(seed, this.k)) bits[i >>> 5] |= 1 << (i & 31);
      return { bits, data: Buffer.from(data) };
    });
    const pivotOf = new Array<number>(this.k).fill(-1);
    let r = 0;
    for (let col = 0; col < this.k && r < rows.length; col++) {
      const w = col >>> 5, m = 1 << (col & 31);
      let p = r;
      while (p < rows.length && !(rows[p].bits[w] & m)) p++;
      if (p === rows.length) continue; // column not covered — stays unknown
      [rows[r], rows[p]] = [rows[p], rows[r]];
      for (let q = 0; q < rows.length; q++) {
        if (q !== r && rows[q].bits[w] & m) {
          for (let j = 0; j < words; j++) rows[q].bits[j] ^= rows[r].bits[j];
          xorInto(rows[q].data, rows[r].data);
        }
      }
      pivotOf[col] = r++;
    }
    for (let col = 0; col < this.k; col++) {
      if (this.blocks[col] || pivotOf[col] < 0) continue;
      const row = rows[pivotOf[col]];
      const onlyThisCol = row.bits.every((v, j) => v === (j === col >>> 5 ? (1 << (col & 31)) >>> 0 : 0));
      if (onlyThisCol) {
        this.blocks[col] = row.data;
        this.solved++;
      }
    }
  }

  result(): Buffer {
    if (!this.done) this.eliminate();
    if (!this.done) throw new Error(`Fountain decode incomplete: ${this.solved}/${this.k} blocks — capture more frames.`);
    return Buffer.concat(this.blocks as Buffer[]).subarray(0, this.dataLen);
  }
}

// ─────────────────────────── commands ───────────────────────────

export function split(src: string, outDir: string, chunk = 1200, ec: EcLevel = "L", scale = 6): void {
  const max = QR_MAX_BYTES[ec] - SEQ_HEADER;
  if (chunk > max) throw new Error(`--chunk ${chunk} too big for EC ${ec}; max is ${max} bytes.`);

  const raw = readFileSync(src);
  const { data, brotli, fileId } = pack(raw);
  const total = Math.max(1, Math.ceil(data.length / chunk));
  if (total > 0xffff) throw new Error("File needs more than 65535 codes — increase --chunk.");

  mkdirSync(outDir, { recursive: true });
  const width = String(total).length;
  for (let i = 0; i < total; i++) {
    const packet = seqPacket(fileId, brotli, i + 1, total, data.subarray(i * chunk, (i + 1) * chunk));
    writePng(pathJoin(outDir, `qr_${String(i + 1).padStart(width, "0")}_of_${total}.png`),
             renderQr(packet, ec, scale));
  }
  console.log(`${raw.length.toLocaleString()} bytes -> ${data.length.toLocaleString()} ` +
              `(${brotli ? "brotli" : "stored"}) -> ${total} QR codes in ${outDir}/`);
}

export function animate(src: string, outDir: string, blockSize = 600, ec: EcLevel = "L", scale = 6,
                        fps = 5, repair = 0.5, writeFrames = false): void {
  const max = QR_MAX_BYTES[ec] - FTN_HEADER;
  if (blockSize > max) throw new Error(`--block ${blockSize} too big for EC ${ec}; max is ${max} bytes.`);

  const raw = readFileSync(src);
  const { data, brotli, fileId } = pack(raw);
  const k = Math.max(1, Math.ceil(data.length / blockSize));
  if (k > 0xffff) throw new Error("Too many blocks — increase --block.");

  const blocks: Buffer[] = [];
  for (let i = 0; i < k; i++) {
    const b = Buffer.alloc(blockSize); // last block zero-padded
    data.copy(b, 0, i * blockSize, (i + 1) * blockSize);
    blocks.push(b);
  }

  const frameCount = k + Math.ceil(k * repair) + (repair > 0 ? 2 : 0);
  const frames: Bitmap[] = [];
  for (let seed = 0; seed < frameCount; seed++) {
    const payload = Buffer.alloc(blockSize);
    for (const i of neighbors(seed, k)) xorInto(payload, blocks[i]);
    frames.push(renderQr(ftnPacket(fileId, brotli, k, blockSize, data.length, seed, payload), ec, scale));
  }

  mkdirSync(outDir, { recursive: true });
  const gifPath = pathJoin(outDir, "anim.gif");
  writeGif(gifPath, frames, fps);
  if (writeFrames) {
    const width = String(frameCount).length;
    frames.forEach((f, i) => writePng(pathJoin(outDir, `frame_${String(i + 1).padStart(width, "0")}.png`), f));
  }
  console.log(`${raw.length.toLocaleString()} bytes -> ${data.length.toLocaleString()} ` +
              `(${brotli ? "brotli" : "stored"}) -> ${k} blocks, ${frameCount} frames ` +
              `(~${(frameCount / fps).toFixed(1)} s per loop at ${fps} fps) -> ${gifPath}`);
}

export function join(input: string, outFile: string): void {
  let fileId: string | null = null;
  let brotli = false;
  const seq = new Map<number, Buffer>();
  let seqTotal = 0;
  let fountain: FountainDecoder | null = null;
  let read = 0, skipped = 0;

  for (const { source, data } of readQrPayloads(input)) {
    const p = data ? parsePacket(data) : null;
    if (!p) { skipped++; console.error(`skip: ${source} (no readable QT code)`); continue; }
    if (fileId && p.fileId !== fileId) { skipped++; console.error(`skip: ${source} (different file)`); continue; }
    fileId = p.fileId;
    brotli = p.brotli;
    read++;

    if (p.kind === 0) {
      seqTotal = p.total;
      seq.set(p.index, Buffer.from(p.payload));
    } else {
      fountain ??= new FountainDecoder(p.k, p.blockSize, p.dataLen);
      fountain.add(p.seed, p.payload);
      if (fountain.done) break; // enough frames — stop early
    }
  }

  if (!fileId) throw new Error("No QT QR codes found.");

  let data: Buffer;
  if (fountain) {
    data = fountain.result();
  } else {
    const missing = Array.from({ length: seqTotal }, (_, i) => i + 1).filter((i) => !seq.has(i));
    if (missing.length) throw new Error(`Missing chunks: ${missing.join(", ")}`);
    data = Buffer.concat(Array.from({ length: seqTotal }, (_, i) => seq.get(i + 1)!));
  }

  const raw = unpack(data, brotli, fileId);
  writeFileSync(outFile, raw);
  console.log(`Restored ${raw.length.toLocaleString()} bytes from ${read} codes` +
              `${skipped ? ` (${skipped} skipped)` : ""} -> ${outFile}`);
}

// ─────────────────────────── CLI ───────────────────────────

function opt(args: string[], name: string, fallback: string): string {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

function ecOpt(args: string[]): EcLevel {
  const ec = opt(args, "--ec", "L").toUpperCase();
  if (!["L", "M", "Q", "H"].includes(ec)) throw new Error("--ec must be L, M, Q or H");
  return ec as EcLevel;
}

const USAGE = `Usage:
  text-to-qr split   <file> [--out qr_out]  [--chunk 1200] [--ec L|M|Q|H] [--scale 6]
  text-to-qr animate <file> [--out qr_anim] [--block 600]  [--ec L|M|Q|H] [--scale 6]
                            [--fps 5] [--repair 0.5] [--png]
  text-to-qr join    <folder | file.gif | file.png> [--out restored.txt]`;

function main(): void {
  const [cmd, target, ...rest] = process.argv.slice(2);
  if (!target) { console.log(USAGE); process.exit(1); }

  switch (cmd) {
    case "split":
      split(target, opt(rest, "--out", "qr_out"), Number(opt(rest, "--chunk", "1200")),
            ecOpt(rest), Number(opt(rest, "--scale", "6")));
      break;
    case "animate":
      animate(target, opt(rest, "--out", "qr_anim"), Number(opt(rest, "--block", "600")),
              ecOpt(rest), Number(opt(rest, "--scale", "6")), Number(opt(rest, "--fps", "5")),
              Number(opt(rest, "--repair", "0.5")), rest.includes("--png"));
      break;
    case "join":
      join(target, opt(rest, "--out", "restored.txt"));
      break;
    default:
      console.log(USAGE);
      process.exit(1);
  }
}

try {
  main();
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}
