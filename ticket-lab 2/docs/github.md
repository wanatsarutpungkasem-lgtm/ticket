# นำขึ้น GitHub

โฟลเดอร์นี้เตรียมพร้อมเป็น repository แยก ไม่รวมโปรเจกต์อื่นใน workspace

## ผ่าน GitHub Desktop

1. เลือก Add Local Repository แล้วเลือกโฟลเดอร์ `ticket-lab`
2. ถ้ายังไม่มี Git repository ให้เลือก Create a Repository ที่โฟลเดอร์นี้
3. Commit ไฟล์ทั้งหมดของโปรเจกต์ แล้วกด Publish repository
4. เลือก private/public ตามต้องการ อย่าเพิ่ม `.env` หรือ secret

## ผ่าน Terminal

สร้าง repository เปล่าบน GitHub ก่อน แล้วใช้ URL จริงของคุณแทน `YOUR-USER`

```sh
git init -b main
git add .
git commit -m "Add working ticket booking lab"
git remote add origin https://github.com/YOUR-USER/ticket-pilot-lab.git
git push -u origin main
```

คำสั่งข้างต้นเป็นคำแนะนำ ยังไม่ได้รันหรือสร้าง repository ในบัญชีคุณ

## ใช้ GitHub Codespaces เพื่อรันเซิร์ฟเวอร์

1. เปิด repository > Code > Codespaces > Create codespace (อาจมี quota/ค่าใช้จ่ายตามบัญชี)
2. ตรวจ `node --version` ต้องเป็น 22 ขึ้นไป แล้วรัน:

```sh
HOST=0.0.0.0 npm start
```

3. ใน Ports ให้ forward port 5208 แล้วเลือก visibility **Private**
4. เปิดลิงก์ port เพื่อใช้เว็บ โดย frontend และ API อยู่ origin เดียวกัน
5. Codespaces ใช้สำหรับพัฒนา เมื่อปิด workspace เซิร์ฟเวอร์ก็หยุด และ RAM ของแอปไม่ใช่ฐานข้อมูลถาวร

GitHub Actions ใช้ตรวจ tests; ไม่ใช่เซิร์ฟเวอร์สำหรับเปิดรับจองตลอดเวลา ส่วน GitHub Pages ไม่รัน Node.js backend

## เชื่อมโปรแกรมผู้ช่วย

ตัวอย่างเชื่อมต่อที่ใช้งานอยู่คือ `public/app.js` และโปรแกรมแยก `assistant.mjs` (รันด้วย `npm run assistant`) ซึ่งเรียก API ใน `docs/api.md` โดยใช้ session ของสนามทดสอบนี้เท่านั้น หากภายหลังจะเชื่อมบริการภายนอก ต้องมี API และสิทธิ์จากบริการนั้นแยก ไม่สามารถสลับ URL แล้วใช้กับ TTM/AllTicket ได้
