// utils/cleanEmail.js
const { decode } = require("html-entities");

module.exports = function cleanRawEmail(raw) {
  // normalise line endings
  let txt = raw.replace(/\r\n/g, "\n");

  /* 1️⃣  Strip the entire header block (up to first blank line) */
  txt = txt.replace(/^[\s\S]*?\n\n/, "");

  /* 2️⃣  Kill MIME boundary markers   e.g. "--abc123…" */
  txt = txt.replace(/^--[-A-Za-z0-9_.+]+.*$/gm, "");

  /* 3️⃣  Remove Content-Transfer sections (base-64, qp, etc.) */
  txt = txt.replace(
    /^Content-[\s\S]*?(?:\n\n|\n$)/gim,
    ""
  );

  /* 4️⃣  Junk lines that are obviously machine-generated
         (dkim, spf, arc, etc.) */
  txt = txt.replace(
    /^(dkim|spf|arc|received|x-[\w-]+|mime-version|message-id|return-path|domainkey-signature):.*$/gim,
    ""
  );

  /* 5️⃣  Hard-wrap soft-wrapped quoted-printable “=↩” breaks */
  txt = txt.replace(/=\n/g, "");

  /* 6️⃣  Strip remaining HTML tags & decode entities */
  txt = decode(txt.replace(/<[^>]+>/g, " "));

  /* 7️⃣  Collapse multi-blank lines & trim */
  txt = txt.replace(/\n{2,}/g, "\n").trim();

  return txt;
};
