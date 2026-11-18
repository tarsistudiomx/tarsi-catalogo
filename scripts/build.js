'use strict';
const fs = require('node:fs');
fs.rmSync('dist', {recursive: true, force: true});
fs.mkdirSync('dist');
for (const path of ['index.html', 'assets', 'shop.js', 'checkout-ui.js']) {
  fs.cpSync(path, 'dist/' + path, {recursive: true});
}
