import { createVisualEffects } from './visual-effects.mjs';
import { MAX_MEMBERS } from './participants.mjs?v=members-20';
(() => {
  "use strict";
  const { OFFICE_TIME_ZONE, dateId, calendarDates, isPast, canEdit, nextDayDelay } = window.OfficePlanner;
  const calendar = document.querySelector("#calendar");
  const options = document.querySelector("#member-options");
  const announcement = document.querySelector("#announcement");
  const memberForm = document.querySelector('#member-form');
  const memberInput = document.querySelector('#new-member-name');
  const memberError = document.querySelector('#member-error');
  let addingMember = false;
  let createdSelection = null;
  let membersFingerprint = '';
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
    const current = store.members.find(member => member.id === selectedMember);
    if (current) document.documentElement.style.setProperty("--accent-color", current.color);
    else document.documentElement.style.removeProperty("--accent-color");
    const buttons = store.members.map(member => {
      const button = element("button", "member-button", member.name);
      button.type = "button";
      button.dataset.member = member.id;
      button.setAttribute("aria-pressed", String(member.id === selectedMember));
      button.classList.toggle('is-entering', changed && member.id === selectedMember);
      return button;
    });
    options.replaceChildren(...buttons);
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
        const person = store.members.find(member => member.id === mark.memberId);
        return person ? element("span", person.id === selectedMember ? "attendee is-current" : "attendee", person.name) : null;
      }).filter(Boolean);
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
    if (createdSelection && store.members.some(member => member.id === createdSelection)) {
      selectedMember = createdSelection;
      store.setMember(selectedMember);
      createdSelection = null;
    }
    if (store.state.membersReady && selectedMember && !store.members.some(member => member.id === selectedMember)) {
      selectedMember = null;
      pendingDate = null;
      store.clearMember();
      announcement.textContent = 'Профиль удалён. Выберите другого участника в шапке.';
    }
    const fingerprint = JSON.stringify(store.members);
    if (fingerprint !== membersFingerprint || visualMember !== selectedMember) {
      membersFingerprint = fingerprint;
      renderIdentity();
    }
    updateMemberForm();
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
      const person = store.members.find(member => member.id === memberId);
      announcement.textContent = `${person?.name || 'Участник'}, ${date}: ${added ? 'отметка сохранена' : 'отметка снята'}.`;
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
      options.querySelector('button')?.focus();
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
  function updateMemberForm() {
    const busy = addingMember || store.state.membersSaving;
    const full = store.members.length >= MAX_MEMBERS;
    memberInput.disabled = full || (!busy && !store.state.membersReady);
    memberInput.readOnly = busy;
    memberInput.title = full ? `Уже есть ${MAX_MEMBERS} участников` : '';
    memberForm.setAttribute('aria-busy', String(busy));
  }
  memberInput.addEventListener('input', () => { memberError.hidden = true; });
  memberInput.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || addingMember || event.isComposing) return;
    event.preventDefault();
    memberInput.value = '';
    memberError.hidden = true;
    memberInput.blur();
  });
  memberForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (addingMember || store.state.membersSaving || memberInput.disabled) return;
    addingMember = true;
    memberError.hidden = true;
    updateMemberForm();
    try {
      const profile = await store.addMember(memberInput.value);
      createdSelection = profile.id;
      memberInput.value = '';
      memberInput.blur();
      refresh();
      announcement.textContent = `Добавлен участник ${profile.name}.`;
    } catch (error) {
      memberError.textContent = error.message || 'Не удалось добавить участника. Попробуйте ещё раз.';
      memberError.hidden = false;
    } finally { addingMember = false; updateMemberForm(); }
  });
  store.subscribe(refresh);
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  renderIdentity(); refresh();
})();
