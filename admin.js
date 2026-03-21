// Подключаем Firebase напрямую из вашего firebase-config.js
import { db, collection, getDocs, doc, getDoc, setDoc, updateDoc, deleteDoc } from './firebase-config.js';

const LANGS = ['en', 'ru', 'ka', 'hy'];

// Глобальное состояние (храним данные, скачанные из базы)
let state = {
    categories: [],
    products: [],
    posts: []
};

// Текущий редактируемый элемент
let currentEditingId = null;

// Вспомогательная функция для извлечения локализованного значения
function getLocalVal(docData, key, lang = 'en') {
    if (!docData) return '';
    if (docData.translations && docData.translations[lang] && docData.translations[lang][key]) return docData.translations[lang][key];
    if (docData[lang] && docData[lang][key]) return docData[lang][key];
    if (docData.globalFields && docData.globalFields[key]) return docData.globalFields[key];
    return docData[key] || '';
}

// ==========================================
// 1. ЗАГРУЗКА ДАННЫХ ИЗ FIRESTORE
// ==========================================
async function loadAllData() {
    try {
        console.log("Fetching data from Firestore...");
        
        const [catSnap, prodSnap, postSnap] = await Promise.all([
            getDocs(collection(db, "categories")),
            getDocs(collection(db, "products")),
            getDocs(collection(db, "posts"))
        ]);

        state.categories = catSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        state.products = prodSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        state.posts = postSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        console.log("Data loaded successfully!");
        renderAllTables();

    } catch (error) {
        console.error("Error loading data from Firebase:", error);
        alert("Failed to load database. Check console for details.");
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

    // Обновляем селекты категорий в модалках
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
    
    // Глобальные
    document.getElementById('catstat').value = cat.globalFields?.status || 'Active';
    document.getElementById('catslug').value = cat.globalFields?.slug || cat.id;
    
    // Цвет (логика из вашего кода)
    let color = cat.globalFields?.color || '#4f7dff';
    document.querySelectorAll('#mcat .sw').forEach(s => s.classList.toggle('on', s.dataset.c === color));
    
    // Локализованные поля
    LANGS.forEach(lang => {
        const pane = document.getElementById(`cat-lang-${lang}`);
        if(pane) {
            const inputs = pane.querySelectorAll('input.fin');
            if(inputs.length >= 4) {
                inputs[0].value = getLocalVal(cat, 'name', lang);
                inputs[1].value = getLocalVal(cat, 'description', lang);
                inputs[2].value = getLocalVal(cat, 'seoTitle', lang);
                inputs[3].value = getLocalVal(cat, 'metaDescription', lang);
            }
        }
    });

    if(typeof updCatUrl === 'function') updCatUrl();
    showM('mcat'); // Открываем модалку (функция из вашего admin.html)
};

// --- ПРОДУКТЫ ---
window.editProduct = function(id) {
    currentEditingId = id;
    const prod = state.products.find(p => p.id === id);
    if (!prod) return;

    // Глобальные поля (ищем селекты по структуре вашего HTML)
    const gfSelects = document.querySelectorAll('#mprod .gf-block select');
    const gfInputs = document.querySelectorAll('#mprod .gf-block input.fin');
    
    if(gfSelects.length >= 4) {
        gfSelects[0].value = prod.globalFields?.status || 'Draft';
        gfSelects[1].value = prod.globalFields?.categoryId || '';
        gfSelects[2].value = prod.globalFields?.changeFrequency || 'monthly';
        gfSelects[3].value = 'en'; // hreflang
    }
    
    if(gfInputs.length >= 7) {
        gfInputs[0].value = prod.globalFields?.price || '';
        gfInputs[1].value = prod.globalFields?.sku || '';
        gfInputs[2].value = prod.globalFields?.stock || '';
        gfInputs[3].value = prod.globalFields?.volume || '';
        gfInputs[4].value = prod.globalFields?.priority || '0.8';
        gfInputs[5].value = prod.globalFields?.slug || prod.id; // slug
        gfInputs[6].value = prod.globalFields?.region || '';
        gfInputs[7].value = prod.globalFields?.ogImageUrl || '';
    }

    // Изображения (textarea)
    const imgTextarea = document.querySelector('#mprod #prod-lp-en textarea.fta');
    if(imgTextarea) imgTextarea.value = (prod.globalFields?.images || []).join(', \n');

    // Локализованные поля (заполняем для каждой вкладки)
    LANGS.forEach(lang => {
        const pane = document.getElementById(`prod-lp-${lang}`);
        if(pane) {
            const inputs = pane.querySelectorAll('input.fin');
            const textareas = pane.querySelectorAll('textarea.fta');
            
            // Textareas (Images, Short Desc, Full HTML) - Изображения только в EN
            if(lang === 'en' && textareas.length >= 3) {
                textareas[1].value = getLocalVal(prod, 'shortDescription', lang);
                textareas[2].value = getLocalVal(prod, 'fullDescriptionHtml', lang) || getLocalVal(prod, 'fullDescription', lang);
            } else if(textareas.length >= 3) {
                textareas[1].value = getLocalVal(prod, 'shortDescription', lang);
                textareas[2].value = getLocalVal(prod, 'fullDescriptionHtml', lang) || getLocalVal(prod, 'fullDescription', lang);
            }

            // Inputs (Category Label, Name, CTA, CTA2, URL, Card Title, Card Desc, SEO Title, Meta Desc, OG Title, OG Desc)
            // Порядок инпутов зависит от вашего HTML
            if(inputs.length >= 10) {
                inputs[0].value = getLocalVal(prod, 'categoryLabel', lang);
                inputs[1].value = getLocalVal(prod, 'productName', lang) || getLocalVal(prod, 'name', lang);
                // inputs[2] это Feature Pills input, пропускаем
                
                // В зависимости от языка структура немного меняется (в EN есть пилюли, в остальных нет)
                let offset = (lang === 'en') ? 1 : 0;
                
                if(inputs[2+offset]) inputs[2+offset].value = getLocalVal(prod, 'ctaButtonText', lang);
                if(inputs[3+offset]) inputs[3+offset].value = getLocalVal(prod, 'secondaryButtonText', lang);
                if(inputs[4+offset]) inputs[4+offset].value = getLocalVal(prod, 'buttonUrl', lang);
                
                if(inputs[5+offset]) inputs[5+offset].value = getLocalVal(prod, 'cardTitle', lang);
                if(inputs[6+offset]) inputs[6+offset].value = getLocalVal(prod, 'cardDescription', lang);
                
                if(inputs[7+offset]) inputs[7+offset].value = getLocalVal(prod, 'seoTitle', lang);
                if(inputs[8+offset]) inputs[8+offset].value = getLocalVal(prod, 'metaDescription', lang);
                if(inputs[9+offset]) inputs[9+offset].value = getLocalVal(prod, 'ogTitle', lang);
                if(inputs[10+offset]) inputs[10+offset].value = getLocalVal(prod, 'ogDescription', lang);
            }
        }
    });

    if(typeof updProdUrl === 'function') updProdUrl();
    showM('mprod');
};

// --- ПОСТЫ (BLOG) ---
window.editPost = function(id) {
    currentEditingId = id;
    const post = state.posts.find(p => p.id === id);
    if (!post) return;

    // Глобальные
    const gfSelects = document.querySelectorAll('#mblog .gf-block select');
    const gfInputs = document.querySelectorAll('#mblog .gf-block input.fin');

    if(gfSelects.length >= 3) {
        gfSelects[0].value = post.globalFields?.status || 'Draft';
        gfSelects[1].value = post.globalFields?.categoryId || '';
        gfSelects[2].value = post.globalFields?.changeFrequency || 'weekly';
    }

    if(gfInputs.length >= 7) {
        gfInputs[0].value = post.globalFields?.author || '';
        gfInputs[1].value = post.globalFields?.tagBadge || '';
        gfInputs[2].value = post.globalFields?.readTime || '';
        // Date handling omitted for brevity, but you can add it
        gfInputs[5].value = post.globalFields?.priority || '0.8';
        gfInputs[6].value = post.globalFields?.slug || post.id;
        gfInputs[7].value = post.globalFields?.region || '';
        gfInputs[8].value = post.globalFields?.ogImageUrl || '';
    }

    // Локализованные
    LANGS.forEach(lang => {
        const pane = document.getElementById(`blog-lp-${lang}`);
        if(pane) {
            const inputs = pane.querySelectorAll('input.fin');
            const textareas = pane.querySelectorAll('textarea.fta');
            
            if(textareas.length > 0) {
                textareas[0].value = getLocalVal(post, 'fullDescriptionHtml', lang) || getLocalVal(post, 'fullDescription', lang);
            }

            if(inputs.length >= 6) {
                inputs[0].value = getLocalVal(post, 'h1', lang);
                inputs[1].value = getLocalVal(post, 'mediaUrls', lang);
                inputs[2].value = getLocalVal(post, 'imageAltText', lang);
                inputs[3].value = getLocalVal(post, 'cardTitle', lang);
                inputs[4].value = getLocalVal(post, 'cardDescription', lang);
                inputs[5].value = getLocalVal(post, 'seoTitle', lang);
                inputs[6].value = getLocalVal(post, 'metaDescription', lang);
            }
        }
    });

    if(typeof updBlogUrl === 'function') updBlogUrl();
    showM('mblog');
};


// ==========================================
// ЗАПУСК АДМИНКИ ПРИ ЗАГРУЗКЕ СТРАНИЦЫ
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    // Вызываем загрузку данных из базы
    loadAllData();
});
