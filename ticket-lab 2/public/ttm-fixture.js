let changes = 0;
document.getElementById('native-round').addEventListener('change', event => {
  changes++;
  document.getElementById('fixture-result').textContent = `รอบ: ${event.target.selectedOptions[0].textContent} · เหตุการณ์เปลี่ยนค่า ${changes} ครั้ง · ไม่มีรายการจอง`;
});
