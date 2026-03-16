# ⚔️ Metin2 Booking — Projekt Hard

System rezerwacji expienia postaci dla serwera **Projekt Hard** w grze Metin2.  
Zbudowany na Node.js + Express + SQLite. Styl inspirowany mrocznym fantasy.

---

## 🚀 Funkcje

- 🔐 **System kont** — rejestracja, logowanie, sesje
- 📋 **Rezerwacje** — formularz z wyborem pakietu, daty i danych postaci
- 👤 **Dashboard gracza** — widok własnych rezerwacji ze statusami
- 🛡️ **Panel admina** — zarządzanie wszystkimi rezerwacjami (przyjmij / odrzuć / ukończ)
- 🎨 **Dark fantasy UI** — mroczny wygląd inspirowany Metin2

---

## 🏗️ Jak uruchomić lokalnie

```bash
git clone https://github.com/TWOJA_NAZWA/metin2-booking.git
cd metin2-booking
npm install
node server.js
```

Strona działa pod: **http://localhost:3000**

**Domyślne konto admina:**
- Login: `admin`
- Hasło: `admin1234`  
⚠️ Zmień hasło admina po pierwszym uruchomieniu!

---

## ☁️ Wdrożenie na Render.com (krok po kroku)

### 1. Wrzuć kod na GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/TWOJA_NAZWA/metin2-booking.git
git push -u origin main
```

### 2. Stwórz konto na Render.com

Idź na [render.com](https://render.com) → **Sign Up** (możesz przez GitHub).

### 3. Nowy Web Service

1. Dashboard → **New** → **Web Service**
2. Połącz z GitHub → wybierz repo `metin2-booking`
3. Ustawienia:
   - **Name:** `metin2-booking` (dowolna)
   - **Region:** Frankfurt (EU)
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Plan:** Free

### 4. Dysk (ważne! baza danych)

W sekcji **Disks** dodaj:
- **Name:** `data`
- **Mount Path:** `/opt/render/project/src/data`
- **Size:** 1 GB

### 5. Zmienne środowiskowe

W **Environment** dodaj:
| Key | Value |
|-----|-------|
| `SESSION_SECRET` | (wygeneruj losowy ciąg, np. 32 znaki) |
| `NODE_ENV` | `production` |

### 6. Deploy!

Kliknij **Create Web Service** — Render automatycznie wdroży aplikację.  
Po chwili dostaniesz link np. `https://metin2-booking.onrender.com` 🎉

---

## 📁 Struktura projektu

```
metin2-booking/
├── server.js              # Główny serwer Express
├── render.yaml            # Konfiguracja Render.com
├── package.json
├── db/
│   └── database.js        # Baza SQLite + seed danych
├── middleware/
│   └── auth.js            # Middleware autoryzacji
├── routes/
│   ├── auth.js            # Rejestracja / Logowanie
│   └── api.js             # API rezerwacji
└── public/
    ├── index.html         # Strona główna
    ├── login.html         # Logowanie
    ├── register.html      # Rejestracja
    ├── book.html          # Formularz rezerwacji
    ├── dashboard.html     # Moje rezerwacje
    ├── admin.html         # Panel admina
    └── css/
        └── style.css      # Style (dark fantasy)
```

---

## 🔑 Role użytkowników

| Rola | Dostęp |
|------|--------|
| `user` | Składanie rezerwacji, widok własnych |
| `admin` | Wszystkie rezerwacje + zmiana statusów |

Aby nadać komuś rolę admina — zmień w bazie danych:
```sql
UPDATE users SET role='admin' WHERE username='NazwaGracza';
```

---

## ⚙️ Statusy rezerwacji

| Status | Znaczenie |
|--------|-----------|
| `pending` | Oczekuje na potwierdzenie |
| `active` | W trakcie realizacji |
| `done` | Ukończone |
| `rejected` | Odrzucone |

---

## 📝 Dostosowanie pakietów

Edytuj wpisy w pliku `db/database.js` w sekcji seed services, lub bezpośrednio w tabeli `services` w bazie danych SQLite.

---

*Nie jesteśmy oficjalną stroną serwera Projekt Hard.*
