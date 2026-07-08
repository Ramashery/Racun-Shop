"""
RAKUN — Static Site Generator
Генерирует публичную часть сайта. Админка копируется как статичное SPA-приложение.
"""
import os, json, re, shutil, sys
from urllib.parse import quote_plus
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
    "tpl_blog.html", "tpl_post.html", "tpl_404.html", "tpl_contacts.html",
    "tpl_about.html", "tpl_category.html", "tpl_llms.txt",
    # robots.txt и llms.txt теперь генерируются самим скриптом (gen_robots,
    # gen_llms) — если в репозитории случайно останется старый статический
    # файл с этим именем, он не должен затирать сгенерированную версию.
    "robots.txt", "llms.txt",
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
    # Отдельное окружение без autoescape — для текстовых (не HTML) шаблонов
    # вроде tpl_llms.txt. Иначе Jinja экранировал бы '&', «'» и т.п. в
    # описаниях товаров/постов как HTML-сущности внутри обычного текстового
    # файла (&amp;, &#39;...), что там совершенно не нужно.
    jinja_text = Environment(
        loader=FileSystemLoader("."),
        autoescape=False,
        trim_blocks=True,
        lstrip_blocks=True,
    )
    _nav = {"home": "Home", "about": "About Us", "catalog": "Catalog", "blog": "Blog", "contacts": "Contacts"}
    jinja.globals.update(BASE_URL=BASE_URL, LOGO_URL=LOGO_URL, SUPPORTED_LANGS=SUPPORTED_LANGS, nav=_nav)
    # Фильтр unique для Jinja2 (нужен для динамических табов стран в tpl_contacts.html)
    jinja.filters['unique'] = lambda seq: list(dict.fromkeys(seq))

    def _maps_embed_url(value):
        """
        Принимает либо чистый URL вида https://www.google.com/maps/embed?...
        либо полный тег <iframe src="..." ...></iframe> — и возвращает только URL для src.
        """
        import re as _re
        if not value:
            return ''
        value = str(value).strip()
        if value.lower().startswith('<iframe'):
            m = _re.search(r'src=["\'](https?://[^"\'>]+)["\'"]', value)
            return m.group(1) if m else ''
        return value

    jinja.filters['maps_embed_url'] = _maps_embed_url

    _PLACEHOLDER_ADDRESSES = {"", "coming soon", "tba", "n/a"}

    def with_maps_links(stores):
        """
        The admin panel only has a single 'Maps Embed URL' field per store, so
        store['mapsLink'] (the outbound 'Get Directions' link the templates
        expect) is never actually saved — every store silently fell back to
        the same hardcoded default URL. Derive a real, store-specific link
        from the store's address instead, unless one is ever supplied directly.

        Stores that aren't live yet (address is blank or a placeholder like
        "Coming soon") get no link at all — searching Google Maps for the
        literal text "Coming soon" would be just as wrong as the old
        hardcoded fallback, so the template simply won't render a clickable
        link/CTA for these until a real address is added.
        """
        result = []
        for s in (stores or []):
            s = dict(s)
            address = (s.get("address") or "").strip()
            if not s.get("mapsLink") and address.lower() not in _PLACEHOLDER_ADDRESSES:
                s["mapsLink"] = "https://www.google.com/maps/search/?api=1&query=" + quote_plus(address)
            result.append(s)
        return result

    T = {k: jinja.get_template(f"tpl_{k}.html")
         for k in ["index", "catalog", "category", "product", "blog", "post", "404", "contacts", "about"]}
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
    def _valid_url(u):
        return isinstance(u, str) and len(u) > 4 and (u.startswith('http') or u.startswith('/'))

    _imgs_raw = lo.get("images") or g.get("images") or g.get("imageUrls") or lo.get("imageUrls") or []
    _imgs_raw = _imgs_raw if isinstance(_imgs_raw, list) else ([_imgs_raw] if _imgs_raw else [])
    imgs = [u for u in _imgs_raw if _valid_url(u)]
    m["imageUrls"]  = imgs
    m["firstImage"] = imgs[0] if imgs else (lo.get("ogImageUrl") or g.get("ogImageUrl") or "")

    m["shortDescription"] = lo.get("shortDescription") or lo.get("cardDescription") or ""
    m["fullDescription"]  = lo.get("fullDescriptionHtml") or lo.get("fullDescription") or ""
    _fp = lo.get("featurePills")
    m["features"] = _fp if isinstance(_fp, list) else (g.get("featurePills") or [])

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
    _dosage = lo.get("dosage")
    m["dosage"] = _dosage if isinstance(_dosage, list) else (g.get("dosage") or None)
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

    # Schema JSON-LD (per-lang string from DB)
    m["schemaJsonLd"]    = lo.get("schemaJsonLd") or g.get("schemaJsonLd") or ""

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
    m["regionHreflang"]     = lo.get("regionHreflang") or g.get("regionHreflang") or ""

    return m


def is_live(doc):
    """Пропускает только Archived-документы — Draft и все остальные загружаются.
    Для категорий это нормально (фильтруем по 'active' позже).
    Для товаров/постов тоже нормально — фильтр по 'published' в gen_* функциях."""
    return (gf(doc).get("status") or "").lower() != "archived"

def is_live_cat(doc):
    """Для категорий загружаем все кроме Archived (Hidden нужны для sitemap-skip)."""
    return (doc.get("status") or "").lower() != "archived"


# GitHub Pages не поддерживает серверные redirect-правила (нет аналога
# firebase.json/_redirects/.htaccess), поэтому такие вещи, как лишние
# слэши (/en///products///x) или произвольный регистр в пути
# (/EN/Products/X) — GitHub Pages отдаёт их как 200, просто нормализуя
# путь при поиске файла — исправляем на клиенте: скрипт приводит путь к
# канонической форме (без дублей слэшей, в нижнем регистре — все слаги в
# базе и так всегда в нижнем регистре) и сразу делает location.replace()
# ещё до того, как начнут грузиться остальные ресурсы страницы. Не
# настоящий HTTP 301, но при отсутствии серверного контроля это лучшее,
# что доступно "из коробки" без внешних сервисов (Cloudflare и т.п.) —
# см. также rel="canonical" на каждой странице как подстраховка для
# индексации. Query-строка и hash в регистре не трогаются (могут быть
# значимы, напр. токены).
_URL_NORMALIZE_SCRIPT = """  <script>
  (function () {
    var p = location.pathname;
    var clean = p.replace(/\\/{2,}/g, "/").toLowerCase();
    if (clean !== p) {
      location.replace(clean + location.search + location.hash);
    }
  })();
  </script>
"""


def write(path, content):
    if path.endswith(".html") and "<head>" in content:
        content = content.replace("<head>", "<head>\n" + _URL_NORMALIZE_SCRIPT, 1)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"  + {path.replace(OUTPUT_DIR + '/', '')}")


# ── Автогенерация schema.org (JSON-LD) ─────────────────────────
#
# Общий принцип для всех страниц: если в Firestore поле
# globalFields.schemaOrg (или localized.schemaOrg) для страницы заполнено
# вручную через админку — используем его как есть. Если оно пустое —
# собираем микроразметку автоматически из тех данных, что уже есть в БД
# (тексты, товары, отзывы, контакты и т.д.), чтобы страница никогда не
# оставалась без структурированных данных.

# Видимые хлебные крошки на catalog/category сайта хардкожены на английском
# (см. tpl_catalog.html/tpl_category.html), поэтому в разметке используем те
# же подписи — она должна соответствовать тому, что реально видно на странице.
_BREADCRUMB_LABELS = {"home": "Home", "catalog": "Catalog", "contacts": "Contacts", "blog": "Blog"}

# About Us — единственная крошка, которая у сайта реально локализована
# (см. ui_breadcrumb в tpl_about.html) — повторяем то же самое здесь.
_ABOUT_BREADCRUMB_LABEL = {"en": "About Us", "ru": "О нас", "ka": "ჩვენ შესახებ", "hy": "Մեր մասին"}


def _product_node(p, lang):
    """
    Строит JSON-LD узел для одного товара + его каноничный URL.
    Тип узла зависит от того, есть ли цена в базе:
      - есть цена  → "@type": "Product" + "offers" (полноценная товарная разметка)
      - цены нет   → "@type": "Thing" (RAKUN — опт, часть товаров без
        публичной цены; Google требует offers/review/aggregateRating у любого
        узла "Product", поэтому без цены используем нейтральный тип —
        валидная ссылка с картинкой и названием, но без ложной коммерческой
        семантики и без ошибок валидации).
    """
    product_url = f"{BASE_URL}/{lang}/products/{p.get('_cat_slug') or 'products'}/{p.get('_slug') or ''}"
    price = (p.get("price") or "").strip()
    node = {
        "@type": "Product" if price else "Thing",
        "name": p.get("name") or "",
        "url": product_url,
    }
    if p.get("firstImage"):
        node["image"] = p["firstImage"]
    if p.get("shortDescription"):
        node["description"] = p["shortDescription"]
    if price:
        if p.get("sku"):
            node["sku"] = p["sku"]
        node["offers"] = {
            "@type": "Offer",
            "url": product_url,
            "priceCurrency": "GEL",
            "price": price,
            "availability": "https://schema.org/InStock",
        }
    return node


def build_products_item_list(list_id, products, lang, name=None, limit=None):
    """Собирает ItemList из товаров (см. _product_node). Возвращает None, если товаров нет."""
    items = [p for p in products if p.get("name")]
    if limit:
        items = items[:limit]
    if not items:
        return None
    item_list = {"@type": "ItemList", "@id": list_id, "itemListElement": []}
    if name:
        item_list["name"] = name
    for i, p in enumerate(items, start=1):
        item_list["itemListElement"].append({
            "@type": "ListItem",
            "position": i,
            "item": _product_node(p, lang),
        })
    return item_list


def build_breadcrumb(page_url, crumbs):
    """crumbs: список (name, url) от Home до текущей страницы включительно."""
    return {
        "@type": "BreadcrumbList",
        "@id": f"{page_url}#breadcrumb",
        "itemListElement": [
            {"@type": "ListItem", "position": i, "name": name, "item": url}
            for i, (name, url) in enumerate(crumbs, start=1)
        ],
    }


def build_home_schema(lang, page, contacts, reviews, products):
    """
    Собирает расширенный @graph JSON-LD для главной страницы:
      - Organization  (лого, контакты, соцсети/мессенджеры, рейтинг)
      - WebSite       (+ SearchAction для sitelinks search box)
      - WebPage       (сама главная страница, привязанная к WebSite/Organization)
      - ItemList      (товары с ценой, показанные на главной — помогает Google
                        понять ассортимент и вести на карточки товаров)
      - AggregateRating + Review  (из отзывов на главной, если есть)

    Вызывается только когда page['schemaOrg'] из Firestore пустой
    (см. gen_index). Если админ заполнит поле schemaOrg вручную —
    эта функция не вызывается вообще, используется значение из БД.
    """
    page_url = f"{BASE_URL}/{lang}"
    org_id   = f"{BASE_URL}/#organization"
    site_id  = f"{BASE_URL}/#website"
    page_id  = f"{page_url}#webpage"

    # ── sameAs: официальные соцсети/мессенджеры компании (не B2B-партнёры!) ──
    same_as = [u for u in [
        contacts.get("facebookLink"),
        contacts.get("instagramLink"),
        contacts.get("whatsappLink"),
        contacts.get("telegramLink"),
    ] if u]

    organization = {
        "@type": "Organization",
        "@id": org_id,
        "name": "RAKUN",
        "url": BASE_URL + "/",
        "logo": {"@type": "ImageObject", "url": LOGO_URL},
        "image": page.get("ogImageUrl") or LOGO_URL,
    }
    if page.get("metaDescription"):
        organization["description"] = page["metaDescription"]
    if same_as:
        organization["sameAs"] = same_as
    # Примечание: адрес намеренно не заполняется из contacts.stores — это
    # розничные точки партнёров, а не собственный адрес RAKUN. Если у
    # компании появится собственный официальный адрес в БД, его можно
    # будет подставить сюда явно.

    contact_point = {
        "@type": "ContactPoint",
        "contactType": "customer service",
        "availableLanguage": ["English", "Russian", "Georgian", "Armenian"],
    }
    if contacts.get("phone"):
        contact_point["telephone"] = contacts["phone"]
    if contacts.get("email"):
        contact_point["email"] = contacts["email"]
    organization["contactPoint"] = [contact_point]

    website = {
        "@type": "WebSite",
        "@id": site_id,
        "url": BASE_URL + "/",
        "name": "RAKUN",
        "inLanguage": lang,
        "publisher": {"@id": org_id},
        "potentialAction": {
            "@type": "SearchAction",
            "target": {
                "@type": "EntryPoint",
                "urlTemplate": f"{BASE_URL}/{lang}/catalog?q={{search_term_string}}",
            },
            "query-input": "required name=search_term_string",
        },
    }

    webpage = {
        "@type": "WebPage",
        "@id": page_id,
        "url": page_url,
        "name": page.get("seoTitle") or "RAKUN",
        "isPartOf": {"@id": site_id},
        "about": {"@id": org_id},
        "inLanguage": lang,
    }
    if page.get("metaDescription"):
        webpage["description"] = page["metaDescription"]
    if page.get("ogImageUrl"):
        webpage["primaryImageOfPage"] = {"@type": "ImageObject", "url": page["ogImageUrl"]}

    graph = [organization, website, webpage]

    # ── товары, показанные на главной — как ItemList со ссылками на карточки ──
    item_list = build_products_item_list(f"{page_url}#featured-products", products, lang, name="RAKUN", limit=12)
    if item_list:
        graph.append(item_list)

    # ── отзывы клиентов → AggregateRating + отдельные Review на Organization ──
    valid_reviews = [r for r in reviews if r.get("text")]
    if valid_reviews:
        avg = sum(r.get("stars") or 5 for r in valid_reviews) / len(valid_reviews)
        organization["aggregateRating"] = {
            "@type": "AggregateRating",
            "ratingValue": round(avg, 1),
            "reviewCount": len(valid_reviews),
            "bestRating": "5",
            "worstRating": "1",
        }
        organization["review"] = [
            {
                "@type": "Review",
                "author": {"@type": "Person", "name": r.get("author") or "Customer"},
                "reviewBody": r["text"],
                "reviewRating": {
                    "@type": "Rating",
                    "ratingValue": r.get("stars") or 5,
                    "bestRating": "5",
                    "worstRating": "1",
                },
            }
            for r in valid_reviews[:10]
        ]

    return {"@context": "https://schema.org", "@graph": graph}


def build_catalog_schema(lang, page, categories, products):
    """
    @graph для страницы /catalog:
      - CollectionPage (сама страница каталога)
      - BreadcrumbList  (Home → Catalog)
      - ItemList        (все опубликованные товары, полноценные Product+offers
                          там где есть цена — это главная товарная витрина сайта)
    """
    page_url = f"{BASE_URL}/{lang}/catalog"
    page_id  = f"{page_url}#webpage"

    webpage = {
        "@type": "CollectionPage",
        "@id": page_id,
        "url": page_url,
        "name": page.get("seoTitle") or "RAKUN Catalog",
        "inLanguage": lang,
        "isPartOf": {"@id": f"{BASE_URL}/#website"},
        "about": {"@id": f"{BASE_URL}/#organization"},
    }
    if page.get("metaDescription"):
        webpage["description"] = page["metaDescription"]
    if page.get("ogImageUrl"):
        webpage["primaryImageOfPage"] = {"@type": "ImageObject", "url": page["ogImageUrl"]}
    if categories:
        webpage["hasPart"] = [
            {
                "@type": "CollectionPage",
                "name": c["name"],
                "url": f"{BASE_URL}/{lang}/products/{c['urlSlug']}",
            }
            for c in categories
        ]

    breadcrumb = build_breadcrumb(page_url, [
        (_BREADCRUMB_LABELS["home"], f"{BASE_URL}/{lang}"),
        (_BREADCRUMB_LABELS["catalog"], page_url),
    ])

    graph = [webpage, breadcrumb]

    item_list = build_products_item_list(f"{page_url}#products", products, lang, name=webpage["name"])
    if item_list:
        webpage["mainEntity"] = {"@id": item_list["@id"]}
        graph.append(item_list)

    return {"@context": "https://schema.org", "@graph": graph}


def build_category_schema(lang, page, products):
    """
    @graph для страницы категории /products/{slug}:
      - CollectionPage (сама страница категории, "about" = сама категория как Thing)
      - BreadcrumbList  (Home → Catalog → <Category>)
      - ItemList        (товары этой категории, полноценные Product+offers
                          там, где есть цена)
    """
    page_url = f"{BASE_URL}/{lang}/products/{page['slug']}"
    page_id  = f"{page_url}#webpage"
    cat_name = page.get("name") or page.get("nameEn") or ""

    category_thing = {"@type": "Thing", "name": cat_name}

    webpage = {
        "@type": "CollectionPage",
        "@id": page_id,
        "url": page_url,
        "name": page.get("seoTitle") or cat_name,
        "inLanguage": lang,
        "isPartOf": {"@id": f"{BASE_URL}/#website"},
        "about": category_thing,
    }
    if page.get("metaDescription"):
        webpage["description"] = page["metaDescription"]
    elif page.get("description"):
        webpage["description"] = page["description"]
    if page.get("ogImageUrl"):
        webpage["primaryImageOfPage"] = {"@type": "ImageObject", "url": page["ogImageUrl"]}

    # Видимая на странице крошка использует английское имя категории (nameEn) —
    # разметка повторяет то, что реально показано пользователю и Google.
    breadcrumb = build_breadcrumb(page_url, [
        (_BREADCRUMB_LABELS["home"], f"{BASE_URL}/{lang}"),
        (_BREADCRUMB_LABELS["catalog"], f"{BASE_URL}/{lang}/catalog"),
        (page.get("nameEn") or cat_name, page_url),
    ])

    graph = [webpage, breadcrumb]

    item_list = build_products_item_list(f"{page_url}#products", products, lang, name=webpage["name"])
    if item_list:
        webpage["mainEntity"] = {"@id": item_list["@id"]}
        graph.append(item_list)

    return {"@context": "https://schema.org", "@graph": graph}


def _strip_html(html):
    """Убирает теги для использования HTML-описания как plain-text description в JSON-LD."""
    text = re.sub(r"<[^>]+>", " ", html or "")
    return re.sub(r"\s+", " ", text).strip()


def _fmt_dosage_item(d):
    """
    dosage в базе — список объектов {amount, type, weight} (не строк).
    Собирает их в читаемый текст вида "Обычная стирка: 1 капсула (3–5 кг)"
    вместо сырого str(dict), который раньше попадал в разметку как есть.
    """
    if not isinstance(d, dict):
        return str(d).strip()
    label  = (d.get("type") or "").strip()
    amount = (d.get("amount") or "").strip()
    weight = (d.get("weight") or "").strip()
    s = f"{label}: {amount}" if label and amount else (label or amount)
    if weight:
        s = f"{s} ({weight})" if s else weight
    return s.strip()


def _fmt_ingredient_item(i):
    """
    ingredients в базе — список объектов {name, percentage} (не строк).
    Собирает как "Анионные ПАВ (87%)" вместо сырого str(dict).
    """
    if not isinstance(i, dict):
        return str(i).strip()
    name = (i.get("name") or "").strip()
    pct  = (i.get("percentage") or "").strip()
    if name and pct:
        return f"{name} ({pct})"
    return name or pct


def build_product_schema(lang, product):
    """
    @graph для страницы товара /products/{cat}/{slug}:
      - Product          — полная карточка: изображения, бренд, sku/mpn, категория,
                            offers (если есть цена), доп. характеристики (объём,
                            число стирок, дозировка, ноты аромата, состав)
      - BreadcrumbList    — Home → Catalog → Категория(EN) → Товар, повторяет то,
                            что реально показано в шапке страницы товара

    Вызывается только когда product['schemaJsonLd'] из Firestore пустой
    (см. gen_products). Если админ заполнит поле вручную — не вызывается.

    Товар всегда остаётся типом "Product" (в отличие от каталога/категории,
    где безценовые товары понижаются до Thing) — это его единственная роль
    на этой странице. Если цены нет, "offers" просто не добавляется: страница
    не будет участвовать в товарном rich-сниппете Google, пока цена не
    появится в базе, но сама разметка остаётся валидной.
    """
    product_url  = f"{BASE_URL}/{lang}/products/{product.get('_cat_slug') or 'products'}/{product.get('_slug') or ''}"
    category_url = f"{BASE_URL}/{lang}/products/{product.get('_cat_slug')}" if product.get("_cat_slug") else None
    category_name = product.get("categoryLabelEn") or product.get("categoryLabel") or ""

    images = product.get("imageUrls") or ([product["firstImage"]] if product.get("firstImage") else [])
    description = (
        product.get("shortDescription")
        or product.get("metaDescription")
        or _strip_html(product.get("fullDescription") or "")
    )

    node = {
        "@type": "Product",
        "@id": f"{product_url}#product",
        "name": product.get("name") or "",
        "url": product_url,
        "brand": {"@type": "Brand", "name": "RAKUN"},
    }
    if images:
        node["image"] = images
    if description:
        node["description"] = description
    if product.get("sku"):
        node["sku"] = product["sku"]
        node["mpn"] = product["sku"]  # нет GTIN в базе — sku как mpn (вместе с brand это валидный идентификатор товара для Google)
    if category_name:
        node["category"] = category_name

    # ── доп. характеристики — то, чего нет в стандартных полях Product,
    # но что реально влияет на выбор товара покупателем ──
    additional = []
    if product.get("weightVolume"):
        additional.append({"@type": "PropertyValue", "name": "Volume", "value": product["weightVolume"]})
    if product.get("washes"):
        additional.append({"@type": "PropertyValue", "name": "Washes", "value": str(product["washes"])})
    dosage = product.get("dosage")
    if dosage:
        items = dosage if isinstance(dosage, list) else [dosage]
        dosage_val = "; ".join(filter(None, (_fmt_dosage_item(d) for d in items)))
        if dosage_val:
            additional.append({"@type": "PropertyValue", "name": "Dosage", "value": dosage_val})
    scent = product.get("scentNotes") or {}
    scent_parts = [scent.get(k) for k in ("top", "middle", "base") if scent.get(k)]
    if scent_parts:
        additional.append({"@type": "PropertyValue", "name": "Scent notes", "value": ", ".join(scent_parts)})
    ingredients = product.get("ingredients")
    if ingredients:
        items = ingredients if isinstance(ingredients, list) else [ingredients]
        ing_val = "; ".join(filter(None, (_fmt_ingredient_item(i) for i in items)))
        if ing_val:
            additional.append({"@type": "PropertyValue", "name": "Ingredients", "value": ing_val})
    if additional:
        node["additionalProperty"] = additional

    price = (product.get("price") or "").strip()
    if price:
        stock = product.get("stock")
        availability = "https://schema.org/OutOfStock" if stock == 0 else "https://schema.org/InStock"
        node["offers"] = {
            "@type": "Offer",
            "url": product_url,
            "priceCurrency": "GEL",
            "price": price,
            "availability": availability,
            "itemCondition": "https://schema.org/NewCondition",
        }

    crumbs = [
        (_BREADCRUMB_LABELS["home"], f"{BASE_URL}/{lang}"),
        (_BREADCRUMB_LABELS["catalog"], f"{BASE_URL}/{lang}/catalog"),
    ]
    if category_url and category_name:
        crumbs.append((category_name, category_url))
    crumbs.append((product.get("name") or "", product_url))
    breadcrumb = build_breadcrumb(product_url, crumbs)

    return {"@context": "https://schema.org", "@graph": [node, breadcrumb]}


# Грузия не переходит на летнее время — офсет +04:00 постоянный весь год.
_TBILISI_TZ = "+04:00"


def _parse_date(value):
    """publishDate в базе — свободный текст ('March 29, 2026'), а не Timestamp.
    Google требует полный ISO 8601 с часовым поясом (иначе 'недопустимое
    значение даты/времени' + 'не указан часовой пояс'), поэтому всегда
    возвращаем дату с временем 00:00:00 и офсетом Тбилиси. Если распарсить
    не удалось — возвращаем '' и просто не добавляем поле (лучше отсутствие,
    чем мусор)."""
    if not value:
        return ""
    if hasattr(value, "isoformat"):
        try:
            if getattr(value, "tzinfo", None):
                return value.isoformat()
            return value.strftime("%Y-%m-%dT%H:%M:%S") + _TBILISI_TZ
        except Exception:
            pass
    s = str(value).strip()
    for fmt in ("%B %d, %Y", "%d %B %Y", "%Y-%m-%d", "%d.%m.%Y", "%m/%d/%Y"):
        try:
            return datetime.strptime(s, fmt).strftime("%Y-%m-%dT00:00:00") + _TBILISI_TZ
        except ValueError:
            continue
    return ""


def build_about_schema(lang, page):
    """
    @graph для страницы /about:
      - AboutPage  — mainEntity ссылается на ту же Organization, что и на
                     главной (общий @id), чтобы Google не путал сущности
      - BreadcrumbList — Home → <About Us>, с локализованной подписью,
                     как и на самой странице (см. ui_breadcrumb в tpl_about.html)
    """
    page_url = f"{BASE_URL}/{lang}/about"
    page_id  = f"{page_url}#webpage"
    description = page.get("metaDescription") or _strip_html(page.get("introContentHtml") or "")

    node = {
        "@type": "AboutPage",
        "@id": page_id,
        "url": page_url,
        "name": page.get("seoTitle") or "RAKUN — About Us",
        "inLanguage": lang,
        "isPartOf": {"@id": f"{BASE_URL}/#website"},
        "mainEntity": {"@id": f"{BASE_URL}/#organization"},
    }
    if description:
        node["description"] = description
    image = page.get("ogImageUrl") or page.get("heroImageUrl")
    if image:
        node["primaryImageOfPage"] = {"@type": "ImageObject", "url": image}

    label = _ABOUT_BREADCRUMB_LABEL.get(lang, _ABOUT_BREADCRUMB_LABEL["en"])
    breadcrumb = build_breadcrumb(page_url, [
        (_BREADCRUMB_LABELS["home"], f"{BASE_URL}/{lang}"),
        (label, page_url),
    ])

    return {"@context": "https://schema.org", "@graph": [node, breadcrumb]}


def build_contacts_schema(lang, page, stores):
    """
    @graph для страницы /contacts:
      - ContactPage    — about: та же Organization, что на главной
      - BreadcrumbList — Home → Contacts
      - ItemList       — розничные точки, где продаётся RAKUN (Store, не
                         собственные адреса компании — см. предыдущее
                         обсуждение: contacts.stores это партнёрская розница)
      - FAQPage        — из блока FAQ на странице, если он заполнен
    """
    page_url = f"{BASE_URL}/{lang}/contacts"
    page_id  = f"{page_url}#webpage"

    node = {
        "@type": "ContactPage",
        "@id": page_id,
        "url": page_url,
        "name": page.get("seoTitle") or "RAKUN — Contacts",
        "inLanguage": lang,
        "isPartOf": {"@id": f"{BASE_URL}/#website"},
        "about": {"@id": f"{BASE_URL}/#organization"},
    }
    if page.get("metaDescription"):
        node["description"] = page["metaDescription"]

    breadcrumb = build_breadcrumb(page_url, [
        (_BREADCRUMB_LABELS["home"], f"{BASE_URL}/{lang}"),
        (_BREADCRUMB_LABELS["contacts"], page_url),
    ])

    graph = [node, breadcrumb]

    valid_stores = [s for s in (stores or []) if (s.get("address") or "").strip().lower() not in {"", "coming soon", "tba", "n/a"}]
    if valid_stores:
        store_list = {"@type": "ItemList", "@id": f"{page_url}#stores", "name": "RAKUN retail points", "itemListElement": []}
        for i, s in enumerate(valid_stores, start=1):
            store_node = {"@type": "Store", "name": s.get("name") or "RAKUN"}
            addr = {"@type": "PostalAddress", "streetAddress": s["address"]}
            if s.get("country"):
                addr["addressCountry"] = s["country"]
            store_node["address"] = addr
            if s.get("phone"):
                store_node["telephone"] = s["phone"]
            if s.get("hours"):
                store_node["openingHours"] = s["hours"]
            if s.get("mapsLink"):
                store_node["hasMap"] = s["mapsLink"]
                store_node["url"] = s["mapsLink"]
            store_list["itemListElement"].append({"@type": "ListItem", "position": i, "item": store_node})
        graph.append(store_list)

    faq_items = [f for f in (page.get("faq") or []) if (f.get("q") or "").strip() and (f.get("a") or "").strip()]
    if faq_items:
        faq_page = {
            "@type": "FAQPage",
            "@id": f"{page_url}#faq",
            "mainEntity": [
                {
                    "@type": "Question",
                    "name": _strip_html(f["q"]),
                    "acceptedAnswer": {"@type": "Answer", "text": _strip_html(f["a"])},
                }
                for f in faq_items
            ],
        }
        graph.append(faq_page)

    return {"@context": "https://schema.org", "@graph": graph}


def _author_node(post, post_url):
    """
    Собирает Person для author. Отдельной страницы автора на сайте нет, поэтому
    url — якорь на блок с био автора на самой странице поста (это честно
    отражает, где реально показана информация об авторе, и закрывает
    предупреждение Google об отсутствующем необязательном поле "url").
    """
    author_name = (post.get("authorName") or "").strip()
    if not author_name:
        return {"@id": f"{BASE_URL}/#organization"}
    author = {"@type": "Person", "name": author_name, "url": f"{post_url}#author"}
    if post.get("authorRole"):
        author["jobTitle"] = post["authorRole"]
    return author


def build_blog_schema(lang, page, posts):
    """
    @graph для страницы /blog:
      - Blog           — сама страница блога
      - BreadcrumbList — Home → Blog
      - blogPost[]      — краткие BlogPosting-заглушки на каждый опубликованный
                         пост (полная разметка — на самой странице поста,
                         см. build_post_schema)
    """
    page_url = f"{BASE_URL}/{lang}/blog"
    page_id  = f"{page_url}#webpage"

    node = {
        "@type": "Blog",
        "@id": page_id,
        "url": page_url,
        "name": page.get("seoTitle") or "RAKUN Blog",
        "inLanguage": lang,
        "isPartOf": {"@id": f"{BASE_URL}/#website"},
        "publisher": {"@id": f"{BASE_URL}/#organization"},
    }
    if page.get("metaDescription"):
        node["description"] = page["metaDescription"]

    breadcrumb = build_breadcrumb(page_url, [
        (_BREADCRUMB_LABELS["home"], f"{BASE_URL}/{lang}"),
        (_BREADCRUMB_LABELS["blog"], page_url),
    ])

    graph = [node, breadcrumb]

    listed = [p for p in posts if p.get("cardTitle") or p.get("name")][:20]
    if listed:
        blog_posts = []
        for p in listed:
            post_url = f"{BASE_URL}/{lang}/blog/{p.get('_slug') or ''}"
            bp = {"@type": "BlogPosting", "headline": p.get("cardTitle") or p.get("name") or "", "url": post_url}
            image = p.get("firstImage") or p.get("ogImageUrl")
            if image:
                bp["image"] = image
            if p.get("cardDescription"):
                bp["description"] = p["cardDescription"]
            bp["author"] = _author_node(p, post_url)
            date_published = _parse_date(p.get("publishDate"))
            if date_published:
                bp["datePublished"] = date_published
            blog_posts.append(bp)
        node["blogPost"] = blog_posts

    return {"@context": "https://schema.org", "@graph": graph}


def build_post_schema(lang, post):
    """
    @graph для страницы поста /blog/{slug}:
      - BlogPosting    — headline, картинки, автор, дата, категория, теги
      - BreadcrumbList — Home → Blog → <заголовок поста>
    """
    post_url = f"{BASE_URL}/{lang}/blog/{post.get('_slug') or ''}"
    post_id  = f"{post_url}#article"
    headline = (post.get("cardTitle") or post.get("name") or "").strip()

    images = post.get("mediaUrls") or ([post["firstImage"]] if post.get("firstImage") else [])
    description = (
        post.get("cardDescription")
        or post.get("metaDescription")
        or _strip_html(post.get("mainPageContentHtml") or "")
    )

    node = {
        "@type": "BlogPosting",
        "@id": post_id,
        "headline": headline[:110],  # Google рекомендует не длиннее ~110 символов
        "url": post_url,
        "mainEntityOfPage": {"@type": "WebPage", "@id": post_url},
        "inLanguage": lang,
        "publisher": {"@id": f"{BASE_URL}/#organization"},
    }
    if images:
        node["image"] = images
    if description:
        node["description"] = description

    date_published = _parse_date(post.get("publishDate"))
    if date_published:
        node["datePublished"] = date_published
        node["dateModified"] = date_published  # отдельной даты редактирования в базе нет

    node["author"] = _author_node(post, post_url)

    if post.get("categoryLabel"):
        node["articleSection"] = post["categoryLabel"]
    tags = post.get("tags")
    if tags:
        node["keywords"] = ", ".join(str(t) for t in tags) if isinstance(tags, list) else str(tags)
    if post.get("readTime"):
        node["timeRequired"] = f"PT{post['readTime']}M"  # ISO 8601 duration

    breadcrumb = build_breadcrumb(post_url, [
        (_BREADCRUMB_LABELS["home"], f"{BASE_URL}/{lang}"),
        (_BREADCRUMB_LABELS["blog"], f"{BASE_URL}/{lang}/blog"),
        (headline, post_url),
    ])

    return {"@context": "https://schema.org", "@graph": [node, breadcrumb]}


# ── Firestore loader ───────────────────────────────────────────

def load_firestore():
    print("\n--- Firestore ---")
    data = {}

    for key in ["products", "categories"]:
        # Категории проверяем по корневому полю status (не в globalFields)
        live_fn = is_live_cat if key == "categories" else is_live
        docs = [
            d.to_dict() | {"_id": d.id}
            for d in db.collection(key).stream()
            if live_fn(d.to_dict())
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
    for page_id in ["home", "catalog", "contacts", "blog", "about"]:
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
            bg_mobile = s.get("mobileBackgroundImageUrl") or s.get("mobileBgImage") or ""
            btn_text = s.get("buttonText") or s.get("btnText") or ""
            btn_url  = s.get("buttonLink")  or s.get("btnUrl")  or ""
            if bg or s.get("headline"):
                slides.append({
                    "bgImage":       bg,
                    "mobileBgImage": bg_mobile,
                    "subtitle":    s.get("subtitle", ""),
                    "headline":    s.get("headline", ""),
                    "description": s.get("description", ""),
                    "btnText":     btn_text,
                    "btnUrl":      btn_url,
                    "btnSubtext":  s.get("buttonSubtext") or s.get("btnSubtext") or "",
                    "btn2Text":    s.get("button2Text")   or s.get("btn2Text")   or "",
                    "btn2Url":     s.get("button2Link")   or s.get("btn2Url")    or "",
                    "btn2Subtext": s.get("button2Subtext") or s.get("btn2Subtext") or "",
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
            "instagramLink":   contacts_gf.get("instagramLink")  or "",
            "facebookLink":    contacts_gf.get("facebookLink")   or "",
            "stores":          with_maps_links(contacts_gf.get("stores") or []),
        }
        reviews_section = {
            "label": home_lo.get("reviewsLabel") or home_gf.get("reviewsLabel") or "",
            "title": home_lo.get("reviewsTitle") or home_gf.get("reviewsTitle") or "",
        }

        # ── Partners (strip "Нас выбирают лидеры ритейла") ─────────
        raw_partners = (
            home_lo.get("partners")
            or home_gf.get("partners")
            or []
        )
        partners = [
            {
                "name":    p.get("name", ""),
                "logoUrl": p.get("logoUrl", ""),
                "link":    p.get("link", ""),
            }
            for p in raw_partners
            if p.get("logoUrl")
        ]
        partners_section_label = (
            home_lo.get("partnersLabel")
            or home_gf.get("partnersLabel")
            or ""
        )
        partners_section = {"label": partners_section_label} if (partners or partners_section_label) else None

        # ── Promo Banner ────────────────────────────────────────────
        raw_pb = (
            home_lo.get("promoBanner")
            or home_gf.get("promoBanner")
            or {}
        )
        promo_banner = {
            "headline":    raw_pb.get("headline", ""),
            "description": raw_pb.get("description", ""),
            "bgImageUrl":  raw_pb.get("bgImageUrl", ""),
            "imageUrl":    raw_pb.get("imageUrl", ""),
            "btn1Text":    raw_pb.get("btn1Text", ""),
            "btn1Url":     raw_pb.get("btn1Url", ""),
            "btn2Text":    raw_pb.get("btn2Text", ""),
            "btn2Url":     raw_pb.get("btn2Url", ""),
        } if raw_pb else None

        # ── Schema.org: если поле не заполнено вручную в админке — генерируем сами ──
        if not page["schemaOrg"]:
            page["schemaOrg"] = json.dumps(
                build_home_schema(lang, page, contacts, reviews, products),
                ensure_ascii=False,
            )

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
            partners=partners,
            partners_section=partners_section,
            promo_banner=promo_banner,
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
            # Категории не используют globalFields — slug/color/status лежат в корне документа
            if (cat_raw.get("status") or "").strip().lower() != "active":
                continue
            cat_lo2  = loc(cat_raw, lang)
            cat_id   = cat_raw.get("id") or cat_raw.get("_id") or ""
            cat_slug = slugify(cat_id)
            cat_name = cat_lo2.get("name") or cat_id
            if cat_slug:
                categories.append({
                    "slug":        cat_slug,                                   # внутренний id-слаг — для data-cat/JS
                    "urlSlug":     cat_slug,      # = categoryId, как и в URL товара /products/{categoryId}/{slug}
                    "name":        cat_name,
                    "accentColor": cat_raw.get("color") or "",
                })

        products = [extract(p, lang) for p in published]
        # Skip products with no translated name — they show as empty cards
        products = [p for p in products if p.get("name", "").strip()]
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


        # ── Schema.org: если поле не заполнено вручную в админке — генерируем сами ──
        if not page["schemaOrg"]:
            page["schemaOrg"] = json.dumps(
                build_catalog_schema(lang, page, categories, products),
                ensure_ascii=False,
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


def gen_categories(data):
    """
    Отдельные SEO-страницы для категорий: /{lang}/products/{slug}
    (на уровень выше карточки товара /{lang}/products/{slug}/{productSlug}).
    Используют translations.{lang}.{name, description, seoTitle, seoDescription,
    metaDescription, ogTitle, ogDescription, ogImageUrl, schemaJsonLd, regionHreflang}
    и корневые поля color/id/slug/status категории (без globalFields —
    структура категорий отличается от products/pages).
    """
    print("--- Categories ---")
    sitemap_entries = []

    # Публикуем страницу только для категорий со статусом Active —
    # черновики/скрытые категории своих SEO-страниц не получают.
    active_categories = [
        c for c in data["categories"]
        if (c.get("status") or "").strip().lower() == "active"
    ]

    published = [p for p in data["products"]
                 if (gf(p).get("status") or "").lower() == "published"]

    for lang in SUPPORTED_LANGS:

        # Количество опубликованных товаров на категорию (для счётчиков в фильтре,
        # идентично логике на странице каталога tpl_catalog.html)
        cat_counts = {}
        for p in published:
            cs = p.get("_cat_slug") or ""
            if cs:
                cat_counts[cs] = cat_counts.get(cs, 0) + 1

        # Лёгкий список всех активных категорий на этом языке — используется
        # для блока "другие категории" (внутренние ссылки + обход для индексации)
        cats_for_lang = []
        for c in active_categories:
            c_id = c.get("id") or c.get("_id") or ""
            if not c_id:
                continue
            c_lo = loc(c, lang)
            c_slug = slugify(c_id)
            cats_for_lang.append({
                "id":    c_id,
                "slug":  c_slug,
                "name":  c_lo.get("name") or c_id,
                "color": c.get("color") or "",
                "count": cat_counts.get(c_slug, 0),
            })

        for c_raw in active_categories:
            c_id = c_raw.get("id") or c_raw.get("_id") or ""
            if not c_id:
                continue
            c_lo      = loc(c_raw, lang)
            # URL = categoryId (как у товара /products/{categoryId}/{slug}), а не поле
            # "slug" документа категории — иначе адрес не совпадёт с уже проиндексированными
            # ссылками на товары и иерархия /products/{cat}/{product} развалится.
            cat_id_slug = slugify(c_id)
            cat_slug    = cat_id_slug
            cat_name    = c_lo.get("name") or c_id

            cat_products = [
                extract(p, lang) for p in published
            ]
            cat_products = [
                p for p in cat_products
                if p.get("name", "").strip() and p["_cat_slug"] == cat_id_slug
            ]
            cat_products.sort(key=lambda x: x["name"].lower())

            # regionHreflang хранится по аналогии с товарами/постами — отдельной
            # строкой в каждом переводе ("en" -> "en-GE" и т.п.), а не общей картой.
            region_map = {
                l: loc(c_raw, l).get("regionHreflang")
                for l in SUPPORTED_LANGS if loc(c_raw, l).get("regionHreflang")
            }

            # English name for breadcrumbs (same across all language versions)
            c_lo_en   = loc(c_raw, "en")
            cat_name_en = c_lo_en.get("name") or c_id

            page = {
                "name":            cat_name,
                "nameEn":          cat_name_en,
                "description":     c_lo.get("description") or "",
                "seoTitle":        c_lo.get("seoTitle") or "",
                "metaDescription": c_lo.get("metaDescription") or c_lo.get("seoDescription") or "",
                "ogTitle":         c_lo.get("ogTitle")       or c_lo.get("seoTitle") or "",
                "ogDescription":   c_lo.get("ogDescription") or c_lo.get("seoDescription") or c_lo.get("metaDescription") or "",
                "ogImageUrl":      c_lo.get("ogImageUrl")    or "",
                "schemaOrg":       c_lo.get("schemaJsonLd")  or "",
                "color":           c_raw.get("color") or "",
                "slug":            cat_slug,
                "xDefaultHreflang":  c_raw.get("xDefaultHreflang") or "en",
                "regionHreflangMap": region_map,
            }

            # Features and volumes from products in this category (same logic as gen_catalog)
            seen_features = {}
            for p in cat_products:
                for pill in (p.get("features") or []):
                    slug_feat = re.sub(r"[^a-z0-9]+", "-", pill.lower()).strip("-")
                    if slug_feat and slug_feat not in seen_features:
                        seen_features[slug_feat] = pill
            all_features = [{"slug": s, "label": l} for s, l in seen_features.items()]

            def _vol_sort_key(slug):
                import re as _re
                nums = _re.findall(r"[\d.]+", slug)
                val = float(nums[0]) if nums else 0
                if "l" in slug and "ml" not in slug:
                    val *= 1000
                return val

            seen_volumes = {}
            for p in cat_products:
                for vol_slug in (p.get("_volume_tags") or []):
                    if vol_slug not in seen_volumes:
                        import re as _re
                        m2 = _re.match(r"^([\d.]+)(ml|l)$", vol_slug)
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

            siblings = [c for c in cats_for_lang if c["id"] != c_id]

            # ── Schema.org: если поле не заполнено вручную в админке — генерируем сами ──
            if not page["schemaOrg"]:
                page["schemaOrg"] = json.dumps(
                    build_category_schema(lang, page, cat_products),
                    ensure_ascii=False,
                )

            html = T["category"].render(
                lang=lang,
                page=page,
                products=cat_products,
                siblings=siblings,
                all_features=all_features,
                all_volumes=all_volumes,
            )

            write(f"{OUTPUT_DIR}/{lang}/products/{cat_slug}.html", html)

            if lang == SUPPORTED_LANGS[0]:
                sitemap_entries.append({
                    "slug":             cat_slug,
                    "type":             "category_index",
                    "cat":              cat_slug,
                    "lastmod":          str(date.today()),
                    "changefreq":       "weekly",
                    "priority":         "0.7",
                    "xDefaultHreflang":  c_raw.get("xDefaultHreflang") or "en",
                    "regionHreflangMap": region_map,
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

    # Английские названия категорий для хлебных крошек — одинаковые на всех
    # языковых версиях страницы товара (по требованию: категория в breadcrumb
    # всегда на английском, независимо от текущего языка страницы).
    cat_name_en_by_slug = {}
    for c in data["categories"]:
        c_id = c.get("id") or c.get("_id") or ""
        if not c_id:
            continue
        cat_name_en_by_slug[slugify(c_id)] = loc(c, "en").get("name") or c_id

    for lang in SUPPORTED_LANGS:

        for raw in published:
            product = extract(raw, lang)
            slug    = product["_slug"]
            if not slug:
                continue

            product["categoryLabelEn"] = (
                cat_name_en_by_slug.get(product["_cat_slug"])
                or product.get("categoryLabel")
                or product["_cat_slug"]
            )

            related = [
                extract(p, lang)
                for p in published
                if p.get("_id") != raw.get("_id")
                and (gf(p).get("categoryId") or "") == (gf(raw).get("categoryId") or "")
            ][:4]
            if not related:
                related = [extract(p, lang) for p in published if p.get("_id") != raw.get("_id")][:4]

            # ── Schema.org: если поле не заполнено вручную в админке — генерируем сами ──
            if not product["schemaJsonLd"]:
                product["schemaJsonLd"] = json.dumps(
                    build_product_schema(lang, product),
                    ensure_ascii=False,
                )

            # Build hreflang_map: {lang: regionHreflang or lang} for all supported langs
            hreflang_map = {}
            for l in SUPPORTED_LANGS:
                rh = loc(raw, l).get("regionHreflang") or ""
                hreflang_map[l] = rh if rh else l

            html = T["product"].render(
                lang=lang,
                product=product,
                related=related,
                hreflang_map=hreflang_map,
            )

            cat  = product["_cat_slug"]
            path = f"{OUTPUT_DIR}/{lang}/products/{cat}/{slug}.html"
            write(path, html)

            if lang == SUPPORTED_LANGS[0]:
                # Build regionHreflangMap from all language translations
                region_map = {}
                for l in SUPPORTED_LANGS:
                    rh = loc(raw, l).get("regionHreflang") or ""
                    if rh:
                        region_map[l] = rh
                sitemap_entries.append({
                    "slug":           slug,
                    "type":           "product",
                    "cat":            cat,
                    "lastmod":        str(date.today()),
                    "changefreq":     gf(raw).get("changeFrequency") or "monthly",
                    "priority":       str(gf(raw).get("priority") or "0.8"),
                    "xDefaultHreflang":  gf(raw).get("xDefaultHreflang") or "en",
                    "regionHreflangMap": region_map,
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

        # ── Schema.org: если поле не заполнено вручную в админке — генерируем сами ──
        if not page["schemaOrg"]:
            page["schemaOrg"] = json.dumps(
                build_blog_schema(lang, page, posts),
                ensure_ascii=False,
            )

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

            # ── Schema.org: если поле не заполнено вручную в админке — генерируем сами ──
            if not post["schemaJsonLd"]:
                post["schemaJsonLd"] = json.dumps(
                    build_post_schema(lang, post),
                    ensure_ascii=False,
                )

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
                    "regionHreflangMap": {l: loc(raw, l).get("regionHreflang") for l in SUPPORTED_LANGS if loc(raw, l).get("regionHreflang")},
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
            "heroImageUrl":    cont_gf.get("heroImageUrl") or "",

            # "Есть магазин..." promo banner (identical block to About Us)
            "promoBanner":     cont_lo.get("promoBanner") or cont_gf.get("promoBanner") or {},

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

        stores = with_maps_links(cont_gf.get("stores") or contacts_doc.get("stores") or [])

        # ── Schema.org: если поле не заполнено вручную в админке — генерируем сами ──
        if not page["schemaOrg"]:
            page["schemaOrg"] = json.dumps(
                build_contacts_schema(lang, page, stores),
                ensure_ascii=False,
            )

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


def gen_about(data):
    print("--- About ---")
    sitemap_entries = []

    about_doc = data["pages"].get("about", {})
    about_gf  = gf(about_doc)

    for lang in SUPPORTED_LANGS:
        ab_lo = loc(about_doc, lang)
        ab_gf = about_gf

        page = {
            "seoTitle":        ab_lo.get("seoTitle")        or ab_gf.get("seoTitle")        or "",
            "metaDescription": ab_lo.get("metaDescription") or ab_gf.get("metaDescription") or "",
            "ogTitle":         ab_lo.get("ogTitle")         or ab_gf.get("ogTitle")         or "",
            "ogDescription":   ab_lo.get("ogDescription")  or ab_gf.get("ogDescription")  or "",
            "ogImageUrl":      ab_gf.get("ogImageUrl")      or "",

            # Hero (top banner)
            "heroTitle":       ab_lo.get("heroTitle")       or ab_gf.get("heroTitle")       or "",
            "heroDescription": ab_lo.get("heroDescription") or ab_gf.get("heroDescription") or "",
            "heroImageUrl":    ab_gf.get("heroImageUrl")    or ab_gf.get("mainImage")       or "",

            # "Про Rakun" intro section
            "introTitle":       ab_lo.get("introTitle")       or ab_gf.get("introTitle")       or "",
            "introContentHtml": ab_lo.get("introContentHtml") or ab_lo.get("contentHtml")      or ab_gf.get("introContentHtml") or "",
            "introImageUrl":    ab_gf.get("introImageUrl")    or "",

            # "Почему нам доверяют" trust section
            "trustTitle":      ab_lo.get("trustTitle") or ab_gf.get("trustTitle") or "",
            "trustCards":      ab_lo.get("trustCards") or ab_gf.get("trustCards") or [],

            # "Есть магазин..." promo banner
            "promoBanner":     ab_lo.get("promoBanner") or ab_gf.get("promoBanner") or {},

            "mainImage":       ab_gf.get("mainImage")       or "",
            "schema":          ab_lo.get("schema")          or ab_gf.get("schema")          or "",

            "xDefaultHreflang":   ab_gf.get("xDefaultHreflang") or "en",
            "regionHreflangMap":  ab_gf.get("regionHreflangMap") or {},
        }

        # ── Schema.org: если поле не заполнено вручную в админке — генерируем сами ──
        if not page["schema"]:
            page["schema"] = json.dumps(
                build_about_schema(lang, page),
                ensure_ascii=False,
            )

        html = T["about"].render(
            lang=lang,
            page=page,
        )

        write(f"{OUTPUT_DIR}/{lang}/about.html", html)

        if lang == SUPPORTED_LANGS[0]:
            sitemap_entries.append({
                "slug":             "about",
                "type":             "about_index",
                "lastmod":          str(date.today()),
                "changefreq":       "monthly",
                "priority":         "0.6",
                "xDefaultHreflang":  ab_gf.get("xDefaultHreflang") or "en",
                "regionHreflangMap": ab_gf.get("regionHreflangMap") or {},
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
            "pageNotFoundDesc": "The page you are looking for might have been removed, had its name changed, or is temporarily unavailable. Let's get you back on track.",
            "backHome": "Home",
            "viewCatalog": "Catalog"
        },
        "ru": {
            "error404": "404 — Страница не найдена", 
            "errorLabel": "Системная ошибка", 
            "pageNotFound": "Страница не найдена", 
            "pageNotFoundDesc": "Страница, которую вы ищете, возможно, была удалена, переименована или временно недоступна. Давайте вернемся на главную.",
            "backHome": "На главную",
            "viewCatalog": "В каталог"
        },
        "ka": {
            "error404": "404 — გვერდი არ მოიძებნა", 
            "errorLabel": "სისტემური შეცდომა", 
            "pageNotFound": "გვერდი არ მოიძებნა", 
            "pageNotFoundDesc": "გვერდი, რომელსაც ეძებთ, შესაძლოა წაიშალა, სახელი შეეცვალა ან დროებით მიუწვდომელია. დავბრუნდეთ მთავარ გვერდზე.",
            "backHome": "მთავარი გვერდი",
            "viewCatalog": "კატალოგი"
        },
        "hy": {
            "error404": "404 — Էջը չի գտնվել", 
            "errorLabel": "Համակարգի սխալ", 
            "pageNotFound": "Էջը չի գտնվել", 
            "pageNotFoundDesc": "Էջը, որը փնտրում եք, հնարավոր է հեռացվել է, անվանափոխվել է կամ ժամանակավորապես անհասանելի է: Վերադառնանք գլխավոր էջ:",
            "backHome": "Գլխավոր էջ",
            "viewCatalog": "Կատալոգ"
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
            # GitHub Pages auto-serves a literal /404.html at the site root for any
            # unmatched URL (it has no concept of Firebase-style rewrites, so the
            # previous /404/index.html target was never actually reached).
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
    if entry_type == "about_index":
        return f"{base_url}/{lang}/about"
    if entry_type == "category_index":
        return f"{base_url}/{lang}/products/{cat}"
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


def gen_robots():
    """
    robots.txt — генерируется скриптом (не лежит статикой в репозитории),
    чтобы Sitemap-URL всегда совпадал с текущим BASE_URL и не расходился
    вручную. Явно разрешаем основных LLM/AI-краулеров (ChatGPT, Claude,
    Perplexity, Gemini) отдельными правилами — без этого некоторые боты по
    умолчанию не сканируют сайт, даже если общий 'User-agent: *' разрешает.
    """
    print("--- robots.txt ---")
    content = f"""# Эти правила предназначены для всех поисковых роботов.
User-agent: *
Allow: /

# Разрешаем поиск ChatGPT (обязательно!)
User-agent: OAI-SearchBot
Allow: /

User-agent: ChatGPT-User
Allow: /

# Обучение (по желанию)
User-agent: GPTBot
Allow: /

# Разрешаем Perplexity
User-agent: PerplexityBot
Allow: /

# Разрешаем краулер Claude (индексация)
User-agent: ClaudeBot
Allow: /

# Разрешаем прямые переходы из Claude по ссылкам
User-agent: Anthropic-User
Allow: /

# Обучение Google Gemini (по желанию)
User-agent: Google-Extended
Allow: /

# Запретить сканирование админ-панели.
# Это предотвратит индексацию этих страниц и сэкономит краулинговый бюджет.
Disallow: /admin/

# Запретить URL с задвоенными слэшами (баг-паттерн вида /en///products///x —
# см. нормализацию в write() в этом же файле; здесь — дополнительный
# уровень защиты на случай, если какой-то краулер найдёт такую ссылку
# раньше, чем сработает клиентский редирект).
Disallow: /*//

# Указать путь к карте сайта.
Sitemap: {BASE_URL}/sitemap.xml
"""
    write(f"{OUTPUT_DIR}/robots.txt", content)


def gen_llms(data):
    """
    llms.txt (см. https://llmstxt.org/) — карта сайта для LLM-краулеров в
    человекочитаемом Markdown-формате: заголовок + описание + сгруппированные
    по разделам ссылки на все языковые версии каждой страницы. Рендерится
    через tpl_llms.txt в отдельном jinja_text-окружении (без autoescape).
    """
    print("--- llms.txt ---")
    today = str(date.today())

    def _page_item(page_id, lang, url_suffix):
        raw = data["pages"].get(page_id, {})
        g, lo = gf(raw), loc(raw, lang)
        title = lo.get("seoTitle") or g.get("seoTitle") or _nav.get(page_id, page_id.title())
        desc = (lo.get("metaDescription") or g.get("metaDescription") or "").strip()
        return {
            "lang": lang,
            "title": title,
            "url": f"{BASE_URL}/{lang}{url_suffix}",
            "lastModified": today,
            "description": desc,
        }

    pages_group = {}
    for page_id, suffix in [
        ("home", ""), ("catalog", "/catalog"), ("blog", "/blog"),
        ("contacts", "/contacts"), ("about", "/about"),
    ]:
        pages_group[page_id] = [_page_item(page_id, lang, suffix) for lang in SUPPORTED_LANGS]

    active_categories = [
        c for c in data["categories"]
        if (c.get("status") or "").strip().lower() == "active"
    ]
    categories_group = {}
    for c_raw in active_categories:
        c_id = c_raw.get("id") or c_raw.get("_id") or ""
        if not c_id:
            continue
        cat_slug = slugify(c_id)
        items = []
        for lang in SUPPORTED_LANGS:
            c_lo = loc(c_raw, lang)
            items.append({
                "lang": lang,
                "title": c_lo.get("name") or c_id,
                "url": f"{BASE_URL}/{lang}/products/{cat_slug}",
                "lastModified": today,
                "description": (c_lo.get("metaDescription") or c_lo.get("seoDescription") or c_lo.get("description") or "").strip(),
            })
        categories_group[cat_slug] = items

    published_products = [
        p for p in data["products"]
        if (gf(p).get("status") or "").lower() == "published"
    ]
    products_group = {}
    for p_raw in published_products:
        items = []
        for lang in SUPPORTED_LANGS:
            p = extract(p_raw, lang)
            if not p["name"]:
                continue
            items.append({
                "lang": lang,
                "title": p["name"],
                "url": f"{BASE_URL}/{lang}/products/{p['_cat_slug']}/{p['_slug']}",
                "lastModified": today,
                "description": (p["shortDescription"] or p["metaDescription"] or "").strip(),
            })
        if items:
            products_group[p_raw.get("_id") or items[0]["url"]] = items

    published_posts = [
        p for p in data["posts"]
        if (gf(p).get("status") or "").lower() == "published"
    ]
    articles_group = {}
    for post_raw in published_posts:
        items = []
        for lang in SUPPORTED_LANGS:
            post = extract(post_raw, lang)
            title = post["cardTitle"] or post["name"]
            if not title:
                continue
            items.append({
                "lang": lang,
                "title": title,
                "url": f"{BASE_URL}/{lang}/blog/{post['_slug']}",
                "lastModified": today,
                "description": (post["cardDescription"] or post["metaDescription"] or "").strip(),
            })
        if items:
            articles_group[post_raw.get("_id") or items[0]["url"]] = items

    collections = {
        "Pages": pages_group,
        "Categories": categories_group,
        "Products": products_group,
        "Articles": articles_group,
    }

    tpl = jinja_text.get_template("tpl_llms.txt")
    content = tpl.render(base_url=BASE_URL, supported_langs=SUPPORTED_LANGS, collections=collections)
    write(f"{OUTPUT_DIR}/llms.txt", content)


def main():
    if os.path.exists(OUTPUT_DIR):
        shutil.rmtree(OUTPUT_DIR)
    os.makedirs(OUTPUT_DIR)

    gen_root_redirect()

    data = load_firestore()

    sitemap = []
    sitemap += gen_index(data)
    sitemap += gen_catalog(data)
    sitemap += gen_categories(data)
    sitemap += gen_products(data)
    sitemap += gen_blog(data)
    sitemap += gen_posts(data)
    sitemap += gen_contacts(data)
    sitemap += gen_about(data)
    gen_404(data)

    gen_sitemap(sitemap)
    gen_robots()
    gen_llms(data)
    copy_static()

    print("\n" + "=" * 55)
    print("  DONE")
    print("=" * 55)


if __name__ == "__main__":
    main()
