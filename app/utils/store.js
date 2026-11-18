/**
 * store.js —— 本地令牌库（UI 层存储适配器）
 *
 * ⚠️ 这是前端联调用的明文存储层。
 *    生产环境请把 persist() / restore() 换成加密实现：
 *    口令 → KDF(Argon2id 或 PBKDF2-HMAC-SHA256) → KEK → 包裹 DEK → AES 加密本体。
 *    只需替换本文件的两个函数，页面代码无需改动。
 */
'use strict';

var STORAGE_KEY = 'otp_vault_v1';
var VERSION = 2;
var WORK_GROUP_ID = 'builtin-work';
var PERSONAL_GROUP_ID = 'builtin-personal';

var cipher = null; // { encrypt(obj) -> string, decrypt(string) -> obj }

function setCipher(impl) {
  cipher = impl;
}

/**
 * 记录标识（UUID v4 形态）。
 * 注意：这里只用于「记录主键」，不参与任何密钥派生，因此使用 Math.random 可接受；
 * 真正的安全随机（盐、IV、DEK）必须走 wx.getRandomValues 异步接口，见 README「加密层」。
 */
function uuid() {
  var bytes = new Uint8Array(16);
  var seed = (Date.now() % 0xFFFFFFFF) ^ Math.floor(Math.random() * 0xFFFFFFFF);
  for (var i = 0; i < 16; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF;
    bytes[i] = (seed >>> 7) & 0xFF;
  }
  bytes[6] = (bytes[6] & 0x0F) | 0x40;
  bytes[8] = (bytes[8] & 0x3F) | 0x80;
  var hex = '';
  for (var j = 0; j < 16; j++) hex += ('0' + bytes[j].toString(16)).slice(-2);
  return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' +
         hex.slice(16, 20) + '-' + hex.slice(20);
}

function persistBox(box) {
  box.version = VERSION;
  box.updatedAt = Date.now();
  var payload = cipher ? cipher.encrypt(box) : JSON.stringify(box);
  wx.setStorageSync(STORAGE_KEY, payload);
}

function defaultGroups() {
  return [
    { id: WORK_GROUP_ID, name: '工作', builtin: true, sort: 1 },
    { id: PERSONAL_GROUP_ID, name: '个人', builtin: true, sort: 2 }
  ];
}

function restoreBox() {
  var raw = wx.getStorageSync(STORAGE_KEY);
  var box = { version: VERSION, updatedAt: Date.now(), tokens: [], groups: defaultGroups() };
  if (!raw) return box;
  try {
    if (cipher) {
      box = cipher.decrypt(raw);
    } else {
      box = typeof raw === 'string' ? JSON.parse(raw) : raw;
    }
    if (Array.isArray(box)) box = { tokens: box };
    if (!box || !Array.isArray(box.tokens)) return { version: VERSION, tokens: [], groups: defaultGroups() };
  } catch (e) {
    console.error('[store] 解析失败', e);
    return { version: VERSION, tokens: [], groups: defaultGroups() };
  }

  box.groups = Array.isArray(box.groups) ? box.groups : [];
  var defaults = defaultGroups();
  defaults.forEach(function (builtin) {
    var found = box.groups.some(function (group) { return group.id === builtin.id; });
    if (!found) box.groups.push(builtin);
  });
  box.groups = box.groups.map(function (group, index) {
    return {
      id: String(group.id || ''),
      name: String(group.name || '').trim(),
      builtin: !!group.builtin || group.id === WORK_GROUP_ID || group.id === PERSONAL_GROUP_ID,
      sort: typeof group.sort === 'number' ? group.sort : index + 1,
      createdAt: group.createdAt || Date.now()
    };
  }).filter(function (group) { return !!group.id && !!group.name; });

  var groupIds = {};
  box.groups.forEach(function (group) { groupIds[group.id] = true; });
  box.tokens = box.tokens.map(function (token) {
    if (!token.groupId || !groupIds[token.groupId]) token.groupId = PERSONAL_GROUP_ID;
    return token;
  });
  return box;
}

function persist(tokens, groups) {
  persistBox({ tokens: tokens, groups: groups || restoreBox().groups });
}

/** 列表（按 sort 升序） */
function list() {
  var tokens = restoreBox().tokens;
  tokens.sort(function (a, b) { return (a.sort || 0) - (b.sort || 0); });
  return tokens;
}

function ensureDefaults() {
  var box = restoreBox();
  var raw = wx.getStorageSync(STORAGE_KEY);
  var hadGroups = false;
  try {
    var original = cipher ? cipher.decrypt(raw) : (typeof raw === 'string' ? JSON.parse(raw) : raw);
    hadGroups = !!(original && Array.isArray(original.groups));
  } catch (e) { /* first launch or legacy vault */ }
  var needsGroupMigration = box.tokens.some(function (token) { return !token.groupId; });
  if (!raw || !hadGroups || needsGroupMigration) persistBox(box);
  return box.groups;
}

function normalize(token) {
  return {
    id: token.id || uuid(),
    groupId: String(token.groupId || PERSONAL_GROUP_ID),
    issuer: String(token.issuer || '').trim(),
    label: String(token.label || '').trim() || '未命名账号',
    secret: String(token.secret || '').replace(/[\s\-]/g, '').toUpperCase(),
    algorithm: String(token.algorithm || 'SHA1').toUpperCase(),
    digits: parseInt(token.digits, 10) === 8 ? 8 : 6,
    period: parseInt(token.period, 10) > 0 ? parseInt(token.period, 10) : 30,
    type: String(token.type || 'totp').toLowerCase() === 'hotp' ? 'hotp' : 'totp',
    counter: parseInt(token.counter, 10) > 0 ? parseInt(token.counter, 10) : 0,
    epoch: 0,
    sort: typeof token.sort === 'number' ? token.sort : Date.now(),
    createdAt: token.createdAt || Date.now()
  };
}

function add(token) {
  var box = restoreBox();
  var tokens = box.tokens;
  var item = normalize(token);
  item.sort = tokens.length ? Math.max.apply(null, tokens.map(function (t) { return t.sort || 0; })) + 1 : 1;
  tokens.push(item);
  persist(tokens, box.groups);
  return item;
}

function update(id, patch) {
  var box = restoreBox();
  var tokens = box.tokens;
  var found = null;
  tokens = tokens.map(function (t) {
    if (t.id !== id) return t;
    found = normalize(Object.assign({}, t, patch, { id: id }));
    return found;
  });
  persist(tokens, box.groups);
  return found;
}

function remove(id) {
  var box = restoreBox();
  persist(box.tokens.filter(function (t) { return t.id !== id; }), box.groups);
}

function clear() {
  var box = restoreBox();
  persist([], box.groups);
}

function count() {
  return restoreBox().tokens.length;
}

/** 云同步恢复：整体替换 tokens + groups（E2EE 解密后写入） */
function replaceAll(tokens, groups) {
  persist(Array.isArray(tokens) ? tokens : [], groups);
}

/** 按 id 顺序重排（拖拽排序落库用） */
function reorder(orderedIds) {
  var box = restoreBox();
  var tokens = box.tokens;
  var map = {};
  tokens.forEach(function (t) { map[t.id] = t; });
  var next = [];
  orderedIds.forEach(function (id, i) {
    if (map[id]) {
      map[id].sort = i + 1;
      next.push(map[id]);
      delete map[id];
    }
  });
  tokens.forEach(function (t) { if (map[t.id]) next.push(t); });
  persist(next, box.groups);
}

function groups() {
  var box = restoreBox();
  var counts = {};
  box.tokens.forEach(function (token) { counts[token.groupId] = (counts[token.groupId] || 0) + 1; });
  return box.groups.slice().sort(function (a, b) { return a.sort - b.sort; }).map(function (group) {
    return Object.assign({}, group, { count: counts[group.id] || 0 });
  });
}

function addGroup(name) {
  var value = String(name || '').trim();
  if (!value) return { error: '请输入分组名称' };
  var box = restoreBox();
  var duplicate = box.groups.some(function (group) { return group.name.toLowerCase() === value.toLowerCase(); });
  if (duplicate) return { error: '已有同名分组' };
  var maxSort = box.groups.reduce(function (max, group) { return Math.max(max, group.sort || 0); }, 0);
  var item = { id: uuid(), name: value, builtin: false, sort: maxSort + 1, createdAt: Date.now() };
  box.groups.push(item);
  persist(box.tokens, box.groups);
  return { group: item };
}

function renameGroup(id, name) {
  var value = String(name || '').trim();
  if (!value) return { error: '请输入分组名称' };
  var box = restoreBox();
  var target = box.groups.find(function (group) { return group.id === id; });
  if (!target || target.builtin) return { error: '内置分组不可重命名' };
  if (box.groups.some(function (group) { return group.id !== id && group.name.toLowerCase() === value.toLowerCase(); })) {
    return { error: '已有同名分组' };
  }
  target.name = value;
  persist(box.tokens, box.groups);
  return { group: target };
}

function deleteGroup(id, targetGroupId) {
  var box = restoreBox();
  var target = box.groups.find(function (group) { return group.id === id; });
  var destination = box.groups.find(function (group) { return group.id === targetGroupId; });
  if (!target || target.builtin) return { error: '内置分组不可删除' };
  if (!destination || destination.id === id) return { error: '请选择有效的目标分组' };
  box.tokens.forEach(function (token) {
    if (token.groupId === id) token.groupId = destination.id;
  });
  box.groups = box.groups.filter(function (group) { return group.id !== id; });
  persist(box.tokens, box.groups);
  return { success: true };
}

function reorderGroups(orderedIds) {
  var box = restoreBox();
  var map = {};
  box.groups.forEach(function (group) { map[group.id] = group; });
  var next = [];
  orderedIds.forEach(function (id) {
    if (map[id]) {
      map[id].sort = next.length + 1;
      next.push(map[id]);
      delete map[id];
    }
  });
  box.groups.slice().sort(function (a, b) { return a.sort - b.sort; }).forEach(function (group) {
    if (map[group.id]) {
      map[group.id].sort = next.length + 1;
      next.push(map[group.id]);
      delete map[group.id];
    }
  });
  persist(box.tokens, next);
}

module.exports = {
  list: list,
  add: add,
  update: update,
  remove: remove,
  clear: clear,
  count: count,
  replaceAll: replaceAll,
  reorder: reorder,
  groups: groups,
  ensureDefaults: ensureDefaults,
  addGroup: addGroup,
  renameGroup: renameGroup,
  deleteGroup: deleteGroup,
  reorderGroups: reorderGroups,
  WORK_GROUP_ID: WORK_GROUP_ID,
  PERSONAL_GROUP_ID: PERSONAL_GROUP_ID,
  uuid: uuid,
  setCipher: setCipher,
  STORAGE_KEY: STORAGE_KEY
};
