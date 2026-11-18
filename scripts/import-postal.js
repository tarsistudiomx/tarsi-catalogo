'use strict';

const {readFileSync} = require('node:fs');
const {createHash} = require('node:crypto');
const {getStore} = require('@netlify/blobs');

function parseCatalog(bytes) {
  const encoding = new TextDecoder('utf-8', {fatal: true});
  let raw;
  try {
    raw = encoding.decode(bytes);
  } catch {
    raw = new TextDecoder('windows-1252').decode(bytes);
  }
  const table = {};
  const states = new Set();
  for (const line of raw.split(/\r?\n/)) {
    const [zip, name, , city, state] = line.split('|').map(field => field.trim());
    if (!/^\d{5}$/.test(zip) || !name || !city || !state) continue;
    const prefix = zip.slice(0, 2);
    const record = (table[prefix] ??= {});
    const colonies = (record[zip] ??= []);
    if (!colonies.some(entry => entry.name === name && entry.city === city && entry.state === state)) {
      colonies.push({name, city, state});
    }
    states.add(state);
  }
  const count = Object.values(table).reduce((sum, group) => sum + Object.keys(group).length, 0);
  if (states.size !== 32 || count < 20000) throw new Error('Se requiere el TXT nacional completo de SEPOMEX.');
  return {table, count};
}

async function run() {
  const [, , file] = process.argv;
  const {NETLIFY_SITE_ID: siteID, NETLIFY_AUTH_TOKEN: token} = process.env;
  if (!file || !siteID || !token) throw new Error('Indica el TXT y configura NETLIFY_SITE_ID y NETLIFY_AUTH_TOKEN.');
  const bytes = readFileSync(file);
  const {table, count} = parseCatalog(bytes);
  const version = createHash('sha256').update(bytes).digest('hex');
  const store = getStore({name: 'tarsi-postal', siteID, token, consistency: 'strong'});
  for (const [prefix, group] of Object.entries(table)) {
    await store.setJSON(version + '/' + prefix, group, {onlyIfNew: true});
  }
  await store.setJSON('current', {version, count, importedAt: new Date().toISOString()});
  console.log('Catálogo SEPOMEX activo:', count, 'códigos postales, SHA-256', version);
}

if (require.main === module) run().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = {parseCatalog};
