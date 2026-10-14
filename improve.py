import os, json, re, sys, urllib.request

code = open("index.html", encoding="utf-8").read()
todo = open("TODO.md", encoding="utf-8").read()

prompt = (
    "Ты дорабатываешь мобильное веб-приложение 'Джарвис' (один файл index.html, "
    "HTML+CSS+JS, без внешних библиотек и серверов, работает в Chrome на Android).\n"
    "Выполни ОДНУ следующую задачу из списка. Не ломай существующие функции.\n"
    "Верни ТОЛЬКО полный код index.html, без пояснений.\n\n"
    f"Задачи:\n{todo}\n\nТекущий код:\n{code}"
)

req = urllib.request.Request(
    "https://models.github.ai/inference/chat/completions",
    data=json.dumps({"model": "openai/gpt-4o-mini",
                     "messages": [{"role": "user", "content": prompt}]}).encode(),
    headers={"Authorization": "Bearer " + os.environ["GITHUB_TOKEN"],
             "Content-Type": "application/json"},
)
text = json.load(urllib.request.urlopen(req, timeout=120))["choices"][0]["message"]["content"]

m = re.search(r"```(?:html)?\n(.*?)```", text, re.S)
new = (m.group(1) if m else text).strip()

if "</html>" not in new or len(new) < len(code) * 0.6:
    print("Ответ ИИ похож на сломанный, оставляю старую версию")
    sys.exit(0)

open("index.html", "w", encoding="utf-8").write(new + "\n")
print("Обновлено")
