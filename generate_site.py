"""
RAKUN — Static Site Generator
Генерирует публичную часть сайта. Админка копируется как статичное SPA-приложение.
"""
import os, json, re, shutil, sys
from datetime import date
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
    "tpl_blog.html", "tpl_post.html", "tpl_404.html", "tpl_contacts.html",
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
    _nav = {"home": "Home", "about": "About Us", "catalog": "Catalog", "blog": "Blog", "contacts": "Contacts"}
    jinja.globals.update(BASE_URL=BASE_URL, LOGO_URL=LOGO_URL, SUPPORTED_LANGS=SUPPORTED_LANGS, nav=_nav)
    # Фильтр unique для Jinja2 (нужен для динамических табов стран в tpl_contacts.html)
    jinja.filters['unique'] = lambda seq: list(dict.fromkeys(seq))
    T = {k: jinja.get_template(f"tpl_{k}.html")
         for k in ["index", "catalog", "product", "blog", "post", "404", "contacts"]}
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
    imgs = lo.get("images") or g.get("images") or g.get("imageUrls") or lo.get("imageUrls") or []
    m["imageUrls"]  = imgs if isinstance(imgs, list) else ([imgs] if imgs else [])
    m["firstImage"] = m["imageUrls"][0] if m["imageUrls"] else (lo.get("ogImageUrl") or g.get("ogImageUrl") or "")

    m["shortDescription"] = lo.get("shortDescription") or lo.get("cardDescription") or ""
    m["fullDescription"]  = lo.get("fullDescriptionHtml") or lo.get("fullDescription") or ""
    m["features"]         = lo.get("featurePills") or g.get("featurePills") or []

    price_raw      = str(lo.get("price") or g.get("price") or "")
    m["priceRaw"]  = price_raw
    m["price"]     = price_raw.replace(" GEL", "").strip()

    # Для категорий slug лежит в корне документа (не в globalFields)
    cat_slug_raw   = g.get("categoryId") or doc.get("categoryId") or "products"
    m["_cat_slug"] = slugify(cat_slug_raw)
    m["_slug"]     = g.get("slug") or doc.get("slug") or doc.get("_id") or ""

    m["ingredients"]       = lo.get("ingredients") or g.get("ingredients") or []
    m["descriptionPoints"] = lo.get("descriptionPoints") or []

    # ── Product-specific fields ────────────────────────────
    m["sku"]            = g.get("sku") or ""
    m["weightVolume"]   = g.get("weightVolume") or ""
    m["stock"]          = g.get("stock")
    m["washes"]         = g.get("washes")           # None if null
    m["dosage"]         = lo.get("dosage") or g.get("dosage")    # per-lang, with globalFields fallback
    m["scentNotes"]     = lo.get("scentNotes") or g.get("scentNotes")  # per-lang
    m["badge"]          = g.get("badge") or ""

    # Available volume variants: [{label, value, link, badge}, ...]
    m["availableVolumes"] = lo.get("availableVolumes") or g.get("availableVolumes") or []

    # CTA Buttons (new schema): [{label, url}, ...]
    # Falls back to old single-button fields for legacy documents
    raw_cta_btns = lo.get("ctaButtons") or []
    if not raw_cta_btns:
        # Legacy fallback: rebuild from old separate fields
        old_cta_text = lo.get("ctaButtonText") or g.get("ctaButtonText") or ""
        old_cta_url  = lo.get("ctaLink") or g.get("ctaLink") or ""
        old_sec_text = lo.get("secondaryButtonText") or g.get("secondaryButtonText") or ""
        old_sec_url  = lo.get("secondaryButtonLink") or g.get("secondaryButtonLink") or ""
        if old_cta_text or old_cta_url:
            raw_cta_btns.append({"label": old_cta_text, "url": old_cta_url})
        if old_sec_text or old_sec_url:
            raw_cta_btns.append({"label": old_sec_text, "url": old_sec_url})
    m["ctaButtons"] = [b for b in raw_cta_btns if b.get("label") or b.get("url")]

    # ── Volume tags for catalog filter ────────────────────
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
    # Фильтр по объёму ориентируется только на weightVolume (не на availableVolumes)
    m["_volume_tags"] = sorted(vol_tags)

    # Legacy CTA fields kept for backwards compatibility (populated from ctaButtons[0] if needed)
    m["ctaLink"]              = (m["ctaButtons"][0]["url"]   if m["ctaButtons"] else "") or g.get("ctaLink") or ""
    m["ctaButtonText"]        = (m["ctaButtons"][0]["label"] if m["ctaButtons"] else "") or lo.get("ctaButtonText") or g.get("ctaButtonText") or ""
    m["secondaryButtonLink"]  = (m["ctaButtons"][1]["url"]   if len(m["ctaButtons"]) > 1 else "") or g.get("secondaryButtonLink") or ""
    m["secondaryButtonText"]  = (m["ctaButtons"][1]["label"] if len(m["ctaButtons"]) > 1 else "") or lo.get("secondaryButtonText") or g.get("secondaryButtonText") or ""

    # SEO / OG (локализованные)
    m["seoTitle"]        = lo.get("seoTitle") or g.get("seoTitle") or ""
    m["metaDescription"] = lo.get("metaDescription") or g.get("metaDescription") or ""
    m["ogTitle"]         = lo.get("ogTitle") or g.get("ogTitle") or ""
    m["ogDescription"]   = lo.get("ogDescription") or g.get("ogDescription") or ""
    m["imageAltText"]    = lo.get("imageAltText") or g.get("imageAltText") or m["name"]

    # Schema JSON-LD (raw string из БД)
    m["schemaJsonLd"]    = g.get("schemaJsonLd") or ""

    # Safety tab
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

    # Author
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

    for key in ["products", "categories"]:
        docs = [
            d.to_dict() | {"_id": d.id}
            for d in db.collection(key).stream()
            if is_live(d.to_dict())
        ]
        data[key] = docs
        print(f"  {key}: {len(docs)} docs")

    blog_docs = [
        d.to_dict() | {"_id": d.id}
        for d in db.collection("blog").stream()
        if is_live(d.to_dict())
    ]
    data["posts"] = blog_docs
    print(f"  blog (posts): {len(blog_docs)} docs")

    s = db.collection("settings").document("main").get()
    data["settings"] = (s.to_dict() or {}) if s.exists else {}
    data["settings"]["_id"] = "main"

    pages_data = {}
    for page_id in ["home", "catalog", "contacts", "blog"]:
        p = db.collection("pages").document(page_id).get()
        pages_data[page_id] = (p.to_dict() or {}) if p.exists else {}
    data["pages"] = pages_data

    print(f"  pages: {len(pages_data)} docs")
    print("  settings: OK\n")
    return data


# ── Index page generator ───────────────────────────────────────

def gen_index(data):
    print("--- Index ---")
    sitemap_entries = []
    # UI strings перенесены в tpl_index.html

    for lang in SUPPORTED_LANGS:
        products = [
            extract(p, lang)
            for p in data["products"]
            if (gf(p).get("status") or "").lower() == "published"
        ]
        products.sort(key=lambda x: x["name"].lower())

        posts = [
            extract(p, lang)
            for p in data["posts"]
            if (gf(p).get("status") or "").lower() == "published"
        ]
        posts = posts[:8]

        home_doc  = data["pages"].get("home", {})
        home_lo   = loc(home_doc, lang)
        home_gf   = gf(home_doc)

        page = {
            "seoTitle":        home_lo.get("seoTitle") or home_gf.get("seoTitle") or "",
            "metaDescription": home_lo.get("metaDescription") or home_gf.get("metaDescription") or "",
            "ogTitle":         home_lo.get("ogTitle") or home_gf.get("ogTitle") or "",
            "ogDescription":   home_lo.get("ogDescription") or home_gf.get("ogDescription") or "",
            "ogImageUrl":      home_gf.get("ogImageUrl") or "",
            "schemaOrg":       home_gf.get("schemaOrg") or "",
            "xDefaultHreflang":   home_gf.get("xDefaultHreflang") or "en",
            "regionHreflangMap":  home_gf.get("regionHreflangMap") or {},
        }

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
            "label":           contacts_lo.get("label")          or contacts_gf.get("label")          or "",
            "title":           contacts_lo.get("title")          or contacts_gf.get("title")          or "",
            "phone":           contacts_gf.get("phone")          or "",
            "email":           contacts_gf.get("email")          or "",
            "ctaButton":       contacts_lo.get("ctaButton")      or contacts_gf.get("ctaButton")      or "",
            "ctaEmail":        contacts_gf.get("ctaEmail")       or contacts_gf.get("email")          or "",
            "logisticsTerms":  contacts_lo.get("logisticsTerms") or contacts_gf.get("logisticsTerms") or "",
            "mapsEmbed":       contacts_gf.get("mapsEmbed")      or "",
            "whatsappLink":    contacts_gf.get("whatsappLink")   or "",
            "whatsappHandle":  contacts_gf.get("whatsappHandle") or "",
            "telegramLink":    contacts_gf.get("telegramLink")   or "",
            "telegramHandle":  contacts_gf.get("telegramHandle") or "",
            "stores":          contacts_gf.get("stores")         or [],
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
            contacts=contacts,
            products_section=products_section,
            blog_section=blog_section,
            reviews=reviews,
            reviews_section=reviews_section,
        )

        write(f"{OUTPUT_DIR}/{lang}.html", html)

        if lang == SUPPORTED_LANGS[0]:
            sitemap_entries.append({
                "slug":             "home",
                "type":             "home_index",
                "lastmod":          str(date.today()),
                "changefreq":       "weekly",
                "priority":         "1.0",
                "xDefaultHreflang":  home_gf.get("xDefaultHreflang") or "en",
                "regionHreflangMap": home_gf.get("regionHreflangMap") or {},
                "urlLang":          SUPPORTED_LANGS,
            })

    print()
    return sitemap_entries


# ── Остальные генераторы ──────────────────────────────────────

def gen_catalog(data):
    print("--- Catalog ---")
    sitemap_entries = []
    # UI strings перенесены в tpl_catalog.html

    catalog_doc  = data["pages"].get("catalog", {})

    published = [p for p in data["products"]
                 if (gf(p).get("status") or "").lower() == "published"]

    for lang in SUPPORTED_LANGS:
        cat_lo = loc(catalog_doc, lang)
        cat_gf = gf(catalog_doc)

        page = {
            "seoTitle":        cat_lo.get("seoTitle")       or cat_gf.get("seoTitle")       or "",
            "metaDescription": cat_lo.get("metaDescription") or cat_gf.get("metaDescription") or "",
            "ogTitle":         cat_lo.get("ogTitle")         or cat_gf.get("ogTitle")         or "",
            "ogDescription":   cat_lo.get("ogDescription")  or cat_gf.get("ogDescription")  or "",
            "ogImageUrl":      cat_gf.get("ogImageUrl")      or "",
            "heroLabel":       cat_lo.get("heroLabel")       or cat_gf.get("heroLabel")       or "",
            "heroTitle":       cat_lo.get("heroTitle")       or cat_gf.get("heroTitle")       or "",
            "heroSubtitle":    (cat_lo.get("heroSubtitle") or cat_lo.get("heroDescription")
                                or cat_gf.get("heroSubtitle") or cat_gf.get("heroDescription") or ""),
            "schemaOrg":       cat_gf.get("schemaOrg")      or "",
            "xDefaultHreflang":   cat_gf.get("xDefaultHreflang") or "en",
            "regionHreflangMap":  cat_gf.get("regionHreflangMap") or {},
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

        def _vol_sort_key(slug):
            import re as _re
            nums = _re.findall(r'[\d.]+', slug)
            val = float(nums[0]) if nums else 0
            if 'l' in slug and 'ml' not in slug:
                val *= 1000
            return val

        seen_volumes = {} 
        for p in products:
            for vol_slug in (p.get("_volume_tags") or []):
                if vol_slug not in seen_volumes:
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


        html = T["catalog"].render(
            lang=lang,
            page=page,
            categories=categories,
            products=products,
            all_features=all_features,
            all_volumes=all_volumes,
        )

        write(f"{OUTPUT_DIR}/{lang}/catalog.html", html)

        if lang == SUPPORTED_LANGS[0]:
            sitemap_entries.append({
                "slug":             "catalog",
                "type":             "catalog_index",
                "lastmod":          str(date.today()),
                "changefreq":       "weekly",
                "priority":         "0.9",
                "xDefaultHreflang":  cat_gf.get("xDefaultHreflang") or "en",
                "regionHreflangMap": cat_gf.get("regionHreflangMap") or {},
                "urlLang":          SUPPORTED_LANGS,
            })

    print()
    return sitemap_entries


def gen_products(data):
    print("--- Products ---")
    sitemap_entries = []
    # UI strings перенесены в tpl_product.html

    published  = [p for p in data["products"]
                  if (gf(p).get("status") or "").lower() == "published"]

    for lang in SUPPORTED_LANGS:

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
                    )

            cat  = product["_cat_slug"]
            path = f"{OUTPUT_DIR}/{lang}/products/{cat}/{slug}.html"
            write(path, html)

            if lang == SUPPORTED_LANGS[0]:
                sitemap_entries.append({
                    "slug":           slug,
                    "type":           "product",
                    "cat":            cat,
                    "lastmod":        str(date.today()),
                    "changefreq":     gf(raw).get("changeFrequency") or "monthly",
                    "priority":       str(gf(raw).get("priority") or "0.8"),
                    "xDefaultHreflang":  gf(raw).get("xDefaultHreflang") or "en",
                    "regionHreflangMap": _region_map_from_str(gf(raw).get("regionHreflang") or ""),
                    "urlLang":           SUPPORTED_LANGS,
                })

    print()
    return sitemap_entries


def gen_blog(data):
    print("--- Blog ---")
    sitemap_entries = []
    # UI strings перенесены в tpl_blog.html

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
            "allLabel":        blog_lo.get("allLabel")        or blog_gf.get("allLabel")        or "",
            "featuredLabel":   blog_lo.get("featuredLabel")   or blog_gf.get("featuredLabel")   or "",
            "readMore":        blog_lo.get("readMore")        or blog_gf.get("readMore")        or "",
            "schemaOrg":       blog_gf.get("schemaOrg")       or "",
            "xDefaultHreflang":   blog_gf.get("xDefaultHreflang") or "en",
            "regionHreflangMap":  blog_gf.get("regionHreflangMap") or {},
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


        html = T["blog"].render(
            lang=lang,
            page=page,
            featured=featured,
            posts=grid_posts,
            categories=categories,
        )

        write(f"{OUTPUT_DIR}/{lang}/blog.html", html)

        if lang == SUPPORTED_LANGS[0]:
            sitemap_entries.append({
                "slug":             "blog",
                "type":             "blog_index",
                "lastmod":          str(date.today()),
                "changefreq":       "weekly",
                "priority":         "0.7",
                "xDefaultHreflang":  blog_gf.get("xDefaultHreflang") or "en",
                "regionHreflangMap": blog_gf.get("regionHreflangMap") or {},
                "urlLang":          SUPPORTED_LANGS,
            })

    print()
    return sitemap_entries


def gen_posts(data):
    """Generate one HTML page per blog post per language."""
    print("--- Posts ---")
    sitemap_entries = []
    # UI strings перенесены в tpl_post.html

    published  = [p for p in data["posts"]
                  if (gf(p).get("status") or "").lower() == "published"]

    for lang in SUPPORTED_LANGS:

        for raw in published:
            post = extract(raw, lang)
            slug = post["_slug"]
            if not slug:
                continue

            related = [
                extract(p, lang)
                for p in published
                if p.get("_id") != raw.get("_id")
                and (gf(p).get("category") or gf(p).get("categoryId") or "")
                    == (gf(raw).get("category") or gf(raw).get("categoryId") or "")
            ][:4]

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
                    )

            path = f"{OUTPUT_DIR}/{lang}/blog/{slug}.html"
            write(path, html)

            lastmod = ""
            lm_raw  = gf(raw).get("lastModified")
            if lm_raw:
                try:
                    lastmod = lm_raw.strftime("%Y-%m-%d") if hasattr(lm_raw, "strftime") else str(lm_raw)[:10]
                except Exception:
                    lastmod = str(date.today())
            else:
                lastmod = str(date.today())

            if lang == SUPPORTED_LANGS[0]:
                sitemap_entries.append({
                    "slug":             slug,
                    "type":             "post",
                    "lastmod":          lastmod,
                    "changefreq":       gf(raw).get("changeFrequency") or "monthly",
                    "priority":         str(gf(raw).get("priority") or "0.7"),
                    "xDefaultHreflang":  gf(raw).get("xDefaultHreflang") or "en",
                    "regionHreflangMap": _region_map_from_str(gf(raw).get("regionHreflang") or ""),
                    "urlLang":           SUPPORTED_LANGS,
                })

    print()
    return sitemap_entries


def gen_contacts(data):
    print("--- Contacts ---")
    sitemap_entries = []
    # UI strings перенесены в tpl_contacts.html

    contacts_doc = data["pages"].get("contacts", {})

    for lang in SUPPORTED_LANGS:
        cont_lo = loc(contacts_doc, lang)
        cont_gf = gf(contacts_doc)

        page = {
            "seoTitle":        cont_lo.get("seoTitle") or cont_gf.get("seoTitle") or "",
            "metaDescription": cont_lo.get("metaDescription") or cont_gf.get("metaDescription") or "",
            "ogTitle":         cont_lo.get("ogTitle") or cont_gf.get("ogTitle") or "",
            "ogDescription":   cont_lo.get("ogDescription") or cont_gf.get("ogDescription") or "",
            "ogImageUrl":      cont_gf.get("ogImageUrl") or "",

            "label":           cont_lo.get("label") or cont_gf.get("label") or "",
            "title":           cont_lo.get("title") or cont_gf.get("title") or "",
            "heroDescription": cont_lo.get("heroDescription") or cont_gf.get("heroDescription") or "",

            "phone":           cont_gf.get("phone") or "",
            "email":           cont_gf.get("email") or "",
            "workingHours":    cont_lo.get("workingHours") or cont_gf.get("workingHours") or "",

            "whatsappLink":    cont_gf.get("whatsappLink") or "",
            "whatsappHandle":  cont_gf.get("whatsappHandle") or "",
            "telegramLink":    cont_gf.get("telegramLink") or "",
            "telegramHandle":  cont_gf.get("telegramHandle") or "",
            "instagramLink":   cont_gf.get("instagramLink") or "",
            "instagramHandle": cont_gf.get("instagramHandle") or "",
            "facebookLink":    cont_gf.get("facebookLink") or "",
            "facebookHandle":  cont_gf.get("facebookHandle") or "",
            "viberLink":       cont_gf.get("viberLink") or "",
            "viberHandle":     cont_gf.get("viberHandle") or "",

            "logisticsTerms":  cont_lo.get("logisticsTerms") or cont_gf.get("logisticsTerms") or "",
            "ctaTitle":        cont_lo.get("ctaTitle") or cont_gf.get("ctaTitle") or "",
            "ctaButton":       cont_lo.get("ctaButton") or cont_gf.get("ctaButton") or "",
            "ctaEmail":        cont_gf.get("ctaEmail") or cont_gf.get("email") or "",

            "faq":             cont_lo.get("faq") or cont_gf.get("faq") or [],
            "schemaOrg":       cont_gf.get("schemaOrg") or cont_gf.get("schemaJsonLd") or "",
            "xDefaultHreflang":   cont_gf.get("xDefaultHreflang") or "en",
            "regionHreflangMap":  cont_gf.get("regionHreflangMap") or {},
        }

        stores = cont_gf.get("stores") or contacts_doc.get("stores") or []


        html = T["contacts"].render(
            lang=lang,
            page=page,
            stores=stores,
        )

        write(f"{OUTPUT_DIR}/{lang}/contacts.html", html)

        if lang == SUPPORTED_LANGS[0]:
            sitemap_entries.append({
                "slug":             "contacts",
                "type":             "contacts_index",
                "lastmod":          str(date.today()),
                "changefreq":       "monthly",
                "priority":         "0.6",
                "xDefaultHreflang":  cont_gf.get("xDefaultHreflang") or "en",
                "regionHreflangMap": cont_gf.get("regionHreflangMap") or {},
                "urlLang":          SUPPORTED_LANGS,
            })

    print()
    return sitemap_entries


def gen_404(data):
    print("--- 404 Page ---")

    UI_STRINGS = {
        "en": {
            "error404": "404 — Page Not Found", 
            "errorLabel": "System Error", 
            "pageNotFound": "Page Not Found", 
            "pageNotFoundDesc": "The page you are looking for might have been removed, had its name changed, or is temporarily unavailable. Let's get you back on track."
        },
        "ru": {
            "error404": "404 — Страница не найдена", 
            "errorLabel": "Системная ошибка", 
            "pageNotFound": "Страница не найдена", 
            "pageNotFoundDesc": "Страница, которую вы ищете, возможно, была удалена, переименована или временно недоступна. Давайте вернемся на главную."
        },
        "ka": {
            "error404": "404 — გვერდი არ მოიძებნა", 
            "errorLabel": "სისტემური შეცდომა", 
            "pageNotFound": "გვერდი არ მოიძებნა", 
            "pageNotFoundDesc": "გვერდი, რომელსაც ეძებთ, შესაძლოა წაიშალა, სახელი შეეცვალა ან დროებით მიუწვდომელია. დავბრუნდეთ მთავარ გვერდზე."
        },
        "hy": {
            "error404": "404 — Էջը չի գտնվել", 
            "errorLabel": "Համակարգի սխալ", 
            "pageNotFound": "Էջը չի գտնվել", 
            "pageNotFoundDesc": "Էջը, որը փնտրում եք, հնարավոր է հեռացվել է, անվանափոխվել է կամ ժամանակավորապես անհասանելի է: Վերադառնանք գլխավոր էջ:"
        },
    }


    for lang in SUPPORTED_LANGS:
        
        ui = UI_STRINGS.get(lang, UI_STRINGS["en"])

        html = T["404"].render(
            lang=lang,
            ui=ui,
        )

        write(f"{OUTPUT_DIR}/{lang}/404.html", html)

        if lang == "en":
            write(f"{OUTPUT_DIR}/404.html", html)

    print()


def _region_map_from_str(region_str):
    """Convert single regionHreflang string to map: 'ru-GE' -> {'ru': 'ru-GE'}."""
    if not region_str:
        return {}
    lang_code = region_str.split('-')[0]
    return {lang_code: region_str}


def _entry_url(entry_type, base_url, lang, slug, cat):
    """Build a URL for a sitemap entry by type."""
    if entry_type == "product":
        return f"{base_url}/{lang}/products/{cat}/{slug}"
    if entry_type == "home_index":
        return f"{base_url}/{lang}"
    if entry_type == "catalog_index":
        return f"{base_url}/{lang}/catalog"
    if entry_type == "blog_index":
        return f"{base_url}/{lang}/blog"
    if entry_type == "contacts_index":
        return f"{base_url}/{lang}/contacts"
    # post
    return f"{base_url}/{lang}/blog/{slug}"


def gen_sitemap(entries):
    print("--- Sitemap ---")
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
        '        xmlns:xhtml="http://www.w3.org/1999/xhtml">',
        "<url>",
        f"  <loc>{BASE_URL}</loc>",
        "  <changefreq>weekly</changefreq>",
        "  <priority>1.0</priority>",
        "</url>",
    ]
    for e in entries:
        slug            = e["slug"]
        etype           = e["type"]
        x_default       = e["xDefaultHreflang"]
        region_map      = e.get("regionHreflangMap") or {}
        langs           = e["urlLang"]
        cat             = e.get("cat", "")

        # One <url> block per language variant (Google requirement)
        for lang_var in langs:
            loc = _entry_url(etype, BASE_URL, lang_var, slug, cat)
            block = ["<url>", f"  <loc>{loc}</loc>"]

            # xhtml:link alternate for every language
            for l in langs:
                # regionHreflangMap[l] overrides plain lang code if set
                hreflang_val = region_map.get(l) or l
                href = _entry_url(etype, BASE_URL, l, slug, cat)
                block.append(
                    f'  <xhtml:link rel="alternate" hreflang="{hreflang_val}" href="{href}"/>'
                )
            # x-default points to the chosen default language URL
            xd_href = _entry_url(etype, BASE_URL, x_default, slug, cat)
            block.append(
                f'  <xhtml:link rel="alternate" hreflang="x-default" href="{xd_href}"/>'
            )
            block += [
                f"  <lastmod>{e['lastmod']}</lastmod>",
                f"  <changefreq>{e['changefreq']}</changefreq>",
                f"  <priority>{e['priority']}</priority>",
                "</url>",
            ]
            lines += block

    lines.append("</urlset>")
    with open(f"{OUTPUT_DIR}/sitemap.xml", "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print(f"  sitemap.xml — {len(entries) + 1} URLs written")
    print()


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



def gen_root_redirect():
    """Generate root index.html that redirects to /en"""
    html = """<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta http-equiv="refresh" content="0; url=/en">
  <link rel="canonical" href="https://rakun-official.com/en">
  <script>window.location.replace('/en');</script>
</head>
<body></body>
</html>"""
    write(f"{OUTPUT_DIR}/index.html", html)


def main():
    if os.path.exists(OUTPUT_DIR):
        shutil.rmtree(OUTPUT_DIR)
    os.makedirs(OUTPUT_DIR)

    gen_root_redirect()

    data = load_firestore()

    sitemap = []
    sitemap += gen_index(data)
    sitemap += gen_catalog(data)
    sitemap += gen_products(data)
    sitemap += gen_blog(data)
    sitemap += gen_posts(data)
    sitemap += gen_contacts(data)
    gen_404(data)

    gen_sitemap(sitemap)
    copy_static()

    print("\n" + "=" * 55)
    print("  DONE")
    print("=" * 55)


if __name__ == "__main__":
    main()
