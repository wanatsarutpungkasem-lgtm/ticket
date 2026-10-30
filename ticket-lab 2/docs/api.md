# Local Lab API

API เหล่านี้เป็นของโปรเจกต์นี้เท่านั้น ไม่ใช่ endpoint ของผู้ขายบัตรภายนอก

ทุก POST รับ JSON object และส่ง `Content-Type: application/json` การเรียกนอกจาก `/api/event` และ `/api/session` ต้องมี `Authorization: Bearer <token>` จาก session ทดสอบ

| Method | Path | การทำงาน |
| --- | --- | --- |
| GET | `/api/event` | รอบ โซน ราคา เวลาเปิดคิว และข้อจำกัด |
| POST | `/api/session` | สร้างผู้ซื้อทดสอบ ส่ง `{}` คืน token และ buyer label |
| POST | `/api/queue/join` | เข้าคิว ส่ง `{}` |
| GET | `/api/queue` | สถานะ `waiting`, `admitted`, `expired`, `left`, `completed` พร้อมลำดับ |
| POST | `/api/queue/leave` | ออกจากคิวและปล่อย holds ของตัวเอง ส่ง `{}` |
| GET | `/api/seats?show=A&zone=LA2` | อ่านผังหลังได้รับสิทธิ์จากคิวเท่านั้น |
| POST | `/api/holds` | ล็อกกลุ่มที่นั่งทั้งกลุ่ม |
| GET | `/api/holds/:id` | อ่านสถานะ hold ของตัวเอง |
| POST | `/api/holds/:id/release` | ปล่อย hold ของตัวเอง ส่ง `{}` |
| POST | `/api/holds/:id/confirm` | สร้างรายการทดสอบ ส่ง `{}` ยืนยันซ้ำคืนรายการเดิม |

ตัวอย่าง payload สำหรับ hold:

```json
{"show":"A","zone":"LA2","seats":["B4","B5"],"adjacent":true}
```

ข้อผิดพลาดสำคัญ: `401 SESSION_REQUIRED`, `403 QUEUE_REQUIRED`, `409 SEAT_TAKEN`, `409 HOLD_EXISTS`, `409 HOLD_EXPIRED`, `400 NOT_ADJACENT` และ `404 HOLD_NOT_FOUND`

`GET /api/queue` และ `/api/seats` มี `serverNow` ให้หน้าจอคำนวณเวลาจากเซิร์ฟเวอร์ การ sweep หมดอายุเกิดก่อนทุกการอ่าน/เขียนที่เกี่ยวข้อง แม้ไม่มี timer background ที่นั่งที่หมดอายุจะถูกคืนก่อนคำขอถัดไปเสมอ

ไม่มี endpoint จัดการข้อมูลบัตรประชาชน ข้อมูลบัตรเครดิต หรือเชื่อม target URL ภายนอก
