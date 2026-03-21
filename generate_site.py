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
    "README.md", "check_structure.py", "debug_firestore.py",
    # Шаблоны не копируем
    "tpl_index.html","tpl_catalog.html","tpl_product.html",
    "tpl_blog.html","tpl_post.html","tpl_404.html",
    # Старые HTML, которые заменяются шаблонами
    "index.html", "catalog.html", "blog.html", "product.html", "post.html",
    # Старый JS
    "main.js"
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
         for k in ["index","catalog","product","blog","post","404"]}
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


def gf(doc): return doc.get("globalFields") or {}
def loc(doc, lang):
    translations = doc.get("translations") or {}
    return translations.get(lang) or translations.get("en") or doc.get(lang) or doc.get("en") or {}


def extract(doc, lang):
    g  = gf(doc); lo = loc(doc, lang); m = {**g, **lo, "_id": doc.get("_id", ""), "_status": (g.get("status") or "").lower()}
    m["name"] = lo.get("productName") or lo.get("h1") or lo.get("cardTitle") or g.get("productName") or ""
    imgs = g.get("images") or g.get("imageUrls") or lo.get("imageUrls") or []
    m["imageUrls"]  = imgs if isinstance(imgs, list) else ([imgs] if imgs else [])
    m["firstImage"] = m["imageUrls"][0] if m["imageUrls"] else (g.get("ogImageUrl") or "")
    m["shortDescription"] = lo.get("shortDescription") or lo.get("cardDescription") or ""
    m["fullDescription"] = lo.get("fullDescriptionHtml") or lo.get("fullDescription") or ""
    m["features"] = g.get("featurePills") or []
    price_raw = str(g.get("price") or ""); m["priceRaw"] = price_raw; m["price"] = price_raw.replace(" GEL", "").strip()
    m["_cat_slug"] = slugify(g.get("categoryId") or "products"); m["_slug"] = g.get("slug") or doc.get("_id") or ""
    m["ingredients"] = g.get("ingredients") or []; m["descriptionPoints"] = lo.get("descriptionPoints") or []
    return m

def is_live(doc): return (gf(doc).get("status") or "").lower() != "archived"

def write(path, content):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f: f.write(content)
    print(f"  + {path.replace(OUTPUT_DIR+'/', '')}")

def load_firestore():
    print("\n--- Firestore ---")
    data = {}
    for key in ["products", "posts", "categories"]:
        docs = [d.to_dict() | {"_id": d.id} for d in db.collection(key).stream() if is_live(d.to_dict())]
        data[key] = docs
        print(f"  {key}: {len(docs)} docs")
    s = db.collection("settings").document("main").get()
    data["settings"] = (s.to_dict() or {}) if s.exists else {}; data["settings"]["_id"] = "main"
    print("  settings: OK\n")
    return data

def gen_index(data):
    print("--- Index ---")
    # ... Код генерации index.html без изменений ...

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

def copy_static():
    print("--- Copying Static Files (including Admin Panel) ---")
    for name in os.listdir("."):
        if name in COPY_IGNORE or name.startswith("."): continue
        src, dst = f"./{name}", f"{OUTPUT_DIR}/{name}"
        try:
            if os.path.isfile(src): shutil.copy2(src, dst)
            elif os.path.isdir(src): shutil.copytree(src, dst, dirs_exist_ok=True)
        except Exception as e: print(f"  ! {name}: {e}")
    print("  Admin panel files copied.")

def main():
    if os.path.exists(OUTPUT_DIR): shutil.rmtree(OUTPUT_DIR)
    os.makedirs(OUTPUT_DIR)
    data = load_firestore()
    
    # == ЗАКОММЕНТИРОВАННАЯ ГЕНЕРАЦИЯ ПУБЛИЧНЫХ СТРАНИЦ ==
    print("\n[INFO] Public page generation is disabled. Focusing on admin panel.\n")
    # gen_index(data)
    # gen_catalog(data)
    # sitemap = gen_products(data) + gen_blog(data)
    # gen_sitemap(sitemap)
    
    # Копируем статические файлы, включая admin.html, admin.js, admin.css
    copy_static()
    
    print("\n" + "=" * 55)
    print("  DONE: Admin panel copied. Public pages skipped.")
    print("=" * 55)

if __name__ == "__main__":
    main()
