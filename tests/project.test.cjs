const { test } = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
require("../data.js");
const { calendarDates, dateId, createDemoStore, MEMBERS } = globalThis.OfficePlanner;
const now = new Date(2026, 10, 5, 10);

class MemoryStorage {
  values = new Map();
  get length() { return this.values.size; }
  key(index) { return [...this.values.keys()][index] ?? null; }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

function setup() {
  const storage = new MemoryStorage();
  const events = new EventTarget();
  const store = createDemoStore(storage, events);
  const dates = store.ensureWindow(now);
  return { storage, events, store, dates };
}

test("Календарь: ровно две полные недели, воскресенье принадлежит текущей", () => {
  const dates = calendarDates(now);
  assert.equal(dates.length, 14);
  assert.equal(dateId(dates[0]), "2026-11-02");
  assert.equal(dateId(dates[13]), "2026-11-15");
  assert.equal(new Set(dates.map(dateId)).size, 14);
  assert.equal(dates[0].getDay(), 1);
  assert.equal(dates[6].getDay(), 0);
  assert.equal(dates[7].getDay(), 1);
  assert.equal(dateId(calendarDates(new Date(2026, 10, 8, 23, 59))[0]), "2026-11-02");
  assert.equal(dateId(calendarDates(new Date(2026, 10, 9, 0, 0))[0]), "2026-11-09");
});

test("Календарь: границы месяца, года и високосный февраль", () => {
  const newYear = calendarDates(new Date(2026, 11, 31));
  assert.equal(dateId(newYear[0]), "2026-12-28");
  assert.equal(dateId(newYear[13]), "2027-01-10");
  assert.ok(calendarDates(new Date(2028, 1, 29)).map(dateId).includes("2028-02-29"));
  assert.equal(dateId(calendarDates(new Date(2026, 1, 1))[0]), "2026-01-26");
});

test("Календарные даты корректны при переходах летнего времени и в разных часовых поясах", () => {
  const script = `
    require(${JSON.stringify(path.resolve(__dirname, "../data.js"))});
    const { calendarDates, dateId } = globalThis.OfficePlanner;
    const assert = require('node:assert/strict');
    for (const now of [new Date(2026, 2, 8), new Date(2026, 10, 1), new Date(2026, 10, 5)]) {
      const dates = calendarDates(now);
      assert.equal(dates[0].getDay(), 1);
      assert.equal(dates[13].getDay(), 0);
      assert.equal(new Set(dates.map(dateId)).size, 14);
      for (let i = 1; i < dates.length; i++) {
        const next = new Date(dates[i - 1]); next.setDate(next.getDate() + 1);
        assert.equal(dateId(next), dateId(dates[i]));
      }
    }
    assert.equal(dateId(new Date(2026, 10, 5, 0, 1)), '2026-11-05');
  `;
  for (const zone of ["Europe/Moscow", "America/New_York", "Pacific/Kiritimati"]) {
    execFileSync(process.execPath, ["-e", script], { env: { ...process.env, TZ: zone }, stdio: "pipe" });
  }
});

test("Один статус заменяется другим, повторное нажатие снимает отметку, выходные доступны", () => {
  const { store, dates } = setup();
  const sunday = dates[6];
  assert.equal(store.get(sunday, "dima"), null);
  assert.equal(store.toggle(sunday, "dima", "yes", now), "yes");
  assert.equal(store.toggle(sunday, "dima", "maybe", now), "maybe");
  assert.equal(store.get(sunday, "dima"), "maybe");
  assert.equal(store.toggle(sunday, "dima", "maybe", now), null);
  assert.equal(store.get(sunday, "dima"), null);
});

test("Просмотр не выбирает имя; выбранный участник и снятые тестовые отметки сохраняются", () => {
  const { store, storage, events, dates } = setup();
  assert.equal(store.getMember(), null);
  store.setMember("anya");
  assert.equal(store.toggle(dates[0], "anya", "yes", now), null);
  const reloaded = createDemoStore(storage, events);
  reloaded.ensureWindow(now);
  assert.equal(reloaded.getMember(), "anya");
  assert.equal(reloaded.get(dates[0], "anya"), null);
  store.setMember("unknown");
  assert.equal(store.getMember(), "anya");
});

test("Смена недели удаляет прошлую и сохраняет отметки общей недели", () => {
  const { store, storage, dates } = setup();
  store.toggle(dates[8], "sasha", "no", now);
  storage.setItem("other-app", "keep");
  const nextDates = store.ensureWindow(new Date(2026, 10, 9));
  assert.equal(nextDates[0], dates[7]);
  assert.equal(nextDates[13], "2026-11-22");
  assert.equal(store.get(dates[8], "sasha"), "no");
  assert.equal(store.get(dates[0], "anya"), null);
  for (const key of storage.values.keys()) {
    if (key.includes("attendance.")) assert.ok(nextDates.some((date) => key.includes(date)));
  }
  assert.equal(storage.getItem("other-app"), "keep");
});

test("Независимые вкладки видят изменения разных людей без перезаписи чужих отметок", () => {
  const { store: first, storage, events, dates } = setup();
  const second = createDemoStore(storage, events);
  second.ensureWindow(now);
  first.toggle(dates[6], "anya", "yes", now);
  second.toggle(dates[6], "dima", "maybe", now);
  assert.equal(first.get(dates[6], "dima"), "maybe");
  assert.equal(second.get(dates[6], "anya"), "yes");
  let updates = 0;
  second.subscribe(() => { updates += 1; });
  const externalMark = new Event("storage");
  externalMark.key = `gooffice.demo.v1.attendance.${dates[6]}.anya`;
  externalMark.storageArea = storage;
  events.dispatchEvent(externalMark);
  assert.equal(updates, 1);
  const externalIdentity = new Event("storage");
  externalIdentity.key = "gooffice.demo.v1.member";
  events.dispatchEvent(externalIdentity);
  assert.equal(updates, 1);
  second.destroy();
  events.dispatchEvent(externalMark);
  assert.equal(updates, 1);
});

test("Неотметившиеся не появляются в данных, неверные участники, статусы и даты отклоняются", () => {
  const { store, dates } = setup();
  assert.ok(MEMBERS.every((person) => store.get(dates[6], person.id) === null));
  assert.equal(store.toggle(dates[6], "unknown", "yes", now), undefined);
  assert.equal(store.toggle(dates[6], "anya", "unknown", now), undefined);
  assert.equal(store.toggle("2026-10-01", "anya", "yes", now), undefined);
});

test("При недоступном хранилище приложение работает в памяти", () => {
  const blockedStorage = { get length() { throw new Error("blocked"); } };
  for (const storage of [null, blockedStorage]) {
    const store = createDemoStore(storage);
    const dates = store.ensureWindow(now);
    assert.equal(store.persistent, false);
    store.setMember("lena");
    assert.equal(store.getMember(), "lena");
    store.toggle(dates[6], "lena", "no", now);
    assert.equal(store.get(dates[6], "lena"), "no");
  }
});

test("Ошибка записи не ломает редактирование и сохраняет остальные отметки в памяти", () => {
  const { store, storage, dates } = setup();
  storage.setItem = () => { throw new Error("quota exceeded"); };
  store.toggle(dates[6], "anya", "yes", now);
  assert.equal(store.persistent, false);
  assert.equal(store.get(dates[6], "anya"), "yes");
  assert.equal(store.get(dates[0], "dima"), "yes");
  assert.equal(store.toggle(dates[6], "anya", "yes", now), null);
});
