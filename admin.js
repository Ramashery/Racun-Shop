// Подключаем Firebase напрямую из вашего firebase-config.js
import { db, collection, getDocs } from './firebase-config.js';

const LANGS = ['en', 'ru', 'ka', 'hy'];

// Глобальное состояние (храним данные, скачанные из базы)
let state = {
    categories: [],
    products: [],
    posts: []
};

// Текущий редактируемый элемент
let currentEditingId = null;

// ==========================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ==========================================

// 1. Умное извлечение локализованного значения из Firebase
function getLocalVal(docData, key, lang = 'en') {
    if (!docData) return '';
    if (docData.translations && docData.translations[lang] && docData.translations[lang][key] !== undefined) {
        return docData.translations[lang][key];
    }
    if (docData[lang] && docData[lang][key] !== undefined) {
        return docData[lang][key];
    }
    if (docData.globalFields && docData.globalFields[key] !== undefined) {
        return docData.globalFields[key];
    }
    return docData[key] || '';
}

// 2. УМНЫЙ ПОИСК ПОЛЕЙ В HTML ПО НАЗВАНИЮ <label>
function setFieldByLabel(containerSelector, labelText, value) {
    const container = document.querySelector(containerSelector);
    if (!container) return;
    
    const labels = Array.from(container.querySelectorAll('label.fl'));
    const targetLabel = labels.find(l => l.textContent.toLowerCase().includes(labelText.toLowerCase()));
    
    if (targetLabel) {
        const input = targetLabel.parentElement.querySelector('input.fin, textarea.fta, select.fsel');
        if (input) {
            // Проверяем, что значение не null и не undefined перед установкой
            input.value = (value === null || value === undefined) ? '' : value;
        }
    }
}


// ==========================================
// 1. ЗАГРУЗКА ДАННЫХ ИЗ FIRESTORE
// ==========================================
async function loadAllData() {
    try {
        console.log("Загрузка данных из Firestore...");
        
        const [catSnap, prodSnap, postSnap] = await Promise.all([
            getDocs(collection(db, "categories")),
            getDocs(collection(db, "products")),
            getDocs(collection(db, "posts"))
        ]);

        state.categories = catSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        state.products = prodSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        state.posts = postSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        console.log("Данные успешно загружены!");
        console.log("Категории:", state.categories);
        console.log("Продукты:", state.products);
        
        renderAllTables();

    } catch (error) {
        console.error("Ошибка загрузки данных из Firebase:", error);
        alert("Не удалось загрузить базу данных. Откройте консоль (F12) для деталей.");
    }
}

// ==========================================
// 2. ОТРИСОВКА ТАБЛИЦ (UI)
// ==========================================
function renderAllTables() {
    renderCategories();
    renderProducts();
    renderBlog();
}

function renderCategories() {
    const tb = document.getElementById('cattbody');
    const bdgc = document.getElementById('bdgc');
    const catcntlbl = document.getElementById('catcntlbl');
    
    if(bdgc) bdgc.textContent = state.categories.length;
    if(catcntlbl) catcntlbl.textContent = state.categories.length + ' categories';

    if (tb) {
        tb.innerHTML = state.categories.map(c => {
            const nameEn = getLocalVal(c, 'name', 'en') || c.id;
            const slug = c.globalFields?.slug || c.id;
            const color = c.globalFields?.color || '#4f7dff';
            const status = c.globalFields?.status || 'Active';
            const count = state.products.filter(p => p.globalFields?.categoryId === c.id).length;

            return `<tr>
              <td><div style="display:flex;align-items:center;gap:10px"><div style="width:10px;height:10px;border-radius:50%;background:${color};flex-shrink:0"></div><strong>${nameEn}</strong></div></td>
              <td style="font-family:'IBM Plex Mono',monospace;font-size:12px;color:var(--text2)">${slug}</td>
              <td>${count}</td>
              <td><div class="lf"><span class="lfl d">EN</span><span class="lfl d">RU</span><span class="lfl d">KA</span><span class="lfl d">HY</span></div></td>
              <td><span class="sb2 ${status === 'Active' ? 'sp' : 'sa'}">${status}</span></td>
              <td style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--text2)">/en/products/${slug}/</td>
              <td><div class="ra"><button class="ib" onclick="window.editCategory('${c.id}')"><span class="material-symbols-outlined ic">edit</span></button></div></td>
            </tr>`;
        }).join('');
    }

    const prodCatSel = document.getElementById('prodcatsel');
    if (prodCatSel) {
        prodCatSel.innerHTML = state.categories.map(c => `<option value="${c.id}">${getLocalVal(c, 'name', 'en') || c.id}</option>`).join('');
    }
}

function renderProducts() {
    const tb = document.getElementById('products-tbody');
    const bdgp = document.getElementById('bdgp');
    if(bdgp) bdgp.textContent = state.products.length;
    
    if (tb) {
        tb.innerHTML = state.products.map(p => {
            const name = getLocalVal(p, 'productName', 'en') || getLocalVal(p, 'name', 'en') || 'Unnamed Product';
            const catId = p.globalFields?.categoryId;
            const catObj = state.categories.find(c => c.id === catId);
            const catName = catObj ? (getLocalVal(catObj, 'name', 'en') || catId) : 'Unknown';
            const catSlug = catObj ? (catObj.globalFields?.slug || catObj.id) : 'category';
            const price = p.globalFields?.price || '0 GEL';
            const status = p.globalFields?.status || 'Draft';
            const slug = p.globalFields?.slug || p.id;
            const img = (p.globalFields?.images && p.globalFields.images.length > 0) ? p.globalFields.images[0] : 'https://via.placeholder.com/44';
            const stClass = status.toLowerCase() === 'published' ? 'sp' : 'sa';
            
            return `<tr>
              <td><div class="pnc"><img src="${img}" class="pth" style="object-fit:contain;"><div class="pni"><div class="pnm">${name}</div><div class="pcm">${p.id}</div></div></div></td>
              <td>${catName}</td>
              <td><strong>${price}</strong></td>
              <td><div class="lf"><span class="lfl d">EN</span><span class="lfl d">RU</span><span class="lfl d">KA</span><span class="lfl d">HY</span></div></td>
              <td><span class="sb2 ${stClass}">${status}</span></td>
              <td style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--text2)">/en/products/${catSlug}/${slug}/</td>
              <td><div class="ra"><button class="ib" onclick="window.editProduct('${p.id}')"><span class="material-symbols-outlined ic">edit</span></button></div></td>
            </tr>`;
        }).join('');
    }
}

function renderBlog() {
    const tb = document.getElementById('blog-tbody');
    const bdgb = document.getElementById('bdgb');
    if(bdgb) bdgb.textContent = state.posts.length;
    
    if (tb) {
        tb.innerHTML = state.posts.map(p => {
            const title = getLocalVal(p, 'name', 'en') || getLocalVal(p, 'title', 'en') || 'Untitled Post';
            const catName = p.globalFields?.categoryId || 'Article';
            const author = p.globalFields?.author || 'Admin';
            const status = p.globalFields?.status || 'Draft';
            const slug = p.globalFields?.slug || p.id;
            const img = (p.globalFields?.images && p.globalFields.images.length > 0) ? p.globalFields.images[0] : 'https://via.placeholder.com/44';
            const stClass = status.toLowerCase() === 'published' ? 'sp' : 'sa';

            return `<tr>
              <td><div class="pnc"><img src="${img}" class="pth" style="object-fit:cover;"><div class="pni"><div class="pnm">${title}</div><div class="pcm">${p.id}</div></div></div></td>
              <td>${catName}</td>
              <td>${author}</td>
              <td><div class="lf"><span class="lfl d">EN</span><span class="lfl d">RU</span><span class="lfl d">KA</span><span class="lfl d">HY</span></div></td>
              <td><span class="sb2 ${stClass}">${status}</span></td>
              <td style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--text2)">/en/blog/${slug}/</td>
              <td><div class="ra"><button class="ib" onclick="window.editPost('${p.id}')"><span class="material-symbols-outlined ic">edit</span></button></div></td>
            </tr>`;
        }).join('');
    }
}


// ==========================================
// 3. ОТКРЫТИЕ МОДАЛОК С ДАННЫМИ (EDIT)
// ==========================================

// --- КАТЕГОРИИ ---
window.editCategory = function(id) {
    currentEditingId = id;
    const cat = state.categories.find(c => c.id === id);
    if (!cat) return;
    
    document.getElementById('cattitle').textContent = 'Edit Category';
    
    setFieldByLabel('#mcat', 'Status', cat.globalFields?.status);
    setFieldByLabel('#mcat', 'URL Slug', cat.globalFields?.slug);
    
    let color = cat.globalFields?.color || '#4f7dff';
    document.querySelectorAll('#mcat .sw').forEach(s => s.classList.toggle('on', s.dataset.c === color));
    window.selColor = color;
    
    LANGS.forEach(lang => {
        const pId = `#cat-lang-${lang}`;
        setFieldByLabel(pId, 'Name', getLocalVal(cat, 'name', lang));
        setFieldByLabel(pId, 'Description', getLocalVal(cat, 'description', lang));
        setFieldByLabel(pId, 'SEO Title', getLocalVal(cat, 'seoTitle', lang));
        setFieldByLabel(pId, 'SEO Description', getLocalVal(cat, 'metaDescription', lang));
    });

    if(typeof window.updCatUrl === 'function') window.updCatUrl();
    if(typeof window.showM === 'function') window.showM('mcat');
};

// --- ПРОДУКТЫ ---
window.editProduct = function(id) {
    currentEditingId = id;
    const prod = state.products.find(p => p.id === id);
    if (!prod) return;

    const gfBlock = '#mprod .gf-block';
    
    // ГЛОБАЛЬНЫЕ ПОЛЯ
    setFieldByLabel(gfBlock, 'Status', prod.globalFields?.status);
    setFieldByLabel(gfBlock, 'Category', prod.globalFields?.categoryId);
    setFieldByLabel(gfBlock, 'Price', prod.globalFields?.price);
    setFieldByLabel(gfBlock, 'SKU', prod.globalFields?.sku);
    setFieldByLabel(gfBlock, 'Stock', prod.globalFields?.stock);
    setFieldByLabel(gfBlock, 'Weight/Volume', prod.globalFields?.volume);
    setFieldByLabel(gfBlock, 'Priority', prod.globalFields?.priority);
    setFieldByLabel(gfBlock, 'Change Frequency', prod.globalFields?.changeFrequency);
    setFieldByLabel(gfBlock, 'URL Slug', prod.globalFields?.slug);
    setFieldByLabel(gfBlock, 'Region', prod.globalFields?.region);
    setFieldByLabel(gfBlock, 'OG Image', prod.globalFields?.ogImageUrl);

    // ЛОКАЛИЗОВАННЫЕ ПОЛЯ
    LANGS.forEach(lang => {
        const pId = `#prod-lp-${lang}`;
        const imgs = getLocalVal(prod, 'imageUrls', lang) || getLocalVal(prod, 'images', lang) || [];
        setFieldByLabel(pId, 'Image URLs', Array.isArray(imgs) ? imgs.join(',\n') : imgs);
        
        setFieldByLabel(pId, 'Category Label', getLocalVal(prod, 'categoryLabel', lang));
        setFieldByLabel(pId, 'Product Name', getLocalVal(prod, 'productName', lang) || getLocalVal(prod, 'name', lang));
        setFieldByLabel(pId, 'Short Description', getLocalVal(prod, 'shortDescription', lang));
        setFieldByLabel(pId, 'Full Description', getLocalVal(prod, 'fullDescriptionHtml', lang) || getLocalVal(prod, 'fullDescription', lang));
        
        setFieldByLabel(pId, 'CTA Button Text', getLocalVal(prod, 'ctaButtonText', lang));
        setFieldByLabel(pId, 'Button URL', getLocalVal(prod, 'buttonUrl', lang));
        
        setFieldByLabel(pId, 'Card Title', getLocalVal(prod, 'cardTitle', lang));
        setFieldByLabel(pId, 'Card Description', getLocalVal(prod, 'cardDescription', lang));

        setFieldByLabel(pId, 'SEO Title', getLocalVal(prod, 'seoTitle', lang));
        setFieldByLabel(pId, 'Meta Description', getLocalVal(prod, 'metaDescription', lang));
        setFieldByLabel(pId, 'OG Title', getLocalVal(prod, 'ogTitle', lang));
        setFieldByLabel(pId, 'OG Description', getLocalVal(prod, 'ogDescription', lang));
    });

    if(typeof window.updProdUrl === 'function') window.updProdUrl();
    if(typeof window.showM === 'function') window.showM('mprod');
};

// --- ПОСТЫ (BLOG) ---
window.editPost = function(id) {
    // Эта функция пока заглушка, но готова к использованию
    const post = state.posts.find(p => p.id === id);
    if (!post) return;
    console.log("Editing Post:", post);
    alert(`Editing post: ${post.id}`);
};

// ==========================================
// ЗАПУСК АДМИНКИ ПРИ ЗАГРУЗКЕ СТРАНИЦЫ
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    loadAllData();
});
