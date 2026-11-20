import { archiveEntries } from './entries.mjs';

const archive = document.querySelector('#archive');
const dates = document.createDocumentFragment();

for (const { date, label, href } of [...archiveEntries].sort((a, b) => b.date.localeCompare(a.date))) {
  const time = document.createElement('time');
  time.dateTime = date;
  time.textContent = label;

  if (href) {
    const link = document.createElement('a');
    link.className = 'text-link';
    link.href = href;
    link.append(time);
    dates.append(link);
  } else {
    dates.append(time);
  }
}

archive.append(dates);
