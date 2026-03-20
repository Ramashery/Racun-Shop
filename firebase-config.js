// firebase-config.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getFirestore, collection, getDocs, doc, getDoc, query, where, orderBy, limit } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// Конфигурация из вашего скриншота
const firebaseConfig = {
  apiKey: "AIzaSyAGXs4wc4vcxxy2cMoHMC8_MlD9S_chSQY",
  authDomain: "racun-shop.firebaseapp.com",
  projectId: "racun-shop",
  storageBucket: "racun-shop.appspot.com", // обычно заканчивается на appspot.com
  messagingSenderId: "569457770232",
  appId: "1:569457770232:web:5a2737d1ee270459f3050d",
  measurementId: "G-NCTM22413W"
};

// Инициализация Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

export { db, collection, getDocs, doc, getDoc, query, where, orderBy, limit };
