import { createVisualEffects } from './visual-effects.mjs';
(() => {
  "use strict";
  const { MEMBERS, OFFICE_TIME_ZONE, dateId, calendarDates, isPast, canEdit, nextDayDelay } = window.OfficePlanner;
  const calendar = document.querySelector("#calendar");
  const options = document.querySelector("#member-options");
  const announcement = document.querySelector("#announcement");
  const effects = createVisualEffects(calendar, document.querySelector('.site-header'));
  let identityRendered = false;
  let visualMember = null;
  const fullDate = new Intl.DateTimeFormat("ru-RU", { timeZone: OFFICE_TIME_ZONE, weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const shortDate = new Intl.DateTimeFormat("ru-RU", { timeZone: OFFICE_TIME_ZONE, day: "2-digit", month: "long" });
  const weekday = new Intl.DateTimeFormat("ru-RU", { timeZone: OFFICE_TIME_ZONE, weekday: "long" });
  const store = window.goofficeStore;
  store.ensureWindow();
  let selectedMember = store.getMember();
  let renderedToday = null;
  let pendingDate = null;
  let midnightTimer;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function renderIdentity() {
    const changed = identityRendered && visualMember !== selectedMember;
    effects.identity(selectedMember);
    const current = MEMBERS.find(member => member.id === selectedMember);
    if (current) document.documentElement.style.setProperty("--accent-color", current.color);
    else document.documentElement.style.removeProperty("--accent-color");
    options.replaceChildren(...MEMBERS.map(member => {
      const button = element("button", "member-button", member.name);
      button.type = "button";
      button.dataset.member = member.id;
      button.setAttribute("aria-pressed", String(member.id === selectedMember));
      button.classList.toggle('is-entering', changed && member.id === selectedMember);
      return button;
    }));
    visualMember = selectedMember;
    identityRendered = true;
  }
  function renderCalendar(now) {
    effects.resetCards();
    const dates = calendarDates(now);
    const focusedDate = document.activeElement?.dataset.date;
    const fragment = document.createDocumentFragment();
    for (let week = 0; week < 2; week += 1) {
      const section = element("section", `week${week ? " week-next" : ""}`);
      const heading = element("h2", week ? "week-divider" : "sr-only", week ? "Следующая неделя" : "Текущая неделя");
      heading.id = `week-${week}`;
      section.setAttribute("aria-labelledby", heading.id);
      const days = element("div", "days");
      dates.slice(week * 7, week * 7 + 7).forEach(date => {
        const key = dateId(date);
        const past = isPast(key, now);
        const tile = element("div", `day-tile${past ? " is-past" : ""}`);
        const label = element("div", "weekday", weekday.format(date));
        label.setAttribute("aria-hidden", "true");
        const card = element("button", `day${past ? " is-past" : ""}`);
        card.type = "button";
        card.dataset.date = key;
        card.dataset.label = fullDate.format(date);
        card.disabled = past;
        const time = element("time", "day-date", shortDate.format(date));
        time.dateTime = key;
        if (key === dateId(now)) time.setAttribute("aria-current", "date");
        card.append(time, element("span", "attendance"));
        effects.attach(card);
        tile.append(label, card);
        days.append(tile);
      });
      section.append(heading, days);
      fragment.append(section);
    }
    calendar.replaceChildren(fragment);
    if (focusedDate) calendar.querySelector(`.day[data-date="${focusedDate}"]:not(:disabled)`)?.focus({ preventScroll: true });
  }
  function renderAttendance() {
    calendar.querySelectorAll(".day").forEach(card => {
      const marks = store.list(card.dataset.date);
      const selected = marks.some(mark => mark.memberId === selectedMember);
      card.disabled = isPast(card.dataset.date) || !store.state.connected || store.isBusy(card.dataset.date);
      card.setAttribute("aria-busy", String(store.isBusy(card.dataset.date)));
      card.setAttribute("aria-pressed", String(selected));
      card.classList.toggle("is-selected", selected);
      effects.sync(card, selected);
      const names = marks.map(mark => {
        const person = MEMBERS.find(member => member.id === mark.memberId);
        return element("span", person.id === selectedMember ? "attendee is-current" : "attendee", person.name);
      });
      card.querySelector(".attendance").replaceChildren(...names);
      const description = card.dataset.label;
      card.setAttribute("aria-label", `${description}. ${names.length ? `Отметились: ${names.map(name => name.textContent).join(", ")}.` : "Пока никто не отметился."}${isPast(card.dataset.date) ? " Прошедший день." : ""}`);
    });
    const note = document.querySelector("#storage-note");
    const state = store.state;
    note.classList.toggle("sr-only", !state.loading && !state.error && !state.saving);
    note.textContent = state.error || (state.loading ? "Загрузка отметок…" : state.saving ? "Сохранение отметки…" : "");

  }
  function refresh() {
    const now = new Date();
    store.ensureWindow(now);
    if (pendingDate && !canEdit(pendingDate, now)) pendingDate = null;
    if (renderedToday !== dateId(now)) { renderedToday = dateId(now); renderCalendar(now); }
    renderAttendance();
    clearTimeout(midnightTimer);
    midnightTimer = setTimeout(refresh, nextDayDelay(now));
  }
  async function applyMark(date) {
    const memberId = selectedMember;
    try {
      const added = await store.toggle(date, memberId);
      if (added === undefined) return;
      effects.confirmed(date, memberId, added);
      const person = MEMBERS.find(member => member.id === memberId);
      announcement.textContent = `${person.name}, ${date}: ${added ? 'отметка сохранена' : 'отметка снята'}.`;
    } catch { announcement.textContent = 'Не удалось сохранить отметку.'; }
  }
  calendar.addEventListener('click', event => {
    const card = event.target.closest('button.day');
    if (!card) return;
    refresh();
    if (card.disabled || !canEdit(card.dataset.date)) return;
    if (!selectedMember) {
      pendingDate = card.dataset.date;
      announcement.textContent = 'Выберите участника в шапке.';
      options.querySelector('button').focus();
    } else applyMark(card.dataset.date);
  });
  options.addEventListener('click', event => {
    const button = event.target.closest('button[data-member]');
    if (!button) return;
    selectedMember = button.dataset.member;
    store.setMember(selectedMember);
    const pending = pendingDate;
    pendingDate = null;
    renderIdentity(); refresh();
    options.querySelector(`[data-member="${selectedMember}"]`).focus({ preventScroll: true });
    if (pending && canEdit(pending)) applyMark(pending);
  });
  options.addEventListener('keydown', event => { if (event.key === 'Escape') pendingDate = null; });
  store.subscribe(refresh);
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  renderIdentity(); refresh();
})();
