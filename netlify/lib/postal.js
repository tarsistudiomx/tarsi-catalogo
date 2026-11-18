'use strict';
const {getStore} = require('@netlify/blobs');
const {normalize, findColony} = require('../../shop');
const {HttpError} = require('./http');

const isZip = value => typeof value === 'string' && /^\d{5}$/.test(value);
function createPostal(openStore = () => getStore({name: 'tarsi-postal', consistency: 'strong'})) {
  let version;
  let refreshAt = 0;
  const groups = new Map();

  async function lookup(zip) {
    if (!isZip(zip)) throw new HttpError(400, 'INVALID_POSTAL_CODE', 'Ingresa un código postal de cinco dígitos.');
    const store = openStore();
    if (Date.now() >= refreshAt) {
      const manifest = await store.get('current', {type: 'json'});
      if (!manifest?.version) {
        throw new HttpError(503, 'POSTAL_UNAVAILABLE', 'El catálogo postal no está disponible temporalmente.');
      }
      if (version !== manifest.version) groups.clear();
      version = manifest.version;
      refreshAt = Date.now() + 300000;
    }
    const prefix = zip.slice(0, 2);
    const key = version + '/' + prefix;
    if (!groups.has(key)) {
      const group = await store.get(key, {type: 'json'});
      if (group) {
        if (groups.size >= 8) groups.delete(groups.keys().next().value);
        groups.set(key, group);
      }
    }
    const colonies = groups.get(key)?.[zip];
    if (!colonies?.length) throw new HttpError(404, 'POSTAL_NOT_FOUND', 'El código postal no aparece en el catálogo oficial.');
    return {postal_code: zip, colonies};
  }

  async function validate(input) {
    const {postal_code: zip, area_level1: state, area_level2: city, area_level3: name} = input || {};
    const {colonies} = await lookup(zip);
    const candidates = colonies.filter(row => (!state || normalize(row.state) === normalize(state)) &&
      (!city || normalize(row.city) === normalize(city)));
    const colony = findColony(name, [...new Set(candidates.map(row => row.name))]);
    const matches = candidates.filter(row => row.name === colony);
    if (matches.length !== 1) {
      throw new HttpError(422, 'INVALID_COLONY', 'Selecciona una colonia del catálogo para ese código postal.');
    }
    const match = matches[0];
    return {country_code: 'MX', postal_code: zip, area_level1: match.state,
      area_level2: match.city, area_level3: match.name};
  }

  return {lookup, validate};
}
module.exports = {createPostal, postal: createPostal()};
