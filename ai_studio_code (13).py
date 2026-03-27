import firebase_admin
from firebase_admin import credentials, firestore
import json
import os

print("Seeding Full Contacts Page Data into Firestore...")

# Инициализация Firebase
sa_env = os.environ.get("FIREBASE_SERVICE_ACCOUNT")
if not sa_env:
    print("Error: FIREBASE_SERVICE_ACCOUNT not set in environment.")
    exit(1)

cred = credentials.Certificate(json.loads(sa_env))
if not firebase_admin._apps:
    firebase_admin.initialize_app(cred)
db = firestore.client()

contacts_data = {
    # Общие поля для всех языков
    "globalFields": {
        "status": "published",
        "phone": "+374 41 234 567",
        "email": "hello@rakun.store",
        
        # Соцсети
        "whatsappLink": "https://wa.me/37441234567",
        "whatsappHandle": "+374 41 234 567",
        "telegramLink": "https://t.me/rakunstore",
        "telegramHandle": "@rakunstore",
        "instagramLink": "https://instagram.com/rakun.store",
        "instagramHandle": "@rakun.store",
        "facebookLink": "https://facebook.com/rakunstore",
        "facebookHandle": "RAKUN Store",
        
        # Магазины
        "stores": [
            {
                "country": "georgia",
                "name": "RAKUN — Rustaveli",
                "address": "14 Rustaveli Ave, Tbilisi, Georgia",
                "phone": "+995 32 212 34 56",
                "hours": "Mon–Sun 10:00–21:00",
                "mapsEmbed": "https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d2978.0!2d44.7896!3d41.6938!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x0%3A0x0!2zNDHCsDQxJzM3LjciTiA0NMKwNDcnMjIuNiJF!5e0!3m2!1sen!2sge!4v1",
                "badge": "Official partner"
            },
            {
                "country": "georgia",
                "name": "RAKUN — Vake Plaza",
                "address": "Vake Plaza Mall, 2 Chavchavadze Ave, Tbilisi",
                "phone": "+995 32 223 45 67",
                "hours": "Mon–Sun 10:00–22:00",
                "mapsEmbed": "https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d2978.5!2d44.7980!3d41.7058!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x0%3A0x0!2zNDHCsDQyJzIxLjAiTiA0NMKwNDcnNTIuOCJF!5e0!3m2!1sen!2sge!4v1",
                "badge": "Official partner"
            },
            {
                "country": "armenia",
                "name": "RAKUN — Yerevan",
                "address": "5 Abovyan St, Yerevan, Armenia",
                "phone": "+374 41 123 456",
                "hours": "Mon–Sat 10:00–20:00",
                "mapsEmbed": "https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3048.5!2d44.5136!3d40.1872!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x0%3A0x0!2zNDDCsDExJzEzLjkiTiA0NMKwMzAnNDkuMCJF!5e0!3m2!1sen!2sam!4v1",
                "badge": "Flagship store"
            },
            {
                "country": "belarus",
                "name": "RAKUN — Minsk",
                "address": "34 Nezavisimosti Ave, Minsk, Belarus",
                "phone": "+375 29 123 45 67",
                "hours": "Mon–Sun 10:00–21:00",
                "mapsEmbed": "https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d2350.5!2d27.5615!3d53.9045!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x0%3A0x0!2zNTPCsDU0JzE2LjIiTiAyN8KwMzMnNDEuNCJF!5e0!3m2!1sen!2sby!4v1",
                "badge": "Official partner"
            }
        ]
    },
    # Тексты, переводы, SEO и вопросы
    "translations": {
        "en": {
            "seoTitle": "RAKUN | Contacts and Stores",
            "metaDescription": "Find RAKUN stores in Armenia, Georgia and Belarus. Contact us via WhatsApp or Telegram for fast delivery.",
            "label": "Where to buy",
            "title": "Find us <em>near you</em>",
            "heroDescription": "RAKUN products are available in Armenia, Georgia and Belarus. Choose your country and find the nearest store.",
            "workingHours": "Mon–Sat 10:00–20:00",
            "ctaTitle": "Write to us — <em>we will help</em>",
            "ctaButton": "Write on WhatsApp",
            "faq": [
                {
                    "q": "Can I buy products without visiting a store?",
                    "a": "Yes! Write to us on WhatsApp or Telegram, tell us which product you want, and we will arrange delivery or prepare it for pickup at the nearest store."
                },
                {
                    "q": "Do you ship internationally?",
                    "a": "We deliver across Armenia, Georgia and Belarus. For other countries, contact us directly — in many cases we can arrange shipping via international courier services."
                },
                {
                    "q": "What payment methods are accepted?",
                    "a": "At partner stores — cash and bank cards. For online orders — bank transfer or card payment via a secure link."
                }
            ]
        },
        "ru": {
            "seoTitle": "RAKUN | Контакты и магазины",
            "metaDescription": "Найдите магазины RAKUN в Армении, Грузии и Беларуси. Свяжитесь с нами в WhatsApp для быстрой доставки.",
            "label": "Где купить",
            "title": "Мы <em>рядом с вами</em>",
            "heroDescription": "Продукция RAKUN доступна в Армении, Грузии и Беларуси. Выберите страну и найдите ближайший магазин.",
            "workingHours": "Пн-Сб 10:00–20:00",
            "ctaTitle": "Напишите нам — <em>мы поможем</em>",
            "ctaButton": "Написать в WhatsApp",
            "faq": [
                {
                    "q": "Можно ли купить товар без визита в магазин?",
                    "a": "Да! Напишите нам в WhatsApp или Telegram, какой товар вам нужен, и мы организуем доставку или подготовим его к выдаче."
                },
                {
                    "q": "Есть ли международная доставка?",
                    "a": "Мы доставляем по Армении, Грузии и Беларуси. Для других стран — свяжитесь с нами напрямую, мы найдем способ доставки."
                },
                {
                    "q": "Какие способы оплаты вы принимаете?",
                    "a": "В магазинах — наличные и карты. При онлайн-заказе — банковский перевод или оплата картой по защищенной ссылке."
                }
            ]
        },
        "ka": {
            "seoTitle": "RAKUN | კონტაქტები",
            "metaDescription": "იპოვეთ RAKUN მაღაზიები სომხეთში, საქართველოში და ბელორუსში. მოგვწერეთ WhatsApp-ში სწრაფი მიტანისთვის.",
            "label": "სად ვიყიდოთ",
            "title": "ჩვენ <em>თქვენს გვერდით ვართ</em>",
            "heroDescription": "RAKUN პროდუქცია ხელმისაწვდომია სომხეთში, საქართველოში და ბელორუსში. აირჩიეთ ქვეყანა და იპოვეთ უახლოესი მაღაზია.",
            "workingHours": "ორშ–შაბ 10:00–20:00",
            "ctaTitle": "მოგვწერეთ — <em>დაგეხმარებით</em>",
            "ctaButton": "მოგვწერეთ WhatsApp-ში",
            "faq": [
                {
                    "q": "შემიძლია ვიყიდო პროდუქცია მაღაზიაში მისვლის გარეშე?",
                    "a": "დიახ! მოგვწერეთ WhatsApp ან Telegram-ში და ჩვენ მოვაწყობთ მიტანას."
                },
                {
                    "q": "გაქვთ საერთაშორისო მიწოდება?",
                    "a": "ჩვენ ვაწვდით სომხეთში, საქართველოში და ბელორუსში. სხვა ქვეყნებისთვის დაგვიკავშირდით პირდაპირ."
                },
                {
                    "q": "გადახდის რა მეთოდებს იღებთ?",
                    "a": "მაღაზიებში — ნაღდი ფული და ბარათი. ონლაინ შეკვეთისას — საბანკო გადარიცხვა ან ბარათით გადახდა."
                }
            ]
        },
        "hy": {
            "seoTitle": "RAKUN | Կոնտակտներ",
            "metaDescription": "Գտեք RAKUN խանութները Հայաստանում, Վրաստանում և Բելառուսում:",
            "label": "Որտեղ գնել",
            "title": "Մենք <em>մոտ ենք ձեզ</em>",
            "heroDescription": "RAKUN արտադրանքը հասանելի է Հայաստանում, Վրաստանում և Բելառուսում:",
            "workingHours": "Երկ–Շբթ 10:00–20:00",
            "ctaTitle": "Գրեք մեզ — <em>մենք կօգնենք</em>",
            "ctaButton": "Գրել WhatsApp-ում",
            "faq": [
                {
                    "q": "Կարո՞ղ եմ գնել ապրանքն առանց խանութ այցելելու:",
                    "a": "Այո՛: Գրեք մեզ WhatsApp-ում կամ Telegram-ում, և մենք կկազմակերպենք առաքումը:"
                },
                {
                    "q": "Ունե՞ք միջազգային առաքում:",
                    "a": "Մենք առաքում ենք Հայաստան, Վրաստան և Բելառուս: Այլ երկրների համար կապվեք մեզ հետ:"
                },
                {
                    "q": "Վճարման ի՞նչ եղանակներ են ընդունվում:",
                    "a": "Խանութներում՝ կանխիկ և քարտ: Առցանց պատվերների դեպքում՝ բանկային փոխանցում կամ վճարում քարտով:"
                }
            ]
        }
    }
}

try:
    doc_ref = db.collection("pages").document("contacts")
    doc_ref.set(contacts_data)
    print("\n✅ Success! 'pages/contacts' document has been thoroughly seeded with dynamic data for ALL languages.")
    print("Your HTML template is now entirely dynamic and lightweight!")
except Exception as e:
    print(f"Error seeding database: {e}")