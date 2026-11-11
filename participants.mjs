export const MAX_MEMBERS = 20;
export const EXTRA_COLORS = Object.freeze([
  '#b46bce', '#377eb8', '#b07a13', '#159c97', '#d44b55', '#718c31', '#5861a5', '#9b604d',
  '#a32068', '#006852', '#82272d', '#856000', '#6840ac', '#087fa2', '#4d611b', '#45566a',
]);
export const memberPalette = initial => [...initial.map(member => member.color), ...EXTRA_COLORS];
const compactName = value => value.trim().replace(/ +/g, ' ');
export function normalizeName(value) {
  const name = compactName(String(value));
  if (!name) throw new Error('Введите имя.');
  if (name.length > 24) throw new Error('Имя должно быть не длиннее 24 символов.');
  if (!/^[A-Za-zА-Яа-яЁё](?:[A-Za-zА-Яа-яЁё -]{0,22}[A-Za-zА-Яа-яЁё])?$/.test(name)) throw new Error('Используйте русские или латинские буквы; внутри имени допустимы пробелы и дефисы.');
  return { name, nameKey: name.toLowerCase() };
}
export function initialRegistry(initial) {
  const profiles = {}, names = {}, colors = {}, usedIds = {};
  for (const member of initial) {
    profiles[member.id] = { ...member, nameKey: member.name.toLowerCase() };
    names[member.name.toLowerCase()] = member.id;
    colors[member.color] = member.id;
    usedIds[member.id] = true;
  }
  return { version: 1, profiles, names, colors, usedIds, order: initial.map(member => member.id) };
}
export function appendProfile(registry, value, id, palette, random = Math.random) {
  const { name, nameKey } = normalizeName(value);
  if (registry.order.length >= MAX_MEMBERS) throw new Error(`Уже есть ${MAX_MEMBERS} участников.`);
  if (Object.hasOwn(registry.names, nameKey) ||
      Object.keys(registry.names).some(key => compactName(key) === nameKey)) {
    throw new Error('Участник с таким именем уже существует.');
  }
  if (Object.hasOwn(registry.usedIds, id)) throw new Error('Этот ID уже использовался. Повторите добавление.');
  const available = palette.filter(color => !Object.hasOwn(registry.colors, color));
  if (!available.length) throw new Error('В реестре нет свободного цвета. Проверьте реестр в Firebase Console.');
  const color = available[Math.min(available.length - 1, Math.floor(random() * available.length))];
  const profile = { id, name, nameKey, color };
  return { profile, registry: {
    ...registry,
    profiles: { ...registry.profiles, [id]: profile },
    order: [...registry.order, id],
    names: { ...registry.names, [nameKey]: id },
    colors: { ...registry.colors, [color]: id },
    usedIds: { ...registry.usedIds, [id]: true },
  } };
}
export function createParticipantRegistry({ api, db, initialMembers }) {
  const ref = api.doc(db, 'team', 'registry');
  const palette = memberPalette(initialMembers);
  const listeners = new Set();
  let members = [], ready = false, loading = true, error = '', saving = false, initializing = false, destroyed = false;
  const emit = () => { if (!destroyed) listeners.forEach(fn => fn()); };
  async function initialize() {
    if (initializing) return;
    initializing = true;
    try {
      await api.runTransaction(db, async transaction => {
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists()) transaction.set(ref, initialRegistry(initialMembers));
      });
    } catch (cause) { loading = false; error = `Не удалось подготовить список участников (${cause.code || 'connection'}). Обновите страницу.`; emit(); }
    finally { initializing = false; }
  }
  const stop = api.onSnapshot(ref, { includeMetadataChanges: true }, snapshot => {
    if (destroyed || snapshot.metadata.hasPendingWrites) return;
    if (snapshot.metadata.fromCache) { ready = false; error = 'Нет подтверждения соединения со списком участников.'; emit(); return; }
    if (!snapshot.exists()) { ready = false; loading = true; emit(); void initialize(); return; }
    try {
      const data = snapshot.data();
      if (data.version !== 1 || !Array.isArray(data.order) || !data.profiles || data.order.length > MAX_MEMBERS) throw new Error('schema');
      members = data.order.map(id => data.profiles[id]).filter(Boolean);
      ready = true; loading = false; error = ''; emit();
    } catch { ready = false; loading = false; error = 'Неверная структура реестра участников. Проверьте team/registry в Firebase Console.'; emit(); }
  }, cause => { ready = false; loading = false; error = `Не удалось загрузить участников (${cause.code || 'connection'}). Обновите страницу.`; emit(); });
  return {
    get members() { return members; },
    get state() { return { ready, loading, error, saving }; },
    async add(value) {
      normalizeName(value);
      if (saving) throw new Error('Добавление уже выполняется.');
      if (!ready) throw new Error('Дождитесь подключения списка участников.');
      const id = 'p_' + crypto.randomUUID().replaceAll('-', '');
      saving = true; emit();
      try {
        for (let attempt = 0; ; attempt += 1) {
          let readOrder;
          try {
            return await api.runTransaction(db, async transaction => {
              const snapshot = await transaction.get(ref);
              if (!snapshot.exists()) throw new Error('Реестр отсутствует. Обновите страницу.');
              const data = snapshot.data();
              const result = appendProfile(data, value, id, palette);
              readOrder = data.order.join(',');
              transaction.set(ref, result.registry);
              return result.profile;
            });
          } catch (cause) {
            // Rules can reject a stale append before Firestore reports a retryable conflict.
            if (cause.code !== 'permission-denied' || readOrder === undefined || attempt >= 2) throw cause;
            const latest = await api.getDocFromServer(ref).catch(() => null);
            if (!latest?.exists() || latest.data().order.join(',') === readOrder) throw cause;
          }
        }
      } catch (cause) {
        if (cause.code) throw new Error(`Не удалось добавить участника (${cause.code}). Проверьте соединение и повторите.`);
        throw cause;
      } finally { saving = false; emit(); }
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    destroy() { destroyed = true; stop(); listeners.clear(); },
  };
}
