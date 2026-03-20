// admin.js
import { db, collection, getDocs, doc, getDoc, addDoc, updateDoc, deleteDoc, orderBy, query } from './firebase-config.js';
// ВАЖНО: вам нужно будет добавить Firebase Authentication для защиты записи
// import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

// Глобальные переменные для хранения загруженных данных
let allProducts = [];
let allCategories = [];
let allPosts = [];
let editingId = null; // ID редактируемого документа

// --- УТИЛИТЫ ---
const showModal = (id) => document.getElementById(id)?.classList.add('on');
const closeModal = (id) => document.getElementById(id)?.classList.remove('on');
const getFormValues = (formSelector) => {
    const data = {};
    document.querySelectorAll(`${formSelector} [data-field]`).forEach(el => {
        const key = el.dataset.field;
        if (el.type === 'checkbox') {
            data[key] = el.checked;
        } else if (el.type === 'number') {
            data[key] = parseFloat(el.value) || 0;
        } else if (el.dataset.type === 'array') {
            data[key] = el.value.split(',').map(s => s.trim()).filter(Boolean);
        } else {
            data[key] = el.value.trim();
        }
    });
    return data;
};
const setFormValues = (formSelector, data) => {
    document.querySelectorAll(`${formSelector} [data-field]`).forEach(el => {
        const key = el.dataset.field;
        if (data && data.hasOwnProperty(key)) {
             if (el.type === 'checkbox') {
                el.checked = data[key];
            } else if (Array.isArray(data[key])) {
                el.value = data[key].join(', ');
            } else {
                el.value = data[key];
            }
        } else {
            el.value = ''; // Очистка, если данных нет
        }
    });
};

// --- ФУНКЦИИ ОТРИСОВКИ ---

function renderProducts() {
    const tbody = document.getElementById('products-tbody');
    if (!tbody) return;
    tbody.innerHTML = allProducts.map(p => `
        <tr>
            <td>
                <div class="pnc">
                    <img src="${p.imageUrl || 'https://via.placeholder.com/44'}" class="pth">
                    <div>
                        <div class="pnm">${p.name}</div>
                        <div class="pcm">${p.sku || 'No SKU'}</div>
                    </div>
                </div>
            </td>
            <td>${p.categoryLabel || 'N/A'}</td>
            <td>${p.price || 0} GEL</td>
            <td><div class="lf"><span class="lfl d">EN</span></div></td>
            <td><span class="sb2 sp">Published</span></td>
            <td><a href="/product.html?id=${p.id}" target="_blank">/${p.categorySlug}/${p.slug}</a></td>
            <td>
                <div class="ra">
                    <button class="ib" onclick="window.admin.editProduct('${p.id}')"><span class="material-symbols-outlined ic">edit</span></button>
                    <button class="ib dr" onclick="window.admin.deleteItem('products', '${p.id}')"><span class="material-symbols-outlined ic">delete</span></button>
                </div>
            </td>
        </tr>
    `).join('');
}

function renderBlogPosts() {
    const tbody = document.getElementById('blog-tbody');
    if (!tbody) return;
    tbody.innerHTML = allPosts.map(p => `
        <tr>
            <td>${p.title}</td>
            <td><span class="chip cb">${p.category}</span></td>
            <td>${p.author}</td>
            <td><div class="lf"><span class="lfl d">EN</span></div></td>
            <td><span class="sb2 sp">Published</span></td>
            <td><a href="/post.html?id=${p.id}" target="_blank">/blog/${p.slug}</a></td>
            <td>${p.date}</td>
            <td>
                <div class="ra">
                    <button class="ib" onclick="window.admin.editPost('${p.id}')"><span class="material-symbols-outlined ic">edit</span></button>
                    <button class="ib dr" onclick="window.admin.deleteItem('blog', '${p.id}')"><span class="material-symbols-outlined ic">delete</span></button>
                </div>
            </td>
        </tr>
    `).join('');
}

// --- ФУНКЦИИ ЗАГРУЗКИ ДАННЫХ ---

async function fetchData() {
    try {
        const [productsSnap, blogSnap] = await Promise.all([
            getDocs(query(collection(db, 'products'), orderBy('name'))),
            getDocs(query(collection(db, 'blog'), orderBy('date', 'desc')))
        ]);
        
        allProducts = productsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        allPosts = blogSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        renderProducts();
        renderBlogPosts();
        
        document.getElementById('bdgp').textContent = allProducts.length;
        document.getElementById('bdgb').textContent = allPosts.length;

    } catch (e) {
        console.error("Error fetching data:", e);
        alert("Failed to load data from Firestore. Check console for details.");
    }
}


// --- ФУНКЦИИ CRUD (Create, Read, Update, Delete) ---

// CREATE / UPDATE
async function saveProduct() {
    const data = getFormValues('#mprod'); // Предполагаем, что у полей в модалке есть data-field атрибуты
    if (!data.name || !data.slug || !data.categorySlug) {
        alert('Name, Slug, and Category Slug are required.');
        return;
    }
    
    try {
        if (editingId) {
            // Update
            await updateDoc(doc(db, 'products', editingId), data);
        } else {
            // Create
            await addDoc(collection(db, 'products'), data);
        }
        closeModal('mprod');
        await fetchData(); // Обновляем список
    } catch (e) {
        console.error("Error saving product:", e);
        alert("Failed to save product.");
    }
}

async function savePost() {
    const data = getFormValues('#mblog');
    if (!data.title || !data.slug) {
        alert('Title and Slug are required.');
        return;
    }
    
    try {
        if (editingId) {
            await updateDoc(doc(db, 'blog', editingId), data);
        } else {
            await addDoc(collection(db, 'blog'), data);
        }
        closeModal('mblog');
        await fetchData();
    } catch (e) {
        console.error("Error saving post:", e);
        alert("Failed to save post.");
    }
}

// EDIT (Open modal with data)
function newProduct() {
    editingId = null;
    setFormValues('#mprod', {}); // Очистить форму
    showModal('mprod');
}

function editProduct(id) {
    editingId = id;
    const product = allProducts.find(p => p.id === id);
    if (product) {
        setFormValues('#mprod', product);
        showModal('mprod');
    }
}

function newPost() {
    editingId = null;
    setFormValues('#mblog', {});
    showModal('mblog');
}

function editPost(id) {
    editingId = id;
    const post = allPosts.find(p => p.id === id);
    if (post) {
        setFormValues('#mblog', post);
        showModal('mblog');
    }
}


// DELETE
async function deleteItem(collectionName, id) {
    if (!confirm('Are you sure you want to delete this item? This action cannot be undone.')) {
        return;
    }
    try {
        await deleteDoc(doc(db, collectionName, id));
        await fetchData(); // Обновляем данные после удаления
    } catch (e) {
        console.error("Error deleting item:", e);
        alert('Failed to delete item.');
    }
}


// --- ИНИЦИАЛИЗАЦИЯ ---

// Выносим функции в глобальный объект, чтобы к ним можно было обратиться из HTML (onclick)
window.admin = {
    newProduct,
    editProduct,
    saveProduct,
    newPost,
    editPost,
    savePost,
    deleteItem,
};

// Привязываем события к кнопкам "New"
document.querySelector('button[onclick="showM(\'mprod\')"]')?.addEventListener('click', newProduct);
document.querySelector('button[onclick="showM(\'mblog\')"]')?.addEventListener('click', newPost);
// Привязываем события к кнопкам "Save" в модалках
// Нужно добавить id к кнопкам в admin.html, например id="save-product-btn"
document.getElementById('save-product-btn')?.addEventListener('click', saveProduct);
document.getElementById('save-post-btn')?.addEventListener('click', savePost);


// Запускаем загрузку данных при старте
fetchData();
