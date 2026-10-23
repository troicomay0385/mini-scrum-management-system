# Mini Scrum Management System

Hệ thống hỗ trợ quản lý dự án theo mô hình Agile/Scrum.

---

## Môi trường Staging
* **Frontend Staging URL:** https://mini-scrum-management-system-y5bi.vercel.app
* **CI/CD:** GitHub Actions & Vercel Integration

---

## Yêu cầu môi trường
* Node.js: phiên bản v18.x hoặc v20.x trở lên
* Trình quản lý gói: npm hoặc yarn
* Git

---

## Hướng dẫn cài đặt và khởi chạy dự án Local

### 1. Clone Repository
```bash
git clone [https://github.com/troicomay0385/mini-scrum-management-system.git](https://github.com/troicomay0385/mini-scrum-management-system.git)
cd mini-scrum-management-system
```

### 2. Cài đặt và khởi chạy Frontend
```bash
cd frontend
npm install
npm run dev
```
> Giao diện người dùng sẽ chạy tại: `http://localhost:5173` (hoặc `http://localhost:3000`)

### 3. Cài đặt và khởi chạy Backend
```bash
cd ../backend
npm install
# Cấu hình biến môi trường trong file .env (Port, Database URL)
npm run dev
```
> Server API sẽ chạy tại: `http://localhost:5000`
