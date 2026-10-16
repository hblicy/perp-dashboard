// Optional leak scan. Terms come from FORBIDDEN_TERMS or a gitignored .forbidden-terms file.
// With neither set, that scan is skipped. x.com links in the text must still be declared in config.
const assert = require("assert");
const fs = require("fs");
const path = require("path");

function forbiddenTerms() {
  const terms = [];
  const env = process.env.FORBIDDEN_TERMS;
  if (env) {
    for (const part of env.split(/[\n,]/)) {
      const term = part.trim();
      if (term) terms.push(term);
    }
  }
  const file = path.join(__dirname, "..", ".forbidden-terms");
  if (fs.existsSync(file)) {
    for (const part of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const term = part.trim();
      if (term && !term.startsWith("#")) terms.push(term);
    }
  }
  return terms;
}

function xHandles(text) {
  const handles = new Set();
  for (const match of String(text).matchAll(/https?:\/\/(?:www\.)?x\.com\/([A-Za-z0-9_]+)/gi)) {
    handles.add(match[1].toLowerCase());
  }
  return handles;
}

function configText() {
  return fs.readFileSync(path.join(__dirname, "..", "config.json"), "utf8");
}

function assertClean(text) {
  const hay = String(text).toLowerCase();
  for (const term of forbiddenTerms()) {
    assert.equal(hay.includes(term.toLowerCase()), false);
  }
  const allowed = xHandles(configText());
  for (const handle of xHandles(text)) assert.equal(allowed.has(handle), true);
}

module.exports = { assertClean };
