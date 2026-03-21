// Подключаем Firebase напрямую из вашего firebase-config.js
import { db, collection, getDocs } from './firebase-config.js';

const LANGS = ['en', 'ru', 'ka', 'hy'];

// Глобальное состояние (храним данные, скачанные из базы)
let state = {
    categories: [],
    products: [],
    posts: []
};

// ==========================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ==========================================

function getLocalVal(docData, key, lang = 'en') {
    if (!docData) return '';
    const g = docData.globalFields || {};
    const t = docData.translations || {};
    const l = t[lang] || docData[lang] || {};

    return l[key] ?? g[key] ?? docData[key] ?? '';
}

function setFieldByLabel(containerSelector, labelText, value) {
    const container = document.querySelector(containerSelector);
    if (!container) {
        console.warn(`Container not found: ${containerSelector}`);
        return;
    }

    const labels = Array.from(container.querySelectorAll('label.fl'));
    const targetLabel = labels.find(l => l.textContent.toLowerCase().includes(labelText.toLowerCase()));

    if (targetLabel) {
        const fieldContainer = targetLabel.closest('.fi');
        if (fieldContainer) {
            const input = fieldContainer.querySelector('input.fin, textarea.fta, select.fsel');
            if (input) {
                input.value = (value === null || value === undefined) ? '' : value;
            } else {
                console.warn(`Input not found for label "${labelText}" in ${containerSelector}`);
            }
        }
    } else {
        // console.warn(`Label not found: "${labelText}" in ${containerSelector}`);
    }
}

// ==========================================
// 1. ЗАГРУЗКА ДАННЫХ ИЗ FIRESTORE
// ==========================================
async function loadAllData() {
    try {
        console.log("Запускаем загрузку данных из Firestore...");

        const [catSnap, prodSnap, postSnap] = await Promise.all([
            getDocs(collection(db, "categories")),
            getDocs(collection(db, "products")),
            getDocs(collection(db, "posts"))
        ]);

        state.categories = catSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        state.products = prodSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        state.posts = postSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        console.log("Данные успешно загружены из Firebase!");
        
        // ВЫЗЫВАЕМ ОТРИСОВКУ
        renderAllTables();

    } catch (error) {
        console.error("КРИТИЧЕСКАЯ ОШИБКА при загрузке данных:", error);
        alert("Не удалось загрузить базу данных. Откройте консоль (F12) для деталей.");
    }
}

// ==========================================
// 2. ОТРИСОВКА ТАБЛИЦ (UI)
// ==========================================
function renderAllTables() {
    console.log("Начинаем отрисовку таблиц...");
    renderCategories();
    renderProducts();
    renderBlog();
    console.log("Отрисовка таблиц завершена.");
}

function renderCategories() {
    const tb = document.getElementById('cattbody');
    if (!tb) return;
    
    document.getElementById('bdgc').textContent = state.categories.length;
    document.getElementById('catcntlbl').textContent = state.categories.length + ' categories';

    tb.innerHTML = state.categories.map(c => {
        const nameEn = getLocalVal(c, 'name', 'en') || c.id;
        const slug = getLocalVal(c, 'slug') || c.id;
        const count = state.products.filter(p => getLocalVal(p, 'categoryId') === c.id).length;
        return `<tr>
          <td><strong>${nameEn}</strong></td>
          <td>${slug}</td>
          <td>${count}</td>
          <td>...</td>
          <td>${getLocalVal(c, 'status')}</td>
          <td>/en/products/${slug}/</td>
          <td><div class="ra"><button class="ib" onclick="window.editCategory('${c.id}')"><span class="material-symbols-outlined ic">edit</span></button></div></td>
        </tr>`;
    }).join('');

    const prodCatSel = document.getElementById('prodcatsel');
    if (prodCatSel) {
        prodCatSel.innerHTML = state.categories.map(c => `<option value="${c.id}">${getLocalVal(c, 'name', 'en') || c.id}</option>`).join('');
    }
}

function renderProducts() {
    const tb = document.getElementById('products-tbody');
    if (!tb) return;
    
    document.getElementById('bdgp').textContent = state.products.length;

    tb.innerHTML = state.products.map(p => {
        const name = getLocalVal(p, 'productName', 'en') || 'Unnamed';
        const catId = getLocalVal(p, 'categoryId');
        const catObj = state.categories.find(c => c.id === catId);
        const catName = catObj ? (getLocalVal(catObj, 'name', 'en') || catId) : 'Unknown';
        const img = (getLocalVal(p, 'images') || [])[0] || 'https://via.placeholder.com/44';
        const slug = getLocalVal(p, 'slug') || p.id;

        return `<tr>
          <td><div class="pnc"><img src="${img}" class="pth" style="object-fit:contain;"><div class="pni"><div class="pnm">${name}</div></div></div></td>
          <td>${catName}</td>
          <td><strong>${getLocalVal(p, 'price')}</strong></td>
          <td>...</td>
          <td>${getLocalVal(p, 'status')}</td>
          <td style="font-size:10px;">/en/products/${catObj ? getLocalVal(catObj, 'slug') : 'cat'}/${slug}/</td>
          <td><div class="ra"><button class="ib" onclick="window.editProduct('${p.id}')"><span class="material-symbols-outlined ic">edit</span></button></div></td>
        </tr>`;
    }).join('');
}

function renderBlog() {
    const tb = document.getElementById('blog-tbody');
    if (!tb) return;

    document.getElementById('bdgb').textContent = state.posts.length;
    
    tb.innerHTML = state.posts.map(p => {
        const title = getLocalVal(p, 'name', 'en') || 'Untitled';
        return `<tr>
          <td><strong>${title}</strong></td>
          <td>${getLocalVal(p, 'categoryId')}</td>
          <td>${getLocalVal(p, 'author')}</td>
          <td>...</td>
          <td>${getLocalVal(p, 'status')}</td>
          <td>...</td>
          <td><div class="ra"><button class="ib" onclick="window.editPost('${p.id}')"><span class="material-symbols-outlined ic">edit</span></button></div></td>
        </tr>`;
    }).join('');
}


// ==========================================
// 3. ОТКРЫТИЕ МОДАЛОК С ДАННЫМИ (EDIT)
// ==========================================

window.editCategory = function(id) {
    const cat = state.categories.find(c => c.id === id);
    if (!cat) return;
    setFieldByLabel('#mcat', 'URL Slug', getLocalVal(cat, 'slug'));
    //... (остальная логика для категорий)
    if(typeof window.showM === 'function') window.showM('mcat');
};

window.editProduct = function(id) {
    const prod = state.products.find(p => p.id === id);
    if (!prod) return;
    
    console.log("Заполняем модалку данными для продукта:", prod);

    const gfBlock = '#mprod .gf-block';
    
    setFieldByLabel(gfBlock, 'Status', getLocalVal(prod, 'status'));
    setFieldByLabel(gfBlock, 'Category', getLocalVal(prod, 'categoryId'));
    setFieldByLabel(gfBlock, 'Price', getLocalVal(prod, 'price'));
    setFieldByLabel(gfBlock, 'SKU', getLocalVal(prod, 'sku'));
    setFieldByLabel(gfBlock, 'Stock', getLocalVal(prod, 'stock'));
    setFieldByLabel(gfBlock, 'Weight/Volume', getLocalVal(prod, 'volume'));
    setFieldByLabel(gfBlock, 'Priority', getLocalVal(prod, 'priority'));
    setFieldByLabel(gfBlock, 'Change Frequency', getLocalVal(prod, 'changeFrequency'));
    setFieldByLabel(gfBlock, 'URL Slug', getLocalVal(prod, 'slug'));
    setFieldByLabel(gfBlock, 'Region', getLocalVal(prod, 'region'));
    setFieldByLabel(gfBlock, 'OG Image', getLocalVal(prod, 'ogImageUrl'));

    LANGS.forEach(lang => {
        const pId = `#prod-lp-${lang}`;
        const imgs = getLocalVal(prod, 'imageUrls', lang) || getLocalVal(prod, 'images', lang) || [];
        setFieldByLabel(pId, 'Image URLs', Array.isArray(imgs) ? imgs.join(',\n') : imgs);
        
        setFieldByLabel(pId, 'Category Label', getLocalVal(prod, 'categoryLabel', lang));
        setFieldByLabel(pId, 'Product Name', getLocalVal(prod, 'productName', lang));
        setFieldByLabel(pId, 'Short Description', getLocalVal(prod, 'shortDescription', lang));
        setFieldByLabel(pId, 'Full Description', getLocalVal(prod, 'fullDescriptionHtml', lang));
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

window.editPost = function(id) {
    const post = state.posts.find(p => p.id === id);
    if (!post) return;
    console.log("Editing Post:", post);
    alert(`Редактирование поста: ${post.id}`);
};

// ==========================================
// ЗАПУСК АДМИНКИ ПРИ ЗАГРУЗКЕ СТРАНИЦЫ
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM готов. Запускаем загрузку данных.");
    loadAllData();
});
