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
  const dot = value.indexOf(".");
  if (dot < 0 || value.slice(0, dot) !== ENCODING) {
    return { ok: false, error: "This link was made in a way this version of Clockyard cannot read." };
  }
  const bytes = fromBase64Url(value.slice(dot + 1));
  if (bytes === null) return { ok: false, error: "This link is damaged: it has characters a Clockyard link never has." };
  let text: string;
  try {
    text = await inflate(bytes);
  } catch (error) {
    if (error instanceof TooLarge) return { ok: false, error: "This link opens to more than 10 MiB, too large to be a Clockyard circuit." };
    return { ok: false, error: "This link is cut short or damaged." };
  }
  return parseDocument(text);
}

class TooLarge extends Error {}

/** Decompresses, stopping as soon as the text would pass the size Import accepts. */
async function inflate(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
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

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  // A length of 1 more than a multiple of 4 is never base64; atob would throw.
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return null;
  return Uint8Array.from(atob(text.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0));
}
