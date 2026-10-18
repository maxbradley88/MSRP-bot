const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const runtimePath = path.join(__dirname, 'events.runtime.json');
function loadData() {
  try { const obj = JSON.parse(fs.readFileSync(runtimePath, 'utf8')); return { events: obj.events && typeof obj.events === 'object' ? obj.events : {} }; }
  catch { return { events: {} }; }
}
function saveData(data) {
  const tmp = runtimePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ events: data.events || {} }, null, 2));
  fs.renameSync(tmp, runtimePath);
}
function makeId() { return crypto.randomUUID().slice(0, 12); }
module.exports = { loadData, saveData, makeId };
