'use strict';

/** provider 레지스트리. 새 provider 를 추가하려면 여기 한 줄만 늘리면 된다. */
const list = [
  require('./anthropic'),
  require('./openai'),
];

const byId = (id) => list.find((p) => p.meta.id === id) || null;

/** config.providers 에서 켜진 것만. 설정이 없으면 전부 켜진 것으로 본다. */
const enabled = (config = {}) => {
  const flags = config.providers;
  if (!flags || typeof flags !== 'object') return list;
  return list.filter((p) => flags[p.meta.id] !== false);
};

module.exports = { list, byId, enabled };
