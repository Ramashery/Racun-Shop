// main.js
import { db, collection, getDocs, doc, getDoc, query, where, orderBy, limit } from './firebase-config.js';

// --- ШАБЛОНЫ HTML ---

// Шаблон карточки товара (для index.html, catalog.html, и секции "related")
function createProductCard(product, isRelated = false) {
  let badgeHtml = '';
  if (product.badge) {
    const badgeClass = product.badge.toLowerCase() === 'new' ? 'new' : 
                       product.badge.toLowerCase() === 'best seller' ? 'popular' : '';
    badgeHtml = `<span class="card-badge ${badgeClass}">${product.badge}</span>`;
  }

  const link = isRelated ? '#' : `product.html?id=${product.id}`;
  const linkText = isRelated ? 'Buy' : 'Details';

  return `
    <a href="${link}" class="card-room-new" data-cat="${product.category}" data-price="${product.price}" data-name="${product.name}">
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
        <span class="card-link">${linkText} <span>&#8594;</span></span>
      </div>
    </a>
  `;
}

// Шаблон карточки блога
function createBlogCard(post, isFeatured = false, isRelated = false) {
    if (isFeatured) {
        return `
            <a href="post.html?id=${post.id}" class="featured-card">
                <div class="featured-img">
                    <div class="featured-img-inner"><img src="${post.imageUrl}" style="width:100%; height:100%; object-fit: cover;"></div>
                    <span class="featured-tag">${post.tag || 'Technology'}</span>
                </div>
                <div class="featured-body">
                    <div class="featured-meta">
                        <span class="featured-cat">${post.category}</span><div class="featured-dot"></div>
                        <span class="featured-date">${post.date}</span><div class="featured-dot"></div>
                        <span class="featured-date">${post.readTime}</span>
                    </div>
                    <h2>${post.title.replace(/(Polymer-Encapsulated)/, '<span>$1</span>')}</h2>
                    <p>${post.shortDescription}</p>
                    <span class="featured-read-more">Read Full Article <span class="material-symbols-outlined arrow">arrow_forward</span></span>
                </div>
            </a>`;
    }

    if(isRelated) {
        return `
        <a href="post.html?id=${post.id}" class="rel-card">
            <div class="rel-card-img green"><img src="${post.imageUrl}" style="width:100%; height:100%; object-fit: cover;"></div>
            <div class="rel-card-body">
                <span class="rel-card-cat">${post.category}</span>
                <div class="rel-card-title">${post.title}</div>
                <div class="rel-card-date">${post.date} · ${post.readTime}</div>
            </div>
        </a>`
    }

    return `
    <a href="post.html?id=${post.id}" class="article-card" data-cat="${post.category.toLowerCase()}">
        <div class="article-img">
            <div class="article-img-inner blue"><img src="${post.imageUrl}" style="width:100%; height:100%; object-fit: cover;"></div>
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
                    <div class="article-avatar avatar-blue">${post.authorInitials || 'A'}</div>
                    <div>
                        <div class="article-author-name">${post.author}</div>
                        <div class="article-author-role">${post.authorRole}</div>
                    </div>
                </div>
                <div class="article-arrow"><span class="material-symbols-outlined">arrow_forward</span></div>
            </div>
        </div>
    </a>`;
}

// --- УТИЛИТЫ ---
// Функция для получения параметра из URL
function getUrlParam(param) {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get(param);
}

// --- ЗАГРУЗКА СПИСКОВ (ДЛЯ index.html, catalog.html, blog.html) ---

async function loadProductsList() {
    const roomsTrack = document.getElementById('rooms-track'); // на главной
    const productsGrid = document.getElementById('products-grid'); // в каталоге
    
    if (!roomsTrack && !productsGrid) return;

    try {
        const productsSnapshot = await getDocs(collection(db, 'products'));
        const products = [];
        productsSnapshot.forEach((doc) => {
            products.push({ id: doc.id, ...doc.data() });
        });

        if (roomsTrack) {
            roomsTrack.innerHTML = products.slice(0, 5).map(p => createProductCard(p)).join('');
            if (window.initDragTrack) window.initDragTrack('rooms-track');
        }

        if (productsGrid) {
            productsGrid.innerHTML = products.map(p => createProductCard(p)).join('');
            if (window.applyFilters) window.applyFilters();
        }
    } catch (error) {
        console.error("Error loading products list: ", error);
    }
}

async function loadPostsList() {
    const servicesTrack = document.getElementById('services-track'); // на главной
    const featuredContainer = document.getElementById('featured-post-container'); // в блоге
    const articlesGrid = document.getElementById('articles-grid'); // в блоге

    if (!servicesTrack && !featuredContainer && !articlesGrid) return;
    
    try {
        const q = query(collection(db, 'blog'), orderBy("date", "desc"));
        const postsSnapshot = await getDocs(q);
        const posts = [];
        postsSnapshot.forEach((doc) => {
            posts.push({ id: doc.id, ...doc.data() });
        });

        if (servicesTrack) { // Главная
            servicesTrack.innerHTML = posts.slice(0, 4).map(post => createBlogCard(post, false)).join('');
             if (window.initDragTrack) window.initDragTrack('services-track');
        }

        if (featuredContainer && articlesGrid) { // Страница блога
            if(posts.length > 0) {
                 featuredContainer.innerHTML = createBlogCard(posts[0], true); // Первый пост - главный
            }
            if(posts.length > 1) {
                articlesGrid.innerHTML = posts.slice(1).map(post => createBlogCard(post, false)).join(''); // Остальные в сетку
            }
        }
    } catch (error) {
        console.error("Error loading posts list: ", error);
    }
}

// --- ЗАГРУЗКА ДАННЫХ ДЛЯ ОДНОЙ СТРАНИЦЫ (product.html, post.html) ---

async function loadSingleProduct() {
  const productId = getUrlParam('id');
  if (!productId) return; // Выходим, если это не страница товара

  try {
    const docRef = doc(db, "products", productId);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      const product = docSnap.data();
      
      // Заполняем основные поля
      document.title = `RAKUN — ${product.name}`;
      document.getElementById('breadcrumb-product-name').textContent = product.name;
      document.getElementById('prod-category').textContent = product.categoryLabel;
      document.getElementById('prod-name').innerHTML = product.name.replace('<br>', ''); // Безопаснее innerHTML для <br>
      document.getElementById('prod-short-desc').textContent = product.shortDescription;
      document.getElementById('prod-cta-btn').textContent = product.ctaButtonText || 'Request Price';

      // Карусель изображений
      const carouselContainer = document.getElementById('prod-carousel');
      if (product.imageUrls && product.imageUrls.length > 0) {
        carouselContainer.innerHTML = product.imageUrls.map(url => 
            `<div class="carousel-cell"><img src="${url}" alt="${product.name}"></div>`
        ).join('');
        if (window.initProductCarousel) window.initProductCarousel(); // Запускаем Flickity
      }

      // Бейджи
      if (product.badge) {
        const badgeEl = document.getElementById('prod-badge');
        badgeEl.textContent = product.badge;
        badgeEl.style.display = 'block';
      }
       if (product.washes) {
        const washesEl = document.getElementById('prod-washes');
        washesEl.innerHTML = `${product.washes}<span>Washes</span>`;
        washesEl.style.display = 'flex';
      }

      // Фичи (Pills)
      if (product.features && product.features.length > 0) {
        document.getElementById('prod-features').innerHTML = product.features.map(f => `<div class="feature-pill">${f}</div>`).join('');
      }

      // Вкладки с контентом
      document.getElementById('prod-desc-content').innerHTML = product.fullDescription || '';
      document.getElementById('prod-ingredients-content').innerHTML = product.ingredients || '';
      document.getElementById('prod-safety-content').innerHTML = product.safetyInfo || '';

    } else {
      console.log("No such product!");
      document.getElementById('prod-name').textContent = "Product not found";
    }
  } catch (error) {
    console.error("Error loading single product: ", error);
  }
}

async function loadSinglePost() {
    const postId = getUrlParam('id');
    if (!postId) return;

    try {
        const docRef = doc(db, "blog", postId);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const post = docSnap.data();

            document.title = `RAKUN — ${post.title}`;
            document.getElementById('post-breadcrumb-title').textContent = post.category;
            document.getElementById('post-tag').textContent = post.tag;
            document.getElementById('post-date').textContent = post.date;
            document.getElementById('post-read-time').textContent = post.readTime;
            document.getElementById('post-title').innerHTML = post.title;
            document.getElementById('post-lead').textContent = post.lead;
            
            document.getElementById('post-author-avatar').textContent = post.authorInitials;
            document.getElementById('post-author-name').textContent = post.author;
            document.getElementById('post-author-role').textContent = post.authorRole;
            
            document.getElementById('sidebar-author-avatar').textContent = post.authorInitials;
            document.getElementById('sidebar-author-name').textContent = post.author;
            document.getElementById('sidebar-author-role').textContent = post.authorRole;
            document.getElementById('sidebar-author-bio').textContent = post.authorBio;

            document.getElementById('post-body-content').innerHTML = post.contentHtml;

            // Загрузка связанных постов
            loadRelatedPosts(post.category, postId);
        } else {
            document.getElementById('post-title').textContent = "Post not found";
        }
    } catch(error) {
        console.error("Error loading single post: ", error);
    }
}

async function loadRelatedPosts(currentCategory, currentPostId) {
    const relatedGrid = document.getElementById('bottom-related-grid');
    if (!relatedGrid) return;
    
    try {
        const q = query(
            collection(db, "blog"), 
            where("category", "==", currentCategory), // Ищем в той же категории
            limit(4) // Загружаем 4, чтобы был запас, если попадется текущий пост
        );
        const snapshot = await getDocs(q);
        let postsHtml = '';
        let count = 0;
        snapshot.forEach(doc => {
            if (doc.id !== currentPostId && count < 3) {
                postsHtml += createBlogCard({ id: doc.id, ...doc.data() }, false, true);
                count++;
            }
        });
        relatedGrid.innerHTML = postsHtml;
    } catch (error) {
        console.error("Error loading related posts: ", error);
    }
}


// --- ГЛАВНЫЙ ВЫЗОВ ПРИ ЗАГРУЗКЕ СТРАНИЦЫ ---

document.addEventListener('DOMContentLoaded', () => {
  // Вызываем функции для отрисовки списков
  loadProductsList();
  loadPostsList();

  // Вызываем функции для отрисовки одной страницы (они сами проверят URL)
  loadSingleProduct();
  loadSinglePost();
});
