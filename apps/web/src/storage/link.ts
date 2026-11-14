// Sharing a circuit through a URL fragment (ADR 0024): the document as Export writes it, as
// compact JSON, compressed with the browser's deflate-raw and written in base64url, behind an
// encoding version of its own: `#circuit=1.<data>`. Reading it back goes through parseDocument,
// so a link is validated exactly as an imported file is.

import type { CircuitDocument } from "../editor/document";
import { MAX_DOCUMENT_BYTES, type ParseResult, parseDocument, serializeDocument } from "./file";

/** The fragment's key. */
export const LINK_KEY = "circuit";
/** The encoding: deflate-raw, base64url, the file format's JSON. A new one gets a new number. */
const ENCODING = "1";

/** The fragment that carries a document, without the leading `#`. */
export async function linkFragment(document: CircuitDocument): Promise<string> {
  const compressed = new Blob([serializeDocument(document, 0)]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  const bytes = new Uint8Array(await new Response(compressed).arrayBuffer());
  return `${LINK_KEY}=${ENCODING}.${toBase64Url(bytes)}`;
}

/**
 * The document a fragment (with or without its `#`) carries, or why it cannot be read;
 * null when the fragment carries no circuit at all.
 */
export async function readLinkFragment(fragment: string): Promise<ParseResult | null> {
  const value = new URLSearchParams(fragment.replace(/^#/, "")).get(LINK_KEY);
  if (value === null) return null;
  const damaged = { ok: false, error: "This link is cut short or damaged." } as const;
  const dot = value.indexOf(".");
  if (dot < 0) return damaged;
  if (value.slice(0, dot) !== ENCODING) {
    return { ok: false, error: "This link was made in a way this version of Clockyard cannot read." };
  }
  const data = value.slice(dot + 1);
  if (!/^[A-Za-z0-9_-]*$/.test(data)) {
    return { ok: false, error: "This link is damaged: it has characters a Clockyard link never has." };
  }
  // A length of 1 more than a multiple of 4 is never base64 (atob would throw): a link cut short.
  if (data.length % 4 === 1) return damaged;
  let text: string;
  try {
    text = await inflate(fromBase64Url(data));
  } catch (error) {
    if (!(error instanceof TooLarge)) return damaged;
    const limit = MAX_DOCUMENT_BYTES / 1024 / 1024;
    return { ok: false, error: `This link opens to more than ${limit} MiB, too large to be a Clockyard circuit.` };
  }
  return parseDocument(text);
}

class TooLarge extends Error {}

/**
 * Decompresses, stopping as soon as the text would pass the size Import accepts. The input goes
 * in 1 KiB at a time, so no engine can hand back one huge chunk before the size is checked.
 */
async function inflate(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const stream = new DecompressionStream("deflate-raw");
  const writer = stream.writable.getWriter();
  const writing = (async () => {
    for (let i = 0; i < bytes.length; i += 1024) await writer.write(bytes.subarray(i, i + 1024));
    await writer.close();
  })();
  writing.catch(() => {}); // a failed or cancelled write is seen by the reader below
  const reader = stream.readable.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_DOCUMENT_BYTES) {
      await reader.cancel();
      throw new TooLarge();
    }
    chunks.push(value);
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(await new Blob(chunks).arrayBuffer());
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** Only for text already checked to be base64url of a possible length. */
function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(text.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0));
}
