'use strict';
const fs = require('node:fs');
fs.rmSync('dist', {recursive: true, force: true});
fs.mkdirSync('dist');
for (const path of ['index.html', 'assets', 'shop.js', 'shipping-ui.js', 'checkout.js']) {
  fs.cpSync(path, 'dist/' + path, {recursive: true});
}
