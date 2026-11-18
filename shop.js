(function (root) {
  'use strict';

  const products = [
    ['The Amazing Spider-Man', 'CÓMICS'], ['Goku y Shenlong', 'ANIME'],
    ['Gojo Satoru', 'ANIME'], ['Rayo McQueen', 'CINE / AUTOS'],
    ['Sally', 'CINE / AUTOS'], ['Majin Vegeta', 'ANIME'],
    ['Goku Ultra Instinto', 'ANIME'], ['Amazing Fantasy', 'CÓMICS'],
    ['Miles Morales', 'CÓMICS'], ['Spider-Man clásico', 'CÓMICS'],
    ['Spider-Man emblema', 'CÓMICS'], ['Checo Pérez · Never Give Up', 'CINE / AUTOS']
  ].map(([name, category], id) => ({
    name, category, image: 'assets/playera-' + String(id + 1).padStart(2, '0') + '.jpg'
  }));
  const sizes = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
  const maxQuantity = 30;
  const unitPrice = 399;
  const subtotal = quantity => Math.floor(quantity / 3) * 999 + [0, 399, 699][quantity % 3];
  const count = items => items.reduce((sum, line) => sum + line.qty, 0);
  const isLine = line => Boolean(line && Number.isInteger(line.id) && products[line.id] &&
    sizes.includes(line.size) && Number.isSafeInteger(line.qty) && line.qty > 0);

  function normalize(text) {
    return String(text ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
      .replace(/\b(primera|1a)\b/g, '1a')
      .replace(/\b(segunda|2a)\b/g, '2a')
      .replace(/\b(tercera|3a)\b/g, '3a')
      .replace(/\bsecc\b/g, 'seccion');
  }

  function findColony(value, names) {
    const exact = typeof value === 'string' ? value.trim() : '';
    if (names.includes(exact)) return exact;
    const key = normalize(value);
    const matches = names.filter(name => normalize(name) === key);
    if (matches.length === 1) return matches[0];
    const abbreviated = key.replace(/^(colonia|col)\s+/, '');
    const alternatives = names.filter(name => normalize(name) === abbreviated);
    return alternatives.length === 1 ? alternatives[0] : null;
  }

  const shop = {products, sizes, maxQuantity, unitPrice, subtotal, count, isLine, normalize, findColony};
  if (typeof module === 'object') module.exports = shop;
  else root.TarsiShop = shop;
})(globalThis);
