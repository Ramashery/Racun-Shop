// main.js (НАДЕЖНАЯ ВЕРСИЯ)
import { db, collection, getDocs, doc, getDoc, query, where, orderBy, limit } from './firebase-config.js';

// --- НАДЕЖНЫЙ ПОИСК ДАННЫХ В ОБЪЕКТЕ ---
// Эта функция пытается найти значение по нескольким возможным ключам
function getData(dataObject, keys, defaultValue = '') {
    for (const key of keys) {
        if (dataObject && typeof dataObject[key] !== 'undefined' && dataObject[key] !== null) {
            return dataObject[key];
        }
    }
    return defaultValue;
}

// --- ШАБЛОНЫ HTML С НАДЕЖНЫМ ПОИСКОМ ДАННЫХ ---

function createProductCard(productData) {
    const product = {
        id: productData.id,
        // Пытаемся найти имя по ключам 'name', 'title', 'productName'
        name: getData(productData, ['name', 'title', 'productName'], 'Unnamed Product'),
        // Для slug используем 'slug' или 'categorySlug'
        categorySlug: getData(productData, ['categorySlug', 'category'], ''),
        categoryLabel: getData(productData, ['categoryLabel'], 'Category'),
        price: getData(productData, ['price'], 0),
        shortDescription: getData(productData, ['shortDescription', 'description'], ''),
        imageUrl: getData(productData, ['imageUrl', 'image', 'mainImage'], 'https://via.placeholder.com/300x400?text=No+Image'),
        badge: getData(productData, ['badge'], '')
    };

    let badgeHtml = '';
    if (product.badge) {
        const badgeClass = product.badge.toLowerCase().includes('new') ? 'new' : 
                           product.badge.toLowerCase().includes('best') ? 'popular' : '';
        badgeHtml = `<span class="card-badge ${badgeClass}">${product.badge}</span>`;
    }

    const link = `product.html?id=${product.id}`;
    return `
    <a href="${link}" class="card-room-new" data-cat="${product.categorySlug}" data-price="${product.price}" data-name="${product.name}">
      <div class="card-img-wrap">
        ${badgeHtml}
        <img alt="${product.name}" draggable="false" src="${product.imageUrl}"/>
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


function createBlogCard(postData, isFeatured = false, isRelated = false) {
    const post = {
        id: postData.id,
        title: getData(postData, ['title', 'name', 'headline'], 'Untitled Post'),
        category: getData(postData, ['category', 'topic'], 'General'),
        tag: getData(postData, ['tag'], 'Info'),
        date: getData(postData, ['date', 'publishDate'], ''),
        readTime: getData(postData, ['readTime', 'readingTime'], ''),
        shortDescription: getData(postData, ['shortDescription', 'summary', 'excerpt'], ''),
        imageUrl: getData(postData, ['imageUrl', 'image', 'coverImage'], 'https://via.placeholder.com/400x225?text=No+Image'),
        author: getData(postData, ['author', 'authorName'], 'Staff'),
        authorInitials: getData(postData, ['authorInitials'], 'A'),
        authorRole: getData(postData, ['authorRole'], 'Writer'),
        lead: getData(postData, ['lead', 'intro'], ''),
        contentHtml: getData(postData, ['contentHtml', 'content', 'body'], '<p>Content not available.</p>'),
        authorBio: getData(postData, ['authorBio'], '')
    };

    const postLink = `post.html?id=${post.id}`;
    if (isFeatured) {
        return `...`; // Оставим код для featured и related без изменений, т.к. он использует тот же объект `post`
    }
    if (isRelated) {
        return `...`;
    }

    // HTML-код для обычной карточки блога
    return `
    <a href="${postLink}" class="article-card" data-cat="${post.category.toLowerCase().replace(/\s+/g, '-')}">
        <div class="article-img">
            <div class="article-img-inner blue" style="background-image: url('${post.imageUrl}'); background-size: cover;"></div>
            <span class="article-tag tag-tech">${post.tag}</span>
        </div>
        <div class="article-body">
            <div class="article-meta">
                <span class="article-cat">${post.category}</span><div class="article-dot"></div>
                <span class="article-date">${post.date}</span><div class="article-dot"></div>
                <span class="article-read">${post.readTime}</span>
            </div>
            <h3>${post.title}</h3>
            <p>${post.shortDescription}</p>
            <div class="article-footer">
                <div class="article-author">
                    <div class="article-avatar avatar-blue">${post.authorInitials}</div>
                    <div><div class="article-author-name">${post.author}</div><div class="article-author-role">${post.authorRole}</div></div>
                </div>
                <div class="article-arrow"><span class="material-symbols-outlined">arrow_forward</span></div>
            </div>
        </div>
    </a>`;
}

// Функции-загрузчики (loadProductsList, loadPostsList и т.д.) остаются почти без изменений,
// но теперь они будут передавать в шаблоны `doc.data()` как есть.

// --- УТИЛИТЫ (без изменений) ---
const getUrlParam = (param) => new URLSearchParams(window.location.search).get(param);
const setContent = (id, content) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = content || '';
};

// --- ОСНОВНЫЕ ФУНКЦИИ ЗАГРУЗКИ ---

// Главная функция, которая определяет, что загружать на текущей странице
async function renderContent() {
    console.log("renderContent: Starting to render content for", window.location.pathname);
    const path = window.location.pathname;
    
    try {
        if (path.endsWith('index.html') || path === '/' || path.endsWith('/')) {
            await loadProductsList(5, 'rooms-track');
            await loadPostsList({ homeContainerId: 'services-track', homeLimit: 4 });
        } else if (path.endsWith('catalog.html')) {
            await loadProductsList(null, 'products-grid');
        } else if (path.endsWith('blog.html')) {
            await loadPostsList({ featuredContainerId: 'featured-post-container', gridContainerId: 'articles-grid' });
        } else if (path.endsWith('product.html')) {
            await loadSingleProduct();
        } else if (path.endsWith('post.html')) {
            await loadSinglePost();
        }
    } catch (e) {
        console.error("Fatal error during rendering:", e);
    }
}

// ... (остальные функции-загрузчики из предыдущего ответа остаются почти без изменений,
// но теперь они будут вызывать шаблоны, передавая в них ` { id: doc.id, ...doc.data() } `)

async function loadProductsList(count, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    console.log(`loadProductsList: Fetching for container #${containerId}`);
    try {
        let q = collection(db, 'products');
        if (count) {
            q = query(q, limit(count));
        }
        const snapshot = await getDocs(q);
        if (snapshot.empty) {
            console.warn(`No products found in 'products' collection.`);
            container.innerHTML = `<p style="padding: 20px;">No products to display.</p>`;
            return;
        }

        container.innerHTML = snapshot.docs.map(doc => createProductCard({ id: doc.id, ...doc.data() })).join('');
        console.log(`Successfully rendered ${snapshot.size} products into #${containerId}`);

        if (containerId === 'rooms-track' && window.initDragTrack) window.initDragTrack('rooms-track');
        if (containerId === 'products-grid' && window.applyFilters) window.applyFilters();
    } catch (e) { console.error(`Error loading products for ${containerId}:`, e); }
}

async function loadPostsList({ homeContainerId, featuredContainerId, gridContainerId, homeLimit = 4 }) {
    console.log("loadPostsList: Fetching blog posts.");
    try {
        const q = query(collection(db, 'blog'), orderBy("date", "desc"));
        const snapshot = await getDocs(q);
        if (snapshot.empty) {
            console.warn("No posts found in 'blog' collection.");
            return;
        }
        const posts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        if (homeContainerId && document.getElementById(homeContainerId)) {
            document.getElementById(homeContainerId).innerHTML = posts.slice(0, homeLimit).map(post => createBlogCard(post)).join('');
            if (window.initDragTrack) window.initDragTrack(homeContainerId);
        }

        if (featuredContainerId && gridContainerId && document.getElementById(featuredContainerId)) {
            if (posts.length > 0) document.getElementById(featuredContainerId).innerHTML = createBlogCard(posts[0], true);
            if (posts.length > 1) document.getElementById(gridContainerId).innerHTML = posts.slice(1).map(post => createBlogCard(post)).join('');
        }
    } catch(e) { console.error("Error loading post lists:", e); }
}

async function loadSingleProduct() {
    const productId = getUrlParam('id');
    if (!productId) return;
    console.log(`loadSingleProduct: Fetching product with ID: ${productId}`);

    try {
        const docSnap = await getDoc(doc(db, "products", productId));
        if (!docSnap.exists()) { throw new Error("Product not found in database."); }
        
        const data = docSnap.data();
        document.title = `RAKUN — ${getData(data, ['name', 'title'])}`;
        setContent('breadcrumb-product-name', getData(data, ['name', 'title']));
        setContent('prod-category', getData(data, ['categoryLabel']));
        setContent('prod-name', getData(data, ['name', 'title']));
        setContent('prod-short-desc', getData(data, ['shortDescription', 'description']));
        
        const carousel = document.getElementById('prod-carousel');
        const imageUrls = getData(data, ['imageUrls', 'images'], []);
        if (carousel && imageUrls.length) {
            carousel.innerHTML = imageUrls.map(url => `<div class="carousel-cell"><img src="${url}" alt="${getData(data, ['name'])}"></div>`).join('');
            if (window.initProductCarousel) window.initProductCarousel();
        }
        
        const features = getData(data, ['features'], []);
        if (features.length > 0) {
           setContent('prod-features', features.map(f => `<div class="feature-pill">${f}</div>`).join(''));
        }

        setContent('prod-desc-content', getData(data, ['fullDescription', 'descriptionHtml']));
        setContent('prod-ingredients-content', getData(data, ['ingredients', 'ingredientsHtml']));
        setContent('prod-safety-content', getData(data, ['safetyInfo', 'safetyHtml']));

        loadRelatedProducts(getData(data, ['categorySlug', 'category']), productId);
    } catch (e) { console.error("Error loading single product:", e); setContent('prod-name', e.message); }
}

// ... Остальные функции (loadSinglePost, loadRelated) остаются такими же ...

document.addEventListener('DOMContentLoaded', renderContent);
