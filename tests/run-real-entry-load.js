'use strict';

const path = require('path');

const functions = [
  'getOrder',
  'saveOrderImages'
];

functions.forEach((name) => {
  const entry = path.resolve(__dirname, '..', 'cloudfunctions', name, 'index.js');
  delete require.cache[require.resolve(entry)];
  require(entry);
  console.log(`${name}: real SDK entry load passed`);
});

console.log('real cloud function entry load passed');
