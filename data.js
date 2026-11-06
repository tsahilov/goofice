/* Локальное тестовое хранилище. Одна запись на дату и участника. */
(() => {
  "use strict";
  const OFFICE_TIME_ZONE = "Europe/Moscow";
  const MEMBERS = Object.freeze([
    Object.freeze({ id: "alan", name: "Алан", color: "#ff39b6" }),
    Object.freeze({ id: "denis", name: "Денис", color: "#ff791a" }),
    Object.freeze({ id: "anya", name: "Аня", color: "#20c6a6" }),
    Object.freeze({ id: "dasha", name: "Даша", color: "#2400ff" }),
  ]);
  const PREFIX = "gooffice.demo.v2.";
  const MARK_PREFIX = `${PREFIX}attendance.`;
  const LEGACY_PREFIX = "gooffice.demo.v1.";
  const memberIds = new Set(MEMBERS.map(member => member.id));
  const officeFormatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: OFFICE_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });

  function officeParts(now) {
    return Object.fromEntries(officeFormatter.formatToParts(now).filter(part => part.type !== "literal").map(part => [part.type, Number(part.value)]));
  }
  function dateId(now = new Date()) {
    const p = officeParts(now);
    return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
  }
  function dayNumber(key) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return NaN;
    const [year, month, day] = key.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return NaN;
    return date.getTime() / 86400000;
  }
  function calendarDates(now = new Date()) {
    const p = officeParts(now);
    // UTC здесь только для календарной арифметики; текущий день определён в часовом поясе офиса.
    const monday = new Date(Date.UTC(p.year, p.month - 1, p.day, 12));
    monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
    return Array.from({ length: 14 }, (_, offset) => new Date(monday.getTime() + offset * 86400000));
  }
  function isPast(key, now = new Date()) {
    return dayNumber(key) < dayNumber(dateId(now));
  }
  function canEdit(key, now = new Date()) {
    return !isPast(key, now) && calendarDates(now).some(date => dateId(date) === key);
  }
  function nextDayDelay(now = new Date()) {
    const p = officeParts(now);
    const nextWallMidnight = Date.UTC(p.year, p.month - 1, p.day + 1);
    let midnight = nextWallMidnight;
    // Находим реальный момент следующей полуночи через смещение часового пояса.
    for (let i = 0; i < 3; i += 1) {
      const q = officeParts(new Date(midnight));
      const offset = Date.UTC(q.year, q.month - 1, q.day, q.hour, q.minute, q.second) - midnight;
      midnight = nextWallMidnight - offset;
    }
    return Math.max(1, midnight - now.getTime() + 25);
  }

  function createDemoStore(storage, eventTarget, options = {}) {
    const cache = new Map();
    const subscribers = new Set();
    const clock = options.clock ?? Date.now;
    const makeId = options.makeId ?? (() => globalThis.crypto?.randomUUID?.() ?? `${clock()}-${Math.random().toString(36).slice(2)}`);
    let persistent = Boolean(storage);
    let lastOrder = 0;

    function syncKeys() {
      if (!persistent) return;
      try {
        const seen = new Set();
        for (let index = 0; index < storage.length; index += 1) {
          const key = storage.key(index);
          if (key?.startsWith(PREFIX) || key?.startsWith(LEGACY_PREFIX)) {
            cache.set(key, storage.getItem(key));
            seen.add(key);
          }
        }
        for (const key of cache.keys()) if (!seen.has(key)) cache.delete(key);
      } catch { persistent = false; }
    }
    syncKeys();
    function read(key) {
      if (persistent) {
        try {
          const value = storage.getItem(key);
          if (value === null) cache.delete(key); else cache.set(key, value);
          return value;
        } catch { persistent = false; }
      }
      return cache.get(key) ?? null;
    }
    function write(key, value) {
      if (value === null) cache.delete(key); else cache.set(key, value);
      if (!persistent) return;
      try {
        if (value === null) storage.removeItem(key); else storage.setItem(key, value);
      } catch { persistent = false; }
    }
    function get(date, memberId) {
      try {
        const mark = JSON.parse(read(`${MARK_PREFIX}${date}.${memberId}`));
        return mark && mark.memberId === memberId && mark.date === date && memberIds.has(memberId) && Number.isSafeInteger(mark.createdAt) && mark.createdAt >= 0 && typeof mark.id === "string" ? mark : null;
      } catch { return null; }
    }
    function list(date) {
      return MEMBERS.map(member => get(date, member.id)).filter(Boolean).sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    }
    function ensureWindow(now = new Date()) {
      const dates = calendarDates(now).map(dateId);
      if (read(`${PREFIX}seeded`) === null) {
        const hasLegacy = read(`${LEGACY_PREFIX}seeded`) !== null || [...cache.keys()].some(key => key.startsWith(`${LEGACY_PREFIX}attendance.`));
        if (hasLegacy) {
          // Старые статусы не содержали времени добавления. Переносим положительные
          // отметки совпадающих ID; исходные v1-записи оставляем без изменений.
          dates.forEach(date => MEMBERS.forEach((member, index) => {
            const value = read(`${LEGACY_PREFIX}attendance.${date}.${member.id}`);
            if (["yes", "maybe"].includes(value) && !get(date, member.id)) {
              write(`${MARK_PREFIX}${date}.${member.id}`, JSON.stringify({ id: `legacy-${member.id}`, date, memberId: member.id, createdAt: dayNumber(date) * 86400000 + index }));
            }
          }));
          const oldMember = read(`${LEGACY_PREFIX}member`);
          if (memberIds.has(oldMember) && read(`${PREFIX}member`) === null) write(`${PREFIX}member`, oldMember);
        } else {
          const fixtures = [
            ["alan", "denis", "anya", "dasha"], ["alan", "denis", "anya"], ["alan"],
            ["alan", "denis", "anya", "dasha"], ["alan"], ["denis"], ["alan", "denis", "dasha"],
            [], ["anya"], ["alan", "dasha"], ["denis", "alan", "dasha"], [], [], ["alan", "dasha"],
          ];
          fixtures.forEach((people, offset) => people.forEach((memberId, index) => {
            const date = dates[offset];
            if (!get(date, memberId)) write(`${MARK_PREFIX}${date}.${memberId}`, JSON.stringify({ id: `sample-${index}-${memberId}`, date, memberId, createdAt: dayNumber(date) * 86400000 + index }));
          }));
        }
        write(`${PREFIX}seeded`, "1");
      }
      syncKeys();
      const visible = new Set(dates);
      for (const key of cache.keys()) {
        if (key.startsWith(MARK_PREFIX) && !visible.has(key.slice(MARK_PREFIX.length, MARK_PREFIX.length + 10))) write(key, null);
      }
      return dates;
    }
    function emit() { subscribers.forEach(subscriber => subscriber()); }
    function toggle(date, memberId, now = new Date()) {
      if (!memberIds.has(memberId) || !canEdit(date, now)) return undefined;
      const existing = get(date, memberId);
      if (existing) {
        lastOrder = Math.max(lastOrder, existing.createdAt);
        write(`${MARK_PREFIX}${date}.${memberId}`, null);
      } else {
        const latest = list(date).reduce((max, mark) => Math.max(max, mark.createdAt), 0);
        lastOrder = Math.max(Math.trunc(clock()), lastOrder + 1, latest + 1);
        write(`${MARK_PREFIX}${date}.${memberId}`, JSON.stringify({ id: makeId(), date, memberId, createdAt: lastOrder }));
      }
      emit();
      return !existing;
    }
    function onStorage(event) {
      if (!persistent || (event.storageArea && event.storageArea !== storage)) return;
      if (event.key === null || event.key.startsWith(MARK_PREFIX)) { syncKeys(); emit(); }
    }
    eventTarget?.addEventListener("storage", onStorage);
    return {
      get persistent() { return persistent; }, ensureWindow, get, list, toggle,
      getMember() { const id = read(`${PREFIX}member`); return memberIds.has(id) ? id : null; },
      setMember(id) { if (memberIds.has(id)) write(`${PREFIX}member`, id); },
      subscribe(subscriber) { subscribers.add(subscriber); return () => subscribers.delete(subscriber); },
      destroy() { eventTarget?.removeEventListener("storage", onStorage); subscribers.clear(); },
    };
  }
  globalThis.OfficePlanner = Object.freeze({ OFFICE_TIME_ZONE, MEMBERS, dateId, calendarDates, isPast, canEdit, nextDayDelay, createDemoStore });
})();
