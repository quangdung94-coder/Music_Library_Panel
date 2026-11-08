# Nhật ký thay đổi

## 08/11/2026 – Multicam Sync trong tab Audio Sync
- Tab Audio Sync có 2 chế độ: "Recorder → máy quay" (chức năng cũ, đổi tên) và "Nhiều máy quay" (mới).
  Giao diện không còn chữ "Tascam"; máy ghi âm rời gọi chung là "Recorder".
- `multicam_sync.py` (bộ ghép 08/11) chép vào plugin, giữ nguyên thuật toán và ngưỡng. Thêm: tự tìm
  `sync_engine.py` cạnh nó, tham số `close_gaps` (công tắc Gap lại), hàng Recorder làm trục chính.
  Chạy lại 2 buổi NgocQuynh cho kết quả y hệt 08/11 (222 và 417 clip, không clip nào khác vị trí/màu).
- Nhiều máy quay: 2–4 máy + Recorder; nút Tự chia theo tên file / Cả bin / Clip đang chọn / File…;
  Sync bằng audio (có "Dùng giờ máy đã chỉnh") hoặc bằng timecode (Start TC); công tắc Gap lại, Chia màn hình;
  bảng kết quả, Xuất CSV, Tạo timeline (bin 03_timeline, không ghi đè timeline trùng tên).
- Dựng timeline theo bài học 08/11: startFrame 0, endFrame = Frames; dồn khe 1–2 frame; Pan ∓480;
  lưới 2×2 thêm Tilt ±270 (đã thử dấu trên Resolve thật: Tilt +270 = hàng trên); tô màu, đặt tên track;
  tự kiểm tra khoảng trống và cụm lệch sau khi dựng.
- Tab Nhạc: bấm Next/Prev thì danh sách tự cuộn tới bài đang phát.
- Đã thử: chạy main.js trong môi trường giả lập Resolve (Python thật, footage thật). Lễ sáng 222/222 clip
  trùng vị trí từng frame với timeline 08/11; Tiệc tối 417 clip lệch tối đa 1 frame; cùng màu, cùng độ dài,
  0 khoảng trống. Thử thêm: tắt Gap lại, tắt Chia màn hình, 3 máy, timecode, Recorder, trùng tên.
  Giả lập bắt được 1 lỗi (lấy nhầm clip từ chỉ mục Media Pool), đã sửa.
- CHƯA thử bấm trong panel trên Resolve thật.

## 04/11/2026
- Đưa mã nguồn lên GitHub (kho riêng tư `quangdung94-coder/Music_Library_Panel`).
- Thêm `CLAUDE.md`: quy trình cuối mỗi lần sửa (CHANGELOG, cài vào Resolve, GitHub, Notion).

## 03/11/2026
- Chặn import trùng theo bin: file đã có trong 02_music / 03_sfx (kể cả bin con) hoặc chỗ khác trong Media Pool
  thì báo "đã tồn tại trong bin …". + Media bỏ qua file đó; + Timeline dừng hẳn, không đặt vào timeline.
- Đã chép `main.js` vào thư mục plugin. Chưa thử trên Resolve thật.
