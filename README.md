# gooffice

Календарь двух недель для команды, HTML/CSS/JavaScript без сборщика. Общие отметки — Cloud Firestore, имя — localStorage. Внешний Firebase Web SDK загружается браузерными ES-модулями, обычное и курсивное начертания Medeo Sans остаются локальными.

Запуск: `node tools/preview.cjs`, затем http://127.0.0.1:4173. Открытие через file:// не поддерживается.

Инструкция Firebase Console, схема, тесты и ограничения: [FIRESTORE.md](./FIRESTORE.md). Правила: [firestore.rules](./firestore.rules). Их необходимо проверить и опубликовать вручную; автоматически ничего не применяется.

Проверка: `node --test tests/project.test.cjs tests/cloud-store.test.mjs`.

Старое локальное тестовое хранилище оставлено как тестовый адаптер в data.js; приложение его больше не использует и отметки из него не переносит. Активные файлы интеграции: firebase-init.mjs, cloud-store.mjs, app.js. Интерфейс и CSS сохранены; HTML изменён только для подключения модулей и сообщения загрузки.

Для проверки самих правил: `npm ci`, затем `npm run test:rules` (нужна Java 21+). Это отдельные зависимости разработки, сборка сайта не добавлена. Команда запускает официальный Firestore Emulator с проектом demo-gooffice-rules. Результаты: [tests/FIRESTORE-EMULATOR-RESULTS.md](tests/FIRESTORE-EMULATOR-RESULTS.md). Пройдено 12 интеграционных и 21 прежний тест; production-правила не применялись.
