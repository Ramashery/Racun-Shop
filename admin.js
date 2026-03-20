// admin.js (Адаптированная версия)
import { 
    getFirestore, collection, getDocs, doc, getDoc, addDoc, updateDoc, deleteDoc, orderBy, query, serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
// Вам понадобится аутентификация для защиты
// import { getAuth, onAuthStateChanged, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";

// КОНФИГУРАЦИЯ (копируем, чтобы admin.js был независимым)
const firebaseConfig = {
  apiKey: "AIzaSyAGXs4wc4vcxxy2cMoHMC8_MlD9S_chSQY",
  authDomain: "racun-shop.firebaseapp.com",
  projectId: "racun-shop",
  storageBucket: "racun-shop.appspot.com",
  messagingSenderId: "569457770232",
  appId: "1:569457770232:web:5a2737d1ee270459f3050d",
  measurementId: "G-NCTM22413W"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
// const auth = getAuth(app); // Раскомментируйте, когда добавите логин

let allProducts = [];
let editingId = null;

// --- УТИЛИТЫ ---
const showModal = (id) => document.getElementById(id)?.classList.add('on');
const closeModal = (id) => document.getElementById(id)?.classList.remove('on');

// Собирает данные из формы в нужную вложенную структуру
function getFormValues(formSelector) {
    const data = { globalFields: {}, en: {} }; // Готовим структуру
    document.querySelectorAll(`${formSelector} [data-field]`).forEach(el => {
        const key = el.dataset.field;
        const scope = el.dataset.scope || 'en'; // По умолчанию все поля языкозависимы (en)
        let value = el.value.trim();

        if (el.dataset.type === 'array') {
            value = value.split(',').map(s => s.trim()).filter(Boolean);
        } else if (el.dataset.type === 'number') {
            value = parseFloat(value) || 0;
        }
        
        if (scope === 'global') {
            data.globalFields[key] = value;
        } else {
            data[scope][key] = value;
        }
    });
    // Добавляем поле lastModified
    data.globalFields.lastModified = serverTimestamp();
    return data;
}

// Заполняет форму из вложенной структуры данных
function setFormValues(formSelector, data) {
    document.querySelectorAll(`${formSelector} [data-field]`).forEach(el => {
        const key = el.dataset.field;
        const scope = el.dataset.scope || 'en';
        let value = '';
        
        if (data && data[scope] && typeof data[scope][key] !== 'undefined') {
            value = data[scope][key];
        }

        if (Array.isArray(value)) {
            el.value = value.join(', ');
        } else {
            el.value = value;
        }
    });
}


// --- CRUD ОПЕРАЦИИ ---

async function saveProduct() {
    const data = getFormValues('#mprod');
    if (!data.en.name || !data.globalFields.slug) {
        alert('Product Name and Slug are required.');
        return;
    }
    
    try {
        if (editingId) {
            await updateDoc(doc(db, 'products', editingId), data);
        } else {
            await addDoc(collection(db, 'products'), data);
        }
        closeModal('mprod');
        await fetchData();
    } catch (e) { console.error("Error saving product:", e); alert("Failed to save product."); }
}

function openNewProduct() {
    editingId = null;
    setFormValues('#mprod', {}); // Очищаем форму
    document.getElementById('mprod-title').textContent = "New Product";
    showModal('mprod');
}

function openEditProduct(id) {
    editingId = id;
    const product = allProducts.find(p => p.id === id);
    if (product) {
        setFormValues('#mprod', { globalFields: product.globalFields, en: product.en });
        document.getElementById('mprod-title').textContent = "Edit Product";
        showModal('mprod');
    }
}

async function deleteProduct(id) {
    if (!confirm('Are you sure? This cannot be undone.')) return;
    try {
        await deleteDoc(doc(db, 'products', id));
        await fetchData();
    } catch (e) { console.error("Error deleting product:", e); alert("Failed to delete."); }
}


// --- ЗАГРУЗКА И ОТРИСОВКА ---

function renderProducts() {
    const tbody = document.getElementById('products-tbody');
    if (!tbody) return;
    tbody.innerHTML = allProducts.map(p => {
        // Извлекаем данные с помощью нашей новой логики
        const data = extractData(p);
        return `
        <tr>
            <td>
                <div class="pnc">
                    <img src="${data.imageUrls[0] || 'https://via.placeholder.com/44'}" class="pth">
                    <div>
                        <div class="pnm">${data.name}</div>
                        <div class="pcm">${p.globalFields.sku || 'No SKU'}</div>
                    </div>
                </div>
            </td>
            <td>${data.categoryLabel}</td>
            <td>${data.price} GEL</td>
            <td><div class="lf"><span class="lfl d">EN</span></div></td>
            <td><span class="sb2 sp">Published</span></td>
            <td><a href="/product.html?id=${p.id}" target="_blank">/${data.slug}</a></td>
            <td>
                <div class="ra">
                    <button class="ib" onclick="window.admin.openEditProduct('${p.id}')"><span class="material-symbols-outlined ic">edit</span></button>
                    <button class="ib dr" onclick="window.admin.deleteProduct('${p.id}')"><span class="material-symbols-outlined ic">delete</span></button>
                </div>
            </td>
        </tr>
    `}).join('');
    document.getElementById('bdgp').textContent = allProducts.length;
}

async function fetchData() {
    try {
        const productsSnap = await getDocs(query(collection(db, 'products'), orderBy('globalFields.lastModified', 'desc')));
        allProducts = productsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderProducts();
    } catch (e) { console.error("Error fetching data:", e); }
}

// --- ИНИЦИАЛИЗАЦИЯ ---

window.admin = { openNewProduct, openEditProduct, saveProduct, deleteProduct };
document.addEventListener('DOMContentLoaded', fetchData);
