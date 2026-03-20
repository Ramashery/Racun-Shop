"""
RAKUN — Static Site Generator
==============================
Читает данные из Firestore и генерирует статические HTML-файлы в папку public/.

Структура URL:
  Главная:         /index.html              → mysite/
  Каталог:         /en/catalog/index.html   → mysite/en/catalog/
  Страница товара: /en/products/{cat}/{slug}/index.html
  Блог (листинг):  /en/blog/index.html      → mysite/en/blog/
  Пост блога:      /en/blog/{slug}/index.html

Структура документов в Firestore:
  products/{id}
    globalFields: { slug, categoryId, categorySlug, price, badge, features[] }
    en: { name, categoryLabel, shortDescription, fullDescription,
          ingredients, safetyInfo, imageUrls[], seoTitle, metaDescription }
    ru: { ... }
    ka: { ... }
    hy: { ... }

  posts/{id}
    globalFields: { slug, category, authorName, authorRole, authorBio,
                    authorAvatar, publishedAt, readTime, ogImageUrl, tagBadge }
    en: { h1, mainContent, cardTitle, cardDescription, mediaUrls[],
          seoTitle, metaDescription }
    ru: { ... }  ka: { ... }  hy: { ... }

  categories/{id}
    globalFields: { slug, color, status }
    en: { name, description, seoTitle, seoDescription }
    ru: { ... }  ka: { ... }  hy: { ... }

  settings/main
    globalFields: { logoUrl, phone, email, mapsEmbedUrl }
    en: { heroSlides[], reviewsTitle, reviewsLabel, contactLabel,
          contactTitle, logisticsTerms, ctaButtonText, ctaEmail,
          footerCopy }
    ru: { ... }  ka: { ... }  hy: { ... }

Запуск:
  export FIREBASE_SERVICE_ACCOUNT='{"type":"service_account",...}'
  export BASE_URL='https://rakun.shop'  # опционально
  python generate_site.py
"""

import os
import json
import re
import shutil
import sys
from datetime import date, datetime
import firebase_admin
from firebase_admin import credentials, firestore
from jinja2 import Environment, FileSystemLoader

# ──────────────────────────────────────────────────────────────────────────────
# КОНФИГУРАЦИЯ
# ──────────────────────────────────────────────────────────────────────────────

BASE_URL        = os.environ.get("BASE_URL", "https://rakun.shop")
OUTPUT_DIR      = "public"
SUPPORTED_LANGS = ["en", "ru", "ka", "hy"]

LOGO_URL = "https://i.postimg.cc/6300cGYs/IMG-20260319-125902.png"

# Файлы/папки, которые НЕ копируются в public/
COPY_IGNORE = {
    OUTPUT_DIR, ".git", ".github", "__pycache__", "node_modules",
    "generate_site.py", "requirements.txt", "firebase.json", ".firebaserc",
    "README.md",
    # Jinja2 шаблоны — не нужны в public/
    "tpl_index.html", "tpl_catalog.html", "tpl_product.html",
    "tpl_blog.html", "tpl_post.html", "tpl_admin.html", "tpl_404.html",
}

# ──────────────────────────────────────────────────────────────────────────────
# ИНИЦИАЛИЗАЦИЯ FIREBASE
# ──────────────────────────────────────────────────────────────────────────────

print("=" * 55)
print("  RAKUN Static Site Generator")
print("=" * 55)

try:
    if not firebase_admin._apps:
        sa_env = os.environ.get("FIREBASE_SERVICE_ACCOUNT")
        if not sa_env:
            print("✗ ОШИБКА: Переменная FIREBASE_SERVICE_ACCOUNT не найдена.")
            sys.exit(1)
        cred = credentials.Certificate(json.loads(sa_env))
        firebase_admin.initialize_app(cred)
    db = firestore.client()
    print("✓ Firebase подключён.")
except Exception as e:
    print(f"✗ Ошибка подключения к Firebase: {e}")
    sys.exit(1)

# ──────────────────────────────────────────────────────────────────────────────
# JINJA2 — загрузка шаблонов
# ──────────────────────────────────────────────────────────────────────────────

try:
    jinja = Environment(
        loader=FileSystemLoader("."),
        autoescape=True,
        trim_blocks=True,
        lstrip_blocks=True,
    )
    # Доступные глобальные переменные в шаблонах
    jinja.globals.update(
        BASE_URL=BASE_URL,
        LOGO_URL=LOGO_URL,
        SUPPORTED_LANGS=SUPPORTED_LANGS,
    )

    T = {
        "index":   jinja.get_template("tpl_index.html"),
        "catalog": jinja.get_template("tpl_catalog.html"),
        "product": jinja.get_template("tpl_product.html"),
        "blog":    jinja.get_template("tpl_blog.html"),
        "post":    jinja.get_template("tpl_post.html"),
        "admin":   jinja.get_template("tpl_admin.html"),
        "404":     jinja.get_template("tpl_404.html"),
    }
    print("✓ Шаблоны Jinja2 загружены.")
except Exception as e:
    print(f"✗ Ошибка загрузки шаблонов: {e}")
    sys.exit(1)

# ──────────────────────────────────────────────────────────────────────────────
# УТИЛИТЫ
# ──────────────────────────────────────────────────────────────────────────────

def slugify(text: str) -> str:
    """Конвертирует строку в URL-friendly slug."""
    text = str(text).lower()
    # Простая транслитерация кириллицы
    cyr = {
        'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'yo','ж':'zh',
        'з':'z','и':'i','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o',
        'п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'kh','ц':'ts',
        'ч':'ch','ш':'sh','щ':'shch','ъ':'','ы':'y','ь':'','э':'e',
        'ю':'yu','я':'ya',
    }
    text = ''.join(cyr.get(c, c) for c in text)
    text = re.sub(r'[^a-z0-9\s-]', '', text)
    text = re.sub(r'[\s_-]+', '-', text).strip('-')
    return text or 'item'


def extract(doc: dict, lang: str) -> dict:
    """
    Возвращает объединённый словарь: globalFields + поля для конкретного lang.
    Если нет данных для lang — fallback на 'en'.
    """
    g  = doc.get("globalFields", {})
    lo = doc.get(lang) or doc.get("en") or {}
    return {**g, **lo, "_id": doc.get("_id", ""), "_status": doc.get("status", "")}


def get_slug(doc: dict, lang: str = "en") -> str:
    """Возвращает slug документа, или генерирует из названия."""
    g = doc.get("globalFields", {})
    if g.get("slug"):
        return g["slug"]
    # fallback: генерируем из имени/заголовка на EN
    en = doc.get("en") or {}
    name = en.get("name") or en.get("h1") or en.get("cardTitle") or doc.get("_id", "item")
    return slugify(name)


def get_cat_slug(doc: dict) -> str:
    """Возвращает categorySlug из globalFields."""
    g = doc.get("globalFields", {})
    return g.get("categorySlug") or slugify(g.get("categoryId", "products"))


def write(path: str, content: str):
    """Создаёт папку и записывает файл."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"  ✓ {path.replace(OUTPUT_DIR + '/', '')}")


# ──────────────────────────────────────────────────────────────────────────────
# ЗАГРУЗКА ДАННЫХ ИЗ FIRESTORE
# ──────────────────────────────────────────────────────────────────────────────

def load_firestore() -> dict:
    print("\n--- Загрузка данных из Firestore ---")
    data = {}

    collections = {
        "products":   "products",
        "posts":      "posts",
        "categories": "categories",
    }

    for key, col in collections.items():
        print(f"  > {col}...")
        docs = []
        for doc in db.collection(col).stream():
            d = doc.to_dict() or {}
            d["_id"] = doc.id
            if d.get("status") != "archived":
                docs.append(d)
        data[key] = docs
        print(f"    ✓ {len(docs)} документов")

    # settings — один документ
    print("  > settings/main...")
    s = db.collection("settings").document("main").get()
    data["settings"] = s.to_dict() if s.exists else {}
    data["settings"]["_id"] = "main"

    print("✓ Данные загружены.\n")
    return data


# ──────────────────────────────────────────────────────────────────────────────
# ГЕНЕРАЦИЯ: ГЛАВНАЯ СТРАНИЦА
# ──────────────────────────────────────────────────────────────────────────────

def gen_index(data: dict):
    print("--- Главная страница ---")
    for lang in SUPPORTED_LANGS:
        settings = extract(data["settings"], lang)

        # Первые 5 товаров для превью
        featured_products = []
        for p in data["products"][:5]:
            ex = extract(p, lang)
            ex["_slug"]     = get_slug(p, lang)
            ex["_cat_slug"] = get_cat_slug(p)
            featured_products.append(ex)

        # Первые 3 поста для превью
        featured_posts = []
        for p in data["posts"][:3]:
            ex = extract(p, lang)
            ex["_slug"] = get_slug(p, lang)
            featured_posts.append(ex)

        html = T["index"].render(
            lang=lang,
            settings=settings,
            featured_products=featured_products,
            featured_posts=featured_posts,
        )
        # /index.html (корень) — только EN
        if lang == "en":
            write(f"{OUTPUT_DIR}/index.html", html)
        write(f"{OUTPUT_DIR}/{lang}/index.html", html)


# ──────────────────────────────────────────────────────────────────────────────
# ГЕНЕРАЦИЯ: КАТАЛОГ
# ──────────────────────────────────────────────────────────────────────────────

def gen_catalog(data: dict):
    print("--- Каталог ---")

    # Строим маппинг id категории → документ категории
    cat_docs = {c["_id"]: c for c in data["categories"]}

    for lang in SUPPORTED_LANGS:
        # Группируем товары по категориям
        cats_ordered: dict[str, dict] = {}
        all_products_for_lang = []

        for p in data["products"]:
            gf       = p.get("globalFields", {})
            cat_id   = gf.get("categoryId", "")
            cat_slug = get_cat_slug(p)

            # Название категории
            cat_doc   = cat_docs.get(cat_id, {})
            cat_label = (cat_doc.get(lang) or cat_doc.get("en") or {}).get("name", cat_id)

            if cat_slug not in cats_ordered:
                cats_ordered[cat_slug] = {"slug": cat_slug, "label": cat_label, "products": []}

            ex = extract(p, lang)
            ex["_slug"]     = get_slug(p, lang)
            ex["_cat_slug"] = cat_slug
            cats_ordered[cat_slug]["products"].append(ex)
            all_products_for_lang.append(ex)

        html = T["catalog"].render(
            lang=lang,
            categories=list(cats_ordered.values()),
            products=all_products_for_lang,
        )
        write(f"{OUTPUT_DIR}/{lang}/catalog/index.html", html)


# ──────────────────────────────────────────────────────────────────────────────
# ГЕНЕРАЦИЯ: СТРАНИЦЫ ТОВАРОВ
# ──────────────────────────────────────────────────────────────────────────────

def gen_products(data: dict) -> list:
    print("--- Страницы товаров ---")
    sitemap = []

    for p in data["products"]:
        p_slug   = get_slug(p)
        cat_slug = get_cat_slug(p)

        for lang in SUPPORTED_LANGS:
            product = extract(p, lang)
            product["_slug"]     = p_slug
            product["_cat_slug"] = cat_slug

            # Похожие товары (той же категории, не текущий)
            related = []
            for r in data["products"]:
                if r["_id"] != p["_id"] and get_cat_slug(r) == cat_slug:
                    ex = extract(r, lang)
                    ex["_slug"]     = get_slug(r, lang)
                    ex["_cat_slug"] = cat_slug
                    related.append(ex)
                    if len(related) >= 3:
                        break

            html = T["product"].render(
                lang=lang,
                product=product,
                cat_slug=cat_slug,
                product_slug=p_slug,
                related=related,
            )
            path = f"{OUTPUT_DIR}/{lang}/products/{cat_slug}/{p_slug}/index.html"
            write(path, html)

        sitemap.append({
            "loc":        f"{BASE_URL}/en/products/{cat_slug}/{p_slug}/",
            "lastmod":    date.today().isoformat(),
            "changefreq": "monthly",
            "priority":   "0.8",
        })

    return sitemap


# ──────────────────────────────────────────────────────────────────────────────
# ГЕНЕРАЦИЯ: БЛОГ
# ──────────────────────────────────────────────────────────────────────────────

def gen_blog(data: dict) -> list:
    print("--- Блог ---")
    sitemap = []

    # Листинги (по одному на язык)
    for lang in SUPPORTED_LANGS:
        posts_for_lang = []
        for p in data["posts"]:
            ex = extract(p, lang)
            ex["_slug"] = get_slug(p, lang)
            posts_for_lang.append(ex)

        html = T["blog"].render(lang=lang, posts=posts_for_lang)
        write(f"{OUTPUT_DIR}/{lang}/blog/index.html", html)

        sitemap.append({
            "loc":        f"{BASE_URL}/{lang}/blog/",
            "lastmod":    date.today().isoformat(),
            "changefreq": "weekly",
            "priority":   "0.8",
        })

    # Отдельные посты
    for p in data["posts"]:
        p_slug = get_slug(p)

        # Топ-3 похожих поста
        related_raw = [r for r in data["posts"] if r["_id"] != p["_id"]][:3]

        for lang in SUPPORTED_LANGS:
            post = extract(p, lang)
            post["_slug"] = p_slug

            related = []
            for r in related_raw:
                ex = extract(r, lang)
                ex["_slug"] = get_slug(r, lang)
                related.append(ex)

            html = T["post"].render(
                lang=lang,
                post=post,
                post_slug=p_slug,
                related=related,
            )
            path = f"{OUTPUT_DIR}/{lang}/blog/{p_slug}/index.html"
            write(path, html)

        sitemap.append({
            "loc":        f"{BASE_URL}/en/blog/{p_slug}/",
            "lastmod":    date.today().isoformat(),
            "changefreq": "monthly",
            "priority":   "0.7",
        })

    return sitemap


# ──────────────────────────────────────────────────────────────────────────────
# ГЕНЕРАЦИЯ: АДМИН-ПАНЕЛЬ
# ──────────────────────────────────────────────────────────────────────────────

def gen_admin(data: dict):
    print("--- Админ-панель ---")

    # Встраиваем все данные из Firestore в HTML как JSON
    # Это позволяет таблицам и спискам работать без лишних запросов к БД
    admin_payload = {
        "products":   data["products"],
        "posts":      data["posts"],
        "categories": data["categories"],
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "base_url":   BASE_URL,
    }

    html = T["admin"].render(
        site_data_json=json.dumps(admin_payload, ensure_ascii=False, default=str),
        generated_at=admin_payload["generated_at"],
    )
    write(f"{OUTPUT_DIR}/admin/index.html", html)


# ──────────────────────────────────────────────────────────────────────────────
# ГЕНЕРАЦИЯ: 404
# ──────────────────────────────────────────────────────────────────────────────

def gen_404():
    print("--- 404.html ---")
    write(f"{OUTPUT_DIR}/404.html", T["404"].render())


# ──────────────────────────────────────────────────────────────────────────────
# ГЕНЕРАЦИЯ: SITEMAP
# ──────────────────────────────────────────────────────────────────────────────

def gen_sitemap(extra: list):
    print("--- sitemap.xml ---")
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        # Главная
        "<url>",
        f"  <loc>{BASE_URL}/</loc>",
        f"  <changefreq>weekly</changefreq>",
        f"  <priority>1.0</priority>",
        "</url>",
    ]
    for e in extra:
        lines += [
            "<url>",
            f"  <loc>{e['loc']}</loc>",
            f"  <lastmod>{e['lastmod']}</lastmod>",
            f"  <changefreq>{e['changefreq']}</changefreq>",
            f"  <priority>{e['priority']}</priority>",
            "</url>",
        ]
    lines.append("</urlset>")
    path = f"{OUTPUT_DIR}/sitemap.xml"
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"  ✓ sitemap.xml ({len(extra) + 1} URLs)")


# ──────────────────────────────────────────────────────────────────────────────
# КОПИРОВАНИЕ СТАТИЧЕСКИХ ФАЙЛОВ
# ──────────────────────────────────────────────────────────────────────────────

def copy_static():
    print("--- Статические файлы ---")
    for name in os.listdir("."):
        if name in COPY_IGNORE or name.startswith("."):
            continue
        src = os.path.join(".", name)
        dst = os.path.join(OUTPUT_DIR, name)
        try:
            if os.path.isfile(src):
                shutil.copy2(src, dst)
            elif os.path.isdir(src):
                shutil.copytree(src, dst, dirs_exist_ok=True)
        except Exception as e:
            print(f"  ! Не удалось скопировать {name}: {e}")
    print("  ✓ Готово")


# ──────────────────────────────────────────────────────────────────────────────
# MAIN
# ──────────────────────────────────────────────────────────────────────────────

def main():
    # Пересоздаём output-папку
    if os.path.exists(OUTPUT_DIR):
        shutil.rmtree(OUTPUT_DIR)
    os.makedirs(OUTPUT_DIR)
    print(f"✓ Папка '{OUTPUT_DIR}/' очищена.\n")

    # Загружаем все данные из Firestore один раз
    data = load_firestore()

    # Генерируем страницы
    gen_index(data)
    gen_catalog(data)

    sitemap_entries = []
    sitemap_entries += gen_products(data)
    sitemap_entries += gen_blog(data)

    gen_admin(data)
    gen_404()
    gen_sitemap(sitemap_entries)
    copy_static()

    # Финальная проверка
    index_path = f"{OUTPUT_DIR}/index.html"
    if not os.path.exists(index_path):
        print("\n❌ КРИТИЧНО: index.html не создан!")
        sys.exit(1)

    print("\n" + "=" * 55)
    print(f"  ✅  Генерация успешно завершена!")
    print(f"  📁  Папка:  {OUTPUT_DIR}/")
    print(f"  🌐  Сайт:   {BASE_URL}")
    print("=" * 55 + "\n")


if __name__ == "__main__":
    main()
