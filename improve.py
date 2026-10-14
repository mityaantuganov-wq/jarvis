import os, json, re, sys, time, urllib.request, urllib.error

code = open("index.html", encoding="utf-8").read()
todo = open("TODO.md", encoding="utf-8").read()
token = os.environ.get("MODEL_TOKEN") or os.environ.get("GITHUB_TOKEN")
if not token:
    print("Нет токена GitHub Models; безопасно пропускаю запуск")
    sys.exit(0)

prompt = (
    "Ты дорабатываешь мобильное веб-приложение 'Джарвис' (один файл index.html, "
    "HTML+CSS+JS, без внешних библиотек и серверов, работает в Chrome на Android).\n"
    "Выполни ОДНУ задачу, которую реально можно выполнить только в этом клиентском файле. "
    "Если ближайшая задача требует серверной инфраструктуры или секретов, не имитируй её: "
    "сохрани текущий код без изменений. Не ломай существующие функции.\n"
    "Верни ТОЛЬКО полный код index.html, без пояснений. Не добавляй API-ключи, токены "
    "или фиктивное подключение к ИИ.\n\n"
    f"Задачи:\n{todo}\n\nТекущий код:\n{code}"
)
body = json.dumps({
    "model": "openai/gpt-4o-mini",
    "messages": [{"role": "user", "content": prompt}],
    "max_tokens": 8000,
}).encode()

def ask():
    req = urllib.request.Request(
        "https://models.github.ai/inference/chat/completions",
        data=body, method="POST",
        headers={"Authorization": "Bearer " + token,
                 "Content-Type": "application/json",
                 "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=180) as response:
            raw = response.read().decode("utf-8", "replace")
            print("HTTP", response.status, "| длина ответа:", len(raw))
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        print("HTTP ОШИБКА", e.code, raw[:500])
        return None
    except (urllib.error.URLError, TimeoutError) as e:
        print("Ошибка сети:", str(e)[:300])
        return None
    try:
        return json.loads(raw)["choices"][0]["message"]["content"]
    except (ValueError, KeyError, IndexError, TypeError):
        print("Ответ API не содержит ожидаемый текст")
        return None

text = None
for attempt in range(3):
    text = ask()
    if text and text.strip():
        break
    if attempt < 2:
        print("Повтор через 20 сек...")
        time.sleep(20)

if not text or not text.strip():
    print("ИИ не ответил, пропускаю этот запуск")
    sys.exit(0)

m = re.search(r"`(?:html)?\n(.*?)```", text, re.S)
new = (m.group(1) if m else text).strip()
new = re.sub(r"^<!DOCTYPE html>", "<!DOCTYPE html>", new, flags=re.I)

# Базовая проверка целостности документа до сохранения.
if not re.match(r"(?is)^<!doctype html>\s*<html\b", new):
    print("Отклонено: ответ не начинается с полноценного HTML-документа")
    sys.exit(0)
if not re.search(r"(?is)</html>\s*$", new) or len(new) < len(code) * 0.6:
    print("Отклонено: HTML неполный или подозрительно короткий")
    sys.exit(0)
if new.count("<script") != new.count("</script>") or new.count("<style") != new.count("</style>"):
    print("Отклонено: не совпадают открывающие и закрывающие script/style")
    sys.exit(0)

# Не разрешаем модели незаметно удалять уже существующие возможности.
required_features = {
    "голосовой диалог": "voiceMode",
    "голосовое распознавание": "SpeechRecognition",
    "озвучивание": "speechSynthesis",
    "локальное хранилище": "localStorage",
    "заметки": "jarvis.notes.v1",
    "история чата": "jarvis.history.v1",
    "таймер": "таймер",
    "очистка чата": "clear",
    "справка": "showHelp",
}
missing = [name for name, marker in required_features.items() if marker not in new]
if missing:
    print("Отклонено: потеряны обязательные функции:", ", ".join(missing))
    sys.exit(0)

# Отсекаем распространённые форматы секретных ключей в клиентском HTML.
secret_patterns = [
    r"sk-[A-Za-z0-9]{20,}",
    r"gh[pousr]_[A-Za-z0-9]{20,}",
    r"AIza[0-9A-Za-z_\-]{30,}",
]
if any(re.search(pattern, new) for pattern in secret_patterns):
    print("Отклонено: обнаружена строка, похожая на секретный ключ")
    sys.exit(0)

if new == code.strip():
    print("Изменений нет")
    sys.exit(0)

open("index.html", "w", encoding="utf-8").write(new + "\n")
print("Обновлено: HTML прошёл базовые проверки целостности и сохранения функций")
