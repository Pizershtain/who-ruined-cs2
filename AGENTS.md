# Repository instructions

- `SPEC.md` supplied by the user is normative.
- Keep parser, normalized domain, features, scoring, reports, API and UI boundaries separate.
- Never infer a stable team from `T`/`CT`; team IDs are roster-based.
- Missing parser values stay unavailable/null. Never invent parser output or claim real-demo validation from synthetic fixtures.
- Ordinary deaths are facts, not tactical blame.
- Run `pnpm lint && pnpm typecheck && pnpm test && pnpm build` at each milestone gate.

## Responsibility split

- Backend/M2 work owns parser capability mapping, normalized domain events,
  deterministic feature computation, persistence artifacts, API contracts,
  OpenAPI annotations, backend tests and factual documentation.
- Frontend work owns React components, visual design, CSS and interaction
  details. Backend changes must provide versioned DTOs and anonymized fixtures
  so frontend work does not depend on private demos.
- Do not mix M3 scoring, ranking or blame labels into M2 feature code. M2 emits
  factual, availability-aware analytics only.

## Frontend и переводы

- Frontend: `apps/web`. Не переносить парсер, расчёт признаков или оценок в UI.
- Все пользовательские тексты, включая ошибки, aria-label и пустые состояния,
  проходят через `react-i18next`. Не переводить ники, SteamID, имена карт и
  исходные диагностические сообщения backend; последние явно подписывать.
- WRC Locale Kit: английский источник, namespace JSON,
  статическое извлечение, синхронизация задач переводчику и проверка длины.
  Runtime адаптирован к Vite/React Router; Next.js, WSL и внешние сервисы не нужны.
- Модуль: `apps/web/src/shared/i18n`; локали:
  `locales/<language>/<namespace>.json`.
- `locale-catalog.ts` — 37 поддерживаемых языков, самоназвания, направление
  письма и идентификатор модуля `wrc.locale-kit`. `settings.ts` — английский fallback, общий namespace
  `translation`. Страницы используют `home`, `job`, `match`, `player`,
  `about`; режим примеров — `preview`. Namespace загружаются по требованию.
- `components/LanguageSwitcher.tsx` — поиск по самоназванию, названию через
  `Intl.DisplayNames` и коду; значки показывают код языка. Esc закрывает меню
  и возвращает фокус на кнопку. Не терять управление стрелками/Enter и RTL.
- `client.ts` хранит только URL JSON-ресурсов в сборке; содержимое загружается
  по требованию. `prepareLanguage` готовит используемые namespace перед сменой
  языка и позволяет повторить запрос после ошибки, сохраняя рабочий язык.
- Использовать `useTranslation('match')` и статические вызовы
  `t('round-label', 'Round {{round}}', { round: ordinal })`.
  Ключи и namespace — литералы. Нельзя шаблонные ключи вида ``t(`prefix-${code}`)``,
  конкатенацию ключей или пользовательские строки как ключ.
  Для enum — switch со статическим `t()` в каждой ветке.
- Общие сообщения вынесены в `shared/messages.ts`. Ошибки API переводятся
  по машинному коду, неизвестный код получает общее сообщение.
- Английский defaultValue в коде — источник текста для экстрактора.
  При изменении текста не править только английский JSON: следующий gettext
  восстановит значение из кода.
- Даты и числа форматировать через `Intl` с текущей локалью. Для количества
  использовать `count` и i18next CLDR-формы, а не ручные условия для русского.
  Не склеивать предложения из переведённых фрагментов.

### Команды в Windows (PowerShell / cmd)

Первичная установка: `npm.cmd run setup:windows`. Скрипт использует закреплённый
Corepack/pnpm, создаёт launcher только в `node_modules/.bin` и не меняет PATH
системы. Затем можно вызывать команды через `npm.cmd run`, даже если `pnpm`
отсутствует в PATH. Эквивалент для существующего pnpm: `pnpm <script>`.

В Windows используем именно `npm.cmd`: установленный npm.ps1 может терять
разделитель `--` и именованные аргументы. На Linux/macOS — обычный `npm`.

1. `npm.cmd run gettext` — извлечь статические ключи и обновить EN.
2. `npm.cmd run i18n:sync` — обновить структуру целевых локалей и
   `translation-tasks.json`. Новые значения пустые; существующие сохраняются.
3. Перевести задачи по `apps/web/src/shared/i18n/prompt.md`.
4. `npm.cmd run i18n:sync` повторно — обновить состояние задач.
5. `npm.cmd run i18n:check` — проверить извлечение, полноту, устаревшие строки,
   плейсхолдеры и теги. Проверка ничего не записывает.
6. `npm.cmd run i18n:compact` — собрать кандидатов на сокращение; затем проверить
   реальный UI, не сокращать текст автоматически по числу символов.

Выборочная работа: `npm.cmd run i18n:sync -- --langs=ru --files=match,player`.
Просмотр без записи: `npm.cmd run i18n:sync -- --dry-run`.
Сокращение: `npm.cmd run i18n:compact -- --langs=ru --files=home --ratio=1.5`.

Изменённый английский текст оставляет старый перевод и задачу на проверку.
Задача не исчезает от повторных sync. Если перевод после ручной проверки
действительно остаётся прежним:
`npm.cmd run i18n:sync -- --langs=ru --files=match --acknowledge`.
Это подтверждает все текущие переводы выбранных файлов/языков; применять только
после их проверки, не как способ заставить проверку пройти.

Новый язык: добавить код, самоназвание и направление в `locale-catalog.ts`, запустить sync,
заполнить созданные JSON, повторить sync/check и проверить UI, числа, даты,
множественное число и направление письма. Незаполненный язык не выпускать.
Состояние `.translation-state.json` и `translation-tasks.json` хранить рядом
с локалями в репозитории. Синхронизация и сокращение работают локально,
без отправки текстов внешним сервисам.

### Проверки frontend

- `npm.cmd run dev:web`: UI `http://localhost:5173`, остановка Ctrl+C.
- Отдельные frontend-спеки в текущий набор изменений не входят.
  Для локализации запускать `npm.cmd run i18n:check` и проверять страницы в браузере,
  включая сохранение языка, формы количества, длинные подписи и арабский RTL.
- `/preview/available`, `/preview/low-confidence`,
  `/preview/insufficient-data`, `/preview/m1`, `/preview/partial`
  доступны только на dev-сервере. Синтетика всегда подписана и не подменяет API.
- `/preview/states?view=match-loading` — галерея загрузок, ошибок, обработки,
  пустых состояний и отсутствия сети. Она не делает запросов к API.
- Общие скелетоны — `components/Skeleton.tsx`, иллюстрация состояний —
  `SignalIllustration.tsx`. Анимации должны учитывать `prefers-reduced-motion`;
  загрузка и ошибка обновления не должны скрывать уже полученные данные.
- Процент передачи файла берётся только из событий XHR. Отмена останавливает
  локальную передачу, а не серверную задачу. Этапы обработки не изображать
  выдуманными процентами или временем до завершения.
- Не принимать UI fixtures за проверку реальных демо. `analytics/types.ts` —
  модель представления, а не контракт сервера. Реальный M2 DTO берётся из
  `@who-ruined/contracts` через `hooks/useAnalytics.ts` и `analytics/adapter.ts`.
  Адаптер проверяет matchId, playerId и roster teamId, сохраняет null и availability;
  HE/fire отображаются отдельно, без вычисления суммарных метрик в UI.
  HTTP 409 у старого отчёта сохраняет базовые данные и предлагает новую загрузку.
  M3 не реализован: рейтинги, тактические выводы и вклад по раундам не выдумывать.
- Композиция внутренних экранов — `docs/design-composition.md` (секции `Story`,
  одна сцена на секцию, окно `Sheet` для полной версии). После правки цветов в
  `src/index.css` запускать `npm.cmd run design:contrast` (WCAG AA 4,5:1).
- `npm.cmd run demo:web` собирает демо одним HTML-файлом в `apps/web/dist-demo/`.
- Подробности запуска и интеграции: `docs/frontend.md`.
