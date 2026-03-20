"""
debug_firestore.py
Запустите один раз чтобы увидеть реальную структуру данных в вашем Firestore.

Использование:
  export FIREBASE_SERVICE_ACCOUNT='{ ... весь JSON сервисного аккаунта ... }'
  python debug_firestore.py
"""

import os, json, sys
import firebase_admin
from firebase_admin import credentials, firestore

# ── Подключение ──────────────────────────────────────────
sa_env = os.environ.get("FIREBASE_SERVICE_ACCOUNT")
if not sa_env:
    print("✗ Переменная FIREBASE_SERVICE_ACCOUNT не найдена.")
    sys.exit(1)

if not firebase_admin._apps:
    firebase_admin.initialize_app(credentials.Certificate(json.loads(sa_env)))
db = firestore.client()
print("✓ Firebase подключён\n")

# ── Список всех коллекций верхнего уровня ─────────────────
print("=" * 55)
print("  КОЛЛЕКЦИИ В FIRESTORE (верхний уровень)")
print("=" * 55)
collections = list(db.collections())
if not collections:
    print("  (пусто — нет ни одной коллекции)")
else:
    for col in collections:
        # Считаем документы
        docs = list(col.limit(200).stream())
        print(f"  📁  {col.id}  ({len(docs)} документов)")
print()

# ── Для каждой коллекции: первый документ полностью ───────
INTERESTING = {"products", "posts", "blog", "catalog",
               "items", "articles", "categories", "settings"}

for col in collections:
    first_docs = list(col.limit(1).stream())
    if not first_docs:
        continue

    doc = first_docs[0]
    data = doc.to_dict() or {}

    print("=" * 55)
    print(f"  КОЛЛЕКЦИЯ: {col.id}")
    print(f"  Document ID: {doc.id}")
    print("  Ключи верхнего уровня:")

    for key, val in data.items():
        val_type = type(val).__name__
        if isinstance(val, dict):
            subkeys = list(val.keys())[:8]
            print(f"    [{val_type}]  {key}  →  подключи: {subkeys}")
        elif isinstance(val, list):
            print(f"    [{val_type}]  {key}  →  {len(val)} элементов" +
                  (f", первый: {str(val[0])[:60]}" if val else ""))
        else:
            print(f"    [{val_type}]  {key}  =  {str(val)[:80]}")

    # Если есть globalFields — раскроем
    if "globalFields" in data:
        print("  globalFields подробно:")
        for k, v in data["globalFields"].items():
            print(f"    {k} = {str(v)[:80]}")

    # Если есть 'en' — раскроем
    if "en" in data:
        print("  en{} подробно:")
        for k, v in data["en"].items():
            val_preview = str(v)[:80] if not isinstance(v, list) else f"[{len(v)} items]"
            print(f"    {k} = {val_preview}")

    print()

print("=" * 55)
print("  ГОТОВО. Скопируйте вывод и покажите разработчику.")
print("=" * 55)
