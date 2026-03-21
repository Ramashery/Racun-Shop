// ============================================================
//  RAKUN Admin Panel — Firebase SPA Controller
//  Подключает данные из Firestore и обеспечивает их редактирование
// ============================================================
import {
    db,
    collection, getDocs,
    doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc
} from './firebase-config.js';

// ─── Константы ──────────────────────────────────────────────
const LANGS = ['en', 'ru', 'ka', 'hy'];

// ─── Глобальный стейт ───────────────────────────────────────
let state = { categories: [], products: [], posts: [] };
let currentEditingId   = null;   // id редактируемого документа
let currentCollection  = null;   // 'categories' | 'products' | 'posts'
let selColor           = '#4f7dff';

// ════════════════════════════════════════════════════════════
// 0. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ════════════════════════════════════════════════════════════
function getLocalVal(docData, key, lang = 'en') {
    if (!docData) return '';
    if (docData.translations?.[lang]?.[key]) return docData.translations[lang][key];
    if (docData[lang]?.[key])                return docData[lang][key];
    if (docData.globalFields?.[key])         return docData.globalFields[key];
    return docData[key] || '';
}

function showToast(msg, type = 'ok') {
    let t = document.getElementById('admin-toast');
    if (!t) {
        t = document.createElement('div');
        t.id = 'admin-toast';
        t.style.cssText = `
            position:fixed;bottom:28px;right:28px;z-index:9999;
            padding:12px 22px;border-radius:10px;font-size:14px;font-weight:600;
            color:#fff;box-shadow:0 4px 20px rgba(0,0,0,.25);
            transition:opacity .3s;pointer-events:none;`;
        document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.background = type === 'ok' ? '#22c55e' : '#ef4444';
    t.style.opacity = '1';
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.style.opacity = '0'; }, 3000);
}

// ════════════════════════════════════════════════════════════
// 1. ЗАГРУЗКА ДАННЫХ ИЗ FIRESTORE
// ════════════════════════════════════════════════════════════
async function loadAllData() {
    showLoadingState(true);
    try {
        const [catSnap, prodSnap, postSnap] = await Promise.all([
            getDocs(collection(db, 'categories')),
            getDocs(collection(db, 'products')),
            getDocs(collection(db, 'posts')),
        ]);

        state.categories = catSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        state.products   = prodSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        state.posts      = postSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        renderAllTables();
        console.log('✅ Firebase data loaded:', state);
    } catch (err) {
        console.error('❌ Firebase load error:', err);
        showToast('Ошибка загрузки данных. Проверьте консоль.', 'err');
    } finally {
        showLoadingState(false);
    }
}

function showLoadingState(on) {
    // Добавляем/убираем индикатор загрузки в заголовке таблиц
    document.querySelectorAll('.tw').forEach(el => {
        el.style.opacity = on ? '0.5' : '1';
        el.style.pointerEvents = on ? 'none' : '';
    });
}

// ════════════════════════════════════════════════════════════
// 2. РЕНДЕРИНГ ТАБЛИЦ
// ════════════════════════════════════════════════════════════
function renderAllTables() {
    renderCategories();
    renderProducts();
    renderBlog();
}

// ── Categories ───────────────────────────────────────────────
function renderCategories() {
    const tb   = document.getElementById('cattbody');
    const grid = document.getElementById('catgrid');
    const mob  = document.getElementById('catmob');

    safeSet('bdgc', state.categories.length);
    safeSet('catcntlbl', state.categories.length + ' categories');

    if (tb) {
        tb.innerHTML = state.categories.map(c => {
            const name  = getLocalVal(c, 'name', 'en') || c.id;
            const slug  = c.globalFields?.slug || c.id;
            const color = c.globalFields?.color || '#4f7dff';
            const status = c.globalFields?.status || 'Active';
            const count = state.products.filter(p => p.globalFields?.categoryId === c.id).length;
            return `<tr>
              <td><div style="display:flex;align-items:center;gap:10px">
                <div style="width:10px;height:10px;border-radius:50%;background:${color};flex-shrink:0"></div>
                <strong>${escHtml(name)}</strong></div></td>
              <td style="font-family:'IBM Plex Mono',monospace;font-size:12px;color:var(--text2)">${escHtml(slug)}</td>
              <td>${count}</td>
              <td><div class="lf">${LANGS.map(l=>`<span class="lfl d">${l.toUpperCase()}</span>`).join('')}</div></td>
              <td><span class="sb2 ${status==='Active'?'sp':'sa'}">${status}</span></td>
              <td style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--text2)">/en/products/${escHtml(slug)}/</td>
              <td><div class="ra">
                <button class="ib" onclick="window.editCategory('${c.id}')">
                  <span class="material-symbols-outlined ic">edit</span>
                </button>
                <button class="ib dr" onclick="window.deleteItem('categories','${c.id}')">
                  <span class="material-symbols-outlined ic">delete</span>
                </button>
              </div></td>
            </tr>`;
        }).join('');
    }

    // Карточки категорий (catgrid)
    if (grid) {
        grid.innerHTML = state.categories.map(c => {
            const name  = getLocalVal(c, 'name', 'en') || c.id;
            const slug  = c.globalFields?.slug || c.id;
            const color = c.globalFields?.color || '#4f7dff';
            const status = c.globalFields?.status || 'Active';
            const count = state.products.filter(p => p.globalFields?.categoryId === c.id).length;
            return `<div class="cc">
              <div class="cdot" style="background:${color}"></div>
              <div class="ci2">
                <div class="cn">${escHtml(name)}</div>
                <div class="csl">/${escHtml(slug)}/</div>
                <div class="cct">${count} product${count!==1?'s':''} · ${status}</div>
              </div>
              <div class="ca">
                <button class="ib" onclick="window.editCategory('${c.id}')">
                  <span class="material-symbols-outlined ic">edit</span>
                </button>
              </div>
            </div>`;
        }).join('');
    }

    // Обновляем селекты категорий в модалках продуктов
    ['prodcatsel', 'pf-cat'].forEach(selId => {
        const sel = document.getElementById(selId);
        if (!sel) return;
        const prev = sel.value;
        const prefix = selId === 'pf-cat' ? '<option value="">All categories</option>' : '';
        sel.innerHTML = prefix + state.categories.map(c =>
            `<option value="${c.id}"${c.id===prev?' selected':''}>${escHtml(getLocalVal(c,'name','en')||c.id)}</option>`
        ).join('');
    });
}

// ── Products ─────────────────────────────────────────────────
function renderProducts() {
    const tb = document.getElementById('products-tbody');
    safeSet('bdgp', state.products.length);
    if (!tb) return;

    tb.innerHTML = state.products.map(p => {
        const name    = getLocalVal(p, 'productName', 'en') || getLocalVal(p, 'name', 'en') || 'Unnamed';
        const catId   = p.globalFields?.categoryId;
        const catObj  = state.categories.find(c => c.id === catId);
        const catName = catObj ? (getLocalVal(catObj, 'name', 'en') || catId) : 'Unknown';
        const catSlug = catObj?.globalFields?.slug || 'category';
        const price   = p.globalFields?.price || '—';
        const status  = p.globalFields?.status || 'Draft';
        const slug    = p.globalFields?.slug || p.id;
        const img     = p.globalFields?.images?.[0] || 'https://via.placeholder.com/44';
        return `<tr>
          <td><div class="pnc">
            <img src="${escHtml(img)}" class="pth" style="object-fit:contain" onerror="this.src='https://via.placeholder.com/44'">
            <div class="pni"><div class="pnm">${escHtml(name)}</div><div class="pcm">${p.id}</div></div>
          </div></td>
          <td>${escHtml(catName)}</td>
          <td><strong>${escHtml(String(price))}</strong></td>
          <td><div class="lf">${LANGS.map(l=>`<span class="lfl d">${l.toUpperCase()}</span>`).join('')}</div></td>
          <td><span class="sb2 ${status.toLowerCase()==='published'?'sp':'sa'}">${status}</span></td>
          <td style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--text2)">/en/products/${escHtml(catSlug)}/${escHtml(slug)}/</td>
          <td><div class="ra">
            <button class="ib" onclick="window.editProduct('${p.id}')">
              <span class="material-symbols-outlined ic">edit</span>
            </button>
            <button class="ib dr" onclick="window.deleteItem('products','${p.id}')">
              <span class="material-symbols-outlined ic">delete</span>
            </button>
          </div></td>
        </tr>`;
    }).join('');
}

// ── Blog Posts ────────────────────────────────────────────────
function renderBlog() {
    const tb = document.getElementById('blog-tbody');
    safeSet('bdgb', state.posts.length);
    if (!tb) return;

    tb.innerHTML = state.posts.map(p => {
        const title  = getLocalVal(p, 'name', 'en') || getLocalVal(p, 'title', 'en') || 'Untitled';
        const cat    = p.globalFields?.categoryId || 'Article';
        const author = p.globalFields?.author || 'Admin';
        const status = p.globalFields?.status || 'Draft';
        const slug   = p.globalFields?.slug || p.id;
        const img    = p.globalFields?.images?.[0] || 'https://via.placeholder.com/44';
        return `<tr>
          <td><div class="pnc">
            <img src="${escHtml(img)}" class="pth" style="object-fit:cover" onerror="this.src='https://via.placeholder.com/44'">
            <div class="pni"><div class="pnm">${escHtml(title)}</div><div class="pcm">${p.id}</div></div>
          </div></td>
          <td>${escHtml(cat)}</td>
          <td>${escHtml(author)}</td>
          <td><div class="lf">${LANGS.map(l=>`<span class="lfl d">${l.toUpperCase()}</span>`).join('')}</div></td>
          <td><span class="sb2 ${status.toLowerCase()==='published'?'sp':'sa'}">${status}</span></td>
          <td style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--text2)">/en/blog/${escHtml(slug)}/</td>
          <td><div class="ra">
            <button class="ib" onclick="window.editPost('${p.id}')">
              <span class="material-symbols-outlined ic">edit</span>
            </button>
            <button class="ib dr" onclick="window.deleteItem('posts','${p.id}')">
              <span class="material-symbols-outlined ic">delete</span>
            </button>
          </div></td>
        </tr>`;
    }).join('');
}

// ════════════════════════════════════════════════════════════
// 3. ОТКРЫТИЕ МОДАЛОК — ЗАПОЛНЕНИЕ ПОЛЕЙ
// ════════════════════════════════════════════════════════════

// ── Category ─────────────────────────────────────────────────
window.editCategory = function(id) {
    currentEditingId  = id;
    currentCollection = 'categories';
    const cat = state.categories.find(c => c.id === id);
    if (!cat) return;

    document.getElementById('cattitle').textContent = 'Edit Category';
    setVal('catstat', cat.globalFields?.status || 'Active');
    setVal('catslug', cat.globalFields?.slug || cat.id);

    // Цветовые свотчи
    selColor = cat.globalFields?.color || '#4f7dff';
    document.querySelectorAll('#mcat .sw').forEach(s =>
        s.classList.toggle('on', s.dataset.c === selColor)
    );

    // Локализованные поля
    LANGS.forEach(lang => {
        const pane = document.getElementById(`cat-lang-${lang}`);
        if (!pane) return;
        const inputs = pane.querySelectorAll('input.fin');
        if (inputs[0]) inputs[0].value = getLocalVal(cat, 'name', lang);
        if (inputs[1]) inputs[1].value = getLocalVal(cat, 'description', lang);
        if (inputs[2]) inputs[2].value = getLocalVal(cat, 'seoTitle', lang);
        if (inputs[3]) inputs[3].value = getLocalVal(cat, 'metaDescription', lang);
    });

    if (typeof updCatUrl === 'function') updCatUrl();
    showM('mcat');
};

window.openNewCategory = function() {
    currentEditingId  = null;
    currentCollection = 'categories';
    document.getElementById('cattitle').textContent = 'New Category';
    clearModal('mcat');
    setVal('catstat', 'Active');
    selColor = '#4f7dff';
    document.querySelectorAll('#mcat .sw').forEach(s =>
        s.classList.toggle('on', s.dataset.c === '#4f7dff')
    );
    if (typeof updCatUrl === 'function') updCatUrl();
    showM('mcat');
};

// ── Product ───────────────────────────────────────────────────
window.editProduct = function(id) {
    currentEditingId  = id;
    currentCollection = 'products';
    const prod = state.products.find(p => p.id === id);
    if (!prod) return;

    const gf = prod.globalFields || {};

    // Глобальные поля — ищем по id атрибутам или позиции внутри .gf-block
    setVal('prodstat',   gf.status || 'Draft');
    setVal('prodcatsel', gf.categoryId || '');
    setVal('prodslug',   gf.slug || prod.id);
    setVal('prodprice',  gf.price || '');
    setVal('prodsku',    gf.sku || '');
    setVal('prodstock',  gf.stock || '');
    setVal('prodvol',    gf.volume || '');
    setVal('prodprio',   gf.priority || '0.8');
    setVal('prodregion', gf.region || '');
    setVal('prodogimg',  gf.ogImageUrl || '');

    // Изображения (textarea в EN панели)
    const imgTa = document.querySelector('#prod-lp-en textarea.fta');
    if (imgTa) imgTa.value = (gf.images || []).join(',\n');

    // Локализованные поля
    LANGS.forEach(lang => {
        const pane = document.getElementById(`prod-lp-${lang}`);
        if (!pane) return;

        const inputs    = Array.from(pane.querySelectorAll('input.fin'));
        const textareas = Array.from(pane.querySelectorAll('textarea.fta'));

        // Маппинг ключей → порядок input[].fin в панели (по HTML)
        const fieldMap = [
            ['categoryLabel', inputs[0]],
            ['productName',   inputs[1]],
            // inputs[2] — Feature Pills (пропускаем, если EN)
        ];

        let i = lang === 'en' ? 3 : 2; // пропускаем Pills-input только в EN
        const extra = [
            'ctaButtonText', 'secondaryButtonText', 'buttonUrl',
            'cardTitle', 'cardDescription',
            'seoTitle', 'metaDescription', 'ogTitle', 'ogDescription'
        ];
        extra.forEach(key => {
            if (inputs[i]) inputs[i].value = getLocalVal(prod, key, lang);
            i++;
        });

        fieldMap.forEach(([key, el]) => { if (el) el.value = getLocalVal(prod, key, lang); });

        // Textareas: [0]=images (только EN), [1]=shortDesc, [2]=fullHtml
        const taOffset = lang === 'en' ? 0 : -1; // в EN первая textarea — изображения
        const shortTa  = textareas[lang === 'en' ? 1 : 0];
        const fullTa   = textareas[lang === 'en' ? 2 : 1];
        if (shortTa) shortTa.value = getLocalVal(prod, 'shortDescription', lang);
        if (fullTa)  fullTa.value  = getLocalVal(prod, 'fullDescriptionHtml', lang) || getLocalVal(prod, 'fullDescription', lang);
    });

    if (typeof updProdUrl === 'function') updProdUrl();
    showM('mprod');
};

window.openNewProduct = function() {
    currentEditingId  = null;
    currentCollection = 'products';
    document.querySelectorAll('#mprod input.fin, #mprod textarea.fta, #mprod select.fsel').forEach(el => {
        if (el.tagName === 'SELECT') el.selectedIndex = 0;
        else el.value = '';
    });
    if (typeof updProdUrl === 'function') updProdUrl();
    showM('mprod');
};

// ── Blog Post ─────────────────────────────────────────────────
window.editPost = function(id) {
    currentEditingId  = id;
    currentCollection = 'posts';
    const post = state.posts.find(p => p.id === id);
    if (!post) return;

    const gf = post.globalFields || {};

    setVal('blogstat',   gf.status || 'Draft');
    setVal('blogcat',    gf.categoryId || '');
    setVal('blogauthor', gf.author || '');
    setVal('blogbadge',  gf.tagBadge || '');
    setVal('blogread',   gf.readTime || '');
    setVal('blogslug',   gf.slug || post.id);
    setVal('blogprio',   gf.priority || '0.8');
    setVal('blogregion', gf.region || '');
    setVal('blogogimg',  gf.ogImageUrl || '');

    LANGS.forEach(lang => {
        const pane = document.getElementById(`blog-lp-${lang}`);
        if (!pane) return;
        const inputs    = Array.from(pane.querySelectorAll('input.fin'));
        const textareas = Array.from(pane.querySelectorAll('textarea.fta'));

        if (textareas[0]) textareas[0].value = getLocalVal(post, 'fullDescriptionHtml', lang) || getLocalVal(post, 'fullDescription', lang);

        const fieldKeys = ['h1', 'mediaUrls', 'imageAltText', 'cardTitle', 'cardDescription', 'seoTitle', 'metaDescription', 'ogTitle', 'ogDescription'];
        fieldKeys.forEach((key, idx) => { if (inputs[idx]) inputs[idx].value = getLocalVal(post, key, lang); });
    });

    if (typeof updBlogUrl === 'function') updBlogUrl();
    showM('mblog');
};

window.openNewPost = function() {
    currentEditingId  = null;
    currentCollection = 'posts';
    document.querySelectorAll('#mblog input.fin, #mblog textarea.fta, #mblog select.fsel').forEach(el => {
        if (el.tagName === 'SELECT') el.selectedIndex = 0;
        else el.value = '';
    });
    if (typeof updBlogUrl === 'function') updBlogUrl();
    showM('mblog');
};

// ════════════════════════════════════════════════════════════
// 4. СОХРАНЕНИЕ В FIRESTORE
// ════════════════════════════════════════════════════════════

// ── Save Category ─────────────────────────────────────────────
window.saveCategory = async function() {
    const slug   = getVal('catslug').trim();
    const status = getVal('catstat');

    if (!slug) { showToast('Укажите slug категории', 'err'); return; }

    // Собираем локализованные данные
    const translations = {};
    LANGS.forEach(lang => {
        const pane = document.getElementById(`cat-lang-${lang}`);
        if (!pane) return;
        const inputs = pane.querySelectorAll('input.fin');
        translations[lang] = {
            name:            inputs[0]?.value.trim() || '',
            description:     inputs[1]?.value.trim() || '',
            seoTitle:        inputs[2]?.value.trim() || '',
            metaDescription: inputs[3]?.value.trim() || '',
        };
    });

    const data = {
        globalFields: { slug, status, color: selColor },
        translations,
        // Для обратной совместимости — также пишем en-поля в корень
        ...translations.en,
    };

    await saveToFirestore('categories', data);
};

// ── Save Product ──────────────────────────────────────────────
window.saveProduct = async function() {
    const slug = getVal('prodslug').trim();
    if (!slug) { showToast('Укажите slug продукта', 'err'); return; }

    const translations = {};
    LANGS.forEach(lang => {
        const pane = document.getElementById(`prod-lp-${lang}`);
        if (!pane) return;
        const inputs    = Array.from(pane.querySelectorAll('input.fin'));
        const textareas = Array.from(pane.querySelectorAll('textarea.fta'));

        const shortTa = textareas[lang === 'en' ? 1 : 0];
        const fullTa  = textareas[lang === 'en' ? 2 : 1];

        let i = lang === 'en' ? 3 : 2;
        const obj = {
            categoryLabel:       inputs[0]?.value.trim() || '',
            productName:         inputs[1]?.value.trim() || '',
            ctaButtonText:       inputs[i++]?.value.trim() || '',
            secondaryButtonText: inputs[i++]?.value.trim() || '',
            buttonUrl:           inputs[i++]?.value.trim() || '',
            cardTitle:           inputs[i++]?.value.trim() || '',
            cardDescription:     inputs[i++]?.value.trim() || '',
            seoTitle:            inputs[i++]?.value.trim() || '',
            metaDescription:     inputs[i++]?.value.trim() || '',
            ogTitle:             inputs[i++]?.value.trim() || '',
            ogDescription:       inputs[i++]?.value.trim() || '',
            shortDescription:    shortTa?.value.trim() || '',
            fullDescriptionHtml: fullTa?.value.trim() || '',
        };
        translations[lang] = obj;
    });

    // Изображения — из EN textarea[0]
    const imgTa  = document.querySelector('#prod-lp-en textarea.fta');
    const images = imgTa ? imgTa.value.split(',').map(s => s.trim()).filter(Boolean) : [];

    const data = {
        globalFields: {
            slug,
            status:          getVal('prodstat'),
            categoryId:      getVal('prodcatsel'),
            price:           getVal('prodprice'),
            sku:             getVal('prodsku'),
            stock:           getVal('prodstock'),
            volume:          getVal('prodvol'),
            priority:        getVal('prodprio'),
            region:          getVal('prodregion'),
            ogImageUrl:      getVal('prodogimg'),
            images,
        },
        translations,
        ...translations.en,
    };

    await saveToFirestore('products', data);
};

// ── Save Blog Post ────────────────────────────────────────────
window.saveBlogPost = async function() {
    const slug = getVal('blogslug').trim();
    if (!slug) { showToast('Укажите slug поста', 'err'); return; }

    const translations = {};
    LANGS.forEach(lang => {
        const pane = document.getElementById(`blog-lp-${lang}`);
        if (!pane) return;
        const inputs    = Array.from(pane.querySelectorAll('input.fin'));
        const textareas = Array.from(pane.querySelectorAll('textarea.fta'));

        translations[lang] = {
            fullDescriptionHtml: textareas[0]?.value.trim() || '',
            h1:                  inputs[0]?.value.trim() || '',
            mediaUrls:           inputs[1]?.value.trim() || '',
            imageAltText:        inputs[2]?.value.trim() || '',
            cardTitle:           inputs[3]?.value.trim() || '',
            cardDescription:     inputs[4]?.value.trim() || '',
            seoTitle:            inputs[5]?.value.trim() || '',
            metaDescription:     inputs[6]?.value.trim() || '',
            ogTitle:             inputs[7]?.value.trim() || '',
            ogDescription:       inputs[8]?.value.trim() || '',
        };
    });

    const data = {
        globalFields: {
            slug,
            status:          getVal('blogstat'),
            categoryId:      getVal('blogcat'),
            author:          getVal('blogauthor'),
            tagBadge:        getVal('blogbadge'),
            readTime:        getVal('blogread'),
            priority:        getVal('blogprio'),
            region:          getVal('blogregion'),
            ogImageUrl:      getVal('blogogimg'),
        },
        translations,
        ...translations.en,
    };

    await saveToFirestore('posts', data);
};

// ── Generic save / create ─────────────────────────────────────
async function saveToFirestore(collectionName, data) {
    try {
        if (currentEditingId) {
            // UPDATE
            await updateDoc(doc(db, collectionName, currentEditingId), data);
            // Обновляем локальный стейт
            const arr = state[collectionName === 'categories' ? 'categories'
                           : collectionName === 'products' ? 'products' : 'posts'];
            const idx = arr.findIndex(x => x.id === currentEditingId);
            if (idx !== -1) arr[idx] = { id: currentEditingId, ...data };
            showToast('✅ Сохранено!');
        } else {
            // CREATE
            const ref = await addDoc(collection(db, collectionName), data);
            const arr = state[collectionName === 'categories' ? 'categories'
                           : collectionName === 'products' ? 'products' : 'posts'];
            arr.push({ id: ref.id, ...data });
            showToast('✅ Создано!');
        }
        renderAllTables();
        // Закрываем модалку
        const modalMap = { categories: 'mcat', products: 'mprod', posts: 'mblog' };
        closeM(modalMap[collectionName]);
        currentEditingId = null;
    } catch (err) {
        console.error('Save error:', err);
        showToast('Ошибка сохранения: ' + err.message, 'err');
    }
}

// ── Delete ────────────────────────────────────────────────────
window.deleteItem = async function(collectionName, id) {
    if (!confirm('Удалить этот элемент? Это действие необратимо.')) return;
    try {
        await deleteDoc(doc(db, collectionName, id));
        const key = collectionName === 'categories' ? 'categories'
                  : collectionName === 'products'   ? 'products' : 'posts';
        state[key] = state[key].filter(x => x.id !== id);
        renderAllTables();
        showToast('🗑 Удалено');
    } catch (err) {
        showToast('Ошибка удаления: ' + err.message, 'err');
    }
};

// ════════════════════════════════════════════════════════════
// 5. UI HELPERS (навигация, модалки, боковая панель)
// ════════════════════════════════════════════════════════════
const META = {
    products:      { t: 'Products',              c: '/ Catalog' },
    categories:    { t: 'Categories',            c: '/ Catalog' },
    blog:          { t: 'Blog Posts',            c: '/ Content' },
    'page-home':   { t: 'Home Page',             c: '/ Pages' },
    'page-catalog':{ t: 'Catalog Page',          c: '/ Pages' },
    'page-contacts':{ t: 'Contacts',             c: '/ Pages' },
    'page-footer': { t: 'Navigation & Footer',   c: '/ Pages' },
    settings:      { t: 'Settings',              c: '' },
};

function goP(id) {
    document.querySelectorAll('.pn').forEach(p => p.classList.remove('on'));
    document.getElementById('pn-' + id)?.classList.add('on');
    document.querySelectorAll('.ni[data-p]').forEach(n => n.classList.remove('on'));
    document.querySelector(`.ni[data-p="${id}"]`)?.classList.add('on');
    document.querySelectorAll('.mni[data-p]').forEach(n => n.classList.remove('on'));
    document.querySelector(`.mni[data-p="${id}"]`)?.classList.add('on');
    const m = META[id] || { t: id, c: '' };
    safeSet('tptitle', m.t);
    safeSet('tpcrumb', m.c);
    document.querySelector('.ct')?.scrollTo(0, 0);
    closeMob();
}

function showM(id) { document.getElementById(id)?.classList.add('on'); document.body.style.overflow = 'hidden'; }
function closeM(id) { document.getElementById(id)?.classList.remove('on'); document.body.style.overflow = ''; }

window.showM  = showM;
window.closeM = closeM;

function toggleSidebar() { document.getElementById('sidebar')?.classList.toggle('col'); }
function openMob()  {
    document.getElementById('sidebar')?.classList.add('mo');
    document.getElementById('sov')?.classList.add('on');
    document.body.style.overflow = 'hidden';
}
function closeMob() {
    document.getElementById('sidebar')?.classList.remove('mo');
    document.getElementById('sov')?.classList.remove('on');
    document.body.style.overflow = '';
}

window.toggleSidebar = toggleSidebar;
window.openMob  = openMob;
window.closeMob = closeMob;
window.goP      = goP;

function checkMob() {
    const m = window.innerWidth <= 768;
    const dt = document.getElementById('dtt'), mb = document.getElementById('mbt');
    if (dt) dt.style.display = m ? 'none' : '';
    if (mb) mb.style.display = m ? 'flex'  : 'none';
    const sg = document.getElementById('stgg');
    if (sg) sg.style.gridTemplateColumns = m ? '1fr' : '1fr 1fr';
}
window.addEventListener('resize', checkMob);

// ── Lang switchers ───────────────────────────────────────────
function swLang(modalId, lang, btn) {
    document.querySelectorAll(`#${modalId} .lpane`).forEach(p => p.classList.remove('on'));
    document.getElementById(`${modalId === 'mblog' ? 'blog' : modalId === 'mprod' ? 'prod' : 'cat'}-lp-${lang}`)?.classList.add('on');
    document.querySelectorAll(`#${modalId} .ltab`).forEach(t => t.classList.remove('on'));
    document.querySelectorAll(`#${modalId} .lang-pill`).forEach(t => t.classList.remove('on'));
    if (btn) {
        btn.classList.add('on');
        document.querySelector(`#${modalId} .lang-overview .lang-pill[data-lang="${lang}"]`)?.classList.add('on');
    }
}
window.swBlogLang = (l, b) => swLang('mblog', l, b);
window.swProdLang = (l, b) => swLang('mprod', l, b);
window.swCatLang  = (l, b) => {
    document.querySelectorAll('#mcat .lpane').forEach(p => p.classList.remove('on'));
    document.getElementById(`cat-lang-${l}`)?.classList.add('on');
    document.querySelectorAll('#mcat .ltab').forEach(t => t.classList.remove('on'));
    if (b) b.classList.add('on');
};

// ── URL Updaters ─────────────────────────────────────────────
window.updProdUrl = function() {
    const cat = document.getElementById('prodcatsel')?.value || 'category';
    const sl  = document.getElementById('prodslug')?.value.trim() || 'slug';
    const pr  = document.getElementById('produp');
    if (pr) pr.innerHTML = LANGS.map(l => `<span>/${l}/products/${cat}/${sl}</span>`).join(' ');
};
window.updBlogUrl = function() {
    const sl = document.getElementById('blogslug')?.value.trim() || 'slug';
    const pr = document.getElementById('blogurlprev');
    if (pr) pr.innerHTML = LANGS.map(l => `<span>/${l}/blog/${sl}</span>`).join(' ');
};
window.updCatUrl = function() {
    const sl = document.getElementById('catslug')?.value.trim() || '[slug]';
    const pr = document.getElementById('caturlprev');
    if (pr) pr.innerHTML = LANGS.map(l => `<span>/${l}/products/${sl}/</span>`).join(' ');
};
window.updLang = function(v, lid, pid) {
    const lm = { en:'English (EN)', ru:'Russian (RU)', ka:'Georgian (KA)', hy:'Armenian (HY)' };
    const pm = { en:'/en/', ru:'/ru/', ka:'/ka/', hy:'/hy/' };
    const l = document.getElementById(lid), p = document.getElementById(pid);
    if (l) l.textContent = lm[v] || v;
    if (p) p.textContent = pm[v] || '/'+v+'/';
};

// ── Color swatches ────────────────────────────────────────────
function initSwatches() {
    const sw = document.getElementById('swatches');
    if (!sw) return;
    sw.addEventListener('click', e => {
        const s = e.target.closest('.sw');
        if (!s) return;
        document.querySelectorAll('.sw').forEach(x => x.classList.remove('on'));
        s.classList.add('on');
        selColor = s.dataset.c;
    });
}

// ── Confirm lang ──────────────────────────────────────────────
window.confirmLang = function(type, lang) {
    const paneId = (type === 'blog' ? 'blog-lp-' : 'prod-lp-') + lang;
    const bar    = document.querySelector('#' + paneId + ' .conf-bar');
    if (!bar) return;
    const icon   = bar.querySelector('.material-symbols-outlined');
    const status = bar.querySelector('.conf-status');
    const sub    = bar.querySelector('.conf-sub');
    const badge  = bar.querySelector('.conf-badge');
    if (icon)   { icon.textContent = 'check_circle'; icon.style.color = 'var(--green)'; }
    if (status) status.textContent = lang.toUpperCase() + ' version — Published';
    if (sub)    sub.textContent    = 'Confirmed — ' + new Date().toLocaleString();
    if (badge)  { badge.className = 'conf-badge conf-y'; badge.textContent = '✓ Confirmed'; }
    const tabDot = document.querySelector(`#${type==='blog'?'mblog':'mprod'} .ltab[data-lang="${lang}"] .conf-dot`);
    if (tabDot) { tabDot.className = 'conf-dot yes'; }
    const sEl = document.getElementById(`${type==='blog'?'blog':'prod'}-lstatus-${lang}`);
    if (sEl)    { sEl.textContent = 'Published'; sEl.className = 'lstatus lstatus-pub'; }
};

// ── Pills ─────────────────────────────────────────────────────
window.addPill = function(lang) {
    const inp = document.getElementById('pillin-' + lang);
    if (!inp?.value.trim()) return;
    const box = document.getElementById('pills-' + lang);
    const s   = document.createElement('span');
    s.className = 'pi';
    s.innerHTML = escHtml(inp.value.trim()) + '<button onclick="window.rmPill(this)"><span class="material-symbols-outlined ic">close</span></button>';
    box?.appendChild(s);
    inp.value = '';
};
window.rmPill = btn => btn.closest('.pi')?.remove();

// ── Ingredients ───────────────────────────────────────────────
window.addIngr = function() {
    const list = document.getElementById('ingren');
    if (!list) return;
    const r = document.createElement('div');
    r.className = 'ir';
    r.innerHTML = '<input class="fin" placeholder="Ingredient name"><input class="fin pct" placeholder="0%"><button class="ib dr" onclick="this.parentNode.remove()"><span class="material-symbols-outlined ic">delete</span></button>';
    list.appendChild(r);
};

// ── Section toggle ────────────────────────────────────────────
window.togSec = h => { h.classList.toggle('on'); h.nextElementSibling?.classList.toggle('on'); };

// ════════════════════════════════════════════════════════════
// 6. MICRO-УТИЛИТЫ
// ════════════════════════════════════════════════════════════
function getVal(id)      { return document.getElementById(id)?.value || ''; }
function setVal(id, v)   { const el = document.getElementById(id); if (el) el.value = v ?? ''; }
function safeSet(id, v)  { const el = document.getElementById(id); if (el) el.textContent = v; }
function escHtml(str)    { return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function clearModal(id) {
    document.querySelectorAll(`#${id} input.fin, #${id} textarea.fta`).forEach(el => { el.value = ''; });
    document.querySelectorAll(`#${id} select.fsel, #${id} select.fs`).forEach(el => { el.selectedIndex = 0; });
}

// ── Кнопки "New ..." → переопределяем onclick ─────────────────
function hookNewButtons() {
    // Кнопки "New Product" и "New Post" открывают модалки напрямую — 
    // добавляем сброс currentEditingId
    document.querySelectorAll('[onclick*="showM(\'mprod\')"]').forEach(btn => {
        btn.onclick = () => { currentEditingId = null; currentCollection = 'products'; clearModal('mprod'); showM('mprod'); };
    });
    document.querySelectorAll('[onclick*="showM(\'mblog\')"]').forEach(btn => {
        btn.onclick = () => { currentEditingId = null; currentCollection = 'posts'; clearModal('mblog'); showM('mblog'); };
    });
    // "New Category"
    document.querySelectorAll('[onclick*="openNewCat"]').forEach(btn => {
        btn.onclick = window.openNewCategory;
    });
}

// ── Кнопки Save в модалках ─────────────────────────────────────
function hookSaveButtons() {
    // В HTML кнопки Save выглядят как <button onclick="saveCat()">
    // Здесь мы переопределяем эти глобальные функции
    window.saveCat  = window.saveCategory;
    window.saveProd = window.saveProduct;
    window.saveBlog = window.saveBlogPost;
}

// ════════════════════════════════════════════════════════════
// 7. ИНИЦИАЛИЗАЦИЯ
// ════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
    checkMob();
    initSwatches();
    hookSaveButtons();
    hookNewButtons();

    // Навигация по разделам
    document.querySelectorAll('.ni[data-p]').forEach(el =>
        el.addEventListener('click', () => goP(el.dataset.p))
    );
    document.querySelectorAll('.mni[data-p]').forEach(el =>
        el.addEventListener('click', () => goP(el.dataset.p))
    );

    // Закрытие модалок по клику на фон и Escape
    document.querySelectorAll('.mo').forEach(o =>
        o.addEventListener('click', e => { if (e.target === o) closeM(o.id); })
    );
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape')
            document.querySelectorAll('.mo.on').forEach(m => closeM(m.id));
    });

    // Запускаем загрузку данных
    loadAllData();
});
