// ============================================================
//  RAKUN Admin Panel — Firebase SPA Controller (v6.0)
//  CHANGELOG v6.0:
//
//  [FIX-8]  Products: Price, Region hreflang, OG Image URL,
//           CTA Link, Secondary Button Link, Scent Notes,
//           Available Volumes, Dosage Guide, Ingredients,
//           Schema JSON-LD are now per-language fields stored
//           inside translations[lang] — NOT in globalFields.
//           globalFields only keeps: status, slug, categoryId,
//           sku, stock, weightVolume, badge, washes, priority,
//           changeFrequency, xDefaultHreflang.
//           images and featurePills are now per-lang (in translations[lang]).
//
//  [FIX-9]  All language panes in product modal now have
//           English section labels (Content, Description Points,
//           CTA Buttons, Card (Catalog listing), Scent Notes,
//           Available Volumes / Variants, Dosage Guide,
//           Ingredients, SEO & Meta).
//
//  [FIX-10] Settings section removed — generate_site.py does
//           not use settings collection data at runtime.
//
//  [FIX-11] Dynamic volume/dosage/ingredient renderers are now
//           lang-scoped: renderProdVolumes(lang, data),
//           renderProdDosage(lang, data), addIngr(lang).
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import {
    getFirestore, enableIndexedDbPersistence,
    collection, onSnapshot, doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, terminate
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import {
    getAuth, setPersistence, browserLocalPersistence,
    onAuthStateChanged, signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

const firebaseConfig = {
    apiKey:            "AIzaSyAGXs4wc4vcxxY2cMoHMC8_M1D95_chSQY",
    authDomain:        "racun-shop.firebaseapp.com",
    projectId:         "racun-shop",
    storageBucket:     "racun-shop.appspot.com",
    messagingSenderId: "569457770232",
    appId:             "1:569457770232:web:5a2737d1ee270459f3050d"
};

const app  = initializeApp(firebaseConfig);
const db   = getFirestore(app);
const auth = getAuth(app);
setPersistence(auth, browserLocalPersistence).catch(() => {});

enableIndexedDbPersistence(db).catch(err => {
    if (err.code === 'failed-precondition') console.warn('Persistence: multiple tabs open');
    else if (err.code === 'unimplemented')  console.warn('Persistence: not supported');
});

window.addEventListener('beforeunload', () => terminate(db).catch(() => {}));

const IS_CONTENT = !!document.getElementById('pn-products');
const IS_PAGES   = !!document.getElementById('pn-page-home');
const LANGS      = ['en', 'ru', 'ka', 'hy'];

// ── Avatar color map ─────────────────────────────────────
const AVATAR_COLORS = {
    blue:   '#3b82f6',
    violet: '#8b5cf6',
    green:  '#10b981',
    amber:  '#f59e0b',
    rose:   '#f43f5e',
    cyan:   '#06b6d4',
};

let state = { categories: [], products: [], posts: [] };
let currentEditingId  = null;
let currentCollection = null;
let selColor          = '#4f7dff';
let pendingDeleteId   = null;
let pendingDeleteCol  = null;
let blogAvatarColor   = 'blue';
let blogTags          = [];
const pagesCache = {};
const pageLangs  = {
    home: 'en', catalog: 'en', 'blog-page': 'en',
    contacts: 'en', about: 'en', 'footer-nav': 'en'
};

// ════════════════════════════════════════════════════════
// 0. UTILITIES
// ════════════════════════════════════════════════════════
function getLocalVal(d, key, lang = 'en') {
    if (!d) return '';
    if (d.translations?.[lang]?.[key] !== undefined) return d.translations[lang][key];
    if (d[lang]?.[key]               !== undefined) return d[lang][key];
    if (d.globalFields?.[key]        !== undefined) return d.globalFields[key];
    return d[key] || '';
}

function getPostTitle(p) {
    for (const lang of LANGS) {
        const h = p.translations?.[lang]?.h1;
        if (h) return h;
    }
    return getLocalVal(p, 'h1', 'en')
        || getLocalVal(p, 'name', 'en')
        || getLocalVal(p, 'title', 'en')
        || 'Untitled';
}

function getPostImage(p) {
    for (const lang of LANGS) {
        const urls = p.translations?.[lang]?.mediaUrls;
        if (Array.isArray(urls) && urls.length) return urls[0];
        if (typeof urls === 'string' && urls) return urls.split(',')[0].trim();
    }
    const imgs = p.globalFields?.images;
    if (Array.isArray(imgs) && imgs.length) return imgs[0];
    return p.globalFields?.ogImageUrl || '';
}

function escH(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function toSlug(s) {
    // Конвертирует название категории в URL-safe ID (латинские строчные + цифры + дефисы).
    // Этот ID становится document ID в Firestore и URL-сегментом: /products/{id}/
    return String(s).trim().toLowerCase()
        .replace(/[\xE0-\xE5]/g,'a').replace(/[\xE8-\xEB]/g,'e')
        .replace(/[\xEC-\xEF]/g,'i').replace(/[\xF2-\xF6\xF8]/g,'o')
        .replace(/[\xF9-\xFC]/g,'u').replace(/[\xFD\xFF]/g,'y')
        .replace(/\xF1/g,'n').replace(/\xE7/g,'c').replace(/\xDF/g,'ss')
        .replace(/[^a-z0-9]+/g,'-')
        .replace(/^-+|-+$/g,'');
}
function getV(id)       { return document.getElementById(id)?.value || ''; }
function setV(id, v)    { const el = document.getElementById(id); if (el) el.value = v ?? ''; }
function setText(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }

function showToast(msg, type = 'ok') {
    let t = document.getElementById('_toast');
    if (!t) {
        t = document.createElement('div'); t.id = '_toast';
        Object.assign(t.style, {
            position:'fixed', bottom:'28px', right:'28px', zIndex:'9999',
            padding:'13px 24px', borderRadius:'10px', fontSize:'14px', fontWeight:'700',
            color:'#fff', boxShadow:'0 4px 24px rgba(0,0,0,.28)',
            transition:'opacity .35s', pointerEvents:'none'
        });
        document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.background = type === 'ok' ? '#22c55e' : '#ef4444';
    t.style.opacity = '1';
    clearTimeout(t._t);
    t._t = setTimeout(() => { t.style.opacity = '0'; }, 3200);
}

// ════════════════════════════════════════════════════════
// 1. DATA LOADING
// ════════════════════════════════════════════════════════
function loadAllData() {
    setV('fb-status', 'Loading…');

    onSnapshot(collection(db, 'categories'), snap => {
        state.categories = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderAll();
        if (state.products.length > 0 || state.posts.length > 0) setV('fb-status', 'Connected ✓');
    }, err => { console.error('categories:', err); showToast('Error: ' + err.message, 'err'); });

    onSnapshot(collection(db, 'products'), snap => {
        state.products = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderAll();
        setV('fb-status', 'Connected ✓');
    }, err => { console.error('products:', err); showToast('Error: ' + err.message, 'err'); });

    onSnapshot(collection(db, 'blog'), snap => {
        state.posts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderAll();
        setV('fb-status', 'Connected ✓');
    }, err => { console.error('blog:', err); showToast('Error: ' + err.message, 'err'); });
}

// ════════════════════════════════════════════════════════
// 2. RENDERING
// ════════════════════════════════════════════════════════
function renderAll() {
    renderCategories();
    renderProducts();
    renderBlog();
}

function renderCategories() {
    setText('bdgc', state.categories.length);
    setText('catcntlbl', state.categories.length + ' categories');
    const tb   = document.getElementById('cattbody');
    const grid = document.getElementById('catgrid');
    const mob  = document.getElementById('catmob');

    const rows = state.categories.map(c => {
        const name   = getLocalVal(c, 'name', 'en') || c.id;
        const slug   = c.slug   || c.globalFields?.slug   || c.id;
        const color  = c.color  || c.globalFields?.color  || '#4f7dff';
        const status = c.status || c.globalFields?.status || 'Active';
        const cnt    = state.products.filter(p => p.globalFields?.categoryId === c.id).length;
        return { c, name, slug, color, status, cnt };
    });

    if (tb) tb.innerHTML = rows.map(({ c, name, slug, color, status, cnt }) => `<tr>
      <td><div style="display:flex;align-items:center;gap:10px">
        <div style="width:10px;height:10px;border-radius:50%;background:${color};flex-shrink:0"></div>
        <strong>${escH(name)}</strong></div></td>
      <td style="font-family:'IBM Plex Mono',monospace;font-size:12px;color:var(--text2)">${escH(slug)}</td>
      <td>${cnt}</td>
      <td><div class="lf">${LANGS.map(l => `<span class="lfl d">${l.toUpperCase()}</span>`).join('')}</div></td>
      <td><span class="sb2 ${status === 'Active' ? 'sp' : 'sa'}">${escH(status)}</span></td>
      <td style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--text2)">/en/products/${escH(slug)}/</td>
      <td><div class="ra">
        <button class="ib" onclick="window._editCat('${c.id}')"><span class="material-symbols-outlined ic">edit</span></button>
        <button class="ib dr" onclick="window._askDelete('categories','${c.id}')"><span class="material-symbols-outlined ic">delete</span></button>
      </div></td>
    </tr>`).join('');

    if (grid) grid.innerHTML = rows.map(({ c, name, slug, color, status, cnt }) =>
        `<div class="cc">
          <div class="cdot" style="background:${color}"></div>
          <div class="ci2"><div class="cn">${escH(name)}</div><div class="csl">/${escH(slug)}/</div>
          <div class="cct">${cnt} product${cnt !== 1 ? 's' : ''} · ${status}</div></div>
          <div class="ca"><button class="ib" onclick="window._editCat('${c.id}')"><span class="material-symbols-outlined ic">edit</span></button></div>
        </div>`).join('');

    if (mob) mob.innerHTML = rows.map(({ c, name, slug, color, status, cnt }) =>
        `<div class="mc">
          <div class="mct">
            <div style="display:flex;align-items:center;gap:8px">
              <div style="width:10px;height:10px;border-radius:50%;background:${color};flex-shrink:0"></div>
              <div class="mcn">${escH(name)}</div>
            </div>
            <span class="sb2 ${status === 'Active' ? 'sp' : 'sa'}">${escH(status)}</span>
          </div>
          <div class="mcd">/${escH(slug)}/ · ${cnt} product${cnt !== 1 ? 's' : ''}</div>
          <div class="mca">
            <button class="ib" onclick="window._editCat('${c.id}')"><span class="material-symbols-outlined ic">edit</span></button>
            <button class="ib dr" onclick="window._askDelete('categories','${c.id}')"><span class="material-symbols-outlined ic">delete</span></button>
          </div>
        </div>`).join('');

    ['prodcatsel', 'pf-cat'].forEach(id => {
        const sel = document.getElementById(id); if (!sel) return;
        const prev = sel.value;
        const pre  = id === 'pf-cat' ? '<option value="">All categories</option>' : '';
        sel.innerHTML = pre + state.categories.map(c => {
            // Показываем "id — Name" чтобы было видно и URL-сегмент и человекочитаемое название
            const name = getLocalVal(c, 'name', 'en') || c.id;
            return `<option value="${c.id}"${c.id === prev ? ' selected' : ''}>${escH(c.id)} — ${escH(name)}</option>`;
        }).join('');
    });
}

function renderProducts() {
    setText('bdgp', state.products.length);
    const tb  = document.getElementById('products-tbody');
    const mob = document.getElementById('products-mob');
    if (!tb && !mob) return;

    const q  = getV('search-products').toLowerCase();
    const fc = getV('pf-cat');
    const fs = getV('pf-prod-status');

    const list = state.products.filter(p => {
        const name = (getLocalVal(p, 'productName', 'en') || getLocalVal(p, 'name', 'en') || '').toLowerCase();
        const cat  = p.globalFields?.categoryId || '';
        const st   = p.globalFields?.status     || '';
        return (!q || name.includes(q)) && (!fc || cat === fc) && (!fs || st === fs);
    }).map(p => {
        const name    = getLocalVal(p, 'productName', 'en') || getLocalVal(p, 'name', 'en') || 'Unnamed';
        const catObj  = state.categories.find(c => c.id === p.globalFields?.categoryId);
        const catName = catObj ? (getLocalVal(catObj, 'name', 'en') || catObj.id) : '—';
        const catSlug = catObj?.slug || catObj?.globalFields?.slug || 'category';
        // Price is now per-lang: read from EN translation first
        const price   = p.translations?.en?.price || p.globalFields?.price || '—';
        const status  = p.globalFields?.status || 'Draft';
        const slug    = p.globalFields?.slug   || p.id;
        const img     = p.translations?.en?.images?.[0] || p.translations?.ru?.images?.[0] || p.globalFields?.images?.[0] || '';
        return { p, name, catName, catSlug, price, status, slug, img };
    });

    if (tb) tb.innerHTML = list.map(({ p, name, catName, catSlug, price, status, slug, img }) => `<tr>
      <td><div class="pnc">
        <img src="${escH(img)}" class="pth" style="object-fit:contain" onerror="this.onerror=null;this.style.cssText='background:#2d3148;width:44px;height:44px;border-radius:6px;flex-shrink:0';this.removeAttribute('src')">
        <div class="pni"><div class="pnm">${escH(name)}</div><div class="pcm">${p.id}</div></div>
      </div></td>
      <td>${escH(catName)}</td>
      <td><strong>${escH(String(price))}</strong></td>
      <td><div class="lf">${LANGS.map(l => `<span class="lfl d">${l.toUpperCase()}</span>`).join('')}</div></td>
      <td><span class="sb2 ${status.toLowerCase() === 'published' ? 'sp' : 'sa'}">${escH(status)}</span></td>
      <td style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--text2)">/en/products/${escH(catSlug)}/${escH(slug)}/</td>
      <td><div class="ra">
        <button class="ib" onclick="window._editProd('${p.id}')"><span class="material-symbols-outlined ic">edit</span></button>
        <button class="ib dr" onclick="window._askDelete('products','${p.id}')"><span class="material-symbols-outlined ic">delete</span></button>
      </div></td>
    </tr>`).join('');

    if (mob) mob.innerHTML = list.map(({ p, name, catName, price, status, img }) =>
        `<div class="mc">
          <div class="mct">
            <div class="pnc" style="gap:10px">
              <img src="${escH(img)}" style="width:44px;height:44px;border-radius:6px;object-fit:contain;flex-shrink:0" onerror="this.onerror=null;this.style.background='#2d3148';this.removeAttribute('src')">
              <div class="pni"><div class="pnm">${escH(name)}</div><div class="pcm">${escH(catName)}</div></div>
            </div>
            <span class="sb2 ${status.toLowerCase() === 'published' ? 'sp' : 'sa'}">${escH(status)}</span>
          </div>
          <div class="mcd"><strong>${escH(String(price))}</strong></div>
          <div class="mca">
            <button class="ib" onclick="window._editProd('${p.id}')"><span class="material-symbols-outlined ic">edit</span></button>
            <button class="ib dr" onclick="window._askDelete('products','${p.id}')"><span class="material-symbols-outlined ic">delete</span></button>
          </div>
        </div>`).join('');
}

function renderBlog() {
    setText('bdgb', state.posts.length);
    const tb  = document.getElementById('blog-tbody');
    const mob = document.getElementById('blog-mob');
    if (!tb && !mob) return;

    const q  = getV('search-blog').toLowerCase();
    const fs = getV('pf-blog-status');

    const list = state.posts.filter(p => {
        const title = (getPostTitle(p)).toLowerCase();
        const st    = p.globalFields?.status || '';
        return (!q || title.includes(q)) && (!fs || st === fs);
    }).map(p => {
        const title  = getPostTitle(p);
        const img    = getPostImage(p);
        const cat    = p.globalFields?.category   || '—';
        const author = p.globalFields?.authorName || '—';
        const status = p.globalFields?.status     || 'Draft';
        const slug   = p.globalFields?.slug       || p.id;
        return { p, title, img, cat, author, status, slug };
    });

    if (tb) tb.innerHTML = list.map(({ p, title, img, cat, author, status, slug }) => `<tr>
      <td><div class="pnc">
        <img src="${escH(img)}" class="pth" style="object-fit:cover;border-radius:6px" onerror="this.onerror=null;this.style.cssText='background:#2d3148;width:44px;height:44px;border-radius:6px;flex-shrink:0';this.removeAttribute('src')">
        <div class="pni"><div class="pnm">${escH(title)}</div><div class="pcm">${p.id}</div></div>
      </div></td>
      <td>${escH(cat)}</td>
      <td>${escH(author)}</td>
      <td><div class="lf">${LANGS.map(l => `<span class="lfl d">${l.toUpperCase()}</span>`).join('')}</div></td>
      <td><span class="sb2 ${status.toLowerCase() === 'published' ? 'sp' : 'sa'}">${escH(status)}</span></td>
      <td style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--text2)">/en/blog/${escH(slug)}/</td>
      <td><div class="ra">
        <button class="ib" onclick="window._editPost('${p.id}')"><span class="material-symbols-outlined ic">edit</span></button>
        <button class="ib dr" onclick="window._askDelete('posts','${p.id}')"><span class="material-symbols-outlined ic">delete</span></button>
      </div></td>
    </tr>`).join('');

    if (mob) mob.innerHTML = list.map(({ p, title, cat, status, img }) =>
        `<div class="mc">
          <div class="mct">
            <div class="pnc" style="gap:10px">
              <img src="${escH(img)}" style="width:44px;height:44px;border-radius:6px;object-fit:cover;flex-shrink:0" onerror="this.onerror=null;this.style.background='#2d3148';this.removeAttribute('src')">
              <div class="pni"><div class="pnm">${escH(title)}</div><div class="pcm">${escH(cat)}</div></div>
            </div>
            <span class="sb2 ${status.toLowerCase() === 'published' ? 'sp' : 'sa'}">${escH(status)}</span>
          </div>
          <div class="mca">
            <button class="ib" onclick="window._editPost('${p.id}')"><span class="material-symbols-outlined ic">edit</span></button>
            <button class="ib dr" onclick="window._askDelete('posts','${p.id}')"><span class="material-symbols-outlined ic">delete</span></button>
          </div>
        </div>`).join('');
}

// ════════════════════════════════════════════════════════
// 3. EDIT FORMS
// ════════════════════════════════════════════════════════
window._editCat = function(id) {
    currentEditingId = id; currentCollection = 'categories';
    const cat = state.categories.find(x => x.id === id); if (!cat) return;
    document.getElementById('cattitle').textContent = 'Edit Category';
    setV('catstat', cat.status || cat.globalFields?.status || 'Active');
    setV('catslug', cat.slug   || cat.globalFields?.slug   || cat.id);
    setV('cat-xDefaultHreflang', cat.xDefaultHreflang || cat.globalFields?.xDefaultHreflang || 'en');

    // При редактировании ID уже зафиксирован — показываем его как read-only,
    // скрываем поле ввода catIdInput и показываем slug как справочное поле
    const idRow   = document.getElementById('catIdRow');
    const slugRow = document.getElementById('catSlugRow');
    if (idRow)   { idRow.style.display = 'none'; }
    if (slugRow) { slugRow.style.display = ''; }

    const color = cat.color || cat.globalFields?.color || '#4f7dff';
    selColor = color;
    document.querySelectorAll('#swatches .sw').forEach(sw => {
        sw.classList.toggle('on', sw.dataset.c === color);
    });
    LANGS.forEach(lang => {
        const t = cat.translations?.[lang] || {};
        setV(`cat-${lang}-name`,            t.name            || '');
        setV(`cat-${lang}-description`,     t.description     || '');
        setV(`cat-${lang}-seoTitle`,        t.seoTitle        || '');
        setV(`cat-${lang}-metaDescription`, t.metaDescription || '');
        setV(`cat-${lang}-ogTitle`,         t.ogTitle         || '');
        setV(`cat-${lang}-ogDescription`,   t.ogDescription   || '');
        setV(`cat-${lang}-ogImageUrl`,      t.ogImageUrl      || '');
        setV(`cat-${lang}-schemaJsonLd`,    t.schemaJsonLd    || '');
        setV(`cat-${lang}-regionHreflang`,  t.regionHreflang  || '');
    });
    document.getElementById('cat-delete-btn').style.display = '';
    updCatUrl(); showM('mcat');
};

// [FIX-8] Product edit: per-language fields read from translations[lang]
window._editProd = function(id) {
    currentEditingId = id; currentCollection = 'products';
    const p = state.products.find(x => x.id === id); if (!p) return;
    const gf = p.globalFields || {};
    document.getElementById('prodtitle').textContent = 'Edit Product';

    // Global fields only (no per-lang fields here)
    setV('prodstat',   gf.status          || 'Draft');
    setV('prodcatsel', gf.categoryId       || '');
    setV('prodsku',    gf.sku              || '');
    setV('prodstock',  gf.stock            || '');
    setV('prodvol',    gf.weightVolume     || gf.volume || '');
    setV('prodbadge',  gf.badge            || '');
    setV('prodwashes', gf.washes           || '');
    setV('prodprio',   gf.priority         || '0.9');
    setV('prodslug',   gf.slug             || p.id);
    if (document.getElementById('prodfreq'))     setV('prodfreq',     gf.changeFrequency  || 'monthly');
    if (document.getElementById('prodhreflang')) setV('prodhreflang', gf.xDefaultHreflang || 'en');

    // Per-language fields
    const prodTextFields = ['categoryLabel','productName','imageAltText','price',
        'shortDescription','fullDescriptionHtml',
        'cardTitle','cardDescription',
        'regionHreflang','ogImageUrl',
        'seoTitle','metaDescription','ogTitle','ogDescription','schemaJsonLd'];

    LANGS.forEach(lang => {
        const t = p.translations?.[lang] || {};

        // Text fields
        prodTextFields.forEach(key => {
            const el = document.getElementById(`${lang}-${key}`);
            if (el) el.value = t[key] ?? '';
        });

        // Images (per-lang textarea)
        const imgTa = document.getElementById(`${lang}-images-ta`);
        if (imgTa) imgTa.value = (Array.isArray(t.images) ? t.images : []).join('\n');

        // Feature Pills (per-lang)
        renderFeaturePills(lang, Array.isArray(t.featurePills) ? t.featurePills : []);

        // Scent Notes (per-lang)
        const sn = t.scentNotes || {};
        setV(`${lang}-scentTop`,  sn.top    || '');
        setV(`${lang}-scentMid`,  sn.middle  || '');
        setV(`${lang}-scentBase`, sn.base    || '');

        // Volumes, Dosage, Ingredients (per-lang)
        renderProdVolumes(lang, t.availableVolumes || []);
        renderProdDosage(lang, t.dosage || []);
        renderIngredients(lang, t.ingredients || []);

        // Description Points
        renderDescPoints(lang, t.descriptionPoints || []);

        // CTA Buttons
        renderCtaButtons(lang, t.ctaButtons || []);
    });

    document.getElementById('prod-delete-btn').style.display = '';
    updProdUrl(); showM('mprod');
};

window._editPost = function(id) {
    currentEditingId = id; currentCollection = 'posts';
    const p = state.posts.find(x => x.id === id); if (!p) return;
    const gf = p.globalFields || {};
    document.getElementById('blogtitle').textContent = 'Edit Post';

    setV('blogstat',        gf.status           || 'Draft');
    setV('blogcat',         gf.category          || '');
    setV('blogbadge',       gf.tagBadge          || '');
    setV('blogread',        gf.readTime          || '');
    setV('blogslug',        gf.slug              || p.id);
    setV('blogprio',        gf.priority          || '0.8');
    setV('blogregion',      gf.regionHreflang    || '');
    setV('blogogimg',       gf.ogImageUrl        || '');
    setV('blogschema',      gf.schemaJsonLd      || '');
    setV('blogemoji',       gf.emoji             || '');
    setV('blogauthorrole',  gf.authorRole        || '');
    setV('blogauthorinitials', gf.authorInitials || '');
    setV('blogauthorbio',   gf.authorBio         || '');
    setV('blogauthor',      gf.authorName        || '');

    const rawDate = gf.publishDate || '';
    if (rawDate) {
        try {
            const d = new Date(rawDate);
            if (!isNaN(d)) setV('blogpublishdate', d.toISOString().slice(0, 10));
            else setV('blogpublishdate', rawDate.slice(0, 10));
        } catch { setV('blogpublishdate', ''); }
    } else {
        setV('blogpublishdate', '');
    }

    if (document.getElementById('blogfreq')) setV('blogfreq', gf.changeFrequency || 'weekly');
    if (document.getElementById('bloghreflang')) setV('bloghreflang', gf.xDefaultHreflang || 'en');

    blogAvatarColor = gf.authorAvatarColor || 'blue';
    document.querySelectorAll('.av-swatch').forEach(sw => {
        sw.classList.toggle('on', sw.dataset.ac === blogAvatarColor);
    });
    const avPrev = document.getElementById('blog-avatar-preview');
    if (avPrev) {
        avPrev.style.background = AVATAR_COLORS[blogAvatarColor] || '#3b82f6';
        avPrev.textContent = gf.authorInitials || '??';
    }
    const avVal = document.getElementById('blog-avcolor-val');
    if (avVal) avVal.textContent = blogAvatarColor;

    blogTags = Array.isArray(gf.tags) ? [...gf.tags] : [];
    renderBlogTags();

    LANGS.forEach(lang => {
        const t = p.translations?.[lang] || {};
        let mediaUrlsVal = t.mediaUrls || '';
        if (Array.isArray(mediaUrlsVal)) mediaUrlsVal = mediaUrlsVal.join(', ');
        setV(`${lang}-blog-h1`,                  t.h1                  || '');
        setV(`${lang}-blog-mediaUrls`,            mediaUrlsVal);
        setV(`${lang}-blog-mainImageAltText`,     t.mainImageAltText    || '');
        setV(`${lang}-blog-mainPageContentHtml`,  t.mainPageContentHtml || '');
        setV(`${lang}-blog-cardTitle`,            t.cardTitle           || '');
        setV(`${lang}-blog-cardDescription`,      t.cardDescription     || '');
        setV(`${lang}-blog-seoTitle`,             t.seoTitle            || '');
        setV(`${lang}-blog-metaDescription`,      t.metaDescription     || '');
        setV(`${lang}-blog-ogTitle`,              t.ogTitle             || '');
        setV(`${lang}-blog-ogDescription`,        t.ogDescription       || '');
    });

    document.getElementById('blog-delete-btn').style.display = '';
    updBlogUrl(); showM('mblog');
};

// ════════════════════════════════════════════════════════
// 4. SAVING
// ════════════════════════════════════════════════════════
async function persistToFirestore(colName, data, customId = null) {
    const firestoreCol = colName === 'posts' ? 'blog' : colName;
    try {
        // Flatten nested objects to dot-notation so updateDoc does field-level
        // updates instead of replacing entire nested maps.
        function flatten(obj, prefix = '') {
            const out = {};
            for (const [k, v] of Object.entries(obj)) {
                const key = prefix ? `${prefix}.${k}` : k;
                if (v !== null && typeof v === 'object' && !Array.isArray(v)
                    && !(v instanceof Date)) {
                    Object.assign(out, flatten(v, key));
                } else {
                    out[key] = v;
                }
            }
            return out;
        }
        const flat = flatten(data);

        if (currentEditingId) {
            await updateDoc(doc(db, firestoreCol, currentEditingId), flat);
            const key = colName === 'categories' ? 'categories' : colName === 'products' ? 'products' : 'posts';
            const i   = state[key].findIndex(x => x.id === currentEditingId);
            if (i !== -1) state[key][i] = { id: currentEditingId, ...data };
            showToast('✅ Saved to Firebase!');
        } else if (customId) {
            // Создание с заданным ID (для категорий — из поля catIdInput)
            await setDoc(doc(db, firestoreCol, customId), data);
            const key = colName === 'categories' ? 'categories' : colName === 'products' ? 'products' : 'posts';
            state[key].push({ id: customId, ...data });
            showToast('✅ Created in Firebase!');
        } else {
            const ref = await addDoc(collection(db, firestoreCol), data);
            const key = colName === 'categories' ? 'categories' : colName === 'products' ? 'products' : 'posts';
            state[key].push({ id: ref.id, ...data });
            showToast('✅ Created in Firebase!');
        }
        renderAll();
        const modals = { categories: 'mcat', products: 'mprod', posts: 'mblog' };
        closeM(modals[colName]);
        currentEditingId = null;
    } catch (err) {
        console.error(err);
        showToast('Save error: ' + err.message, 'err');
    }
}

window.saveCategory = async function() {
    // При создании: ID берётся из catIdInput (он же = URL-сегмент = slug)
    // При редактировании: ID уже зафиксирован (currentEditingId), slug из catslug
    const catDocId = currentEditingId ? null : getV('catIdInput').trim();
    const slug     = currentEditingId
        ? (getV('catslug').trim() || currentEditingId)
        : catDocId;   // для новых категорий slug = id

    if (!currentEditingId && !catDocId) {
        showToast('Please fill in the Category ID field (it will become the URL segment)', 'err');
        document.getElementById('catIdInput')?.focus();
        return;
    }

    const catSeoFields = ['ogTitle','ogDescription','ogImageUrl','schemaJsonLd','regionHreflang'];

    const translations = {};
    LANGS.forEach(lang => {
        translations[lang] = {
            name:            getV(`cat-${lang}-name`).trim(),
            description:     getV(`cat-${lang}-description`).trim(),
            seoTitle:        getV(`cat-${lang}-seoTitle`).trim(),
            metaDescription: getV(`cat-${lang}-metaDescription`).trim(),
        };
        catSeoFields.forEach(key => {
            const el = document.getElementById(`cat-${lang}-${key}`);
            translations[lang][key] = el ? el.value.trim() : '';
        });
    });

    await persistToFirestore('categories', {
        slug, status: getV('catstat'), color: selColor,
        xDefaultHreflang: getV('cat-xDefaultHreflang') || 'en',
        translations,
        productCount: state.products.filter(p => p.globalFields?.categoryId === currentEditingId).length,
    }, catDocId);
};

// [FIX-8] saveProduct: per-language fields saved into translations[lang]
window.saveProduct = async function() {
    const slug = getV('prodslug').trim();
    if (!slug) { showToast('Please enter a product slug', 'err'); return; }

    const prodTextFields = ['categoryLabel','productName','imageAltText','price',
        'shortDescription','fullDescriptionHtml',
        'cardTitle','cardDescription',
        'regionHreflang','ogImageUrl',
        'seoTitle','metaDescription','ogTitle','ogDescription','schemaJsonLd'];

    const translations = {};
    LANGS.forEach(lang => {
        const obj = {};
        prodTextFields.forEach(key => {
            const el = document.getElementById(`${lang}-${key}`);
            obj[key] = el ? el.value.trim() : '';
        });
        obj.descriptionPoints = collectDescPoints(lang);
        // Per-lang scent notes
        obj.scentNotes = {
            top:    getV(`${lang}-scentTop`),
            middle: getV(`${lang}-scentMid`),
            base:   getV(`${lang}-scentBase`),
        };
        // Per-lang volumes, dosage, ingredients
        obj.availableVolumes = collectProdVolumes(lang);
        obj.dosage           = collectProdDosage(lang);
        obj.ingredients      = collectIngredients(lang);
        // Per-lang images and featurePills
        const imgTa = document.getElementById(`${lang}-images-ta`);
        obj.images       = imgTa ? imgTa.value.split('\n').map(s => s.trim()).filter(Boolean) : [];
        obj.featurePills = collectFeaturePills(lang);
        // Per-lang CTA buttons
        obj.ctaButtons       = collectCtaButtons(lang);
        translations[lang] = obj;
    });

    // globalFields: ONLY truly global data — NO per-lang fields
    await persistToFirestore('products', {
        globalFields: {
            slug,
            status:           getV('prodstat'),
            categoryId:       getV('prodcatsel'),
            sku:              getV('prodsku'),
            stock:            parseInt(getV('prodstock')) || 0,
            weightVolume:     getV('prodvol'),
            badge:            getV('prodbadge'),
            washes:           getV('prodwashes'),
            priority:         getV('prodprio'),
            changeFrequency:  getV('prodfreq') || 'monthly',
            xDefaultHreflang: getV('prodhreflang') || 'en',
        },
        translations,
        productName: translations.en?.productName || '',
        name:        translations.en?.productName || '',
    });
};

window.saveBlogPost = async function() {
    const slug = getV('blogslug').trim();
    if (!slug) { showToast('Please enter a post slug', 'err'); return; }

    const rawDate = getV('blogpublishdate');
    let publishDate = '';
    if (rawDate) {
        try {
            const d = new Date(rawDate);
            if (!isNaN(d)) {
                publishDate = d.toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });
            } else { publishDate = rawDate; }
        } catch { publishDate = rawDate; }
    }

    const translations = {};
    LANGS.forEach(lang => {
        const mediaUrlsValue = getV(`${lang}-blog-mediaUrls`).trim();
        const mediaUrlsArray = mediaUrlsValue
            ? mediaUrlsValue.split(',').map(u => u.trim()).filter(Boolean)
            : [];
        translations[lang] = {
            h1:                  getV(`${lang}-blog-h1`).trim(),
            mediaUrls:           mediaUrlsArray,
            mainImageAltText:    getV(`${lang}-blog-mainImageAltText`).trim(),
            mainPageContentHtml: getV(`${lang}-blog-mainPageContentHtml`).trim(),
            cardTitle:           getV(`${lang}-blog-cardTitle`).trim(),
            cardDescription:     getV(`${lang}-blog-cardDescription`).trim(),
            seoTitle:            getV(`${lang}-blog-seoTitle`).trim(),
            metaDescription:     getV(`${lang}-blog-metaDescription`).trim(),
            ogTitle:             getV(`${lang}-blog-ogTitle`).trim(),
            ogDescription:       getV(`${lang}-blog-ogDescription`).trim(),
        };
    });

    await persistToFirestore('posts', {
        globalFields: {
            slug,
            status:           getV('blogstat'),
            category:         getV('blogcat'),
            tagBadge:         getV('blogbadge'),
            readTime:         getV('blogread'),
            publishDate,
            emoji:            getV('blogemoji'),
            priority:         getV('blogprio'),
            changeFrequency:  getV('blogfreq') || 'weekly',
            xDefaultHreflang: getV('bloghreflang') || 'en',
            regionHreflang:   getV('blogregion'),
            ogImageUrl:       getV('blogogimg'),
            schemaJsonLd:     getV('blogschema'),
            authorName:       getV('blogauthor'),
            authorRole:       getV('blogauthorrole'),
            authorInitials:   getV('blogauthorinitials'),
            authorBio:        getV('blogauthorbio'),
            authorAvatarColor: blogAvatarColor,
            tags:             [...blogTags],
        },
        translations,
        name:  translations.en?.h1 || '',
        title: translations.en?.h1 || '',
    });
};

// ════════════════════════════════════════════════════════
// 5. DELETE
// ════════════════════════════════════════════════════════
window._askDelete = function(colName, id) {
    pendingDeleteId = id; pendingDeleteCol = colName; showM('mconf');
};
function confirmDelete() {
    if (!pendingDeleteId || !pendingDeleteCol) return;
    const firestoreCol = pendingDeleteCol === 'posts' ? 'blog' : pendingDeleteCol;
    deleteDoc(doc(db, firestoreCol, pendingDeleteId)).then(() => {
        const key = pendingDeleteCol === 'categories' ? 'categories'
            : pendingDeleteCol === 'products' ? 'products' : 'posts';
        state[key] = state[key].filter(x => x.id !== pendingDeleteId);
        renderAll(); closeM('mconf'); showToast('🗑 Deleted');
    }).catch(err => showToast('Delete error: ' + err.message, 'err'));
    pendingDeleteId = null; pendingDeleteCol = null;
}

// ════════════════════════════════════════════════════════
// 6. NAVIGATION
// ════════════════════════════════════════════════════════
const SESSION_KEY = 'rakun_admin_section';

const META_CONTENT = {
    products:   { t: 'Products',   c: '/ Content' },
    categories: { t: 'Categories', c: '/ Content' },
    blog:       { t: 'Blog Posts', c: '/ Content' },
};
const META_PAGES = {
    'page-home':     { t: 'Home Page',    c: '/ Pages' },
    'page-catalog':  { t: 'Catalog Page', c: '/ Pages' },
    'page-blog':     { t: 'Blog Page',    c: '/ Pages' },
    'page-contacts': { t: 'Contacts',     c: '/ Pages' },
    'page-about':    { t: 'About Us',     c: '/ Pages' },
};
const META = IS_CONTENT ? META_CONTENT : META_PAGES;

window.goP = function(id) {
    document.querySelectorAll('.pn').forEach(p => p.classList.remove('on'));
    document.getElementById('pn-' + id)?.classList.add('on');
    document.querySelectorAll('.ni[data-p], .mni[data-p]').forEach(n => n.classList.remove('on'));
    document.querySelector(`.ni[data-p="${id}"]`)?.classList.add('on');
    document.querySelector(`.mni[data-p="${id}"]`)?.classList.add('on');
    const m = META[id] || { t: id, c: '' };
    setText('tptitle', m.t); setText('tpcrumb', m.c);
    document.querySelector('.ct')?.scrollTo(0, 0);
    closeMob();
    try { sessionStorage.setItem(SESSION_KEY, id); } catch(e) {}
};

function restoreSection() {
    const hash = window.location.hash.replace('#', '');
    if (hash && document.getElementById('pn-' + hash)) { goP(hash); return; }
    try {
        const saved = sessionStorage.getItem(SESSION_KEY);
        if (saved && document.getElementById('pn-' + saved)) { goP(saved); return; }
    } catch(e) {}
    const first = IS_CONTENT ? 'products' : 'page-home';
    goP(first);
}

// ════════════════════════════════════════════════════════
// 7. SIDEBAR / MOBILE
// ════════════════════════════════════════════════════════
window.toggleSidebar = function() {
    document.getElementById('sidebar')?.classList.toggle('collapsed');
};
window.closeMob   = function() {};
window.openMobMenu  = function() {
    document.getElementById('mob-menu')?.classList.add('on');
    document.getElementById('mob-menu-overlay')?.classList.add('on');
};
window.closeMobMenu = function() {
    document.getElementById('mob-menu')?.classList.remove('on');
    document.getElementById('mob-menu-overlay')?.classList.remove('on');
};

function checkMob() {
    const isMob = window.innerWidth < 768;
    const dtt = document.getElementById('dtt');
    const mbt = document.getElementById('mbt');
    if (dtt) dtt.style.display = isMob ? 'none' : '';
    if (mbt) mbt.style.display = isMob ? '' : 'none';
}

function bindCrossFileLinks() {
    document.querySelectorAll('.ni[data-href]').forEach(el => {
        el.addEventListener('click', () => { window.location.href = el.dataset.href; });
    });
}

// ════════════════════════════════════════════════════════
// 8. URL PREVIEW
// ════════════════════════════════════════════════════════
window.updProdUrl = function() {
    const slug = getV('prodslug') || 'product-slug';
    // URL товара = /products/{categoryId}/{productSlug}/
    // categoryId = document ID категории, хранится в globalFields.categoryId
    const cat  = document.getElementById('prodcatsel')?.value || 'category-id';
    setText('produp', `/en/products/${cat}/${slug}/`);
};
window.updBlogUrl = function() {
    const slug = getV('blogslug') || 'post-slug';
    setText('blogurlprev', `/en/blog/${slug}/`);
};
window.updCatUrl = function() {
    // URL категории = /products/{categoryId}/ где categoryId = document ID в Firestore.
    // При создании новой категории ID генерируется из EN-названия и показывается в поле catIdInput.
    if (currentCollection === 'categories' && currentEditingId) {
        setText('caturlprev', `/en/products/${currentEditingId}/`);
    } else {
        const generatedId = getV('catIdInput') || '…';
        setText('caturlprev', `/en/products/${generatedId}/`);
    }
};

// ════════════════════════════════════════════════════════
// 9. MODAL HELPERS
// ════════════════════════════════════════════════════════
window.showM  = function(id) { document.getElementById(id)?.classList.add('on'); document.body.style.overflow = 'hidden'; };
window.closeM = function(id) { document.getElementById(id)?.classList.remove('on'); document.body.style.overflow = ''; };

// ════════════════════════════════════════════════════════
// 10. LANG TAB SWITCHERS
// ════════════════════════════════════════════════════════
window.swProdLang = function(lang, btn) {
    document.querySelectorAll('#mprod .lpane').forEach(p => p.classList.remove('on'));
    document.getElementById('prod-lp-' + lang)?.classList.add('on');
    document.querySelectorAll('#mprod .ltab').forEach(b => b.classList.remove('on'));
    btn?.classList.add('on');
};
window.swBlogLang = function(lang, btn) {
    document.querySelectorAll('#mblog .lpane').forEach(p => p.classList.remove('on'));
    document.getElementById('blog-lp-' + lang)?.classList.add('on');
    document.querySelectorAll('#mblog .ltab').forEach(b => b.classList.remove('on'));
    btn?.classList.add('on');
};
window.swCatLang = function(lang, btn) {
    document.querySelectorAll('#mcat .lpane').forEach(p => p.classList.remove('on'));
    document.getElementById('cat-lang-' + lang)?.classList.add('on');
    document.querySelectorAll('#mcat .ltab').forEach(b => b.classList.remove('on'));
    btn?.classList.add('on');
};
window.openNewCat = function() {
    currentEditingId = null; currentCollection = 'categories';
    document.getElementById('cattitle').textContent = 'New Category';
    document.querySelectorAll('#mcat input.fin, #mcat textarea.fmono').forEach(el => el.value = '');
    document.getElementById('catstat').value = 'Active';
    document.getElementById('cat-xDefaultHreflang').value = 'en';
    document.getElementById('cat-delete-btn').style.display = 'none';
    selColor = '#4f7dff';
    document.querySelectorAll('#swatches .sw').forEach((sw, i) => sw.classList.toggle('on', i === 0));
    // При создании: показываем поле ID (автогенерируется), прячем slug
    const idRow   = document.getElementById('catIdRow');
    const slugRow = document.getElementById('catSlugRow');
    if (idRow)   idRow.style.display   = '';
    if (slugRow) slugRow.style.display = 'none';
    updCatUrl(); showM('mcat');
    // Фокус на поле EN-названия, чтобы сразу начать заполнять
    setTimeout(() => document.getElementById('cat-en-name')?.focus(), 150);
};
// Автогенерация ID категории из EN-названия при вводе (только для новых категорий)
window.autoCatId = function() {
    if (currentEditingId) return; // при редактировании ID не меняем
    const name = getV('cat-en-name');
    const generated = toSlug(name);
    const idField = document.getElementById('catIdInput');
    if (idField) idField.value = generated;
    updCatUrl();
};
window.filterProducts = function() { renderProducts(); };
window.filterBlog     = function() { renderBlog(); };
window.confirmLang    = function(type, lang) { /* placeholder */ };

// ════════════════════════════════════════════════════════
// 11. AVATAR COLOR (Blog)
// ════════════════════════════════════════════════════════
window.setBlogAvatarColor = function(color, el) {
    blogAvatarColor = color;
    document.querySelectorAll('.av-swatch').forEach(sw => sw.classList.toggle('on', sw === el));
    const avPrev = document.getElementById('blog-avatar-preview');
    if (avPrev) avPrev.style.background = AVATAR_COLORS[color] || '#3b82f6';
    const avVal = document.getElementById('blog-avcolor-val');
    if (avVal) avVal.textContent = color;
};

window.updateAvatarPreview = function() {
    const initials = getV('blogauthorinitials') || getV('blogauthor').split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase() || '??';
    const avPrev = document.getElementById('blog-avatar-preview');
    if (avPrev) avPrev.textContent = initials;
};

// ════════════════════════════════════════════════════════
// 12. TAGS UI (Blog)
// ════════════════════════════════════════════════════════
function renderBlogTags() {
    const wrap = document.getElementById('blog-tags-wrap');
    if (!wrap) return;
    wrap.innerHTML = blogTags.map((tag, i) =>
        `<span class="tag-chip">${escH(tag)}<button onclick="removeBlogTag(${i})" title="Remove">×</button></span>`
    ).join('');
}

window.removeBlogTag = function(idx) {
    blogTags.splice(idx, 1);
    renderBlogTags();
};

window.handleTagInput = function(e, type) {
    if (type !== 'blog') return;
    const inp = document.getElementById('blog-tags-input');
    if (!inp) return;
    if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        const val = inp.value.replace(/,/g, '').trim();
        if (val && !blogTags.includes(val)) { blogTags.push(val); renderBlogTags(); }
        inp.value = '';
    } else if (e.key === 'Backspace' && inp.value === '' && blogTags.length) {
        blogTags.pop(); renderBlogTags();
    }
};

// ════════════════════════════════════════════════════════
// 13. PRODUCT HELPERS — now lang-scoped [FIX-8] [FIX-11]
// ════════════════════════════════════════════════════════
window.addPill = function(lang) {
    const inp = document.getElementById(`pillin-${lang}`); if (!inp) return;
    const text = inp.value.trim(); if (!text) return;
    inp.value = '';
    const box = document.getElementById(`pills-${lang}`); if (!box) return;
    const s = document.createElement('span'); s.className = 'pi';
    s.dataset.text = text;
    s.innerHTML = escH(text) + `<button onclick="this.closest('.pi').remove()"><span class="material-symbols-outlined ic">close</span></button>`;
    box.appendChild(s);
};

function renderFeaturePills(lang, pills) {
    const box = document.getElementById(`pills-${lang}`); if (!box) return;
    box.innerHTML = (pills || []).map(text =>
        `<span class="pi" data-text="${escH(text)}">${escH(text)}<button onclick="this.closest('.pi').remove()"><span class="material-symbols-outlined ic">close</span></button></span>`
    ).join('');
}

function collectFeaturePills(lang) {
    const box = document.getElementById(`pills-${lang}`); if (!box) return [];
    return Array.from(box.querySelectorAll('.pi')).map(el => el.dataset.text || el.childNodes[0]?.textContent?.trim() || '').filter(Boolean);
}

// Ingredients: lang-scoped
window.addIngr = function(lang) {
    const list = document.getElementById(`${lang}-ingren`); if (!list) return;
    const r = document.createElement('div'); r.className = 'ir';
    r.innerHTML = '<input class="fin" placeholder="Ingredient name"><input class="fin pct" placeholder="0%"><button class="ib dr" onclick="this.parentNode.remove()"><span class="material-symbols-outlined ic">delete</span></button>';
    list.appendChild(r);
};
function renderIngredients(lang, ings) {
    const list = document.getElementById(`${lang}-ingren`); if (!list) return;
    list.innerHTML = ings.map(ing =>
        `<div class="ir"><input class="fin" placeholder="Ingredient name" value="${escH(ing.name || '')}"><input class="fin pct" placeholder="0%" value="${escH(ing.percentage || '')}"><button class="ib dr" onclick="this.parentNode.remove()"><span class="material-symbols-outlined ic">delete</span></button></div>`
    ).join('');
}
function collectIngredients(lang) {
    return Array.from(document.querySelectorAll(`#${lang}-ingren .ir`)).map(r => {
        const inputs = r.querySelectorAll('input');
        return { name: inputs[0]?.value.trim() || '', percentage: inputs[1]?.value.trim() || '' };
    }).filter(i => i.name);
}

// Volumes: lang-scoped
function renderProdVolumes(lang, vols) {
    const body = document.getElementById(`${lang}-volumes-body`); if (!body) return;
    body.innerHTML = vols.map((v, i) => `
        <div class="ir vol-row" data-idx="${i}" style="gap:8px;margin-bottom:8px;align-items:center">
          <input class="fin vol-label" placeholder="Label (2 L)" value="${escH(v.label || '')}">
          <input class="fin vol-value" placeholder="Value (2 L)" value="${escH(v.value || '')}">
          <input class="fin vol-link"  placeholder="Link (?id=slug-2l)" value="${escH(v.link || '')}">
          <button class="ib dr" onclick="this.parentNode.remove()"><span class="material-symbols-outlined ic">delete</span></button>
        </div>`).join('');
}
window.addProdVolume = function(lang) {
    const vols = collectProdVolumes(lang); vols.push({label:'',value:'',link:''}); renderProdVolumes(lang, vols);
};
function collectProdVolumes(lang) {
    return Array.from(document.querySelectorAll(`#${lang}-volumes-body .vol-row`)).map(r => ({
        label: r.querySelector('.vol-label')?.value.trim() || '',
        value: r.querySelector('.vol-value')?.value.trim() || '',
        link:  r.querySelector('.vol-link')?.value.trim()  || '',
    })).filter(v => v.label || v.value);
}

// Dosage: lang-scoped
function renderProdDosage(lang, rows) {
    const body = document.getElementById(`${lang}-dosage-body`); if (!body) return;
    body.innerHTML = rows.map((d, i) => `
        <div class="ir dos-row" data-idx="${i}" style="gap:8px;margin-bottom:8px;align-items:center">
          <input class="fin dos-type"   placeholder="Type (Hand Wash)"  value="${escH(d.type   || '')}">
          <input class="fin dos-weight" placeholder="Load (4–6 kg)"     value="${escH(d.weight || '')}">
          <input class="fin dos-amount" placeholder="Amount (15 ml)"    value="${escH(d.amount || '')}">
          <button class="ib dr" onclick="this.parentNode.remove()"><span class="material-symbols-outlined ic">delete</span></button>
        </div>`).join('');
}
window.addProdDosage = function(lang) {
    const rows = collectProdDosage(lang); rows.push({type:'',weight:'',amount:''}); renderProdDosage(lang, rows);
};
function collectProdDosage(lang) {
    return Array.from(document.querySelectorAll(`#${lang}-dosage-body .dos-row`)).map(r => ({
        type:   r.querySelector('.dos-type')?.value.trim()   || '',
        weight: r.querySelector('.dos-weight')?.value.trim() || '',
        amount: r.querySelector('.dos-amount')?.value.trim() || '',
    })).filter(d => d.type || d.amount);
}

// Description Points
function renderDescPoints(lang, points) {
    const body = document.getElementById(`${lang}-descpoints-body`); if (!body) return;
    body.innerHTML = points.map((pt, i) => `
        <div class="ir dp-row" style="flex-direction:column;gap:6px;margin-bottom:12px;padding:12px;background:var(--bg3);border-radius:8px;border:1px solid var(--border2)">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px">
            <span style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.06em">Point ${i+1}</span>
            <button class="ib dr" onclick="this.closest('.dp-row').remove()"><span class="material-symbols-outlined ic">delete</span></button>
          </div>
          <input class="fin dp-title" placeholder="Title (Environmentally Friendly)" value="${escH(pt.title || '')}">
          <textarea class="fta dp-text" style="min-height:50px" placeholder="Description text…">${escH(pt.text || '')}</textarea>
        </div>`).join('');
}
window.addDescPoint = function(lang) {
    const pts = collectDescPoints(lang); pts.push({title:'',text:''}); renderDescPoints(lang, pts);
};
function collectDescPoints(lang) {
    const body = document.getElementById(`${lang}-descpoints-body`); if (!body) return [];
    return Array.from(body.querySelectorAll('.dp-row')).map(r => ({
        title: r.querySelector('.dp-title')?.value.trim() || '',
        text:  r.querySelector('.dp-text')?.value.trim()  || '',
    })).filter(pt => pt.title || pt.text);
}
window.togSec = h => { h.classList.toggle('on'); h.nextElementSibling?.classList.toggle('on'); };

// ── CTA Buttons (per-language, dynamic list) ──────────────────────────────
function renderCtaButtons(lang, btns) {
    const body = document.getElementById(`${lang}-ctabuttons-body`);
    if (!body) return;
    body.innerHTML = btns.map((b, i) => `
        <div class="ir cta-btn-row" data-idx="${i}" style="gap:8px;margin-bottom:10px;align-items:center;flex-wrap:wrap">
          <input class="fin cta-btn-label" placeholder="Button label" value="${escH(b.label || '')}" style="flex:2;min-width:130px">
          <input class="fin cta-btn-url"   placeholder="URL (https://t.me/… or wa.me/…)" value="${escH(b.url || '')}" style="flex:3;min-width:190px">
          <span style="display:inline-flex;align-items:center;gap:5px;flex-shrink:0">
            <label style="font-size:11px;color:var(--text-muted,#888);white-space:nowrap">Color</label>
            <input type="color" class="cta-btn-color" value="${escH(b.color || '#25D366')}" title="Button color" style="width:34px;height:34px;padding:2px;border:1px solid var(--border,#2a2d3e);border-radius:6px;cursor:pointer;background:none">
          </span>
          <button class="ib dr" onclick="this.parentNode.remove()" title="Remove button"><span class="material-symbols-outlined ic">delete</span></button>
        </div>`).join('');
}
window.addCtaButton = function(lang) {
    const btns = collectCtaButtons(lang);
    btns.push({ label: '', url: '' });
    renderCtaButtons(lang, btns);
    // Focus the new label input
    const body = document.getElementById(`${lang}-ctabuttons-body`);
    if (body) {
        const rows = body.querySelectorAll('.cta-btn-row');
        const last = rows[rows.length - 1];
        if (last) last.querySelector('.cta-btn-label')?.focus();
    }
};
function collectCtaButtons(lang) {
    const body = document.getElementById(`${lang}-ctabuttons-body`);
    if (!body) return [];
    return Array.from(body.querySelectorAll('.cta-btn-row')).map(r => ({
        label: r.querySelector('.cta-btn-label')?.value.trim() || '',
        url:   r.querySelector('.cta-btn-url')?.value.trim()   || '',
        color: r.querySelector('.cta-btn-color')?.value.trim() || '',
    })).filter(b => b.label || b.url);
}


// ════════════════════════════════════════════════════════
// 14. PAGES (admin-pages.html) — Settings removed [FIX-10]
// ════════════════════════════════════════════════════════
async function loadPagesAndSettings() {
    try {
        const pageIds = ['home', 'catalog', 'blog', 'contacts', 'about', 'footer-nav'];
        await Promise.all(pageIds.map(async id => {
            const snap = await getDoc(doc(db, 'pages', id));
            const cacheKey = id === 'blog' ? 'blog-page' : id;
            pagesCache[cacheKey] = snap.exists() ? snap.data() : {};
        }));
        fillHomePage('en');
        fillPageFields('catalog',    'en');
        fillPageFields('blog-page',  'en');
        fillPageFields('contacts',   'en');
        fillPageFields('about',      'en');
        fillPageFields('footer-nav', 'en');
    } catch (err) {
        console.error('Pages load error:', err);
        showToast('Page load error: ' + err.message, 'err');
    }
}

window.switchPageLang = function(pageId, lang) {
    pageLangs[pageId] = lang;
    const lm = { en:'English (EN)', ru:'Russian (RU)', ka:'Georgian (KA)', hy:'Armenian (HY)' };
    const pm = { en:'/en/', ru:'/ru/', ka:'/ka/', hy:'/hy/' };
    if (pageId === 'home') {
        const hll = document.getElementById('hll');
        const hlp = document.getElementById('hlp');
        if (hll) hll.textContent = lm[lang] || lang;
        if (hlp) hlp.textContent = pm[lang] || '/' + lang + '/';
        fillHomePage(lang);
    } else {
        fillPageFields(pageId, lang);
    }
};

function fillHomePage(lang) {
    const d  = pagesCache['home'] || {};
    const gf = d.globalFields || {};
    const lo = d.translations?.[lang] || d.translations?.en || d[lang] || d.en || {};

    // Section titles
    setV('home-productsLabel',  lo.productsLabel  || gf.productsLabel  || '');
    setV('home-productsTitle',  lo.productsTitle  || gf.productsTitle  || '');

    // SEO
    setV('home-seoTitle',        lo.seoTitle        || gf.seoTitle        || '');
    setV('home-metaDescription', lo.metaDescription || gf.metaDescription || '');
    setV('home-ogTitle',         lo.ogTitle         || gf.ogTitle         || '');
    setV('home-ogDescription',   lo.ogDescription   || gf.ogDescription   || '');
    setV('home-ogImageUrl',      gf.ogImageUrl      || lo.ogImageUrl      || '');
    setV('home-schemaOrg',       gf.schemaOrg       || '');

    // Hreflang
    setV('home-xDefaultHreflang', gf.xDefaultHreflang || 'en');
    setV('home-regionHreflang-en', (gf.regionHreflangMap || {})['en'] || '');
    setV('home-regionHreflang-ru', (gf.regionHreflangMap || {})['ru'] || '');
    setV('home-regionHreflang-ka', (gf.regionHreflangMap || {})['ka'] || '');
    setV('home-regionHreflang-hy', (gf.regionHreflangMap || {})['hy'] || '');

    // Hero slides — load all new fields
    const rawSlides = lo.heroSlides || lo.slides || gf.heroSlides || gf.slides || [];
    renderSlides(rawSlides.map(s => ({
        subtitle:    s.subtitle    || '',
        headline:    s.headline    || '',
        description: s.description || '',
        bgImage:     s.backgroundImageUrl || s.bgImage || '',
        mobileBgImage: s.mobileBackgroundImageUrl || s.mobileBgImage || '',
        btnText:     s.buttonText  || s.btnText    || '',
        btnSubtext:  s.buttonSubtext || s.btnSubtext || '',
        btnUrl:      s.buttonLink  || s.btnUrl  || s.btnLink || '',
        btn2Text:    s.button2Text || s.btn2Text  || '',
        btn2Subtext: s.button2Subtext || s.btn2Subtext || '',
        btn2Url:     s.button2Link || s.btn2Url  || '',
    })));

    // Partners strip — label is per-lang, logos are global
    setV('home-partnersLabel', lo.partnersLabel || gf.partnersLabel || '');
    const rawPartners = gf.partners || lo.partners || [];
    renderPartners(rawPartners);

    // Promo banner — per-lang
    const pb = lo.promoBanner || gf.promoBanner || {};
    setV('home-pb-headline',    pb.headline    || '');
    setV('home-pb-description', pb.description || '');
    setV('home-pb-bgImageUrl',  pb.bgImageUrl  || '');
    setV('home-pb-imageUrl',    pb.imageUrl    || '');
    setV('home-pb-btn1Text',    pb.btn1Text    || '');
    setV('home-pb-btn1Url',     pb.btn1Url     || '');
    setV('home-pb-btn2Text',    pb.btn2Text    || '');
    setV('home-pb-btn2Url',     pb.btn2Url     || '');
}

function renderSlides(slides) {
    const body = document.getElementById('home-slides-body'); if (!body) return;
    body.innerHTML = slides.map((s, i) => {
        const subtitle      = s.subtitle    || '';
        const headline      = s.headline    || '';
        const description   = s.description || '';
        const bgImage       = s.bgImage       || s.backgroundImageUrl       || '';
        const mobileBgImage = s.mobileBgImage || s.mobileBackgroundImageUrl || '';
        const btnText       = s.btnText       || s.buttonText              || '';
        const btnSubtext    = s.btnSubtext    || s.buttonSubtext           || '';
        const btnUrl        = s.btnUrl        || s.buttonLink              || '';
        const btn2Text      = s.btn2Text      || s.button2Text             || '';
        const btn2Subtext   = s.btn2Subtext   || s.button2Subtext          || '';
        const btn2Url       = s.btn2Url       || s.button2Link             || '';
        return `
        <div class="slide-row" data-idx="${i}" style="margin-bottom:18px;padding:16px;background:var(--bg3);border-radius:8px;border:1px solid var(--border2)">
          <div style="font-size:12px;font-weight:700;color:var(--text2);margin-bottom:10px;display:flex;justify-content:space-between;align-items:center">
            SLIDE ${i + 1}<button class="ib dr" onclick="removeSlide(${i})"><span class="material-symbols-outlined ic">delete</span></button>
          </div>
          <div class="fg">
            <div class="fi"><label class="fl">Subtitle <span class="tip">(small green label)</span></label><input class="fin slide-subtitle" value="${escH(subtitle)}"></div>
            <div class="fi full"><label class="fl">Headline <span class="tip">(use \\n for line breaks)</span></label><input class="fin slide-headline" value="${escH(headline)}"></div>
            <div class="fi full"><label class="fl">Description <span class="tip">(paragraph under headline)</span></label><textarea class="fta slide-description" style="min-height:60px">${escH(description)}</textarea></div>
            <div class="fi full"><label class="fl">Background Image URL</label><input class="fin slide-bgImage" value="${escH(bgImage)}"></div>
            <div class="fi full"><label class="fl">Mobile Background Image URL <span class="tip">(shown only on phones; falls back to the image above if empty)</span></label><input class="fin slide-mobileBgImage" value="${escH(mobileBgImage)}"></div>
            <div style="grid-column:1/-1;font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.06em;margin-top:8px;padding-top:8px;border-top:1px solid var(--border2)">Button 1 (Primary — yellow)</div>
            <div class="fi"><label class="fl">Button 1 Text</label><input class="fin slide-btnText" value="${escH(btnText)}"></div>
            <div class="fi"><label class="fl">Button 1 Subtext <span class="tip">(small grey line)</span></label><input class="fin slide-btnSubtext" value="${escH(btnSubtext)}"></div>
            <div class="fi full"><label class="fl">Button 1 URL</label><input class="fin slide-btnUrl" value="${escH(btnUrl)}"></div>
            <div style="grid-column:1/-1;font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.06em;margin-top:8px;padding-top:8px;border-top:1px solid var(--border2)">Button 2 (Secondary — outline)</div>
            <div class="fi"><label class="fl">Button 2 Text</label><input class="fin slide-btn2Text" value="${escH(btn2Text)}"></div>
            <div class="fi"><label class="fl">Button 2 Subtext <span class="tip">(small grey line)</span></label><input class="fin slide-btn2Subtext" value="${escH(btn2Subtext)}"></div>
            <div class="fi full"><label class="fl">Button 2 URL</label><input class="fin slide-btn2Url" value="${escH(btn2Url)}"></div>
          </div>
        </div>`;
    }).join('');
}
window.addSlide    = function() { const e = collectSlides(); e.push({subtitle:'',headline:'',description:'',btnText:'',btnSubtext:'',btnUrl:'',btn2Text:'',btn2Subtext:'',btn2Url:'',bgImage:'',mobileBgImage:''}); renderSlides(e); };
window.removeSlide = function(idx) { const s = collectSlides(); s.splice(idx, 1); renderSlides(s); };

function collectSlides() {
    return Array.from(document.querySelectorAll('#home-slides-body .slide-row')).map(r => ({
        subtitle:           r.querySelector('.slide-subtitle')?.value.trim()    || '',
        headline:           r.querySelector('.slide-headline')?.value.trim()    || '',
        description:        r.querySelector('.slide-description')?.value.trim() || '',
        backgroundImageUrl: r.querySelector('.slide-bgImage')?.value.trim()     || '',
        mobileBackgroundImageUrl: r.querySelector('.slide-mobileBgImage')?.value.trim() || '',
        buttonText:         r.querySelector('.slide-btnText')?.value.trim()     || '',
        buttonSubtext:      r.querySelector('.slide-btnSubtext')?.value.trim()  || '',
        buttonLink:         r.querySelector('.slide-btnUrl')?.value.trim()      || '',
        button2Text:        r.querySelector('.slide-btn2Text')?.value.trim()    || '',
        button2Subtext:     r.querySelector('.slide-btn2Subtext')?.value.trim() || '',
        button2Link:        r.querySelector('.slide-btn2Url')?.value.trim()     || '',
    }));
}

// ── Partners ────────────────────────────────────────────────────
function renderPartners(partners) {
    const body = document.getElementById('home-partners-body'); if (!body) return;
    if (!partners.length) { body.innerHTML = '<div style="color:var(--text2);font-size:13px;padding:8px 0 4px">No partners yet. Click «Add Partner» to add logos.</div>'; return; }
    body.innerHTML = partners.map((p, i) => `
        <div class="partner-row" data-idx="${i}" style="margin-bottom:14px;padding:14px;background:var(--bg3);border-radius:8px;border:1px solid var(--border2)">
          <div style="font-size:12px;font-weight:700;color:var(--text2);margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">
            PARTNER ${i + 1}
            <button class="ib dr" onclick="removePartner(${i})"><span class="material-symbols-outlined ic">delete</span></button>
          </div>
          <div class="fg">
            <div class="fi"><label class="fl">Name</label><input class="fin partner-name" value="${escH(p.name || '')}"></div>
            <div class="fi"><label class="fl">Logo URL</label><input class="fin partner-logoUrl" value="${escH(p.logoUrl || '')}" placeholder="https://i.postimg.cc/…/logo.png"></div>
            <div class="fi full"><label class="fl">Link <span class="tip">(optional, opens on logo click)</span></label><input class="fin partner-link" value="${escH(p.link || '')}" placeholder="https://fix-price.com/"></div>
          </div>
          ${p.logoUrl ? `<div style="margin-top:10px"><img src="${escH(p.logoUrl)}" style="max-height:36px;max-width:140px;object-fit:contain;opacity:.7;border-radius:4px;background:#fff;padding:4px 8px" onerror="this.style.display='none'"></div>` : ''}
        </div>`).join('');
}
window.addPartner    = function() { const p = collectPartners(); p.push({name:'',logoUrl:'',link:''}); renderPartners(p); };
window.removePartner = function(idx) { const p = collectPartners(); p.splice(idx,1); renderPartners(p); };
function collectPartners() {
    return Array.from(document.querySelectorAll('#home-partners-body .partner-row')).map(r => ({
        name:    r.querySelector('.partner-name')?.value.trim()    || '',
        logoUrl: r.querySelector('.partner-logoUrl')?.value.trim() || '',
        link:    r.querySelector('.partner-link')?.value.trim()    || '',
    })).filter(p => p.name || p.logoUrl);
}

// ── Trust Cards (About page — "Почему нам доверяют") ─────────────
function renderTrustCards(cards) {
    const body = document.getElementById('about-trustcards-body'); if (!body) return;
    if (!cards.length) { body.innerHTML = '<div style="color:var(--text2);font-size:13px;padding:8px 0 4px">No cards yet. Click «Add Card» to add one.</div>'; return; }
    body.innerHTML = cards.map((c, i) => `
        <div class="trustcard-row" data-idx="${i}" style="margin-bottom:14px;padding:14px;background:var(--bg3);border-radius:8px;border:1px solid var(--border2)">
          <div style="font-size:12px;font-weight:700;color:var(--text2);margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">
            CARD ${i + 1}
            <button class="ib dr" onclick="removeTrustCard(${i})"><span class="material-symbols-outlined ic">delete</span></button>
          </div>
          <div class="fg">
            <div class="fi"><label class="fl">Icon <span class="tip">(Material Symbols name)</span></label><input class="fin trustcard-icon" value="${escH(c.icon || '')}" placeholder="shopping_cart"></div>
            <div class="fi"><label class="fl">Title</label><input class="fin trustcard-title" value="${escH(c.title || '')}"></div>
            <div class="fi full"><label class="fl">Text</label><textarea class="fta trustcard-text" style="min-height:60px">${escH(c.text || '')}</textarea></div>
          </div>
          ${c.icon ? `<div style="margin-top:8px;display:flex;align-items:center;gap:6px;color:var(--text2);font-size:12px"><span class="material-symbols-outlined" style="font-size:18px">${escH(c.icon)}</span>${escH(c.icon)}</div>` : ''}
        </div>`).join('');
}
window.addTrustCard    = function() { const c = collectTrustCards(); c.push({icon:'',title:'',text:''}); renderTrustCards(c); };
window.removeTrustCard = function(idx) { const c = collectTrustCards(); c.splice(idx,1); renderTrustCards(c); };
function collectTrustCards() {
    return Array.from(document.querySelectorAll('#about-trustcards-body .trustcard-row')).map(r => ({
        icon:  r.querySelector('.trustcard-icon')?.value.trim()  || '',
        title: r.querySelector('.trustcard-title')?.value.trim() || '',
        text:  r.querySelector('.trustcard-text')?.value.trim()  || '',
    })).filter(c => c.title || c.text);
}

function renderReviews(reviews) {
    const body = document.getElementById('home-reviews-body'); if (!body) return;
    body.innerHTML = reviews.map((r, i) => `
        <div class="review-row" style="margin-bottom:14px;padding:14px;background:var(--bg3);border-radius:8px;border:1px solid var(--border2)">
          <div style="font-size:12px;font-weight:700;color:var(--text2);margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">
            REVIEW ${i + 1}<button class="ib dr" onclick="removeReview(${i})"><span class="material-symbols-outlined ic">delete</span></button>
          </div>
          <div class="fg">
            <div class="fi"><label class="fl">Author</label><input class="fin review-author" value="${escH(r.author || '')}"></div>
            <div class="fi"><label class="fl">Role</label><input class="fin review-role" value="${escH(r.role || '')}"></div>
            <div class="fi full"><label class="fl">Review Text</label><textarea class="fta review-text" style="min-height:60px">${escH(r.text || '')}</textarea></div>
          </div>
        </div>`).join('');
}
window.addReview    = function() { const e = collectReviews(); e.push({author:'',role:'',text:''}); renderReviews(e); };
window.removeReview = function(idx) { const r = collectReviews(); r.splice(idx,1); renderReviews(r); };
function collectReviews() {
    return Array.from(document.querySelectorAll('#home-reviews-body .review-row')).map(r => ({
        author: r.querySelector('.review-author')?.value.trim() || '',
        role:   r.querySelector('.review-role')?.value.trim()   || '',
        text:   r.querySelector('.review-text')?.value.trim()   || '',
    }));
}

function fillPageFields(pageId, lang) {
    const d  = pagesCache[pageId] || {};
    const gf = d.globalFields || {};
    const lo = d.translations?.[lang] || d.translations?.en || d[lang] || d.en || {};

    if (pageId === 'catalog') {
        setV('catalog-title',           lo.heroTitle       || lo.title       || gf.heroTitle       || '');
        setV('catalog-subtitle',        lo.heroSubtitle    || lo.subtitle    || gf.heroSubtitle    || '');
        setV('catalog-description',     lo.heroDescription || lo.description || gf.heroDescription || '');
        setV('catalog-seoTitle',        lo.seoTitle        || gf.seoTitle        || '');
        setV('catalog-metaDescription', lo.metaDescription || gf.metaDescription || '');
        setV('catalog-ogTitle',         lo.ogTitle         || gf.ogTitle         || '');
        setV('catalog-ogDescription',   lo.ogDescription   || gf.ogDescription   || '');
        setV('catalog-ogImageUrl',      gf.ogImageUrl      || lo.ogImageUrl      || '');
        setV('catalog-schemaOrg',       gf.schemaOrg       || '');
        setV('catalog-xDefaultHreflang', gf.xDefaultHreflang || 'en');
        setV('catalog-regionHreflang-en', (gf.regionHreflangMap || {})['en'] || '');
        setV('catalog-regionHreflang-ru', (gf.regionHreflangMap || {})['ru'] || '');
        setV('catalog-regionHreflang-ka', (gf.regionHreflangMap || {})['ka'] || '');
        setV('catalog-regionHreflang-hy', (gf.regionHreflangMap || {})['hy'] || '');
    }
    if (pageId === 'blog-page') {
        setV('blog-page-title',           lo.heroTitle       || lo.title       || gf.heroTitle       || '');
        setV('blog-page-subtitle',        lo.heroSubtitle    || lo.subtitle    || gf.heroSubtitle    || '');
        setV('blog-page-description',     lo.heroDescription || lo.description || gf.heroDescription || '');
        setV('blog-page-allLabel',        lo.allLabel        || gf.allLabel        || '');
        setV('blog-page-featuredLabel',   lo.featuredLabel   || gf.featuredLabel   || '');
        setV('blog-page-readMore',        lo.readMore        || gf.readMore        || '');
        setV('blog-page-seoTitle',        lo.seoTitle        || gf.seoTitle        || '');
        setV('blog-page-metaDescription', lo.metaDescription || gf.metaDescription || '');
        setV('blog-page-ogTitle',         lo.ogTitle         || gf.ogTitle         || '');
        setV('blog-page-ogDescription',   lo.ogDescription   || gf.ogDescription   || '');
        setV('blog-page-ogImageUrl',      gf.ogImageUrl      || lo.ogImageUrl      || '');
        setV('blog-page-schemaOrg',       gf.schemaOrg       || '');
        setV('blog-page-xDefaultHreflang', gf.xDefaultHreflang || 'en');
        setV('blog-page-regionHreflang-en', (gf.regionHreflangMap || {})['en'] || '');
        setV('blog-page-regionHreflang-ru', (gf.regionHreflangMap || {})['ru'] || '');
        setV('blog-page-regionHreflang-ka', (gf.regionHreflangMap || {})['ka'] || '');
        setV('blog-page-regionHreflang-hy', (gf.regionHreflangMap || {})['hy'] || '');
    }
    if (pageId === 'contacts') {
        setV('contacts-label',           lo.label           || gf.label          || '');
        setV('contacts-title',           lo.title           || gf.title          || '');
        setV('contacts-heroDescription', lo.heroDescription || gf.heroDescription|| '');
        setV('contacts-workingHours',    lo.workingHours    || gf.workingHours   || '');
        setV('contacts-heroImageUrl',    gf.heroImageUrl    || '');
        setV('contacts-ctaTitle',        lo.ctaTitle        || gf.ctaTitle       || '');
        setV('contacts-ctaButton',       lo.ctaButton       || gf.ctaButton      || '');
        setV('contacts-logisticsTerms',  lo.logisticsTerms  || gf.logisticsTerms || '');
        setV('contacts-seoTitle',        lo.seoTitle        || gf.seoTitle        || '');
        setV('contacts-metaDescription', lo.metaDescription || gf.metaDescription || '');
        setV('contacts-ogTitle',         lo.ogTitle         || gf.ogTitle         || '');
        setV('contacts-ogDescription',   lo.ogDescription   || gf.ogDescription   || '');
        setV('contacts-ogImageUrl',      gf.ogImageUrl      || lo.ogImageUrl      || '');
        setV('contacts-schemaOrg',       gf.schemaOrg       || '');
        setV('contacts-phone',           gf.phone           || d.phone           || '');
        setV('contacts-email',           gf.email           || d.email           || '');
        setV('contacts-ctaEmail',        gf.ctaEmail        || d.ctaEmail        || gf.email || d.email || '');
        setV('contacts-whatsappHandle',  gf.whatsappHandle  || d.whatsappHandle  || '');
        setV('contacts-whatsappLink',    gf.whatsappLink    || d.whatsappLink    || '');
        setV('contacts-telegramHandle',  gf.telegramHandle  || d.telegramHandle  || '');
        setV('contacts-telegramLink',    gf.telegramLink    || d.telegramLink    || '');
        setV('contacts-viberHandle',     gf.viberHandle     || d.viberHandle     || '');
        setV('contacts-viberLink',       gf.viberLink       || d.viberLink       || '');
        setV('contacts-instagramHandle', gf.instagramHandle || d.instagramHandle || '');
        setV('contacts-instagramLink',   gf.instagramLink   || d.instagramLink   || '');
        setV('contacts-facebookHandle',  gf.facebookHandle  || d.facebookHandle  || '');
        setV('contacts-facebookLink',    gf.facebookLink    || d.facebookLink    || '');

        const cpb = lo.promoBanner || gf.promoBanner || {};
        setV('contacts-pb-headline',    cpb.headline    || '');
        setV('contacts-pb-description', cpb.description || '');
        setV('contacts-pb-bgImageUrl',  cpb.bgImageUrl  || '');
        setV('contacts-pb-imageUrl',    cpb.imageUrl    || '');
        setV('contacts-pb-btn1Text',    cpb.btn1Text    || '');
        setV('contacts-pb-btn1Url',     cpb.btn1Url     || '');
        setV('contacts-pb-btn2Text',    cpb.btn2Text    || '');
        setV('contacts-pb-btn2Url',     cpb.btn2Url     || '');

        setV('contacts-xDefaultHreflang', gf.xDefaultHreflang || 'en');
        setV('contacts-regionHreflang-en', (gf.regionHreflangMap || {})['en'] || '');
        setV('contacts-regionHreflang-ru', (gf.regionHreflangMap || {})['ru'] || '');
        setV('contacts-regionHreflang-ka', (gf.regionHreflangMap || {})['ka'] || '');
        setV('contacts-regionHreflang-hy', (gf.regionHreflangMap || {})['hy'] || '');
        renderContactStores(d.stores || gf.stores || []);
        renderContactFaq(lo.faq || gf.faq || []);
    }
    if (pageId === 'about') {
        setV('about-heroTitle',       lo.heroTitle       || gf.heroTitle       || '');
        setV('about-heroDescription', lo.heroDescription || gf.heroDescription || '');
        setV('about-heroImageUrl',    gf.heroImageUrl    || gf.mainImage       || '');

        setV('about-introTitle',       lo.introTitle       || gf.introTitle       || '');
        setV('about-introContentHtml', lo.introContentHtml || lo.contentHtml      || gf.introContentHtml || '');
        setV('about-introImageUrl',    gf.introImageUrl    || '');

        setV('about-trustTitle', lo.trustTitle || gf.trustTitle || '');
        renderTrustCards(lo.trustCards || gf.trustCards || []);

        const apb = lo.promoBanner || gf.promoBanner || {};
        setV('about-pb-headline',    apb.headline    || '');
        setV('about-pb-description', apb.description || '');
        setV('about-pb-bgImageUrl',  apb.bgImageUrl  || '');
        setV('about-pb-imageUrl',    apb.imageUrl    || '');
        setV('about-pb-btn1Text',    apb.btn1Text    || '');
        setV('about-pb-btn1Url',     apb.btn1Url     || '');
        setV('about-pb-btn2Text',    apb.btn2Text    || '');
        setV('about-pb-btn2Url',     apb.btn2Url     || '');

        setV('about-schema',          lo.schema          || gf.schema          || '');
        setV('about-ogImageUrl',      gf.ogImageUrl      || lo.ogImageUrl      || '');
        setV('about-seoTitle',        lo.seoTitle        || gf.seoTitle        || '');
        setV('about-metaDescription', lo.metaDescription || gf.metaDescription || '');
        setV('about-ogTitle',         lo.ogTitle         || gf.ogTitle         || '');
        setV('about-ogDescription',   lo.ogDescription   || gf.ogDescription   || '');

        setV('about-xDefaultHreflang', gf.xDefaultHreflang || 'en');
        setV('about-regionHreflang-en', (gf.regionHreflangMap || {})['en'] || '');
        setV('about-regionHreflang-ru', (gf.regionHreflangMap || {})['ru'] || '');
        setV('about-regionHreflang-ka', (gf.regionHreflangMap || {})['ka'] || '');
        setV('about-regionHreflang-hy', (gf.regionHreflangMap || {})['hy'] || '');
    }
    if (pageId === 'footer-nav') {
        setV('footer-nav-home',     lo.navHomeText     || lo.home     || gf.navHomeText     || '');
        setV('footer-nav-about',    lo.navAboutText    || lo.about    || gf.navAboutText    || '');
        setV('footer-nav-contacts', lo.navContactsText || lo.contacts || gf.navContactsText || '');
        const navLinks    = lo.navLinks || gf.navLinks || [];
        const catalogLink = navLinks.find(l => l.text?.toLowerCase().includes('catalog') || l.link?.includes('catalog'));
        const blogLink    = navLinks.find(l => l.text?.toLowerCase().includes('blog')    || l.link?.includes('blog'));
        const link3       = navLinks.find(l => l.text?.toLowerCase().includes('wholesale')|| l.link?.includes('contact'));
        setV('footer-nav-catalog',   lo.catalog  || catalogLink?.text || gf.catalog  || '');
        setV('footer-nav-blog',      lo.blog     || blogLink?.text    || gf.blog     || '');
        setV('footer-nav-link1',     lo.link1    || catalogLink?.text || gf.link1    || '');
        setV('footer-nav-link2',     lo.link2    || blogLink?.text    || gf.link2    || '');
        setV('footer-nav-link3',     lo.link3    || link3?.text       || gf.link3    || '');
        setV('footer-nav-copyright', lo.copyright|| gf.copyright     || '');
    }
}

// Contacts: Stores
function renderContactStores(stores) {
    const body = document.getElementById('contacts-stores-body'); if (!body) return;
    body.innerHTML = stores.map((s, i) => `
        <div class="store-row" style="margin-bottom:18px;padding:16px;background:var(--bg3);border-radius:8px;border:1px solid var(--border2)">
          <div style="font-size:12px;font-weight:700;color:var(--text2);margin-bottom:10px;display:flex;justify-content:space-between;align-items:center">
            STORE ${i + 1}<button class="ib dr" onclick="removeContactStore(${i})"><span class="material-symbols-outlined ic">delete</span></button>
          </div>
          <div class="fg">
            <div class="fi"><label class="fl">Name</label><input class="fin store-name" value="${escH(s.name || '')}"></div>
            <div class="fi"><label class="fl">Country</label><input class="fin store-country" value="${escH(s.country || '')}"></div>
            <div class="fi"><label class="fl">Badge</label><input class="fin store-badge" value="${escH(s.badge || '')}"></div>
            <div class="fi"><label class="fl">Phone</label><input class="fin store-phone" value="${escH(s.phone || '')}"></div>
            <div class="fi full"><label class="fl">Address</label><input class="fin store-address" value="${escH(s.address || '')}"></div>
            <div class="fi"><label class="fl">Hours</label><input class="fin store-hours" value="${escH(s.hours || '')}"></div>
            <div class="fi full"><label class="fl">Maps Embed URL</label><input class="fin store-mapsEmbed" value="${escH(s.mapsEmbed || '')}"></div>
          </div>
        </div>`).join('');
}
window.addContactStore    = function() { const s = collectContactStores(); s.push({name:'',country:'',badge:'',phone:'',address:'',hours:'',mapsEmbed:''}); renderContactStores(s); };
window.removeContactStore = function(idx) { const s = collectContactStores(); s.splice(idx,1); renderContactStores(s); };
function collectContactStores() {
    return Array.from(document.querySelectorAll('#contacts-stores-body .store-row')).map(r => ({
        name:      r.querySelector('.store-name')?.value.trim()      || '',
        country:   r.querySelector('.store-country')?.value.trim()   || '',
        badge:     r.querySelector('.store-badge')?.value.trim()     || '',
        phone:     r.querySelector('.store-phone')?.value.trim()     || '',
        address:   r.querySelector('.store-address')?.value.trim()   || '',
        hours:     r.querySelector('.store-hours')?.value.trim()     || '',
        mapsEmbed: r.querySelector('.store-mapsEmbed')?.value.trim() || '',
    }));
}

// Contacts: FAQ
function renderContactFaq(faq) {
    const body = document.getElementById('contacts-faq-body'); if (!body) return;
    body.innerHTML = faq.map((f, i) => `
        <div class="faq-row" style="margin-bottom:14px;padding:14px;background:var(--bg3);border-radius:8px;border:1px solid var(--border2)">
          <div style="font-size:12px;font-weight:700;color:var(--text2);margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">
            FAQ ${i + 1}<button class="ib dr" onclick="removeContactFaq(${i})"><span class="material-symbols-outlined ic">delete</span></button>
          </div>
          <div class="fg">
            <div class="fi full"><label class="fl">Question</label><input class="fin faq-q" value="${escH(f.q || '')}"></div>
            <div class="fi full"><label class="fl">Answer</label><textarea class="fta faq-a" style="min-height:60px">${escH(f.a || '')}</textarea></div>
          </div>
        </div>`).join('');
}
window.addContactFaq    = function() { const f = collectContactFaq(); f.push({q:'',a:''}); renderContactFaq(f); };
window.removeContactFaq = function(idx) { const f = collectContactFaq(); f.splice(idx,1); renderContactFaq(f); };
function collectContactFaq() {
    return Array.from(document.querySelectorAll('#contacts-faq-body .faq-row')).map(r => ({
        q: r.querySelector('.faq-q')?.value.trim() || '',
        a: r.querySelector('.faq-a')?.value.trim() || '',
    }));
}

window.savePageDoc = async function(pageId) {
    const lang       = pageLangs[pageId] || 'en';
    const existing   = pagesCache[pageId] || {};
    const existingGF = existing.globalFields || {};
    const existingTr = existing.translations || {};
    let localizedFields = {};
    let globalFields    = { ...existingGF };

    if (pageId === 'home') {
        localizedFields = {
            productsLabel:   getV('home-productsLabel'),
            productsTitle:   getV('home-productsTitle'),
            seoTitle:        getV('home-seoTitle'),
            metaDescription: getV('home-metaDescription'),
            ogTitle:         getV('home-ogTitle'),
            ogDescription:   getV('home-ogDescription'),
            heroSlides:      collectSlides(),
            partnersLabel:   getV('home-partnersLabel'),
            promoBanner: {
                headline:    getV('home-pb-headline'),
                description: getV('home-pb-description'),
                bgImageUrl:  getV('home-pb-bgImageUrl'),
                imageUrl:    getV('home-pb-imageUrl'),
                btn1Text:    getV('home-pb-btn1Text'),
                btn1Url:     getV('home-pb-btn1Url'),
                btn2Text:    getV('home-pb-btn2Text'),
                btn2Url:     getV('home-pb-btn2Url'),
            },
        };
        // Partners logos are global (same for all languages)
        globalFields.partners         = collectPartners();
        globalFields.ogImageUrl       = getV('home-ogImageUrl');
        globalFields.schemaOrg        = getV('home-schemaOrg');
        globalFields.xDefaultHreflang = getV('home-xDefaultHreflang') || 'en';
        globalFields.regionHreflangMap = {
            'en': getV('home-regionHreflang-en'),
            'ru': getV('home-regionHreflang-ru'),
            'ka': getV('home-regionHreflang-ka'),
            'hy': getV('home-regionHreflang-hy'),
        };
    } else if (pageId === 'catalog') {
        localizedFields = {
            heroTitle:       getV('catalog-title'),        heroSubtitle:    getV('catalog-subtitle'),
            heroDescription: getV('catalog-description'),  seoTitle:        getV('catalog-seoTitle'),
            metaDescription: getV('catalog-metaDescription'), ogTitle:      getV('catalog-ogTitle'),
            ogDescription:   getV('catalog-ogDescription'),
        };
        globalFields.ogImageUrl       = getV('catalog-ogImageUrl');
        globalFields.schemaOrg        = getV('catalog-schemaOrg');
        globalFields.xDefaultHreflang = getV('catalog-xDefaultHreflang') || 'en';
        globalFields.regionHreflangMap = { 'en': getV('catalog-regionHreflang-en'), 'ru': getV('catalog-regionHreflang-ru'), 'ka': getV('catalog-regionHreflang-ka'), 'hy': getV('catalog-regionHreflang-hy') };
    } else if (pageId === 'blog-page') {
        localizedFields = {
            heroTitle:       getV('blog-page-title'),      heroSubtitle:    getV('blog-page-subtitle'),
            heroDescription: getV('blog-page-description'), allLabel:       getV('blog-page-allLabel'),
            featuredLabel:   getV('blog-page-featuredLabel'), readMore:     getV('blog-page-readMore'),
            seoTitle:        getV('blog-page-seoTitle'),   metaDescription: getV('blog-page-metaDescription'),
            ogTitle:         getV('blog-page-ogTitle'),    ogDescription:   getV('blog-page-ogDescription'),
        };
        globalFields.ogImageUrl       = getV('blog-page-ogImageUrl');
        globalFields.schemaOrg        = getV('blog-page-schemaOrg');
        globalFields.xDefaultHreflang = getV('blog-page-xDefaultHreflang') || 'en';
        globalFields.regionHreflangMap = { 'en': getV('blog-page-regionHreflang-en'), 'ru': getV('blog-page-regionHreflang-ru'), 'ka': getV('blog-page-regionHreflang-ka'), 'hy': getV('blog-page-regionHreflang-hy') };
    } else if (pageId === 'contacts') {
        localizedFields = {
            label:           getV('contacts-label'),       title:           getV('contacts-title'),
            heroDescription: getV('contacts-heroDescription'), workingHours: getV('contacts-workingHours'),
            ctaTitle:        getV('contacts-ctaTitle'),    ctaButton:       getV('contacts-ctaButton'),
            logisticsTerms:  getV('contacts-logisticsTerms'),
            seoTitle:        getV('contacts-seoTitle'),    metaDescription: getV('contacts-metaDescription'),
            ogTitle:         getV('contacts-ogTitle'),     ogDescription:   getV('contacts-ogDescription'),
            faq:             collectContactFaq(),
            promoBanner: {
                headline:    getV('contacts-pb-headline'),
                description: getV('contacts-pb-description'),
                bgImageUrl:  getV('contacts-pb-bgImageUrl'),
                imageUrl:    getV('contacts-pb-imageUrl'),
                btn1Text:    getV('contacts-pb-btn1Text'),
                btn1Url:     getV('contacts-pb-btn1Url'),
                btn2Text:    getV('contacts-pb-btn2Text'),
                btn2Url:     getV('contacts-pb-btn2Url'),
            },
        };
        globalFields.heroImageUrl   = getV('contacts-heroImageUrl');
        globalFields.phone          = getV('contacts-phone');
        globalFields.email          = getV('contacts-email');
        globalFields.ctaEmail       = getV('contacts-ctaEmail');
        globalFields.ogImageUrl     = getV('contacts-ogImageUrl');
        globalFields.schemaOrg      = getV('contacts-schemaOrg');
        globalFields.whatsappHandle = getV('contacts-whatsappHandle');
        globalFields.whatsappLink   = getV('contacts-whatsappLink');
        globalFields.telegramHandle = getV('contacts-telegramHandle');
        globalFields.telegramLink   = getV('contacts-telegramLink');
        globalFields.viberHandle    = getV('contacts-viberHandle');
        globalFields.viberLink      = getV('contacts-viberLink');
        globalFields.instagramHandle= getV('contacts-instagramHandle');
        globalFields.instagramLink  = getV('contacts-instagramLink');
        globalFields.facebookHandle = getV('contacts-facebookHandle');
        globalFields.facebookLink   = getV('contacts-facebookLink');
        globalFields.stores           = collectContactStores();
        globalFields.xDefaultHreflang = getV('contacts-xDefaultHreflang') || 'en';
        globalFields.regionHreflangMap = { 'en': getV('contacts-regionHreflang-en'), 'ru': getV('contacts-regionHreflang-ru'), 'ka': getV('contacts-regionHreflang-ka'), 'hy': getV('contacts-regionHreflang-hy') };
    } else if (pageId === 'about') {
        localizedFields = {
            heroTitle:       getV('about-heroTitle'),
            heroDescription: getV('about-heroDescription'),
            introTitle:      getV('about-introTitle'),
            introContentHtml:getV('about-introContentHtml'),
            trustTitle:      getV('about-trustTitle'),
            trustCards:      collectTrustCards(),
            promoBanner: {
                headline:    getV('about-pb-headline'),
                description: getV('about-pb-description'),
                bgImageUrl:  getV('about-pb-bgImageUrl'),
                imageUrl:    getV('about-pb-imageUrl'),
                btn1Text:    getV('about-pb-btn1Text'),
                btn1Url:     getV('about-pb-btn1Url'),
                btn2Text:    getV('about-pb-btn2Text'),
                btn2Url:     getV('about-pb-btn2Url'),
            },
            schema:          getV('about-schema'),
            seoTitle:        getV('about-seoTitle'),
            metaDescription: getV('about-metaDescription'),
            ogTitle:         getV('about-ogTitle'),
            ogDescription:   getV('about-ogDescription'),
        };
        globalFields.heroImageUrl  = getV('about-heroImageUrl');
        globalFields.introImageUrl = getV('about-introImageUrl');
        globalFields.ogImageUrl    = getV('about-ogImageUrl');
        globalFields.xDefaultHreflang = getV('about-xDefaultHreflang') || 'en';
        globalFields.regionHreflangMap = { 'en': getV('about-regionHreflang-en'), 'ru': getV('about-regionHreflang-ru'), 'ka': getV('about-regionHreflang-ka'), 'hy': getV('about-regionHreflang-hy') };
    } else if (pageId === 'footer-nav') {
        localizedFields = {
            navHomeText:     getV('footer-nav-home'),      navAboutText:    getV('footer-nav-about'),
            navContactsText: getV('footer-nav-contacts'),  home:            getV('footer-nav-home'),
            about:           getV('footer-nav-about'),     contacts:        getV('footer-nav-contacts'),
            navLinks: [
                { text: getV('footer-nav-link1') || getV('footer-nav-catalog'), link: '/en/catalog/' },
                { text: getV('footer-nav-link2') || getV('footer-nav-blog'),    link: '/en/blog/'    },
                { text: getV('footer-nav-link3'),                               link: '#contacts'    },
            ].filter(l => l.text),
            catalog:   getV('footer-nav-catalog'), blog:      getV('footer-nav-blog'),
            link1:     getV('footer-nav-link1'),   link2:     getV('footer-nav-link2'),
            link3:     getV('footer-nav-link3'),   copyright: getV('footer-nav-copyright'),
        };
    }

    const newData = {
        ...existing, globalFields,
        translations: { ...existingTr, [lang]: { ...(existingTr[lang] || {}), ...localizedFields } },
    };
    const firestorePageId = pageId === 'blog-page' ? 'blog' : pageId;
    try {
        await setDoc(doc(db, 'pages', firestorePageId), newData, { merge: true });
        pagesCache[pageId] = newData;
        showToast(`✅ ${pageId} saved!`);
    } catch (err) {
        showToast('Error: ' + err.message, 'err');
        console.error(err);
    }
};

// ════════════════════════════════════════════════════════
// 15. INIT
// ════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
    // Wire up the login gate first, before anything else that could throw
    // and leave the page blank.
    initAuthGate();

    try {
    checkMob();
    window.addEventListener('resize', checkMob);
    document.querySelectorAll('.ni[data-p]').forEach(el  => el.addEventListener('click', () => goP(el.dataset.p)));
    document.querySelectorAll('.mni[data-p]').forEach(el => el.addEventListener('click', () => goP(el.dataset.p)));
    bindCrossFileLinks();
    document.querySelectorAll('.mo').forEach(o => o.addEventListener('click', e => { if (e.target === o) closeM(o.id); }));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') document.querySelectorAll('.mo.on').forEach(m => closeM(m.id)); });

    if (IS_CONTENT) {
        const confirmBtn = document.getElementById('mconf-confirm-btn');
        if (confirmBtn) confirmBtn.onclick = confirmDelete;

        document.getElementById('btn-new-prod')?.addEventListener('click', () => {
            currentEditingId = null; currentCollection = 'products';
            document.getElementById('prodtitle').textContent = 'New Product';
            document.querySelectorAll('#mprod input.fin, #mprod textarea.fta, #mprod textarea.fmono').forEach(el => el.value = '');
            document.querySelectorAll('#mprod select.fsel').forEach(el => el.selectedIndex = 0);
            document.getElementById('prod-delete-btn').style.display = 'none';
            const pillsGlobal = document.getElementById('pills-global'); if (pillsGlobal) pillsGlobal.innerHTML = ''; // legacy safety
            LANGS.forEach(lang => {
                const vb = document.getElementById(`${lang}-volumes-body`); if (vb) vb.innerHTML = '';
                const db2 = document.getElementById(`${lang}-dosage-body`); if (db2) db2.innerHTML = '';
                const ig = document.getElementById(`${lang}-ingren`); if (ig) ig.innerHTML = '';
                const dp = document.getElementById(`${lang}-descpoints-body`); if (dp) dp.innerHTML = '';
                const imgTa = document.getElementById(`${lang}-images-ta`); if (imgTa) imgTa.value = '';
                const pillsBox = document.getElementById(`pills-${lang}`); if (pillsBox) pillsBox.innerHTML = '';
                const ctaBox = document.getElementById(`${lang}-ctabuttons-body`); if (ctaBox) ctaBox.innerHTML = '';
            });
            updProdUrl(); showM('mprod');
        });

        document.getElementById('btn-new-blog')?.addEventListener('click', () => {
            currentEditingId = null; currentCollection = 'posts';
            document.getElementById('blogtitle').textContent = 'New Blog Post';
            document.querySelectorAll('#mblog input.fin, #mblog textarea.fta, #mblog textarea.fmono').forEach(el => el.value = '');
            document.querySelectorAll('#mblog select.fsel').forEach(el => el.selectedIndex = 0);
            document.getElementById('blog-delete-btn').style.display = 'none';
            blogTags = [];
            renderBlogTags();
            blogAvatarColor = 'blue';
            document.querySelectorAll('.av-swatch').forEach((sw, i) => sw.classList.toggle('on', i === 0));
            const avPrev = document.getElementById('blog-avatar-preview');
            if (avPrev) { avPrev.style.background = '#3b82f6'; avPrev.textContent = '??'; }
            const avVal = document.getElementById('blog-avcolor-val');
            if (avVal) avVal.textContent = 'blue';
            updBlogUrl(); showM('mblog');
        });

        const catDel  = document.getElementById('cat-delete-btn');
        const prodDel = document.getElementById('prod-delete-btn');
        const blogDel = document.getElementById('blog-delete-btn');
        if (catDel)  { catDel.onclick  = () => { if (currentEditingId) { closeM('mcat');  window._askDelete('categories', currentEditingId); }}; catDel.style.display  = 'none'; }
        if (prodDel) { prodDel.onclick = () => { if (currentEditingId) { closeM('mprod'); window._askDelete('products',   currentEditingId); }}; prodDel.style.display = 'none'; }
        if (blogDel) { blogDel.onclick = () => { if (currentEditingId) { closeM('mblog'); window._askDelete('posts',      currentEditingId); }}; blogDel.style.display = 'none'; }

        document.getElementById('swatches')?.addEventListener('click', e => {
            const sw = e.target.closest('.sw'); if (!sw) return;
            document.querySelectorAll('.sw').forEach(s => s.classList.remove('on'));
            sw.classList.add('on'); selColor = sw.dataset.c;
        });

        updProdUrl(); updBlogUrl(); updCatUrl();
        restoreSection();
    }

    if (IS_PAGES) {
        restoreSection();
    }
    } catch (err) {
        console.error('Admin panel init error (auth still works):', err);
    }
});

// ════════════════════════════════════════════════════════
// 16. AUTH GATE
// ════════════════════════════════════════════════════════
let _dataLoaded = false;

function showApp() {
    document.getElementById('login-screen').style.display = 'none';
    document.querySelector('.shell').style.display = 'flex';
}
function showLogin() {
    document.getElementById('login-screen').style.display = 'flex';
    document.querySelector('.shell').style.display = 'none';
}

function initAuthGate() {
    // Attach the login form handler FIRST and on its own, so that even if
    // something below throws, the form still works instead of falling back
    // to a native page-reloading submit.
    const form = document.getElementById('login-form');
    if (form) {
        form.addEventListener('submit', async e => {
            e.preventDefault();
            e.stopPropagation();
            console.log('[auth] login submit fired');
            const email  = document.getElementById('login-email').value.trim();
            const pass   = document.getElementById('login-password').value;
            const errEl  = document.getElementById('login-error');
            const btn    = document.getElementById('login-submit-btn');
            errEl.textContent = '';
            btn.disabled = true; btn.textContent = 'Signing in…';
            try {
                const cred = await signInWithEmailAndPassword(auth, email, pass);
                console.log('[auth] sign-in success', cred.user.email);
            } catch (err) {
                console.error('[auth] sign-in error:', err.code, err.message, err);
                const map = {
                    'auth/invalid-credential': 'Неверный email или пароль.',
                    'auth/user-not-found': 'Пользователь с таким email не найден.',
                    'auth/wrong-password': 'Неверный пароль.',
                    'auth/invalid-email': 'Некорректный email.',
                    'auth/user-disabled': 'Этот аккаунт отключён.',
                    'auth/too-many-requests': 'Слишком много попыток. Попробуйте позже.',
                    'auth/unauthorized-domain': 'Этот домен не разрешён в Firebase Auth (Authentication → Settings → Authorized domains).',
                    'auth/network-request-failed': 'Проблема с сетью/CORS при обращении к Firebase.',
                    'auth/invalid-api-key': 'Неверный API key в firebaseConfig.',
                    'auth/configuration-not-found': 'Email/Password провайдер не включён в Firebase Auth.',
                };
                errEl.textContent = map[err.code] || `Ошибка входа: ${err.code || err.message}`;
            } finally {
                btn.disabled = false; btn.textContent = 'Sign In';
            }
            return false;
        });
        console.log('[auth] login form listener attached');
    } else {
        console.error('[auth] #login-form not found in DOM');
    }

    document.getElementById('logout-btn')?.addEventListener('click', () => signOut(auth));

    try {
        onAuthStateChanged(auth, user => {
            console.log('[auth] state changed:', user ? user.email : 'signed out');
            if (user) {
                showApp();
                if (!_dataLoaded) {
                    _dataLoaded = true;
                    if (IS_CONTENT) loadAllData();
                    if (IS_PAGES)   loadPagesAndSettings();
                }
            } else {
                _dataLoaded = false;
                showLogin();
            }
        });
    } catch (err) {
        console.error('[auth] onAuthStateChanged setup failed:', err);
    }
}
