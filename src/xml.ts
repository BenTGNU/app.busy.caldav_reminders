/** Minimal XML helpers: enough to pull text out of a CalDAV multistatus response. */

function localName(tag: string): string {
  const colon = tag.indexOf(":");
  return colon >= 0 ? tag.slice(colon + 1) : tag;
}

function unescapeXml(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|lt|gt|amp|quot|apos);/g, (m, entity: string) => {
    switch (entity) {
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "amp":
        return "&";
      case "quot":
        return '"';
      case "apos":
        return "'";
      default: {
        const code = entity[0] === "#" ? (entity[1] === "x" || entity[1] === "X" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10)) : NaN;
        return Number.isNaN(code) ? m : String.fromCharCode(code);
      }
    }
  });
}

/** Returns the text content of every element whose local name matches, ignoring namespace prefixes. CDATA sections are kept raw, text is entity-unescaped. */
export function extractTagText(xml: string, wanted: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < xml.length) {
    const lt = xml.indexOf("<", i);
    if (lt < 0) break;
    if (xml.startsWith("<!--", lt)) {
      const end = xml.indexOf("-->", lt);
      i = end < 0 ? xml.length : end + 3;
      continue;
    }
    if (xml.startsWith("<?", lt) || xml.startsWith("<!", lt)) {
      const end = xml.indexOf(">", lt);
      i = end < 0 ? xml.length : end + 1;
      continue;
    }
    const gt = xml.indexOf(">", lt);
    if (gt < 0) break;
    let tag = xml.slice(lt + 1, gt);
    const selfClosing = tag.endsWith("/");
    if (selfClosing) tag = tag.slice(0, -1);
    const name = tag.split(/\s/)[0] ?? "";
    if (localName(name) !== wanted || selfClosing) {
      i = gt + 1;
      continue;
    }
    // Collect the body up to the matching close tag; calendar-data holds only text or CDATA.
    let j = gt + 1;
    let body = "";
    let closed = false;
    while (j < xml.length) {
      const lt2 = xml.indexOf("<", j);
      if (lt2 < 0) break;
      if (xml.startsWith("<![CDATA[", lt2)) {
        const end = xml.indexOf("]]>", lt2);
        body += unescapeXml(xml.slice(j, lt2)) + xml.slice(lt2 + 9, end < 0 ? xml.length : end);
        if (end < 0) {
          j = xml.length;
          break;
        }
        j = end + 3;
        continue;
      }
      const gt2 = xml.indexOf(">", lt2);
      if (gt2 < 0) break;
      const inner = xml.slice(lt2 + 1, gt2);
      if (inner.startsWith("/") && localName(inner.slice(1).trim().split(/\s/)[0] ?? "") === wanted) {
        body += unescapeXml(xml.slice(j, lt2));
        closed = true;
        i = gt2 + 1;
        break;
      }
      j = gt2 + 1;
    }
    if (closed) out.push(body);
    else i = xml.length;
  }
  return out;
}
