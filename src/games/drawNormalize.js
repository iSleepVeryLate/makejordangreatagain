// Client-side mirror of the SQL public.draw_normalize(). Used ONLY for instant
// local UX (e.g. ignoring a guess that exactly matches the word the drawer can
// see is impossible — the drawer never guesses — and for trimming/validating
// input). The server remains the sole authority on whether a guess is correct.
//
// Keep this byte-for-byte equivalent to the SQL: lowercase (latin), strip tatweel
// + tashkeel + superscript-alef, fold alef variants -> ا, alef-maqsura ى -> ي,
// ta-marbuta ة -> ه, waw/ya hamza ؤئ -> و/ي, collapse whitespace.
export function drawNormalize(s) {
  if (!s) return ''
  return s
    .toLowerCase()
    .replace(/[ـً-ْٰ]/g, '') // tatweel + tashkeel + superscript alef
    .replace(/[أإآٱ]/g, 'ا') // أإآٱ -> ا
    .replace(/ى/g, 'ي') // ى -> ي
    .replace(/ة/g, 'ه') // ة -> ه
    .replace(/ؤ/g, 'و') // ؤ -> و
    .replace(/ئ/g, 'ي') // ئ -> ي
    .replace(/\s+/g, ' ')
    .trim()
}

// Masked letter-count hint a guesser sees, e.g. "cat" -> "_ _ _", "wadi rum" ->
// "_ _ _ _   _ _ _". Spaces are shown as a wider gap so multi-word answers read.
export function wordMask(word) {
  if (!word) return ''
  return word
    .split(' ')
    .map((part) => Array.from(part).map(() => '_').join(' '))
    .join('   ')
}
