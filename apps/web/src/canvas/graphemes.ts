const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;

/**
 * `whole`, which finds a string's user-perceived characters, skipped for printable ASCII: each of its characters stands
 * alone, and Intl.Segmenter took 135-293 ms of opening a 10,000-part sheet to say so (ADR 0030).
 */
export const withAsciiShortcut = (whole: (text: string) => string[]) => (text: string) =>
  PRINTABLE_ASCII.test(text) ? text.split("") : whole(text);
