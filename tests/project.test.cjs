const { test } = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
require("../data.js");
const { calendarDates, dateId, createDemoStore, MEMBERS, isPast, canEdit, nextDayDelay } = globalThis.OfficePlanner;
const now = new Date("2026-11-05T10:00:00+03:00");
const prefix = "gooffice.demo.v2.";
class MemoryStorage {
  values = new Map();
  get length() { return this.values.size; }
  key(index) { return [...this.values.keys()][index] ?? null; }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}
function setup(options) {
  const storage = new MemoryStorage();
  const events = new EventTarget();
  const store = createDemoStore(storage, events, options);
  const dates = store.ensureWindow(now);
  return { storage, events, store, dates };
}
const people = (store, date) => store.list(date).map(mark => mark.memberId);

test("Две полные недели, воскресенье и переход на понедельник", () => {
  const dates = calendarDates(now);
  assert.equal(dates.length, 14);
  assert.equal(dateId(dates[0]), "2026-11-02");
  assert.equal(dateId(dates[13]), "2026-11-15");
  assert.equal(new Set(dates.map(dateId)).size, 14);
  assert.equal(dates[0].getUTCDay(), 1);
  assert.equal(dates[13].getUTCDay(), 0);
  assert.equal(dateId(calendarDates(new Date("2026-11-08T23:59:59+03:00"))[0]), "2026-11-02");
  assert.equal(dateId(calendarDates(new Date("2026-11-09T00:00:00+03:00"))[0]), "2026-11-09");
});

test("Границы месяца, года и високосный февраль", () => {
  const yearEnd = calendarDates(new Date("2026-12-31T12:00:00+03:00"));
  assert.equal(dateId(yearEnd[0]), "2026-12-28");
  assert.equal(dateId(yearEnd[13]), "2027-01-10");
  assert.ok(calendarDates(new Date("2028-02-29T12:00:00+03:00")).map(dateId).includes("2028-02-29"));
  assert.equal(dateId(calendarDates(new Date("2026-02-01T12:00:00+03:00"))[0]), "2026-01-26");
});

test("Смена дня строго в полночь офиса, а не UTC; задержка обновления до полуночи", () => {
  const before = new Date("2026-11-05T20:59:59.900Z");
  const after = new Date("2026-11-05T21:00:00.000Z");
  assert.equal(dateId(before), "2026-11-05");
  assert.equal(dateId(after), "2026-11-06");
  assert.equal(isPast("2026-11-05", before), false);
  assert.equal(isPast("2026-11-05", after), true);
  assert.equal(canEdit("2026-11-05", before), true);
  assert.equal(canEdit("2026-11-05", after), false);
  assert.equal(nextDayDelay(before), 125);
  assert.equal(nextDayDelay(after), 86400025);
  const newYear = new Date("2026-12-31T20:59:59.900Z");
  assert.equal(dateId(new Date(newYear.getTime() + nextDayDelay(newYear))), "2027-01-01");
});

test("Результат не зависит от часового пояса браузера или перехода на летнее время", () => {
  const script = `
    require(${JSON.stringify(path.resolve(__dirname, "../data.js"))});
    const { calendarDates, dateId, canEdit } = globalThis.OfficePlanner;
    const assert = require('node:assert/strict');
    const now = new Date('2026-11-08T21:01:00Z');
    assert.equal(dateId(now), '2026-11-09');
    assert.equal(dateId(calendarDates(now)[0]), '2026-11-09');
    assert.equal(canEdit('2026-11-08', now), false);
    for (const time of ['2026-03-08T04:00:00Z', '2026-11-01T04:00:00Z']) {
      const days = calendarDates(new Date(time));
      assert.equal(new Set(days.map(dateId)).size, 14);
      assert.equal(days[0].getUTCDay(), 1);
      assert.equal(days[13].getUTCDay(), 0);
    }
  `;
  for (const zone of ["Europe/Moscow", "America/New_York", "Pacific/Kiritimati"]) {
    execFileSync(process.execPath, ["-e", script], { env: { ...process.env, TZ: zone }, stdio: "pipe" });
  }
});

test("Нажатие добавляет отметку, повторное снимает, выходные доступны", () => {
  const { store, dates } = setup();
  const saturday = dates[12];
  assert.deepEqual(people(store, saturday), []);
  assert.equal(store.toggle(saturday, "alan", now), true);
  assert.deepEqual(people(store, saturday), ["alan"]);
  assert.equal(store.toggle(saturday, "alan", now), false);
  assert.deepEqual(people(store, saturday), []);
});

test("Хронология отличается от порядка в шапке; повторное добавление идёт в конец", () => {
  const { store, dates, storage } = setup({ clock: () => 100 });
  const date = dates[12];
  for (const id of ["denis", "anya", "alan"]) store.toggle(date, id, now);
  assert.deepEqual(people(store, date), ["denis", "anya", "alan"]);
  store.setMember("alan");
  store.setMember("dasha");
  assert.deepEqual(people(store, date), ["denis", "anya", "alan"]);
  store.toggle(date, "denis", now);
  store.toggle(date, "denis", now);
  assert.deepEqual(people(store, date), ["anya", "alan", "denis"]);
  const reloaded = createDemoStore(storage);
  reloaded.ensureWindow(now);
  assert.deepEqual(people(reloaded, date), ["anya", "alan", "denis"]);
});

test("Просмотр без выбора; выбранное имя и снятая тестовая отметка переживают перезагрузку", () => {
  const { store, storage, events, dates } = setup();
  assert.equal(store.getMember(), null);
  store.setMember("dasha");
  assert.equal(store.toggle(dates[3], "dasha", now), false);
  const reloaded = createDemoStore(storage, events);
  reloaded.ensureWindow(now);
  assert.equal(reloaded.getMember(), "dasha");
  assert.equal(reloaded.get(dates[3], "dasha"), null);
  reloaded.setMember("unknown");
  assert.equal(reloaded.getMember(), "dasha");
});

test("Прошедшие, несуществующие и внепериодные даты не редактируются", () => {
  const { store, dates, storage } = setup();
  const snapshot = [...storage.values];
  assert.equal(store.toggle(dates[0], "alan", now), undefined);
  assert.equal(store.toggle("2026-11-31", "alan", now), undefined);
  assert.equal(store.toggle("2026-12-01", "alan", now), undefined);
  assert.equal(store.toggle(dates[3], "unknown", now), undefined);
  assert.deepEqual([...storage.values], snapshot);
});

test("При смене недели удаляется прошлая, отметки общей недели сохраняются", () => {
  const { store, storage, dates } = setup();
  store.toggle(dates[12], "anya", now);
  storage.setItem("unrelated", "keep");
  const next = store.ensureWindow(new Date("2026-11-09T00:00:00+03:00"));
  assert.equal(next[0], dates[7]);
  assert.equal(next[13], "2026-11-22");
  assert.ok(store.get(dates[12], "anya"));
  assert.equal(store.get(dates[0], "alan"), null);
  for (const key of storage.values.keys()) if (key.startsWith(prefix + "attendance.")) assert.ok(next.some(date => key.includes(date)));
  assert.equal(storage.getItem("unrelated"), "keep");
});

test("Две вкладки не теряют чужие добавления и удаления", () => {
  const { store: first, storage, events, dates } = setup();
  const second = createDemoStore(storage, events);
  second.ensureWindow(now);
  first.toggle(dates[12], "anya", now);
  second.toggle(dates[12], "denis", now);
  assert.deepEqual(people(first, dates[12]), ["anya", "denis"]);
  assert.deepEqual(people(second, dates[12]), ["anya", "denis"]);
  first.toggle(dates[12], "anya", now);
  assert.deepEqual(people(second, dates[12]), ["denis"]);
  let updates = 0;
  second.subscribe(() => { updates += 1; });
  const event = new Event("storage");
  event.key = `${prefix}attendance.${dates[12]}.anya`;
  event.storageArea = storage;
  events.dispatchEvent(event);
  assert.equal(updates, 1);
  event.key = `${prefix}member`;
  events.dispatchEvent(event);
  assert.equal(updates, 1);
  second.destroy();
  event.key = null;
  events.dispatchEvent(event);
  assert.equal(updates, 1);
});

test("Одинаковое время одновременных отметок разрешается одинаково во всех вкладках", () => {
  const { storage, dates } = setup();
  const first = createDemoStore(storage, null, { clock: () => 100, makeId: () => "b" });
  const second = createDemoStore(storage, null, { clock: () => 100, makeId: () => "a" });
  first.toggle(dates[12], "alan", now);
  const originalRead = storage.getItem.bind(storage);
  // Вторая вкладка ещё не видит запись первой, как при одновременном добавлении.
  storage.getItem = key => key.endsWith(".alan") ? null : originalRead(key);
  second.toggle(dates[12], "denis", now);
  storage.getItem = originalRead;
  assert.equal(first.list(dates[12]).length, 2);
  assert.deepEqual(people(first, dates[12]), ["denis", "alan"]);
  assert.deepEqual(people(first, dates[12]), people(second, dates[12]));
});

test("Откат часов не переносит новую отметку перед уже существующими", () => {
  let time = 500;
  const { store, dates } = setup({ clock: () => time });
  store.toggle(dates[12], "denis", now);
  time = 1;
  store.toggle(dates[12], "alan", now);
  assert.deepEqual(people(store, dates[12]), ["denis", "alan"]);
});

test("Миграция положительных старых статусов сохраняет исходные данные", () => {
  const storage = new MemoryStorage();
  storage.setItem("gooffice.demo.v1.seeded", "1");
  storage.setItem("gooffice.demo.v1.member", "anya");
  storage.setItem("gooffice.demo.v1.attendance.2026-11-05.anya", "maybe");
  storage.setItem("gooffice.demo.v1.attendance.2026-11-06.anya", "no");
  storage.setItem("gooffice.demo.v1.attendance.2026-11-07.misha", "yes");
  const legacy = [...storage.values];
  const store = createDemoStore(storage);
  store.ensureWindow(now);
  assert.equal(store.getMember(), "anya");
  assert.deepEqual(people(store, "2026-11-05"), ["anya"]);
  assert.deepEqual(people(store, "2026-11-06"), []);
  assert.deepEqual(people(store, "2026-11-07"), []);
  for (const [key, value] of legacy) assert.equal(storage.getItem(key), value);
  store.toggle("2026-11-05", "anya", now);
  createDemoStore(storage).ensureWindow(now);
  assert.equal(store.get("2026-11-05", "anya"), null);
});

test("При недоступном localStorage и ошибке записи остаётся рабочая память", () => {
  for (const storage of [null, { get length() { throw new Error("blocked"); } }]) {
    const store = createDemoStore(storage);
    const dates = store.ensureWindow(now);
    store.setMember("anya");
    store.toggle(dates[12], "anya", now);
    assert.equal(store.persistent, false);
    assert.equal(store.getMember(), "anya");
    assert.deepEqual(people(store, dates[12]), ["anya"]);
  }
  const { store, storage, dates } = setup();
  storage.setItem = () => { throw new Error("quota exceeded"); };
  store.toggle(dates[12], "anya", now);
  assert.equal(store.persistent, false);
  assert.ok(store.get(dates[12], "anya"));
  assert.ok(store.get(dates[3], "alan"));
  assert.equal(store.toggle(dates[12], "anya", now), false);
});

test("Повреждённая запись не ломает список; персональные цвета заданы в одном месте", () => {
  const { storage, store, dates } = setup();
  storage.setItem(`${prefix}attendance.${dates[12]}.alan`, "broken JSON");
  assert.deepEqual(people(store, dates[12]), []);
  assert.equal(new Set(MEMBERS.map(member => member.color)).size, MEMBERS.length);
  assert.equal(new Set(MEMBERS.map(member => member.id)).size, MEMBERS.length);
});
