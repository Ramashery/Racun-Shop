"""
RAKUN — Static Site Generator
Генерирует публичную часть сайта. Админка копируется как статичное SPA-приложение.
"""
import os, json, re, shutil, sys
from datetime import date, datetime
import firebase_admin
from firebase_admin import credentials, firestore
from jinja2 import Environment, FileSystemLoader

BASE_URL        = os.environ.get("BASE_URL", "https://racun-shop.web.app")
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

    m["ingredients"]       = g.get("ingredients") or []
    m["descriptionPoints"] = lo.get("descriptionPoints") or []

    # ── Product-specific fields ────────────────────────────
    m["sku"]            = g.get("sku") or ""
    m["weightVolume"]   = g.get("weightVolume") or ""
    m["stock"]          = g.get("stock")
    m["washes"]         = g.get("washes")           # None if null
    m["dosage"]         = g.get("dosage")            # None if null
    m["scentNotes"]     = g.get("scentNotes")        # None if null
    m["badge"]          = g.get("badge") or ""

    # Available volume variants: [{label, value, link, badge}, ...]
    m["availableVolumes"] = g.get("availableVolumes") or []

    # ── Volume tags for catalog filter ────────────────────
    # Collect slugified volume values from weightVolume + availableVolumes
    # e.g. "2 L" → "2l", "750 ml" → "750ml"
    import re as _re
    def _vol_slug(raw):
        """'750 ml' → '750ml', '2 L' → '2l', '5L' → '5l'"""
        s = _re.sub(r'\s+', '', str(raw)).lower()
        s = _re.sub(r'[^0-9a-z.]', '', s)
        return s

    vol_tags = set()
    if m["weightVolume"]:
        vs = _vol_slug(m["weightVolume"])
        if vs:
            vol_tags.add(vs)
    for av in m["availableVolumes"]:
        label = av.get("label") or av.get("value") or ""
        if label:
            vs = _vol_slug(label)
            if vs:
                vol_tags.add(vs)
    m["_volume_tags"] = sorted(vol_tags)

    # CTA links
    m["ctaLink"]              = g.get("ctaLink") or ""
    m["secondaryButtonLink"]  = g.get("secondaryButtonLink") or ""
    m["secondaryButtonText"]  = lo.get("secondaryButtonText") or g.get("secondaryButtonText") or ""
    m["ctaButtonText"]        = lo.get("ctaButtonText") or g.get("ctaButtonText") or ""

    # SEO / OG (локализованные)
    m["seoTitle"]        = lo.get("seoTitle") or g.get("seoTitle") or ""
    m["metaDescription"] = lo.get("metaDescription") or g.get("metaDescription") or ""
    m["ogTitle"]         = lo.get("ogTitle") or g.get("ogTitle") or ""
    m["ogDescription"]   = lo.get("ogDescription") or g.get("ogDescription") or ""
    m["imageAltText"]    = lo.get("imageAltText") or g.get("imageAltText") or m["name"]

    # Schema JSON-LD (raw string из БД)
    m["schemaJsonLd"]    = g.get("schemaJsonLd") or ""

    # Safety tab (пока нет в БД, зарезервировано)
    m["safetyHtml"]      = lo.get("safetyHtml") or g.get("safetyHtml") or ""

    # ── Blog / Post fields ─────────────────────────────────
    m["cardTitle"]          = lo.get("cardTitle") or m["name"]
    m["cardDescription"]    = lo.get("cardDescription") or m["shortDescription"]
    m["tagBadge"]           = g.get("tagBadge") or ""
    m["readTime"]           = g.get("readTime") or ""
    m["categoryLabel"]      = lo.get("categoryLabel") or g.get("categoryId") or ""
    m["categoryId"]         = g.get("categoryId") or ""

    # Post-specific: full article content (HTML string from DB)
    m["mainPageContentHtml"] = lo.get("mainPageContentHtml") or ""
    m["h1"]                  = lo.get("h1") or lo.get("cardTitle") or ""
    m["mainImageAltText"]    = lo.get("mainImageAltText") or g.get("mainImageAltText") or ""

    # Author (stored in globalFields)
    m["authorName"]         = g.get("authorName") or ""
    m["authorRole"]         = g.get("authorRole") or ""
    m["authorInitials"]     = g.get("authorInitials") or ""
    m["authorBio"]          = g.get("authorBio") or ""
    m["authorAvatarColor"]  = g.get("authorAvatarColor") or "blue"

    # Post meta
    m["publishDate"]        = g.get("publishDate") or ""
    m["emoji"]              = g.get("emoji") or ""
    m["tags"]               = g.get("tags") or []
    m["category"]           = g.get("category") or ""
    m["xDefaultHreflang"]   = g.get("xDefaultHreflang") or "en"
    m["regionHreflang"]     = g.get("regionHreflang") or ""

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

    # Pages (home, catalog, contacts, footer-nav, blog)
    pages_data = {}
    for page_id in ["home", "catalog", "contacts", "footer-nav", "blog"]:
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
        # БД хранит слайды в heroSlides (локализовано);
        # поддерживаем и старые имена slides/bgImage/btnText/btnUrl
        raw_slides = (
            home_lo.get("heroSlides")
            or home_lo.get("slides")
            or home_gf.get("heroSlides")
            or home_gf.get("slides")
            or []
        )
        slides = []
        for s in raw_slides:
            bg       = s.get("backgroundImageUrl") or s.get("bgImage") or ""
            btn_text = s.get("buttonText") or s.get("btnText") or ""
            btn_url  = s.get("buttonLink")  or s.get("btnUrl")  or ""
            if bg or s.get("headline"):
                slides.append({
                    "bgImage":  bg,
                    "subtitle": s.get("subtitle", ""),
                    "headline": s.get("headline", ""),
                    "btnText":  btn_text,
                    "btnUrl":   btn_url,
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

        products_section = {
            "label": home_lo.get("productsLabel") or home_gf.get("productsLabel") or "",
            "title": home_lo.get("productsTitle") or home_gf.get("productsTitle") or "",
        }
        blog_section = {
            "label": home_lo.get("blogLabel") or home_gf.get("blogLabel") or "",
            "title": home_lo.get("blogTitle") or home_gf.get("blogTitle") or "",
        }

        raw_reviews = (
            home_lo.get("reviews")
            or home_gf.get("reviews")
            or []
        )
        reviews = [
            {
                "author": r.get("author", ""),
                "role":   r.get("role", ""),
                # БД использует reviewText; поддерживаем и старый ключ text
                "text":   r.get("reviewText") or r.get("text") or "",
                "stars":  int(r.get("stars") or 5),
            }
            for r in raw_reviews
            if (r.get("reviewText") or r.get("text"))
        ]

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


# ── Остальные генераторы ──────────────────────────────────────

def gen_catalog(data):
    print("--- Catalog ---")

    UI_STRINGS = {
        "en": {
            "filters": "Filters", "category": "Category", "features": "Features",
            "allProducts": "All Products", "resetFilters": "Reset all filters",
            "sortDefault": "Default", "sortPriceAsc": "Price: Low to High",
            "sortPriceDesc": "Price: High to Low", "sortNameAsc": "Name: A–Z",
            "gridView": "Grid view", "listView": "List view",
            "productsFound": "products found", "products": "products",
            "noProducts": "No products found", "tryReset": "Try changing or resetting your filters.",
            "viewProduct": "View →", "volume": "Volume",
        },
        "ru": {
            "filters": "Фильтры", "category": "Категория", "features": "Характеристики",
            "allProducts": "Все товары", "resetFilters": "Сбросить фильтры",
            "sortDefault": "По умолчанию", "sortPriceAsc": "Цена: по возрастанию",
            "sortPriceDesc": "Цена: по убыванию", "sortNameAsc": "Название: А–Я",
            "gridView": "Сетка", "listView": "Список",
            "productsFound": "товаров найдено", "products": "товаров",
            "noProducts": "Товары не найдены", "tryReset": "Попробуйте изменить или сбросить фильтры.",
            "viewProduct": "Смотреть →", "volume": "Объём",
        },
        "ka": {
            "filters": "ფილტრები", "category": "კატეგორია", "features": "მახასიათებლები",
            "allProducts": "ყველა პროდუქტი", "resetFilters": "ფილტრების გასუფთავება",
            "sortDefault": "ნაგულისხმევი", "sortPriceAsc": "ფასი: ზრდადი",
            "sortPriceDesc": "ფასი: კლებადი", "sortNameAsc": "სახელი: ა–ჰ",
            "gridView": "ბადე", "listView": "სია",
            "productsFound": "პროდუქტი ნაპოვნია", "products": "პროდუქტი",
            "noProducts": "პროდუქტები ვერ მოიძებნა", "tryReset": "სცადეთ ფილტრების შეცვლა ან გასუფთავება.",
            "viewProduct": "ნახვა →", "volume": "მოცულობა",
        },
        "hy": {
            "filters": "Ֆիլտրեր", "category": "Կատեգորիա", "features": "Հատկանիշներ",
            "allProducts": "Բոլոր ապրանքները", "resetFilters": "Մաքրել ֆիլtրերը",
            "sortDefault": "Լռելյայն", "sortPriceAsc": "Գին: աճման կարգով",
            "sortPriceDesc": "Գին: նվազման կարգով", "sortNameAsc": "Անուն: Ա–Ֆ",
            "gridView": "Ցանց", "listView": "Ցուցակ",
            "productsFound": "ապրանք գտնվեց", "products": "ապրանք",
            "noProducts": "Ապրանքներ չեն գտնվել", "tryReset": "Փորձեք փոխել կամ մաքրել ֆիլտրերը:",
            "viewProduct": "Տեսնել →", "volume": "Ծավալ",
        },
    }

    catalog_doc  = data["pages"].get("catalog", {})
    footer_doc   = data["pages"].get("footer-nav", {})

    published = [p for p in data["products"]
                 if (gf(p).get("status") or "").lower() == "published"]

    for lang in SUPPORTED_LANGS:
        cat_lo = loc(catalog_doc, lang)
        cat_gf = gf(catalog_doc)

        page = {
            "seoTitle":       cat_lo.get("seoTitle")       or cat_gf.get("seoTitle")       or "",
            "metaDescription":cat_lo.get("metaDescription") or cat_gf.get("metaDescription") or "",
            "ogTitle":        cat_lo.get("ogTitle")         or cat_gf.get("ogTitle")         or "",
            "ogDescription":  cat_lo.get("ogDescription")  or cat_gf.get("ogDescription")  or "",
            "ogImageUrl":     cat_gf.get("ogImageUrl")      or "",
            "heroLabel":      cat_lo.get("heroLabel")       or cat_gf.get("heroLabel")       or "",
            "heroTitle":      cat_lo.get("heroTitle")       or cat_gf.get("heroTitle")       or "",
            "heroSubtitle":   (cat_lo.get("heroSubtitle") or cat_lo.get("heroDescription")
                               or cat_gf.get("heroSubtitle") or cat_gf.get("heroDescription") or ""),
        }

        categories = []
        for cat_raw in data["categories"]:
            cat_g   = gf(cat_raw)
            cat_lo2 = loc(cat_raw, lang)
            cat_slug = slugify(cat_raw.get("_id") or cat_g.get("slug") or "")
            cat_name = cat_lo2.get("name") or cat_g.get("name") or cat_slug
            if cat_slug:
                categories.append({
                    "slug":        cat_slug,
                    "name":        cat_name,
                    "accentColor": cat_g.get("accentColor") or "",
                })

        products = [extract(p, lang) for p in published]
        products.sort(key=lambda x: x["name"].lower())

        seen_features = {}
        for p in products:
            for pill in (p.get("features") or []):
                slug_feat = re.sub(r"[^a-z0-9]+", "-", pill.lower()).strip("-")
                if slug_feat and slug_feat not in seen_features:
                    seen_features[slug_feat] = pill
        all_features = [{"slug": s, "label": l} for s, l in seen_features.items()]

        # ── Volume filter: collect all unique slugified volumes ──
        # Sorts volumes numerically (750ml < 1l < 2l < 5l)
        def _vol_sort_key(slug):
            """'750ml' → 750, '1l' → 1000, '2l' → 2000, '5l' → 5000"""
            import re as _re
            nums = _re.findall(r'[\d.]+', slug)
            val = float(nums[0]) if nums else 0
            if 'l' in slug and 'ml' not in slug:
                val *= 1000
            return val

        seen_volumes = {}   # slug → display label
        for p in products:
            for vol_slug in (p.get("_volume_tags") or []):
                if vol_slug not in seen_volumes:
                    # Restore a readable label: "750ml"→"750 ml", "2l"→"2 L", "1.5l"→"1.5 L"
                    import re as _re
                    m2 = _re.match(r'^([\d.]+)(ml|l)$', vol_slug)
                    if m2:
                        num, unit = m2.group(1), m2.group(2)
                        label = f"{num} {'ml' if unit == 'ml' else 'L'}"
                    else:
                        label = vol_slug
                    seen_volumes[vol_slug] = label
        all_volumes = sorted(
            [{"slug": s, "label": l} for s, l in seen_volumes.items()],
            key=lambda x: _vol_sort_key(x["slug"]),
        )

        footer_lo = loc(footer_doc, lang)
        footer_gf = gf(footer_doc)
        nav = {
            "home":     footer_lo.get("home")     or footer_gf.get("home")     or "Home",
            "about":    footer_lo.get("about")    or footer_gf.get("about")    or "About",
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
        ui = UI_STRINGS.get(lang, UI_STRINGS["en"])

        html = T["catalog"].render(
            lang=lang,
            page=page,
            categories=categories,
            products=products,
            all_features=all_features,
            all_volumes=all_volumes,
            nav=nav,
            footer=footer,
            ui=ui,
        )

        write(f"{OUTPUT_DIR}/{lang}/catalog/index.html", html)

    print()


def gen_products(data):
    print("--- Products ---")
    sitemap_entries = []

    UI_STRINGS = {
        "en": {
            "tabDescription":    "Description",
            "tabIngredients":    "Ingredients",
            "tabSafety":         "Safety & Storage",
            "ingredientName":    "Ingredient",
            "ingredientPercent": "Amount",
            "relatedLabel":      "Complete your order",
            "relatedTitle":      "Other products",
            "ctaDefault":        "Request Wholesale Price",
            "secondary":         "Contact Us",
            "wholesaleNote":     "wholesale",
            "scentProfile":      "Scent Profile",
            "top":               "Top",
            "middle":            "Middle",
            "base":              "Base",
            "dosage":            "Dosage",
            "volume":            "Volume",
            "price":             "Wholesale Price",
            "washes":            "washes",
            "viewProduct":       "View →",
        },
        "ru": {
            "tabDescription":    "Описание",
            "tabIngredients":    "Состав",
            "tabSafety":         "Безопасность и хранение",
            "ingredientName":    "Компонент",
            "ingredientPercent": "Содержание",
            "relatedLabel":      "Дополните заказ",
            "relatedTitle":      "Другие товары",
            "ctaDefault":        "Запросить оптовую цену",
            "secondary":         "Связаться с нами",
            "wholesaleNote":     "оптовая цена",
            "scentProfile":      "Ароматический профиль",
            "top":               "Верхние",
            "middle":            "Средние",
            "base":              "Базовые",
            "dosage":            "Дозировка",
            "volume":            "Объём",
            "price":             "Оптовая цена",
            "washes":            "стирок",
            "viewProduct":       "Смотреть →",
        },
        "ka": {
            "tabDescription":    "აღწერა",
            "tabIngredients":    "შემადგენლობა",
            "tabSafety":         "უსაფრთხოება და შენახვა",
            "ingredientName":    "კომპონენტი",
            "ingredientPercent": "რაოდენობა",
            "relatedLabel":      "შეავსეთ შეკვეთა",
            "relatedTitle":      "სხვა პროდუქტები",
            "ctaDefault":        "მოითხოვეთ საბითუმო ფასი",
            "secondary":         "დაგვიკავშირდით",
            "wholesaleNote":     "საბითუმო",
            "scentProfile":      "სურნელოვანი პროფილი",
            "top":               "ზედა",
            "middle":            "შუა",
            "base":              "ბაზა",
            "dosage":            "დოზირება",
            "volume":            "მოცულობა",
            "price":             "საბითუმო ფასი",
            "washes":            "რეცხვა",
            "viewProduct":       "ნახვა →",
        },
        "hy": {
            "tabDescription":    "Նկարագրություն",
            "tabIngredients":    "Բաղադրություն",
            "tabSafety":         "Անվտանգություն և պահպանում",
            "ingredientName":    "Բաղադրիչ",
            "ingredientPercent": "Քանակ",
            "relatedLabel":      "Լրացրեք պատվերը",
            "relatedTitle":      "Այլ ապրանքներ",
            "ctaDefault":        "Հարցնել մեծածախ գինը",
            "secondary":         "Կապվել մեզ հետ",
            "wholesaleNote":     "մեծածախ",
            "scentProfile":      "Բույրի պրոֆիլ",
            "top":               "Վերին",
            "middle":            "Միջին",
            "base":              "Բազային",
            "dosage":            "Դոզավորում",
            "volume":            "Ծավալ",
            "price":             "Մեծածախ գին",
            "washes":            "լվացում",
            "viewProduct":       "Տեսնել →",
        },
    }

    footer_doc = data["pages"].get("footer-nav", {})
    published  = [p for p in data["products"]
                  if (gf(p).get("status") or "").lower() == "published"]

    for lang in SUPPORTED_LANGS:
        footer_lo = loc(footer_doc, lang)
        footer_gf = gf(footer_doc)
        nav = {
            "home":     footer_lo.get("home")     or footer_gf.get("home")     or "Home",
            "catalog":  footer_lo.get("catalog")  or footer_gf.get("catalog")  or "Catalog",
            "blog":     footer_lo.get("blog")      or footer_gf.get("blog")     or "Blog",
            "contacts": footer_lo.get("contacts") or footer_gf.get("contacts") or "Contacts",
        }
        footer = {
            "link1":     footer_lo.get("link1")     or footer_gf.get("link1")     or "",
            "link2":     footer_lo.get("link2")     or footer_gf.get("link2")     or "",
            "link3":     footer_lo.get("link3")     or footer_gf.get("link3")     or "",
            "copyright": footer_lo.get("copyright") or footer_gf.get("copyright") or "© 2025 RAKUN",
        }
        ui = UI_STRINGS.get(lang, UI_STRINGS["en"])

        for raw in published:
            product = extract(raw, lang)
            slug    = product["_slug"]
            if not slug:
                continue

            related = [
                extract(p, lang)
                for p in published
                if p.get("_id") != raw.get("_id")
                and (gf(p).get("categoryId") or "") == (gf(raw).get("categoryId") or "")
            ][:4]
            if not related:
                related = [extract(p, lang) for p in published if p.get("_id") != raw.get("_id")][:4]

            html = T["product"].render(
                lang=lang,
                product=product,
                related=related,
                nav=nav,
                footer=footer,
                ui=ui,
            )

            cat  = product["_cat_slug"]
            path = f"{OUTPUT_DIR}/{lang}/products/{cat}/{slug}/index.html"
            write(path, html)

            sitemap_entries.append({
                "loc":        f"{BASE_URL}/{lang}/products/{cat}/{slug}/",
                "lastmod":    str(date.today()),
                "changefreq": gf(raw).get("changeFrequency") or "monthly",
                "priority":   str(gf(raw).get("priority") or "0.8"),
            })

    print()
    return sitemap_entries


def gen_blog(data):
    print("--- Blog ---")
    sitemap_entries = []

    UI_STRINGS = {
        "en": {
            "knowledgeHub":      "Knowledge Hub",
            "allArticles":       "All Articles",
            "searchPlaceholder": "Search articles…",
            "featuredArticle":   "Featured",
            "latestArticles":    "Latest Articles",
            "articlesFound":     "articles found",
            "readMore":          "Read More",
        },
        "ru": {
            "knowledgeHub":      "База знаний",
            "allArticles":       "Все статьи",
            "searchPlaceholder": "Поиск статей…",
            "featuredArticle":   "Рекомендуем",
            "latestArticles":    "Последние статьи",
            "articlesFound":     "статей найдено",
            "readMore":          "Читать",
        },
        "ka": {
            "knowledgeHub":      "ცოდნის ბაზა",
            "allArticles":       "ყველა სტატია",
            "searchPlaceholder": "სტატიების ძიება…",
            "featuredArticle":   "რეკომენდებული",
            "latestArticles":    "ბოლო სტატიები",
            "articlesFound":     "სტატია ნაპოვნია",
            "readMore":          "წაკითხვა",
        },
        "hy": {
            "knowledgeHub":      "Գիտելիքների կենտրոն",
            "allArticles":       "Բոլոր հոդվածները",
            "searchPlaceholder": "Որոնել հոդվածներ…",
            "featuredArticle":   "Առաջարկում ենք",
            "latestArticles":    "Վերջին հոդվածները",
            "articlesFound":     "հոդված գտնվեց",
            "readMore":          "Կարդալ",
        },
    }

    footer_doc    = data["pages"].get("footer-nav", {})
    published     = [p for p in data["posts"]
                     if (gf(p).get("status") or "").lower() == "published"]
    blog_page_doc = data["pages"].get("blog", {})

    for lang in SUPPORTED_LANGS:
        blog_lo = loc(blog_page_doc, lang)
        blog_gf = gf(blog_page_doc)

        page = {
            "seoTitle":        blog_lo.get("seoTitle")        or blog_gf.get("seoTitle")        or "RAKUN — Blog",
            "metaDescription": blog_lo.get("metaDescription") or blog_gf.get("metaDescription") or "",
            "ogTitle":         blog_lo.get("ogTitle")         or blog_gf.get("ogTitle")         or "",
            "ogDescription":   blog_lo.get("ogDescription")   or blog_gf.get("ogDescription")   or "",
            "ogImageUrl":      blog_gf.get("ogImageUrl")      or "",
            "heroTitle":       blog_lo.get("heroTitle")       or blog_gf.get("heroTitle")       or "",
            "heroDescription": blog_lo.get("heroDescription") or blog_gf.get("heroDescription") or "",
        }

        posts = [extract(p, lang) for p in published]

        featured   = None
        grid_posts = posts
        for p in posts:
            if gf(next((r for r in published if r.get("_id") == p["_id"]), {})).get("featured"):
                featured   = p
                grid_posts = [x for x in posts if x["_id"] != p["_id"]]
                break
        if not featured and posts:
            featured   = posts[0]
            grid_posts = posts[1:]

        seen_cats = {}
        for p in posts:
            cid    = p.get("categoryId") or ""
            clabel = p.get("categoryLabel") or cid
            if cid and cid not in seen_cats:
                seen_cats[cid] = clabel
        categories = [{"slug": k, "label": v} for k, v in seen_cats.items()]

        footer_lo = loc(footer_doc, lang)
        footer_gf = gf(footer_doc)
        nav = {
            "home":     footer_lo.get("home")     or footer_gf.get("home")     or "Home",
            "catalog":  footer_lo.get("catalog")  or footer_gf.get("catalog")  or "Catalog",
            "blog":     footer_lo.get("blog")      or footer_gf.get("blog")     or "Blog",
            "contacts": footer_lo.get("contacts") or footer_gf.get("contacts") or "Contacts",
        }
        footer = {
            "link1":     footer_lo.get("link1")     or footer_gf.get("link1")     or "",
            "link2":     footer_lo.get("link2")     or footer_gf.get("link2")     or "",
            "link3":     footer_lo.get("link3")     or footer_gf.get("link3")     or "",
            "copyright": footer_lo.get("copyright") or footer_gf.get("copyright") or "© 2025 RAKUN",
        }
        ui = UI_STRINGS.get(lang, UI_STRINGS["en"])

        html = T["blog"].render(
            lang=lang,
            page=page,
            featured=featured,
            posts=grid_posts,
            categories=categories,
            nav=nav,
            footer=footer,
            ui=ui,
        )

        write(f"{OUTPUT_DIR}/{lang}/blog/index.html", html)

        sitemap_entries.append({
            "loc":        f"{BASE_URL}/{lang}/blog/",
            "lastmod":    str(date.today()),
            "changefreq": "weekly",
            "priority":   "0.7",
        })

    print()
    return sitemap_entries


# ── NEW: Individual Post Pages ────────────────────────────────

def gen_posts(data):
    """Generate one HTML page per blog post per language.

    URL pattern: /{lang}/blog/{slug}/index.html
    Template:    tpl_post.html
    Context:     post (extracted fields), related (up to 4 posts), nav, footer, ui
    """
    print("--- Posts ---")
    sitemap_entries = []

    # UI strings for post page chrome
    UI_STRINGS = {
        "en": {
            "tags":           "Tags",
            "share":          "Share",
            "contents":       "Contents",
            "author":         "Author",
            "related":        "Related",
            "continueReading":"Continue Reading",
            "moreArticles":   "More Articles",
            "backToBlog":     "Back to Blog",
            "minRead":        "min read",
        },
        "ru": {
            "tags":           "Теги",
            "share":          "Поделиться",
            "contents":       "Содержание",
            "author":         "Автор",
            "related":        "По теме",
            "continueReading":"Читайте также",
            "moreArticles":   "Другие статьи",
            "backToBlog":     "Назад в блог",
            "minRead":        "мин. чтения",
        },
        "ka": {
            "tags":           "ტეგები",
            "share":          "გაზიარება",
            "contents":       "შინაარსი",
            "author":         "ავტორი",
            "related":        "მსგავსი",
            "continueReading":"გააგრძელეთ კითხვა",
            "moreArticles":   "სხვა სტატიები",
            "backToBlog":     "ბლოგში დაბრუნება",
            "minRead":        "წთ. წასაკითხი",
        },
        "hy": {
            "tags":           "Թեգեր",
            "share":          "Կիսվել",
            "contents":       "Բովանդակություն",
            "author":         "Հեղինակ",
            "related":        "Առնչվող",
            "continueReading":"Շարունակել կարդալ",
            "moreArticles":   "Այլ հոդվածներ",
            "backToBlog":     "Վերադառնալ բլոգ",
            "minRead":        "րոպե կարդալու",
        },
    }

    footer_doc = data["pages"].get("footer-nav", {})
    published  = [p for p in data["posts"]
                  if (gf(p).get("status") or "").lower() == "published"]

    for lang in SUPPORTED_LANGS:
        footer_lo = loc(footer_doc, lang)
        footer_gf = gf(footer_doc)
        nav = {
            "home":     footer_lo.get("home")     or footer_gf.get("home")     or "Home",
            "catalog":  footer_lo.get("catalog")  or footer_gf.get("catalog")  or "Catalog",
            "blog":     footer_lo.get("blog")      or footer_gf.get("blog")     or "Blog",
            "contacts": footer_lo.get("contacts") or footer_gf.get("contacts") or "Contacts",
        }
        footer = {
            "link1":     footer_lo.get("link1")     or footer_gf.get("link1")     or "",
            "link2":     footer_lo.get("link2")     or footer_gf.get("link2")     or "",
            "link3":     footer_lo.get("link3")     or footer_gf.get("link3")     or "",
            "copyright": footer_lo.get("copyright") or footer_gf.get("copyright") or "© 2025 RAKUN",
        }
        ui = UI_STRINGS.get(lang, UI_STRINGS["en"])

        for raw in published:
            post = extract(raw, lang)
            slug = post["_slug"]
            if not slug:
                print(f"  ! Skipping post without slug: {raw.get('_id')}")
                continue

            # Related: same category, exclude self, up to 4
            related = [
                extract(p, lang)
                for p in published
                if p.get("_id") != raw.get("_id")
                and (gf(p).get("category") or gf(p).get("categoryId") or "")
                    == (gf(raw).get("category") or gf(raw).get("categoryId") or "")
            ][:4]

            # Fallback: any other posts if no same-category found
            if not related:
                related = [
                    extract(p, lang)
                    for p in published
                    if p.get("_id") != raw.get("_id")
                ][:4]

            html = T["post"].render(
                lang=lang,
                post=post,
                related=related,
                nav=nav,
                footer=footer,
                ui=ui,
            )

            path = f"{OUTPUT_DIR}/{lang}/blog/{slug}/index.html"
            write(path, html)

            # Sitemap entry
            lastmod = ""
            lm_raw  = gf(raw).get("lastModified")
            if lm_raw:
                try:
                    # Firestore Timestamp → datetime
                    lastmod = lm_raw.strftime("%Y-%m-%d") if hasattr(lm_raw, "strftime") else str(lm_raw)[:10]
                except Exception:
                    lastmod = str(date.today())
            else:
                lastmod = str(date.today())

            sitemap_entries.append({
                "loc":        f"{BASE_URL}/{lang}/blog/{slug}/",
                "lastmod":    lastmod,
                "changefreq": gf(raw).get("changeFrequency") or "monthly",
                "priority":   str(gf(raw).get("priority") or "0.7"),
            })

    print()
    return sitemap_entries


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
    gen_catalog(data)
    gen_products(data)
    gen_blog(data)
    gen_posts(data)       # ← NEW: generates /{lang}/blog/{slug}/

    # Раскомментируй когда будет готов gen_sitemap:
    # sitemap = gen_products(data) + gen_blog(data) + gen_posts(data)
    # gen_sitemap(sitemap)

    copy_static()

    print("\n" + "=" * 55)
    print("  DONE")
    print("=" * 55)


if __name__ == "__main__":
    main()