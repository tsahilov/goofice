export function createCloudStore({ api, db, storage, planner }) {
  const listeners = new Set(), rows = new Map(), busy = new Set();
  let windowKey = '', unsubscribe = () => {}, generation = 0;
  let state = { loading: true, connected: false, error: '', saving: false };
  const emit = () => listeners.forEach(fn => fn());
  const setState = patch => { state = { ...state, ...patch, saving: busy.size > 0 }; emit(); };
  const ref = (date, member) => api.doc(db, 'days', date, 'marks', member);
  function ensureWindow(now = new Date()) {
    const dates = planner.calendarDates(now).map(planner.dateId);
    const key = dates.join(',');
    if (key === windowKey) return dates;
    windowKey = key; unsubscribe(); rows.clear();
    const token = ++generation;
    const ready = new Set(), stops = [];
    let failure = '';
    state = { loading: true, connected: false, error: '', saving: busy.size > 0 };
    dates.forEach(date => {
      const query = api.query(api.collection(db, 'days', date, 'marks'), api.limit(4));
      stops.push(api.onSnapshot(query, { includeMetadataChanges: true }, snapshot => {
        if (token !== generation) return;
        // Never render speculative local writes or cache-only data as confirmed.
        if (snapshot.metadata.hasPendingWrites) return;
        if (snapshot.metadata.fromCache) {
          ready.delete(date);
          setState({ connected: false, error: 'Нет подтверждения соединения с Firestore. Изменения временно недоступны.' });
          return;
        }
        rows.set(date, snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })).filter(mark => planner.MEMBERS.some(member => member.id === mark.id) && mark.createdAt && mark.memberId === mark.id));
        ready.add(date);
        setState({ loading: !failure && ready.size !== dates.length, connected: !failure && ready.size === dates.length, error: failure });
      }, error => {
        if (token === generation) { failure = `Ошибка подписки (${error.code || "connection"}). Обновите страницу для повторного подключения.`; setState({ loading: false, connected: false, error: `Не удалось загрузить отметки (${error.code || 'connection'}). Проверьте соединение и правила Firestore. Обновите страницу для повторного подключения.` }); }
      }));
    });
    unsubscribe = () => stops.forEach(stop => stop());
    return dates;
  }
  return {
    ensureWindow,
    get state() { return { ...state }; },
    isBusy(date) { return [...busy].some(key => key.startsWith(date + '/')); },
    list(date) {
      return [...(rows.get(date) || [])].sort((a, b) => a.createdAt.seconds - b.createdAt.seconds || a.createdAt.nanoseconds - b.createdAt.nanoseconds || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    },
    getMember() { try { const id = storage?.getItem('gooffice.demo.v2.member'); return planner.MEMBERS.some(member => member.id === id) ? id : null; } catch { return null; } },
    setMember(id) { try { storage?.setItem('gooffice.demo.v2.member', id); } catch { /* Selection still works for this page. */ } },
    async toggle(date, memberId, now = new Date()) {
      const key = date + '/' + memberId;
      if (!planner.canEdit(date, now) || !planner.MEMBERS.some(member => member.id === memberId) || busy.has(key)) return undefined;
      if (!state.connected) throw new Error('Нет соединения с Firestore. Отметка не сохранена.');
      busy.add(key); setState({ error: '' });
      try {
        const added = await api.runTransaction(db, async transaction => {
          const doc = ref(date, memberId);
          const snapshot = await transaction.get(doc);
          if (snapshot.exists()) { transaction.delete(doc); return false; }
          transaction.set(doc, { memberId, dayStart: api.Timestamp.fromDate(new Date(date + 'T00:00:00Z')), createdAt: api.serverTimestamp() });
          return true;
        });
        return added;
      } catch (error) {
        setState({ error: `Отметка не сохранена (${error.code || 'connection'}). Повторите нажатие после восстановления соединения.` });
        throw error;
      } finally { busy.delete(key); setState({}); }
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    destroy() { generation++; unsubscribe(); listeners.clear(); },
  };
}

