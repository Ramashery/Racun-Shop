// ============================================================
//  RAKUN Admin Panel — Firebase SPA Controller (v2.0 - Complete)
//  Полная логика, включая CRUD, страницы и настройки.
// ============================================================
import {
    initializeApp
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import {
    getFirestore,
    collection,
    getDocs,
    doc,
    getDoc,
    setDoc,
    updateDoc,
    deleteDoc,
    addDoc,
    terminate
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyAGXs4wc4vcxxy2cMoHMC8_MlD9S_chSQY",
    authDomain: "racun-shop.firebaseapp.com",
    projectId: "racun-shop",
    storageBucket: "racun-shop.appspot.com",
    messagingSenderId: "569457770232",
    appId: "1:569457770232:web:5a2737d1ee270459f3050d"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

window.addEventListener('beforeunload', () => terminate(db).catch(() => {}));

// ─── Константы ──────────────────────────────────────────────
const LANGS = ['en', 'ru', 'ka', 'hy'];

// ─── Глобальный стейт ───────────────────────────────────────
let state = { categories: [], products: [], posts: [] };
let currentEditingId = null;
let currentCollection = null;
let selColor = '#4f7dff';
let pendingDeleteId = null;
let pendingDeleteCol = null;
const pagesCache = {};
const pageLangs = { home: 'en', catalog: 'en', contacts: 'en', 'footer-nav': 'en' };

// ════════════════════════════════════════════════════════════
// 0. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ════════════════════════════════════════════════════════════
function getLocalVal(d, key, lang = 'en') {
    if (!d) return '';
    if (d.translations?.[lang]?.[key] !== undefined) return d.translations[lang][key];
    if (d[lang]?.[key] !== undefined) return d[lang][key];
    if (d.globalFields?.[key] !== undefined) return d.globalFields[key];
    return d[key] || '';
}
function escH(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function getV(id) { return document.getElementById(id)?.value || ''; }
function setV(id, v) { const el = document.getElementById(id); if (el) el.value = v ?? ''; }
function setText(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }

function showToast(msg, type = 'ok') {
    let t = document.getElementById('_toast');
    if (!t) {
        t = document.createElement('div');
        t.id = '_toast';
        Object.assign(t.style, {
            position: 'fixed', bottom: '28px', right: '28px', zIndex: '9999',
            padding: '13px 24px', borderRadius: '10px', fontSize: '14px', fontWeight: '700',
            color: '#fff', boxShadow: '0 4px 24px rgba(0,0,0,.28)',
            transition: 'opacity .35s', pointerEvents: 'none'
        });
        document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.background = type === 'ok' ? '#22c55e' : '#ef4444';
    t.style.opacity = '1';
    clearTimeout(t._t);
    t._t = setTimeout(() => { t.style.opacity = '0'; }, 3200);
}

// ════════════════════════════════════════════════════════════
// 1. ЗАГРУЗКА ДАННЫХ ИЗ FIRESTORE
// ════════════════════════════════════════════════════════════
async function loadAllData() {
    setV('fb-status', 'Loading…');
    try {
        const [catS, prodS, postS] = await Promise.all([
            getDocs(collection(db, 'categories')),
            getDocs(collection(db, 'products')),
            getDocs(collection(db, 'blog')),
        ]);
        state.categories = catS.docs.map(d => ({ id: d.id, ...d.data() }));
        state.products = prodS.docs.map(d => ({ id: d.id, ...d.data() }));
        state.posts = postS.docs.map(d => ({ id: d.id, ...d.data() }));
        renderAll();
        setV('fb-status', 'Connected ✓');
        console.log('Firebase data loaded:', state);
    } catch (err) {
        setV('fb-status', 'Error: ' + err.message);
        showToast('Ошибка загрузки данных. Проверьте консоль.', 'err');
        console.error(err);
    }
}

// ════════════════════════════════════════════════════════════
// 2. РЕНДЕРИНГ ТАБЛИЦ
// ════════════════════════════════════════════════════════════
function renderAll() {
    renderCategories();
    renderProducts();
    renderBlog();
}
// ... (Функции renderCategories, renderProducts, renderBlog без изменений)
function renderCategories() { setText('bdgc', state.categories.length); setText('catcntlbl', state.categories.length+' categories'); const tb=document.getElementById('cattbody'); const grid=document.getElementById('catgrid'); if (tb) tb.innerHTML = state.categories.map(c => { const name=getLocalVal(c,'name','en') || c.id; const slug=c.slug || c.globalFields?.slug || c.id; const color=c.color || c.globalFields?.color || '#4f7dff'; const status=c.status || c.globalFields?.status || 'Active'; const cnt=state.products.filter(p=>(p.globalFields?.categoryId===c.id)).length; return `<tr> <td><div style="display:flex;align-items:center;gap:10px"> <div style="width:10px;height:10px;border-radius:50%;background:${color};flex-shrink:0"></div> <strong>${escH(name)}</strong></div></td> <td style="font-family:'IBM Plex Mono',monospace;font-size:12px;color:var(--text2)">${escH(slug)}</td> <td>${cnt}</td> <td><div class="lf">${LANGS.map(l=>`<span class="lfl d">${l.toUpperCase()}</span>`).join('')}</div></td> <td><span class="sb2 ${status==='Active'?'sp':'sa'}">${escH(status)}</span></td> <td style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--text2)">/en/products/${escH(slug)}/</td> <td><div class="ra"> <button class="ib" onclick="window._editCat('${c.id}')"><span class="material-symbols-outlined ic">edit</span></button> <button class="ib dr" onclick="window._askDelete('categories','${c.id}')"><span class="material-symbols-outlined ic">delete</span></button> </div></td> </tr>`; }).join(''); if (grid) grid.innerHTML = state.categories.map(c => { const name=getLocalVal(c,'name','en') || c.id; const slug=c.slug || c.globalFields?.slug || c.id; const color=c.color || c.globalFields?.color || '#4f7dff'; const status=c.status || c.globalFields?.status || 'Active'; const cnt=state.products.filter(p=>(p.globalFields?.categoryId===c.id)).length; return `<div class="cc"> <div class="cdot" style="background:${color}"></div> <div class="ci2"><div class="cn">${escH(name)}</div><div class="csl">/${escH(slug)}/</div> <div class="cct">${cnt} product${cnt!==1?'s':''} · ${status}</div></div> <div class="ca"><button class="ib" onclick="window._editCat('${c.id}')"><span class="material-symbols-outlined ic">edit</span></button></div> </div>`; }).join(''); ['prodcatsel','pf-cat'].forEach(id=>{ const sel=document.getElementById(id); if(!sel) return; const prev=sel.value; const pre = id==='pf-cat'?'<option value="">All categories</option>':''; sel.innerHTML = pre + state.categories.map(c=> `<option value="${c.id}"${c.id===prev?' selected':''}>${escH(getLocalVal(c,'name','en')||c.id)}</option>` ).join(''); }); }
function renderProducts() { setText('bdgp', state.products.length); const tb = document.getElementById('products-tbody'); if(!tb) return; const q=getV('search-products').toLowerCase(); const fc=getV('pf-cat'); const fs=getV('pf-prod-status'); const list = state.products.filter(p => { const name = (getLocalVal(p,'productName','en')||getLocalVal(p,'name','en')||'').toLowerCase(); const cat=p.globalFields?.categoryId || ''; const st=p.globalFields?.status || ''; return (!q || name.includes(q)) && (!fc || cat===fc) && (!fs || st===fs); }); tb.innerHTML = list.map(p => { const name=getLocalVal(p,'productName','en')||getLocalVal(p,'name','en')||'Unnamed'; const catObj = state.categories.find(c=>c.id===p.globalFields?.categoryId); const catName=catObj?(getLocalVal(catObj,'name','en')||catObj.id):'Unknown'; const catSlug=catObj?.slug || catObj?.globalFields?.slug || 'category'; const price=p.globalFields?.price||'—'; const status=p.globalFields?.status||'Draft'; const slug=p.globalFields?.slug||p.id; const img=p.globalFields?.images?.[0]||''; return `<tr> <td><div class="pnc"> <img src="${escH(img)}" class="pth" style="object-fit:contain" onerror="this.onerror=null;this.style.cssText='background:#2d3148;width:44px;height:44px;border-radius:6px';this.removeAttribute('src')"> <div class="pni"><div class="pnm">${escH(name)}</div><div class="pcm">${p.id}</div></div> </div></td> <td>${escH(catName)}</td> <td><strong>${escH(String(price))}</strong></td> <td><div class="lf">${LANGS.map(l=>`<span class="lfl d">${l.toUpperCase()}</span>`).join('')}</div></td> <td><span class="sb2 ${status.toLowerCase()==='published'?'sp':'sa'}">${escH(status)}</span></td> <td style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--text2)">/en/products/${escH(catSlug)}/${escH(slug)}/</td> <td><div class="ra"> <button class="ib" onclick="window._editProd('${p.id}')"><span class="material-symbols-outlined ic">edit</span></button> <button class="ib dr" onclick="window._askDelete('products','${p.id}')"><span class="material-symbols-outlined ic">delete</span></button> </div></td> </tr>`; }).join(''); }
function renderBlog() { setText('bdgb', state.posts.length); const tb = document.getElementById('blog-tbody'); if(!tb) return; const q=getV('search-blog').toLowerCase(); const fs=getV('pf-blog-status'); const list = state.posts.filter(p => { const title = (getLocalVal(p,'name','en')||getLocalVal(p,'title','en')||'').toLowerCase(); const st=p.globalFields?.status||''; return (!q||title.includes(q)) && (!fs||st===fs); }); tb.innerHTML = list.map(p => { const title=getLocalVal(p,'name','en')||getLocalVal(p,'title','en')||'Untitled'; const cat=p.globalFields?.category||'Article'; const author=p.globalFields?.authorName||'Admin'; const status=p.globalFields?.status||'Draft'; const slug=p.globalFields?.slug||p.id; const img=p.globalFields?.images?.[0]||''; return `<tr> <td><div class="pnc"> <img src="${escH(img)}" class="pth" style="object-fit:cover" onerror="this.onerror=null;this.style.cssText='background:#2d3148;width:44px;height:44px;border-radius:6px';this.removeAttribute('src')"> <div class="pni"><div class="pnm">${escH(title)}</div><div class="pcm">${p.id}</div></div> </div></td> <td>${escH(cat)}</td> <td>${escH(author)}</td> <td><div class="lf">${LANGS.map(l=>`<span class="lfl d">${l.toUpperCase()}</span>`).join('')}</div></td> <td><span class="sb2 ${status.toLowerCase()==='published'?'sp':'sa'}">${escH(status)}</span></td> <td style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--text2)">/en/blog/${escH(slug)}/</td> <td><div class="ra"> <button class="ib" onclick="window._editPost('${p.id}')"><span class="material-symbols-outlined ic">edit</span></button> <button class="ib dr" onclick="window._askDelete('posts','${p.id}')"><span class="material-symbols-outlined ic">delete</span></button> </div></td> </tr>`; }).join(''); }

// ════════════════════════════════════════════════════════════
// 3. ОТКРЫТИЕ МОДАЛОК — ЗАПОЛНЕНИЕ ПОЛЕЙ
// ════════════════════════════════════════════════════════════
// ... (Функции _editCat, _editProd, _editPost без изменений)
window.openNewCat = function() { currentEditingId=null; currentCollection='categories'; document.getElementById('cattitle').textContent='New Category'; document.querySelectorAll('#mcat input.fin, #mcat textarea.fta').forEach(el=>el.value=''); setV('catstat','Active'); selColor='#4f7dff'; document.querySelectorAll('.sw').forEach(s=>s.classList.toggle('on',s.dataset.c==='#4f7dff')); document.getElementById('cat-delete-btn').style.display='none'; updCatUrl(); showM('mcat'); }
window._editCat = function(id) { currentEditingId=id; currentCollection='categories'; const cat = state.categories.find(c=>c.id===id); if(!cat) return; document.getElementById('cattitle').textContent='Edit Category'; setV('catstat', cat.status || cat.globalFields?.status || 'Active'); setV('catslug', cat.slug   || cat.globalFields?.slug   || cat.id); selColor = cat.color || cat.globalFields?.color || '#4f7dff'; document.querySelectorAll('.sw').forEach(s=>s.classList.toggle('on',s.dataset.c===selColor)); document.getElementById('cat-delete-btn').style.display=''; LANGS.forEach(lang=>{ const pane=document.getElementById(`cat-lang-${lang}`); if(!pane) return; const inputs=pane.querySelectorAll('input.fin'); if(inputs[0]) inputs[0].value=getLocalVal(cat,'name',lang); if(inputs[1]) inputs[1].value=getLocalVal(cat,'description',lang); if(inputs[2]) inputs[2].value=getLocalVal(cat,'seoTitle',lang); if(inputs[3]) inputs[3].value=getLocalVal(cat,'metaDescription',lang); }); updCatUrl(); showM('mcat'); };
window._editProd = function(id) { currentEditingId=id; currentCollection='products'; const p = state.products.find(x=>x.id===id); if(!p) return; const gf = p.globalFields||{}; document.getElementById('prodtitle').textContent='Edit Product'; setV('prodstat',   gf.status||'Draft'); setV('prodcatsel', gf.categoryId||''); setV('prodprice',  gf.price||''); setV('prodsku',    gf.sku||''); setV('prodstock',  gf.stock||''); setV('prodvol',    gf.volume||''); setV('prodprio',   gf.priority||'0.9'); setV('prodslug',   gf.slug||p.id); setV('prodregion', gf.region||''); setV('prodogimg',  gf.ogImageUrl||''); const imgTa=document.getElementById('prod-images-ta'); if(imgTa) imgTa.value=(gf.images||[]).join(',\n'); document.getElementById('prod-delete-btn').style.display=''; const prodFields=['categoryLabel','productName','shortDescription','fullDescriptionHtml', 'ctaButtonText','secondaryButtonText','buttonUrl','cardTitle','cardDescription', 'seoTitle','metaDescription','ogTitle','ogDescription']; LANGS.forEach(lang=>{ prodFields.forEach(key=>{ const el=document.getElementById(`${lang}-${key}`); if(el) el.value=getLocalVal(p,key,lang); }); }); updProdUrl(); showM('mprod'); };
window._editPost = function(id) { currentEditingId = id; currentCollection = 'posts'; const p = state.posts.find(x => x.id === id); if (!p) return; const gf = p.globalFields || {}; document.getElementById('blogtitle').textContent = 'Edit Post'; setV('blogstat',   gf.status || 'Draft'); setV('blogcat',    gf.category || ''); setV('blogauthor', gf.authorName || ''); setV('blogbadge',  gf.tagBadge || ''); setV('blogread',   gf.readTime || ''); setV('blogslug',   gf.slug || p.id); setV('blogprio',   gf.priority || '0.8'); setV('blogregion', gf.regionHreflang || ''); setV('blogogimg',  gf.ogImageUrl || ''); document.getElementById('blog-delete-btn').style.display = ''; LANGS.forEach(lang => { const pane = document.getElementById(`blog-lp-${lang}`); if (!pane) return; const inputs = pane.querySelectorAll('input.fin'); const tas = pane.querySelectorAll('textarea.fta'); const contentInputMap = { h1: inputs[0], mediaUrls: inputs[1], mainImageAltText: inputs[2], cardTitle: inputs[3], cardDescription: inputs[4], seoTitle: inputs[5], metaDescription: inputs[6], ogTitle: inputs[7], ogDescription: inputs[8] }; if(contentInputMap.h1) contentInputMap.h1.value = getLocalVal(p, 'h1', lang); let mediaUrls = getLocalVal(p, 'mediaUrls', lang); if (Array.isArray(mediaUrls)) mediaUrls = mediaUrls.join(', '); if (contentInputMap.mediaUrls) contentInputMap.mediaUrls.value = mediaUrls || ''; if(contentInputMap.mainImageAltText) contentInputMap.mainImageAltText.value = getLocalVal(p, 'mainImageAltText', lang); if(tas[0]) tas[0].value = getLocalVal(p, 'mainPageContentHtml', lang); if(contentInputMap.cardTitle) contentInputMap.cardTitle.value = getLocalVal(p, 'cardTitle', lang); if(contentInputMap.cardDescription) contentInputMap.cardDescription.value = getLocalVal(p, 'cardDescription', lang); if(contentInputMap.seoTitle) contentInputMap.seoTitle.value = getLocalVal(p, 'seoTitle', lang); if(contentInputMap.metaDescription) contentInputMap.metaDescription.value = getLocalVal(p, 'metaDescription', lang); if(contentInputMap.ogTitle) contentInputMap.ogTitle.value = getLocalVal(p, 'ogTitle', lang); if(contentInputMap.ogDescription) contentInputMap.ogDescription.value = getLocalVal(p, 'ogDescription', lang); }); updBlogUrl(); showM('mblog'); };

// ════════════════════════════════════════════════════════════
// 4. СОХРАНЕНИЕ В FIRESTORE
// ════════════════════════════════════════════════════════════
async function persistToFirestore(colName, data) { const firestoreCol = colName === 'posts' ? 'blog' : colName; try { if (currentEditingId) { await updateDoc(doc(db, firestoreCol, currentEditingId), data); const stateKey = colName === 'blog' ? 'posts' : colName; const arr = state[stateKey]; const i = arr.findIndex(x => x.id === currentEditingId); if (i !== -1) arr[i] = { id: currentEditingId, ...data }; showToast('✅ Сохранено в Firebase!'); } else { const ref = await addDoc(collection(db, firestoreCol), data); const stateKey = colName === 'blog' ? 'posts' : colName; state[stateKey].push({ id: ref.id, ...data }); showToast('✅ Создано в Firebase!'); } renderAll(); closeM({ categories: 'mcat', products: 'mprod', posts: 'mblog' }[colName]); currentEditingId = null; } catch (err) { console.error(err); showToast('Ошибка сохранения: ' + err.message, 'err'); } }
window.saveCategory = async function() { const slug=getV('catslug').trim(); if(!slug){showToast('Укажите slug','err');return;} const translations={}; LANGS.forEach(lang=>{ const pane=document.getElementById(`cat-lang-${lang}`); if(!pane) return; const inputs=pane.querySelectorAll('input.fin'); translations[lang]={ name: inputs[0]?.value.trim()||'', description: inputs[1]?.value.trim()||'', seoTitle: inputs[2]?.value.trim()||'', metaDescription: inputs[3]?.value.trim()||'', }; }); const data={ slug, status: getV('catstat'), color: selColor, translations, productCount: state.products.filter(p=>p.globalFields?.categoryId===currentEditingId).length, }; await persistToFirestore('categories', data); };
window.saveProduct = async function() { const slug=getV('prodslug').trim(); if(!slug){showToast('Укажите slug продукта','err');return;} const prodFields=['categoryLabel','productName','shortDescription','fullDescriptionHtml', 'ctaButtonText','secondaryButtonText','buttonUrl','cardTitle','cardDescription', 'seoTitle','metaDescription','ogTitle','ogDescription']; const translations={}; LANGS.forEach(lang=>{ const obj={}; prodFields.forEach(key=>{ const el=document.getElementById(`${lang}-${key}`); obj[key]=el?el.value.trim():''; }); translations[lang]=obj; }); const imgTa=document.getElementById('prod-images-ta'); const images=imgTa?imgTa.value.split(',').map(s=>s.trim()).filter(Boolean):[]; const data={ globalFields:{ slug, status:getV('prodstat'), categoryId:getV('prodcatsel'), price:getV('prodprice'), sku:getV('prodsku'), stock:getV('prodstock'), volume:getV('prodvol'), priority:getV('prodprio'), region:getV('prodregion'), ogImageUrl:getV('prodogimg'), images, }, translations, productName: translations.en?.productName||'', name:        translations.en?.productName||'', }; await persistToFirestore('products', data); };
window.saveBlogPost = async function() { const slug = getV('blogslug').trim(); if (!slug) { showToast('Укажите slug поста', 'err'); return; } const translations = {}; LANGS.forEach(lang => { const pane = document.getElementById(`blog-lp-${lang}`); if (!pane) return; const inputs = pane.querySelectorAll('input.fin'); const tas = pane.querySelectorAll('textarea.fta'); const mediaUrlsArray = (inputs[1]?.value.trim() || '').split(',').map(url => url.trim()).filter(Boolean); translations[lang] = { h1: inputs[0]?.value.trim() || '', mediaUrls: mediaUrlsArray, mainImageAltText: inputs[2]?.value.trim() || '', mainPageContentHtml: tas[0]?.value.trim() || '', cardTitle: inputs[3]?.value.trim() || '', cardDescription: inputs[4]?.value.trim() || '', seoTitle: inputs[5]?.value.trim() || '', metaDescription: inputs[6]?.value.trim() || '', ogTitle: inputs[7]?.value.trim() || '', ogDescription: inputs[8]?.value.trim() || '', }; }); const data = { globalFields: { slug, status: getV('blogstat'), category: getV('blogcat'), authorName: getV('blogauthor'), tagBadge: getV('blogbadge'), readTime: getV('blogread'), priority: getV('blogprio'), regionHreflang: getV('blogregion'), ogImageUrl: getV('blogogimg'), }, translations, name: translations.en?.h1 || '', title: translations.en?.h1 || '', }; await persistToFirestore('posts', data); };

// ════════════════════════════════════════════════════════════
// 5. УДАЛЕНИЕ
// ════════════════════════════════════════════════════════════
window._askDelete = function(colName, id) { pendingDeleteId = id; pendingDeleteCol = colName; showM('mconf'); };
async function confirmDelete() { if (!pendingDeleteId || !pendingDeleteCol) return; const firestoreCol = pendingDeleteCol === 'posts' ? 'blog' : pendingDeleteCol; try { await deleteDoc(doc(db, firestoreCol, pendingDeleteId)); const stateKey = pendingDeleteCol === 'blog' ? 'posts' : pendingDeleteCol; state[stateKey] = state[stateKey].filter(x => x.id !== pendingDeleteId); renderAll(); closeM('mconf'); showToast('🗑 Удалено'); } catch (err) { showToast('Ошибка удаления: ' + err.message, 'err'); } pendingDeleteId = null; pendingDeleteCol = null; };

// ════════════════════════════════════════════════════════════
// 6. UI & NAVIGATION
// ════════════════════════════════════════════════════════════
const META = { products:{t:'Products',c:'/ Catalog'}, categories:{t:'Categories',c:'/ Catalog'}, blog:{t:'Blog Posts',c:'/ Content'}, 'page-home':{t:'Home Page',c:'/ Pages'}, 'page-catalog':{t:'Catalog Page',c:'/ Pages'}, 'page-contacts':{t:'Contacts',c:'/ Pages'}, 'page-footer':{t:'Navigation & Footer',c:'/ Pages'}, settings:{t:'Settings',c:''}, };
window.goP = function(id) { document.querySelectorAll('.pn').forEach(p => p.classList.remove('on')); document.getElementById('pn-' + id)?.classList.add('on'); document.querySelectorAll('.ni[data-p], .mni[data-p]').forEach(n => n.classList.remove('on')); document.querySelector(`.ni[data-p="${id}"]`)?.classList.add('on'); document.querySelector(`.mni[data-p="${id}"]`)?.classList.add('on'); const m = META[id] || { t: id, c: '' }; setText('tptitle', m.t); setText('tpcrumb', m.c); document.querySelector('.ct')?.scrollTo(0, 0); closeMob(); }
window.showM = function(id) { document.getElementById(id)?.classList.add('on'); document.body.style.overflow = 'hidden'; }
window.closeM = function(id) { document.getElementById(id)?.classList.remove('on'); document.body.style.overflow = ''; }
window.toggleSidebar = () => document.getElementById('sidebar')?.classList.toggle('col');
window.openMob = () => { document.getElementById('sidebar')?.classList.add('mo'); document.getElementById('sov')?.classList.add('on'); document.body.style.overflow = 'hidden'; };
window.closeMob = () => { document.getElementById('sidebar')?.classList.remove('mo'); document.getElementById('sov')?.classList.remove('on'); document.body.style.overflow = ''; };
window.checkMob = function() { const m = window.innerWidth <= 768; const dt = document.getElementById('dtt'), mb = document.getElementById('mbt'); if (dt) dt.style.display = m ? 'none' : ''; if (mb) mb.style.display = m ? 'flex' : 'none'; const sg = document.getElementById('stgg'); if (sg) sg.style.gridTemplateColumns = m ? '1fr' : '1fr 1fr'; }
window.swBlogLang = (lang, btn) => { document.querySelectorAll('#mblog .lpane, #mblog .ltab, #blog-lang-overview .lang-pill').forEach(p => p.classList.remove('on')); document.getElementById(`blog-lp-${lang}`)?.classList.add('on'); if (btn) { btn.classList.add('on'); document.querySelector(`#blog-lang-overview .lang-pill[data-lang="${lang}"]`)?.classList.add('on'); } };
window.swProdLang = (lang, btn) => { document.querySelectorAll('#mprod .lpane, #mprod .ltab, #mprod .lang-overview .lang-pill').forEach(p => p.classList.remove('on')); document.getElementById(`prod-lp-${lang}`)?.classList.add('on'); if (btn) { btn.classList.add('on'); document.querySelector(`#mprod .lang-overview .lang-pill[data-lang="${lang}"]`)?.classList.add('on'); } };
window.swCatLang = (lang, btn) => { document.querySelectorAll('#mcat .lpane, #mcat .ltab').forEach(p => p.classList.remove('on')); document.getElementById(`cat-lang-${lang}`)?.classList.add('on'); if (btn) btn.classList.add('on'); };
window.updProdUrl = function() { const cat=getV('prodcatsel')||'category'; const catObj = state.categories.find(c => c.id === cat); const catSlug = catObj?.slug || catObj?.globalFields?.slug || 'category'; const sl=getV('prodslug')||'slug'; const pr=document.getElementById('produp'); if(pr) pr.innerHTML=LANGS.map(l=>`<span>/${l}/products/${catSlug}/${sl}</span>`).join(' '); };
window.updBlogUrl = function() { const sl = getV('blogslug') || 'slug'; const pr = document.getElementById('blogurlprev'); if (pr) pr.innerHTML = LANGS.map(l => `<span>/${l}/blog/${sl}</span>`).join(' '); };
window.updCatUrl = function() { const sl = getV('catslug') || '[slug]'; const pr = document.getElementById('caturlprev'); if (pr) pr.innerHTML = LANGS.map(l => `<span>/${l}/products/${sl}/</span>`).join(' '); };
window.confirmLang = function(type, lang) { const paneId = (type === 'blog' ? 'blog-lp-' : 'prod-lp-') + lang; const bar = document.querySelector('#' + paneId + ' .conf-bar'); if (!bar) return; const icon = bar.querySelector('.material-symbols-outlined'); const status = bar.querySelector('.conf-status'); const sub = bar.querySelector('.conf-sub'); const badge = bar.querySelector('.conf-badge'); if (icon) { icon.textContent = 'check_circle'; icon.style.color = 'var(--green)'; } if (status) status.textContent = lang.toUpperCase() + ' version — Published'; if (sub) sub.textContent = 'Confirmed — ' + new Date().toLocaleString(); if (badge) { badge.className = 'conf-badge conf-y'; badge.textContent = '✓ Confirmed'; } const tabDot = document.querySelector(`#${type==='blog'?'mblog':'mprod'} .ltab[data-lang="${lang}"] .conf-dot`); if (tabDot) { tabDot.className = 'conf-dot yes'; } const sEl = document.getElementById(`${type==='blog'?'blog':'prod'}-lstatus-${lang}`); if (sEl) { sEl.textContent = 'Published'; sEl.className = 'lstatus lstatus-pub'; } };
window.filterProducts = renderProducts;
window.filterBlog = renderBlog;
window.addPill = function(lang) { const inp = document.getElementById('pillin-' + lang); if (!inp?.value.trim()) return; const box = document.getElementById('pills-' + lang); if (!box) return; const s = document.createElement('span'); s.className = 'pi'; s.innerHTML = escH(inp.value.trim()) + '<button onclick="this.closest(\'.pi\').remove()"><span class="material-symbols-outlined ic">close</span></button>'; box.appendChild(s); inp.value = ''; };
window.addIngr = function() { const list = document.getElementById('ingren'); if (!list) return; const r = document.createElement('div'); r.className = 'ir'; r.innerHTML = '<input class="fin" placeholder="Ingredient name"><input class="fin pct" placeholder="0%"><button class="ib dr" onclick="this.parentNode.remove()"><span class="material-symbols-outlined ic">delete</span></button>'; list.appendChild(r); };
window.togSec = h => { h.classList.toggle('on'); h.nextElementSibling?.classList.toggle('on'); };


// ════════════════════════════════════════════════════════════
// 7. PAGES & SETTINGS
// ════════════════════════════════════════════════════════════
async function loadPagesAndSettings() { try { const pageIds = ['home','catalog','contacts','footer-nav']; await Promise.all(pageIds.map(async id => { const snap = await getDoc(doc(db,'pages',id)); pagesCache[id] = snap.exists() ? snap.data() : {}; })); const settSnap = await getDoc(doc(db,'settings','main')); pagesCache['settings'] = settSnap.exists() ? settSnap.data() : {}; fillHomePage('en'); fillPageFields('catalog','en'); fillPageFields('contacts','en'); fillPageFields('footer-nav','en'); fillSettings(); } catch(err) { console.error('Pages load error:', err); showToast('Ошибка загрузки Pages: '+err.message,'err'); } }
window.switchPageLang = function(pageId, lang) { pageLangs[pageId] = lang; const lm = {en:'English (EN)',ru:'Russian (RU)',ka:'Georgian (KA)',hy:'Armenian (HY)'}; const pm = {en:'/en/',ru:'/ru/',ka:'/ka/',hy:'/hy/'}; if (pageId === 'home') { const hll = document.getElementById('hll'); const hlp = document.getElementById('hlp'); if (hll) hll.textContent = lm[lang]||lang; if (hlp) hlp.textContent = pm[lang]||'/'+lang+'/'; fillHomePage(lang); } else { fillPageFields(pageId, lang); } };
function fillHomePage(lang) { const d = pagesCache['home'] || {}; const gf = d.globalFields || {}; const lo = d.translations?.[lang] || d.translations?.en || d[lang] || d.en || {}; setV('home-productsLabel', lo.productsLabel || lo.productsSectionLabel || gf.productsLabel || ''); setV('home-productsTitle', lo.productsTitle || lo.productsSectionTitle || gf.productsTitle || ''); setV('home-blogLabel', lo.blogLabel || lo.blogSectionLabel || gf.blogLabel || ''); setV('home-blogTitle', lo.blogTitle || lo.blogSectionTitle || gf.blogTitle || ''); setV('home-reviewsLabel', lo.reviewsLabel || lo.reviewsSectionLabel || gf.reviewsLabel || ''); setV('home-reviewsTitle', lo.reviewsTitle || lo.reviewsSectionTitle || gf.reviewsTitle || ''); setV('home-seoTitle', lo.seoTitle || gf.seoTitle || ''); setV('home-metaDescription', lo.metaDescription || gf.metaDescription || ''); setV('home-ogTitle', lo.ogTitle || gf.ogTitle || ''); setV('home-ogDescription', lo.ogDescription || gf.ogDescription || ''); setV('home-ogImageUrl', gf.ogImageUrl || lo.ogImageUrl || ''); const rawSlides = lo.heroSlides || lo.slides || gf.heroSlides || gf.slides || []; const slides = rawSlides.map(s => ({ subtitle: s.subtitle || '', headline: s.headline || '', bgImage: s.backgroundImageUrl || s.bgImage || '', btnText: s.buttonText || s.btnText || '', btnUrl: s.buttonLink || s.btnUrl || s.btnLink || '', })); renderSlides(slides); const rawReviews = lo.reviews || gf.reviews || []; const reviews = rawReviews.map(r => ({ author: r.author || '', role: r.role || '', text: r.reviewText || r.text || '', })); renderReviews(reviews); }
function renderSlides(slides) { const body = document.getElementById('home-slides-body'); if (!body) return; body.innerHTML = slides.map((s, i) => ` <div class="slide-row" data-idx="${i}" style="margin-bottom:18px;padding:16px;background:var(--bg3);border-radius:8px;border:1px solid var(--border2)"> <div style="font-size:12px;font-weight:700;color:var(--text2);margin-bottom:10px;display:flex;justify-content:space-between;align-items:center"> SLIDE ${i+1} <button class="ib dr" onclick="removeSlide(${i})"><span class="material-symbols-outlined ic">delete</span></button> </div> <div class="fg"> <div class="fi"><label class="fl">Subtitle</label><input class="fin slide-subtitle" value="${escH(s.subtitle||'')}"></div> <div class="fi"><label class="fl">Button Text</label><input class="fin slide-btnText" value="${escH(s.btnText||'')}"></div> <div class="fi full"><label class="fl">Headline</label><input class="fin slide-headline" value="${escH(s.headline||'')}"></div> <div class="fi full"><label class="fl">Background Image URL</label><input class="fin slide-bgImage" value="${escH(s.bgImage||'')}"></div> <div class="fi"><label class="fl">Button URL</label><input class="fin slide-btnUrl" value="${escH(s.btnUrl||'')}"></div> </div> </div>`).join(''); }
window.addSlide = function() { const existing = collectSlides(); existing.push({subtitle:'',headline:'',btnText:'',btnUrl:'',bgImage:''}); renderSlides(existing); };
window.removeSlide = function(idx) { const slides = collectSlides(); slides.splice(idx, 1); renderSlides(slides); };
function collectSlides() { const rows = document.querySelectorAll('#home-slides-body .slide-row'); return Array.from(rows).map(r => ({ subtitle: r.querySelector('.slide-subtitle')?.value.trim() || '', headline: r.querySelector('.slide-headline')?.value.trim() || '', buttonText: r.querySelector('.slide-btnText')?.value.trim() || '', buttonLink: r.querySelector('.slide-btnUrl')?.value.trim() || '', backgroundImageUrl: r.querySelector('.slide-bgImage')?.value.trim() || '', })); }
function renderReviews(reviews) { const body = document.getElementById('home-reviews-body'); if (!body) return; body.innerHTML = reviews.map((r, i) => ` <div class="review-row" style="margin-bottom:14px;padding:14px;background:var(--bg3);border-radius:8px;border:1px solid var(--border2)"> <div style="font-size:12px;font-weight:700;color:var(--text2);margin-bottom:8px;display:flex;justify-content:space-between;align-items:center"> REVIEW ${i+1} <button class="ib dr" onclick="removeReview(${i})"><span class="material-symbols-outlined ic">delete</span></button> </div> <div class="fg"> <div class="fi"><label class="fl">Author</label><input class="fin review-author" value="${escH(r.author||'')}"></div> <div class="fi"><label class="fl">Role</label><input class="fin review-role" value="${escH(r.role||'')}"></div> <div class="fi full"><label class="fl">Review Text</label><textarea class="fta review-text" style="min-height:60px">${escH(r.text||'')}</textarea></div> </div> </div>`).join(''); }
window.addReview = function() { const existing = collectReviews(); existing.push({author:'',role:'',text:''}); renderReviews(existing); };
window.removeReview = function(idx) { const reviews = collectReviews(); reviews.splice(idx, 1); renderReviews(reviews); };
function collectReviews() { const rows = document.querySelectorAll('#home-reviews-body .review-row'); return Array.from(rows).map(r => ({ author: r.querySelector('.review-author')?.value.trim() || '', role: r.querySelector('.review-role')?.value.trim() || '', text: r.querySelector('.review-text')?.value.trim() || '', })); }
function fillPageFields(pageId, lang) { const d=pagesCache[pageId] || {}; const gf=d.globalFields || {}; const lo=d.translations?.[lang] || d.translations?.en || d[lang] || d.en || {}; if (pageId==='catalog') { setV('catalog-title',lo.heroTitle || lo.title || gf.heroTitle || ''); setV('catalog-subtitle',lo.heroSubtitle || lo.subtitle || gf.heroSubtitle || ''); setV('catalog-description',lo.heroDescription || lo.description || gf.heroDescription || ''); setV('catalog-seoTitle',lo.seoTitle || gf.seoTitle || ''); setV('catalog-metaDescription',lo.metaDescription || gf.metaDescription || ''); } if (pageId==='contacts') { setV('contacts-label',lo.label || gf.label || ''); setV('contacts-title',lo.title || gf.title || ''); setV('contacts-ctaButton',lo.ctaButton || gf.ctaButton || ''); setV('contacts-logisticsTerms',lo.logisticsTerms || gf.logisticsTerms || ''); setV('contacts-seoTitle',lo.seoTitle || gf.seoTitle || ''); setV('contacts-metaDescription',lo.metaDescription|| gf.metaDescription|| ''); setV('contacts-phone',gf.phone || d.phone || ''); setV('contacts-email',gf.email || d.email || ''); setV('contacts-ctaEmail',gf.ctaEmail || d.ctaEmail || gf.email || d.email || ''); setV('contacts-mapsEmbed',gf.mapsEmbed || d.mapsEmbed || ''); } if (pageId==='footer-nav') { setV('footer-nav-home',lo.navHomeText || lo.home || gf.navHomeText || ''); setV('footer-nav-about',lo.navAboutText || lo.about || gf.navAboutText || ''); setV('footer-nav-contacts',lo.navContactsText || lo.contacts || gf.navContactsText || ''); const navLinks = lo.navLinks || gf.navLinks || []; const catalogLink = navLinks.find(l => l.text?.toLowerCase().includes('catalog') || l.link?.includes('catalog')); const blogLink = navLinks.find(l => l.text?.toLowerCase().includes('blog') || l.text?.toLowerCase().includes('tech') || l.link?.includes('blog')); const wholesaleLink = navLinks.find(l => l.text?.toLowerCase().includes('wholesale') || l.link?.includes('contact')); setV('footer-nav-catalog',lo.catalog || catalogLink?.text || gf.catalog || ''); setV('footer-nav-blog',lo.blog || blogLink?.text || gf.blog || ''); setV('footer-nav-link1',lo.link1 || catalogLink?.text || gf.link1 || ''); setV('footer-nav-link2',lo.link2 || blogLink?.text || gf.link2 || ''); setV('footer-nav-link3',lo.link3 || wholesaleLink?.text || gf.link3 || ''); setV('footer-nav-copyright',lo.copyright || gf.copyright || ''); } }
function fillSettings() { const s = pagesCache['settings'] || {}; setV('settings-siteName', s.siteName || s.admin?.siteName || ''); setV('settings-defaultLang', s.defaultLang || s.admin?.defaultLang || 'en'); setV('settings-metaDescription', s.metaDescription || ''); setV('settings-adminName', s.admin || ''); setV('settings-prefix-en', s.languagePrefixes?.en || 'en'); setV('settings-prefix-ru', s.languagePrefixes?.ru || 'ru'); setV('settings-prefix-ka', s.languagePrefixes?.ka || 'ka'); setV('settings-prefix-hy', s.languagePrefixes?.hy || 'hy'); }
window.savePageDoc = async function(pageId) { const lang = pageLangs[pageId] || 'en'; const existing = pagesCache[pageId] || {}; const existingGF = existing.globalFields || {}; const existingTr = existing.translations || {}; let localizedFields = {}; let globalFields = {...existingGF}; if (pageId === 'home') { localizedFields = { productsLabel: getV('home-productsLabel'), productsTitle: getV('home-productsTitle'), blogLabel: getV('home-blogLabel'), blogTitle: getV('home-blogTitle'), reviewsLabel: getV('home-reviewsLabel'), reviewsTitle: getV('home-reviewsTitle'), seoTitle: getV('home-seoTitle'), metaDescription: getV('home-metaDescription'), ogTitle: getV('home-ogTitle'), ogDescription: getV('home-ogDescription'), heroSlides: collectSlides(), reviews: collectReviews().map(r => ({...r, reviewText: r.text})), }; globalFields.ogImageUrl = getV('home-ogImageUrl'); } else if (pageId === 'catalog') { localizedFields = { heroTitle: getV('catalog-title'), heroSubtitle: getV('catalog-subtitle'), heroDescription: getV('catalog-description'), seoTitle: getV('catalog-seoTitle'), metaDescription: getV('catalog-metaDescription'), }; } else if (pageId === 'contacts') { localizedFields = { label: getV('contacts-label'), title: getV('contacts-title'), ctaButton: getV('contacts-ctaButton'), logisticsTerms: getV('contacts-logisticsTerms'), seoTitle: getV('contacts-seoTitle'), metaDescription: getV('contacts-metaDescription'), }; globalFields.phone = getV('contacts-phone'); globalFields.email = getV('contacts-email'); globalFields.ctaEmail = getV('contacts-ctaEmail'); globalFields.mapsEmbed = getV('contacts-mapsEmbed'); } else if (pageId === 'footer-nav') { localizedFields = { navHomeText: getV('footer-nav-home'), navAboutText: getV('footer-nav-about'), navContactsText: getV('footer-nav-contacts'), home: getV('footer-nav-home'), about: getV('footer-nav-about'), contacts: getV('footer-nav-contacts'), navLinks: [ { text: getV('footer-nav-link1') || getV('footer-nav-catalog'), link: '/en/catalog/' }, { text: getV('footer-nav-link2') || getV('footer-nav-blog'),    link: '/en/blog/' }, { text: getV('footer-nav-link3'), link: '#contacts' }, ].filter(l => l.text), catalog: getV('footer-nav-catalog'), blog: getV('footer-nav-blog'), link1: getV('footer-nav-link1'), link2: getV('footer-nav-link2'), link3: getV('footer-nav-link3'), copyright: getV('footer-nav-copyright'), }; } const newData = { ...existing, globalFields, translations: { ...existingTr, [lang]: { ...(existingTr[lang] || {}), ...localizedFields, }, }, }; try { await setDoc(doc(db,'pages',pageId), newData, { merge: true }); pagesCache[pageId] = newData; showToast(`✅ ${pageId} сохранено!`); } catch(err) { showToast('Ошибка: '+err.message,'err'); console.error(err); } };
window.saveSettings = async function() { const data = { siteName: getV('settings-siteName'), defaultLang: getV('settings-defaultLang'), metaDescription: getV('settings-metaDescription'), admin: getV('settings-adminName'), languagePrefixes: { en: getV('settings-prefix-en') || 'en', ru: getV('settings-prefix-ru') || 'ru', ka: getV('settings-prefix-ka') || 'ka', hy: getV('settings-prefix-hy') || 'hy', }, }; try { await setDoc(doc(db,'settings','main'), data, { merge: true }); pagesCache['settings'] = data; showToast('✅ Settings сохранены!'); } catch(err) { showToast('Ошибка: '+err.message,'err'); console.error(err); } };

// ════════════════════════════════════════════════════════════
// 8. ИНИЦИАЛИЗАЦИЯ
// ════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
    checkMob();
    window.addEventListener('resize', checkMob);

    document.querySelectorAll('.ni[data-p]').forEach(el => el.addEventListener('click', () => goP(el.dataset.p)));
    document.querySelectorAll('.mni[data-p]').forEach(el => el.addEventListener('click', () => goP(el.dataset.p)));
    document.querySelectorAll('.mo').forEach(o => o.addEventListener('click', e => { if (e.target === o) closeM(o.id); }));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') document.querySelectorAll('.mo.on').forEach(m => closeM(m.id)); });

    document.getElementById('mconf-confirm-btn').onclick = confirmDelete;
    document.getElementById('btn-new-prod').onclick = () => { currentEditingId=null; currentCollection='products'; document.getElementById('prodtitle').textContent='New Product'; document.querySelectorAll('#mprod input.fin, #mprod textarea.fta').forEach(el=>el.value=''); document.querySelectorAll('#mprod select.fsel').forEach(el=>el.selectedIndex=0); document.getElementById('prod-delete-btn').style.display='none'; updProdUrl(); showM('mprod'); };
    document.getElementById('btn-new-blog').onclick = () => { currentEditingId=null; currentCollection='posts'; document.getElementById('blogtitle').textContent='New Blog Post'; document.querySelectorAll('#mblog input.fin, #mblog textarea.fta').forEach(el=>el.value=''); document.querySelectorAll('#mblog select.fsel').forEach(el=>el.selectedIndex=0); document.getElementById('blog-delete-btn').style.display='none'; updBlogUrl(); showM('mblog'); };
    
    document.getElementById('cat-delete-btn').onclick = ()=>{ if(currentEditingId) { closeM('mcat'); _askDelete('categories',currentEditingId); }};
    document.getElementById('prod-delete-btn').onclick = ()=>{ if(currentEditingId) { closeM('mprod'); _askDelete('products',currentEditingId); }};
    document.getElementById('blog-delete-btn').onclick = ()=>{ if(currentEditingId) { closeM('mblog'); _askDelete('posts',currentEditingId); }};
    
    document.getElementById('swatches').addEventListener('click', e => {
        const sw = e.target.closest('.sw'); if (!sw) return;
        document.querySelectorAll('.sw').forEach(s => s.classList.remove('on'));
        sw.classList.add('on'); selColor = sw.dataset.c;
    });

    updProdUrl(); updBlogUrl(); updCatUrl();

    loadAllData();
    loadPagesAndSettings();
});
