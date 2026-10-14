import os, json, re, sys, time, urllib.request, urllib.error

code = open("index.html", encoding="utf-8").read()
todo = open("TODO.md", encoding="utf-8").read()
token = os.environ.get("MODEL_TOKEN") or os.environ["GITHUB_TOKEN"]

prompt = (
    "Ты дорабатываешь мобильное веб-приложение 'Джарвис' (один файл index.html, "
    "HTML+CSS+JS, без внешних библиотек и серверов, работает в Chrome на Android).\n"
    "Выполни ОДНУ следующую задачу из списка. Не ломай существующие функции.\n"
    "Верни ТОЛЬКО полный код index.html, без пояснений.\n\n"
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
        r = urllib.request.urlopen(req, timeout=180)
        raw = r.read().decode("utf-8", "replace")
        print("HTTP", r.status, "| длина ответа:", len(raw))
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        print("HTTP ОШИБКА", e.code, raw[:500])
        return None
    try:
        return json.loads(raw)["choices"][0]["message"]["content"]
    except Exception:
        print("Не JSON. Начало ответа:", repr(raw[:500]))
        return None

text = None
for attempt in range(3):
    text = ask()
    if text:
        break
    print("Повтор через 20 сек...")
    time.sleep(20)

if not text:
    print("ИИ не ответил, пропускаю этот запуск")
    sys.exit(0)

m = re.search(r"`(?:html)?\n(.*?)```", text, re.S)
new = (m.group(1) if m else text).strip()

if "</html>" not in new or len(new) < len(code) * 0.6:
    print("Ответ ИИ похож на сломанный, оставляю старую версию")
    sys.exit(0)

open("index.html", "w", encoding="utf-8").write(new + "\n")
print("Обновлено")
