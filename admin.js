// ============================================================
//  RAKUN Admin Panel — Firebase SPA Controller (v5.0)
//  CHANGELOG v5.0 (патч поверх v4.0):
//
//  [FIX-1]  Блог: добавлены поля authorRole, authorInitials,
//           authorBio, authorAvatarColor, publishDate, emoji,
//           tags[], xDefaultHreflang, schemaJsonLd,
//           changeFrequency — полное соответствие БД и tpl_post.html
//
//  [FIX-2]  Блог: поля читаются по явному id (en-blog-h1, en-blog-mediaUrls
//           и т.д.) вместо хрупкого inputs[N] — надёжный маппинг.
//
//  [FIX-3]  Блог: savePost пишет чистые ключи без дублирования.
//
//  [FIX-4]  Hero Slides (Home): collectSlides() больше не пишет
//           двойные ключи (btnText+buttonText, bgImage+backgroundImageUrl).
//           Только один набор ключей, совместимый с generate_site.py.
//
//  [FIX-5]  Категории: поля читаются по явному id (cat-{lang}-{field})
//           вместо хрупкого inputs[N].
//
//  [FIX-6]  Блог: тег-управление (tags[]) через UI в глобальных полях.
//
//  [FIX-7]  Блог: avatar color picker — setBlogAvatarColor() + updateAvatarPreview().
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import {
    getFirestore, enableIndexedDbPersistence,
    collection, onSnapshot, doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, terminate
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const firebaseConfig = {
    apiKey:            "AIzaSyAGXs4wc4vcxxy2cMoHMC8_MlD9S_chSQY",
    authDomain:        "racun-shop.firebaseapp.com",
    projectId:         "racun-shop",
    storageBucket:     "racun-shop.appspot.com",
    messagingSenderId: "569457770232",
    appId:             "1:569457770232:web:5a2737d1ee270459f3050d"
};

const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);

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
let blogAvatarColor   = 'blue';    // [FIX-1] текущий цвет аватара блог-поста
let blogTags          = [];        // [FIX-6] массив тегов текущего поста
const pagesCache = {};
const pageLangs  = {
    home: 'en', catalog: 'en', 'blog-page': 'en',
    contacts: 'en', about: 'en', 'footer-nav': 'en'
};

// ════════════════════════════════════════════════════════
// 0. УТИЛИТЫ
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
// 1. ЗАГРУЗКА
// ════════════════════════════════════════════════════════
function loadAllData() {
    setV('fb-status', 'Loading…');

    onSnapshot(collection(db, 'categories'), snap => {
        state.categories = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderAll();
        if (state.products.length > 0 || state.posts.length > 0) setV('fb-status', 'Connected ✓');
    }, err => { console.error('categories:', err); showToast('Ошибка: ' + err.message, 'err'); });

    onSnapshot(collection(db, 'products'), snap => {
        state.products = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderAll();
        setV('fb-status', 'Connected ✓');
    }, err => { console.error('products:', err); showToast('Ошибка: ' + err.message, 'err'); });

    onSnapshot(collection(db, 'blog'), snap => {
        state.posts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderAll();
        setV('fb-status', 'Connected ✓');
    }, err => { console.error('blog:', err); showToast('Ошибка: ' + err.message, 'err'); });
}

// ════════════════════════════════════════════════════════
// 2. РЕНДЕРИНГ
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
        sel.innerHTML = pre + state.categories.map(c =>
            `<option value="${c.id}"${c.id === prev ? ' selected' : ''}>${escH(getLocalVal(c, 'name', 'en') || c.id)}</option>`
        ).join('');
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
        const price   = p.globalFields?.price  || '—';
        const status  = p.globalFields?.status || 'Draft';
        const slug    = p.globalFields?.slug   || p.id;
        const img     = p.globalFields?.images?.[0] || '';
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
// 3. ОТКРЫТИЕ ФОРМ РЕДАКТИРОВАНИЯ
// ════════════════════════════════════════════════════════

// [FIX-5] Категории: чтение по явным id вместо inputs[N]
window._editCat = function(id) {
    currentEditingId = id; currentCollection = 'categories';
    const cat = state.categories.find(x => x.id === id); if (!cat) return;
    document.getElementById('cattitle').textContent = 'Edit Category';
    setV('catstat', cat.status || cat.globalFields?.status || 'Active');
    setV('catslug', cat.slug   || cat.globalFields?.slug   || cat.id);
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
    });
    document.getElementById('cat-delete-btn').style.display = '';
    updCatUrl(); showM('mcat');
};

window._editProd = function(id) {
    currentEditingId = id; currentCollection = 'products';
    const p = state.products.find(x => x.id === id); if (!p) return;
    const gf = p.globalFields || {};
    document.getElementById('prodtitle').textContent = 'Edit Product';
    setV('prodstat',   gf.status           || 'Draft');
    setV('prodcatsel', gf.categoryId        || '');
    setV('prodprice',  gf.price             || '');
    setV('prodsku',    gf.sku               || '');
    setV('prodstock',  gf.stock             || '');
    setV('prodvol',    gf.weightVolume      || gf.volume || '');
    setV('prodbadge',  gf.badge             || '');
    setV('prodwashes', gf.washes            || '');
    setV('prodprio',   gf.priority          || '0.9');
    setV('prodslug',   gf.slug              || p.id);
    setV('prodregion', gf.regionHreflang    || gf.region || '');
    setV('prodogimg',  gf.ogImageUrl        || '');
    setV('prodctaLink',gf.ctaLink           || '');
    setV('prodsecLink',gf.secondaryButtonLink || '');
    setV('prodschema', gf.schemaJsonLd      || '');
    if (document.getElementById('prodfreq'))     setV('prodfreq',     gf.changeFrequency || 'monthly');
    if (document.getElementById('prodhreflang')) setV('prodhreflang', gf.xDefaultHreflang || 'en');
    const imgTa = document.getElementById('prod-images-ta');
    if (imgTa) imgTa.value = (gf.images || []).join('\n');
    const pillsBox = document.getElementById('pills-global');
    if (pillsBox) {
        pillsBox.innerHTML = '';
        (gf.featurePills || []).forEach(text => {
            const s = document.createElement('span'); s.className = 'pi';
            s.innerHTML = escH(text) + '<button onclick="this.closest(\'.pi\').remove()"><span class="material-symbols-outlined ic">close</span></button>';
            pillsBox.appendChild(s);
        });
    }
    setV('prodscent-top',  gf.scentNotes?.top    || '');
    setV('prodscent-mid',  gf.scentNotes?.middle  || '');
    setV('prodscent-base', gf.scentNotes?.base    || '');
    renderProdVolumes(gf.availableVolumes || []);
    renderProdDosage(gf.dosage || []);
    const ingren = document.getElementById('ingren');
    if (ingren) {
        ingren.innerHTML = '';
        (gf.ingredients || []).forEach(ing => {
            const r = document.createElement('div'); r.className = 'ir';
            r.innerHTML = `<input class="fin" placeholder="Ingredient name" value="${escH(ing.name || '')}"><input class="fin pct" placeholder="0%" value="${escH(ing.percentage || '')}"><button class="ib dr" onclick="this.parentNode.remove()"><span class="material-symbols-outlined ic">delete</span></button>`;
            ingren.appendChild(r);
        });
    }
    document.getElementById('prod-delete-btn').style.display = '';
    const prodFields = ['categoryLabel','productName','imageAltText','shortDescription','fullDescriptionHtml',
        'ctaButtonText','secondaryButtonText','buttonUrl','cardTitle','cardDescription',
        'seoTitle','metaDescription','ogTitle','ogDescription'];
    LANGS.forEach(lang => {
        prodFields.forEach(key => {
            const el = document.getElementById(`${lang}-${key}`);
            if (el) el.value = getLocalVal(p, key, lang);
        });
        renderDescPoints(lang, (p.translations?.[lang]?.descriptionPoints || []));
    });
    updProdUrl(); showM('mprod');
};

// [FIX-1] [FIX-2] Блог: полное заполнение формы по явным id
window._editPost = function(id) {
    currentEditingId = id; currentCollection = 'posts';
    const p = state.posts.find(x => x.id === id); if (!p) return;
    const gf = p.globalFields || {};
    document.getElementById('blogtitle').textContent = 'Edit Post';

    // Global fields
    setV('blogstat',        gf.status           || 'Draft');
    setV('blogcat',         gf.category          || '');
    setV('blogbadge',       gf.tagBadge          || '');
    setV('blogread',        gf.readTime          || '');
    setV('blogslug',        gf.slug              || p.id);
    setV('blogprio',        gf.priority          || '0.8');
    setV('blogregion',      gf.regionHreflang    || '');
    setV('blogogimg',       gf.ogImageUrl        || '');
    setV('blogschema',      gf.schemaJsonLd      || '');  // [FIX-1]
    setV('blogemoji',       gf.emoji             || '');  // [FIX-1]
    setV('blogauthorrole',  gf.authorRole        || '');  // [FIX-1]
    setV('blogauthorinitials', gf.authorInitials || '');  // [FIX-1]
    setV('blogauthorbio',   gf.authorBio         || '');  // [FIX-1]
    setV('blogauthor',      gf.authorName        || '');

    // publishDate — преобразуем в формат YYYY-MM-DD для <input type="date">
    // [FIX-1]
    const rawDate = gf.publishDate || '';
    if (rawDate) {
        try {
            // поддержка форматов "2025-03-15" и "March 15, 2025" и т.п.
            const d = new Date(rawDate);
            if (!isNaN(d)) {
                setV('blogpublishdate', d.toISOString().slice(0, 10));
            } else {
                setV('blogpublishdate', rawDate.slice(0, 10));
            }
        } catch { setV('blogpublishdate', ''); }
    } else {
        setV('blogpublishdate', '');
    }

    if (document.getElementById('blogfreq')) setV('blogfreq', gf.changeFrequency || 'weekly'); // [FIX-1]
    if (document.getElementById('bloghreflang')) setV('bloghreflang', gf.xDefaultHreflang || 'en'); // [FIX-1]

    // Avatar color [FIX-7]
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

    // Tags [FIX-6]
    blogTags = Array.isArray(gf.tags) ? [...gf.tags] : [];
    renderBlogTags();

    // Localized fields [FIX-2] — читаем по явным id
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
// 4. СОХРАНЕНИЕ
// ════════════════════════════════════════════════════════
async function persistToFirestore(colName, data) {
    const firestoreCol = colName === 'posts' ? 'blog' : colName;
    try {
        if (currentEditingId) {
            await updateDoc(doc(db, firestoreCol, currentEditingId), data);
            const key = colName === 'categories' ? 'categories' : colName === 'products' ? 'products' : 'posts';
            const i   = state[key].findIndex(x => x.id === currentEditingId);
            if (i !== -1) state[key][i] = { id: currentEditingId, ...data };
            showToast('✅ Сохранено в Firebase!');
        } else {
            const ref = await addDoc(collection(db, firestoreCol), data);
            const key = colName === 'categories' ? 'categories' : colName === 'products' ? 'products' : 'posts';
            state[key].push({ id: ref.id, ...data });
            showToast('✅ Создано в Firebase!');
        }
        renderAll();
        const modals = { categories: 'mcat', products: 'mprod', posts: 'mblog' };
        closeM(modals[colName]);
        currentEditingId = null;
    } catch (err) {
        console.error(err);
        showToast('Ошибка сохранения: ' + err.message, 'err');
    }
}

// [FIX-5] saveCategory — читает по явным id
window.saveCategory = async function() {
    const slug = getV('catslug').trim();
    if (!slug) { showToast('Укажите slug', 'err'); return; }
    const translations = {};
    LANGS.forEach(lang => {
        translations[lang] = {
            name:            getV(`cat-${lang}-name`).trim(),
            description:     getV(`cat-${lang}-description`).trim(),
            seoTitle:        getV(`cat-${lang}-seoTitle`).trim(),
            metaDescription: getV(`cat-${lang}-metaDescription`).trim(),
        };
    });
    await persistToFirestore('categories', {
        slug, status: getV('catstat'), color: selColor, translations,
        productCount: state.products.filter(p => p.globalFields?.categoryId === currentEditingId).length,
    });
};

window.saveProduct = async function() {
    const slug = getV('prodslug').trim();
    if (!slug) { showToast('Укажите slug продукта', 'err'); return; }
    const prodFields = ['categoryLabel','productName','imageAltText','shortDescription','fullDescriptionHtml',
        'ctaButtonText','secondaryButtonText','buttonUrl','cardTitle','cardDescription',
        'seoTitle','metaDescription','ogTitle','ogDescription'];
    const translations = {};
    LANGS.forEach(lang => {
        const obj = {};
        prodFields.forEach(key => { const el = document.getElementById(`${lang}-${key}`); obj[key] = el ? el.value.trim() : ''; });
        obj.descriptionPoints = collectDescPoints(lang);
        translations[lang] = obj;
    });
    const imgTa  = document.getElementById('prod-images-ta');
    const images = imgTa ? imgTa.value.split('\n').map(s => s.trim()).filter(Boolean) : [];
    const pillsBox = document.getElementById('pills-global');
    const featurePills = pillsBox ? Array.from(pillsBox.querySelectorAll('.pi')).map(el => el.childNodes[0]?.textContent?.trim() || '') : [];
    await persistToFirestore('products', {
        globalFields: {
            slug, status: getV('prodstat'), categoryId: getV('prodcatsel'),
            price: getV('prodprice'), sku: getV('prodsku'),
            stock: parseInt(getV('prodstock')) || 0,
            weightVolume: getV('prodvol'), badge: getV('prodbadge'),
            washes: getV('prodwashes'), priority: getV('prodprio'),
            changeFrequency: getV('prodfreq') || 'monthly',
            xDefaultHreflang: getV('prodhreflang') || 'en',
            regionHreflang: getV('prodregion'), ogImageUrl: getV('prodogimg'),
            ctaLink: getV('prodctaLink'), secondaryButtonLink: getV('prodsecLink'),
            schemaJsonLd: getV('prodschema'),
            images, featurePills,
            scentNotes: {
                top:    getV('prodscent-top'),
                middle: getV('prodscent-mid'),
                base:   getV('prodscent-base'),
            },
            availableVolumes: collectProdVolumes(),
            dosage:           collectProdDosage(),
            ingredients:      collectIngredients(),
        },
        translations,
        productName: translations.en?.productName || '',
        name:        translations.en?.productName || '',
    });
};

// [FIX-1] [FIX-2] [FIX-3] saveBlogPost — полные данные, без дублирования ключей
window.saveBlogPost = async function() {
    const slug = getV('blogslug').trim();
    if (!slug) { showToast('Укажите slug поста', 'err'); return; }

    // Форматируем publishDate обратно в строку
    const rawDate = getV('blogpublishdate');
    let publishDate = '';
    if (rawDate) {
        try {
            const d = new Date(rawDate);
            if (!isNaN(d)) {
                publishDate = d.toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });
            } else {
                publishDate = rawDate;
            }
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

    // [FIX-3] Только один набор ключей в globalFields — нет дублирования
    await persistToFirestore('posts', {
        globalFields: {
            slug,
            status:           getV('blogstat'),
            category:         getV('blogcat'),
            tagBadge:         getV('blogbadge'),
            readTime:         getV('blogread'),
            publishDate,                                    // [FIX-1]
            emoji:            getV('blogemoji'),            // [FIX-1]
            priority:         getV('blogprio'),
            changeFrequency:  getV('blogfreq') || 'weekly', // [FIX-1]
            xDefaultHreflang: getV('bloghreflang') || 'en', // [FIX-1]
            regionHreflang:   getV('blogregion'),
            ogImageUrl:       getV('blogogimg'),
            schemaJsonLd:     getV('blogschema'),           // [FIX-1]
            authorName:       getV('blogauthor'),
            authorRole:       getV('blogauthorrole'),       // [FIX-1]
            authorInitials:   getV('blogauthorinitials'),   // [FIX-1]
            authorBio:        getV('blogauthorbio'),        // [FIX-1]
            authorAvatarColor: blogAvatarColor,             // [FIX-7]
            tags:             [...blogTags],                // [FIX-6]
        },
        translations,
        // Корневые поля для быстрого поиска в Admin
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
        renderAll(); closeM('mconf'); showToast('🗑 Удалено');
    }).catch(err => showToast('Ошибка удаления: ' + err.message, 'err'));
    pendingDeleteId = null; pendingDeleteCol = null;
}

// ════════════════════════════════════════════════════════
// 6. НАВИГАЦИЯ
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
    settings:        { t: 'Settings',     c: '' },
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
    // default
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
    const cat  = document.getElementById('prodcatsel')?.selectedOptions[0]?.textContent.toLowerCase().replace(/\s+/g,'-') || 'category';
    setText('produp', `/en/products/${cat}/${slug}/`);
};
window.updBlogUrl = function() {
    const slug = getV('blogslug') || 'post-slug';
    setText('blogurlprev', `/en/blog/${slug}/`);
};
window.updCatUrl = function() {
    const slug = getV('catslug') || 'category-slug';
    setText('caturlprev', `/en/products/${slug}/`);
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
    document.querySelectorAll('#mcat input.fin').forEach(el => el.value = '');
    document.getElementById('catstat').value = 'Active';
    document.getElementById('cat-delete-btn').style.display = 'none';
    selColor = '#4f7dff';
    document.querySelectorAll('#swatches .sw').forEach((sw, i) => sw.classList.toggle('on', i === 0));
    updCatUrl(); showM('mcat');
};
window.filterProducts = function() { renderProducts(); };
window.filterBlog     = function() { renderBlog(); };
window.confirmLang    = function(type, lang) { /* placeholder for per-lang confirm workflow */ };

// ════════════════════════════════════════════════════════
// 11. AVATAR COLOR (Blog) [FIX-7]
// ════════════════════════════════════════════════════════
window.setBlogAvatarColor = function(color, el) {
    blogAvatarColor = color;
    document.querySelectorAll('.av-swatch').forEach(sw => sw.classList.toggle('on', sw === el));
    const avPrev = document.getElementById('blog-avatar-preview');
    if (avPrev) {
        avPrev.style.background = AVATAR_COLORS[color] || '#3b82f6';
    }
    const avVal = document.getElementById('blog-avcolor-val');
    if (avVal) avVal.textContent = color;
};

window.updateAvatarPreview = function() {
    const initials = getV('blogauthorinitials') || getV('blogauthor').split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase() || '??';
    const avPrev = document.getElementById('blog-avatar-preview');
    if (avPrev) avPrev.textContent = initials;
};

// ════════════════════════════════════════════════════════
// 12. TAGS UI (Blog) [FIX-6]
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
        if (val && !blogTags.includes(val)) {
            blogTags.push(val);
            renderBlogTags();
        }
        inp.value = '';
    } else if (e.key === 'Backspace' && inp.value === '' && blogTags.length) {
        blogTags.pop();
        renderBlogTags();
    }
};

// ════════════════════════════════════════════════════════
// 13. PRODUCT HELPERS (pills, volumes, dosage, ingredients, descPoints)
// ════════════════════════════════════════════════════════
window.addPill = function(scope) {
    const inp = document.getElementById(`pillin-${scope}`); if (!inp) return;
    const text = inp.value.trim(); if (!text) return;
    inp.value = '';
    const box = document.getElementById(`pills-${scope}`); if (!box) return;
    const s = document.createElement('span'); s.className = 'pi';
    s.innerHTML = escH(text) + '<button onclick="this.closest(\'.pi\').remove()"><span class="material-symbols-outlined ic">close</span></button>';
    box.appendChild(s);
};

window.addIngr = function() {
    const list = document.getElementById('ingren'); if (!list) return;
    const r = document.createElement('div'); r.className = 'ir';
    r.innerHTML = '<input class="fin" placeholder="Ingredient name"><input class="fin pct" placeholder="0%"><button class="ib dr" onclick="this.parentNode.remove()"><span class="material-symbols-outlined ic">delete</span></button>';
    list.appendChild(r);
};
function collectIngredients() {
    return Array.from(document.querySelectorAll('#ingren .ir')).map(r => {
        const inputs = r.querySelectorAll('input');
        return { name: inputs[0]?.value.trim() || '', percentage: inputs[1]?.value.trim() || '' };
    }).filter(i => i.name);
}

function renderProdVolumes(vols) {
    const body = document.getElementById('prod-volumes-body'); if (!body) return;
    body.innerHTML = vols.map((v, i) => `
        <div class="ir" data-idx="${i}" style="gap:8px;margin-bottom:8px;align-items:center">
          <input class="fin vol-label" placeholder="Label (2 L)" value="${escH(v.label || '')}">
          <input class="fin vol-value" placeholder="Value (2 L)" value="${escH(v.value || '')}">
          <input class="fin vol-link"  placeholder="Link (?id=slug-2l)" value="${escH(v.link || '')}">
          <button class="ib dr" onclick="this.parentNode.remove()"><span class="material-symbols-outlined ic">delete</span></button>
        </div>`).join('');
}
window.addProdVolume = function() { const vols = collectProdVolumes(); vols.push({label:'',value:'',link:''}); renderProdVolumes(vols); };
function collectProdVolumes() {
    return Array.from(document.querySelectorAll('#prod-volumes-body .ir')).map(r => ({
        label: r.querySelector('.vol-label')?.value.trim() || '',
        value: r.querySelector('.vol-value')?.value.trim() || '',
        link:  r.querySelector('.vol-link')?.value.trim()  || '',
    })).filter(v => v.label || v.value);
}

function renderProdDosage(rows) {
    const body = document.getElementById('prod-dosage-body'); if (!body) return;
    body.innerHTML = rows.map((d, i) => `
        <div class="ir" data-idx="${i}" style="gap:8px;margin-bottom:8px;align-items:center">
          <input class="fin dos-type"   placeholder="Type (Hand Wash)"  value="${escH(d.type   || '')}">
          <input class="fin dos-weight" placeholder="Load (4–6 kg)"     value="${escH(d.weight || '')}">
          <input class="fin dos-amount" placeholder="Amount (15 ml)"    value="${escH(d.amount || '')}">
          <button class="ib dr" onclick="this.parentNode.remove()"><span class="material-symbols-outlined ic">delete</span></button>
        </div>`).join('');
}
window.addProdDosage = function() { const rows = collectProdDosage(); rows.push({type:'',weight:'',amount:''}); renderProdDosage(rows); };
function collectProdDosage() {
    return Array.from(document.querySelectorAll('#prod-dosage-body .ir')).map(r => ({
        type:   r.querySelector('.dos-type')?.value.trim()   || '',
        weight: r.querySelector('.dos-weight')?.value.trim() || '',
        amount: r.querySelector('.dos-amount')?.value.trim() || '',
    })).filter(d => d.type || d.amount);
}

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

// ════════════════════════════════════════════════════════
// 14. PAGES & SETTINGS (admin-pages.html)
// ════════════════════════════════════════════════════════
async function loadPagesAndSettings() {
    try {
        const pageIds = ['home', 'catalog', 'blog', 'contacts', 'about', 'footer-nav'];
        await Promise.all(pageIds.map(async id => {
            const snap = await getDoc(doc(db, 'pages', id));
            const cacheKey = id === 'blog' ? 'blog-page' : id;
            pagesCache[cacheKey] = snap.exists() ? snap.data() : {};
        }));
        const settSnap = await getDoc(doc(db, 'settings', 'main'));
        pagesCache['settings'] = settSnap.exists() ? settSnap.data() : {};
        fillHomePage('en');
        fillPageFields('catalog',    'en');
        fillPageFields('blog-page',  'en');
        fillPageFields('contacts',   'en');
        fillPageFields('about',      'en');
        fillPageFields('footer-nav', 'en');
        fillSettings();
    } catch (err) {
        console.error('Pages load error:', err);
        showToast('Ошибка загрузки Pages: ' + err.message, 'err');
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
    setV('home-productsLabel',  lo.productsLabel  || lo.productsSectionLabel || gf.productsLabel  || '');
    setV('home-productsTitle',  lo.productsTitle  || lo.productsSectionTitle || gf.productsTitle  || '');
    setV('home-blogLabel',      lo.blogLabel      || lo.blogSectionLabel     || gf.blogLabel      || '');
    setV('home-blogTitle',      lo.blogTitle      || lo.blogSectionTitle     || gf.blogTitle      || '');
    setV('home-reviewsLabel',   lo.reviewsLabel   || lo.reviewsSectionLabel  || gf.reviewsLabel   || '');
    setV('home-reviewsTitle',   lo.reviewsTitle   || lo.reviewsSectionTitle  || gf.reviewsTitle   || '');
    setV('home-seoTitle',        lo.seoTitle        || gf.seoTitle        || '');
    setV('home-metaDescription', lo.metaDescription || gf.metaDescription || '');
    setV('home-ogTitle',         lo.ogTitle         || gf.ogTitle         || '');
    setV('home-ogDescription',   lo.ogDescription   || gf.ogDescription   || '');
    setV('home-ogImageUrl',      gf.ogImageUrl      || lo.ogImageUrl      || '');
    setV('home-schemaOrg',       gf.schemaOrg       || '');
    setV('home-xDefaultHreflang', gf.xDefaultHreflang || 'en');
    setV('home-regionHreflang',   gf.regionHreflang   || '');
    const rawSlides = lo.heroSlides || lo.slides || gf.heroSlides || gf.slides || [];
    renderSlides(rawSlides.map(s => ({
        subtitle: s.subtitle || '',
        headline: s.headline || '',
        // [FIX-4] читаем оба варианта ключей из старых данных
        bgImage:  s.backgroundImageUrl || s.bgImage || '',
        btnText:  s.buttonText || s.btnText || '',
        btnUrl:   s.buttonLink || s.btnUrl  || s.btnLink || '',
    })));
    const rawReviews = lo.reviews || gf.reviews || [];
    renderReviews(rawReviews.map(r => ({
        author: r.author || '', role: r.role || '', text: r.reviewText || r.text || '',
    })));
}

function renderSlides(slides) {
    const body = document.getElementById('home-slides-body'); if (!body) return;
    body.innerHTML = slides.map((s, i) => `
        <div class="slide-row" data-idx="${i}" style="margin-bottom:18px;padding:16px;background:var(--bg3);border-radius:8px;border:1px solid var(--border2)">
          <div style="font-size:12px;font-weight:700;color:var(--text2);margin-bottom:10px;display:flex;justify-content:space-between;align-items:center">
            SLIDE ${i + 1}<button class="ib dr" onclick="removeSlide(${i})"><span class="material-symbols-outlined ic">delete</span></button>
          </div>
          <div class="fg">
            <div class="fi"><label class="fl">Subtitle</label><input class="fin slide-subtitle" value="${escH(s.subtitle || '')}"></div>
            <div class="fi"><label class="fl">Button Text</label><input class="fin slide-btnText" value="${escH(s.btnText || '')}"></div>
            <div class="fi full"><label class="fl">Headline</label><input class="fin slide-headline" value="${escH(s.headline || '')}"></div>
            <div class="fi full"><label class="fl">Background Image URL</label><input class="fin slide-bgImage" value="${escH(s.bgImage || '')}"></div>
            <div class="fi"><label class="fl">Button URL</label><input class="fin slide-btnUrl" value="${escH(s.btnUrl || '')}"></div>
          </div>
        </div>`).join('');
}
window.addSlide    = function() { const e = collectSlides(); e.push({subtitle:'',headline:'',btnText:'',btnUrl:'',bgImage:''}); renderSlides(e); };
window.removeSlide = function(idx) { const s = collectSlides(); s.splice(idx, 1); renderSlides(s); };

// [FIX-4] collectSlides — только один набор ключей, совместимых с generate_site.py
function collectSlides() {
    return Array.from(document.querySelectorAll('#home-slides-body .slide-row')).map(r => ({
        subtitle:           r.querySelector('.slide-subtitle')?.value.trim() || '',
        headline:           r.querySelector('.slide-headline')?.value.trim() || '',
        // generate_site.py читает: s.get("backgroundImageUrl") or s.get("bgImage")
        // Пишем только backgroundImageUrl — канонический ключ
        backgroundImageUrl: r.querySelector('.slide-bgImage')?.value.trim()  || '',
        // generate_site.py читает: s.get("buttonText") or s.get("btnText")
        buttonText:         r.querySelector('.slide-btnText')?.value.trim()  || '',
        // generate_site.py читает: s.get("buttonLink") or s.get("btnUrl")
        buttonLink:         r.querySelector('.slide-btnUrl')?.value.trim()   || '',
    }));
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
        setV('catalog-regionHreflang',   gf.regionHreflang   || '');
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
        setV('blog-page-regionHreflang',   gf.regionHreflang   || '');
    }
    if (pageId === 'contacts') {
        setV('contacts-label',           lo.label           || gf.label          || '');
        setV('contacts-title',           lo.title           || gf.title          || '');
        setV('contacts-heroDescription', lo.heroDescription || gf.heroDescription|| '');
        setV('contacts-workingHours',    lo.workingHours    || gf.workingHours   || '');
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
        setV('contacts-xDefaultHreflang', gf.xDefaultHreflang || 'en');
        setV('contacts-regionHreflang',   gf.regionHreflang   || '');
        renderContactStores(d.stores || gf.stores || []);
        renderContactFaq(lo.faq || gf.faq || []);
    }
    if (pageId === 'about') {
        setV('about-heroTitle',      lo.heroTitle      || lo.title          || gf.heroTitle      || '');
        setV('about-contentHtml',    lo.contentHtml    || gf.contentHtml    || '');
        setV('about-schema',         lo.schema         || gf.schema         || '');
        setV('about-mainImage',      gf.mainImage      || '');
        setV('about-ogImageUrl',     gf.ogImageUrl     || lo.ogImageUrl     || '');
        setV('about-seoTitle',       lo.seoTitle       || gf.seoTitle       || '');
        setV('about-metaDescription',lo.metaDescription|| gf.metaDescription|| '');
        setV('about-ogTitle',        lo.ogTitle        || gf.ogTitle        || '');
        setV('about-ogDescription',  lo.ogDescription  || gf.ogDescription  || '');
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

function fillSettings() {
    const s = pagesCache['settings'] || {};
    setV('settings-siteName',        s.siteName        || s.admin?.siteName    || '');
    setV('settings-defaultLang',     s.defaultLang     || s.admin?.defaultLang || 'en');
    setV('settings-metaDescription', s.metaDescription || '');
    setV('settings-adminName',       s.admin           || '');
    setV('settings-prefix-en',       s.languagePrefixes?.en || 'en');
    setV('settings-prefix-ru',       s.languagePrefixes?.ru || 'ru');
    setV('settings-prefix-ka',       s.languagePrefixes?.ka || 'ka');
    setV('settings-prefix-hy',       s.languagePrefixes?.hy || 'hy');
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
            productsLabel:   getV('home-productsLabel'),   productsTitle:   getV('home-productsTitle'),
            blogLabel:       getV('home-blogLabel'),        blogTitle:       getV('home-blogTitle'),
            reviewsLabel:    getV('home-reviewsLabel'),     reviewsTitle:    getV('home-reviewsTitle'),
            seoTitle:        getV('home-seoTitle'),         metaDescription: getV('home-metaDescription'),
            ogTitle:         getV('home-ogTitle'),          ogDescription:   getV('home-ogDescription'),
            heroSlides:      collectSlides(),               // [FIX-4] чистые ключи
            reviews:         collectReviews().map(r => ({ author: r.author, role: r.role, reviewText: r.text })),
        };
        globalFields.ogImageUrl       = getV('home-ogImageUrl');
        globalFields.schemaOrg        = getV('home-schemaOrg');
        globalFields.xDefaultHreflang = getV('home-xDefaultHreflang') || 'en';
        globalFields.regionHreflang   = getV('home-regionHreflang');
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
        globalFields.regionHreflang   = getV('catalog-regionHreflang');
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
        globalFields.regionHreflang   = getV('blog-page-regionHreflang');
    } else if (pageId === 'contacts') {
        localizedFields = {
            label:           getV('contacts-label'),       title:           getV('contacts-title'),
            heroDescription: getV('contacts-heroDescription'), workingHours: getV('contacts-workingHours'),
            ctaTitle:        getV('contacts-ctaTitle'),    ctaButton:       getV('contacts-ctaButton'),
            logisticsTerms:  getV('contacts-logisticsTerms'),
            seoTitle:        getV('contacts-seoTitle'),    metaDescription: getV('contacts-metaDescription'),
            ogTitle:         getV('contacts-ogTitle'),     ogDescription:   getV('contacts-ogDescription'),
            faq:             collectContactFaq(),
        };
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
        globalFields.regionHreflang   = getV('contacts-regionHreflang');
    } else if (pageId === 'about') {
        localizedFields = {
            heroTitle:       getV('about-heroTitle'),
            contentHtml:     getV('about-contentHtml'),
            schema:          getV('about-schema'),
            seoTitle:        getV('about-seoTitle'),        metaDescription: getV('about-metaDescription'),
            ogTitle:         getV('about-ogTitle'),         ogDescription:   getV('about-ogDescription'),
        };
        globalFields.mainImage  = getV('about-mainImage');
        globalFields.ogImageUrl = getV('about-ogImageUrl');
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
        showToast(`✅ ${pageId} сохранено!`);
    } catch (err) {
        showToast('Ошибка: ' + err.message, 'err');
        console.error(err);
    }
};

window.saveSettings = async function() {
    const data = {
        siteName:        getV('settings-siteName'),   defaultLang:     getV('settings-defaultLang'),
        metaDescription: getV('settings-metaDescription'), admin:     getV('settings-adminName'),
        languagePrefixes: {
            en: getV('settings-prefix-en') || 'en', ru: getV('settings-prefix-ru') || 'ru',
            ka: getV('settings-prefix-ka') || 'ka', hy: getV('settings-prefix-hy') || 'hy',
        },
    };
    try {
        await setDoc(doc(db, 'settings', 'main'), data, { merge: true });
        pagesCache['settings'] = data;
        showToast('✅ Settings сохранены!');
    } catch (err) {
        showToast('Ошибка: ' + err.message, 'err');
        console.error(err);
    }
};

// ════════════════════════════════════════════════════════
// 15. ИНИЦИАЛИЗАЦИЯ
// ════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
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
            document.querySelectorAll('#mprod input.fin, #mprod textarea.fta').forEach(el => el.value = '');
            document.querySelectorAll('#mprod select.fsel').forEach(el => el.selectedIndex = 0);
            document.getElementById('prod-delete-btn').style.display = 'none';
            const pillsGlobal = document.getElementById('pills-global'); if (pillsGlobal) pillsGlobal.innerHTML = '';
            ['prod-volumes-body','prod-dosage-body','ingren'].forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = ''; });
            LANGS.forEach(lang => { const b = document.getElementById(`${lang}-descpoints-body`); if (b) b.innerHTML = ''; });
            updProdUrl(); showM('mprod');
        });

        document.getElementById('btn-new-blog')?.addEventListener('click', () => {
            currentEditingId = null; currentCollection = 'posts';
            document.getElementById('blogtitle').textContent = 'New Blog Post';
            document.querySelectorAll('#mblog input.fin, #mblog textarea.fta, #mblog textarea.fmono').forEach(el => el.value = '');
            document.querySelectorAll('#mblog select.fsel').forEach(el => el.selectedIndex = 0);
            document.getElementById('blog-delete-btn').style.display = 'none';
            // Сбрасываем теги и аватар
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
        loadAllData();
    }

    if (IS_PAGES) {
        restoreSection();
        loadPagesAndSettings();
    }
});
