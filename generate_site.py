"""
RAKUN — Static Site Generator
Реальная структура Firestore (products/{id}):
  globalFields: slug, categoryId, price ("8.90 GEL"), badge, status ("Published"),
                images[], featurePills[], ingredients[], ogImageUrl, changeFrequency, priority
  en/ru/ka/hy:  productName, shortDescription, fullDescriptionHtml,
                cardTitle, cardDescription, categoryLabel,
                seoTitle, metaDescription, ogTitle, ogDescription,
                imageAltText, ctaButtonText, descriptionPoints[]
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
    "README.md", "check_structure.py", "debug_firestore.py",
    # Jinja2 шаблоны — не копируем в public/
    "tpl_index.html","tpl_catalog.html","tpl_product.html",
    "tpl_blog.html","tpl_post.html","tpl_admin.html","tpl_404.html",
    # Оригинальные HTML-файлы — их заменяют сгенерированные страницы
    "index.html", "catalog.html", "blog.html", "product.html",
    "post.html", "admin.html",
    # Старые JS-файлы с Firebase-клиентом — не нужны в статике
    "main.js", "firebase-config.js",
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
    jinja = Environment(loader=FileSystemLoader("."), autoescape=True,
                        trim_blocks=True, lstrip_blocks=True)
    jinja.globals.update(BASE_URL=BASE_URL, LOGO_URL=LOGO_URL, SUPPORTED_LANGS=SUPPORTED_LANGS)
    T = {k: jinja.get_template(f"tpl_{k}.html")
         for k in ["index","catalog","product","blog","post","admin","404"]}
    print("Templates OK")
except Exception as e:
    print(f"Template error: {e}"); sys.exit(1)


def slugify(text):
    text = str(text).lower()
    cyr = {'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'yo','ж':'zh',
           'з':'z','и':'i','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o',
           'п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'kh','ц':'ts',
           'ч':'ch','ш':'sh','щ':'shch','ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya'}
    text = ''.join(cyr.get(c, c) for c in text)
    text = re.sub(r'[^a-z0-9\s-]', '', text)
    return re.sub(r'[\s_-]+', '-', text).strip('-') or 'item'


def gf(doc):
    return doc.get("globalFields") or {}


def loc(doc, lang):
    """
    Возвращает локализованный слой документа.
    Поддерживает ОБЕ структуры:
      1. doc['en']                         (прямой ключ)
      2. doc['translations']['en']         (вложенный через translations)
    """
    # Сначала пробуем через translations (ваша структура Firestore)
    translations = doc.get("translations") or {}
    if translations.get(lang):
        return translations[lang]
    if translations.get("en"):
        return translations["en"]
    # Fallback: прямой ключ на документе
    return doc.get(lang) or doc.get("en") or {}


def extract(doc, lang):
    """
    Возвращает плоский словарь для шаблона.
    globalFields + lang-слой + нормализованные поля.
    """
    g  = gf(doc)
    lo = loc(doc, lang)

    # Базовое слияние: globalFields перекрывается lang-слоем
    m = {**g, **lo,
         "_id":     doc.get("_id", ""),
         "_status": (g.get("status") or doc.get("status") or "").lower()}

    # name — productName в lang-слое
    m["name"] = lo.get("productName") or lo.get("h1") or lo.get("cardTitle") or g.get("productName") or ""

    # images — в globalFields как 'images'
    imgs = g.get("images") or g.get("imageUrls") or lo.get("imageUrls") or []
    m["imageUrls"]  = imgs if isinstance(imgs, list) else ([imgs] if imgs else [])
    m["firstImage"] = m["imageUrls"][0] if m["imageUrls"] else (g.get("ogImageUrl") or "")

    # shortDescription — в lang-слое
    m["shortDescription"] = lo.get("shortDescription") or lo.get("cardDescription") or ""

    # fullDescription — fullDescriptionHtml в lang-слое
    m["fullDescription"] = lo.get("fullDescriptionHtml") or lo.get("fullDescription") or ""

    # features — featurePills в globalFields
    m["features"] = g.get("featurePills") or []

    # price — "8.90 GEL" в globalFields.price
    price_raw = str(g.get("price") or "")
    m["priceRaw"] = price_raw          # "8.90 GEL"
    m["price"]    = price_raw.replace(" GEL", "").strip()  # "8.90"

    # slugs
    m["_cat_slug"] = slugify(g.get("categoryId") or "products")
    m["_slug"]     = g.get("slug") or doc.get("_id") or ""

    # ingredients — список {name, percentage} в globalFields
    m["ingredients"] = g.get("ingredients") or []

    # descriptionPoints — список {title, text} в lang-слое
    m["descriptionPoints"] = lo.get("descriptionPoints") or []

    return m


def is_live(doc):
    s = (gf(doc).get("status") or doc.get("status") or "").lower()
    # "Published" (capital P) = live, "Draft" = live (show in admin, hide if needed)
    # Only "archived" / "Archived" = skip
    return s not in ("archived",)


def write(path, content):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"  + {path.replace(OUTPUT_DIR+'/', '')}")


def load_firestore():
    print("\n--- Firestore ---")
    data = {}
    for key in ["products", "posts", "categories"]:
        docs = []
        for doc in db.collection(key).stream():
            d = doc.to_dict() or {}
            d["_id"] = doc.id
            if is_live(d):
                docs.append(d)
        data[key] = docs
        print(f"  {key}: {len(docs)} docs")
        if docs:
            g0  = gf(docs[0])
            lo0 = docs[0].get("en") or {}
            print(f"    globalFields: {list(g0.keys())[:8]}")
            if lo0:
                print(f"    en{{}}: {list(lo0.keys())[:8]}")

    s = db.collection("settings").document("main").get()
    data["settings"] = (s.to_dict() or {}) if s.exists else {}
    data["settings"]["_id"] = "main"
    print("  settings: OK\n")
    return data


def gen_index(data):
    print("--- Index ---")
    for lang in SUPPORTED_LANGS:
        settings = extract(data["settings"], lang)
        fp = [extract(p, lang) for p in data["products"][:5]]
        fb = [extract(p, lang) for p in data["posts"][:3]]
        html = T["index"].render(lang=lang, settings=settings,
                                  featured_products=fp, featured_posts=fb)
        if lang == "en":
            write(f"{OUTPUT_DIR}/index.html", html)
        write(f"{OUTPUT_DIR}/{lang}/index.html", html)


def gen_catalog(data):
    print("--- Catalog ---")
    cat_docs = {c["_id"]: c for c in data["categories"]}
    for lang in SUPPORTED_LANGS:
        cats: dict = {}
        all_prods  = []
        for p in data["products"]:
            g        = gf(p)
            cat_id   = g.get("categoryId", "")
            cat_slug = slugify(cat_id) if cat_id else "products"
            cat_lo   = loc(cat_docs.get(cat_id, {}), lang)
            cat_lbl  = cat_lo.get("name") or cat_id
            if cat_slug not in cats:
                cats[cat_slug] = {"slug": cat_slug, "label": cat_lbl, "products": []}
            ex = extract(p, lang)
            cats[cat_slug]["products"].append(ex)
            all_prods.append(ex)
        html = T["catalog"].render(lang=lang,
                                    categories=list(cats.values()),
                                    products=all_prods)
        write(f"{OUTPUT_DIR}/{lang}/catalog/index.html", html)


def gen_products(data):
    print("--- Products ---")
    sitemap = []
    for p in data["products"]:
        g        = gf(p)
        p_slug   = g.get("slug") or p["_id"]
        cat_slug = slugify(g.get("categoryId") or "products")
        for lang in SUPPORTED_LANGS:
            product = extract(p, lang)
            related = [extract(r, lang) for r in data["products"]
                       if r["_id"] != p["_id"]
                       and slugify(gf(r).get("categoryId","")) == cat_slug][:3]
            html = T["product"].render(lang=lang, product=product,
                                        cat_slug=cat_slug, product_slug=p_slug,
                                        related=related)
            write(f"{OUTPUT_DIR}/{lang}/products/{cat_slug}/{p_slug}/index.html", html)
        sitemap.append({
            "loc": f"{BASE_URL}/en/products/{cat_slug}/{p_slug}/",
            "lastmod": date.today().isoformat(),
            "changefreq": g.get("changeFrequency", "monthly"),
            "priority": str(g.get("priority", 0.8)),
        })
    return sitemap


def gen_blog(data):
    print("--- Blog ---")
    sitemap = []
    for lang in SUPPORTED_LANGS:
        posts = [extract(p, lang) for p in data["posts"]]
        write(f"{OUTPUT_DIR}/{lang}/blog/index.html",
              T["blog"].render(lang=lang, posts=posts))
        sitemap.append({"loc": f"{BASE_URL}/{lang}/blog/",
                        "lastmod": date.today().isoformat(),
                        "changefreq": "weekly", "priority": "0.8"})
    for p in data["posts"]:
        p_slug = gf(p).get("slug") or p["_id"]
        related_raw = [r for r in data["posts"] if r["_id"] != p["_id"]][:3]
        for lang in SUPPORTED_LANGS:
            post    = extract(p, lang)
            related = [extract(r, lang) for r in related_raw]
            write(f"{OUTPUT_DIR}/{lang}/blog/{p_slug}/index.html",
                  T["post"].render(lang=lang, post=post,
                                   post_slug=p_slug, related=related))
        sitemap.append({"loc": f"{BASE_URL}/en/blog/{p_slug}/",
                        "lastmod": date.today().isoformat(),
                        "changefreq": "monthly", "priority": "0.7"})
    return sitemap


def gen_admin(data):
    print("--- Admin ---")
    payload = {"products": data["products"], "posts": data["posts"],
               "categories": data["categories"],
               "generated_at": datetime.utcnow().isoformat() + "Z",
               "base_url": BASE_URL}
    write(f"{OUTPUT_DIR}/admin/index.html",
          T["admin"].render(site_data_json=json.dumps(payload, ensure_ascii=False, default=str),
                            generated_at=payload["generated_at"]))


def gen_sitemap(entries):
    lines = ['<?xml version="1.0" encoding="UTF-8"?>',
             '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
             "<url>", f"  <loc>{BASE_URL}/</loc>",
             "  <changefreq>weekly</changefreq>", "  <priority>1.0</priority>", "</url>"]
    for e in entries:
        lines += ["<url>", f"  <loc>{e['loc']}</loc>",
                  f"  <lastmod>{e['lastmod']}</lastmod>",
                  f"  <changefreq>{e['changefreq']}</changefreq>",
                  f"  <priority>{e['priority']}</priority>", "</url>"]
    lines.append("</urlset>")
    with open(f"{OUTPUT_DIR}/sitemap.xml", "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"  sitemap.xml ({len(entries)+1} URLs)")


def copy_static():
    print("--- Static ---")
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


def main():
    if os.path.exists(OUTPUT_DIR):
        shutil.rmtree(OUTPUT_DIR)
    os.makedirs(OUTPUT_DIR)

    data    = load_firestore()
    gen_index(data)
    gen_catalog(data)
    sitemap = gen_products(data) + gen_blog(data)
    gen_admin(data)
    write(f"{OUTPUT_DIR}/404.html", T["404"].render())
    gen_sitemap(sitemap)
    copy_static()

    print("\n" + "=" * 55)
    print("  DONE:", BASE_URL)
    print("=" * 55)


if __name__ == "__main__":
    main()
