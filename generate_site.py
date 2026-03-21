"""
RAKUN — Static Site Generator
Генерирует публичную часть сайта. Админка копируется как статичное SPA-приложение.
"""
import os, json, re, shutil, sys
from datetime import date, datetime
import firebase_admin
from firebase_admin import credentials, firestore
from jinja2 import Environment, FileSystemLoader

BASE_URL        = os.environ.get("BASE_URL", "https://rakun.shop")
OUTPUT_DIR      = "public"
SUPPORTED_LANGS = ["en", "ru", "ka", "hy"]
LOGO_URL        = "https://i.postimg.cc/6300cGYs/IMG-20260319-125902.png"

COPY_IGNORE = {
    OUTPUT_DIR, ".git", ".github", "__pycache__", "node_modules",
    "generate_site.py", "requirements.txt", "firebase.json", ".firebaserc",
    "README.md", "check_structure.py", "debug_firestore.py", "firebase-check.html",
    # Шаблоны не копируем напрямую
    "tpl_index.html", "tpl_catalog.html", "tpl_product.html",
    "tpl_blog.html", "tpl_post.html", "tpl_404.html",
    # Старые HTML, которые заменяются шаблонами
    "index.html", "catalog.html", "blog.html", "product.html", "post.html",
    # Старый JS
    "main.js",
}

print("=" * 55)
print("  RAKUN Static Site Generator")
print("=" * 55)

try:
    if not firebase_admin._apps:
        sa_env = os.environ.get("FIREBASE_SERVICE_ACCOUNT")
        if not sa_env:
            print("FIREBASE_SERVICE_ACCOUNT not set"); sys.exit(1)
        firebase_admin.initialize_app(credentials.Certificate(json.loads(sa_env)))
    db = firestore.client()
    print("Firebase OK")
except Exception as e:
    print(f"Firebase error: {e}"); sys.exit(1)

try:
    jinja = Environment(
        loader=FileSystemLoader("."),
        autoescape=True,
        trim_blocks=True,
        lstrip_blocks=True,
    )
    jinja.globals.update(BASE_URL=BASE_URL, LOGO_URL=LOGO_URL, SUPPORTED_LANGS=SUPPORTED_LANGS)
    T = {k: jinja.get_template(f"tpl_{k}.html")
         for k in ["index", "catalog", "product", "blog", "post", "404"]}
    print("Templates OK")
except Exception as e:
    print(f"Template error: {e}"); sys.exit(1)


# ── Helpers ────────────────────────────────────────────────────

def slugify(text):
    text = str(text).lower()
    cyr = {
        'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'yo','ж':'zh',
        'з':'z','и':'i','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o',
        'п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'kh','ц':'ts',
        'ч':'ch','ш':'sh','щ':'shch','ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya',
    }
    text = ''.join(cyr.get(c, c) for c in text)
    text = re.sub(r'[^a-z0-9\s-]', '', text)
    return re.sub(r'[\s_-]+', '-', text).strip('-') or 'item'


def gf(doc):
    return doc.get("globalFields") or {}


def loc(doc, lang):
    translations = doc.get("translations") or {}
    return (
        translations.get(lang)
        or translations.get("en")
        or doc.get(lang)
        or doc.get("en")
        or {}
    )


def extract(doc, lang):
    g  = gf(doc)
    lo = loc(doc, lang)
    m  = {**g, **lo, "_id": doc.get("_id", ""), "_status": (g.get("status") or "").lower()}

    m["name"] = (
        lo.get("productName") or lo.get("h1") or lo.get("cardTitle")
        or g.get("productName") or ""
    )
    imgs = g.get("images") or g.get("imageUrls") or lo.get("imageUrls") or []
    m["imageUrls"]  = imgs if isinstance(imgs, list) else ([imgs] if imgs else [])
    m["firstImage"] = m["imageUrls"][0] if m["imageUrls"] else (g.get("ogImageUrl") or "")

    m["shortDescription"] = lo.get("shortDescription") or lo.get("cardDescription") or ""
    m["fullDescription"]  = lo.get("fullDescriptionHtml") or lo.get("fullDescription") or ""
    m["features"]         = g.get("featurePills") or []

    price_raw      = str(g.get("price") or "")
    m["priceRaw"]  = price_raw
    m["price"]     = price_raw.replace(" GEL", "").strip()

    # Для категорий slug лежит в корне документа (не в globalFields)
    cat_slug_raw   = g.get("categoryId") or doc.get("categoryId") or "products"
    m["_cat_slug"] = slugify(cat_slug_raw)
    m["_slug"]     = g.get("slug") or doc.get("slug") or doc.get("_id") or ""

    m["ingredients"]      = g.get("ingredients") or []
    m["descriptionPoints"] = lo.get("descriptionPoints") or []

    # Дополнительные поля для блога
    m["cardTitle"]       = lo.get("cardTitle") or m["name"]
    m["cardDescription"] = lo.get("cardDescription") or m["shortDescription"]
    m["tagBadge"]        = g.get("tagBadge") or ""
    m["readTime"]        = g.get("readTime") or ""
    m["categoryLabel"]   = lo.get("categoryLabel") or g.get("categoryId") or ""
    m["categoryId"]      = g.get("categoryId") or ""

    return m


def is_live(doc):
    return (gf(doc).get("status") or "").lower() != "archived"


def write(path, content):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"  + {path.replace(OUTPUT_DIR + '/', '')}")


# ── Firestore loader ───────────────────────────────────────────

def load_firestore():
    print("\n--- Firestore ---")
    data = {}

    # products и categories — обычные коллекции
    for key in ["products", "categories"]:
        docs = [
            d.to_dict() | {"_id": d.id}
            for d in db.collection(key).stream()
            if is_live(d.to_dict())
        ]
        data[key] = docs
        print(f"  {key}: {len(docs)} docs")

    # Посты — коллекция называется 'blog', не 'posts'
    blog_docs = [
        d.to_dict() | {"_id": d.id}
        for d in db.collection("blog").stream()
        if is_live(d.to_dict())
    ]
    data["posts"] = blog_docs
    print(f"  blog (posts): {len(blog_docs)} docs")

    # Settings
    s = db.collection("settings").document("main").get()
    data["settings"] = (s.to_dict() or {}) if s.exists else {}
    data["settings"]["_id"] = "main"

    # Pages (home, catalog, contacts, footer-nav)
    pages_data = {}
    for page_id in ["home", "catalog", "contacts", "footer-nav"]:
        p = db.collection("pages").document(page_id).get()
        pages_data[page_id] = (p.to_dict() or {}) if p.exists else {}
    data["pages"] = pages_data

    print(f"  pages: {len(pages_data)} docs")
    print("  settings: OK\n")
    return data


# ── Index page generator ───────────────────────────────────────

def gen_index(data):
    print("--- Index ---")

    for lang in SUPPORTED_LANGS:
        # ── Продукты: все опубликованные, сортировка по имени ──
        products = [
            extract(p, lang)
            for p in data["products"]
            if (gf(p).get("status") or "").lower() == "published"
        ]
        products.sort(key=lambda x: x["name"].lower())

        # ── Посты: все опубликованные, макс 8 для главной ──────
        posts = [
            extract(p, lang)
            for p in data["posts"]
            if (gf(p).get("status") or "").lower() == "published"
        ]
        posts = posts[:8]

        # ── Pages/home — локализованные данные страницы ────────
        home_doc  = data["pages"].get("home", {})
        home_lo   = loc(home_doc, lang)
        home_gf   = gf(home_doc)

        # SEO мета для главной
        page = {
            "seoTitle":       home_lo.get("seoTitle") or home_gf.get("seoTitle") or "",
            "metaDescription":home_lo.get("metaDescription") or home_gf.get("metaDescription") or "",
            "ogTitle":        home_lo.get("ogTitle") or home_gf.get("ogTitle") or "",
            "ogDescription":  home_lo.get("ogDescription") or home_gf.get("ogDescription") or "",
            "ogImageUrl":     home_gf.get("ogImageUrl") or "",
        }

        # ── Hero слайды ────────────────────────────────────────
        # Хранятся в pages/home → translations[lang].slides или globalFields.slides
        raw_slides = (
            home_lo.get("slides")
            or home_gf.get("slides")
            or []
        )
        slides = []
        for s in raw_slides:
            if s.get("bgImage") or s.get("headline"):
                slides.append({
                    "bgImage":  s.get("bgImage", ""),
                    "subtitle": s.get("subtitle", ""),
                    "headline": s.get("headline", ""),
                    "btnText":  s.get("btnText", ""),
                    "btnUrl":   s.get("btnUrl", ""),
                })

        # ── Навигация ──────────────────────────────────────────
        footer_doc = data["pages"].get("footer-nav", {})
        footer_lo  = loc(footer_doc, lang)
        footer_gf  = gf(footer_doc)

        nav = {
            "home":     footer_lo.get("home")     or footer_gf.get("home")     or "Home",
            "about":    footer_lo.get("about")    or footer_gf.get("about")    or "About us",
            "catalog":  footer_lo.get("catalog")  or footer_gf.get("catalog")  or "Catalog",
            "blog":     footer_lo.get("blog")     or footer_gf.get("blog")     or "Blog",
            "contacts": footer_lo.get("contacts") or footer_gf.get("contacts") or "Contacts",
        }
        footer = {
            "link1":     footer_lo.get("link1")     or footer_gf.get("link1")     or "",
            "link2":     footer_lo.get("link2")     or footer_gf.get("link2")     or "",
            "link3":     footer_lo.get("link3")     or footer_gf.get("link3")     or "",
            "copyright": footer_lo.get("copyright") or footer_gf.get("copyright") or "© 2025 RAKUN",
        }

        # ── Секции Products / Blog заголовки ───────────────────
        products_section = {
            "label": home_lo.get("productsLabel") or home_gf.get("productsLabel") or "",
            "title": home_lo.get("productsTitle") or home_gf.get("productsTitle") or "",
        }
        blog_section = {
            "label": home_lo.get("blogLabel") or home_gf.get("blogLabel") or "",
            "title": home_lo.get("blogTitle") or home_gf.get("blogTitle") or "",
        }

        # ── Отзывы ────────────────────────────────────────────
        raw_reviews = (
            home_lo.get("reviews")
            or home_gf.get("reviews")
            or []
        )
        reviews = [
            {
                "author": r.get("author", ""),
                "role":   r.get("role", ""),
                "text":   r.get("text", ""),
            }
            for r in raw_reviews
            if r.get("text")
        ]

        # ── Контакты ──────────────────────────────────────────
        contacts_doc = data["pages"].get("contacts", {})
        contacts_lo  = loc(contacts_doc, lang)
        contacts_gf  = gf(contacts_doc)
        contacts = {
            "label":          contacts_lo.get("label")          or contacts_gf.get("label")          or "",
            "title":          contacts_lo.get("title")          or contacts_gf.get("title")          or "",
            "phone":          contacts_gf.get("phone")          or "",
            "email":          contacts_gf.get("email")          or "",
            "ctaButton":      contacts_lo.get("ctaButton")      or contacts_gf.get("ctaButton")      or "",
            "ctaEmail":       contacts_gf.get("ctaEmail")       or contacts_gf.get("email")          or "",
            "logisticsTerms": contacts_lo.get("logisticsTerms") or contacts_gf.get("logisticsTerms") or "",
            "mapsEmbed":      contacts_gf.get("mapsEmbed")      or "",
        }
        reviews_section = {
            "label": home_lo.get("reviewsLabel") or home_gf.get("reviewsLabel") or "",
            "title": home_lo.get("reviewsTitle") or home_gf.get("reviewsTitle") or "",
        }

        # ── Рендер ────────────────────────────────────────────
        html = T["index"].render(
            lang=lang,
            page=page,
            slides=slides,
            products=products,
            posts=posts,
            nav=nav,
            footer=footer,
            contacts=contacts,
            products_section=products_section,
            blog_section=blog_section,
            reviews=reviews,
            reviews_section=reviews_section,
        )

        write(f"{OUTPUT_DIR}/{lang}/index.html", html)

    print()


# ── Остальные генераторы (заготовки) ──────────────────────────

def gen_catalog(data):
    print("--- Catalog (SKIPPED) ---")
    pass


def gen_products(data):
    print("--- Products (SKIPPED) ---")
    return []


def gen_blog(data):
    print("--- Blog (SKIPPED) ---")
    return []


def gen_sitemap(entries):
    print("--- Sitemap (SKIPPED) ---")
    pass


# ── Static files copy ─────────────────────────────────────────

def copy_static():
    print("--- Copying Static Files ---")
    for name in os.listdir("."):
        if name in COPY_IGNORE or name.startswith("."):
            continue
        src, dst = f"./{name}", f"{OUTPUT_DIR}/{name}"
        try:
            if os.path.isfile(src):
                shutil.copy2(src, dst)
            elif os.path.isdir(src):
                shutil.copytree(src, dst, dirs_exist_ok=True)
        except Exception as e:
            print(f"  ! {name}: {e}")
    print("  Static files copied.")


# ── Main ──────────────────────────────────────────────────────

def main():
    if os.path.exists(OUTPUT_DIR):
        shutil.rmtree(OUTPUT_DIR)
    os.makedirs(OUTPUT_DIR)

    data = load_firestore()

    gen_index(data)

    # Остальные страницы — раскомментируй когда будут готовы шаблоны:
    # gen_catalog(data)
    # sitemap = gen_products(data) + gen_blog(data)
    # gen_sitemap(sitemap)

    copy_static()

    print("\n" + "=" * 55)
    print("  DONE")
    print("=" * 55)


if __name__ == "__main__":
    main()
