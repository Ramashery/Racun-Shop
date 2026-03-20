// main.js (ФИНАЛЬНАЯ ВЕРСИЯ ДЛЯ САЙТА)
import { db, collection, getDocs, doc, getDoc, query, where, orderBy, limit } from './firebase-config.js';

// --- УТИЛИТА ДЛЯ ИЗВЛЕЧЕНИЯ ДАННЫХ ---
// Извлекает данные, учитывая вашу структуру с globalFields и языками
function extractData(docData, lang = 'en') {
    const global = docData.globalFields || {};
    const local = docData[lang] || {}; // Получаем объект для конкретного языка (например, docData.en)
    
    // Собираем единый плоский объект для удобства
    return {
        // Глобальные поля
        id: docData.id,
        slug: global.slug,
        categoryId: global.categoryId,
        price: parseFloat(global.price) || 0,
        badge: global.badge,
        imageUrls: local.imageUrls || [], // Картинки теперь языкозависимы
        
        // Локализованные поля (для языка 'en')
        name: local.name,
        categoryLabel: local.categoryLabel,
        shortDescription: local.shortDescription,
        fullDescription: local.fullDescription,
        features: local.features || [],
        ingredients: local.ingredients,
        safetyInfo: local.safetyInfo,
        // ... добавьте другие локализованные поля по мере необходимости
    };
}


// --- ШАБЛОНЫ HTML (адаптированные) ---

function createProductCard(productData) {
    // Извлекаем и нормализуем данные
    const product = extractData(productData);

    let badgeHtml = '';
    if (product.badge) {
        const badgeClass = product.badge.toLowerCase().includes('new') ? 'new' : 
                           product.badge.toLowerCase().includes('best') ? 'popular' : '';
        badgeHtml = `<span class="card-badge ${badgeClass}">${product.badge}</span>`;
    }

    const mainImage = product.imageUrls.length > 0 ? product.imageUrls[0] : 'https://via.placeholder.com/300x400?text=No+Image';

    return `
    <a href="product.html?id=${product.id}" class="card-room-new" data-cat="${product.categoryId}" data-price="${product.price}" data-name="${product.name}">
      <div class="card-img-wrap">
        ${badgeHtml}
        <img alt="${product.name}" draggable="false" src="${mainImage}"/>
      </div>
      <div class="card-body">
        <span class="card-category">${product.categoryLabel}</span>
        <h3 class="card-title">${product.name}</h3>
        <p class="card-desc">${product.shortDescription}</p>
      </div>
      <div class="card-footer">
        <span class="card-price">${product.price} GEL</span>
        <span class="card-link">Details <span>&#8594;</span></span>
      </div>
    </a>`;
}

// ... Шаблон для блога createBlogCard() остается таким же, как в предыдущей версии,
// но вы должны убедиться, что его структура данных в Firestore тоже имеет `globalFields` и `en`.
// Если структура другая, его тоже нужно будет адаптировать.


// --- ГЛАВНЫЕ ФУНКЦИИ (без изменений, т.к. вся логика в extractData) ---

// ... (Весь остальной код из предыдущего ответа, начиная с `const getUrlParam = ...` и до конца, остается без изменений) ...

// --- УТИЛИТЫ ---
const getUrlParam = (param) => new URLSearchParams(window.location.search).get(param);
const setContent = (id, content) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = content || '';
};

async function renderContent() {
    const path = window.location.pathname.split('/').pop();
    
    try {
        if (path === 'index.html' || path === '') {
            await loadProductsList(5, 'rooms-track');
            // await loadPostsList({ homeContainerId: 'services-track' ... }); // Загрузка блога
        } else if (path === 'catalog.html') {
            await loadProductsList(null, 'products-grid');
        } else if (path === 'product.html') {
            await loadSingleProduct();
        } // ... и так далее для блога
    } catch (e) { console.error("Error in renderContent:", e); }
}

async function loadProductsList(count, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    try {
        let q = collection(db, 'products');
        if (count) {
            q = query(q, limit(count));
        }
        const snapshot = await getDocs(q);
        if (snapshot.empty) {
            container.innerHTML = `<p style="padding: 20px;">No products found.</p>`;
            return;
        }

        container.innerHTML = snapshot.docs.map(doc => createProductCard({ id: doc.id, ...doc.data() })).join('');

        if (containerId === 'rooms-track' && window.initDragTrack) window.initDragTrack('rooms-track');
        if (containerId === 'products-grid' && window.applyFilters) window.applyFilters();

    } catch (e) { console.error(`Error loading products for ${containerId}:`, e); }
}

async function loadSingleProduct() {
    const productId = getUrlParam('id');
    if (!productId) return;
    
    try {
        const docSnap = await getDoc(doc(db, "products", productId));
        if (!docSnap.exists()) { throw new Error("Product not found"); }
        
        const product = extractData({ id: docSnap.id, ...docSnap.data() });

        document.title = `RAKUN — ${product.name}`;
        setContent('breadcrumb-product-name', product.name);
        setContent('prod-category', product.categoryLabel);
        setContent('prod-name', product.name);
        setContent('prod-short-desc', product.shortDescription);
        
        const carousel = document.getElementById('prod-carousel');
        if (carousel && product.imageUrls.length) {
            carousel.innerHTML = product.imageUrls.map(url => `<div class="carousel-cell"><img src="${url}" alt="${product.name}"></div>`).join('');
            if (window.initProductCarousel) window.initProductCarousel();
        }
        
        if (product.features.length > 0) {
           setContent('prod-features', product.features.map(f => `<div class="feature-pill">${f}</div>`).join(''));
        }

        setContent('prod-desc-content', product.fullDescription);
        setContent('prod-ingredients-content', product.ingredients);
        setContent('prod-safety-content', product.safetyInfo);
        
        loadRelatedProducts(product.categoryId, productId);
    } catch (e) { console.error("Error loading single product:", e); setContent('prod-name', e.message); }
}

async function loadRelatedProducts(categoryId, currentId) {
    const container = document.getElementById('related-products-grid');
    if (!container) return;
    try {
        const q = query(
            collection(db, "products"), 
            where("globalFields.categoryId", "==", categoryId),
            limit(4) 
        );
        const snapshot = await getDocs(q);
        let relatedHtml = '';
        let count = 0;
        snapshot.forEach(doc => {
            if (doc.id !== currentId && count < 3) {
                relatedHtml += createProductCard({ id: doc.id, ...doc.data() });
                count++;
            }
        });
        container.innerHTML = relatedHtml;
    } catch (e) { console.error("Error loading related products: ", e); }
}

document.addEventListener('DOMContentLoaded', renderContent);
