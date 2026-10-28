# Nova Launcher

Стильный десктопный лаунчер на Electron: живые обои, цветовые темы, новости,
каталог программ, регистрации/вход, верификация и админ-панель.
Бэкенд — Node.js API, размещаемый на blitz.cloud (ЕС, без GitHub).

## Структура

| Каталог | Что внутри |
| --- | --- |
| `app/` | Приложение Electron ( Liquid Glass UI, встраивание обоев в рабочий стол Windows через Win32/koffi ) |
| `server/` | API: Express + SQLite (`node:sqlite`), порт 8080 |
| `Dockerfile` | Сборка сервера для деплоя на blitz.cloud (в корне — требование blitz) |

## Локальный запуск

```powershell
# Сервер (Node.js 22+)
cd server
npm install
npm start            # http://localhost:8080

# Лаунчер
cd app
npm install
npm start            # или собрать установщик:
npm run dist         # -> app/dist/Nova Launcher Setup <версия>.exe
```

Учётная запись администратора по умолчанию: `admin / admin123`.

## Деплой на blitz.cloud

1. Этот репозиторий публичный, `Dockerfile` в корне — blitz собирает образ сам.
2. В дашборде: **Host something new → My own code →** вставить адрес репозитория.
3. blitz даёт приложению `PORT=8080` и подставляет HTTPS-адрес.
4. Данные (SQLite + загрузки) хранятся в `DATA_DIR` (по умолчанию `/data`).
5. В настройках лаунчера указать полученный HTTPS-адрес как URL API.

## API (кратко)

- `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`
- `GET /api/news`, `GET /api/programs` — публичный каталог
- `GET /api/update/latest` — проверка обновлений лаунчера
- `/api/admin/*` — новости, программы, аккаунты, обновления, статистика (токен админа)
