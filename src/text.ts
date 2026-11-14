/** The device fonts are bitmap ASCII, so event text is reduced to printable ASCII for display. */

const ACCENTS: Record<string, string> = {
  à: "a", á: "a", â: "a", ã: "a", ä: "a", å: "a", æ: "ae",
  ç: "c",
  è: "e", é: "e", ê: "e", ë: "e",
  ì: "i", í: "i", î: "i", ï: "i",
  ñ: "n",
  ò: "o", ó: "o", ô: "o", õ: "o", ö: "o", ø: "o",
  ù: "u", ú: "u", û: "u", ü: "u",
  ý: "y", ÿ: "y",
  À: "A", Á: "A", Â: "A", Ã: "A", Ä: "A", Å: "A", Æ: "AE",
  Ç: "C",
  È: "E", É: "E", Ê: "E", Ë: "E",
  Ì: "I", Í: "I", Î: "I", Ï: "I",
  Ñ: "N",
  Ò: "O", Ó: "O", Ô: "O", Õ: "O", Ö: "O", Ø: "O",
  Ù: "U", Ú: "U", Û: "U", Ü: "U",
  Ý: "Y",
  œ: "oe", Œ: "OE", ß: "ss", đ: "d", ł: "l",
  "—": "-", "–": "-", "‑": "-", "•": "-", "·": "-",
  "\u2019": "'", "\u2018": "'", "\u201a": "'", "\u201b": "'",
  "“": '"', "”": '"', "„": '"',
  "…": "...", "€": "EUR", "£": "GBP", "°": " deg",
};

export function toAscii(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const code = text.charCodeAt(i);
    if (code >= 32 && code <= 126) out += c;
    else if (ACCENTS[c]) out += ACCENTS[c];
    else if (code === 9 || code === 10 || code === 13) out += " ";
    else out += "?";
  }
  return out.replace(/ {2,}/g, " ").trim();
}
