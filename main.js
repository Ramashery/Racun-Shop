// main.js
import { db, collection, getDocs } from './firebase-config.js';

// --- ШАБЛОНЫ HTML ---

// Шаблон карточки товара (для index.html и catalog.html)
function createProductCard(product) {
  // Проверяем наличие бейджей
  let badgeHtml = '';
  if (product.badge) {
    const badgeClass = product.badge.toLowerCase() === 'new' ? 'new' : 
                       product.badge.toLowerCase() === 'best seller' ? 'popular' : '';
    badgeHtml = `<span class="card-badge ${badgeClass}">${product.badge}</span>`;
  }

  return `
    <div class="card-room-new" data-cat="${product.category}" data-price="${product.price}" data-name="${product.name}">
      <div class="card-img-wrap">
        ${badgeHtml}
        <img alt="${product.name}" draggable="false" src="${product.imageUrl || 'https://via.placeholder.com/300x400?text=No+Image'}"/>
      </div>
      <div class="card-body">
        <span class="card-category">${product.categoryLabel || product.category}</span>
        <h3 class="card-title">${product.name}</h3>
        <p class="card-desc">${product.shortDescription}</p>
      </div>
      <div class="card-footer">
        <span class="card-price">${product.price} GEL</span>
        <a class="card-link" href="product.html?id=${product.id}">Buy <span>&#8594;</span></a>
      </div>
    </div>
  `;
}

// Шаблон карточки блога (для index.html)
function createBlogCard(post) {
  return `
    <a href="post.html?id=${post.id}" class="service-card">
      <div class="service-card-img">
        <img src="${post.imageUrl}" draggable="false" alt="${post.title}">
      </div>
      <div class="service-card-body">
        <span class="service-card-cat">${post.category}</span>
        <h3 class="service-card-title">${post.title}</h3>
        <p class="service-card-desc">${post.shortDescription}</p>
        <span class="service-card-link">Read article</span>
      </div>
    </a>
  `;
}

// --- ПОЛУЧЕНИЕ И ОТРИСОВКА ДАННЫХ ---

// Загрузка товаров
async function loadProducts() {
  const roomsTrack = document.getElementById('rooms-track'); // на главной
  const productsGrid = document.getElementById('products-grid'); // в каталоге
  
  if (!roomsTrack && !productsGrid) return; // Если элементов нет на странице, прерываем

  try {
    const productsSnapshot = await getDocs(collection(db, 'products'));
    const products = [];
    productsSnapshot.forEach((doc) => {
      products.push({ id: doc.id, ...doc.data() });
    });

    // Отрисовка на главной (слайдер Drag)
    if (roomsTrack) {
      roomsTrack.innerHTML = products.map(p => createProductCard(p)).join('');
      // Инициализируем перетаскивание после рендера (из вашего старого скрипта в index.html)
      if(window.initDragTrack) window.initDragTrack('rooms-track');
    }

    // Отрисовка в каталоге
    if (productsGrid) {
      productsGrid.innerHTML = products.map(p => createProductCard(p)).join('');
      // Обновляем счетчик
      const resultsCount = document.getElementById('results-count');
      if(resultsCount) resultsCount.innerHTML = `<strong>${products.length}</strong> products found`;
      
      // Перезапускаем фильтры из вашего старого скрипта catalog.html
      if(window.applyFilters) window.applyFilters();
    }
  } catch (error) {
    console.error("Error loading products: ", error);
  }
}

// Загрузка постов для главной
async function loadLatestPosts() {
  const servicesTrack = document.getElementById('services-track');
  if (!servicesTrack) return;

  try {
    const postsSnapshot = await getDocs(collection(db, 'blog'));
    const posts = [];
    postsSnapshot.forEach((doc) => {
      posts.push({ id: doc.id, ...doc.data() });
    });

    servicesTrack.innerHTML = posts.map(post => createBlogCard(post)).join('');
    if(window.initDragTrack) window.initDragTrack('services-track');
    
  } catch (error) {
    console.error("Error loading posts: ", error);
  }
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
  loadProducts();
  loadLatestPosts();
});
