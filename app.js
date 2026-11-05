(() => {
  "use strict";

  const { MEMBERS, STATUSES, dateId, calendarDates, createDemoStore } = window.OfficePlanner;
  const calendar = document.querySelector("#calendar");
  const memberButton = document.querySelector("#member-button");
  const memberName = document.querySelector("#member-name");
  const dialog = document.querySelector("#member-dialog");
  const memberList = document.querySelector("#member-list");
  const announcement = document.querySelector("#announcement");
  const fullDate = new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const month = new Intl.DateTimeFormat("ru-RU", { month: "short" });
  const weekRange = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" });
  const weekdays = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
  let storage;
  try { storage = window.localStorage; } catch { storage = null; }
  const store = createDemoStore(storage, window);
  let selectedMember = store.getMember();
  let renderedToday = null;
  let visibleDates = [];
  let pendingAction = null;
  let returnFocus = null;
  let midnightTimer;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function renderIdentity() {
    const member = MEMBERS.find((item) => item.id === selectedMember);
    memberName.textContent = member?.name ?? "Выбрать имя";
    memberButton.setAttribute("aria-label", member ? `Участник: ${member.name}. Сменить участника` : "Выбрать имя");
  }

  function renderCalendar(now) {
    const dates = calendarDates(now);
    const fragment = document.createDocumentFragment();
    for (let weekIndex = 0; weekIndex < 2; weekIndex += 1) {
      const weekDates = dates.slice(weekIndex * 7, weekIndex * 7 + 7);
      const section = element("section", "week");
      const heading = element("h2", "week-heading", weekIndex === 0 ? "Эта неделя" : "Следующая неделя");
      heading.id = `week-${weekIndex}`;
      section.setAttribute("aria-labelledby", heading.id);
      const start = weekDates[0];
      const end = weekDates[6];
      const range = start.getMonth() === end.getMonth()
        ? `${start.getDate()}–${weekRange.format(end)}`
        : `${weekRange.format(start)} — ${weekRange.format(end)}`;
      heading.append(element("span", "week-range", range));
      const days = element("div", "days");
      weekDates.forEach((date) => {
        const id = dateId(date);
        const isToday = id === dateId(now);
        const card = element("article", `day${isToday ? " is-today" : ""}`);
        card.dataset.date = id;
        card.setAttribute("aria-label", fullDate.format(date));
        const dayHeading = element("div", "day-heading");
        const weekday = element("div", "weekday", weekdays[date.getDay()]);
        if (isToday) weekday.append(element("span", "today-label", "сегодня"));
        const time = element("time", "day-date", date.getDate());
        time.dateTime = id;
        if (isToday) time.setAttribute("aria-current", "date");
        time.append(element("span", "day-month", month.format(date).replace(/\.$/, "")));
        dayHeading.append(weekday, time);
        const controls = element("div", "status-controls");
        controls.setAttribute("role", "group");
        controls.setAttribute("aria-label", `Отметка на ${fullDate.format(date)}`);
        STATUSES.forEach((status) => {
          const button = element("button", "status-button");
          button.type = "button";
          button.dataset.status = status.id;
          button.dataset.date = id;
          button.title = status.label;
          const symbol = element("span", "", status.symbol);
          symbol.setAttribute("aria-hidden", "true");
          button.append(symbol);
          controls.append(button);
        });
        card.append(dayHeading, controls, element("div", "attendance"));
        days.append(card);
      });
      section.append(heading, days);
      fragment.append(section);
    }
    calendar.replaceChildren(fragment);
  }

  function renderAttendance() {
    const member = MEMBERS.find((item) => item.id === selectedMember);
    calendar.querySelectorAll(".day").forEach((card) => {
      const date = card.dataset.date;
      const marks = new Map(MEMBERS.map((person) => [person.id, store.get(date, person.id)]));
      card.querySelectorAll(".status-button").forEach((button) => {
        const status = STATUSES.find((item) => item.id === button.dataset.status);
        button.setAttribute("aria-pressed", String(Boolean(selectedMember) && marks.get(selectedMember) === status.id));
        button.setAttribute("aria-label", `${status.label}${member ? `: ${member.name}` : ""}`);
      });
      const groups = document.createDocumentFragment();
      STATUSES.forEach((status) => {
        const people = MEMBERS.filter((person) => marks.get(person.id) === status.id);
        if (!people.length) return;
        const group = element("div", "attendance-group");
        group.dataset.status = status.id;
        const symbol = element("span", "group-symbol", status.symbol);
        symbol.setAttribute("aria-hidden", "true");
        const names = element("span", "names");
        names.append(element("span", "sr-only", `${status.label}: `));
        people.forEach((person, index) => {
          if (index) names.append(document.createTextNode(", "));
          names.append(element("span", person.id === selectedMember ? "member-current" : "", person.name));
        });
        group.append(symbol, names);
        groups.append(group);
      });
      card.querySelector(".attendance").replaceChildren(groups);
    });
    document.querySelector("#storage-note").textContent = store.persistent
      ? "Отметки общие только для вкладок этого браузера."
      : "Сохранение в браузере недоступно. Имя и отметки сохранятся только до перезагрузки этой вкладки.";
  }

  function refresh() {
    const now = new Date();
    visibleDates = store.ensureWindow(now);
    if (renderedToday !== dateId(now)) {
      renderedToday = dateId(now);
      if (pendingAction && !visibleDates.includes(pendingAction.date)) dialog.close();
      renderCalendar(now);
    }
    renderAttendance();
    window.clearTimeout(midnightTimer);
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    midnightTimer = window.setTimeout(refresh, midnight.getTime() - now.getTime() + 50);
  }

  function openMemberPicker(action, trigger) {
    pendingAction = action;
    returnFocus = trigger;
    document.querySelector("#dialog-title").textContent = action ? "Кто отмечается?" : "Выберите участника";
    memberList.replaceChildren(...MEMBERS.map((member) => {
      const button = element("button", "member-option");
      button.type = "button";
      button.dataset.member = member.id;
      button.setAttribute("aria-pressed", String(member.id === selectedMember));
      const initial = element("span", "member-initial", member.name[0]);
      initial.setAttribute("aria-hidden", "true");
      button.append(initial, element("span", "", member.name));
      if (member.id === selectedMember) button.append(element("span", "member-option-selected", "Выбрано"));
      return button;
    }));
    dialog.showModal();
    const selected = memberList.querySelector('[aria-pressed="true"]') ?? memberList.querySelector("button");
    selected.focus({ preventScroll: true });
  }

  function applyAction(action) {
    const result = store.toggle(action.date, selectedMember, action.status);
    if (result === undefined) return;
    const name = MEMBERS.find((member) => member.id === selectedMember).name;
    const status = STATUSES.find((item) => item.id === result);
    announcement.textContent = `${name}, ${action.date}: ${status ? status.label : "отметка снята"}.`;
  }

  calendar.addEventListener("click", (event) => {
    const button = event.target.closest(".status-button");
    if (!button) return;
    // Проверяем окно дат также перед действием после сна или фоновой вкладки.
    refresh();
    const action = { date: button.dataset.date, status: button.dataset.status };
    if (!visibleDates.includes(action.date)) return;
    if (!selectedMember) openMemberPicker(action, button);
    else applyAction(action);
  });

  memberButton.addEventListener("click", () => openMemberPicker(null, memberButton));
  memberList.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-member]");
    if (!button) return;
    const action = pendingAction;
    selectedMember = button.dataset.member;
    store.setMember(selectedMember);
    pendingAction = null;
    dialog.close();
    renderIdentity();
    refresh();
    if (action && visibleDates.includes(action.date)) applyAction(action);
  });
  document.querySelector("#close-dialog").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => {
    pendingAction = null;
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    returnFocus = null;
  });
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
  store.subscribe(refresh);
  window.addEventListener("focus", refresh);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });

  renderIdentity();
  refresh();
})();
