/* Даты и тестовое хранилище. Сетевых запросов здесь нет. */
(() => {
  "use strict";

  const MEMBERS = Object.freeze([
    { id: "anya", name: "Аня" },
    { id: "dima", name: "Дима" },
    { id: "lena", name: "Лена" },
    { id: "misha", name: "Миша" },
    { id: "sasha", name: "Саша" },
  ]);
  const STATUSES = Object.freeze([
    { id: "yes", label: "Точно иду", symbol: "✓" },
    { id: "maybe", label: "Можно сходить", symbol: "~" },
    { id: "no", label: "Не смогу", symbol: "×" },
  ]);
  const PREFIX = "gooffice.demo.v1.";
  const ATTENDANCE_PREFIX = `${PREFIX}attendance.`;
  const MEMBER_KEY = `${PREFIX}member`;
  const SEEDED_KEY = `${PREFIX}seeded`;
  const memberIds = new Set(MEMBERS.map((member) => member.id));
  const statusIds = new Set(STATUSES.map((status) => status.id));

  function dateId(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function calendarDates(now = new Date()) {
    // Календарная арифметика сохраняет локальные даты при переходе на летнее время.
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
    monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7);
    return Array.from({ length: 14 }, (_, offset) => {
      const day = new Date(monday);
      day.setDate(monday.getDate() + offset);
      return day;
    });
  }

  function createDemoStore(storage, eventTarget) {
    const cache = new Map();
    const subscribers = new Set();
    let persistent = Boolean(storage);

    try {
      if (storage) {
        for (let index = 0; index < storage.length; index += 1) {
          const key = storage.key(index);
          if (key?.startsWith(PREFIX)) cache.set(key, storage.getItem(key));
        }
      }
    } catch {
      persistent = false;
    }

    function read(key) {
      if (persistent) {
        try {
          const value = storage.getItem(key);
          if (value === null) cache.delete(key);
          else cache.set(key, value);
          return value;
        } catch {
          persistent = false;
        }
      }
      return cache.get(key) ?? null;
    }

    function write(key, value) {
      if (value === null) cache.delete(key);
      else cache.set(key, value);
      if (!persistent) return;
      try {
        if (value === null) storage.removeItem(key);
        else storage.setItem(key, value);
      } catch {
        persistent = false;
      }
    }

    function emit() {
      subscribers.forEach((subscriber) => subscriber());
    }

    function ensureWindow(now = new Date()) {
      const dates = calendarDates(now).map(dateId);
      if (read(SEEDED_KEY) === null) {
        // Только первый запуск: пустые дни намеренно оставлены без отметок.
        const fixtures = [
          [0, "anya", "yes"], [0, "dima", "yes"], [0, "lena", "maybe"],
          [1, "misha", "yes"], [1, "sasha", "no"],
          [2, "anya", "yes"], [2, "lena", "yes"], [2, "dima", "maybe"], [2, "sasha", "no"],
          [3, "dima", "yes"], [3, "misha", "yes"], [3, "anya", "maybe"],
          [4, "lena", "yes"], [4, "sasha", "maybe"],
          [5, "misha", "maybe"], [5, "dima", "no"],
          [7, "anya", "yes"], [7, "lena", "yes"], [7, "sasha", "maybe"],
          [8, "dima", "yes"], [8, "misha", "maybe"],
          [9, "anya", "maybe"], [9, "sasha", "yes"], [9, "lena", "no"],
          [10, "dima", "yes"], [10, "lena", "yes"], [10, "misha", "yes"],
          [11, "sasha", "yes"], [11, "anya", "no"],
          [13, "lena", "maybe"],
        ];
        fixtures.forEach(([offset, member, status]) => {
          const key = `${ATTENDANCE_PREFIX}${dates[offset]}.${member}`;
          if (read(key) === null) write(key, status);
        });
        write(SEEDED_KEY, "1");
      }

      // Перечитываем ключи: другие вкладки могли добавить отметки после запуска.
      if (persistent) {
        try {
          for (let index = 0; index < storage.length; index += 1) {
            const key = storage.key(index);
            if (key?.startsWith(ATTENDANCE_PREFIX)) cache.set(key, storage.getItem(key));
          }
        } catch {
          persistent = false;
        }
      }
      const visibleDates = new Set(dates);
      for (const key of cache.keys()) {
        if (key.startsWith(ATTENDANCE_PREFIX) && !visibleDates.has(key.slice(ATTENDANCE_PREFIX.length, ATTENDANCE_PREFIX.length + 10))) {
          write(key, null);
        }
      }
      return dates;
    }

    function get(date, member) {
      const status = read(`${ATTENDANCE_PREFIX}${date}.${member}`);
      return statusIds.has(status) ? status : null;
    }

    function toggle(date, member, status, now = new Date()) {
      if (!memberIds.has(member) || !statusIds.has(status) || !calendarDates(now).some((day) => dateId(day) === date)) return undefined;
      const nextStatus = get(date, member) === status ? null : status;
      // Отдельный ключ на дату и человека: изменения разных людей не затирают друг друга.
      write(`${ATTENDANCE_PREFIX}${date}.${member}`, nextStatus);
      emit();
      return nextStatus;
    }

    function onStorage(event) {
      if (!persistent || (event.storageArea && event.storageArea !== storage)) return;
      if (event.key === null || event.key.startsWith(ATTENDANCE_PREFIX)) emit();
      // Имя в уже открытой вкладке не меняется вслед за соседней вкладкой.
    }
    eventTarget?.addEventListener("storage", onStorage);

    return {
      get persistent() { return persistent; },
      ensureWindow,
      get,
      toggle,
      getMember() {
        const member = read(MEMBER_KEY);
        return memberIds.has(member) ? member : null;
      },
      setMember(member) {
        if (memberIds.has(member)) write(MEMBER_KEY, member);
      },
      subscribe(subscriber) {
        subscribers.add(subscriber);
        return () => subscribers.delete(subscriber);
      },
      destroy() {
        eventTarget?.removeEventListener("storage", onStorage);
        subscribers.clear();
      },
    };
  }

  globalThis.OfficePlanner = Object.freeze({ MEMBERS, STATUSES, dateId, calendarDates, createDemoStore });
})();
